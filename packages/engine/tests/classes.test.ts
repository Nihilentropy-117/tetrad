// Class ability scenarios with scripted dice (rule IDs in test names).

import { describe, expect, it } from "vitest";
import { applyAction, redact } from "../src/index.js";
import { act, assertConservation, decide, hand, hp, play, script, setup, statuses } from "./helpers.js";

describe("Warlock", () => {
  it("WL-1 Life Drain: damage 2d6+1 and heal for the damage done", () => {
    let s = setup(["warlock", "zerker"], { field: "blue-9-a", hands: { p0: ["blue-1-a"] } });
    s.players[0].hp = 90;
    script(s, [2, 3]);
    s = play(s, "p0", "blue-1-a", { targets: ["p1"] });
    expect(hp(s, "p1")).toBe(110 - 6);
    expect(hp(s, "p0")).toBe(96);
  });

  it("WL-S Cursed Soul Link: stun + mirror damage to the linked target", () => {
    let s = setup(["warlock", "zerker", "priest"], {
      field: "blue-9-a",
      hands: { p0: ["blue-stun-a", "blue-4-a"], p2: ["blue-8-a", "blue-6-a"] },
    });
    script(s, [1, 1]);
    s = play(s, "p0", "blue-stun-a", { targets: ["p1"] }); // stun zerker + link
    expect(hp(s, "p1")).toBe(110 - 3); // 2d6+1 (blue = warlock color)
    // zerker's turn is skipped; priest attacks the warlock; link mirrors
    script(s, [4]);
    s = play(s, "p2", "blue-8-a");
    expect(hp(s, "p0")).toBe(100 - 4);
    expect(hp(s, "p1")).toBe(110 - 3 - 4); // mirrored
  });

  it("WL-I Delirium: Warlock steals the target's turn and plays from his own hand (Q25)", () => {
    let s = setup(["warlock", "zerker"], {
      field: "blue-9-a",
      hands: { p0: ["wild-inspiration-a", "blue-1-a", "green-1-a"] },
    });
    s.players[0].hp = 90;
    script(s, [1, 1]);
    s = play(s, "p0", "wild-inspiration-a", { chosenColor: "blue", targets: ["p1"] });
    expect(hand(s, "p1").length).toBe(11); // 7 + draw 4
    expect(s.turn.activePlayer).toBe("p1");
    expect(s.turn.stolenBy).toBe("p0"); // stolen!
    script(s, [2, 2]);
    s = play(s, "p0", "blue-1-a", { targets: ["p1"] }); // warlock acts on p1's turn
    expect(hp(s, "p1")).toBe(110 - (1 + 1 + 1) - 5);
    expect(s.turn.activePlayer).toBe("p0"); // warlock's own turn still arrives (Q25)
    expect(s.turn.stolenBy).toBe(null);
  });
});

describe("Knight", () => {
  it("KN-C Shield Master: upon taking damage, stun the attacker and force a draw", () => {
    let s = setup(["knight", "zerker"], {
      field: "red-9-a",
      hands: { p0: ["red-counter-a", "red-6-b"], p1: ["red-4-a"] },
    });
    script(s, [2, 2]);
    s = play(s, "p0", "red-counter-a"); // KN-C armed + counter hit
    expect(hp(s, "p1")).toBe(110 - (2 + 2 + 2));
    script(s, [3, 3]);
    s = play(s, "p1", "red-4-a"); // zerker hits the knight → trigger
    expect(hp(s, "p0")).toBe(100 - (3 + 3 + 3));
    expect(statuses(s, "p1")).toContain("stunned");
    expect(hand(s, "p1").length).toBe(1); // played 1 of 1... drew 1 back
    // zerker's next turn is skipped
    expect(s.turn.activePlayer).toBe("p0");
  });

  it("KN-8 Heavy Handed: roll twice, take the better", () => {
    let s = setup(["knight", "zerker"], { field: "red-9-a", hands: { p0: ["red-8-a"] } });
    script(s, [1, 1, 6, 6]);
    s = play(s, "p0", "red-8-a", { targets: ["p1"] });
    expect(hp(s, "p1")).toBe(110 - (12 + 4));
  });
});

describe("Sorcerer", () => {
  it("SO-P Arcane Flux: +2 HP per card drawn; attacks always carry the bonus", () => {
    let s = setup(["sorcerer", "zerker"], { field: "red-9-a", hands: { p0: ["red-2-a"] } });
    s.players[0].hp = 70;
    s = act(s, { type: "drawCard", player: "p0" });
    expect(hp(s, "p0")).toBe(72);
    script(s, [4]);
    s = play(s, "p0", "red-2-a"); // off-color plain card, bonus applies anyway
    expect(hp(s, "p1")).toBe(110 - (4 + 3));
  });

  it("SO-I Fireball: 30 split equally, everyone draws 2 (replaces the draw-4)", () => {
    let s = setup(["sorcerer", "zerker", "thief", "priest"], {
      field: "red-9-a",
      hands: { p0: ["wild-inspiration-a"] },
    });
    s = play(s, "p0", "wild-inspiration-a", { chosenColor: "blue" });
    for (const pid of ["p1", "p2", "p3"] as const) {
      expect(hand(s, pid).length).toBe(9);
    }
    expect(hp(s, "p1")).toBe(110 - 10);
    expect(hp(s, "p2")).toBe(100 - 10);
    expect(hp(s, "p3")).toBe(100 - 10);
    assertConservation(s);
  });
});

describe("Scout", () => {
  it("SC-P Calculated Risk: draw N+2, keep N, stack 2 back in chosen order", () => {
    let s = setup(["scout", "zerker"], { field: "red-9-a" });
    const pileTop = s.drawPile.slice(-3); // will be popped in reverse order
    const [c1, c2, c3] = [pileTop[2], pileTop[1], pileTop[0]];
    const r = applyAction(s, { type: "drawCard", player: "p0" });
    expect(r.ok).toBe(true);
    s = r.ok ? r.state : s;
    expect(s.pending?.decision.kind).toBe("scoutReturn");
    s = decide(s, [c1, c2]); // return the first two staged, keep c3
    expect(hand(s, "p0")).toContain(c3);
    expect(s.drawPile[s.drawPile.length - 1]).toBe(c1); // next draw = c1
    expect(s.drawPile[s.drawPile.length - 2]).toBe(c2);
    assertConservation(s);
  });

  it("SC-0 Battlefield Intelligence: enemies' hands revealed for 2 color changes", () => {
    let s = setup(["scout", "paladin"], {
      field: "green-9-a",
      hands: {
        p0: ["green-0-a", "yellow-3-b", "red-5-a", "red-1-a"],
        p1: ["green-3-a", "yellow-5-a", "blue-7-a"],
      },
    });
    s = play(s, "p0", "green-0-a", { attackTarget: "p1" });
    expect(statuses(s, "p1")).toContain("revealed");
    // scout's view now includes the enemy hand; the enemy still can't see scout's
    expect(redact(s, "p0").players.find((p) => p.id === "p1")?.hand).toEqual(hand(s, "p1"));
    expect(redact(s, "p1").players.find((p) => p.id === "p0")?.hand).toBeUndefined();
    s = play(s, "p1", "green-3-a"); // no color change
    s = play(s, "p0", "yellow-3-b"); // color change 1
    expect(redact(s, "p0").players.find((p) => p.id === "p1")?.hand).toEqual(hand(s, "p1"));
    s = play(s, "p1", "yellow-5-a");
    s = play(s, "p0", "red-5-a"); // color change 2 — reveal expires
    expect(statuses(s, "p1")).not.toContain("revealed");
    expect(redact(s, "p0").players.find((p) => p.id === "p1")?.hand).toBeUndefined();
    assertConservation(s);
  });
});

describe("Priest", () => {
  it("PR-A Sanctuary blocks damage unless the attacker saves 9", () => {
    let s = setup(["priest", "zerker"], {
      field: "red-5-a",
      hands: { p0: ["wild-advantage-a", "yellow-2-a"], p1: ["yellow-4-a", "yellow-6-a"] },
    });
    script(s, [2]);
    s = play(s, "p0", "wild-advantage-a", { chosenColor: "yellow" });
    expect(hp(s, "p1")).toBe(110 - (2 + 3)); // granted attack, wild bonus
    // zerker attacks: 2d6 rolled, then save 9 fails → prevented
    script(s, [3, 3, 2, 2]);
    s = play(s, "p1", "yellow-4-a");
    expect(hp(s, "p0")).toBe(100);
  });

  it("C7: Priest's 0 interrupts a card-out and forces a draw of 5", () => {
    let s = setup(["zerker", "priest"], {
      field: "red-9-a",
      hands: { p0: ["red-5-a"], p1: ["yellow-0-a", "yellow-1-a"] },
    });
    script(s, [1, 1, 1]);
    let r = applyAction(s, { type: "playCard", player: "p0", card: "red-5-a", targets: ["p1"] });
    expect(r.ok).toBe(true);
    s = r.ok ? r.state : s;
    expect(s.pending?.decision.kind).toBe("pr0Window");
    s = decide(s, true);
    expect(hand(s, "p0").length).toBe(5); // forced back into the game
    expect(s.placements.length).toBe(0);
    expect(s.phase).toBe("playing");
    expect(s.drawPile[0]).toBe("yellow-0-a"); // SP8: bottom of the deck
    assertConservation(s);
  });

  it("T8: an uninterrupted card-out wins", () => {
    let s = setup(["zerker", "priest"], {
      field: "red-9-a",
      hands: { p0: ["red-5-a"], p1: ["yellow-1-a"] }, // no priest 0 in hand
    });
    script(s, [1, 1, 1]);
    s = play(s, "p0", "red-5-a", { targets: ["p1"] });
    expect(s.players[0].status).toBe("won");
    expect(s.placements[0]).toBe("p0");
    expect(s.winner).toBe("p0");
    expect(s.phase).toBe("finished"); // 2p: nobody left to play on
  });

  it("Q10/M5: a dying Priest holding a 0 self-revives at 50% and draws 5", () => {
    let s = setup(["zerker", "priest"], {
      field: "red-9-a",
      hands: { p0: ["red-5-a", "red-1-b"], p1: ["yellow-0-a", "yellow-3-a"] },
    });
    s.players[1].hp = 5;
    script(s, [2, 2, 2]);
    let r = applyAction(s, { type: "playCard", player: "p0", card: "red-5-a", targets: ["p1"] });
    expect(r.ok).toBe(true);
    s = r.ok ? r.state : s;
    expect(s.pending?.decision.kind).toBe("deathAnytime");
    expect(s.pending?.decision.default).toBe(true); // priest defaults to self-save
    s = decide(s);
    const priest = s.players[1];
    expect(priest.status).toBe("active");
    expect(priest.hp).toBe(50);
    expect(priest.hand.length).toBe(5);
    expect(s.phase).toBe("playing");
    expect(s.drawPile[0]).toBe("yellow-0-a");
    assertConservation(s);
  });
});

describe("Thief", () => {
  it("TH-7 Loaded Dice arms after the granted attack (Q28)", () => {
    let s = setup(["thief", "zerker"], { field: "green-9-a", hands: { p0: ["green-7-a", "green-4-b"] } });
    script(s, [2]);
    s = play(s, "p0", "green-7-a");
    expect(hp(s, "p1")).toBe(110 - (2 + 7)); // attack rolled normally
    expect(statuses(s, "p0")).toContain("loadedDice"); // still armed for the next roll
  });
});

describe("teams (Q12/C8)", () => {
  it("attacks target the next enemy, and an ally carding out wins for the team", () => {
    let s = setup(["zerker", "priest", "knight", "warlock"], {
      mode: "teams",
      field: "red-9-a",
      hands: { p0: ["red-4-a"], p1: ["yellow-1-a"] },
    });
    script(s, [1, 1]);
    s = play(s, "p0", "red-4-a"); // p0 (team0) hits p1 (team1)
    expect(hp(s, "p1")).toBe(100 - (1 + 1 + 3));
    expect(s.players[0].status).toBe("won"); // hand emptied → team win, immediate
    expect(s.winner).toBe("team0");
    expect(s.phase).toBe("finished");
  });
});
