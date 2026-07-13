// Full-game training log in the OpenAI chat-completions format:
// { "messages": [ {role, content}, ... ] } — system prompt once, then EVERY
// user (board state) and assistant (model reply) turn, unabridged. The live
// LLM context omits history to save tokens; this log does not. Rewritten
// atomically after every exchange so a crash loses nothing.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatMessage } from "./llm.js";

export class GameLog {
  private messages: ChatMessage[] = [];
  private file: string | null = null;
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Start a fresh log; called once the room code is known. */
  begin(roomCode: string, systemPrompt: string): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(this.dir, `${roomCode}-${stamp}.json`);
    this.messages = [{ role: "system", content: systemPrompt }];
    this.flush();
  }

  append(role: "user" | "assistant", content: string): void {
    if (!this.file) return; // not started yet
    this.messages.push({ role, content });
    this.flush();
  }

  get path(): string | null {
    return this.file;
  }

  private flush(): void {
    if (!this.file) return;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ messages: this.messages }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
