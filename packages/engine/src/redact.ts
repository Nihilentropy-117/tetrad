// Per-player views (§3.3): hands hidden unless owned/revealed, RNG and the
// resolution stack stripped. The server sends only these to clients.

import { pclass, modsFor } from "./state.js";
import type { CardId, DecisionRequest, GameEvent, GameState, PlayerId } from "./types.js";

export interface PlayerView {
  you: PlayerId;
  phase: GameState["phase"];
  mode: GameState["config"]["mode"];
  activeColor: string;
  activeNumber: number | null;
  topCard: CardId | null;
  drawPileCount: number;
  underPileCount: number;
  colorChangeCount: number;
  turn: {
    activePlayer: PlayerId;
    actingPlayer: PlayerId;
    direction: 1 | -1;
    hasDrawn: boolean;
  };
  players: Array<{
    id: PlayerId;
    name: string;
    seat: number;
    classId: string | null;
    hp: number;
    maxHp: number;
    status: string;
    handCount: number;
    hand?: CardId[];
    statuses: Array<{ key: string; source: PlayerId }>;
  }>;
  placements: PlayerId[];
  winner: GameState["winner"];
  decision: DecisionRequest | null;
}

export function redact(s: GameState, viewer: PlayerId): PlayerView {
  return {
    you: viewer,
    phase: s.phase,
    mode: s.config.mode,
    activeColor: s.field.activeColor,
    activeNumber: s.field.activeNumber,
    topCard: s.field.pile[s.field.pile.length - 1] ?? null,
    drawPileCount: s.drawPile.length,
    underPileCount: s.field.underPile.length,
    colorChangeCount: s.colorChangeCount,
    turn: {
      activePlayer: s.turn.activePlayer,
      actingPlayer: s.turn.stolenBy ?? s.turn.activePlayer,
      direction: s.turn.direction,
      hasDrawn: s.turn.hasDrawn,
    },
    players: s.players.map((p) => {
      const revealed = p.id === viewer || (p.classId !== null && modsFor(s, p.id).revealHand);
      return {
        id: p.id,
        name: s.config.players.find((c) => c.id === p.id)?.name ?? p.id,
        seat: p.seat,
        classId: s.phase === "classSelect" ? (p.id === viewer ? p.pendingClass : null) : p.classId,
        hp: p.hp,
        maxHp: p.classId ? pclass(s, p.id).maxHp : 0,
        status: p.status,
        handCount: p.hand.length,
        hand: revealed ? [...p.hand] : undefined,
        statuses: s.effects
          .filter((e) => e.owner === p.id)
          .map((e) => ({ key: e.key, source: e.source })),
      };
    }),
    placements: [...s.placements],
    winner: s.winner,
    decision: s.pending && s.pending.decision.player === viewer ? s.pending.decision : null,
  };
}

/** Server-side event filter: strip events not meant for this viewer. */
export function eventsFor(events: GameEvent[], viewer: PlayerId): GameEvent[] {
  return events.filter((e) => !e.private || (e.private as PlayerId[]).includes(viewer));
}
