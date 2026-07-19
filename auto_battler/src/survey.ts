// Post-game survey: one batched LLM call per player answers ALL questions at
// once, returning {"answers": [...]} enforced via OpenRouter structured
// outputs (json_schema, strict). Falls back to a plain-instructions retry for
// models without structured-output support. Results fan out to the master
// JSONL file: one line per player per question per game.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatMessage } from "../../bot-client/src/llm.js";

export interface SurveyTarget {
  /** the PLAYER's model id — this is whose game experience the lines record */
  modelSlug: string;
  /** the player's GameLog file ({usage, messages}) written during the game */
  transcriptPath: string | null;
}

export interface SurveyConfig {
  apiKey: string;
  questions: string[];
  gameNumber: number;
  /** answers the questions instead of the player's own model, when set */
  surveyModel?: string;
  resultsPath: string;
  timeoutMs: number;
}

class SurveyError extends Error {}

function readTranscript(file: string | null): ChatMessage[] {
  if (!file) throw new SurveyError("no transcript file was written for this player");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { messages?: ChatMessage[] };
  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new SurveyError(`transcript ${file} has no messages`);
  }
  return data.messages;
}

function questionBlock(questions: string[]): string {
  return questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
}

function formatInstructions(n: number): string {
  return (
    `Reply with ONLY a JSON object of the shape {"answers": ["...", ...]} containing exactly ${n} strings, ` +
    `where answers[i] answers question i+1. Each answer is plain text, 1-5 sentences, honest and specific.`
  );
}

/** Chat messages for the survey call — the player's own model relives its
 * transcript; an override model reviews it as a flattened document. */
function buildMessages(transcript: ChatMessage[], cfg: SurveyConfig, playerModel: string): ChatMessage[] {
  const n = cfg.questions.length;
  const ask = `QUESTIONS:\n${questionBlock(cfg.questions)}\n\n${formatInstructions(n)}`;
  if (!cfg.surveyModel) {
    return [
      ...transcript,
      {
        role: "user",
        content:
          `The game is over. You just played the game shown above. ` +
          `Answer the following questions about YOUR game experience.\n\n${ask}`,
      },
    ];
  }
  const flat = transcript.map((m) => `--- ${m.role.toUpperCase()} ---\n${m.content}`).join("\n\n");
  return [
    {
      role: "system",
      content:
        `You are reviewing a completed game of Tetrad (a card-battle game). Below is the full transcript of the game ` +
        `as experienced by the player controlled by the model "${playerModel}": its system prompt (the rules), every ` +
        `board state it saw, and every reply it gave. Answer the questions about that player's game experience, ` +
        `grounded strictly in the transcript.`,
    },
    { role: "user", content: `TRANSCRIPT:\n${flat}\n\n${ask}` },
  ];
}

async function surveyChat(
  cfg: SurveyConfig,
  model: string,
  messages: ChatMessage[],
  structured: boolean
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    const body: Record<string, unknown> = { model, messages, temperature: 0.7 };
    if (structured) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "survey_answers",
          strict: true,
          schema: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                items: { type: "string" },
                minItems: cfg.questions.length,
                maxItems: cfg.questions.length,
              },
            },
            required: ["answers"],
            additionalProperties: false,
          },
        },
      };
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Tetrad auto-battler survey",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new SurveyError(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new SurveyError(`OpenRouter error: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new SurveyError("OpenRouter returned no content");
    return content;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new SurveyError(`survey model did not answer within ${Math.round(cfg.timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseAnswers(raw: string, n: number): string[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new SurveyError("no JSON object in survey reply");
    text = text.slice(start, end + 1);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new SurveyError(`invalid survey JSON: ${(e as Error).message}`);
  }
  const answers = (obj as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) throw new SurveyError(`survey reply has no "answers" array`);
  if (answers.length !== n) throw new SurveyError(`expected ${n} answers, got ${answers.length}`);
  return answers.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
}

/** Ask all questions in one call; structured output first, plain retry after. */
async function collectAnswers(cfg: SurveyConfig, target: SurveyTarget): Promise<string[]> {
  const transcript = readTranscript(target.transcriptPath);
  const messages = buildMessages(transcript, cfg, target.modelSlug);
  const model = cfg.surveyModel ?? target.modelSlug;
  let lastErr: Error | null = null;
  for (const structured of [true, false]) {
    try {
      return parseAnswers(await surveyChat(cfg, model, messages, structured), cfg.questions.length);
    } catch (e) {
      lastErr = e as Error;
      console.error(`[survey] ${model} (${structured ? "structured" : "plain"}): ${lastErr.message}`);
    }
  }
  throw lastErr ?? new SurveyError("survey failed");
}

/** Survey one player and append one JSONL line per question to the master
 * file. Failures still emit lines with a "(no answer: ...)" answer so every
 * game/player/question triple is present. */
export async function surveyPlayer(cfg: SurveyConfig, target: SurveyTarget): Promise<void> {
  const answerer = cfg.surveyModel ?? target.modelSlug;
  console.log(`[survey] asking ${answerer} about ${target.modelSlug}'s game ${cfg.gameNumber}...`);
  let answers: string[];
  try {
    answers = await collectAnswers(cfg, target);
  } catch (e) {
    answers = cfg.questions.map(() => `(no answer: ${(e as Error).message})`);
  }
  fs.mkdirSync(path.dirname(cfg.resultsPath), { recursive: true });
  const lines = cfg.questions.map((question, i) =>
    JSON.stringify({
      modelSlug: target.modelSlug,
      gameNumber: cfg.gameNumber,
      question,
      answer: answers[i] ?? "(no answer)",
      ...(cfg.surveyModel ? { surveyModel: cfg.surveyModel } : {}),
    })
  );
  fs.appendFileSync(cfg.resultsPath, lines.map((l) => l + "\n").join(""));
  for (const line of lines) console.log(`[survey] ${line}`);
}
