// Effect interpreter: turns declarative EffectSpecs (class data) into ops, plus
// the registry of named custom handlers — the data-referenced escape hatch for
// bespoke abilities (§3.2). No op EXECUTION happens here; engine.ts drives.

import { card } from "./cards.js";
import { CLASSES } from "./classes/index.js";
import { attackerPhase, rollSum, saveRoll } from "./combat.js";
import { randInt } from "./rng.js";
import {
  addStatus,
  enemiesOf,
  ensureDrawPile,
  modsFor,
  newId,
  nextEnemy,
  player,
  pushSeq,
  removeStatus,
  seatOrderFrom,
  statusesByKey,
  statusesOn,
  takeFromHand,
} from "./state.js";
import type {
  Ctx,
  DecisionRequest,
  Dice,
  EffectSpec,
  Op,
  PlayerId,
  Sel,
  StatusInst,
} from "./types.js";

// ---------------------------------------------------------------------------
// fx dispatcher
// ---------------------------------------------------------------------------

export interface FxOpts {
  dot?: boolean; // tick-sourced damage counts as damage-over-time (ill effect)
  extra?: Record<string, unknown>;
  hitId?: string;
}

function resolveSel(actor: PlayerId, targets: PlayerId[], sel: Sel): PlayerId | undefined {
  switch (sel) {
    case "self":
      return actor;
    case "t0":
      return targets[0];
    case "t1":
      return targets[1];
    case "t2":
      return targets[2];
    default:
      return undefined;
  }
}

/** Compile an effect list into ops (executed in array order via pushSeq). */
export function fxOps(
  ctx: Ctx,
  actor: PlayerId,
  specs: EffectSpec[],
  targets: PlayerId[],
  opts: FxOpts = {}
): Op[] {
  const ops: Op[] = [];
  const hitId = opts.hitId ?? newId(ctx.s, "h");
  for (const spec of specs) {
    switch (spec.do) {
      case "damage": {
        if (spec.to === "allEnemies") {
          ops.push({
            t: "aoe",
            src: actor,
            dice: spec.dice,
            save: spec.save,
            dot: !!opts.dot,
            hitId,
          });
        } else {
          const tgt = resolveSel(actor, targets, spec.to);
          if (tgt) {
            ops.push({
              t: "dmg",
              src: actor,
              tgt,
              dice: spec.dice,
              kind: opts.dot ? "dot" : "ability",
              save: spec.save,
              rollTwice: spec.rollTwice,
              lifesteal: spec.lifesteal,
              hitId,
            });
          }
        }
        break;
      }
      case "heal": {
        const tgt = resolveSel(actor, targets, spec.to);
        if (tgt) ops.push({ t: "heal", src: actor, tgt, dice: spec.dice, exploding: spec.exploding });
        break;
      }
      case "stun": {
        const tgt = resolveSel(actor, targets, spec.to);
        if (tgt) ops.push({ t: "stunOp", src: actor, tgt, turns: spec.turns, save: spec.save });
        break;
      }
      case "draw": {
        const tgt = resolveSel(actor, targets, spec.who);
        if (tgt) ops.push({ t: "draw", p: tgt, n: spec.n, forced: spec.forced, src: actor });
        break;
      }
      case "applyStatus": {
        if (spec.to === "global") {
          ops.push({ t: "status", src: actor, tgt: "global", spec: spec.status });
        } else if (spec.to === "allEnemies") {
          for (const e of enemiesOf(ctx.s, actor)) {
            ops.push({ t: "status", src: actor, tgt: e, spec: spec.status });
          }
        } else {
          const tgt = resolveSel(actor, targets, spec.to);
          if (tgt) ops.push({ t: "status", src: actor, tgt, spec: spec.status });
        }
        break;
      }
      case "removeIllEffects": {
        const tgt = resolveSel(actor, targets, spec.to);
        if (tgt) ops.push({ t: "removeIll", tgt });
        break;
      }
      case "custom": {
        ops.push({
          t: "custom",
          key: spec.key,
          actor,
          targets,
          arg: spec.arg,
          extra: opts.extra ?? {},
          hitId,
          data: {},
        });
        break;
      }
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Negative-status classification (PR-7 / TH-9 removal)
// ---------------------------------------------------------------------------

const NEGATIVE_KEYS = new Set([
  "stunned",
  "taunt",
  "guidingBolt",
  "exposed",
  "tripwire",
  "blind",
  "cripple",
  "soulLink",
  "cursedEyes",
  "hex",
  "flameStrike",
  "dispel",
  "banished",
]);

export function isNegativeStatus(e: StatusInst): boolean {
  return !!e.ill || !!e.mods?.curse || NEGATIVE_KEYS.has(e.key);
}

// ---------------------------------------------------------------------------
// Custom handlers. Contract: handler(ctx, op, choice) may
//  - return { decision } to pause (engine re-invokes with the choice),
//  - push follow-up ops via pushSeq (they run right after this op),
//  - or just mutate state. Ops/decisions are plain data; state stays serializable.
// ---------------------------------------------------------------------------

type HandlerResult = { decision: DecisionRequest } | void;
type Handler = (ctx: Ctx, op: Op & Record<string, any>, choice: unknown) => HandlerResult;

function decision(
  ctx: Ctx,
  player: PlayerId,
  kind: string,
  prompt: string,
  def: unknown,
  options?: unknown[]
): { decision: DecisionRequest } {
  return {
    decision: { id: newId(ctx.s, "d"), player, kind, prompt, options, default: def },
  };
}

function firstEnemies(ctx: Ctx, actor: PlayerId, n: number): PlayerId[] {
  const out: PlayerId[] = [];
  for (const id of seatOrderFrom(ctx.s, actor)) {
    if (out.length >= n) break;
    if (player(ctx.s, id).status !== "active") continue;
    if (enemiesOf(ctx.s, actor).includes(id)) out.push(id);
  }
  return out;
}

export const CUSTOMS: Record<string, Handler> = {
  // ZK-A / ZK-I — rage anchored to the color active when it started (Q21)
  activateRage(ctx, op) {
    const { bonus, changes } = op.arg as { bonus: number; changes: number };
    addStatus(ctx, op.actor, op.actor, {
      key: "rage",
      dur: { kind: "colorChange", changes },
      mods: { dmgOutFlat: bonus },
      data: { anchor: ctx.s.field.activeColor },
    });
    ctx.events.push({ type: "RageActivated", player: op.actor, bonus });
  },

  // KN-0 — no damage for all chosen players until color change
  standBehindMe(ctx, op) {
    for (const tgt of op.targets as PlayerId[]) {
      if (player(ctx.s, tgt).status !== "active") continue;
      addStatus(ctx, op.actor, tgt, {
        key: "standBehindMe",
        dur: { kind: "colorChange" },
        mods: { noDamage: true },
      });
    }
  },

  // KN-I — four strikes of 1d6+1 (F3); each struck target draws 1 (Q13)
  multiAttack(ctx, op, choice) {
    const { strikes, dice } = op.arg as { strikes: number; dice: Dice };
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      const def = Array(strikes).fill(nextEnemy(ctx.s, op.actor) ?? op.actor);
      return decision(ctx, op.actor, "strikeTargets", `Choose ${strikes} strike targets`, def);
    }
    const picks = (choice as PlayerId[]).slice(0, strikes);
    const ops: Op[] = [];
    for (const tgt of picks) {
      if (player(ctx.s, tgt).status !== "active") continue;
      ops.push({ t: "dmg", src: op.actor, tgt, dice, kind: "ability", hitId: op.hitId });
      ops.push({ t: "draw", p: tgt, n: 1, forced: true, src: op.actor });
    }
    pushSeq(ctx, ops);
  },

  // WL-3 — Hex: duration extends by one color change per curse on the target
  hex(ctx, op) {
    const tgt = (op.targets as PlayerId[])[0];
    if (!tgt) return;
    const curses = modsFor(ctx.s, tgt).curses;
    addStatus(ctx, op.actor, tgt, {
      key: "hex",
      ill: true,
      dur: { kind: "colorChange", changes: 1 + curses },
      tick: [{ do: "damage", to: "t0", dice: { n: 1, plus: 1 } }],
    });
  },

  // WL-5 — curse + view/lock each Warlock turn (M10: hard lock, no allow-flow)
  cripplingCurse(ctx, op) {
    const tgt = (op.targets as PlayerId[])[0];
    if (!tgt) return;
    const inst = addStatus(ctx, op.actor, tgt, {
      key: "cripple",
      dur: { kind: "colorChange" },
      mods: { curse: true },
      data: { locked: null },
    });
    pushSeq(ctx, [{ t: "crippleView", eId: inst.id }]);
  },

  // WL-7 — take a card from the discard (field) pile
  darkLuck(ctx, op, choice) {
    const s = ctx.s;
    const options = s.field.pile.slice(0, -1); // top card stays in play
    if (options.length === 0) return;
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      return decision(ctx, op.actor, "pickCard", "Pick a card from the discard pile", options[0], options);
    }
    const picked = options.includes(choice as string) ? (choice as string) : options[0];
    s.field.pile.splice(s.field.pile.indexOf(picked), 1);
    const recipient = (op.targets as PlayerId[])[0] ?? op.actor;
    player(s, recipient).hand.push(picked);
    ctx.events.push({ type: "CardTaken", from: "discard", card: picked, to: recipient });
  },

  // SO-4 — tick: 1d6+3 to a random enemy (re-rolled each turn)
  tempestTick(ctx, op) {
    const enemies = enemiesOf(ctx.s, op.actor);
    if (enemies.length === 0) return;
    const tgt = enemies[randInt(ctx.s, enemies.length)];
    pushSeq(ctx, [
      { t: "dmg", src: op.actor, tgt, dice: { n: 1, plus: 3 }, kind: "dot", hitId: op.hitId },
    ]);
  },

  // SO-6 — reshuffle the field pile, flip a new card as if Sorcerer played it (Q26)
  whims(ctx, op) {
    const s = ctx.s;
    // move the whole field pile into the draw pile and shuffle
    s.drawPile.push(...s.field.pile);
    s.field.pile = [];
    // shuffle via state RNG
    for (let i = s.drawPile.length - 1; i > 0; i--) {
      const j = randInt(s, i + 1);
      [s.drawPile[i], s.drawPile[j]] = [s.drawPile[j], s.drawPile[i]];
    }
    const flipped = s.drawPile.pop();
    if (!flipped) return;
    ctx.events.push({ type: "WhimsFlip", card: flipped });
    pushSeq(ctx, [
      { t: "resolvePlay", actor: op.actor, cardId: flipped, viaWhims: true, auto: true },
    ]);
  },

  // SO-8 — chain lightning: full to t0, half to next enemy, third draws
  chainLightning(ctx, op) {
    const { dice } = op.arg as { dice: Dice };
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    const { amount } = attackerPhase(ctx, op.actor, t0, dice, {
      kind: "ability",
      withColorBonus: false,
    });
    const chain: PlayerId[] = [];
    for (const id of seatOrderFrom(ctx.s, t0)) {
      if (chain.length >= 2) break;
      if (player(ctx.s, id).status !== "active") continue;
      if (!enemiesOf(ctx.s, op.actor).includes(id)) continue;
      if (id === t0) continue;
      chain.push(id);
    }
    const ops: Op[] = [
      { t: "dmg", src: op.actor, tgt: t0, amount, kind: "ability", hitId: op.hitId },
    ];
    if (chain[0]) {
      ops.push({
        t: "dmg",
        src: op.actor,
        tgt: chain[0],
        amount: Math.floor(amount / 2),
        kind: "ability",
        hitId: op.hitId,
      });
    }
    if (chain[1]) ops.push({ t: "draw", p: chain[1], n: 1, forced: true, src: op.actor });
    pushSeq(ctx, ops);
  },

  // SO-0 — Wish: one roll, choices after seeing it (Q27)
  wish(ctx, op, choice) {
    const s = ctx.s;
    if (op.phase === undefined) {
      op.roll = rollSum(ctx, op.actor, 2, "misc");
      ctx.events.push({ type: "WishRolled", player: op.actor, roll: op.roll });
      const r = op.roll as number;
      op.bracket = r <= 4 ? "swap" : r <= 7 ? "healOrDamage" : r <= 10 ? "guard" : "any";
      if (op.bracket === "any") {
        op.phase = "pickBracket";
        return decision(ctx, op.actor, "wishOption", "Choose a wish", "healOrDamage", [
          "swap",
          "healOrDamage",
          "guard",
        ]);
      }
      op.phase = "params";
      return CUSTOMS.wish(ctx, op, undefined);
    }
    if (op.phase === "pickBracket") {
      op.bracket = ["swap", "healOrDamage", "guard"].includes(choice as string)
        ? choice
        : "healOrDamage";
      op.phase = "params";
      return CUSTOMS.wish(ctx, op, undefined);
    }
    if (op.phase === "params") {
      op.phase = "resolve";
      if (op.bracket === "swap") {
        const other = nextEnemy(s, op.actor) ?? op.actor;
        return decision(ctx, op.actor, "wishSwap", "Choose two players to swap hands", [
          op.actor,
          other,
        ]);
      }
      if (op.bracket === "healOrDamage") {
        return decision(ctx, op.actor, "wishHealDmg", "Heal 10d6+3 or deal 5d6+3, choose targets", {
          mode: "heal",
          targets: [op.actor],
        });
      }
      return decision(ctx, op.actor, "wishGuard", "Choose players to take 3 less damage", [op.actor]);
    }
    // resolve
    if (op.bracket === "swap") {
      const [a, b] = (choice as PlayerId[]) ?? [];
      if (a && b && a !== b) {
        const pa = player(s, a);
        const pb = player(s, b);
        [pa.hand, pb.hand] = [pb.hand, pa.hand];
        ctx.events.push({ type: "HandsSwapped", a, b });
      }
      return;
    }
    if (op.bracket === "healOrDamage") {
      const c = (choice as { mode: string; targets: PlayerId[] }) ?? { mode: "heal", targets: [op.actor] };
      const targets = (c.targets ?? []).filter((t) => player(s, t).status === "active");
      if (c.mode === "damage") {
        const roll = rollSum(ctx, op.actor, 5, "ability") + 3;
        s.scratch.suppressGrantAttack = true; // A3: the ability dealt damage
        pushSeq(
          ctx,
          targets
            .filter((t) => t !== op.actor)
            .map((t) => ({ t: "dmg", src: op.actor, tgt: t, amount: roll, kind: "ability", hitId: op.hitId }))
        );
      } else {
        const roll = rollSum(ctx, op.actor, 10, "heal") + 3;
        pushSeq(ctx, targets.map((t) => ({ t: "heal", src: op.actor, tgt: t, amount: roll })));
      }
      return;
    }
    for (const t of ((choice as PlayerId[]) ?? []).filter((t) => player(s, t).status === "active")) {
      addStatus(ctx, op.actor, t, {
        key: "wishGuard",
        dur: { kind: "colorChange" },
        mods: { dmgInFlat: -3 },
      });
    }
  },

  // SO-C — Dispel Magic
  dispel(ctx, op, choice) {
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    if (op.phase === undefined) {
      const roll = rollSum(ctx, op.actor, 2, "misc");
      if (roll === 7) {
        op.phase = "pick";
        return decision(ctx, op.actor, "dispelBranch", "Negate next special or numbered ability?", "special", [
          "special",
          "number",
        ]);
      }
      op.branch = roll <= 6 ? "special" : "number";
    } else {
      op.branch = choice === "number" ? "number" : "special";
    }
    addStatus(ctx, op.actor, t0, {
      key: "dispel",
      dur: { kind: "untilTriggered" },
      data: { branch: op.branch },
    });
  },

  // SO-R — Fate Maker: draw 2, assign each; 8 damage per card received
  fateMaker(ctx, op, choice) {
    const s = ctx.s;
    if (op.phase !== "assign") {
      op.phase = "assign";
      op.cards = [];
      op.picks = [];
      for (let i = 0; i < 2; i++) {
        ensureDrawPile(ctx);
        if (s.drawPile.length === 0) break;
        op.cards.push(s.drawPile.pop());
      }
      s.staging.push(...(op.cards as string[]));
    } else if (choice !== undefined) {
      const ok = s.players.some((p) => p.id === choice && p.status === "active");
      (op.picks as PlayerId[]).push(ok ? (choice as PlayerId) : (op.actor as PlayerId));
    }
    const cards = op.cards as string[];
    const picks = op.picks as PlayerId[];
    if (picks.length < cards.length) {
      // one decision per card so both may go to the same player
      const c = card(cards[picks.length]);
      const label = `${c.color ?? "wild"} ${c.number ?? c.kind}`;
      const opts = s.players.filter((p) => p.status === "active").map((p) => p.id);
      return decision(
        ctx,
        op.actor,
        "fateAssign",
        `Fate Maker: give the drawn ${label} (${picks.length + 1} of ${cards.length}) to whom? (8 dmg per card unless you keep it)`,
        op.actor,
        opts
      );
    }
    const counts = new Map<PlayerId, number>();
    cards.forEach((c, i) => {
      const to =
        picks[i] && player(s, picks[i]).status === "active" ? picks[i] : (op.actor as PlayerId);
      s.staging.splice(s.staging.indexOf(c), 1);
      player(s, to).hand.push(c);
      ctx.events.push({ type: "CardGiven", card: c, to, by: op.actor, private: [op.actor, to] });
      counts.set(to, (counts.get(to) ?? 0) + 1);
    });
    const ops: Op[] = [];
    for (const [to, n] of counts) {
      if (to === op.actor) continue; // Sorcerer keeps damage-free
      ops.push({ t: "dmg", src: op.actor, tgt: to, amount: 8 * n, kind: "ability", hitId: op.hitId });
    }
    pushSeq(ctx, ops);
  },

  // SO-I — Fireball: 30 split equally, then each draws 2 (replaces draw-4)
  fireball(ctx, op) {
    const { total, draw } = op.arg as { total: number; draw: number };
    const enemies = enemiesOf(ctx.s, op.actor);
    if (enemies.length === 0) return;
    const per = Math.floor(total / enemies.length);
    let rem = total - per * enemies.length;
    const ops: Op[] = [];
    for (const e of enemies) {
      const amt = per + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      ops.push({ t: "dmg", src: op.actor, tgt: e, amount: amt, kind: "ability", hitId: op.hitId });
    }
    for (const e of enemies) ops.push({ t: "draw", p: e, n: draw, forced: true, src: op.actor });
    pushSeq(ctx, ops);
  },

  // TH-5 — blind-pick a card from the target, give one back
  fingerDiscount(ctx, op, choice) {
    const s = ctx.s;
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    const victim = player(s, t0);
    const me = player(s, op.actor);
    if (victim.hand.length === 0 || me.hand.length === 0) return;
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      return decision(ctx, op.actor, "fingerDiscount", "Pick a slot to steal and a card to give", {
        takeIndex: 0,
        giveCard: me.hand[0],
      });
    }
    const c = (choice as { takeIndex: number; giveCard: string }) ?? { takeIndex: 0, giveCard: me.hand[0] };
    const idx = Math.min(Math.max(0, c.takeIndex ?? 0), victim.hand.length - 1);
    const taken = victim.hand.splice(idx, 1)[0];
    const give = me.hand.includes(c.giveCard) ? c.giveCard : me.hand[0];
    takeFromHand(s, op.actor, give);
    me.hand.push(taken);
    victim.hand.push(give);
    ctx.events.push({ type: "CardsSwapped", a: op.actor, b: t0, private: [op.actor, t0], taken, gave: give });
  },

  // TH-9 — remove an ill effect or arm a prevention
  disarmTrap(ctx, op) {
    const t0 = (op.targets as PlayerId[])[0] ?? op.actor;
    const bad = statusesOn(ctx.s, t0).find(isNegativeStatus);
    if (bad) {
      removeStatus(ctx, bad, "disarmed");
    } else {
      addStatus(ctx, op.actor, t0, {
        key: "preventIll",
        dur: { kind: "untilTriggered" },
        armed: { on: "illEffectIncoming", key: "preventIll", uses: 1 },
      });
    }
  },

  // TH-0 — copy any ability of any class in play (Q29)
  copycat(ctx, op) {
    const s = ctx.s;
    const copy = (op.extra as any)?.copy as
      | { classId: string; key: string; targets?: PlayerId[] }
      | undefined;
    const inPlay = new Set(s.players.filter((p) => p.status === "active").map((p) => p.classId));
    const cls = copy && inPlay.has(copy.classId as any) ? CLASSES[copy.classId as keyof typeof CLASSES] : undefined;
    const ability = cls?.abilities[copy!.key as keyof typeof cls.abilities];
    if (!cls || !ability) {
      ctx.events.push({ type: "CopycatFizzled", player: op.actor });
      return;
    }
    const want = ability.targets?.count ?? 0;
    const targets =
      copy!.targets && copy!.targets.length > 0
        ? copy!.targets
        : firstEnemies(ctx, op.actor, Math.max(1, want));
    ctx.events.push({ type: "AbilityCopied", player: op.actor, classId: cls.id, key: copy!.key });
    pushSeq(ctx, fxOps(ctx, op.actor, ability.effects, targets, { extra: op.extra as any }));
  },

  // TH-S — Rigged Game: color guess or a 2-turn stun
  riggedGame(ctx, op, choice) {
    const s = ctx.s;
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    const me = player(s, op.actor);
    if (op.phase === undefined) {
      if (me.hand.length === 0) {
        pushSeq(ctx, [{ t: "stunOp", src: op.actor, tgt: t0, turns: 1 }]);
        return;
      }
      op.phase = "picked";
      return decision(ctx, op.actor, "pickCard", "Pick the card for the game", me.hand[0], [...me.hand]);
    }
    if (op.phase === "picked") {
      op.card = me.hand.includes(choice as string) ? choice : me.hand[0];
      op.phase = "guess";
      return decision(ctx, t0, "guessColor", "Guess the color", "red", ["red", "blue", "green", "yellow"]);
    }
    const real = card(op.card as string).color;
    if (choice === real) {
      takeFromHand(s, op.actor, op.card as string);
      player(s, t0).hand.push(op.card as string);
      ctx.events.push({ type: "RiggedGameWon", by: t0, card: op.card });
      pushSeq(ctx, [{ t: "stunOp", src: op.actor, tgt: t0, turns: 1 }]);
    } else {
      ctx.events.push({ type: "RiggedGameLost", by: t0, guess: choice, real });
      pushSeq(ctx, [{ t: "stunOp", src: op.actor, tgt: t0, turns: 2 }]);
    }
  },

  // TH-R — target draws 1 (instead of 2); Thief may gift a card
  sleightOfHand(ctx, op) {
    const s = ctx.s;
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    pushSeq(ctx, [{ t: "draw", p: t0, n: 1, forced: true, src: op.actor }]);
    const give = (op.extra as any)?.giveCard as string | undefined;
    if (give && player(s, op.actor).hand.includes(give)) {
      takeFromHand(s, op.actor, give);
      player(s, t0).hand.push(give);
      ctx.events.push({ type: "CardGiven", card: give, to: t0, by: op.actor, private: [op.actor, t0] });
    }
  },

  // SC-4 — Prepared: draw 2, discard 2, redirect next ill effect
  prepared(ctx, op, choice) {
    const s = ctx.s;
    if (op.phase === undefined) {
      op.phase = "drawn";
      pushSeq(ctx, [
        { t: "draw", p: op.actor, n: 2 },
        { t: "custom", key: "prepared", actor: op.actor, targets: op.targets, arg: op.arg, extra: op.extra, hitId: op.hitId, data: {}, phase: "drawn" },
      ]);
      // replace this op with the sequenced pair; nothing else to do now
      op.phase = "noop";
      return;
    }
    if (op.phase === "noop") return;
    if (op.phase === "drawn" && choice === undefined) {
      const hand = player(s, op.actor).hand;
      return decision(ctx, op.actor, "discard2", "Discard 2 cards", hand.slice(0, 2), [...hand]);
    }
    const hand = player(s, op.actor).hand;
    const picks = ((choice as string[]) ?? []).filter((c) => hand.includes(c)).slice(0, 2);
    while (picks.length < Math.min(2, hand.length)) {
      const c = hand.find((x) => !picks.includes(x));
      if (!c) break;
      picks.push(c);
    }
    for (const c of picks) {
      takeFromHand(s, op.actor, c);
      s.field.underPile.push(c); // SP7: discards go under the field pile
    }
    ctx.events.push({ type: "CardsDiscarded", player: op.actor, count: picks.length });
    addStatus(ctx, op.actor, op.actor, {
      key: "redirectIll",
      dur: { kind: "untilTriggered" },
      armed: { on: "illEffectIncoming", key: "redirectIll", uses: 1 },
    });
  },

  // SC-6 — Twinshot: one target, or the total split between two
  twinshot(ctx, op) {
    const { dice } = op.arg as { dice: Dice };
    const targets = (op.targets as PlayerId[]).filter((t) => player(ctx.s, t).status === "active");
    if (targets.length === 0) return;
    const { amount } = attackerPhase(ctx, op.actor, targets[0], dice, {
      kind: "ability",
      withColorBonus: false,
    });
    if (targets.length === 1) {
      pushSeq(ctx, [{ t: "dmg", src: op.actor, tgt: targets[0], amount, kind: "ability", hitId: op.hitId }]);
    } else {
      const a = Math.ceil(amount / 2);
      const b = Math.floor(amount / 2);
      pushSeq(ctx, [
        { t: "dmg", src: op.actor, tgt: targets[0], amount: a, kind: "ability", hitId: op.hitId },
        { t: "dmg", src: op.actor, tgt: targets[1], amount: b, kind: "ability", hitId: op.hitId },
      ]);
    }
  },

  // SC-8 — Ricochet: t0 takes damage + a card from Scout's hand (Q30);
  // the next enemy draws 2; the one after draws 1.
  ricochet(ctx, op, choice) {
    const s = ctx.s;
    const { dice } = op.arg as { dice: Dice };
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    const myHand = player(s, op.actor).hand;
    if (op.phase === undefined && myHand.length > 0) {
      op.phase = "gift";
      return decision(ctx, op.actor, "giveCard", "Give a card to the first target", myHand[0], [...myHand]);
    }
    let gift: string | undefined;
    if (op.phase === "gift") {
      gift = myHand.includes(choice as string) ? (choice as string) : myHand[0];
    }
    const rest: PlayerId[] = [];
    for (const id of seatOrderFrom(s, t0)) {
      if (rest.length >= 2) break;
      if (player(s, id).status !== "active") continue;
      if (!enemiesOf(s, op.actor).includes(id) || id === t0) continue;
      rest.push(id);
    }
    const ops: Op[] = [{ t: "dmg", src: op.actor, tgt: t0, dice, kind: "ability", hitId: op.hitId }];
    if (rest[0]) ops.push({ t: "draw", p: rest[0], n: 2, forced: true, src: op.actor });
    if (rest[1]) ops.push({ t: "draw", p: rest[1], n: 1, forced: true, src: op.actor });
    pushSeq(ctx, ops);
    if (gift) {
      takeFromHand(s, op.actor, gift);
      player(s, t0).hand.push(gift);
      ctx.events.push({ type: "CardGiven", card: gift, to: t0, by: op.actor, private: [op.actor, t0] });
    }
  },

  // SC-R — Misdirection: both swap 1 card, then fight with color bonus
  misdirection(ctx, op, choice) {
    const s = ctx.s;
    const [a, b] = op.targets as PlayerId[];
    if (!a || !b || a === b) return;
    if (op.phase === undefined) {
      op.phase = "aPick";
      const ha = player(s, a).hand;
      if (ha.length === 0) {
        op.phase = "bPick";
        return CUSTOMS.misdirection(ctx, op, undefined);
      }
      return decision(ctx, a, "giveCard", "Choose a card to swap", ha[0], [...ha]);
    }
    if (op.phase === "aPick") {
      const ha = player(s, a).hand;
      op.cardA = ha.includes(choice as string) ? choice : ha[0];
      op.phase = "bPick";
      return CUSTOMS.misdirection(ctx, op, undefined);
    }
    if (op.phase === "bPick" && choice === undefined) {
      const hb = player(s, b).hand;
      if (hb.length === 0) {
        op.phase = "fight";
        return CUSTOMS.misdirection(ctx, op, null);
      }
      return decision(ctx, b, "giveCard", "Choose a card to swap", hb[0], [...hb]);
    }
    if (op.phase === "bPick") {
      const hb = player(s, b).hand;
      op.cardB = hb.includes(choice as string) ? choice : hb[0];
      op.phase = "fight";
    }
    // swap
    if (op.cardA && op.cardB) {
      takeFromHand(s, a, op.cardA as string);
      takeFromHand(s, b, op.cardB as string);
      player(s, a).hand.push(op.cardB as string);
      player(s, b).hand.push(op.cardA as string);
      ctx.events.push({ type: "CardsSwapped", a, b, private: [a, b] });
    }
    pushSeq(ctx, [
      { t: "attack", attacker: a, target: b, free: true, forceColor: true },
      { t: "attack", attacker: b, target: a, free: true, forceColor: true },
    ]);
  },

  // SC-I — Mastermind: stack the top of the deck (returns are raw draws, M8)
  mastermind(ctx, op, choice) {
    const s = ctx.s;
    const { n } = op.arg as { n: number };
    if (op.phase !== "arrange") {
      op.phase = "arrange";
      op.cards = [];
      for (let i = 0; i < n; i++) {
        ensureDrawPile(ctx);
        if (s.drawPile.length === 0) break;
        op.cards.push(s.drawPile.pop());
      }
      s.staging.push(...(op.cards as string[]));
      if ((op.cards as string[]).length === 0) return;
      return decision(ctx, op.actor, "arrange", "Arrange these on top of the deck", [
        ...(op.cards as string[]),
      ]);
    }
    const cards = op.cards as string[];
    let order = (choice as string[]) ?? cards;
    if (order.length !== cards.length || !cards.every((c) => order.includes(c))) order = cards;
    for (const c of order) s.staging.splice(s.staging.indexOf(c), 1);
    // order[0] should be drawn first → push last (top of pile = end)
    for (let i = order.length - 1; i >= 0; i--) s.drawPile.push(order[i]);
    ctx.events.push({ type: "DeckStacked", by: op.actor, count: order.length });
  },

  // PR-7 helper — arm ill-effect prevention on each chosen target
  preventIll(ctx, op) {
    for (const tgt of op.targets as PlayerId[]) {
      if (!tgt || player(ctx.s, tgt).status !== "active") continue;
      addStatus(ctx, op.actor, tgt, {
        key: "preventIll",
        dur: { kind: "untilTriggered" },
        armed: { on: "illEffectIncoming", key: "preventIll", uses: 1 },
      });
    }
  },

  // PR-9 — split 30 HP among up to 3 targets
  preserveLife(ctx, op) {
    const { pool } = op.arg as { pool: number };
    const targets = (op.targets as PlayerId[]).filter((t) => t && player(ctx.s, t).status === "active");
    if (targets.length === 0) return;
    const alloc = ((op.extra as any)?.allocation as number[]) ?? [];
    const amounts: number[] = [];
    let used = 0;
    for (let i = 0; i < targets.length; i++) {
      let a = alloc[i] ?? Math.floor(pool / targets.length);
      a = Math.max(0, Math.min(a, pool - used));
      amounts.push(a);
      used += a;
    }
    if (used < pool) amounts[0] += pool - used;
    pushSeq(
      ctx,
      targets.map((t, i) => ({ t: "heal", src: op.actor, tgt: t, amount: amounts[i] }))
    );
  },

  // PR-0 — revive (C6) and/or force a draw of 5 (C7 interrupt)
  divineIntervention(ctx, op) {
    const s = ctx.s;
    const extra = (op.extra as any) ?? {};
    const ops: Op[] = [];
    if (extra.revive) {
      const p = player(s, extra.revive);
      if (p.status === "dead") ops.push({ t: "revive", p: p.id });
    }
    if (extra.draw5) {
      const p = player(s, extra.draw5);
      if (p.status === "active") ops.push({ t: "draw", p: p.id, n: 5, forced: true, src: op.actor });
    }
    pushSeq(ctx, ops);
  },

  // PR-S — Banish
  banish(ctx, op) {
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    pushSeq(ctx, [
      { t: "stunOp", src: op.actor, tgt: t0, turns: 2, save: { dc: 8, reduceTo: 1 }, banish: true },
    ]);
  },

  // PR-R — Pray: heal targets receive the rally draws; yellows boost (Q33/F4)
  pray(ctx, op) {
    const s = ctx.s;
    const { dice } = op.arg as { dice: Dice };
    const targets = (op.targets as PlayerId[]).filter((t) => player(s, t).status === "active");
    if (targets.length === 0) return;
    const per = targets.length === 1 ? 2 : 1; // F4
    if (op.phase === undefined) {
      op.phase = "healed";
      const ops: Op[] = [];
      for (const t of targets) {
        const sk = newId(s, "pray");
        (op.keys ??= []).push(sk);
        ops.push({ t: "draw", p: t, n: per, sk });
      }
      ops.push({ ...op, phase: "healed" });
      pushSeq(ctx, ops);
      op.phase = "noop";
      return;
    }
    if (op.phase === "noop") return;
    const ops: Op[] = [];
    targets.forEach((t, i) => {
      const drawn = ((s.scratch[(op.keys as string[])[i]] as string[]) ?? []).map((c) => card(c));
      const yellows = drawn.filter((c) => c.color === "yellow").length;
      const times = 1 + yellows;
      const amount = rollSum(ctx, op.actor, dice.n * times, "heal") + dice.plus * times;
      ops.push({ t: "heal", src: op.actor, tgt: t, amount });
    });
    pushSeq(ctx, ops);
  },

  // PR-I tick — 1d6+4 to all enemies, save 9 each turn for half (Q20)
  guardianTick(ctx, op) {
    const { dice, save } = op.arg as { dice: Dice; save: number };
    const enemies = enemiesOf(ctx.s, op.actor);
    if (enemies.length === 0) return;
    const roll = rollSum(ctx, op.actor, dice.n, "ability") + dice.plus;
    pushSeq(
      ctx,
      enemies.map((e) => ({
        t: "dmg",
        src: op.actor,
        tgt: e,
        amount: roll,
        kind: "dot",
        save: { dc: save, onPass: "half" },
        hitId: op.hitId,
      }))
    );
  },

  // PA-2 — Lay on Hands: split the heal between self and target (Q34)
  layOnHands(ctx, op, choice) {
    const { dice } = op.arg as { dice: Dice };
    const t0 = (op.targets as PlayerId[])[0] ?? op.actor;
    if (op.phase === undefined) {
      op.roll = rollSum(ctx, op.actor, dice.n, "heal") + dice.plus;
      if (t0 === op.actor) {
        pushSeq(ctx, [{ t: "heal", src: op.actor, tgt: op.actor, amount: op.roll }]);
        return;
      }
      op.phase = "split";
      return decision(ctx, op.actor, "healSplit", `Split ${op.roll} healing (amount to target)`, op.roll);
    }
    const total = op.roll as number;
    const toTarget = Math.max(0, Math.min(total, Number(choice ?? total)));
    const ops: Op[] = [];
    if (toTarget > 0) ops.push({ t: "heal", src: op.actor, tgt: t0, amount: toTarget });
    if (total - toTarget > 0) ops.push({ t: "heal", src: op.actor, tgt: op.actor, amount: total - toTarget });
    pushSeq(ctx, ops);
  },

  // PA-C — Golden Rule
  goldenRule(ctx, op) {
    const t0 = (op.targets as PlayerId[])[0] ?? op.actor;
    pushSeq(ctx, [{ t: "heal", src: op.actor, tgt: op.actor, amount: 5 }]);
    addStatus(ctx, op.actor, t0, {
      key: "goldenGuard",
      dur: { kind: "untilTriggered" },
      armed: { on: "attackIncoming", key: "goldenBlock", uses: 1 },
    });
  },

  // PA-0 — save 9 or lose the turn
  saveOrStun(ctx, op) {
    const { dc } = op.arg as { dc: number };
    const ops: Op[] = [];
    for (const e of enemiesOf(ctx.s, op.actor)) {
      if (!saveRoll(ctx, e, dc)) {
        ops.push({ t: "stunOp", src: op.actor, tgt: e, turns: 1 });
      }
    }
    pushSeq(ctx, ops);
  },

  // PA-A tick — Flame Strike: 1d6, movable once per turn to the closest enemy
  flameTick(ctx, op, choice) {
    const s = ctx.s;
    const inst = s.effects.find((e) => e.id === op.eId);
    if (!inst || inst.owner === "global") return;
    if (op.phase === undefined) {
      // closest other enemy by seat distance from the current owner
      const enemies = enemiesOf(s, inst.source).filter((e) => e !== inst.owner);
      if (enemies.length > 0) {
        const ownerSeat = player(s, inst.owner as string).seat;
        const n = s.players.length;
        enemies.sort((x, y) => {
          const dx = Math.min(Math.abs(player(s, x).seat - ownerSeat), n - Math.abs(player(s, x).seat - ownerSeat));
          const dy = Math.min(Math.abs(player(s, y).seat - ownerSeat), n - Math.abs(player(s, y).seat - ownerSeat));
          return dx - dy;
        });
        op.phase = "moved";
        return decision(ctx, inst.source, "flameMove", "Move Flame Strike?", inst.owner, [
          inst.owner,
          enemies[0],
        ]);
      }
      op.phase = "moved";
      choice = inst.owner;
    }
    const dest = typeof choice === "string" && player(s, choice).status === "active" ? choice : (inst.owner as string);
    if (dest !== inst.owner) {
      inst.owner = dest;
      ctx.events.push({ type: "FlameStrikeMoved", to: dest });
    }
    pushSeq(ctx, [
      { t: "dmg", src: inst.source, tgt: inst.owner, dice: { n: 1, plus: 0 }, kind: "dot", hitId: op.hitId },
    ]);
  },

  // PA-R — 1d6+4 to target, +1d6+4 per yellow among the rally draws
  paladinRally(ctx, op) {
    const s = ctx.s;
    const { dice } = op.arg as { dice: Dice };
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0 || player(s, t0).status !== "active") return;
    const drawn = ((s.scratch.rallyDrawn as string[]) ?? []).map((c) => card(c));
    const yellows = drawn.filter((c) => c.color === "yellow").length;
    const times = 1 + yellows;
    const amount = rollSum(ctx, op.actor, dice.n * times, "ability") + dice.plus * times;
    pushSeq(ctx, [{ t: "dmg", src: op.actor, tgt: t0, amount, kind: "ability", hitId: op.hitId }]);
  },

  // PA-I — Zone of Truth
  zoneOfTruth(ctx, op) {
    const s = ctx.s;
    const t0 = (op.targets as PlayerId[])[0];
    if (!t0) return;
    const reveal = ((op.extra as any)?.reveal as { mode: string; value: unknown }) ?? {
      mode: "color",
      value: "red",
    };
    const hand = player(s, t0).hand.map((c) => card(c));
    const matched = hand.filter((c) =>
      reveal.mode === "color" ? c.color === reveal.value : String(c.number ?? c.kind) === String(reveal.value)
    );
    ctx.events.push({
      type: "CardsRevealed",
      from: t0,
      to: op.actor,
      cards: matched.map((c) => c.id),
      private: [op.actor, t0],
    });
  },
};
