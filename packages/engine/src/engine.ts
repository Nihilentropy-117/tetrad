// The op machine: applyAction validates a player action, converts it to ops,
// and drains the stack until input is needed (state.pending) or it's empty.
// Every op is serializable data; handlers live in the table at the bottom.

import { card, effectiveNumber, isWild, matchesField } from "./cards.js";
import { attackerPhase, colorBonusApplies, defenderContext, defenderMin, rollExploding, rollSum, saveRoll } from "./combat.js";
import { CUSTOMS, fxOps, isNegativeStatus } from "./effects.js";
import { randInt } from "./rng.js";
import {
  addStatus,
  changeColor,
  cleanupRageLinked,
  consumeArmed,
  enemiesOf,
  ensureDrawPile,
  hasRage,
  modsFor,
  newId,
  nextActivePlayer,
  nextEnemy,
  pclass,
  player,
  pushSeq,
  removeStatus,
  seatOrderFrom,
  statusesByKey,
  statusesOn,
  takeFromHand,
} from "./state.js";
import { COLORS } from "./types.js";
import type {
  AbilityKey,
  AbilitySpec,
  Action,
  CardDef,
  ClassDef,
  Ctx,
  DecisionRequest,
  GameEvent,
  GameState,
  Op,
  PlayerId,
  Reply,
  TargetSpec,
} from "./types.js";

export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RuleError(code, message);
}

// ---------------------------------------------------------------------------
// Ability lookup (A1)
// ---------------------------------------------------------------------------

export function abilityKeyFor(cls: ClassDef, def: CardDef): AbilityKey | null {
  switch (def.kind) {
    case "number":
      if (def.number === 0) return "0"; // SP6/Q15: any color 0
      if (def.color !== cls.color) return null;
      if ((def.number! % 2 === 1) !== (cls.parity === "odd")) return null;
      return String(def.number) as AbilityKey;
    case "stun": // D2: stun is odd
      return cls.parity === "odd" && def.color === cls.color ? "stun" : null;
    case "counter": // D2: counter is even
      return cls.parity === "even" && def.color === cls.color ? "counter" : null;
    case "rally": // Q7: not parity-gated
      return def.color === cls.color ? "rally" : null;
    case "advantage":
      return "advantage";
    case "inspiration":
      return "inspiration";
  }
}

export function abilityFor(
  s: GameState,
  actor: PlayerId,
  def: CardDef
): { key: AbilityKey; spec: AbilitySpec; targets?: TargetSpec } | null {
  const cls = pclass(s, actor);
  const key = abilityKeyFor(cls, def);
  if (!key) return null;
  const spec = cls.abilities[key];
  if (!spec) return null;
  const raging = hasRage(s, actor) ? spec.raging : undefined;
  return { key, spec, targets: raging?.targets ?? spec.targets };
}

export function isCardLocked(s: GameState, actor: PlayerId, cardId: string): boolean {
  return s.effects.some((e) => e.key === "cripple" && e.owner === actor && e.data.locked === cardId);
}

export function canPlayCard(s: GameState, actor: PlayerId, cardId: string): boolean {
  const def = card(cardId);
  if (isCardLocked(s, actor, cardId)) return false;
  if (isWild(def)) return true;
  if (matchesField(def, s.field.activeColor, s.field.activeNumber)) return true;
  // TH-I: chameleon lets the next play declare any color
  return statusesByKey(s, actor, "chameleon").length > 0;
}

/** The player who acts this turn (WL-I Delirium may steal it). */
export function actingPlayer(s: GameState): PlayerId {
  return s.turn.stolenBy ?? s.turn.activePlayer;
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

function autofillTargets(ctx: Ctx, actor: PlayerId, spec: TargetSpec | undefined): PlayerId[] {
  if (!spec) return [];
  if (spec.who === "dead") {
    return ctx.s.players.filter((p) => p.status === "dead").slice(0, spec.count).map((p) => p.id);
  }
  return firstEnemies(ctx, actor, spec.count);
}

// ---------------------------------------------------------------------------
// SO-C Dispel Magic (M15)
// ---------------------------------------------------------------------------

/** True if the card currently resolving is dispelled against `tgt`: `src`
 * played a qualifying card and `tgt` carries the ward. Consumes the status on
 * the first blocked effect; the whole card stays negated against `tgt`. */
function dispelBlocks(ctx: Ctx, src: PlayerId, tgt: PlayerId): boolean {
  const arms = ctx.s.scratch.dispelArms as
    | { id: string; owner: PlayerId; actor: PlayerId; card: string }[]
    | undefined;
  const arm = arms?.find((a) => a.actor === src && a.owner === tgt);
  if (!arm) return false;
  const st = ctx.s.effects.find((e) => e.id === arm.id);
  if (st) {
    removeStatus(ctx, st, "triggered");
    ctx.events.push({ type: "CardDispelled", player: tgt, by: src, card: arm.card });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ill-effect gate (SP10 / PR-5 / PR-7 / TH-9 / SC-4)
// ---------------------------------------------------------------------------

function illGate(ctx: Ctx, tgt: PlayerId): { blocked: boolean; tgt: PlayerId } {
  const s = ctx.s;
  if (modsFor(s, tgt).noIllEffects) {
    ctx.events.push({ type: "IllEffectPrevented", target: tgt, by: "protection" });
    return { blocked: true, tgt };
  }
  for (const e of statusesOn(s, tgt)) {
    if (!e.armed || e.armed.on !== "illEffectIncoming") continue;
    if (e.armed.key === "preventIll") {
      consumeArmed(ctx, e);
      ctx.events.push({ type: "IllEffectPrevented", target: tgt, by: "ward" });
      return { blocked: true, tgt };
    }
    if (e.armed.key === "redirectIll") {
      consumeArmed(ctx, e);
      const next = nextEnemy(s, tgt);
      if (next) {
        ctx.events.push({ type: "IllEffectRedirected", from: tgt, to: next });
        return { blocked: false, tgt: next };
      }
    }
  }
  return { blocked: false, tgt };
}

// ---------------------------------------------------------------------------
// Op handlers
// ---------------------------------------------------------------------------

type HandlerResult = { decision: DecisionRequest } | void;
type OpHandler = (ctx: Ctx, op: Op & Record<string, any>, choice: unknown) => HandlerResult;

function decision(
  ctx: Ctx,
  playerId: PlayerId,
  kind: string,
  prompt: string,
  def: unknown,
  options?: unknown[]
): { decision: DecisionRequest } {
  return { decision: { id: newId(ctx.s, "d"), player: playerId, kind, prompt, options, default: def } };
}

const OPS: Record<string, OpHandler> = {
  // --- turn machine ---------------------------------------------------------

  startTurn(ctx, op) {
    const s = ctx.s;
    if (s.phase !== "playing") return;
    let p = op.p as PlayerId;
    if (player(s, p).status !== "active") {
      const next = nextActivePlayer(s, p);
      if (!next || next === p) return;
      pushSeq(ctx, [{ t: "startTurn", p: next }]);
      return;
    }
    // stunned: the turn is consumed (SP1)
    const stun = statusesByKey(s, p, "stunned")[0];
    if (stun) {
      stun.data.turns = (stun.data.turns as number) - 1;
      ctx.events.push({ type: "TurnSkipped", player: p, remaining: stun.data.turns });
      if ((stun.data.turns as number) <= 0) {
        removeStatus(ctx, stun, "elapsed");
        for (const b of statusesByKey(s, p, "banished")) removeStatus(ctx, b, "elapsed");
      }
      const next = nextActivePlayer(s, p);
      if (next && next !== p) pushSeq(ctx, [{ t: "startTurn", p: next }]);
      return;
    }
    s.turnCount += 1;
    s.turn.activePlayer = p;
    s.turn.hasDrawn = false;
    s.turn.attacksUsed = 0;
    s.turn.skipAttack = false;
    s.turn.stolenBy = null;
    s.turn.homefieldGiven = 0;
    // WL-I Delirium
    const del = statusesByKey(s, p, "delirium")[0];
    if (del && player(s, del.source).status === "active") {
      s.turn.stolenBy = del.source;
      removeStatus(ctx, del, "triggered");
      ctx.events.push({ type: "TurnStolen", victim: p, by: s.turn.stolenBy });
    } else if (del) {
      removeStatus(ctx, del, "sourceGone");
    }
    ctx.events.push({ type: "TurnStarted", player: p, turn: s.turnCount, actingAs: s.turn.stolenBy ?? p });
    // A8: start-of-source-turn ticks
    const ops: Op[] = [];
    for (const e of [...s.effects]) {
      if (!e.tick || e.source !== p) continue;
      if (e.owner !== "global" && player(s, e.owner).status !== "active") continue;
      const tickOps = fxOps(ctx, e.source, e.tick, [e.owner === "global" ? p : e.owner], { dot: true });
      for (const o of tickOps) if (o.t === "custom") (o as any).eId = e.id;
      ops.push(...tickOps);
    }
    // WL-5: view/lock decisions for cripples this player controls
    for (const e of s.effects) {
      if (e.key === "cripple" && e.source === p) ops.push({ t: "crippleView", eId: e.id });
    }
    // WL-9: blind curse hijacks the whole turn
    if (statusesByKey(s, p, "blind").length > 0) {
      ops.push({ t: "blindPick", p });
    }
    pushSeq(ctx, ops);
  },

  endTurn(ctx) {
    const s = ctx.s;
    for (const e of [...s.effects]) {
      const d = e.dur;
      if (d.kind === "endOfTurn" && d.turn <= s.turnCount) removeStatus(ctx, e, "endOfTurn");
      else if (d.kind === "colorChange" && d.grace) removeStatus(ctx, e, "colorChange"); // A6 grace
      else if (
        d.kind === "sourceNextTurnEnd" &&
        e.source === s.turn.activePlayer &&
        s.turnCount > d.createdTurn
      ) {
        removeStatus(ctx, e, "expired");
      }
    }
    cleanupRageLinked(ctx);
    s.turn.stolenBy = null;
    s.scratch = {};
    ctx.events.push({ type: "TurnEnded", player: s.turn.activePlayer });
    const next = nextActivePlayer(s, s.turn.activePlayer);
    const ops: Op[] = [{ t: "winCheck", data: {} }];
    if (next) ops.push({ t: "startTurn", p: next });
    pushSeq(ctx, ops);
  },

  // --- card resolution -------------------------------------------------------

  resolvePlay(ctx, op, choice) {
    const s = ctx.s;
    const actor = op.actor as PlayerId;
    const def = card(op.cardId as string);
    const wildOrZero = isWild(def) || def.number === 0;

    // wilds flipped by Paradoxal Whims need a color pick
    if (isWild(def) && !op.chosenColor) {
      if (op.phase !== "color") {
        op.phase = "color";
        return decision(ctx, actor, "chooseColor", "Choose the new color", s.field.activeColor, [...COLORS]);
      }
      op.chosenColor = COLORS.includes(choice as any) ? choice : s.field.activeColor;
    }

    if (!op.viaWhims && !op.anytime) takeFromHand(s, actor, op.cardId as string);
    s.field.pile.push(op.cardId as string);
    s.field.activeNumber = effectiveNumber(def);
    ctx.events.push({ type: "CardPlayed", player: actor, card: op.cardId, viaWhims: !!op.viaWhims });

    // TH-I chameleon: declared color drives matching + the field color (works as normal otherwise)
    if (op.declaredColor) {
      const cham = statusesByKey(s, actor, "chameleon")[0];
      if (cham) removeStatus(ctx, cham, "triggered");
    }
    const newColor = (op.declaredColor as any) ?? op.chosenColor ?? def.color ?? s.field.activeColor;
    changeColor(ctx, newColor, actor, isWild(def));

    // ability determination + suppressions
    let ability = abilityFor(s, actor, def);
    if (ability && def.kind === "number" && def.number !== 0) {
      // PA-8 Even the Odds
      const armed = s.effects.find((e) => e.armed?.on === "numberAbilityResolving");
      if (armed) {
        consumeArmed(ctx, armed);
        ctx.events.push({ type: "AbilitySuppressed", player: actor, by: "evenOdds" });
        ability = null;
      }
    }
    // SO-C dispel: a qualifying card played by anyone OTHER than the warded
    // player is negated against that player only (M15). The owner's own plays
    // never trigger it. Arm the matches here; the dmg/stun/status/draw ops
    // consult dispelBlocks() as this card's effects land.
    const isSpecial = def.kind !== "number" || def.number === 0;
    const dispelArms = s.effects
      .filter(
        (e) =>
          e.key === "dispel" &&
          e.owner !== "global" &&
          e.owner !== actor &&
          ((e.data.branch === "special" && isSpecial) || (e.data.branch === "number" && !isSpecial))
      )
      .map((e) => ({ id: e.id, owner: e.owner as PlayerId, actor, card: op.cardId as string }));
    if (dispelArms.length > 0) s.scratch.dispelArms = dispelArms;
    else delete s.scratch.dispelArms;

    const withColor = colorBonusApplies(ctx, actor, def.color, wildOrZero);
    const cardCtx = { withColor };
    const spec = ability?.spec;
    const raging = spec && hasRage(s, actor) ? spec.raging : undefined;
    const effects = raging?.effects ?? spec?.effects ?? [];
    let targets = (op.targets as PlayerId[]) ?? [];
    if (op.auto && ability && targets.length === 0) {
      targets = autofillTargets(ctx, actor, ability.targets);
    }
    const attackTarget = (op.attackTarget as PlayerId) ?? undefined;
    const mkAttack = (target?: PlayerId, opts: Record<string, unknown> = {}): Op => ({
      t: "attack",
      attacker: actor,
      target,
      withColor: cardCtx.withColor,
      free: !!op.viaWhims, // SO-6: the flipped card's attack is additional
      ...opts,
    });

    const ops: Op[] = [];
    if (ability && spec) {
      ctx.events.push({ type: "AbilityTriggered", player: actor, classId: pclass(s, actor).id, key: ability.key, name: spec.name });
    }

    switch (def.kind) {
      case "number": {
        if (ability && spec) {
          const fx = fxOps(ctx, actor, effects, targets, { extra: op.extra as any });
          const withAttack = spec.attack === "retain" || spec.attack === "grant";
          if (withAttack && spec.attackFirst) {
            ops.push(mkAttack(attackTarget ?? undefined), ...fx); // TH-7
          } else {
            ops.push(...fx);
            if (withAttack) ops.push(mkAttack(attackTarget ?? undefined));
          }
        } else {
          ops.push(mkAttack()); // T4: plain play → attack next enemy
        }
        break;
      }
      case "stun": {
        if (ability && spec) {
          // SP1: class stun — targeted; attack goes to t0
          ops.push(...fxOps(ctx, actor, effects, targets, { extra: op.extra as any }));
          if (spec.attack !== "none") ops.push(mkAttack(targets[0]));
        } else {
          const tgt = nextEnemy(s, actor);
          if (tgt) {
            ops.push(mkAttack(tgt));
            ops.push({ t: "stunOp", src: actor, tgt, turns: 1 });
          }
        }
        break;
      }
      case "counter": {
        s.turn.direction = s.turn.direction === 1 ? -1 : 1; // SP2: always reverses
        ctx.events.push({ type: "OrderReversed", direction: s.turn.direction });
        const comeback = player(s, actor).lastHitBy;
        const tgt = comeback && player(s, comeback).status === "active" ? comeback : nextEnemy(s, actor);
        if (ability && spec) {
          ops.push(...fxOps(ctx, actor, effects, targets, { extra: op.extra as any }));
          if (spec.attack !== "none" && tgt) ops.push(mkAttack(tgt));
        } else if (tgt) {
          ops.push(mkAttack(tgt));
        }
        break;
      }
      case "rally": {
        if (ability && spec) {
          const rallyVictim = targets[0];
          const attackTo = spec.rallyAttackTo === "free" ? attackTarget ?? nextEnemy(s, actor) ?? undefined : rallyVictim;
          if (spec.attack !== "none" && attackTo) ops.push(mkAttack(attackTo));
          // statuses first (WL-R peek), then draws, then the rest (PA-R reads draws)
          const statusFx = effects.filter((e) => e.do === "applyStatus");
          const otherFx = effects.filter((e) => e.do !== "applyStatus");
          ops.push(...fxOps(ctx, actor, statusFx, targets, { extra: op.extra as any }));
          if (!spec.replacesRallyDraw && rallyVictim) {
            s.scratch.rallyDrawn = [];
            ops.push({ t: "draw", p: rallyVictim, n: 2, forced: true, src: actor, sk: "rallyDrawn" });
          }
          ops.push(...fxOps(ctx, actor, otherFx, targets, { extra: op.extra as any }));
        } else {
          const tgt = nextEnemy(s, actor); // SP3 off-color
          if (tgt) {
            ops.push(mkAttack(tgt));
            ops.push({ t: "draw", p: tgt, n: 2, forced: true, src: actor });
          }
        }
        break;
      }
      case "advantage": {
        if (spec) {
          ops.push(...fxOps(ctx, actor, effects, targets, { extra: op.extra as any }));
          if (spec.attack !== "none" && spec.attack !== "replace") ops.push(mkAttack(attackTarget));
        }
        break;
      }
      case "inspiration": {
        if (spec) {
          ops.push(...fxOps(ctx, actor, effects, targets, { extra: op.extra as any }));
          if (!spec.replacesInspirationDraw) {
            const drawTgt = targets[0] ?? nextEnemy(s, actor);
            if (drawTgt) ops.push({ t: "draw", p: drawTgt, n: 4, forced: true, src: actor });
          }
          if (spec.attack !== "none" && spec.attack !== "replace") ops.push(mkAttack(attackTarget));
        }
        break;
      }
    }

    ops.push({ t: "winCheck", data: {} });
    pushSeq(ctx, ops);
  },

  // --- combat ------------------------------------------------------------------

  attack(ctx, op) {
    const s = ctx.s;
    if (s.phase !== "playing") return;
    const attacker = op.attacker as PlayerId;
    if (player(s, attacker).status !== "active") return;
    if (!op.free) {
      if (s.turn.attacksUsed > 0 || s.turn.skipAttack) return; // T7 / ZK-9
    }
    if (s.scratch.suppressGrantAttack) {
      delete s.scratch.suppressGrantAttack; // SO-0 wish dealt damage (A3)
      return;
    }
    let tgt: PlayerId | undefined = (op.target as PlayerId | undefined) ?? nextEnemy(s, attacker) ?? undefined;
    if (!tgt) return;
    if (player(s, tgt).status !== "active" || modsFor(s, tgt).untargetable) {
      tgt = nextEnemy(s, attacker) ?? undefined; // PR-S banish pass-through
      if (!tgt) return;
    }
    // KN-4 taunt: save 8 to target anyone else (Q23)
    for (const e of statusesByKey(s, attacker, "taunt")) {
      const kn = e.source;
      if (player(s, kn).status === "active" && tgt !== kn) {
        if (!saveRoll(ctx, attacker, 8)) {
          ctx.events.push({ type: "TauntRedirect", attacker, to: kn });
          tgt = kn;
        }
        break;
      }
    }
    if (!op.free) s.turn.attacksUsed += 1;
    const cls = pclass(s, attacker);
    const withColor = op.forceColor ? true : !!op.withColor || !!cls.alwaysColorBonus;
    ctx.events.push({ type: "Attack", attacker, target: tgt });
    const ops: Op[] = [
      {
        t: "dmg",
        src: attacker,
        tgt,
        dice: { n: cls.attackDice, plus: 0 },
        kind: "attack",
        withColorBonus: withColor,
        hitId: newId(s, "h"),
      },
    ];
    // SC-A Home Field
    if (
      statusesByKey(s, attacker, "homeField").length > 0 &&
      s.turn.homefieldGiven < 2 &&
      player(s, attacker).hand.length > 0
    ) {
      ops.push({ t: "homeGift", giver: attacker, to: tgt });
    }
    pushSeq(ctx, ops);
  },

  homeGift(ctx, op, choice) {
    const s = ctx.s;
    const giver = op.giver as PlayerId;
    const to = op.to as PlayerId;
    const hand = player(s, giver).hand;
    if (hand.length === 0 || player(s, to).status !== "active" || s.turn.homefieldGiven >= 2) return;
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      return decision(ctx, giver, "giveCard", "Home Field: give a card", hand[0], [...hand]);
    }
    const c = hand.includes(choice as string) ? (choice as string) : hand[0];
    takeFromHand(s, giver, c);
    player(s, to).hand.push(c);
    s.turn.homefieldGiven += 1;
    ctx.events.push({ type: "CardGiven", card: c, to, by: giver, private: [giver, to] });
  },

  aoe(ctx, op) {
    const s = ctx.s;
    const src = op.src as PlayerId;
    const enemies = enemiesOf(s, src);
    if (enemies.length === 0) return;
    const preRolled = rollSum(ctx, src, (op.dice as any).n, op.dot ? "misc" : "ability");
    pushSeq(
      ctx,
      enemies.map((e) => ({
        t: "dmg",
        src,
        tgt: e,
        dice: op.dice,
        preRolled,
        kind: op.dot ? "dot" : "ability",
        save: op.save,
        aoe: true,
        hitId: op.hitId,
      }))
    );
  },

  dmg(ctx, op, choice) {
    const s = ctx.s;
    if (s.phase !== "playing") return;
    let tgt = op.tgt as PlayerId;
    const src = op.src as PlayerId;

    // KN-2 Back At You: reflect an incoming ability effect
    if (op.phase === undefined) {
      op.phase = "window";
      if (op.kind === "ability" && src !== tgt) {
        const armed = statusesOn(s, tgt).find((e) => e.armed?.on === "targetedByAbility" && e.armed.key === "backAtYou");
        if (armed && player(s, tgt).status === "active") {
          consumeArmed(ctx, armed);
          op.phase = "reflect";
          const opts = s.players.filter((p) => p.status === "active" && p.id !== tgt).map((p) => p.id);
          return decision(ctx, tgt, "reflect", "Back At You: reflect to whom?", src, opts);
        }
      }
    }
    if (op.phase === "reflect") {
      const pick = choice as PlayerId;
      if (pick && pick !== tgt && player(s, pick).status === "active") {
        ctx.events.push({ type: "AbilityReflected", by: tgt, to: pick });
        op.tgt = pick;
        tgt = pick;
      }
      op.phase = "window";
    }

    // SP8 window: any Knight holding a 0 may discard Stand Behind Me
    if (op.phase === "window") {
      op.data ??= {};
      const asked: PlayerId[] = (op.data.asked ??= []);
      // resolve the previous holder's answer before asking the next
      if (op.data.holder) {
        if (choice) {
          const kn = player(s, op.data.holder as PlayerId);
          const zero = kn.hand.find((c) => card(c).number === 0);
          if (zero) {
            takeFromHand(s, kn.id, zero);
            s.drawPile.unshift(zero); // SP8: bottom of the deck
            ctx.events.push({ type: "AnytimeDiscard", player: kn.id, card: zero });
            const picks = Array.isArray(choice) ? (choice as PlayerId[]) : [kn.id];
            for (const t of picks) {
              if (player(s, t).status !== "active") continue;
              addStatus(ctx, kn.id, t, { key: "standBehindMe", dur: { kind: "colorChange" }, mods: { noDamage: true } });
            }
          }
        }
        op.data.holder = undefined;
      }
      if (op.kind !== "reflect") {
        const holder = s.players.find(
          (p) =>
            p.status === "active" &&
            p.classId === "knight" &&
            !asked.includes(p.id) &&
            p.hand.some((c) => card(c).number === 0)
        );
        if (holder) {
          asked.push(holder.id);
          op.data.holder = holder.id;
          return decision(ctx, holder.id, "kn0Window", "Discard Stand Behind Me to protect players?", false);
        }
      }
      op.phase = "apply";
    }

    // ---- apply ----
    if (src === tgt) return; // A5
    if (player(s, tgt).status !== "active") return;
    if ((op.kind === "attack" || op.kind === "ability") && dispelBlocks(ctx, src, tgt)) return; // SO-C

    let usedColorBonus = false;
    let amount: number;
    if (op.amount !== undefined) {
      amount = op.amount as number;
    } else if (op.kind === "dot") {
      const d = op.dice as any;
      amount = (op.preRolled ?? rollSum(ctx, src, d.n, "misc")) + d.plus;
    } else {
      const r = attackerPhase(ctx, src, tgt, op.dice as any, {
        kind: op.kind === "attack" ? "attack" : "ability",
        withColorBonus: !!op.withColorBonus,
        rollTwice: !!op.rollTwice,
        preRolled: op.preRolled as number | undefined,
      });
      amount = r.amount;
      usedColorBonus = r.usedColorBonus;
      if (op.preRolled !== undefined && op.withColorBonus) usedColorBonus = true;
    }

    if (op.kind === "dot") {
      const gate = illGate(ctx, tgt); // DoT ticks are ill effects (SP10)
      if (gate.blocked) return;
      tgt = gate.tgt;
      if (tgt === src) return;
    }

    // TH-3 dodge (AoE / multi-target)
    if (op.aoe) {
      const dodge = statusesOn(s, tgt).find((e) => e.armed?.on === "aoeIncoming");
      if (dodge) {
        consumeArmed(ctx, dodge);
        ctx.events.push({ type: "Dodged", player: tgt });
        return;
      }
    }
    // SO-2 Counter Spell (per triggering card, tracked by hitId)
    const cSpell = statusesByKey(s, tgt, "counterSpell")[0];
    if (cSpell && (op.kind === "attack" || op.kind === "ability")) {
      const blocked: string[] = (cSpell.data.blocked as string[]) ??= [];
      if (blocked.includes(op.hitId as string)) {
        ctx.events.push({ type: "CounterSpelled", player: tgt });
        return;
      }
      if ((cSpell.data.uses as number) > 0) {
        cSpell.data.uses = (cSpell.data.uses as number) - 1;
        blocked.push(op.hitId as string);
        ctx.events.push({ type: "CounterSpelled", player: tgt });
        if ((cSpell.data.uses as number) <= 0) removeStatus(ctx, cSpell, "spent");
        return;
      }
    }
    // armed attack-incoming triggers (ZK-R / KN-R / PA-C)
    const extraFlats: number[] = [];
    if (op.kind === "attack") {
      for (const e of [...statusesOn(s, tgt)]) {
        if (!e.armed || e.armed.on !== "attackIncoming") continue;
        if (e.armed.key === "pressOn") {
          extraFlats.push(-3);
          consumeArmed(ctx, e);
          pushSeq(ctx, [{ t: "attack", attacker: tgt, target: src, free: true }]); // return attack
        } else if (e.armed.key === "riposte") {
          consumeArmed(ctx, e);
          ctx.events.push({ type: "AttackBlocked", player: tgt, by: "riposte" });
          pushSeq(ctx, [
            { t: "dmg", src: tgt, tgt: src, dice: { n: 1, plus: 4 }, kind: "ability", lifesteal: true, hitId: newId(s, "h") },
          ]);
          return;
        } else if (e.armed.key === "goldenBlock") {
          consumeArmed(ctx, e);
          ctx.events.push({ type: "AttackBlocked", player: tgt, by: "goldenRule" });
          return;
        }
      }
    }
    // KN-0 / PR-A: no damage (sanctuary allows an attacker bypass save)
    const tmods = modsFor(s, tgt);
    if (tmods.noDamage) {
      if (tmods.sanctuaryBypassDc !== undefined && op.kind !== "reflect") {
        if (!saveRoll(ctx, src, tmods.sanctuaryBypassDc)) {
          ctx.events.push({ type: "DamagePrevented", target: tgt });
          return;
        }
      } else {
        ctx.events.push({ type: "DamagePrevented", target: tgt });
        return;
      }
    }
    // per-target save (SP9)
    const mults: number[] = [];
    if (op.save) {
      const sv = op.save as { dc: number; onPass: "half" | "none" };
      if (saveRoll(ctx, tgt, sv.dc)) {
        if (sv.onPass === "none") return;
        mults.push(0.5);
      }
    }
    const dctx = defenderContext(ctx, src, tgt);
    const final = defenderMin(amount, [...mults, ...dctx.mults], [...dctx.flats, ...extraFlats]);
    const p = player(s, tgt);
    const floorVal = dctx.hpFloor > 0 ? Math.min(p.hp, dctx.hpFloor) : 0;
    p.hp = Math.max(floorVal, p.hp - final);
    if (final > 0) p.lastHitBy = src;
    ctx.events.push({ type: "DamageDealt", src, tgt, amount: final, kind: op.kind, hp: p.hp });

    if (op.kind !== "reflect" && final > 0) {
      const ops: Op[] = [];
      if (op.lifesteal) ops.push({ t: "heal", src, tgt: src, amount: final });
      if (modsFor(s, src).lifestealHalf) ops.push({ t: "heal", src, tgt: src, amount: Math.floor(final / 2) }); // ZK-1
      // WL-S soul link: damage the Warlock takes is dealt to the linked target
      for (const e of s.effects) {
        if (e.key === "soulLink" && e.source === tgt && e.owner !== "global" && player(s, e.owner).status === "active") {
          ops.push({ t: "dmg", src, tgt: e.owner, amount: final, kind: "reflect", hitId: op.hitId, phase: "apply" });
        }
      }
      for (const e of [...statusesOn(s, tgt)]) {
        if (!e.armed || e.armed.on !== "takeDamage") continue;
        if (e.armed.key === "shieldMaster" && (op.kind === "attack" || op.kind === "ability")) {
          consumeArmed(ctx, e);
          ops.push({ t: "stunOp", src: tgt, tgt: src, turns: 1 });
          ops.push({ t: "draw", p: src, n: 1, forced: true, src: tgt });
        } else if (e.armed.key === "revenge" && op.kind === "ability") {
          consumeArmed(ctx, e);
          ops.push({ t: "dmg", src: tgt, tgt: src, amount: final * 2, kind: "reflect", hitId: op.hitId, phase: "apply" }); // Q24
        }
      }
      // KN-P Opportunity Maker (once per person per hit — Q13)
      if (pclass(s, src).passive === "opportunityMaker" && usedColorBonus) {
        const already = statusesByKey(s, tgt, "exposed").some((e) => e.data.hit === op.hitId);
        if (!already) {
          addStatus(ctx, src, tgt, { key: "exposed", dur: { kind: "untilTriggered" }, data: { hit: op.hitId } });
        }
      }
      pushSeq(ctx, ops);
    }
    if (p.hp <= 0 && p.status === "active") {
      pushSeq(ctx, [{ t: "death", p: tgt }]);
    }
  },

  heal(ctx, op) {
    const s = ctx.s;
    const tgt = op.tgt as PlayerId;
    if (player(s, tgt).status !== "active") return;
    let amount: number;
    if (op.amount !== undefined) amount = op.amount as number;
    else {
      const d = op.dice as any;
      amount = op.exploding
        ? rollExploding(ctx, op.src as PlayerId, d.n) + d.plus
        : rollSum(ctx, op.src as PlayerId, d.n, "heal") + d.plus;
    }
    const p = player(s, tgt);
    const max = pclass(s, tgt).maxHp;
    p.hp = Math.min(max, p.hp + amount);
    ctx.events.push({ type: "Healed", target: tgt, amount, hp: p.hp });
  },

  stunOp(ctx, op) {
    const s = ctx.s;
    let tgt = op.tgt as PlayerId;
    const src = op.src as PlayerId;
    if (src === tgt) return; // A5
    if (player(s, tgt).status !== "active") return;
    if (dispelBlocks(ctx, src, tgt)) return; // SO-C
    const gate = illGate(ctx, tgt);
    if (gate.blocked) return;
    tgt = gate.tgt;
    if (tgt === src || player(s, tgt).status !== "active") return;
    let turns = op.turns as number;
    if (op.save) {
      const sv = op.save as { dc: number; reduceTo: number };
      if (saveRoll(ctx, tgt, sv.dc)) turns = sv.reduceTo;
    }
    if (turns <= 0) return;
    const existing = statusesByKey(s, tgt, "stunned")[0];
    if (existing) existing.data.turns = Math.max(existing.data.turns as number, turns);
    else addStatus(ctx, src, tgt, { key: "stunned", ill: true, dur: { kind: "permanent" }, data: { turns } });
    if (op.banish) {
      addStatus(ctx, src, tgt, { key: "banished", dur: { kind: "permanent" }, mods: { untargetable: true }, data: { linkStun: true } });
    }
    ctx.events.push({ type: "Stunned", target: tgt, turns, by: src });
  },

  draw(ctx, op, choice) {
    const s = ctx.s;
    let p = op.p as PlayerId;
    if (player(s, p).status !== "active") return;
    if (op.forced && op.src && op.phase === undefined && dispelBlocks(ctx, op.src as PlayerId, p)) return; // SO-C
    if (op.forced && op.phase === undefined) {
      const gate = illGate(ctx, p); // forced draws are ill effects (SP10)
      if (gate.blocked) return;
      p = gate.tgt;
      op.p = p;
    }
    const n = op.n as number;
    const finish = (cardId: string) => {
      player(s, p).hand.push(cardId);
      ctx.events.push({ type: "CardDrawn", player: p, card: cardId, private: [p] });
      ctx.events.push({ type: "DrewCard", player: p });
      if (pclass(s, p).passive === "arcaneFlux") {
        const pl = player(s, p);
        pl.hp = Math.min(pclass(s, p).maxHp, pl.hp + 2);
        ctx.events.push({ type: "Healed", target: p, amount: 2, hp: pl.hp, passive: "arcaneFlux" });
      }
      if (op.sk) {
        const arr = ((s.scratch[op.sk as string] as string[]) ??= []);
        arr.push(cardId);
      }
      for (const e of statusesByKey(s, p, "cursedEyes")) {
        if (e.data.peek) ctx.events.push({ type: "CardViewed", viewer: e.source, card: cardId, private: [e.source] });
      }
    };

    // SC-P Calculated Risk: draw n+2, keep n, stack 2 back (designer rewrite)
    if (pclass(s, p).passive === "calculatedRisk" && !op.raw) {
      if (op.phase !== "picked") {
        op.phase = "picked";
        const staged: string[] = [];
        for (let i = 0; i < n + 2; i++) {
          ensureDrawPile(ctx);
          const c = s.drawPile.pop();
          if (!c) break;
          staged.push(c);
          s.staging.push(c);
        }
        op.staged = staged;
        if (staged.length <= n) {
          for (const c of staged) {
            s.staging.splice(s.staging.indexOf(c), 1);
            finish(c);
          }
          return;
        }
        return decision(ctx, p, "scoutReturn", "Return 2 cards to the top of the deck (in order)", staged.slice(-2), staged);
      }
      const staged = op.staged as string[];
      let returns = ((choice as string[]) ?? []).filter((c) => staged.includes(c)).slice(0, 2);
      if (returns.length < Math.min(2, staged.length - n) || new Set(returns).size !== returns.length) {
        returns = staged.slice(-2);
      }
      for (const c of staged) {
        s.staging.splice(s.staging.indexOf(c), 1);
        if (!returns.includes(c)) finish(c);
      }
      for (let i = returns.length - 1; i >= 0; i--) s.drawPile.push(returns[i]); // returns[0] drawn next
      ctx.events.push({ type: "ScoutReturned", player: p, count: returns.length });
      return;
    }

    for (let i = 0; i < n; i++) {
      ensureDrawPile(ctx);
      const c = s.drawPile.pop();
      if (!c) break;
      finish(c);
    }
  },

  status(ctx, op, choice) {
    const s = ctx.s;
    const src = op.src as PlayerId;
    let tgt = op.tgt as PlayerId | "global";
    const spec = op.spec as any;
    if (tgt !== "global") {
      if (player(s, tgt).status !== "active") return;
      const negative = !!spec.ill || !!spec.mods?.curse || ["taunt", "delirium", "guidingBolt"].includes(spec.key);
      // KN-2 reflect for negative ability statuses
      if (op.phase === undefined && negative && tgt !== src) {
        op.phase = "applied";
        const armed = statusesOn(s, tgt).find((e) => e.armed?.on === "targetedByAbility" && e.armed.key === "backAtYou");
        if (armed) {
          consumeArmed(ctx, armed);
          op.phase = "reflect";
          const opts = s.players.filter((p) => p.status === "active" && p.id !== tgt).map((p) => p.id);
          return decision(ctx, tgt as PlayerId, "reflect", "Back At You: reflect to whom?", src, opts);
        }
      }
      if (op.phase === "reflect") {
        const pick = choice as PlayerId;
        if (pick && pick !== tgt && player(s, pick).status === "active") {
          ctx.events.push({ type: "AbilityReflected", by: tgt, to: pick });
          tgt = pick;
        }
        op.phase = "applied";
      }
      if (spec.ill && tgt !== src) {
        const gate = illGate(ctx, tgt as PlayerId);
        if (gate.blocked) return;
        tgt = gate.tgt;
      }
      if (tgt === src && (spec.ill || spec.mods?.curse) && src !== op.src) return;
    }
    if (tgt !== "global" && tgt !== src && dispelBlocks(ctx, src, tgt)) return; // SO-C
    addStatus(ctx, src, tgt, spec);
  },

  removeIll(ctx, op) {
    const s = ctx.s;
    const tgt = op.tgt as PlayerId;
    if (!tgt || player(s, tgt).status !== "active") return;
    for (const e of [...statusesOn(s, tgt)]) {
      if (isNegativeStatus(e)) removeStatus(ctx, e, "restored");
    }
  },

  custom(ctx, op, choice) {
    const h = CUSTOMS[op.key as string];
    if (!h) throw new Error(`unknown custom effect: ${op.key}`);
    return h(ctx, op as any, choice);
  },

  // --- lifecycle ---------------------------------------------------------------

  winCheck(ctx, op, choice) {
    const s = ctx.s;
    if (s.phase !== "playing") return;
    op.data ??= {};
    const done: PlayerId[] = (op.data.done ??= []);
    const asked: PlayerId[] = (op.data.asked ??= []);

    const out = s.players.find((p) => p.status === "active" && p.hand.length === 0 && !done.includes(p.id));
    if (out) {
      // C7: PR-0 interrupt window
      if (op.data.pendingPriest && choice) {
        const priest = player(s, op.data.pendingPriest as PlayerId);
        const zero = priest.hand.find((c) => card(c).number === 0);
        if (zero) {
          takeFromHand(s, priest.id, zero);
          s.drawPile.unshift(zero); // SP8
          ctx.events.push({ type: "AnytimeDiscard", player: priest.id, card: zero });
          pushSeq(ctx, [
            { t: "draw", p: out.id, n: 5, forced: true, src: priest.id },
            { t: "winCheck", data: {} },
          ]);
          return;
        }
      }
      op.data.pendingPriest = undefined;
      const priest = s.players.find(
        (p) =>
          p.status === "active" &&
          p.classId === "priest" &&
          p.id !== out.id &&
          !asked.includes(p.id) &&
          p.hand.some((c) => card(c).number === 0)
      );
      if (priest) {
        asked.push(priest.id);
        op.data.pendingPriest = priest.id;
        return decision(ctx, priest.id, "pr0Window", `${out.id} is about to win — discard Divine Intervention to force a draw of 5?`, false);
      }
      // uninterrupted: they win (T8)
      out.status = "won";
      s.placements.push(out.id);
      for (const e of [...s.effects]) {
        if (e.source === out.id || e.owner === out.id) removeStatus(ctx, e, "playerOut");
      }
      ctx.events.push({ type: "PlayerWon", player: out.id, place: s.placements.length });
      if (s.config.mode === "teams") {
        s.winner = (player(s, out.id).seat % 2 === 0 ? "team0" : "team1") as any;
        s.phase = "finished";
        ctx.events.push({ type: "GameEnded", winner: s.winner });
        return;
      }
      s.winner ??= s.placements[0];
      pushSeq(ctx, [{ t: "winCheck", data: { done: [...done, out.id] } }]);
      return;
    }

    // team elimination (C8)
    if (s.config.mode === "teams") {
      for (const team of [0, 1]) {
        const members = s.players.filter((p) => p.seat % 2 === team);
        if (members.every((p) => p.status === "dead" || p.status === "conceded")) {
          s.winner = (team === 0 ? "team1" : "team0") as any;
          s.phase = "finished";
          ctx.events.push({ type: "GameEnded", winner: s.winner });
          return;
        }
      }
      return;
    }
    // FFA: T9 — play on until one player remains
    const actives = s.players.filter((p) => p.status === "active");
    if (actives.length <= 1) {
      if (actives[0]) s.placements.push(actives[0].id);
      for (let i = s.deaths.length - 1; i >= 0; i--) {
        if (!s.placements.includes(s.deaths[i])) s.placements.push(s.deaths[i]);
      }
      s.winner = s.placements[0] ?? null;
      s.phase = "finished";
      ctx.events.push({ type: "GameEnded", winner: s.winner, placements: [...s.placements] });
    }
  },

  death(ctx, op, choice) {
    const s = ctx.s;
    const pid = op.p as PlayerId;
    const p = player(s, pid);
    if (op.phase === undefined) {
      if (p.status !== "active") return;
      p.status = "dead";
      p.hp = 0;
      s.deaths.push(pid);
      ctx.events.push({ type: "PlayerDied", player: pid });
      op.phase = "offers";
      op.data ??= {};
      op.data.asked = [];
    }
    if (op.phase === "offers") {
      const asked: string[] = op.data.asked;
      if (op.data.offered && choice) {
        const zero = op.data.offered as string;
        if (p.hand.includes(zero)) {
          takeFromHand(s, pid, zero);
          s.drawPile.unshift(zero); // SP8
          ctx.events.push({ type: "AnytimeDiscard", player: pid, card: zero });
          if (p.classId === "priest") {
            op.data.reviveSelf = true; // M5/Q10: self-save — queued before winCheck below
          } else if (p.classId === "knight") {
            const picks = Array.isArray(choice) ? (choice as PlayerId[]) : [];
            for (const t of picks) {
              if (player(s, t).status !== "active") continue;
              addStatus(ctx, pid, t, { key: "standBehindMe", dur: { kind: "colorChange" }, mods: { noDamage: true } });
            }
          }
        }
      }
      op.data.offered = undefined;
      if (p.classId === "priest" || p.classId === "knight") {
        const zero = p.hand.find((c) => card(c).number === 0 && !asked.includes(c));
        if (zero) {
          asked.push(zero);
          op.data.offered = zero;
          const def = p.classId === "priest"; // a dying Priest self-revives by default
          return decision(ctx, pid, "deathAnytime", `Discard ${zero} for its effect as you fall?`, def);
        }
      }
      op.phase = "cleanup";
    }
    // Q10: hand discarded, ongoing effects end
    s.field.underPile.push(...p.hand);
    p.hand = [];
    for (const e of [...s.effects]) {
      if (e.source === pid || e.owner === pid) removeStatus(ctx, e, "playerDied");
    }
    const tail: Op[] = [];
    if (op.data?.reviveSelf) tail.push({ t: "revive", p: pid });
    tail.push({ t: "winCheck", data: {} });
    pushSeq(ctx, tail);
  },

  revive(ctx, op) {
    const s = ctx.s;
    const p = player(s, op.p as PlayerId);
    if (p.status !== "dead") return;
    p.status = "active";
    p.hp = Math.floor(pclass(s, p.id).maxHp / 2); // C6 / M3
    ctx.events.push({ type: "PlayerRevived", player: p.id, hp: p.hp });
    pushSeq(ctx, [{ t: "draw", p: p.id, n: 5 }]); // C6
  },

  // --- misc ---------------------------------------------------------------------

  blindPick(ctx, op) {
    const s = ctx.s;
    const pid = op.p as PlayerId;
    const p = player(s, pid);
    if (p.status !== "active" || p.hand.length === 0) {
      pushSeq(ctx, [{ t: "endTurn" }]);
      return;
    }
    const idx = randInt(s, p.hand.length);
    const cardId = p.hand[idx];
    const def = card(cardId);
    const playable =
      !isCardLocked(s, pid, cardId) &&
      (isWild(def) || matchesField(def, s.field.activeColor, s.field.activeNumber));
    ctx.events.push({ type: "BlindPick", player: pid, card: cardId, playable, private: [pid] });
    if (playable) {
      pushSeq(ctx, [
        { t: "resolvePlay", actor: pid, cardId, auto: true, chosenColor: isWild(def) ? s.field.activeColor : undefined },
        { t: "endTurn" },
      ]);
    } else {
      ctx.events.push({ type: "BlindFizzle", player: pid });
      pushSeq(ctx, [{ t: "endTurn" }]);
    }
  },

  crippleView(ctx, op, choice) {
    const s = ctx.s;
    const inst = s.effects.find((e) => e.id === op.eId);
    if (!inst || inst.owner === "global") return;
    const owner = player(s, inst.owner as PlayerId);
    if (owner.status !== "active" || owner.hand.length === 0) return;
    if (player(s, inst.source).status !== "active") return;
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      return decision(
        ctx,
        inst.source,
        "pickIndex",
        `Crippling Curse: view a card of ${owner.id}`,
        0,
        owner.hand.map((_, i) => i)
      );
    }
    const idx = Math.min(Math.max(0, Number(choice ?? 0)), owner.hand.length - 1);
    const viewed = owner.hand[idx];
    inst.data.locked = viewed;
    ctx.events.push({ type: "CardViewed", viewer: inst.source, card: viewed, owner: owner.id, private: [inst.source] });
    ctx.events.push({ type: "CardLocked", owner: owner.id, private: [inst.source, owner.id] });
  },

  initField(ctx, op, choice) {
    const s = ctx.s;
    const dealer = s.config.players[s.config.dealerSeat].id;
    if (op.phase !== "chosen") {
      op.phase = "chosen";
      return decision(ctx, dealer, "chooseColor", "Dealer: pick the starting color", "red", [...COLORS]);
    }
    s.field.activeColor = COLORS.includes(choice as any) ? (choice as any) : "red";
    ctx.events.push({ type: "ColorChosen", color: s.field.activeColor, by: dealer }); // S6: no change counted
  },
};

// ---------------------------------------------------------------------------
// Drain loop
// ---------------------------------------------------------------------------

function step(ctx: Ctx, op: Op, choice: unknown): void {
  const h = OPS[op.t];
  if (!h) throw new Error(`unknown op: ${op.t}`);
  const res = h(ctx, op as any, choice);
  if (res?.decision) {
    ctx.s.pending = { op, decision: res.decision };
    ctx.events.push({
      type: "DecisionRequested",
      player: res.decision.player,
      kind: res.decision.kind,
      id: res.decision.id,
    });
  }
}

function drain(ctx: Ctx): void {
  const s = ctx.s;
  let guard = 0;
  while (!s.pending && s.stack.length > 0) {
    if (++guard > 10000) throw new Error("resolution did not terminate");
    if (s.phase === "finished") {
      s.stack = [];
      break;
    }
    const op = s.stack.pop()!;
    step(ctx, op, undefined);
  }
  if (s.phase === "finished") {
    s.stack = [];
    s.pending = null;
  }
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

function requireMainPhase(s: GameState, playerId: PlayerId): void {
  if (s.phase !== "playing") fail("phase", "game is not in progress");
  if (s.pending) fail("pendingDecision", "a decision is pending");
  if (s.stack.length > 0) fail("resolving", "resolution in progress");
  if (actingPlayer(s) !== playerId) fail("notYourTurn", "not your turn");
}

function validateTargets(
  s: GameState,
  actor: PlayerId,
  spec: TargetSpec | undefined,
  targets: PlayerId[]
): void {
  if (!spec) {
    return;
  }
  const min = 1;
  const max = spec.count;
  if (targets.length < (spec.upTo ? min : max) || targets.length > max) {
    fail("badTargets", `expected ${spec.upTo ? "1-" : ""}${max} target(s)`);
  }
  if (new Set(targets).size !== targets.length) fail("badTargets", "duplicate targets");
  for (const t of targets) {
    const p = s.players.find((x) => x.id === t);
    if (!p) fail("badTargets", `unknown player ${t}`);
    if (spec.who === "dead") {
      if (p.status !== "dead") fail("badTargets", `${t} is not dead`);
      continue;
    }
    if (p.status !== "active") fail("badTargets", `${t} is out`);
    if (spec.who === "enemy" && !enemiesOf(s, actor).includes(t)) fail("badTargets", `${t} is not an enemy`);
    if (spec.who === "other" && t === actor) fail("badTargets", "cannot target yourself");
    if (modsFor(s, t).untargetable) fail("badTargets", `${t} is untargetable`);
  }
}

function handle(ctx: Ctx, action: Action): void {
  const s = ctx.s;
  switch (action.type) {
    case "chooseClass": {
      if (s.phase !== "classSelect") fail("phase", "class selection is over");
      const p = player(s, action.player);
      if (p.pendingClass) fail("alreadyChosen", "class already chosen");
      p.pendingClass = action.classId;
      ctx.events.push({ type: "ClassChosen", player: p.id, private: [p.id], classId: action.classId });
      if (s.players.every((x) => x.pendingClass)) {
        for (const x of s.players) {
          x.classId = x.pendingClass!;
          x.hp = pclass(s, x.id).maxHp;
        }
        ctx.events.push({
          type: "ClassesRevealed", // S4: simultaneous reveal
          picks: s.players.map((x) => ({ player: x.id, classId: x.classId })),
        });
        s.phase = "playing";
        const first = s.turn.activePlayer;
        const top = card(s.field.pile[s.field.pile.length - 1]);
        const ops: Op[] = [];
        if (isWild(top)) ops.push({ t: "initField" }); // S6
        ops.push({ t: "startTurn", p: first });
        pushSeq(ctx, ops);
      }
      return;
    }
    case "playCard": {
      requireMainPhase(s, action.player);
      const actor = action.player;
      const p = player(s, actor);
      if (!p.hand.includes(action.card)) fail("notInHand", "card not in hand");
      if (isCardLocked(s, actor, action.card)) fail("cardLocked", "that card is locked by a curse");
      const def = card(action.card);
      if (action.declaredColor) {
        if (statusesByKey(s, actor, "chameleon").length === 0) {
          fail("badDeclare", "no effect allows declaring a color");
        }
        if (isWild(def)) fail("badDeclare", "wilds choose a color instead of declaring one");
        if (!COLORS.includes(action.declaredColor)) fail("badDeclare", "unknown color");
        // M13: the declared color drives matching — the play must still be legal
        // as the declared color (same color as the field, or same number).
        if (!matchesField({ ...def, color: action.declaredColor }, s.field.activeColor, s.field.activeNumber)) {
          fail("noMatch", "declared color must match the field color, or the numbers must match (M13)");
        }
      }
      if (!isWild(def) && !action.declaredColor && !matchesField(def, s.field.activeColor, s.field.activeNumber)) {
        fail("noMatch", "card does not match the field (T2)");
      }
      if (isWild(def) && !action.chosenColor) fail("needColor", "wilds need a chosen color");
      const ability = abilityFor(s, actor, def);
      if (ability?.targets) validateTargets(s, actor, ability.targets, action.targets ?? []);
      pushSeq(ctx, [
        {
          t: "resolvePlay",
          actor,
          cardId: action.card,
          targets: action.targets ?? [],
          chosenColor: action.chosenColor,
          declaredColor: action.declaredColor,
          attackTarget: action.attackTarget,
          extra: action.extra ?? {},
        },
        { t: "endTurn" }, // one play per turn; the play ends it
      ]);
      return;
    }
    case "drawCard": {
      requireMainPhase(s, action.player);
      if (s.turn.hasDrawn) fail("alreadyDrew", "already drew this turn (M2)");
      s.turn.hasDrawn = true;
      pushSeq(ctx, [{ t: "draw", p: action.player, n: 1 }]);
      return;
    }
    case "endTurn": {
      requireMainPhase(s, action.player);
      if (!s.turn.hasDrawn) fail("mustAct", "play a card or draw first (T1)");
      pushSeq(ctx, [{ t: "endTurn" }]);
      return;
    }
    case "decide": {
      if (!s.pending) fail("noDecision", "nothing to decide");
      if (s.pending.decision.player !== action.player) fail("notYours", "not your decision");
      if (s.pending.decision.id !== action.decisionId) fail("staleDecision", "decision id mismatch");
      const pd = s.pending;
      s.pending = null;
      step(ctx, pd.op, action.choice);
      return;
    }
    case "anytime": {
      // M9: proactive use on your own turn; windows cover the rest (SP8)
      requireMainPhase(s, action.player);
      const p = player(s, action.player);
      if (!p.hand.includes(action.card)) fail("notInHand", "card not in hand");
      if (card(action.card).number !== 0) fail("notAnytime", "only 0 cards can be discarded at any time");
      if (p.classId !== "knight" && p.classId !== "priest") fail("notAnytime", "your class 0 is not an any-time card");
      takeFromHand(s, action.player, action.card);
      s.drawPile.unshift(action.card); // SP8: bottom of the deck
      ctx.events.push({ type: "AnytimeDiscard", player: action.player, card: action.card });
      const key = p.classId === "knight" ? "standBehindMe" : "divineIntervention";
      const targets = ((action.extra?.targets as PlayerId[]) ?? [action.player]).filter(
        (t) => s.players.some((x) => x.id === t)
      );
      pushSeq(ctx, [
        { t: "custom", key, actor: action.player, targets, extra: action.extra ?? {}, arg: {}, hitId: newId(s, "h"), data: {} },
        { t: "winCheck", data: {} },
      ]);
      return;
    }
    case "concede": {
      requireMainPhase(s, action.player);
      const p = player(s, action.player);
      p.status = "conceded";
      s.deaths.push(p.id);
      s.field.underPile.push(...p.hand);
      p.hand = [];
      for (const e of [...s.effects]) {
        if (e.source === p.id || e.owner === p.id) removeStatus(ctx, e, "conceded");
      }
      ctx.events.push({ type: "PlayerConceded", player: p.id });
      pushSeq(ctx, [{ t: "endTurn" }]);
      return;
    }
  }
}

export function applyAction(state: GameState, action: Action): Reply {
  const s = structuredClone(state);
  const ctx: Ctx = { s, events: [] as GameEvent[] };
  try {
    handle(ctx, action);
    drain(ctx);
    // T10, eagerly: refill the moment the pile empties so the deck never
    // sits at 0 between turns while recyclable cards exist.
    if (s.drawPile.length === 0) ensureDrawPile(ctx);
  } catch (err) {
    if (err instanceof RuleError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    throw err;
  }
  return { ok: true, state: s, events: ctx.events };
}
