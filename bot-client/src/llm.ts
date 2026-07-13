// OpenRouter chat-completions caller. The live context is deliberately tiny:
// system prompt + the latest board state (plus the failed exchange when
// retrying). Full history is preserved separately by gamelog.ts.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BotReply {
  reasoning?: string;
  action: number;
  targets?: string[];
  attackTarget?: string;
  chosenColor?: string;
  declaredColor?: string;
  extra?: Record<string, unknown>;
  choice?: unknown;
}

export class LlmError extends Error {}

export interface LlmConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export async function chat(cfg: LlmConfig, messages: ChatMessage[]): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 30_000);
  try {
    const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Tetrad bot-client",
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7 }),
    });
    if (!res.ok) {
      throw new LlmError(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new LlmError(`OpenRouter error: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmError("OpenRouter returned no content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the bot's JSON decision from a possibly chatty/fenced reply. */
export function parseReply(raw: string): BotReply {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  // fall back to the outermost {...} block
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new LlmError("no JSON object in reply");
    text = text.slice(start, end + 1);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new LlmError(`invalid JSON: ${(e as Error).message}`);
  }
  const r = obj as Record<string, unknown>;
  const action = typeof r.action === "number" ? r.action : Number(r.action);
  if (!Number.isInteger(action) || action < 0) {
    throw new LlmError(`"action" must be a legal-action index, got ${JSON.stringify(r.action)}`);
  }
  return { ...(r as object), action } as BotReply;
}
