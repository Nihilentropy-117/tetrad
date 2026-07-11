// A6 color-change semantics, Q18/Q19/Q21 — the heart of Tetrad's durations.

import { describe, expect, it } from "vitest";
import { hp, play, script, setup, statuses } from "./helpers.js";

describe("color-change semantics (A6)", () => {
  it("Q6/Q19: the acting player's own until-color-change effect survives their own change until end of turn", () => {
    let s = setup(["warlock", "zerker"], {
      field: "blue-9-a",
      hands: { p0: ["wild-advantage-a", "yellow-4-a", "red-1-a"], p1: ["blue-4-a", "blue-6-a"] },
    });
    // turn 1: pact demon; same color chosen → NOT a color change (Q18a)
    script(s, [1, 1]);
    s = play(s, "p0", "wild-advantage-a", { chosenColor: "blue" });
    expect(s.colorChangeCount).toBe(0);
    expect(statuses(s, "p0")).toContain("pact");
    expect(hp(s, "p1")).toBe(110 - (1 + 1 + 6)); // pact: +6 on all attacks

    // zerker answers in blue (no change; pact persists)
    script(s, [2, 2]);
    s = play(s, "p1", "blue-4-a");
    expect(hp(s, "p0")).toBe(100 - 4);
    expect(statuses(s, "p0")).toContain("pact");

    // turn 2: warlock plays yellow-4 (number match on 4) → color changes,
    // but the attack from that very card still carries the pact bonus (Q6)
    script(s, [3, 3]);
    s = play(s, "p0", "yellow-4-a");
    expect(s.colorChangeCount).toBe(1);
    expect(hp(s, "p1")).toBe(110 - (1 + 1 + 6) - (3 + 3 + 6));
    // ...and the pact is gone once the turn has ended
    expect(statuses(s, "p0")).not.toContain("pact");
  });

  it("A6: another player's color change ends your effect immediately", () => {
    let s = setup(["knight", "zerker"], {
      field: "red-9-a",
      hands: { p0: ["wild-advantage-b", "red-2-a"], p1: ["wild-advantage-c", "blue-5-a"] },
    });
    // knight: Multi-layered Defense (-1 until color change), keeps red
    script(s, [1, 1]);
    s = play(s, "p0", "wild-advantage-b", { chosenColor: "red" });
    expect(statuses(s, "p0")).toContain("layeredDefense");
    // zerker changes the color via his own wild → knight's defense drops
    // BEFORE the attack resolves (zerker's Advantage also starts Battle Rage)
    script(s, [2, 2]);
    s = play(s, "p1", "wild-advantage-c", { chosenColor: "blue" });
    expect(statuses(s, "p0")).not.toContain("layeredDefense");
    // 2d6 + wild color bonus (+3) + battle rage (+3), no -1 applied
    expect(hp(s, "p0")).toBe(100 - (2 + 2 + 3 + 3));
  });

  it("Q21: War Rage survives 2 changes and continues when the Zerker returns to the anchor color", () => {
    let s = setup(["zerker", "priest"], {
      field: "red-9-a",
      hands: {
        p0: ["wild-inspiration-a", "wild-advantage-b", "green-2-a"],
        p1: ["wild-advantage-a", "blue-5-b"],
      },
    });
    // War Rage anchored to red (same color → no change; 2-change duration)
    script(s, [1, 1]);
    s = play(s, "p0", "wild-inspiration-a", { chosenColor: "red", targets: ["p1"] });
    expect(statuses(s, "p0")).toContain("rage");
    // priest wilds red → blue (1st change): rage survives (needs 2)
    script(s, [2]);
    s = play(s, "p1", "wild-advantage-a", { chosenColor: "blue" });
    expect(statuses(s, "p0")).toContain("rage");
    // zerker wilds back to the anchor color → War Rage extends (Q21)
    script(s, [4, 4, 6, 6]);
    s = play(s, "p0", "wild-advantage-b", { chosenColor: "red" });
    expect(statuses(s, "p0")).toContain("rage");
    expect(s.colorChangeCount).toBe(2);
  });

  it("Q18a: choosing the current color with a wild does not tick durations", () => {
    let s = setup(["priest", "zerker"], { field: "yellow-9-a", hands: { p0: ["wild-advantage-c", "yellow-2-a"] } });
    script(s, [1, 1]);
    s = play(s, "p0", "wild-advantage-c", { chosenColor: "yellow" }); // sanctuary
    expect(s.colorChangeCount).toBe(0);
    expect(statuses(s, "p0")).toContain("sanctuary");
  });
});

describe("TH-A Surprise! (armed color-change trigger)", () => {
  it("zaps the next player to change the color", () => {
    let s = setup(["thief", "zerker"], {
      field: "green-9-a",
      hands: { p0: ["wild-advantage-a", "green-4-a"], p1: ["wild-advantage-b", "blue-5-a"] },
    });
    script(s, [1]);
    s = play(s, "p0", "wild-advantage-a", { chosenColor: "green" }); // trap set, no change
    expect(s.effects.some((e) => e.key === "surprise")).toBe(true);
    expect(hp(s, "p1")).toBe(110 - (1 + 7)); // the Advantage's own granted attack
    // zerker wilds green → blue and takes 1d6+7 from the trap
    script(s, [2, 2, 6]);
    s = play(s, "p1", "wild-advantage-b", { chosenColor: "blue" });
    expect(hp(s, "p1")).toBe(110 - (1 + 7) - (6 + 7));
    expect(s.effects.some((e) => e.key === "surprise")).toBe(false);
  });
});
