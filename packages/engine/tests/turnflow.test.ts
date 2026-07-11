// Core turn flow: T1-T7, F1/F2, color bonus (T5), and one-play-per-turn.

import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.js";
import { act, assertConservation, hand, hp, play, script, setup } from "./helpers.js";

describe("turn flow", () => {
  it("T5: Thief deals 1d6 off-color and 1d6+7 on green (designer example, Q2)", () => {
    // on-color
    let s = setup(["thief", "priest"], { field: "green-9-a", hands: { p0: ["green-3-a"] } });
    script(s, [4]);
    s = play(s, "p0", "green-3-a"); // TH-3: dodge armed + granted attack
    expect(hp(s, "p1")).toBe(100 - (4 + 7));

    // off-color
    let s2 = setup(["thief", "priest"], { field: "red-9-a", hands: { p0: ["red-3-a"] } });
    script(s2, [4]);
    s2 = play(s2, "p0", "red-3-a"); // plain card
    expect(hp(s2, "p1")).toBe(100 - 4);
  });

  it("T4: a plain play attacks the next player and ends the turn", () => {
    let s = setup(["zerker", "priest"], { field: "red-9-a", hands: { p0: ["red-4-a", "red-6-a"] } });
    script(s, [3, 4]);
    s = play(s, "p0", "red-4-a"); // zerker even number → no ability
    expect(hp(s, "p1")).toBe(100 - (3 + 4 + 3)); // 2d6 + color bonus 3
    expect(s.turn.activePlayer).toBe("p1");
    assertConservation(s);
  });

  it("F1/F2: draw-then-play resolves fully, attack included", () => {
    let s = setup(["zerker", "priest"], { field: "red-5-a", hands: { p0: ["red-7-a", "blue-2-a"] } });
    s = act(s, { type: "drawCard", player: "p0" });
    expect(hand(s, "p0").length).toBe(3);
    expect(s.turn.activePlayer).toBe("p0"); // turn not over yet
    script(s, [3, 3]);
    s = play(s, "p0", "red-7-a"); // ZK-7 grant → attack still happens (F1)
    expect(hp(s, "p1")).toBe(100 - (3 + 3 + 3));
    expect(s.turn.activePlayer).toBe("p1");
  });

  it("Q3: draw and decline to play → turn ends with no attack", () => {
    let s = setup(["zerker", "priest"], { field: "red-5-a" });
    s = act(s, { type: "drawCard", player: "p0" });
    s = act(s, { type: "endTurn", player: "p0" });
    expect(hp(s, "p1")).toBe(100);
    expect(s.turn.activePlayer).toBe("p1");
  });

  it("M2: only one draw action per turn; endTurn requires having drawn", () => {
    let s = setup(["zerker", "priest"], { field: "red-5-a" });
    const early = applyAction(s, { type: "endTurn", player: "p0" });
    expect(early.ok).toBe(false);
    s = act(s, { type: "drawCard", player: "p0" });
    const again = applyAction(s, { type: "drawCard", player: "p0" });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.error.code).toBe("alreadyDrew");
  });

  it("one play per turn: after playing it is the next player's turn", () => {
    let s = setup(["zerker", "priest"], { field: "red-5-a", hands: { p0: ["red-4-a", "red-6-a"] } });
    script(s, [1, 1]);
    s = play(s, "p0", "red-4-a");
    const r = applyAction(s, { type: "playCard", player: "p0", card: "red-6-a" });
    expect(r.ok).toBe(false);
  });

  it("T2: non-matching cards are rejected", () => {
    const s = setup(["zerker", "priest"], { field: "red-5-a", hands: { p0: ["blue-4-a"] } });
    const r = applyAction(s, { type: "playCard", player: "p0", card: "blue-4-a" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("noMatch");
  });

  it("T7: ZK-3 Frenzy doubles damage dealt and taken until color change", () => {
    let s = setup(["zerker", "priest"], {
      field: "red-9-a",
      hands: { p0: ["red-3-a", "red-6-b"], p1: ["red-1-a", "red-2-b"] },
    });
    script(s, [3, 4, 5]);
    s = play(s, "p0", "red-3-a"); // frenzy + granted attack ×2
    expect(hp(s, "p1")).toBe(100 - (3 + 4 + 3) * 2);
    // priest plays red (no color change → frenzy persists) and hits back
    s = play(s, "p1", "red-1-a"); // off-color for priest → plain
    expect(hp(s, "p0")).toBe(110 - 5 * 2);
  });

  it("SP1: a generic Stun hits and skips the next player", () => {
    let s = setup(["priest", "zerker"], { field: "red-9-a", hands: { p0: ["red-stun-a"] } });
    script(s, [3]);
    s = play(s, "p0", "red-stun-a"); // priest+red → generic stun
    expect(hp(s, "p1")).toBe(110 - 3); // 1d6, no bonus (red ≠ yellow)
    expect(s.turn.activePlayer).toBe("p0"); // zerker's turn was consumed
    expect(s.effects.filter((e) => e.owner === "p1" && e.key === "stunned").length).toBe(0);
  });

  it("SP2: a Counter reverses order and hits the last aggressor with color bonus", () => {
    let s = setup(["zerker", "priest", "thief"], {
      field: "red-9-a",
      hands: { p0: ["red-counter-a", "red-7-a"] },
    });
    s.players[0].lastHitBy = "p2";
    script(s, [2, 2]);
    s = play(s, "p0", "red-counter-a"); // zerker is odd → generic counter
    expect(s.turn.direction).toBe(-1);
    expect(hp(s, "p2")).toBe(100 - (2 + 2 + 3)); // red = zerker color
    expect(s.turn.activePlayer).toBe("p2"); // reversed order
  });

  it("SP3: an off-color Rally attacks the next player and they draw 2", () => {
    let s = setup(["zerker", "priest"], { field: "blue-9-a", hands: { p0: ["blue-rally-a"] } });
    script(s, [1, 1]);
    s = play(s, "p0", "blue-rally-a");
    expect(hp(s, "p1")).toBe(100 - 2);
    expect(hand(s, "p1").length).toBe(9);
    assertConservation(s);
  });
});
