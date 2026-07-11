// Fuzz: drive random legal actions through whole games; assert invariants and
// byte-identical replays (the (seed, config, actions) tuple IS the game).

import { describe, expect, it } from "vitest";
import {
  applyAction,
  card,
  enemiesOf,
  initialState,
  legalActions,
  modsFor,
  actingPlayer,
  CLASSES,
  type Action,
  type ActionSpec,
  type ClassId,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "../src/index.js";

// local PRNG for choice-making (separate from the game's RNG)
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function targetPool(s: GameState, actor: PlayerId, who: string): PlayerId[] {
  const actives = s.players.filter((p) => p.status === "active").map((p) => p.id);
  switch (who) {
    case "dead":
      return s.players.filter((p) => p.status === "dead").map((p) => p.id);
    case "enemy":
      return enemiesOf(s, actor).filter((t) => !modsFor(s, t).untargetable);
    case "other":
      return actives.filter((t) => t !== actor && !modsFor(s, t).untargetable);
    default:
      return actives.filter((t) => t === actor || !modsFor(s, t).untargetable);
  }
}

function buildAction(s: GameState, rnd: () => number): Action | null {
  if (s.phase === "finished") return null;
  if (s.pending) {
    return {
      type: "decide",
      player: s.pending.decision.player,
      decisionId: s.pending.decision.id,
      choice: s.pending.decision.default,
    };
  }
  if (s.phase === "classSelect") {
    const p = s.players.find((x) => !x.pendingClass);
    if (!p) return null;
    return { type: "chooseClass", player: p.id, classId: pick(rnd, CLASS_IDS) };
  }
  const actor = actingPlayer(s);
  const specs = legalActions(s, actor);
  if (specs.length === 0) return null;

  const options: Action[] = [];
  for (const spec of specs) {
    const a = specToAction(s, actor, spec, rnd);
    if (!a) continue;
    if (a.type === "concede") {
      if (rnd() < 0.01) options.push(a);
      continue;
    }
    if (a.type === "playCard") {
      options.push(a, a, a); // prefer plays so games progress
    } else {
      options.push(a);
    }
  }
  if (options.length === 0) return null;
  return pick(rnd, options);
}

function specToAction(s: GameState, actor: PlayerId, spec: ActionSpec, rnd: () => number): Action | null {
  switch (spec.type) {
    case "drawCard":
      return { type: "drawCard", player: actor };
    case "endTurn":
      return { type: "endTurn", player: actor };
    case "concede":
      return { type: "concede", player: actor };
    case "anytime": {
      const p = s.players.find((x) => x.id === actor)!;
      const extra: Record<string, unknown> = {};
      if (p.classId === "priest") {
        const dead = s.players.filter((x) => x.status === "dead");
        if (dead.length > 0 && rnd() < 0.7) extra.revive = pick(rnd, dead).id;
        else extra.draw5 = pick(rnd, s.players.filter((x) => x.status === "active")).id;
      } else {
        extra.targets = [actor];
      }
      return rnd() < 0.15 ? { type: "anytime", player: actor, card: spec.card!, extra } : null;
    }
    case "playCard": {
      const a: Extract<Action, { type: "playCard" }> = { type: "playCard", player: actor, card: spec.card! };
      const needs = spec.needs ?? {};
      if (needs.targets) {
        const pool = targetPool(s, actor, needs.targets.who);
        const min = needs.targets.upTo ? 1 : needs.targets.count;
        if (pool.length < min) return null;
        const shuffled = [...pool].sort(() => rnd() - 0.5);
        a.targets = shuffled.slice(0, Math.min(needs.targets.count, pool.length));
        if (!needs.targets.upTo && a.targets.length < needs.targets.count) return null;
      }
      if (needs.chosenColor) {
        a.chosenColor = pick(rnd, ["red", "blue", "green", "yellow"] as const);
      }
      if (needs.extra === "declaredColor") {
        a.declaredColor = pick(rnd, ["red", "blue", "green", "yellow"] as const);
      }
      // ability-specific extras
      const def = card(spec.card!);
      const p = s.players.find((x) => x.id === actor)!;
      if (def.number === 0 && p.classId === "priest") {
        const dead = s.players.filter((x) => x.status === "dead");
        a.extra =
          dead.length > 0 && rnd() < 0.7
            ? { revive: pick(rnd, dead).id }
            : { draw5: pick(rnd, s.players.filter((x) => x.status === "active")).id };
      }
      if (def.number === 0 && p.classId === "thief") {
        const inPlay = s.players.filter((x) => x.status === "active" && x.classId).map((x) => x.classId!);
        const cls = CLASSES[pick(rnd, inPlay)];
        const keys = Object.keys(cls.abilities);
        a.extra = { copy: { classId: cls.id, key: pick(rnd, keys) } };
      }
      return a;
    }
    default:
      return null;
  }
}

function assertInvariants(s: GameState): void {
  const zones = [
    ...s.drawPile,
    ...s.field.pile,
    ...s.field.underPile,
    ...s.staging,
    ...s.players.flatMap((p) => p.hand),
  ];
  expect(zones.length, "card conservation").toBe(108);
  expect(new Set(zones).size, "no duplicated cards").toBe(108);
  for (const p of s.players) {
    expect(p.hp).toBeGreaterThanOrEqual(0);
    if (p.classId) expect(p.hp).toBeLessThanOrEqual(CLASSES[p.classId].maxHp);
  }
}

function runGame(seed: number, mode: "ffa" | "teams", maxSteps = 1500): { finished: boolean; log: Action[]; final: GameState } {
  const rnd = mulberry(seed);
  const config: GameConfig = {
    mode,
    players: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` })),
    dealerSeat: 0,
  };
  let s = initialState(config, `fuzz-${seed}`);
  const log: Action[] = [];
  for (let step = 0; step < maxSteps; step++) {
    if (s.phase === "finished") break;
    const action = buildAction(s, rnd);
    expect(action, `no action available at step ${step}`).not.toBeNull();
    const r = applyAction(s, action!);
    if (!r.ok) {
      throw new Error(`fuzz seed ${seed} step ${step}: ${r.error.code}: ${r.error.message} (${JSON.stringify(action)})`);
    }
    s = r.state;
    log.push(action!);
    if (step % 20 === 0) assertInvariants(s);
  }
  assertInvariants(s);
  return { finished: s.phase === "finished", log, final: s };
}

describe("fuzz", () => {
  it("plays random FFA games without illegal states", () => {
    let finished = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = runGame(seed, "ffa");
      if (r.finished) finished++;
    }
    expect(finished).toBeGreaterThan(0); // most random games should conclude
  });

  it("plays random team games without illegal states", () => {
    for (const seed of [11, 12]) {
      runGame(seed, "teams");
    }
  });

  it("replays are byte-identical (determinism)", () => {
    const { log, final } = runGame(42, "ffa", 600);
    // re-apply the recorded log against a fresh initial state
    const config: GameConfig = {
      mode: "ffa",
      players: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` })),
      dealerSeat: 0,
    };
    let s = initialState(config, "fuzz-42");
    for (const action of log) {
      const r = applyAction(s, action);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(JSON.stringify(s)).toBe(JSON.stringify(final));
  });
});
