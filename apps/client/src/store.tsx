// One store: connection status, session identity, latest server state, event
// feed. The client never derives rules — it renders what the server sent.

import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import type { Action, ClientMsg, LobbyPlayer, ServerMsg, StateMsg } from "./types";
import { fmtEvent } from "./types";

export interface Session {
  url: string;
  code: string;
  token: string;
  you: string;
}

export interface ClientState {
  status: "idle" | "connecting" | "connected" | "closed";
  session: Session | null;
  seat: number;
  lobby: { code: string; mode: string; players: LobbyPlayer[]; host: string } | null;
  game: StateMsg | null;
  feed: string[];
  error: string | null;
}

const initial: ClientState = {
  status: "idle",
  session: null,
  seat: 0,
  lobby: null,
  game: null,
  feed: [],
  error: null,
};

type Ev =
  | { t: "connecting" }
  | { t: "connected" }
  | { t: "closed" }
  | { t: "leave" }
  | { t: "srv"; msg: ServerMsg; url: string };

function reducer(st: ClientState, ev: Ev): ClientState {
  switch (ev.t) {
    case "connecting":
      return { ...st, status: "connecting", error: null };
    case "connected":
      return { ...st, status: "connected" };
    case "closed":
      return { ...st, status: "closed" };
    case "leave":
      return { ...initial };
    case "srv": {
      const m = ev.msg;
      switch (m.t) {
        case "joined": {
          const session: Session = { url: ev.url, code: m.code, token: m.token, you: m.playerId };
          saveSession(session);
          return { ...st, session, seat: m.seat, error: null };
        }
        case "lobby":
          return { ...st, lobby: m, error: null };
        case "state": {
          if (st.game && m.version <= st.game.version) return st; // stale
          const you = st.session?.you ?? "";
          const lines = m.events
            .map((e) => fmtEvent(e, you, m.view))
            .filter((x): x is string => x !== null);
          return { ...st, game: m, feed: [...st.feed, ...lines].slice(-120), error: null };
        }
        case "error":
          return { ...st, error: `${m.code}: ${m.message}` };
        default:
          return st;
      }
    }
  }
}

// --- session persistence (web localStorage; memory elsewhere) ---------------

let memSession: string | null = null;
function storage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* not available */
  }
  return {
    getItem: () => memSession,
    setItem: (_k: string, v: string) => {
      memSession = v;
    },
    removeItem: () => {
      memSession = null;
    },
  };
}
function saveSession(s: Session): void {
  storage().setItem("tetrad.session", JSON.stringify(s));
}
export function loadSession(): Session | null {
  try {
    const raw = storage().getItem("tetrad.session");
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  storage().removeItem("tetrad.session");
}

export function defaultServerUrl(): string {
  try {
    if (typeof location !== "undefined" && location.hostname) {
      return `ws://${location.hostname}:8080`;
    }
  } catch {
    /* native */
  }
  return "ws://localhost:8080";
}

// --- context -----------------------------------------------------------------

export interface GameApi {
  st: ClientState;
  create(url: string, name: string, mode: "ffa" | "teams"): void;
  join(url: string, name: string, code: string): void;
  rejoin(session: Session): void;
  start(): void;
  recuse(spectate: boolean): void;
  action(a: Action): void;
  leave(): void;
}

const Ctx = createContext<GameApi>(null as unknown as GameApi);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [st, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const urlRef = useRef<string>("");

  const open = useCallback((url: string, hello: ClientMsg) => {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    urlRef.current = url;
    dispatch({ t: "connecting" });
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      dispatch({ t: "connected" });
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (evt) => {
      try {
        dispatch({ t: "srv", msg: JSON.parse(String(evt.data)) as ServerMsg, url });
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => dispatch({ t: "closed" });
    ws.onerror = () => dispatch({ t: "closed" });
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const api = useMemo<GameApi>(
    () => ({
      st,
      create: (url, name, mode) => open(url, { t: "create", name, mode }),
      join: (url, name, code) => open(url, { t: "join", code: code.toUpperCase(), name }),
      rejoin: (s) => open(s.url, { t: "rejoin", code: s.code, token: s.token }),
      start: () => send({ t: "start" }),
      recuse: (spectate) => send({ t: "recuse", spectate }),
      action: (a) => send({ t: "action", action: a }),
      leave: () => {
        clearSession();
        try {
          wsRef.current?.close();
        } catch {
          /* ignore */
        }
        dispatch({ t: "leave" });
      },
    }),
    [st, open, send]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  return useContext(Ctx);
}
