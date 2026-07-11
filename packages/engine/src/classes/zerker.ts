// Zerker — RED, ODD, 110 HP, 2d6 (+3). DESIGN.md §1.9.
import type { ClassDef } from "../types.js";

export const zerker: ClassDef = {
  id: "zerker",
  name: "Zerker",
  color: "red",
  parity: "odd",
  maxHp: 110,
  attackDice: 2,
  colorBonus: 3,
  abilities: {
    "1": {
      // ZK-1 Battle Cry
      name: "Battle Cry",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "battleCry", dur: { kind: "colorChange" }, mods: { lifestealHalf: true } },
        },
      ],
      raging: {
        effects: [
          {
            do: "applyStatus",
            to: "self",
            status: { key: "battleCry", dur: { kind: "rage" }, mods: { lifestealHalf: true } },
          },
        ],
      },
    },
    "3": {
      // ZK-3 Frenzy
      name: "Frenzy",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "frenzy", dur: { kind: "colorChange" }, mods: { dmgOutMult: 2, dmgInMult: 2 } },
        },
      ],
      raging: {
        effects: [
          {
            do: "applyStatus",
            to: "self",
            status: { key: "frenzy", dur: { kind: "rage" }, mods: { dmgOutMult: 3, dmgInMult: 3 } },
          },
        ],
      },
    },
    "5": {
      // ZK-5 Double Strike
      name: "Double Strike",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [{ do: "damage", to: "t0", dice: { n: 3, plus: 6 } }],
      raging: { effects: [{ do: "damage", to: "t0", dice: { n: 4, plus: 6 } }] },
    },
    "7": {
      // ZK-7 Danger Sense
      name: "Danger Sense",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "dangerSense", dur: { kind: "colorChange" }, mods: { saveRolls: 2 } },
        },
      ],
      raging: {
        effects: [
          {
            do: "applyStatus",
            to: "self",
            status: { key: "dangerSense", dur: { kind: "rage" }, mods: { saveRolls: 3 } },
          },
        ],
      },
    },
    "9": {
      // ZK-9 Second Wind — heal, skip attack (attack: "none")
      name: "Second Wind",
      attack: "none",
      effects: [{ do: "heal", to: "self", dice: { n: 2, plus: 3 } }],
      raging: {
        effects: [
          { do: "heal", to: "self", dice: { n: 2, plus: 3 } },
          {
            do: "applyStatus",
            to: "self",
            status: {
              key: "secondWindRegen",
              dur: { kind: "rage" },
              tick: [{ do: "heal", to: "t0", dice: { n: 1, plus: 0 } }],
            },
          },
        ],
      },
    },
    "0": {
      // ZK-0 Whirlwind
      name: "Whirlwind",
      attack: "replace",
      effects: [
        { do: "damage", to: "allEnemies", aoe: true, dice: { n: 6, plus: 3 }, save: { dc: 8, onPass: "half" } },
      ],
      raging: {
        effects: [
          { do: "damage", to: "allEnemies", aoe: true, dice: { n: 6, plus: 9 }, save: { dc: 9, onPass: "half" } },
        ],
      },
    },
    stun: {
      // ZK-S Sweep
      name: "Sweep",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "stun", to: "t0", turns: 1 }],
      raging: {
        targets: { count: 2, who: "enemy", upTo: true },
        effects: [
          { do: "stun", to: "t0", turns: 1 },
          { do: "stun", to: "t1", turns: 1 },
        ],
      },
    },
    advantage: {
      // ZK-A Battle Rage (+3 rage, 1 color change, continuable — Q21)
      name: "Battle Rage",
      attack: "grant",
      effects: [{ do: "custom", key: "activateRage", arg: { bonus: 3, changes: 1 } }],
    },
    rally: {
      // ZK-R Press On
      name: "Press On",
      attack: "retain",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "pressOn",
            dur: { kind: "untilTriggered" },
            armed: { on: "attackIncoming", key: "pressOn", uses: 1 },
          },
        },
      ],
      raging: {
        effects: [
          {
            do: "applyStatus",
            to: "self",
            status: { key: "rageGuard", dur: { kind: "rage" }, mods: { hpFloor: 1, dmgInFlat: -1 } },
          },
        ],
      },
    },
    inspiration: {
      // ZK-I War Rage (+4 rage, 2 color changes; stacks with ZK-A — Q21)
      name: "War Rage",
      attack: "grant",
      targets: { count: 1, who: "enemy" }, // t0 = draw-4 recipient (SP5)
      effects: [{ do: "custom", key: "activateRage", arg: { bonus: 4, changes: 2 } }],
    },
  },
};
