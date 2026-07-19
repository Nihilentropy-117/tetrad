// Mirror everything printed via console.log/console.error into a per-game log
// file (ANSI colors stripped), while still showing it on screen. The bot-client
// Agent prints directly to the console, so patching the console is how we get
// its full output into log_game_XX without modifying bot-client.

import * as fs from "node:fs";
import * as path from "node:path";
import { format } from "node:util";

const ANSI = /\x1b\[[0-9;]*m/g;

export class Tee {
  private origLog = console.log;
  private origError = console.error;
  private fd: number;

  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, "a");
    console.log = (...args: unknown[]) => {
      this.origLog(...args);
      this.write(format(...args));
    };
    console.error = (...args: unknown[]) => {
      this.origError(...args);
      this.write(format(...args));
    };
  }

  private write(line: string): void {
    try {
      fs.writeSync(this.fd, line.replace(ANSI, "") + "\n");
    } catch {
      // never let logging take the game down
    }
  }

  close(): void {
    console.log = this.origLog;
    console.error = this.origError;
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}
