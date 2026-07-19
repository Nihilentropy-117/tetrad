// Spawn the real Tetrad server (packages/server) as a black-box subprocess on
// a free port, wait until it accepts WebSocket connections, and kill it on
// shutdown. The server code itself is never touched.

import { type ChildProcess, spawn } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SpawnedServer {
  url: string;
  stop(): void;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** One WS connection attempt; resolves true if the server accepted it. */
function tryConnect(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 2000 });
    ws.on("open", () => {
      ws.close();
      resolve(true);
    });
    ws.on("error", () => resolve(false));
  });
}

export async function spawnServer(logDir: string): Promise<SpawnedServer> {
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}`;
  const child: ChildProcess = spawn("npx", ["tsx", "src/main.ts"], {
    cwd: path.join(REPO_ROOT, "packages", "server"),
    env: { ...process.env, PORT: String(port), TETRAD_LOG_DIR: logDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));

  let exited = false;
  child.on("exit", (code) => {
    exited = true;
    if (code !== null && code !== 0) console.error(`[server] exited with code ${code}`);
  });
  const stop = () => {
    if (!exited) child.kill("SIGTERM");
  };
  process.on("exit", stop);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("server process exited before becoming ready (run `npm install` at the repo root?)");
    if (await tryConnect(url)) return { url, stop };
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error(`server did not become ready on ${url} within 30s`);
}
