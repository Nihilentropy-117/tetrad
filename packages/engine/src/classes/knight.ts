// Knight — RED, EVEN, 100 HP, 2d6 (+2). DESIGN.md §1.10.
import type { ClassDef } from "../types.js";

export const knight: ClassDef = {
  id: "knight",
  name: "Knight",
  color: "red",
  parity: "even",
  maxHp: 100,
  attackDice: 2,
  colorBonus: 2,
  passive: "opportunityMaker", // KN-P
  abilities: {
    "2": {
      // KN-2 Back At You — armed until triggered (Q22)
      name: "Back At You",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "backAtYou",
            dur: { kind: "untilTriggered" },
            armed: { on: "targetedByAbility", key: "backAtYou", uses: 1 },
          },
        },
      ],
    },
    "4": {
      // KN-4 For Me Alone — taunt (Q23: save-8 every turn until color change)
      name: "For Me Alone",
      attack: "grant",
      targets: { count: 1, who: "enemy" },
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "taunt", dur: { kind: "colorChange" }, data: {} },
        },
      ],
    },
    "6": {
      // KN-6 Revenge — return double incoming ability damage (Q24)
      name: "Revenge",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "revenge",
            dur: { kind: "untilTriggered" },
            armed: { on: "takeDamage", key: "revenge", uses: 1 },
          },
        },
      ],
    },
    "8": {
      // KN-8 Heavy Handed
      name: "Heavy Handed",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [{ do: "damage", to: "t0", dice: { n: 2, plus: 4 }, rollTwice: true }],
    },
    "0": {
      // KN-0 Stand Behind Me — any-time discardable (SP8)
      name: "Stand Behind Me",
      attack: "retain",
      targets: { count: 4, who: "any", upTo: true },
      effects: [{ do: "custom", key: "standBehindMe" }],
    },
    counter: {
      // KN-C Shield Master
      name: "Shield Master",
      attack: "retain",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "shieldMaster",
            dur: { kind: "untilTriggered" },
            armed: { on: "takeDamage", key: "shieldMaster", uses: 1 },
          },
        },
      ],
    },
    advantage: {
      // KN-A Multi-layered Defense
      name: "Multi-layered Defense",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "layeredDefense", dur: { kind: "colorChange" }, mods: { dmgInFlat: -1 } },
        },
      ],
    },
    rally: {
      // KN-R Riposte
      name: "Riposte",
      attack: "retain",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "riposte",
            dur: { kind: "untilTriggered" },
            armed: { on: "attackIncoming", key: "riposte", uses: 1 },
          },
        },
      ],
    },
    inspiration: {
      // KN-I Multi-attack — 4 strikes of 1d6+1 (F3); draws replace the draw-4 (Q13)
      name: "Multi-attack",
      attack: "replace",
      replacesInspirationDraw: true,
      effects: [{ do: "custom", key: "multiAttack", arg: { strikes: 4, dice: { n: 1, plus: 1 } } }],
    },
  },
};
