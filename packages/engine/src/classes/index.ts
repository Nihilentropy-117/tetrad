import type { ClassDef, ClassId } from "../types.js";
import { zerker } from "./zerker.js";
import { knight } from "./knight.js";
import { warlock } from "./warlock.js";
import { sorcerer } from "./sorcerer.js";
import { thief } from "./thief.js";
import { scout } from "./scout.js";
import { priest } from "./priest.js";
import { paladin } from "./paladin.js";

export const CLASSES: Record<ClassId, ClassDef> = {
  zerker,
  knight,
  warlock,
  sorcerer,
  thief,
  scout,
  priest,
  paladin,
};

export function classDef(id: ClassId): ClassDef {
  return CLASSES[id];
}

export const HOLY: ClassId[] = ["priest", "paladin"]; // PA-P
