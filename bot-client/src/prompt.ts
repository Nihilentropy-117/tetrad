// Renders one server state message into a compact user prompt. Stateless:
// each prompt fully describes the current board; no history is included.

import {
  cardName,
  type ActionSpec,
  type GameEvent,
  type PlayerView,
  type StateMsg,
  type TargetSpec,
} from "./types.js";

function playerLabel(view: PlayerView, id: string): string {
  const p = view.players.find((x) => x.id === id);
  return p ? `${p.id} "${p.name}"` : id;
}

function describeTargets(t: TargetSpec): string {
  const who = { any: "any player", enemy: "enemy", other: "another player", allyOrSelf: "ally or yourself", dead: "dead player" }[t.who];
  return `targets: ${t.upTo ? "up to " : "exactly "}${t.count} ${who}${t.count > 1 ? "s" : ""} (array of player ids)`;
}

function describeSpec(spec: ActionSpec, view: PlayerView): string {
  let desc: string;
  switch (spec.type) {
    case "chooseClass":
      desc = `chooseClass ${spec.classId}`;
      break;
    case "playCard":
      desc = `play ${cardName(spec.card ?? "?")} [${spec.card}]`;
      break;
    case "anytime":
      desc = `ANY-TIME discard ${cardName(spec.card ?? "?")} [${spec.card}] (interrupt)`;
      break;
    case "drawCard":
      desc = "draw a card (you may still play afterward)";
      break;
    case "endTurn":
      desc = "end your turn (no attack)";
      break;
    case "decide":
      desc = `answer the pending decision (supply "choice")`;
      break;
    case "concede":
      desc = "concede the game";
      break;
  }
  const needs: string[] = [];
  if (spec.needs?.targets) needs.push(describeTargets(spec.needs.targets));
  if (spec.needs?.attackTarget) needs.push("attackTarget: player id to aim your attack at");
  if (spec.needs?.chosenColor) needs.push("chosenColor: new active color");
  if (spec.needs?.extra === "declaredColor") {
    needs.push(`declaredColor: the color you declare this card to be (must be one of: ${(spec.needs.declareColors ?? []).join(", ") || "any"})`);
  } else if (spec.needs?.extra) {
    needs.push(`extra: { ${spec.needs.extra} }`);
  } else if (spec.needs?.declareColors) {
    needs.push(`declaredColor (optional): declare this card as any of: ${spec.needs.declareColors.join(", ")} — it becomes the new active color`);
  }
  return needs.length ? `${desc} — needs ${needs.join("; ")}` : desc;
}

/** Human line for an event; null = skip (noise). Trimmed mirror of the UI's
 * fmtEvent. `selfLabel` names the viewer: "YOU" in LLM prompts, the bot's
 * gamertag in terminal output. */
export function fmtEvent(e: GameEvent, view: PlayerView, selfLabel = "YOU"): string | null {
  const p = (id: unknown) => (id === view.you ? selfLabel : playerLabel(view, String(id)));
  switch (e.type) {
    case "TurnStarted":
      return `-- ${p(e.player)}'s turn ${e.turn}${e.actingAs !== e.player ? ` (played by ${p(e.actingAs)})` : ""}`;
    case "CardPlayed":
      return `${p(e.player)} played ${cardName(String(e.card))}`;
    case "DiceRolled":
      return `${p(e.roller)} rolled ${e.total}${e.loaded ? " (loaded)" : ""}`;
    case "DamageDealt":
      return `${p(e.src)} hit ${p(e.tgt)} for ${e.amount} (${e.hp} HP left)`;
    case "Healed":
      return `${p(e.target)} healed ${e.amount} (now ${e.hp} HP)`;
    case "SaveRolled":
      return `${p(e.roller)} save vs ${e.dc}: ${e.total} (${e.passed ? "passed" : "failed"})`;
    case "ColorChanged":
      return `active color is now ${String(e.color).toUpperCase()}`;
    case "ColorChosen":
      return `${p(e.by)} chose ${String(e.color).toUpperCase()}`;
    case "StatusApplied":
      return `${p(e.owner)} gains status: ${e.status}`;
    case "StatusExpired":
      return `status ${e.status} ends on ${p(e.owner)}`;
    case "Stunned":
      return `${p(e.target)} is stunned (${e.turns} turn(s))`;
    case "TurnSkipped":
      return `${p(e.player)}'s turn is skipped`;
    case "OrderReversed":
      return "play order reversed";
    case "DrewCard":
      return `${p(e.player)} drew a card`;
    case "CardDrawn":
      return `${selfLabel} drew ${cardName(String(e.card))}`;
    case "CardViewed":
      return `${selfLabel} sees: ${cardName(String(e.card))}`;
    case "AbilityTriggered":
      return `${p(e.player)} used ability: ${e.name}`;
    case "AttackBlocked":
      return `${p(e.player)} blocked the attack (${e.by})`;
    case "DamagePrevented":
      return `${p(e.target)} takes no damage`;
    case "IllEffectPrevented":
      return `${p(e.target)} shrugs off the effect`;
    case "PlayerDied":
      return `${p(e.player)} has DIED`;
    case "PlayerRevived":
      return `${p(e.player)} is revived at ${e.hp} HP`;
    case "PlayerWon":
      return `${p(e.player)} carded out — place ${e.place}!`;
    case "PlayerConceded":
      return `${p(e.player)} conceded`;
    case "GameEnded":
      return `GAME OVER — winner: ${p(e.winner)}`;
    case "TurnStolen":
      return `${p(e.by)} steals ${p(e.victim)}'s turn`;
    case "RageActivated":
      return `${p(e.player)} is RAGING (+${e.bonus})`;
    case "CardGiven":
      return `${p(e.by)} gives ${p(e.to)} ${cardName(String(e.card))}`;
    case "HandsSwapped":
      return `${p(e.a)} and ${p(e.b)} swap hands`;
    case "DeckReshuffled":
      return `deck reshuffled (${e.size} cards)`;
    case "ArcaneInfluence":
      return `${p(e.by)} warps ${p(e.roller)}'s roll: ${e.from} -> ${e.to} (Arcane Influence)`;
    case "CardsRevealed": {
      const list = (e.cards as string[]).map((c) => cardName(c)).join(", ");
      return `${p(e.from)} reveals to ${p(e.to)}: ${list || "no matching cards"}`;
    }
    case "DecisionRequested":
    case "TurnEnded":
    case "ClassChosen":
    case "Attack":
      return null;
    default:
      return e.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}

export function renderState(msg: StateMsg): string {
  const { view, legal, events } = msg;
  const you = view.players.find((p) => p.id === view.you);
  const lines: string[] = [];

  if (view.phase === "classSelect") {
    lines.push("== CLASS SELECT ==");
    lines.push(`You are ${playerLabel(view, view.you)} (seat ${you?.seat}).`);
    lines.push(`Players: ${view.players.map((p) => `${p.id} "${p.name}"`).join(", ")}. Mode: ${view.mode}.`);
    if (you?.hand) lines.push(`Your dealt hand: ${you.hand.map(cardName).join(", ")}`);
    lines.push("Pick a class that suits this hand (your class color cards trigger abilities).");
  } else {
    lines.push(`== BOARD (you are ${playerLabel(view, view.you)}) ==`);
    lines.push(
      `Field: active color ${view.activeColor.toUpperCase()}, active number ${view.activeNumber ?? "none"}` +
        ` (top card: ${view.topCard ? cardName(view.topCard) : "none"}).` +
        ` Direction: ${view.turn.direction === 1 ? "ascending seats" : "descending seats"}. Draw pile: ${view.drawPileCount}.`
    );
    lines.push(`Turn: ${playerLabel(view, view.turn.activePlayer)}${view.turn.actingPlayer !== view.turn.activePlayer ? ` (acted by ${playerLabel(view, view.turn.actingPlayer)})` : ""}${view.turn.hasDrawn ? " — has used the draw action" : ""}.`);
    lines.push("Players (by seat):");
    for (const p of [...view.players].sort((a, b) => a.seat - b.seat)) {
      const bits = [
        `seat ${p.seat}: ${p.id} "${p.name}"`,
        p.classId ? p.classId.toUpperCase() : "class hidden",
        `${p.hp}/${p.maxHp} HP`,
        `${p.handCount} cards`,
      ];
      if (p.status !== "active") bits.push(p.status.toUpperCase());
      if (p.statuses.length) bits.push(`statuses: ${p.statuses.map((s) => s.key).join(", ")}`);
      if (p.id === view.you) bits.push("<- YOU");
      else if (p.id === view.turn.activePlayer) bits.push("<- active turn");
      if (p.hand && p.id !== view.you) bits.push(`revealed hand: ${p.hand.map(cardName).join(", ")}`);
      lines.push("  " + bits.join(" | "));
    }
    if (you?.hand) {
      lines.push(`Your hand (${you.hand.length}): ${you.hand.map((c) => `${cardName(c)} [${c}]`).join(", ")}`);
    }
    if (view.placements.length) {
      lines.push(`Placements so far: ${view.placements.map((id, i) => `${i + 1}. ${playerLabel(view, id)}`).join("  ")}`);
    }
  }

  const evLines = events.map((e) => fmtEvent(e, view)).filter((l): l is string => l !== null);
  if (evLines.length) {
    lines.push("What just happened:");
    for (const l of evLines) lines.push("  " + l);
  }

  if (view.decision) {
    lines.push(`DECISION REQUIRED (${view.decision.kind}): ${view.decision.prompt}`);
    if (view.decision.options) lines.push(`  Options: ${JSON.stringify(view.decision.options)}`);
    lines.push(`  Default if you stall: ${JSON.stringify(view.decision.default)}`);
  }

  if (view.phase === "finished") {
    lines.push(`GAME FINISHED. Winner: ${view.winner ?? "none"}.`);
  }

  lines.push("LEGAL ACTIONS:");
  legal.forEach((spec, i) => lines.push(`  ${i}. ${describeSpec(spec, view)}`));
  lines.push("Reply with your JSON choice.");
  return lines.join("\n");
}
