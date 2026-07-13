// The decision loop: for each fresh state where it's our move, render the
// board, ask the LLM, submit its action. One retry with the server's error
// message, then a safe fallback so the game never stalls (pending decisions
// auto-resolve server-side at ~45s, so timeliness matters).

import { blue, dim, green, orange } from "./colors.js";
import { GameLog } from "./gamelog.js";
import { chat, parseReply, type BotReply, type ChatMessage, type LlmConfig, LlmError } from "./llm.js";
import { fmtEvent, renderState } from "./prompt.js";
import { SYSTEM_PROMPT } from "./rules.js";
import type { Session } from "./net.js";
import type { Action, Color, GameEvent, PlayerId, StateMsg } from "./types.js";
import { COLORS } from "./types.js";

type Outcome = { ok: true } | { ok: false; message: string };

export class Agent {
  private queue: StateMsg[] = [];
  private running = false;
  private lastHandled = -1;
  /** events seen since the last prompt we built; flushed into the next one */
  private eventBuffer: GameEvent[] = [];
  private pendingOutcome: ((o: Outcome) => void) | null = null;
  private finishedResolve!: () => void;
  /** resolves when the game reaches the finished phase */
  readonly finished = new Promise<void>((res) => (this.finishedResolve = res));

  constructor(
    private session: Session,
    private llm: LlmConfig,
    private log: GameLog
  ) {}

  onServerError(code: string, message: string): void {
    if (this.pendingOutcome) {
      this.pendingOutcome({ ok: false, message: `${code}: ${message}` });
      this.pendingOutcome = null;
    } else {
      console.error(`[server error] ${code}: ${message}`);
    }
  }

  onState(msg: StateMsg): void {
    if (this.pendingOutcome) {
      this.pendingOutcome({ ok: true });
      this.pendingOutcome = null;
    }
    this.queue.push(msg);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        // act on the newest state only, but never drop the skipped states'
        // events — they are context for the LLM and history for the log
        const msgs = this.queue.splice(0);
        let msg: StateMsg | null = null;
        for (const m of msgs) {
          if (m.version <= this.lastHandled) continue;
          this.lastHandled = m.version;
          this.eventBuffer.push(...m.events);
          for (const line of eventLines(m)) console.log(`  ${line}`);
          msg = m;
        }
        if (msg) await this.handle(msg);
      }
    } finally {
      this.running = false;
    }
  }

  private async handle(latest: StateMsg): Promise<void> {
    // never offer concede to the model — an accidental pick loses the game
    const msg: StateMsg = {
      ...latest,
      events: this.eventBuffer,
      legal: latest.legal.filter((s) => s.type !== "concede"),
    };

    if (msg.view.phase === "finished") {
      const summary = `GAME OVER. Winner: ${msg.view.winner ?? "none"}. Placements: ${msg.view.placements.join(", ")}.`;
      console.log(summary);
      this.eventBuffer = [];
      this.log.append("user", renderState(msg));
      this.finishedResolve();
      return;
    }
    if (!this.shouldAct(msg)) return;

    this.eventBuffer = [];
    const userMsg = renderState(msg);
    this.log.append("user", userMsg);
    const context: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ];

    // Normal turns have no server timer; only pending decisions auto-resolve
    // at msg.deadline. Give the model the full budget, but never blow past a
    // decision deadline (keep a 5s margin to deliver the action).
    const budget = () => {
      const full = this.llm.timeoutMs ?? 120_000;
      if (!msg.deadline) return full;
      return Math.max(5_000, Math.min(full, msg.deadline - Date.now() - 5_000));
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: string;
      try {
        raw = await chat(this.llm, context, budget());
      } catch (e) {
        console.error(`[llm] ${(e as Error).message}`);
        break; // LLM unreachable — go straight to fallback
      }
      this.log.append("assistant", raw);
      context.push({ role: "assistant", content: raw });

      let failure: string;
      try {
        const reply = parseReply(raw);
        const action = this.buildAction(msg, reply);
        if (reply.reasoning) console.log(blue(`[${this.llm.model}] ${reply.reasoning}`));
        console.log(orange(`-> ${JSON.stringify(action)}`));
        const outcome = await this.submit(action);
        if (outcome.ok) return;
        failure = `The server rejected that action — ${outcome.message}.`;
      } catch (e) {
        if (!(e instanceof LlmError)) throw e;
        failure = `Your reply could not be used — ${e.message}.`;
      }
      console.error(`[retry] ${failure}`);
      const retryMsg = `${failure} Choose again from the same LEGAL ACTIONS, and reply with ONLY the JSON object.`;
      this.log.append("user", retryMsg);
      context.push({ role: "user", content: retryMsg });
    }

    const fallback = this.fallbackAction(msg);
    if (fallback) {
      console.error(orange(`[fallback] ${JSON.stringify(fallback)}`));
      this.log.append("user", `(bot-client fallback: submitted ${JSON.stringify(fallback)})`);
      await this.submit(fallback);
    } else {
      console.error("[fallback] no safe action available; waiting for server timeout");
    }
  }

  private shouldAct(msg: StateMsg): boolean {
    const v = msg.view;
    if (v.decision) return true;
    if (v.phase === "classSelect") {
      const me = v.players.find((p) => p.id === v.you);
      return me?.classId === null && msg.legal.some((s) => s.type === "chooseClass");
    }
    if (v.phase === "playing" && v.turn.actingPlayer === v.you) {
      // ignore off-turn-style specs; anytime/concede are always available and
      // not worth an LLM call on their own
      return msg.legal.some((s) => s.type !== "anytime" && s.type !== "concede");
    }
    return false;
  }

  private buildAction(msg: StateMsg, reply: BotReply): Action {
    const spec = msg.legal[reply.action];
    if (!spec) throw new LlmError(`action index ${reply.action} is out of range (0-${msg.legal.length - 1})`);
    const player = msg.view.you;
    switch (spec.type) {
      case "chooseClass":
        return { type: "chooseClass", player, classId: spec.classId! };
      case "drawCard":
        return { type: "drawCard", player };
      case "endTurn":
        return { type: "endTurn", player };
      case "concede":
        return { type: "concede", player };
      case "decide": {
        const choice = reply.choice ?? msg.view.decision?.default;
        return { type: "decide", player, decisionId: spec.decisionId!, choice };
      }
      case "anytime":
        return { type: "anytime", player, card: spec.card!, extra: reply.extra };
      case "playCard": {
        const a: Action = { type: "playCard", player, card: spec.card! };
        if (spec.needs?.targets) {
          if (!Array.isArray(reply.targets) && !spec.needs.targets.upTo) {
            throw new LlmError(`this action needs "targets" (${spec.needs.targets.count} player id(s))`);
          }
          if (reply.targets) a.targets = reply.targets as PlayerId[];
        }
        if (spec.needs?.attackTarget) {
          if (typeof reply.attackTarget !== "string") throw new LlmError(`this action needs "attackTarget" (a player id)`);
          a.attackTarget = reply.attackTarget;
        }
        if (spec.needs?.chosenColor) {
          a.chosenColor = asColor(reply.chosenColor, "chosenColor");
        }
        if (spec.needs?.extra === "declaredColor") {
          a.declaredColor = asColor(reply.declaredColor, "declaredColor");
        } else if (spec.needs?.extra && reply.extra) {
          a.extra = reply.extra;
        }
        return a;
      }
    }
  }

  /** Never-stall default: decision default > endTurn > drawCard > any no-needs play. */
  private fallbackAction(msg: StateMsg): Action | null {
    const player = msg.view.you;
    const decide = msg.legal.find((s) => s.type === "decide");
    if (decide) return { type: "decide", player, decisionId: decide.decisionId!, choice: msg.view.decision?.default };
    if (msg.view.phase === "classSelect") {
      const pick = msg.legal.find((s) => s.type === "chooseClass");
      return pick ? { type: "chooseClass", player, classId: pick.classId! } : null;
    }
    if (msg.legal.some((s) => s.type === "endTurn")) return { type: "endTurn", player };
    if (msg.legal.some((s) => s.type === "drawCard")) return { type: "drawCard", player };
    const simple = msg.legal.find((s) => s.type === "playCard" && !s.needs);
    if (simple) return { type: "playCard", player, card: simple.card! };
    return null;
  }

  private submit(action: Action): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingOutcome) {
          this.pendingOutcome = null;
          resolve({ ok: true }); // no verdict; assume broadcast was missed
        }
      }, 10_000);
      this.pendingOutcome = (o) => {
        clearTimeout(timer);
        resolve(o);
      };
      this.session.sendAction(action);
    });
  }
}

function asColor(v: unknown, field: string): Color {
  if (typeof v === "string" && (COLORS as readonly string[]).includes(v)) return v as Color;
  throw new LlmError(`this action needs "${field}" (one of ${COLORS.join("/")})`);
}

/** Console lines for one state's events: human-readable, colored by actor —
 * green for the humans, orange for the bot, dim for neutral bookkeeping. */
function eventLines(msg: StateMsg): string[] {
  const you = msg.view.you;
  const lines: string[] = [];
  for (const e of msg.events) {
    const text = fmtEvent(e, msg.view);
    if (text === null) continue;
    const subject = e.player ?? e.src ?? e.roller ?? e.by ?? e.attacker ?? e.owner ?? e.target ?? e.a;
    if (subject === undefined) lines.push(dim(text));
    else if (subject === you) lines.push(orange(text));
    else lines.push(green(text));
  }
  return lines;
}
