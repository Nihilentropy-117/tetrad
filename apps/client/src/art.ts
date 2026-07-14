// Card art lookup. Metro needs literal require() calls, so every asset is
// enumerated. Keys are the `color-slot` prefix of a card id (copy letter
// stripped): art is shared by all copies of a card.
import type { ImageSourcePropType } from "react-native";

/** width / height of the move-card PNGs (825×1125) */
export const CARD_ART_RATIO = 825 / 1125;
/** width / height of the class-card PNGs (900×1500) */
export const CLASS_ART_RATIO = 900 / 1500;

const CARD_ART: Record<string, ImageSourcePropType> = {
  "red-0": require("../assets/cards/red-0.png"),
  "red-1": require("../assets/cards/red-1.png"),
  "red-2": require("../assets/cards/red-2.png"),
  "red-3": require("../assets/cards/red-3.png"),
  "red-4": require("../assets/cards/red-4.png"),
  "red-5": require("../assets/cards/red-5.png"),
  "red-6": require("../assets/cards/red-6.png"),
  "red-7": require("../assets/cards/red-7.png"),
  "red-8": require("../assets/cards/red-8.png"),
  "red-9": require("../assets/cards/red-9.png"),
  "red-stun": require("../assets/cards/red-stun.png"),
  "red-counter": require("../assets/cards/red-counter.png"),
  "red-rally": require("../assets/cards/red-rally.png"),
  "blue-0": require("../assets/cards/blue-0.png"),
  "blue-1": require("../assets/cards/blue-1.png"),
  "blue-2": require("../assets/cards/blue-2.png"),
  "blue-3": require("../assets/cards/blue-3.png"),
  "blue-4": require("../assets/cards/blue-4.png"),
  "blue-5": require("../assets/cards/blue-5.png"),
  "blue-6": require("../assets/cards/blue-6.png"),
  "blue-7": require("../assets/cards/blue-7.png"),
  "blue-8": require("../assets/cards/blue-8.png"),
  "blue-9": require("../assets/cards/blue-9.png"),
  "blue-stun": require("../assets/cards/blue-stun.png"),
  "blue-counter": require("../assets/cards/blue-counter.png"),
  "blue-rally": require("../assets/cards/blue-rally.png"),
  "green-0": require("../assets/cards/green-0.png"),
  "green-1": require("../assets/cards/green-1.png"),
  "green-2": require("../assets/cards/green-2.png"),
  "green-3": require("../assets/cards/green-3.png"),
  "green-4": require("../assets/cards/green-4.png"),
  "green-5": require("../assets/cards/green-5.png"),
  "green-6": require("../assets/cards/green-6.png"),
  "green-7": require("../assets/cards/green-7.png"),
  "green-8": require("../assets/cards/green-8.png"),
  "green-9": require("../assets/cards/green-9.png"),
  "green-stun": require("../assets/cards/green-stun.png"),
  "green-counter": require("../assets/cards/green-counter.png"),
  "green-rally": require("../assets/cards/green-rally.png"),
  "yellow-0": require("../assets/cards/yellow-0.png"),
  "yellow-1": require("../assets/cards/yellow-1.png"),
  "yellow-2": require("../assets/cards/yellow-2.png"),
  "yellow-3": require("../assets/cards/yellow-3.png"),
  "yellow-4": require("../assets/cards/yellow-4.png"),
  "yellow-5": require("../assets/cards/yellow-5.png"),
  "yellow-6": require("../assets/cards/yellow-6.png"),
  "yellow-7": require("../assets/cards/yellow-7.png"),
  "yellow-8": require("../assets/cards/yellow-8.png"),
  "yellow-9": require("../assets/cards/yellow-9.png"),
  "yellow-stun": require("../assets/cards/yellow-stun.png"),
  "yellow-counter": require("../assets/cards/yellow-counter.png"),
  "yellow-rally": require("../assets/cards/yellow-rally.png"),
  "wild-advantage": require("../assets/cards/wild-advantage.png"),
  "wild-inspiration": require("../assets/cards/wild-inspiration.png"),
};

const CLASS_ART: Record<string, ImageSourcePropType> = {
  knight: require("../assets/cards/class-knight.png"),
  paladin: require("../assets/cards/class-paladin.png"),
  priest: require("../assets/cards/class-priest.png"),
  scout: require("../assets/cards/class-scout.png"),
  sorcerer: require("../assets/cards/class-sorcerer.png"),
  thief: require("../assets/cards/class-thief.png"),
  warlock: require("../assets/cards/class-warlock.png"),
  zerker: require("../assets/cards/class-zerker.png"),
};

export function cardArt(id: string): ImageSourcePropType | undefined {
  return CARD_ART[id.split("-").slice(0, 2).join("-")];
}

export function classArt(classId: string): ImageSourcePropType | undefined {
  return CLASS_ART[classId];
}
