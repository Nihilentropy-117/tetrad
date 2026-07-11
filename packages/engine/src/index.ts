// @tetrad/engine — pure, deterministic Tetrad rules engine.
// applyAction(state, action) -> { state, events } | { error }; no I/O, no
// ambient randomness (RNG lives in GameState), no framework dependencies.

export * from "./types.js";
export { applyAction, RuleError, abilityKeyFor, abilityFor, actingPlayer, canPlayCard, isCardLocked } from "./engine.js";
export { legalActions } from "./legality.js";
export { redact, eventsFor, type PlayerView } from "./redact.js";
export { initialState, player, nextEnemy, enemiesOf, statusesOn, statusesByKey, modsFor, hasRage } from "./state.js";
export { buildDeck, card, allCardIds, matchesField, effectiveNumber, isWild, STANDARD_DECK } from "./cards.js";
export { CLASSES, classDef, HOLY } from "./classes/index.js";
export { makeRng, scriptedRng, seedFromString } from "./rng.js";
export { defenderMin } from "./combat.js";
