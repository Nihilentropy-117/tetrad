// Thief — GREEN, ODD, 100 HP, 1d6 (+7). DESIGN.md §1.13.
import type { ClassDef } from "../types.js";

export const thief: ClassDef = {
  id: "thief",
  name: "Thief",
  color: "green",
  parity: "odd",
  maxHp: 100,
  attackDice: 1,
  colorBonus: 7,
  abilities: {
    "1": {
      // TH-1 Stealin' Your Heart
      name: "Stealin' Your Heart",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [{ do: "damage", to: "t0", dice: { n: 1, plus: 7 }, lifesteal: true }],
    },
    "3": {
      // TH-3 Three's A Crowd — dodge next AoE / multi-target
      name: "Three's A Crowd",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "dodge",
            dur: { kind: "untilTriggered" },
            armed: { on: "aoeIncoming", key: "dodge", uses: 1 },
          },
        },
      ],
    },
    "5": {
      // TH-5 Finger Discount — blind-pick swap
      name: "Finger Discount",
      attack: "grant",
      targets: { count: 1, who: "other" },
      effects: [{ do: "custom", key: "fingerDiscount" }],
    },
    "7": {
      // TH-7 Loaded Dice — Thief's own next roll AFTER the attack is max (Q28)
      name: "Loaded Dice",
      attack: "grant",
      attackFirst: true,
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "loadedDice", dur: { kind: "untilTriggered" } },
        },
      ],
    },
    "9": {
      // TH-9 Disarm Trap — remove or prevent next ill effect
      name: "Disarm Trap",
      attack: "grant",
      targets: { count: 1, who: "any" },
      effects: [{ do: "custom", key: "disarmTrap" }],
    },
    "0": {
      // TH-0 Anything You Can Do — copy any ability of any class in play (Q29)
      name: "Anything You Can Do",
      attack: "grant",
      extra: "copy: { classId, key, targets? }",
      effects: [{ do: "custom", key: "copycat" }],
    },
    stun: {
      // TH-S Rigged Game
      name: "Rigged Game",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "custom", key: "riggedGame" }],
    },
    advantage: {
      // TH-A Surprise! — next color-changer takes 1d6+7 (A5: not the Thief)
      name: "Surprise!",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "global",
          status: {
            key: "surprise",
            dur: { kind: "untilTriggered" },
            armed: { on: "colorChanged", key: "surprise", uses: 1 },
          },
        },
      ],
    },
    rally: {
      // TH-R Sleight of Hand — draw 1 instead of 2; may gift a card
      name: "Sleight of Hand",
      attack: "retain",
      replacesRallyDraw: true,
      extra: "giveCard?: CardId",
      effects: [{ do: "custom", key: "sleightOfHand" }],
    },
    inspiration: {
      // TH-I It's Not Cheating — next played card may declare any color
      name: "It's Not Cheating",
      attack: "grant",
      targets: { count: 1, who: "enemy" }, // t0 = draw-4 recipient
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "chameleon", dur: { kind: "untilTriggered" } },
        },
      ],
    },
  },
};
