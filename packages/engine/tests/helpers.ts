// Test fixtures: build a game in a known main-phase state with chosen classes,
// exact hands, an exact field card, and (optionally) scripted dice.

import { expect } from "vitest";
import {
  allCardIds,
  applyAction,
  card,
  effectiveNumber,
  initialState,
  scriptedRng,
  type Action,
  type ClassId,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "../src/index.js";

export interface SetupOpts {
  /** field card id; default red-5-a */
  field?: string;
  /** explicit hands by player id; others get 7 arbitrary cards */
  hands?: Record<string, string[]>;
  mode?: "ffa" | "teams";
  seed?: string;
}

export function setup(classes: ClassId[], opts: SetupOpts = {}): GameState {
  const players = classes.map((_, i) => ({ id: `p${i}`, name: `P${i}` }));
  let s = initialState(
    { mode: opts.mode ?? "ffa", players, dealerSeat: players.length - 1 },
    opts.seed ?? "test-seed"
  );
  for (let i = 0; i < classes.length; i++) {
    s = ok(applyAction(s, { type: "chooseClass", player: `p${i}`, classId: classes[i] }));
  }
  if (s.pending) {
    // initial wild: dealer picks a color (S6)
    s = decide(s, s.pending.decision.default);
  }
  // Rebuild card zones exactly: field card + specified hands; everyone else
  // gets 7 cards; the rest is the draw pile. Conservation stays intact.
  const field = opts.field ?? "red-5-a";
  const hands = opts.hands ?? {};
  const used = new Set<string>([field, ...Object.values(hands).flat()]);
  if (used.size !== 1 + Object.values(hands).flat().length) throw new Error("duplicate cards in setup");
  const pool = allCardIds().filter((c) => !used.has(c));
  // Filler hands get only plain 1-9 number cards: 0s and wilds in a random
  // hand would trigger interrupt windows (SP8/C7) scenario tests don't expect.
  const safe = pool.filter((c) => {
    const d = card(c);
    return d.kind === "number" && d.number !== 0;
  });
  const assigned = new Set<string>();
  for (const p of s.players) {
    if (hands[p.id]) {
      p.hand = [...hands[p.id]];
    } else {
      p.hand = safe.splice(0, 7);
      for (const c of p.hand) assigned.add(c);
    }
  }
  const rest = pool.filter((c) => !assigned.has(c));
  pool.length = 0;
  pool.push(...rest);
  const def = card(field);
  s.field.pile = [field];
  s.field.underPile = [];
  s.staging = [];
  s.field.activeColor = def.color ?? "red";
  s.field.activeNumber = effectiveNumber(def);
  s.drawPile = pool;
  return s;
}

/** Force exact upcoming die faces. */
export function script(s: GameState, faces: number[]): void {
  s.rng = scriptedRng(faces);
}

export function ok(r: ReturnType<typeof applyAction>): GameState {
  if (!r.ok) throw new Error(`action failed: ${r.error.code}: ${r.error.message}`);
  return r.state;
}

export function okEv(r: ReturnType<typeof applyAction>): { s: GameState; events: GameEvent[] } {
  if (!r.ok) throw new Error(`action failed: ${r.error.code}: ${r.error.message}`);
  return { s: r.state, events: r.events };
}

export function act(s: GameState, action: Action): GameState {
  return ok(applyAction(s, action));
}

export function play(
  s: GameState,
  player: PlayerId,
  cardId: string,
  rest: Partial<Extract<Action, { type: "playCard" }>> = {}
): GameState {
  return act(s, { type: "playCard", player, card: cardId, ...rest });
}

/** Answer the pending decision (defaults to its default). */
export function decide(s: GameState, choice?: unknown): GameState {
  if (!s.pending) throw new Error("no pending decision");
  return act(s, {
    type: "decide",
    player: s.pending.decision.player,
    decisionId: s.pending.decision.id,
    choice: choice === undefined ? s.pending.decision.default : choice,
  });
}

/** Drain any pending decisions with defaults until main phase. */
export function settle(s: GameState): GameState {
  let guard = 0;
  while (s.pending) {
    if (++guard > 100) throw new Error("settle did not converge");
    s = decide(s);
  }
  return s;
}

export function hp(s: GameState, id: PlayerId): number {
  return s.players.find((p) => p.id === id)!.hp;
}

export function hand(s: GameState, id: PlayerId): string[] {
  return s.players.find((p) => p.id === id)!.hand;
}

export function statuses(s: GameState, id: PlayerId): string[] {
  return s.effects.filter((e) => e.owner === id).map((e) => e.key);
}

/** Card conservation invariant: every card exists exactly once somewhere. */
export function assertConservation(s: GameState): void {
  const zones = [
    ...s.drawPile,
    ...s.field.pile,
    ...s.field.underPile,
    ...s.staging,
    ...s.players.flatMap((p) => p.hand),
  ];
  expect(zones.length).toBe(108);
  expect(new Set(zones).size).toBe(108);
}
