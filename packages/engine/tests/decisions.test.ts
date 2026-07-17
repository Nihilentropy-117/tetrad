// Regression tests: decision prompts must carry pickable options, and
// reveal/roll events must carry enough data for the client to render them.

import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.js";
import { assertConservation, decide, hand, hp, okEv, play, script, setup } from "./helpers.js";

describe("SC-4 Prepared", () => {
  it("offers the whole hand as discard options and honors the picks", () => {
    let s = setup(["scout", "zerker"], {
      field: "green-9-a",
      hands: { p0: ["green-4-a", "green-1-a"] },
    });
    script(s, [5]);
    s = play(s, "p0", "green-4-a");
    // Prepared's draw-2 routes through SC-P: draw 4, keep 2, return 2
    expect(s.pending?.decision.kind).toBe("scoutReturn");
    s = decide(s);
    expect(s.pending?.decision.kind).toBe("discard2");
    const d = s.pending!.decision;
    const h = [...hand(s, "p0")];
    expect(h.length).toBe(3); // green-1-a + 2 kept draws
    expect(d.options).toEqual(h); // every card must be pickable
    const picks = [h[1], h[2]];
    s = decide(s, picks);
    for (const c of picks) {
      expect(hand(s, "p0")).not.toContain(c);
      expect(s.field.underPile).toContain(c); // SP7
    }
    expect(s.effects.some((e) => e.owner === "p0" && e.key === "redirectIll")).toBe(true);
    assertConservation(s);
  });
});

describe("SO-R Fate Maker", () => {
  it("asks per card with player options; both cards may go to the same player (8 dmg each)", () => {
    let s = setup(["sorcerer", "zerker"], {
      field: "blue-9-a",
      hands: { p0: ["blue-rally-a"] },
    });
    const top2 = s.drawPile.slice(-2); // the two cards Fate Maker will draw
    script(s, [3]);
    s = play(s, "p0", "blue-rally-a");
    expect(hp(s, "p1")).toBe(110 - (3 + 3)); // rally attack resolves first
    // first card
    expect(s.pending?.decision.kind).toBe("fateAssign");
    expect(s.pending?.decision.options).toEqual(["p0", "p1"]);
    s = decide(s, "p1");
    // second card — a separate pick, so duplicates are possible
    expect(s.pending?.decision.kind).toBe("fateAssign");
    s = decide(s, "p1");
    expect(hand(s, "p1")).toEqual(expect.arrayContaining(top2));
    expect(hp(s, "p1")).toBe(110 - (3 + 3) - 16);
    assertConservation(s);
  });

  it("keeps both cards damage-free when the Sorcerer assigns them to himself", () => {
    let s = setup(["sorcerer", "zerker"], {
      field: "blue-9-a",
      hands: { p0: ["blue-rally-a"] },
    });
    script(s, [3]);
    s = play(s, "p0", "blue-rally-a");
    s = decide(s, "p0");
    s = decide(s, "p0");
    expect(hand(s, "p0").length).toBe(2);
    expect(hp(s, "p1")).toBe(110 - (3 + 3)); // only the attack
    assertConservation(s);
  });
});

describe("SO-A Arcane Influence", () => {
  it("emits the original roll first, then the adjustment (from → to)", () => {
    let s = setup(["sorcerer", "zerker"], {
      field: "blue-9-a",
      hands: { p0: ["wild-advantage-a", "blue-1-a"], p1: ["blue-4-a"] },
    });
    script(s, [1]); // sorcerer's granted attack: raw 1, self-influence → 3
    s = play(s, "p0", "wild-advantage-a", { chosenColor: "blue" }); // no color change (Q18a)
    expect(hp(s, "p1")).toBe(110 - (3 + 3)); // adjusted roll + SO-P bonus
    script(s, [3, 3]);
    const { s: s2, events } = okEv(
      applyAction(s, { type: "playCard", player: "p1", card: "blue-4-a" })
    );
    const rolled = events.find((e) => e.type === "DiceRolled" && e.roller === "p1")!;
    expect(rolled.total).toBe(6); // the original, pre-influence roll
    const infl = events.find((e) => e.type === "ArcaneInfluence")!;
    expect(infl).toMatchObject({ by: "p0", roller: "p1", from: 6, to: 4 });
    expect(events.indexOf(rolled)).toBeLessThan(events.indexOf(infl));
    expect(hp(s2, "p0")).toBe(80 - 4); // damage uses the adjusted total
  });
});

describe("PA-I Zone of Truth", () => {
  it("emits CardsRevealed with the matched cards, private to both parties", () => {
    const s = setup(["paladin", "zerker"], {
      field: "yellow-9-a",
      hands: { p0: ["wild-inspiration-a"], p1: ["blue-3-a", "blue-7-a", "red-2-a"] },
    });
    script(s, [2]);
    const { events } = okEv(
      applyAction(s, {
        type: "playCard",
        player: "p0",
        card: "wild-inspiration-a",
        chosenColor: "yellow",
        targets: ["p1"],
        extra: { reveal: { mode: "color", value: "blue" } },
      })
    );
    const ev = events.find((e) => e.type === "CardsRevealed")!;
    expect(ev.cards).toEqual(["blue-3-a", "blue-7-a"]);
    expect(ev.private).toEqual(["p0", "p1"]);
  });
});
