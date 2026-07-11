// Priest — YELLOW, ODD, 100 HP, 1d6 (+3). DESIGN.md §1.15.
import type { ClassDef } from "../types.js";

export const priest: ClassDef = {
  id: "priest",
  name: "Priest",
  color: "yellow",
  parity: "odd",
  maxHp: 100,
  attackDice: 1,
  colorBonus: 3,
  abilities: {
    "1": {
      // PR-1 Healing Word
      name: "Healing Word",
      attack: "grant",
      targets: { count: 1, who: "any" },
      effects: [{ do: "heal", to: "t0", dice: { n: 2, plus: 3 } }],
    },
    "3": {
      // PR-3 Guiding Bolt — damage now; +1d6 on all attacks vs target until end of Priest's next turn
      name: "Guiding Bolt",
      attack: "replace",
      targets: { count: 1, who: "any" },
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "guidingBolt", dur: { kind: "sourceNextTurnEnd" } },
        },
        { do: "damage", to: "t0", dice: { n: 2, plus: 3 } },
      ],
    },
    "5": {
      // PR-5 Protection Circle — self or chosen player (Q32)
      name: "Protection Circle",
      attack: "grant",
      targets: { count: 1, who: "any" },
      effects: [
        {
          do: "applyStatus",
          to: "t0",
          status: { key: "protection", dur: { kind: "colorChange" }, mods: { noIllEffects: true } },
        },
      ],
    },
    "7": {
      // PR-7 Absolute Restore — cleanse + prevent next ill effect, up to 3 players
      name: "Absolute Restore",
      attack: "grant",
      targets: { count: 3, who: "any", upTo: true },
      effects: [
        { do: "removeIllEffects", to: "t0" },
        { do: "removeIllEffects", to: "t1" },
        { do: "removeIllEffects", to: "t2" },
        { do: "custom", key: "preventIll", arg: { sel: ["t0", "t1", "t2"] } },
      ],
    },
    "9": {
      // PR-9 Preserve Life — split 30 HP among up to 3 targets
      name: "Preserve Life",
      attack: "grant",
      targets: { count: 3, who: "any", upTo: true },
      extra: "allocation?: number[]",
      effects: [{ do: "custom", key: "preserveLife", arg: { pool: 30 } }],
    },
    "0": {
      // PR-0 Divine Intervention — revive and/or force draw 5; any-time discardable (SP8)
      name: "Divine Intervention",
      attack: "grant",
      extra: "revive?: PlayerId, draw5?: PlayerId",
      effects: [{ do: "custom", key: "divineIntervention" }],
    },
    stun: {
      // PR-S Banish — 2-turn stun (save 8 → 1); untargetable while stunned
      name: "Banish",
      attack: "retain",
      targets: { count: 1, who: "enemy" },
      effects: [{ do: "custom", key: "banish" }],
    },
    advantage: {
      // PR-A Sanctuary — no damage until color change; attackers save 9 to bypass
      name: "Sanctuary",
      attack: "grant",
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "sanctuary",
            dur: { kind: "colorChange" },
            mods: { noDamage: true, sanctuaryBypassDc: 9 },
          },
        },
      ],
    },
    rally: {
      // PR-R Pray — 1-2 heal targets receive the rally draws (F4); yellows boost (Q33)
      name: "Pray",
      attack: "retain",
      replacesRallyDraw: true,
      rallyAttackTo: "free",
      targets: { count: 2, who: "any", upTo: true },
      effects: [{ do: "custom", key: "pray", arg: { dice: { n: 1, plus: 4 } } }],
    },
    inspiration: {
      // PR-I Spiritual Guardian — recurring AoE each Priest turn until color change (Q20)
      name: "Spiritual Guardian",
      attack: "retain",
      targets: { count: 1, who: "enemy" }, // t0 = draw-4 recipient
      effects: [
        {
          do: "applyStatus",
          to: "self",
          status: {
            key: "guardian",
            dur: { kind: "colorChange" },
            tick: [{ do: "custom", key: "guardianTick", arg: { dice: { n: 1, plus: 4 }, save: 9 } }],
          },
        },
      ],
    },
  },
};
