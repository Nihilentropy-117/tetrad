// Deterministic RNG living inside GameState (§3.2). All game randomness is d6
// rolls or uniform picks routed through here; scripted mode feeds exact die
// faces to tests.

import type { GameState, RngState } from "./types.js";

/** FNV-1a hash of a seed string to a 32-bit int. */
export function seedFromString(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 step: returns float in [0,1) and advances state. */
function next(rng: { s: number }): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function makeRng(seed: string): RngState {
  return { kind: "seeded", s: seedFromString(seed) };
}

export function scriptedRng(values: number[]): RngState {
  return { kind: "scripted", values: [...values], i: 0 };
}

/** Roll one d6 (1-6), mutating the rng state held in `s`. */
export function rollD6(s: GameState): number {
  const rng = s.rng;
  if (rng.kind === "scripted") {
    if (rng.i >= rng.values.length) {
      throw new Error("scripted RNG exhausted");
    }
    const v = rng.values[rng.i++];
    if (v < 1 || v > 6) throw new Error(`scripted die face out of range: ${v}`);
    return v;
  }
  return 1 + Math.floor(next(rng) * 6);
}

/** Uniform integer in [0, n). Scripted mode consumes one value (1-based ok, clamped). */
export function randInt(s: GameState, n: number): number {
  if (n <= 0) return 0;
  const rng = s.rng;
  if (rng.kind === "scripted") {
    if (rng.i >= rng.values.length) throw new Error("scripted RNG exhausted");
    return Math.min(n - 1, Math.max(0, rng.values[rng.i++] - 1));
  }
  return Math.floor(next(rng) * n);
}

/** Fisher-Yates shuffle in place using the state RNG. */
export function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
