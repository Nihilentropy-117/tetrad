import { describe, expect, it } from "vitest";
import { buildDeck, card, defenderMin, matchesField, scriptedRng, seedFromString } from "../src/index.js";
import { rollD6 } from "../src/rng.js";
import { initialState } from "../src/index.js";

describe("deck composition (Q1 / D1)", () => {
  const deck = buildDeck();

  it("has exactly 108 cards", () => {
    expect(deck.length).toBe(108);
  });

  it("matches the UNO-derived composition per color", () => {
    for (const color of ["red", "blue", "green", "yellow"]) {
      const ofColor = deck.filter((c) => c.color === color);
      expect(ofColor.filter((c) => c.number === 0).length).toBe(1);
      for (let n = 1; n <= 9; n++) {
        expect(ofColor.filter((c) => c.number === n).length).toBe(2);
      }
      expect(ofColor.filter((c) => c.kind === "stun").length).toBe(2);
      expect(ofColor.filter((c) => c.kind === "counter").length).toBe(2);
      expect(ofColor.filter((c) => c.kind === "rally").length).toBe(2);
    }
    expect(deck.filter((c) => c.kind === "advantage").length).toBe(4);
    expect(deck.filter((c) => c.kind === "inspiration").length).toBe(4);
  });
});

describe("matching (T2 / D2 / SP4-SP6)", () => {
  it("matches on color or number", () => {
    expect(matchesField(card("red-3-a"), "red", 7)).toBe(true);
    expect(matchesField(card("blue-7-a"), "red", 7)).toBe(true);
    expect(matchesField(card("blue-3-a"), "red", 7)).toBe(false);
  });
  it("stun/counter/rally match cross-color on their pseudo-number", () => {
    expect(matchesField(card("blue-stun-a"), "red", 11)).toBe(true);
    expect(matchesField(card("blue-counter-a"), "red", 11)).toBe(false);
    expect(matchesField(card("green-rally-a"), "red", 13)).toBe(true);
  });
  it("wilds always match; 0 matches color or another 0 (SP6)", () => {
    expect(matchesField(card("wild-advantage-a"), "red", 5)).toBe(true);
    expect(matchesField(card("wild-inspiration-a"), "yellow", null)).toBe(true);
    expect(matchesField(card("blue-0-a"), "red", 0)).toBe(true);
    expect(matchesField(card("blue-0-a"), "blue", 5)).toBe(true);
    expect(matchesField(card("blue-0-a"), "red", 5)).toBe(false);
  });
});

describe("rng determinism", () => {
  it("same seed produces the same faces", () => {
    const a = initialState({ mode: "ffa", players: [{ id: "a", name: "a" }, { id: "b", name: "b" }], dealerSeat: 0 }, "s1");
    const b = initialState({ mode: "ffa", players: [{ id: "a", name: "a" }, { id: "b", name: "b" }], dealerSeat: 0 }, "s1");
    expect(a.drawPile).toEqual(b.drawPile);
    const fa = Array.from({ length: 20 }, () => rollD6(a));
    const fb = Array.from({ length: 20 }, () => rollD6(b));
    expect(fa).toEqual(fb);
  });
  it("scripted rng feeds exact faces and then throws", () => {
    const s = initialState({ mode: "ffa", players: [{ id: "a", name: "a" }, { id: "b", name: "b" }], dealerSeat: 0 }, "s1");
    s.rng = scriptedRng([3, 6]);
    expect(rollD6(s)).toBe(3);
    expect(rollD6(s)).toBe(6);
    expect(() => rollD6(s)).toThrow();
  });
  it("hashes seeds stably", () => {
    expect(seedFromString("tetrad")).toBe(seedFromString("tetrad"));
    expect(seedFromString("tetrad")).not.toBe(seedFromString("tetrad2"));
  });
});

describe("defender-min pipeline (Q16 / C2)", () => {
  it("picks the defender-optimal ordering", () => {
    // 30 incoming, save-half, -2 reduction, frenzy-taken x2 → best is 26
    expect(defenderMin(30, [0.5, 2], [-2])).toBe(26);
  });
  it("halving before flats favors the defender", () => {
    expect(defenderMin(30, [0.5], [-2])).toBe(13);
  });
  it("never goes below zero", () => {
    expect(defenderMin(3, [], [-10])).toBe(0);
  });
});
