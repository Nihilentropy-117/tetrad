// Type-only imports from the engine (erased at build time — the client ships
// zero rules code) plus a mirror of the server wire protocol and pure display
// helpers for card ids.

import type {
  Action,
  ActionSpec,
  DecisionRequest,
  GameEvent,
  PlayerView,
} from "@tetrad/engine";

export type { Action, ActionSpec, DecisionRequest, GameEvent, PlayerView };

// --- wire protocol (mirrors packages/server/src/protocol.ts) ---------------

export type ClientMsg =
  | { t: "create"; name: string; mode?: "ffa" | "teams" }
  | { t: "join"; code: string; name: string; bot?: boolean }
  | { t: "rejoin"; code: string; token: string }
  | { t: "start" }
  | { t: "recuse"; spectate: boolean }
  | { t: "listBotModels" }
  | { t: "addBot"; model: string; instructions?: string }
  | { t: "action"; action: Action }
  | { t: "ping" };

export interface LobbyPlayer {
  playerId: string;
  name: string;
  connected: boolean;
  bot?: boolean;
  spectating?: boolean;
}

export type ServerMsg =
  | { t: "joined"; code: string; token: string; playerId: string; seat: number }
  | { t: "lobby"; code: string; mode: "ffa" | "teams"; players: LobbyPlayer[]; host: string }
  | {
      t: "state";
      version: number;
      view: PlayerView;
      legal: ActionSpec[];
      events: GameEvent[];
      /** epoch ms when the pending decision auto-resolves to its default */
      deadline?: number;
    }
  | { t: "botModels"; models: string[] }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

export type StateMsg = Extract<ServerMsg, { t: "state" }>;

// --- display helpers (presentation only; the server decides legality) ------

export const COLOR_HEX: Record<string, string> = {
  red: "#e5484d",
  blue: "#3e7bfa",
  green: "#30a46c",
  yellow: "#d6a316",
};

export interface CardInfo {
  id: string;
  kind: "number" | "stun" | "counter" | "rally" | "advantage" | "inspiration";
  color: string | null;
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  stun: "Stun",
  counter: "Counter",
  rally: "Rally",
  advantage: "Advantage",
  inspiration: "Inspiration",
};

export function cardInfo(id: string): CardInfo {
  const [a, b] = id.split("-");
  if (a === "wild") {
    return { id, kind: b as CardInfo["kind"], color: null, label: KIND_LABEL[b] ?? b };
  }
  if (/^\d+$/.test(b)) {
    return { id, kind: "number", color: a, label: b === "0" ? "0 ✦" : b };
  }
  return { id, kind: b as CardInfo["kind"], color: a, label: KIND_LABEL[b] ?? b };
}

/** Display-only class metadata (names/flavor/stats mirror of DESIGN.md §1.8;
 * rules stay on the server). */
export interface ClassMeta {
  name: string;
  color: string;
  blurb: string;
  hp: number;
  dice: string;
  bonus: string;
  passive?: string;
}

export const CLASS_META: Record<string, ClassMeta> = {
  zerker: {
    name: "Zerker", color: "red", blurb: "Rage, big dice, bigger risks",
    hp: 110, dice: "2d6", bonus: "+3",
    passive: "Rage: Battle Rage / War Rage power up every ability while active",
  },
  knight: {
    name: "Knight", color: "red", blurb: "Block, taunt, punish",
    hp: 100, dice: "2d6", bonus: "+2",
    passive: "Opportunity Maker: after your color-bonus damage, the next attack on that enemy deals +1d6",
  },
  warlock: {
    name: "Warlock", color: "blue", blurb: "Curses and control",
    hp: 100, dice: "2d6", bonus: "+1",
  },
  sorcerer: {
    name: "Sorcerer", color: "blue", blurb: "Chaos with a safety net",
    hp: 80, dice: "1d6", bonus: "+3 (always)",
    passive: "Arcane Flux: +2 HP whenever you draw; color bonus applies on every card",
  },
  thief: {
    name: "Thief", color: "green", blurb: "Steal, cheat, vanish",
    hp: 100, dice: "1d6", bonus: "+7",
  },
  scout: {
    name: "Scout", color: "green", blurb: "Shape your hand, shape the game",
    hp: 95, dice: "1d6", bonus: "+4",
    passive: "Calculated Risk: whenever you draw, draw 2 extra, keep what you need, stack 2 back on top",
  },
  priest: {
    name: "Priest", color: "yellow", blurb: "Heal, banish, defy death",
    hp: 100, dice: "1d6", bonus: "+3",
  },
  paladin: {
    name: "Paladin", color: "yellow", blurb: "Steady shield, holy smite",
    hp: 110, dice: "1d6", bonus: "+4",
    passive: "Holy Favor: +1 damage to non-Holy enemies; −1 damage taken from Holy enemies",
  },
};

/** What each card type does, independent of class (DESIGN.md §1.6). */
export const CARD_KIND_TEXT: Record<CardInfo["kind"] | "zero", string> = {
  number: "Play on matching color or number. Grants a standard attack on the next player.",
  zero: "Tetrad (Ultimate) — matches the active color or any 0. Triggers YOUR class's 0 ability whatever its color; class bonus always applies to the attack.",
  stun: "Stuns the next player for 1 turn and attacks them. On your class color, the odd class's Stun ability fires instead (targeted & upgraded).",
  counter: "Reverses play order and hits whoever last hit you. On your class color, the even class's Counter ability fires.",
  rally: "Attack a player and make them draw 2. On your class color your Rally ability also fires.",
  advantage: "Wild — play on anything during your turn; choose the new color. Your class bonus and Advantage ability always apply.",
  inspiration: "Wild — choose the color; the target draws 4 (unless your class replaces the draw). Your class bonus and Inspiration ability always apply.",
};

/** Per-class ability help text (mirrors DESIGN.md §1.9–§1.16; display only). */
export const ABILITY_TEXT: Record<string, Record<string, { name: string; text: string }>> = {
  zerker: {
    "1": { name: "Battle Cry", text: "Heal half of all damage you deal, until color change. Raging: lasts until rage ends." },
    "3": { name: "Frenzy", text: "Deal 2× damage and take 2× damage until color change. Raging: 3× / 3×." },
    "5": { name: "Double Strike", text: "Deal 3d6+6 to a target. Raging: 4d6+6." },
    "7": { name: "Danger Sense", text: "Roll twice against ill effects and take the better, until color change. Raging: roll three times." },
    "9": { name: "Second Wind", text: "Heal 2d6+3; skip your attack this turn. Raging: also regain 1d6 HP per turn." },
    "0": { name: "Whirlwind", text: "All enemies take 6d6+3; Save 8 for half. Raging: 6d6+9, Save 9." },
    stun: { name: "Sweep", text: "Stun the targeted player for 1 turn. Raging: stun 2 targets." },
    advantage: { name: "Battle Rage", text: "Rage until color change: +3 damage on all attacks. Keep it going by changing the color back to the rage color." },
    rally: { name: "Press On", text: "Take 3 less from the next attack and counter with a standard attack. Raging: can't drop below 1 HP and take 1 less damage." },
    inspiration: { name: "War Rage", text: "Rage for 2 color changes: +4 damage on all attacks (stacks with Battle Rage). Target draws 4." },
  },
  knight: {
    "2": { name: "Back At You", text: "Armed: the next ability that targets you is reflected to a target of your choice." },
    "4": { name: "For Me Alone", text: "Taunt a target: you take half damage from them; each turn they must Save 8 to target anyone else, until color change." },
    "6": { name: "Revenge", text: "Armed: the next ability that hits you — take it, then deal double its damage back." },
    "8": { name: "Heavy Handed", text: "2d6+4 to a target; roll twice and take the better." },
    "0": { name: "Stand Behind Me", text: "Chosen players (up to 4) take no damage until color change. Discardable at ANY time. Retains standard attack." },
    counter: { name: "Shield Master", text: "Armed: when you next take damage, stun the attacker 1 turn and they draw a card." },
    advantage: { name: "Multi-layered Defense", text: "Take 1 less damage until color change." },
    rally: { name: "Riposte", text: "Block the next attack, strike back for 1d6+4, and heal that much. Retains standard attack." },
    inspiration: { name: "Multi-attack", text: "Four strikes of 1d6+1 spread over any targets; each strike's target draws a card (replaces the draw-4)." },
  },
  warlock: {
    "1": { name: "Life Drain", text: "Deal 2d6+1 and heal yourself for the damage done." },
    "3": { name: "Hex", text: "Target takes 1d6+1 at the start of your turns until color change (+1 color change per curse on them). Retains standard attack." },
    "5": { name: "Crippling Curse", text: "Curse the target; each of your turns, view a card in their hand — it's locked from play until color change." },
    "7": { name: "Dark One's Own Luck", text: "Take any card from the field (discard) pile into your hand or a target's." },
    "9": { name: "Blind Curse", text: "Until the end of your next turn, the target plays a random card blind; if it's unplayable their turn ends." },
    "0": { name: "Finger of Death", text: "One target takes 8d6+6; Save 10 for half." },
    stun: { name: "Cursed Soul Link", text: "Curse the target; until color change, damage you receive is dealt to them too." },
    advantage: { name: "Summon Pact Demon", text: "All your attacks gain +6 (whatever the card color) until color change; damage abilities gain +5." },
    rally: { name: "Devil's Cursed Eyes", text: "See both cards the rally target draws; curse them until color change." },
    inspiration: { name: "Delirium", text: "Steal an enemy's next turn — you play it using your own hand. Target draws 4." },
  },
  sorcerer: {
    "2": { name: "Counter Spell", text: "Block the damage and effects of the next 2 abilities or attacks against you, including AoE." },
    "4": { name: "Tempest Feedback", text: "1d6+3 to a random enemy at the start of each of your turns until color change. Retains standard attack." },
    "6": { name: "Paradoxal Whims", text: "Shuffle the field pile into the deck; reveal a new field card and resolve it as if you played it. Can chain endlessly." },
    "8": { name: "Shock & Draw", text: "2d6+3 to a target; the next enemy takes half; the one after draws a card." },
    "0": { name: "Wish", text: "Roll 2d6 once, then pick targets: 2–4 swap hands; 5–7 heal 10d6+3 or deal 5d6+3; 8–10 they take 3 less damage; 11–12 pick any option." },
    counter: { name: "Dispel Magic", text: "Roll 2d6: 2–6 the next special card has no effect on a target; 7 your choice; 8–12 the next numbered ability is negated." },
    advantage: { name: "Arcane Influence", text: "Until color change, adjust any dice roll by up to ±2 — after seeing it." },
    rally: { name: "Fate Maker", text: "Draw 2 and assign each card to any player; each recipient takes 8 damage per card (you may keep either damage-free)." },
    inspiration: { name: "Fireball", text: "All enemies split 30 damage equally, then each draws 2 (replaces the draw-4)." },
  },
  thief: {
    "1": { name: "Stealin' Your Heart", text: "Deal 1d6+7 and heal yourself for the damage done." },
    "3": { name: "Three's A Crowd", text: "Armed: dodge the next AoE or multi-target ability." },
    "5": { name: "Finger Discount", text: "Take a card from another player's hand and give one of yours back." },
    "7": { name: "Loaded Dice", text: "Your next dice roll after this attack is an automatic maximum." },
    "9": { name: "Disarm Trap", text: "Remove or prevent the next ill effect." },
    "0": { name: "Anything You Can Do", text: "Use ANY ability of any class in play — numbered, special, or ultimate — with your own bonus." },
    stun: { name: "Rigged Game", text: "Pick a card from your hand; the target guesses its color. Right: they take the card. Wrong: stunned 2 turns." },
    advantage: { name: "Surprise!", text: "The next player to change the color takes 1d6+7." },
    rally: { name: "Sleight of Hand", text: "Target draws only 1 (instead of 2); you may give them 1 card from your hand." },
    inspiration: { name: "It's Not Cheating", text: "Declare any color for the next card you play; it otherwise works as normal. Target draws 4." },
  },
  scout: {
    "2": { name: "Lucky Break", text: "Heal 1d6+4; every 6 rolled explodes into another 1d6." },
    "4": { name: "Prepared", text: "Draw 2 and discard 2; armed: the next ill effect against you redirects to the next enemy." },
    "6": { name: "Twinshot", text: "2d6+4 to one target, or the total split equally between two." },
    "8": { name: "Ricochet", text: "Up to 3 enemies in order: 1st takes 1d6+4 plus a card from your hand; 2nd draws 2; 3rd draws 1." },
    "0": { name: "Battlefield Intelligence", text: "All enemies play with revealed hands for 2 color changes." },
    counter: { name: "Tripwire", text: "Armed: the target automatically fails their next roll or attack and loses their next turn." },
    advantage: { name: "Home Field", text: "Until color change, each time you attack, give the target a card from your hand (max 2 per turn)." },
    rally: { name: "Misdirection", text: "Two targets swap 1 card each, then attack each other with their own standard attacks." },
    inspiration: { name: "Mastermind", text: "Draw 8 cards and arrange them on top of the deck in any order; the target then draws 4." },
  },
  priest: {
    "1": { name: "Healing Word", text: "Heal any player (or yourself) 2d6+3." },
    "3": { name: "Guiding Bolt", text: "Deal 2d6+3; until the end of your next turn, attacks on the target deal +1d6." },
    "5": { name: "Protection Circle", text: "No ill effects on you or a chosen player until color change. You still get the standard attack." },
    "7": { name: "Absolute Restore", text: "Remove all negative effects and prevent the next ill effect, for up to 3 players." },
    "9": { name: "Preserve Life", text: "Split 30 HP of healing among up to 3 targets (may include yourself)." },
    "0": { name: "Divine Intervention", text: "Revive a dead player (50% HP, draws 5) and/or force a player to draw 5. Discardable at ANY time — even as you die." },
    stun: { name: "Banish", text: "Stun 2 turns (Save 8 for 1). Banished players are untargetable; attacks pass over them." },
    advantage: { name: "Sanctuary", text: "You take no damage until color change; attackers must Save 9 to bypass." },
    rally: { name: "Pray", text: "1–2 targets receive the rally draws and heal 1d6+4 each, +1d6+4 more per yellow card they drew." },
    inspiration: { name: "Spiritual Guardian", text: "1d6+4 to all enemies at the start of each of your turns until color change (Save 9 for half). Target draws 4." },
  },
  paladin: {
    "2": { name: "Lay on Hands", text: "Heal 1d6+4, split however you like between yourself and a chosen player." },
    "4": { name: "Blessed Weapon", text: "Roll attacks twice and take the higher, until color change." },
    "6": { name: "Shield of Faith", text: "Take 2 less damage from all attacks until color change." },
    "8": { name: "Even the Odds", text: "Armed: the next ability card played is reduced to a plain standard attack." },
    "0": { name: "Holy Smite", text: "All enemies take 2d6+4; Save 9 or they also lose their turn." },
    counter: { name: "Golden Rule", text: "Forgo your attack; heal 5 HP and prevent the damage of the next attack on you or a chosen target." },
    advantage: { name: "Flame Strike", text: "1d6 to a target at the start of each of your turns until color change; movable once per turn. Retains standard attack." },
    rally: { name: "Rally", text: "Deal 1d6+4 to the target, +1d6+4 per yellow card among the rally draws." },
    inspiration: { name: "Zone of Truth", text: "The target reveals all their cards of a chosen color or a chosen number. Target draws 4." },
  },
};

/** Display help for a card in YOUR hand: generic rules text plus your class
 * ability if this card would trigger it. Presentation only — the server
 * remains the sole authority on what's actually legal. */
export function cardHelp(cardId: string, classId: string | null): { generic: string; ability: { name: string; text: string } | null } {
  const info = cardInfo(cardId);
  const isZero = info.kind === "number" && info.label.startsWith("0");
  const generic = CARD_KIND_TEXT[isZero ? "zero" : info.kind];
  let ability: { name: string; text: string } | null = null;
  if (classId) {
    const table = ABILITY_TEXT[classId];
    const classColor = CLASS_META[classId]?.color;
    const key = info.kind === "number" ? info.label.replace(" ✦", "") : info.kind;
    const colorGated = info.kind === "number" ? !isZero : info.kind === "stun" || info.kind === "counter" || info.kind === "rally";
    const fires = !colorGated || info.color === classColor;
    if (table && fires && table[key]) ability = table[key];
  }
  return { generic, ability };
}

export function playerName(view: PlayerView | null, id: string): string {
  if (!view) return id;
  const p = view.players.find((x) => x.id === id);
  if (!p) return id;
  const name = p.name || p.id;
  const meta = p.classId ? CLASS_META[p.classId]?.name : null;
  return meta ? `${name} (${meta})` : name;
}

/** Display name without class suffix. */
export function shortName(view: PlayerView | null, id: string): string {
  if (!view) return id;
  const p = view.players.find((x) => x.id === id);
  return p?.name || id;
}

/** Render an engine event as one feed line. */
export function fmtEvent(e: GameEvent, you: string, view: PlayerView | null): string | null {
  const p = (id: unknown) => (id === you ? "You" : shortName(view, String(id)));
  // subject-aware verb: "You use" vs "Alice uses"
  const v = (id: unknown, third: string, first: string) => (id === you ? first : third);
  switch (e.type) {
    case "TurnStarted":
      return `— ${p(e.player)}${e.actingAs !== e.player ? ` (played by ${p(e.actingAs)})` : ""} — turn ${e.turn}`;
    case "CardPlayed":
      return `${p(e.player)} played ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}${e.viaWhims ? " (whims)" : ""}`;
    case "DiceRolled":
      return `${p(e.roller)} rolled ${Array.isArray(e.faces) ? (e.faces as number[]).join("+") : e.total} = ${e.total}${e.loaded ? " (loaded!)" : ""}`;
    case "DamageDealt":
      return `${p(e.src)} hit ${p(e.tgt)} for ${e.amount} (${e.hp} HP left)`;
    case "Healed":
      return `${p(e.target)} healed ${e.amount} (${e.hp} HP)`;
    case "SaveRolled":
      return `${p(e.roller)} save vs ${e.dc}: ${e.total} — ${e.passed ? "passed" : "failed"}`;
    case "ColorChanged":
      return `color is now ${String(e.color).toUpperCase()}`;
    case "ColorChosen":
      return `${p(e.by)} chose ${String(e.color).toUpperCase()}`;
    case "StatusApplied":
      return `${p(e.owner)} ${v(e.owner, "gains", "gain")} ${e.status}`;
    case "StatusExpired":
      return `${e.status} ends on ${p(e.owner)}`;
    case "Stunned":
      return `${p(e.target)} is stunned (${e.turns})`;
    case "TurnSkipped":
      return `${p(e.player)}'s turn is skipped`;
    case "OrderReversed":
      return `play order reversed`;
    case "DrewCard":
      return `${p(e.player)} drew a card`;
    case "CardDrawn":
      return `you drew ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}`;
    case "AbilityTriggered":
      return `${p(e.player)} ${v(e.player, "uses", "use")} ${e.name}`;
    case "AttackBlocked":
      return `${p(e.player)} blocked the attack (${e.by})`;
    case "DamagePrevented":
      return `${p(e.target)} ${v(e.target, "takes", "take")} no damage`;
    case "IllEffectPrevented":
      return `${p(e.target)} ${v(e.target, "shrugs", "shrug")} off the effect`;
    case "PlayerDied":
      return `☠ ${p(e.player)} has fallen`;
    case "PlayerRevived":
      return `✚ ${p(e.player)} returns at ${e.hp} HP`;
    case "PlayerWon":
      return `★ ${p(e.player)} cards out — place ${e.place}!`;
    case "PlayerConceded":
      return `${p(e.player)} ${v(e.player, "concedes", "concede")}`;
    case "GameEnded":
      return `game over — winner: ${p(e.winner)}`;
    case "TurnStolen":
      return `${p(e.by)} ${v(e.by, "steals", "steal")} ${p(e.victim)}'s turn!`;
    case "RageActivated":
      return `${p(e.player)} is RAGING (+${e.bonus})`;
    case "AnytimeDiscard":
      return `${p(e.player)} ${v(e.player, "discards", "discard")} ${cardInfo(String(e.card)).label} — any time!`;
    case "CardViewed":
      return `you see: ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}`;
    case "ClassesRevealed":
      return "⚔ classes revealed — fight!";
    case "DeckStacked":
      return `${p(e.by)} stacked ${e.count} cards on the deck`;
    case "DeckReshuffled":
      return `deck reshuffled (${e.size} cards)`;
    case "ScoutReturned":
      return `${p(e.player)} ${v(e.player, "returns", "return")} ${e.count} to the deck`;
    case "Dodged":
      return `${p(e.player)} ${v(e.player, "dodges", "dodge")}!`;
    case "CardGiven":
      return `${p(e.by)} ${v(e.by, "gives", "give")} ${p(e.to)} ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}`;
    case "CardTaken":
      return `${p(e.to)} ${v(e.to, "takes", "take")} a card from the ${e.from} pile`;
    case "CardsDiscarded":
      return `${p(e.player)} ${v(e.player, "discards", "discard")} ${e.count}`;
    case "CardsSwapped":
      return `${p(e.a)} and ${p(e.b)} swap a card`;
    case "HandsSwapped":
      return `${p(e.a)} and ${p(e.b)} swap hands!`;
    case "RollFailed":
      return `${p(e.roller)}'s roll auto-fails (${e.reason})`;
    case "ArcaneInfluence":
      return `✨ ${p(e.by)} ${v(e.by, "warps", "warp")} ${p(e.roller)}'s roll: ${e.from} → ${e.to} (Arcane Influence)`;
    case "CardsRevealed": {
      const list = (e.cards as string[])
        .map((c) => `${cardInfo(c).color ?? "wild"} ${cardInfo(c).label}`)
        .join(", ");
      return `${p(e.from)} ${v(e.from, "reveals", "reveal")} to ${p(e.to)}: ${list || "no matching cards"}`;
    }
    case "WishRolled":
      return `${p(e.player)} ${v(e.player, "wishes", "wish")}… rolled ${e.roll}`;
    case "RageContinued":
      return `${p(e.owner)}'s rage continues`;
    case "DecisionRequested":
    case "TurnEnded":
    case "ClassChosen":
    case "Attack":
      return null; // rendered elsewhere / too noisy
    default:
      // any unmapped event: humanize the type name instead of leaking CamelCase
      return e.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}
