// Sorcerer — BLUE, EVEN, 80 HP, 1d6 (+3, always applies). DESIGN.md §1.12.
import type { ClassDef } from "../types.js";

export const sorcerer: ClassDef = {
  id: "sorcerer",
  name: "Sorcerer",
  color: "blue",
  parity: "even",
  maxHp: 80,
  attackDice: 1,
  colorBonus: 3,
  alwaysColorBonus: true, // SO-P
  passive: "arcaneFlux", // SO-P: +2 HP per card drawn
  abilities: {
    "2": {
      // SO-2 Counter Spell — block next 2 abilities/attacks incl. AoE
      name: "Counter Spell",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "counterSpell", dur: { kind: "untilTriggered" }, data: { uses: 2 } },
        },
      ],
    },
    "4": {
      // SO-4 Tempest Feedback — random enemy 1d6+3 each turn (A8)
      name: "Tempest Feedback",
      attack: "retain",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "tempest",
            dur: { kind: "colorChange" },
            tick: [{ do: "custom", key: "tempestTick" }],
          },
        },
      ],
    },
    "6": {
      // SO-6 Paradoxal Whims — reshuffle field, flip a new card as if Sorcerer played it (Q26)
      name: "Paradoxal Whims",
      attack: "grant",
      effects: [{ do: "custom", key: "whims" }],
    },
    "8": {
      // SO-8 Shock & Draw — chain lightning
      name: "Shock & Draw",
      attack: "replace",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "custom", key: "chainLightning", arg: { dice: { n: 2, plus: 3 } } }],
    },
    "0": {
      // SO-0 Wish — one roll, targets chosen after (Q27)
      name: "Wish",
      attack: "grant",
      effects: [{ do: "custom", key: "wish" }],
    },
    counter: {
      // SO-C Dispel Magic
      name: "Dispel Magic",
      attack: "retain",
      targets: { count: 1, who: "any" },
      effects: [{ do: "custom", key: "dispel" }],
    },
    advantage: {
      // SO-A Arcane Influence — ±2 on rolls; default lower enemy / raise ally (M6)
      name: "Arcane Influence",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: { key: "arcaneInfluence", dur: { kind: "colorChange" } },
        },
      ],
    },
    rally: {
      // SO-R Fate Maker — draw 2, assign; 8 dmg per card received
      name: "Fate Maker",
      attack: "retain",
      replacesRallyDraw: true,
      rallyAttackTo: "free",
      effects: [{ do: "custom", key: "fateMaker" }],
    },
    inspiration: {
      // SO-I Fireball — 30 split equally; each draws 2 (replaces draw-4)
      name: "Fireball",
      attack: "replace",
      replacesInspirationDraw: true,
      effects: [{ do: "custom", key: "fireball", arg: { total: 30, draw: 2 } }],
    },
  },
};
