// Dice rolling (with every roll manipulation in the game) and the damage
// math: attacker phase maximizes, defender phase is a min-search (C2, Q16).

import { HOLY } from "./classes/index.js";
import { rollD6 } from "./rng.js";
import {
  areAllies,
  consumeArmed,
  modsFor,
  pclass,
  player,
  removeStatus,
  statusesByKey,
} from "./state.js";
import type { Ctx, Dice, PlayerId } from "./types.js";

export type RollKind = "attack" | "ability" | "save" | "heal" | "misc";

/**
 * Roll `dice.n` d6 for `roller`, applying TH-7 Loaded Dice, SC-C Tripwire and
 * SO-A Arcane Influence (M6 default: lower enemy rolls, raise ally/self).
 * Returns the dice sum (no flat bonus).
 */
export function rollSum(ctx: Ctx, roller: PlayerId, n: number, kind: RollKind): number {
  const s = ctx.s;

  // SC-C Tripwire: the target fails their next roll or attack.
  const trip = statusesByKey(s, roller, "tripwire")[0];
  if (trip && (kind === "attack" || kind === "save" || kind === "ability")) {
    removeStatus(ctx, trip, "triggered");
    ctx.events.push({ type: "RollFailed", roller, reason: "tripwire", kind });
    return 0;
  }

  // TH-7 Loaded Dice: Thief's own next roll is an automatic max (Q28).
  const loaded = statusesByKey(s, roller, "loadedDice")[0];
  if (loaded) {
    removeStatus(ctx, loaded, "triggered");
    ctx.events.push({ type: "DiceRolled", roller, kind, faces: Array(n).fill(6), total: 6 * n, loaded: true });
    return 6 * n;
  }

  const faces: number[] = [];
  for (let i = 0; i < n; i++) faces.push(rollD6(s));
  let total = faces.reduce((a, b) => a + b, 0);

  // Show the original roll first so influence adjustments are auditable.
  ctx.events.push({ type: "DiceRolled", roller, kind, faces, total });

  // SO-A Arcane Influence: every active influence adjusts by ±2 (M6 default).
  for (const e of s.effects) {
    if (e.key !== "arcaneInfluence") continue;
    if (player(s, e.source).status !== "active") continue;
    const delta = areAllies(s, e.source, roller) ? 2 : -2;
    const adjusted = Math.max(n, Math.min(6 * n, total + delta));
    if (adjusted !== total) {
      ctx.events.push({ type: "ArcaneInfluence", by: e.source, roller, from: total, to: adjusted });
      total = adjusted;
    }
  }

  return total;
}

/** Roll dice `times` times and keep the best sum (KN-8, PA-4, ZK-7 saves). */
export function rollSumBest(ctx: Ctx, roller: PlayerId, n: number, kind: RollKind, times: number): number {
  let best = -1;
  for (let i = 0; i < Math.max(1, times); i++) {
    best = Math.max(best, rollSum(ctx, roller, n, kind));
  }
  return best;
}

/** SP9 save: 2d6 vs dc. ZK-7 Danger Sense grants extra rolls. */
export function saveRoll(ctx: Ctx, roller: PlayerId, dc: number): boolean {
  const rolls = modsFor(ctx.s, roller).saveRolls;
  const total = rollSumBest(ctx, roller, 2, "save", rolls);
  const passed = total >= dc;
  ctx.events.push({ type: "SaveRolled", roller, dc, total, passed });
  return passed;
}

/** SC-2 Lucky Break: every 6 rolled adds another d6 (capped for sanity). */
export function rollExploding(ctx: Ctx, roller: PlayerId, n: number): number {
  let total = 0;
  let pending = n;
  let rolled = 0;
  while (pending > 0 && rolled < 20) {
    pending--;
    rolled++;
    const f = rollD6(ctx.s);
    total += f;
    if (f === 6) pending++;
  }
  ctx.events.push({ type: "DiceRolled", roller, kind: "heal", exploding: true, total });
  return total;
}

/** Does the color bonus apply to this play? (T5) */
export function colorBonusApplies(
  ctx: Ctx,
  actor: PlayerId,
  cardColor: string | null,
  cardIsWildOrZero: boolean
): boolean {
  const cls = pclass(ctx.s, actor);
  if (cls.alwaysColorBonus) return true; // SO-P
  if (cardIsWildOrZero) return true; // SP4/SP5/SP6
  return cardColor === cls.color;
}

export interface AttackerResult {
  amount: number;
  usedColorBonus: boolean;
}

/**
 * Attacker phase of the pipeline (C2): dice → riders → flat adds → multipliers.
 * `withColorBonus` is decided by the play context; riders (exposed / guiding
 * bolt) are consumed/read here since they raise the attack.
 */
export function attackerPhase(
  ctx: Ctx,
  src: PlayerId,
  tgt: PlayerId,
  dice: Dice,
  opts: {
    kind: RollKind;
    withColorBonus: boolean;
    rollTwice?: boolean;
    /** pre-rolled dice sum for shared AoE rolls (Q27) */
    preRolled?: number;
  }
): AttackerResult {
  const s = ctx.s;
  const mods = modsFor(s, src);
  const cls = pclass(s, src);
  const times = (opts.rollTwice ? 2 : 1) * (mods.attackAdvantage && opts.kind === "attack" ? 2 : 1);
  let total =
    opts.preRolled !== undefined
      ? opts.preRolled
      : rollSumBest(ctx, src, dice.n, opts.kind, times);
  if (total === 0 && opts.preRolled === undefined) {
    // tripwire fizzle: the whole attack fails
    return { amount: 0, usedColorBonus: false };
  }
  total += dice.plus;

  let usedColorBonus = false;
  if (opts.kind === "attack" && mods.colorBonusOverride !== undefined) {
    // WL-A: "all attacks do +6 instead of +1" — applies to every attack while
    // active, whatever the card color (designer's Q6 example).
    total += mods.colorBonusOverride;
    usedColorBonus = opts.withColorBonus;
  } else if (opts.withColorBonus && opts.kind === "attack") {
    // T5: the color bonus is only ever added to the standard attack;
    // ability formulas already bake it in (T6/M1).
    total += cls.colorBonus;
    usedColorBonus = true;
  } else if (mods.colorBonusOverride !== undefined && opts.kind === "ability") {
    // WL-A "all attacks do +6 instead of +1": upgrade baked-in bonus on abilities too.
    total += mods.colorBonusOverride - cls.colorBonus;
  }

  // Riders: KN-P exposed (consumed) and PR-3 guiding bolt (+1d6 each).
  for (const e of statusesByKey(s, tgt, "exposed")) {
    total += rollSum(ctx, src, 1, "misc");
    removeStatus(ctx, e, "triggered");
  }
  for (const _e of statusesByKey(s, tgt, "guidingBolt")) {
    total += rollSum(ctx, src, 1, "misc");
  }

  // Flat adds: rage etc. (dmgOutFlat), PA-P holy favor.
  total += mods.dmgOutFlat;
  const tgtClass = player(s, tgt).classId;
  if (cls.passive === "holyFavor" && tgtClass && !HOLY.includes(tgtClass)) total += 1;

  // Multipliers last (attacker-max): ZK-3 frenzy.
  for (const m of mods.dmgOutMults) total = Math.floor(total * m);

  return { amount: Math.max(0, total), usedColorBonus };
}

/**
 * Defender phase (Q16): given incoming damage and the defender's multipliers
 * (frenzy-taken, save-half) and flats (reductions), pick the ordering that
 * minimizes the result — "defender has priority on benefit".
 */
export function defenderMin(amount: number, mults: number[], flats: number[]): number {
  const items: Array<{ m?: number; f?: number }> = [
    ...mults.map((m) => ({ m })),
    ...flats.map((f) => ({ f })),
  ];
  if (items.length === 0) return Math.max(0, amount);
  if (items.length > 6) {
    // merge extra flats to keep the permutation space tiny
    const fs = items.filter((i) => i.f !== undefined);
    const ms = items.filter((i) => i.m !== undefined);
    const merged = fs.reduce((a, b) => a + (b.f ?? 0), 0);
    items.length = 0;
    items.push(...ms, { f: merged });
  }
  let best = Infinity;
  const perm = (rest: Array<{ m?: number; f?: number }>, v: number) => {
    if (rest.length === 0) {
      best = Math.min(best, v);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const it = rest[i];
      const next = [...rest.slice(0, i), ...rest.slice(i + 1)];
      const nv = it.m !== undefined ? Math.floor(v * it.m) : v + (it.f ?? 0);
      perm(next, Math.max(0, nv));
    }
  };
  perm(items, amount);
  return Math.max(0, best === Infinity ? amount : best);
}

/** PA-P: -1 taken from Holy attackers; KN-4 taunt: Knight takes half from the taunted. */
export function defenderContext(ctx: Ctx, src: PlayerId, tgt: PlayerId) {
  const s = ctx.s;
  const mods = modsFor(s, tgt);
  const mults = [...mods.dmgInMults];
  const flats: number[] = mods.dmgInFlat !== 0 ? [mods.dmgInFlat] : [];
  const tgtCls = player(s, tgt).classId;
  const srcCls = player(s, src).classId;
  if (tgtCls === "paladin" && srcCls && HOLY.includes(srcCls)) flats.push(-1);
  // KN-4: the attacker is taunted by tgt → tgt (the Knight) takes half.
  for (const e of statusesByKey(s, src, "taunt")) {
    if (e.source === tgt) mults.push(0.5);
  }
  return { mults, flats, hpFloor: mods.hpFloor };
}
