// Deck composition (DESIGN.md §1.3, ruling Q1): UNO-derived 108 cards.
// This file is data (D1) — tune counts here without touching the engine.

import { COLORS, type CardDef, type CardId, type Color } from "./types.js";

export interface DeckSpec {
  perColor: {
    zeros: number; // Tetrad/Ultimate (SP6)
    numbers: number; // copies of each of 1-9
    stuns: number;
    counters: number;
    rallies: number;
  };
  advantages: number; // wild
  inspirations: number; // wild draw 4
}

export const STANDARD_DECK: DeckSpec = {
  perColor: { zeros: 1, numbers: 2, stuns: 2, counters: 2, rallies: 2 },
  advantages: 4,
  inspirations: 4,
};

const COPY = "abcdefgh";

export function buildDeck(spec: DeckSpec = STANDARD_DECK): CardDef[] {
  const cards: CardDef[] = [];
  for (const color of COLORS) {
    for (let c = 0; c < spec.perColor.zeros; c++) {
      cards.push({ id: `${color}-0-${COPY[c]}`, kind: "number", color, number: 0 });
    }
    for (let num = 1; num <= 9; num++) {
      for (let c = 0; c < spec.perColor.numbers; c++) {
        cards.push({ id: `${color}-${num}-${COPY[c]}`, kind: "number", color, number: num });
      }
    }
    for (let c = 0; c < spec.perColor.stuns; c++) {
      cards.push({ id: `${color}-stun-${COPY[c]}`, kind: "stun", color, number: null });
    }
    for (let c = 0; c < spec.perColor.counters; c++) {
      cards.push({ id: `${color}-counter-${COPY[c]}`, kind: "counter", color, number: null });
    }
    for (let c = 0; c < spec.perColor.rallies; c++) {
      cards.push({ id: `${color}-rally-${COPY[c]}`, kind: "rally", color, number: null });
    }
  }
  for (let c = 0; c < spec.advantages; c++) {
    cards.push({ id: `wild-advantage-${COPY[c]}`, kind: "advantage", color: null, number: null });
  }
  for (let c = 0; c < spec.inspirations; c++) {
    cards.push({ id: `wild-inspiration-${COPY[c]}`, kind: "inspiration", color: null, number: null });
  }
  return cards;
}

const DECK = buildDeck();
const BY_ID = new Map<CardId, CardDef>(DECK.map((c) => [c.id, c]));

export function card(id: CardId): CardDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown card: ${id}`);
  return c;
}

export function allCardIds(): CardId[] {
  return DECK.map((c) => c.id);
}

/** Matching pseudo-number (D2): stun=11, counter=12, rally=13, wilds none. */
export function effectiveNumber(c: CardDef): number | null {
  switch (c.kind) {
    case "number":
      return c.number;
    case "stun":
      return 11;
    case "counter":
      return 12;
    case "rally":
      return 13;
    default:
      return null;
  }
}

export function isWild(c: CardDef): boolean {
  return c.kind === "advantage" || c.kind === "inspiration";
}

/** T2/SP4/SP5/SP6: may `c` be played on the current field? */
export function matchesField(
  c: CardDef,
  activeColor: Color,
  activeNumber: number | null
): boolean {
  if (isWild(c)) return true;
  if (c.color === activeColor) return true;
  const n = effectiveNumber(c);
  return n !== null && activeNumber !== null && n === activeNumber;
}
