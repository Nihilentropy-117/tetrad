// Paladin — YELLOW, EVEN, 110 HP, 1d6 (+4). DESIGN.md §1.16.
import type { ClassDef } from "../types.js";

export const paladin: ClassDef = {
  id: "paladin",
  name: "Paladin",
  color: "yellow",
  parity: "even",
  maxHp: 110,
  attackDice: 1,
  colorBonus: 4,
  passive: "holyFavor", // PA-P: +1 vs non-Holy, -1 from Holy
  abilities: {
    "2": {
      // PA-2 Lay on Hands — heal split between self and target (Q34)
      name: "Lay on Hands",
      attack: "grant",
      targets: { count: 1, who: "any" },
      extra: "toTarget?: number (portion of the heal; rest to self)",
      effects: [{ do: "custom", key: "layOnHands", arg: { dice: { n: 1, plus: 4 } } }],
    },
    "4": {
      // PA-4 Blessed Weapon
      name: "Blessed Weapon",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "blessed", dur: { kind: "colorChange" }, mods: { attackAdvantage: true } },
        },
      ],
    },
    "6": {
      // PA-6 Shield of Faith
      name: "Shield of Faith",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "faith", dur: { kind: "colorChange" }, mods: { dmgInFlat: -2 } },
        },
      ],
    },
    "8": {
      // PA-8 Even the Odds — next numbered ability becomes a plain card
      name: "Even the Odds",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "global",
          status: {
            key: "evenOdds",
            dur: { kind: "untilTriggered" },
            armed: { on: "numberAbilityResolving", key: "evenOdds", uses: 1 },
          },
        },
      ],
    },
    "0": {
      // PA-0 Holy Smite — AoE + save 9 or lose turn
      name: "Holy Smite",
      attack: "replace",
      effects: [
        { do: "damage", to: "allEnemies", aoe: true, dice: { n: 2, plus: 4 } },
        { do: "custom", key: "saveOrStun", arg: { dc: 9 } },
      ],
    },
    counter: {
      // PA-C Golden Rule — forgo attack; heal 5; block next attack on self/chosen
      name: "Golden Rule",
      attack: "none",
      targets: { count: 1, who: "any" },
      effects: [{ do: "custom", key: "goldenRule" }],
    },
    advantage: {
      // PA-A Flame Strike — 1d6/turn DoT, movable once per turn
      name: "Flame Strike",
      attack: "grant",
      targets: { count: 1, who: "enemy" },
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: {
            key: "flameStrike",
            ill: true,
            dur: { kind: "colorChange" },
            tick: [{ do: "custom", key: "flameTick" }],
          },
        },
      ],
    },
    rally: {
      // PA-R (unnamed) — 1d6+4 to target, +1d6+4 per yellow among the rally draws
      name: "Zealous Strike",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "custom", key: "paladinRally", arg: { dice: { n: 1, plus: 4 } } }],
    },
    inspiration: {
      // PA-I Zone of Truth — reveal all of a chosen color or number/type
      name: "Zone of Truth",
      attack: "grant",
      targets: { count: 1, who: "enemy" }, // t0 = reveal + draw-4 recipient
      extra: "reveal: { mode: 'color'|'number', value }",
      effects: [{ do: "custom", key: "zoneOfTruth" }],
    },
  },
};
