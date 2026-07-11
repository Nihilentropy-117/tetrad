// Server-computed legal-action hints (§3.3). The client renders exactly this;
// it never re-derives rules.

import { card, isWild } from "./cards.js";
import { CLASSES } from "./classes/index.js";
import { abilityFor, actingPlayer, canPlayCard, isCardLocked } from "./engine.js";
import { matchesField } from "./cards.js";
import { player, statusesByKey } from "./state.js";
import type { ActionSpec, ClassId, GameState, PlayerId } from "./types.js";

export function legalActions(s: GameState, playerId: PlayerId): ActionSpec[] {
  if (s.phase === "finished") return [];
  if (s.pending) {
    return s.pending.decision.player === playerId
      ? [{ type: "decide", decisionId: s.pending.decision.id }]
      : [];
  }
  if (s.phase === "classSelect") {
    const p = player(s, playerId);
    if (p.pendingClass) return [];
    return (Object.keys(CLASSES) as ClassId[]).map((classId) => ({ type: "chooseClass", classId }));
  }
  if (s.stack.length > 0) return []; // mid-resolution
  if (actingPlayer(s) !== playerId) return [];
  const p = player(s, playerId);
  if (p.status !== "active") return [];

  const out: ActionSpec[] = [];
  const chameleon = statusesByKey(s, playerId, "chameleon").length > 0;
  for (const c of p.hand) {
    if (isCardLocked(s, playerId, c)) continue;
    const def = card(c);
    const matches = isWild(def) || matchesField(def, s.field.activeColor, s.field.activeNumber);
    if (!matches && !chameleon) continue;
    if (!canPlayCard(s, playerId, c)) continue;
    const ability = abilityFor(s, playerId, def);
    out.push({
      type: "playCard",
      card: c,
      needs: {
        targets: ability?.targets,
        attackTarget: !!ability && (ability.spec.attack === "grant" || ability.spec.attack === "retain"),
        chosenColor: isWild(def),
        extra: !matches && chameleon ? "declaredColor" : ability?.spec.extra,
      },
    });
  }
  if (!s.turn.hasDrawn) out.push({ type: "drawCard" });
  if (s.turn.hasDrawn) out.push({ type: "endTurn" });
  // SP8/M9: any-time cards, proactively on your own turn
  if (p.classId === "knight" || p.classId === "priest") {
    for (const c of p.hand) {
      if (card(c).number === 0) out.push({ type: "anytime", card: c });
    }
  }
  out.push({ type: "concede" });
  return out;
}
