// Warlock — BLUE, ODD, 100 HP, 2d6 (+1). DESIGN.md §1.11.
import type { ClassDef } from "../types.js";

export const warlock: ClassDef = {
  id: "warlock",
  name: "Warlock",
  color: "blue",
  parity: "odd",
  maxHp: 100,
  attackDice: 2,
  colorBonus: 1,
  abilities: {
    "1": {
      // WL-1 Life Drain
      name: "Life Drain",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [{ do: "damage", to: "t0", dice: { n: 2, plus: 1 }, lifesteal: true }],
    },
    "3": {
      // WL-3 Hex — DoT; +1 color change of duration per curse on target
      name: "Hex",
      attack: "retain",
      targets: { count: 1, who: "any" },
      effects: [{ do: "custom", key: "hex" }],
    },
    "5": {
      // WL-5 Crippling Curse — view + lock (M10: hard lock, no allow-flow)
      name: "Crippling Curse",
      attack: "grant",
      targets: { count: 1, who: "other" },
      effects: [{ do: "custom", key: "cripplingCurse" }],
    },
    "7": {
      // WL-7 Dark One's Own Luck
      name: "Dark One's Own Luck",
      attack: "grant",
      targets: { count: 1, who: "any" }, // t0 = recipient (may be self)
      effects: [{ do: "custom", key: "darkLuck" }],
    },
    "9": {
      // WL-9 Blind Curse
      name: "Blind Curse",
      attack: "grant",
      targets: { count: 1, who: "other" },
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: {
            key: "blind",
            ill: true,
            dur: { kind: "sourceNextTurnEnd" },
            mods: { curse: true },
          },
        },
      ],
    },
    "0": {
      // WL-0 Finger of Death
      name: "Finger of Death",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [{ do: "damage", to: "t0", dice: { n: 8, plus: 6 }, save: { dc: 10, onPass: "half" } }],
    },
    stun: {
      // WL-S Cursed Soul Link — stun 1 (SP6) + link until color change
      name: "Cursed Soul Link",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [
        { do: "stun", to: "t0", turns: 1 },
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "soulLink", dur: { kind: "colorChange" }, mods: { curse: true } },
        },
      ],
    },
    advantage: {
      // WL-A Summon Pact Demon — color bonus becomes +6
      name: "Summon Pact Demon",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "pact", dur: { kind: "colorChange" }, mods: { colorBonusOverride: 6 } },
        },
      ],
    },
    rally: {
      // WL-R Devil's Cursed Eyes — view rally draws + curse
      name: "Devil's Cursed Eyes",
      attack: "retain",
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "cursedEyes", dur: { kind: "colorChange" }, mods: { curse: true }, data: { peek: true } },
        },
      ],
    },
    inspiration: {
      // WL-I Delirium — steal the target's next turn (Q25)
      name: "Delirium",
      attack: "grant",
      targets: { count: 1, who: "enemy" }, // t0 = victim and draw-4 recipient
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "delirium", dur: { kind: "untilTriggered" }, data: {} },
        },
      ],
    },
  },
};
