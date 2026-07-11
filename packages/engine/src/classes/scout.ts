// Scout — GREEN, EVEN, 95 HP, 1d6 (+4). DESIGN.md §1.14.
// SC-P (designer rewrite, Q4/Q5): whenever Scout draws N, draw N+2, keep N,
// return 2 to the top of the draw pile in an order Scout chooses.
import type { ClassDef } from "../types.js";

export const scout: ClassDef = {
  id: "scout",
  name: "Scout",
  color: "green",
  parity: "even",
  maxHp: 95,
  attackDice: 1,
  colorBonus: 4,
  passive: "calculatedRisk",
  abilities: {
    "2": {
      // SC-2 Lucky Break — exploding heal
      name: "Lucky Break",
      attack: "grant",
      effects: [{ do: "heal", to: "self", dice: { n: 1, plus: 4 }, exploding: true }],
    },
    "4": {
      // SC-4 Prepared — draw 2, discard 2, redirect next ill effect
      name: "Prepared",
      attack: "grant",
      effects: [{ do: "custom", key: "prepared" }],
    },
    "6": {
      // SC-6 Twinshot — 2d6+4 to one, or the total split between two
      name: "Twinshot",
      attack: "replace",
      targets: { count: 2, who: "enemy", upTo: true },
      effects: [{ do: "custom", key: "twinshot", arg: { dice: { n: 2, plus: 4 } } }],
    },
    "8": {
      // SC-8 Ricochet — 3 enemies in play order from t0 (Q30: gifted card from Scout's hand)
      name: "Ricochet",
      attack: "replace",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "custom", key: "ricochet", arg: { dice: { n: 1, plus: 4 } } }],
    },
    "0": {
      // SC-0 Battlefield Intelligence — enemies play revealed for 2 color changes
      name: "Battlefield Intelligence",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "allEnemies",
          status: {
            key: "revealed",
            dur: { kind: "colorChange", changes: 2 },
            mods: { revealHand: true },
          },
        },
      ],
    },
    counter: {
      // SC-C Tripwire — target fails next roll/attack and loses next turn
      name: "Tripwire",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [
        { do: "stun", to: "t0", turns: 1 },
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "tripwire", ill: true, dur: { kind: "untilTriggered" } },
        },
      ],
    },
    advantage: {
      // SC-A Home Field — give 1 card per attack to the attacked (max 2/turn)
      name: "Home Field",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "homeField", dur: { kind: "colorChange" } },
        },
      ],
    },
    rally: {
      // SC-R Misdirection — two targets swap a card and fight
      name: "Misdirection",
      attack: "retain",
      replacesRallyDraw: true,
      rallyAttackTo: "free",
      targets: { count: 2, who: "other" },
      effects: [{ do: "custom", key: "misdirection" }],
    },
    inspiration: {
      // SC-I Mastermind — stack the top of the deck; target still draws 4
      name: "Mastermind",
      attack: "grant",
      targets: { count: 1, who: "enemy" }, // t0 = draw-4 recipient
      effects: [{ do: "custom", key: "mastermind", arg: { n: 8 } }],
    },
  },
};
