// GameState construction and shared helpers (no rules resolution here).

import { allCardIds, card, effectiveNumber } from "./cards.js";
import { classDef } from "./classes/index.js";
import { makeRng, shuffle } from "./rng.js";
import type {
  ClassDef,
  Color,
  Ctx,
  DurSpec,
  GameConfig,
  GameState,
  Op,
  PlayerId,
  PlayerState,
  StatusInst,
  StatusSpec,
} from "./types.js";

export function initialState(config: GameConfig, seed: string): GameState {
  if (config.players.length < 2 || config.players.length > 8) {
    throw new Error("Tetrad supports 2-8 players (S3)");
  }
  if (config.mode === "teams" && config.players.length !== 4) {
    throw new Error("teams mode requires exactly 4 players");
  }
  const s: GameState = {
    config,
    phase: "classSelect",
    rng: makeRng(seed),
    players: config.players.map((p, seat) => ({
      id: p.id,
      seat,
      classId: null,
      hp: 0,
      status: "active",
      hand: [],
      lastHitBy: null,
      pendingClass: null,
    })),
    turn: {
      activePlayer: config.players[(config.dealerSeat + 1) % config.players.length].id,
      direction: 1,
      hasDrawn: false,
      attacksUsed: 0,
      skipAttack: false,
      stolenBy: null,
      homefieldGiven: 0,
    },
    field: { activeColor: "red", activeNumber: null, pile: [], underPile: [] },
    drawPile: [],
    staging: [],
    effects: [],
    stack: [],
    pending: null,
    colorChangeCount: 0,
    turnCount: 0,
    nextId: 1,
    scratch: {},
    placements: [],
    deaths: [],
    winner: null,
  };
  // S2: shuffle and deal 7 each; S5: flip the initial field card.
  s.drawPile = shuffle(s, allCardIds());
  for (const p of s.players) {
    p.hand = s.drawPile.splice(0, 7);
  }
  const first = s.drawPile.pop()!;
  s.field.pile.push(first);
  const def = card(first);
  s.field.activeColor = def.color ?? "red"; // wild: dealer picks at reveal (S6)
  s.field.activeNumber = effectiveNumber(def);
  return s;
}

// ---------------------------------------------------------------------------
// Player helpers
// ---------------------------------------------------------------------------

export function player(s: GameState, id: PlayerId): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player: ${id}`);
  return p;
}

export function pclass(s: GameState, id: PlayerId): ClassDef {
  const p = player(s, id);
  if (!p.classId) throw new Error(`player ${id} has no class yet`);
  return classDef(p.classId);
}

export function isActive(s: GameState, id: PlayerId): boolean {
  return player(s, id).status === "active";
}

export function teamOf(s: GameState, id: PlayerId): number {
  return player(s, id).seat % 2; // S8: allies sit across (seats 0&2 vs 1&3)
}

export function areAllies(s: GameState, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return true;
  return s.config.mode === "teams" && teamOf(s, a) === teamOf(s, b);
}

export function enemiesOf(s: GameState, id: PlayerId): PlayerId[] {
  return s.players
    .filter((p) => p.status === "active" && !areAllies(s, id, p.id))
    .map((p) => p.id);
}

/** Seat-order walk from `from` in the current direction. */
export function seatOrderFrom(s: GameState, from: PlayerId): PlayerId[] {
  const n = s.players.length;
  const start = player(s, from).seat;
  const out: PlayerId[] = [];
  for (let i = 1; i <= n; i++) {
    const seat = (((start + i * s.turn.direction) % n) + n) % n;
    out.push(s.players.find((p) => p.seat === seat)!.id);
  }
  return out;
}

/** Next active player in play order (turn advancement). */
export function nextActivePlayer(s: GameState, from: PlayerId): PlayerId | null {
  for (const id of seatOrderFrom(s, from)) {
    if (isActive(s, id)) return id;
  }
  return null;
}

/**
 * T4/Q12: default standard-attack victim — next enemy in play order,
 * skipping untargetable players (PR-S banish).
 */
export function nextEnemy(s: GameState, from: PlayerId): PlayerId | null {
  for (const id of seatOrderFrom(s, from)) {
    if (!isActive(s, id)) continue;
    if (areAllies(s, from, id)) continue;
    if (modsFor(s, id).untargetable) continue;
    return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export function statusesOn(s: GameState, owner: PlayerId | "global"): StatusInst[] {
  return s.effects.filter((e) => e.owner === owner);
}

export function statusesByKey(s: GameState, owner: PlayerId, key: string): StatusInst[] {
  return s.effects.filter((e) => e.owner === owner && e.key === key);
}

/** Aggregate modifier view of everything sitting on a player. */
export function modsFor(s: GameState, id: PlayerId) {
  const agg = {
    dmgOutFlat: 0,
    dmgOutMults: [] as number[],
    dmgInFlat: 0,
    dmgInMults: [] as number[],
    colorBonusOverride: undefined as number | undefined,
    saveRolls: 1,
    attackAdvantage: false,
    noDamage: false,
    sanctuaryBypassDc: undefined as number | undefined,
    noIllEffects: false,
    untargetable: false,
    revealHand: false,
    hpFloor: 0,
    curses: 0,
    lifestealHalf: false,
  };
  for (const e of statusesOn(s, id)) {
    const m = e.mods;
    if (!m) continue;
    if (m.dmgOutFlat) agg.dmgOutFlat += m.dmgOutFlat;
    if (m.dmgOutMult) agg.dmgOutMults.push(m.dmgOutMult);
    if (m.dmgInFlat) agg.dmgInFlat += m.dmgInFlat;
    if (m.dmgInMult) agg.dmgInMults.push(m.dmgInMult);
    if (m.colorBonusOverride !== undefined) agg.colorBonusOverride = m.colorBonusOverride;
    if (m.saveRolls) agg.saveRolls = Math.max(agg.saveRolls, m.saveRolls);
    if (m.attackAdvantage) agg.attackAdvantage = true;
    if (m.noDamage) {
      agg.noDamage = true;
      if (m.sanctuaryBypassDc !== undefined) agg.sanctuaryBypassDc = m.sanctuaryBypassDc;
    }
    if (m.noIllEffects) agg.noIllEffects = true;
    if (m.untargetable) agg.untargetable = true;
    if (m.revealHand) agg.revealHand = true;
    if (m.hpFloor) agg.hpFloor = Math.max(agg.hpFloor, m.hpFloor);
    if (m.curse) agg.curses += 1;
    if (m.lifestealHalf) agg.lifestealHalf = true;
  }
  return agg;
}

export function hasRage(s: GameState, id: PlayerId): boolean {
  return statusesByKey(s, id, "rage").length > 0;
}

export function addStatus(
  ctx: Ctx,
  source: PlayerId,
  owner: PlayerId | "global",
  spec: StatusSpec
): StatusInst {
  const s = ctx.s;
  const inst: StatusInst = {
    id: `e${s.nextId++}`,
    key: spec.key,
    source,
    owner,
    mods: spec.mods,
    tick: spec.tick,
    armed: spec.armed ? { ...spec.armed } : undefined,
    ill: spec.ill,
    dur: resolveDur(s, spec.dur),
    data: { ...(spec.data ?? {}) },
  };
  s.effects.push(inst);
  ctx.events.push({
    type: "StatusApplied",
    status: spec.key,
    source,
    owner,
    id: inst.id,
  });
  return inst;
}

function resolveDur(s: GameState, d: DurSpec): StatusInst["dur"] {
  switch (d.kind) {
    case "colorChange":
      return { kind: "colorChange", at: s.colorChangeCount + (d.changes ?? 1) };
    case "endOfTurn":
      return { kind: "endOfTurn", turn: s.turnCount };
    case "sourceNextTurnEnd":
      return { kind: "sourceNextTurnEnd", createdTurn: s.turnCount };
    case "untilTriggered":
      return { kind: "untilTriggered" };
    case "rage":
      return { kind: "rage" };
    case "permanent":
      return { kind: "permanent" };
  }
}

export function removeStatus(ctx: Ctx, inst: StatusInst, reason: string): void {
  const i = ctx.s.effects.indexOf(inst);
  if (i >= 0) {
    ctx.s.effects.splice(i, 1);
    ctx.events.push({ type: "StatusExpired", status: inst.key, owner: inst.owner, reason });
  }
}

/** Consume one use of an armed status; removes it at 0. */
export function consumeArmed(ctx: Ctx, inst: StatusInst): void {
  if (inst.armed) {
    inst.armed.uses -= 1;
    if (inst.armed.uses <= 0) removeStatus(ctx, inst, "triggered");
  } else {
    removeStatus(ctx, inst, "triggered");
  }
}

// ---------------------------------------------------------------------------
// Color changes (A6) — the heart of Tetrad's duration system
// ---------------------------------------------------------------------------

export function changeColor(ctx: Ctx, newColor: Color, by: PlayerId, viaWild: boolean): boolean {
  const s = ctx.s;
  if (newColor === s.field.activeColor) {
    // Q18a: choosing the same color via a wild is NOT a color change.
    s.field.activeColor = newColor;
    return false;
  }
  s.field.activeColor = newColor;
  s.colorChangeCount += 1;
  ctx.events.push({ type: "ColorChanged", color: newColor, by, count: s.colorChangeCount });

  for (const e of [...s.effects]) {
    if (e.dur.kind !== "colorChange" || e.dur.at > s.colorChangeCount) continue;
    // Q21: rage continues if its owner changed the color back to the anchor.
    if (e.key === "rage" && e.owner === by && e.data.anchor === newColor) {
      e.dur.at = s.colorChangeCount + 1;
      ctx.events.push({ type: "RageContinued", owner: e.owner });
      continue;
    }
    // A6: the acting player's own effects persist until end of their turn.
    if (e.source === s.turn.activePlayer && (e.owner === e.source || e.owner === "global")) {
      e.dur.grace = true;
    } else {
      removeStatus(ctx, e, "colorChange");
    }
  }
  // TH-A Surprise!: the next player (other than the Thief — A5) to change
  // the color takes 1d6+7.
  for (const e of [...s.effects]) {
    if (e.armed?.on !== "colorChanged" || e.owner !== "global") continue;
    if (e.source === by) continue;
    if (player(s, e.source).status !== "active") continue;
    consumeArmed(ctx, e);
    pushSeq(ctx, [
      {
        t: "dmg",
        src: e.source,
        tgt: by,
        dice: { n: 1, plus: 7 },
        kind: "ability",
        hitId: newId(s, "h"),
      },
    ]);
  }
  cleanupRageLinked(ctx);
  return true;
}

/** Statuses with dur "rage" live only while their owner is raging. */
export function cleanupRageLinked(ctx: Ctx): void {
  for (const e of [...ctx.s.effects]) {
    if (e.dur.kind === "rage" && e.owner !== "global" && !hasRage(ctx.s, e.owner)) {
      removeStatus(ctx, e, "rageEnded");
    }
  }
}

// ---------------------------------------------------------------------------
// Ops / decision plumbing
// ---------------------------------------------------------------------------

/** Push ops so they execute in array order (stack is LIFO). */
export function pushSeq(ctx: Ctx, ops: Op[]): void {
  for (let i = ops.length - 1; i >= 0; i--) ctx.s.stack.push(ops[i]);
}

export function newId(s: GameState, prefix: string): string {
  return `${prefix}${s.nextId++}`;
}

// ---------------------------------------------------------------------------
// Card zone helpers
// ---------------------------------------------------------------------------

/** T10: refill the draw pile from the field pile (minus top) + under-pile. */
export function ensureDrawPile(ctx: Ctx): void {
  const s = ctx.s;
  if (s.drawPile.length > 0) return;
  const top = s.field.pile.pop();
  const recycled = [...s.field.pile, ...s.field.underPile];
  s.field.pile = top ? [top] : [];
  s.field.underPile = [];
  if (recycled.length === 0) return;
  s.drawPile = shuffle(s, recycled);
  ctx.events.push({ type: "DeckReshuffled", size: s.drawPile.length });
}

/** Remove a card from wherever it is in a player's hand. */
export function takeFromHand(s: GameState, id: PlayerId, cardId: string): void {
  const p = player(s, id);
  const i = p.hand.indexOf(cardId);
  if (i < 0) throw new Error(`card ${cardId} not in hand of ${id}`);
  p.hand.splice(i, 1);
}
