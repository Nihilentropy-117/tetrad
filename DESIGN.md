# Tetrad — Rules Digest & Architecture (v2 — all rulings incorporated)

**Status: rules locked. Architecture confirmed. Awaiting "go" to begin implementation.**

v1 of this document extracted the rules from `Copy_of_Tetrad_Reference.docx` and raised 40 open questions (Q1–Q40) plus 4 follow-ups (F1–F4). All 44 have been answered by the designer; this version folds every ruling into the rules themselves. The full ledger is in §2 for traceability. Rule IDs will name data records and unit tests.

---

## 1. Rules Digest

### 1.1 Glossary

| Term | Meaning |
|---|---|
| **Field card** | Face-up card on the playing field; defines active color and active number. |
| **Active color / number** | What a played card must match (wilds excepted). |
| **Class color** | RED (Zerker, Knight), BLUE (Warlock, Sorcerer), GREEN (Thief, Scout), YELLOW (Priest, Paladin). |
| **Class parity** | ODD classes key abilities to 1/3/5/7/9 + Stun; EVEN classes to 2/4/6/8 + Counter. |
| **Standard attack** | The one attack granted by playing a card: class dice, plus color bonus if applicable. |
| **Color bonus** | Flat +N added to damage when the played card is your class color. |
| **Ability** | Class effect triggered by playing the matching class-color + number/type card. |
| **Ill effect** | Stuns, counter effects, damage over time, forced card draws. |
| **Save N** | Target rolls 2d6; the effect applies unless the roll is ≥ N. |
| **Color change** | The active color changing (see A6 for exact semantics). |
| **Armed effect** | A played effect that waits for its trigger ("upon taking damage…"); no expiry. |
| **Any-time discard** | KN-0 / PR-0 interrupt mechanic (SP8). |
| **Tetrad / Ultimate** | The 0 card. |
| **Holy** | Priest and Paladin. |

### 1.2 Setup (S)

- **S1.** Every player rolls 2d6; highest roll wins and picks the dealer. Ties re-roll. *(A "first to call out" reaction minigame is a possible future flourish — Q38.)*
- **S2.** Shuffle the deck; deal 7 cards to each player.
- **S3.** Player count: engine supports 2–8; this implementation caps at 4 (project constraint).
- **S4.** Classes are picked after the deal and revealed simultaneously. **Duplicate classes are allowed** (Q35).
- **S5.** The top card of the deck is turned face up as the initial field card. It has **no effect and causes no draw** (Q39).
- **S6.** If the initial field card is a wild (Advantage/Inspiration), the **dealer picks the active color** — nothing else happens (Q39).
- **S7.** The player to the left of the dealer goes first.
- **S8.** Modes: Free-for-All, or Teams (allies seated across from each other).

### 1.3 Deck (D) — *ruling Q1: standard UNO-derived, 108 cards*

| Card | UNO analog | Count | Parity for abilities |
|---|---|---|---|
| 0 (Tetrad/Ultimate) | 0 | 1 per color (4) | both (everyone's 0 ability) |
| 1–9 | 1–9 | 2 per color per number (72) | odd/even as numbered |
| Stun | Skip | 2 per color (8) | **odd** ("11") |
| Counter | Reverse | 2 per color (8) | **even** ("12") |
| Rally | Draw Two | 2 per color (8) | **none** — both classes of the color (Q7) |
| Advantage | Wild | 4 colorless | everyone (Q7) |
| Inspiration | Wild Draw Four | 4 colorless | everyone (Q7) |

- **D1.** Composition lives in a data file and is tunable without engine changes.
- **D2.** Stun counts as an odd number, Counter as an even number, for class-ability matching (Q8: "think of Stun as 11 and Counter as 12").

### 1.4 Turn structure (T)

- **T1.** On your turn: play a card, or take the draw action. Drawing is allowed even while holding a playable card (Q3).
- **T2.** A played card must match the field card's color or number (wilds exempt — SP4/SP5).
- **T3.** One draw action per turn: draw 1 card. Afterward you may play **any** playable card from hand (F2), and that play resolves **fully as normal — standard attack included** (F1). If you choose not to play after drawing, your turn ends with no attack (Q3 as clarified by F1).
- **T4.** Playing a card grants 1 standard attack targeting the next player in play order — in Teams, the next **enemy** in play order (Q12). Ability cards target per A2/A3.
- **T5.** Color bonus (Q2): the base attack is **dice only**; the class's flat +N applies **only when the played card is the class color**. Exceptions: Sorcerer's passive always grants it; wilds and 0s grant it regardless of card color (SP4–SP6); Warlock's Pact Demon changes the bonus itself (+6 instead of +1). Example confirmed by designer: Thief deals 1d6 off-color, 1d6+7 on green.
- **T6.** Written ability damage formulas are **final** — no color bonus stacked on top (the bonus is baked in; abilities only fire on class-color cards anyway). The "class bonus regardless of color" rule for wilds/0s applies to the **standard attacks** those cards grant, and Ultimate ability formulas are likewise used as written. *(Derived ruling M1.)*
- **T7.** Each player attacks at most once per turn unless an effect states otherwise.
- **T8.** Win conditions: reduce your hand to 0 cards (subject to the interrupt window, C7), or reduce all enemies' HP to 0.
- **T9.** After a win, the match may continue among the remaining players to determine 2nd/3rd/4th place; any player may concede (Q11).
- **T10.** When the draw pile empties, reshuffle the field pile (except the top card) together with the under-field pile into a new draw pile (Q36).
- **T11.** No hand limit (Q37).

### 1.5 Abilities — general (A)

- **A1.** A class ability fires when you play the matching card: class color + the ability's number, where Stun = odd, Counter = even (D2), Rally = your color regardless of parity, and Advantage / Inspiration / 0 fire for every class (Q7, Q15).
- **A2.** Abilities may target any player, not just the next in order.
- **A3.** Using an ability still grants 1 standard attack (targetable at any player), **unless** the ability itself deals damage — then the ability's damage replaces the attack, unless the ability says "Retain Standard Attack."
- **A4.** Explicit stated durations always win; "until end of the turn of the player who played it" is only the fallback for effects with no stated duration (Q6).
- **A5.** Players cannot take damage or suffer ill effects from their own actions.
- **A6.** **Color-change semantics (Q18/Q19/Q6):**
  - A number-matched play of a different color **does** change the active color.
  - A wild choosing the **same** color does **not** count as a color change.
  - When the color changes during player P's turn: "until color change" effects **sourced by P persist until the end of P's current turn** (the card that caused the change still gets its benefit — e.g. Warlock's pact bonus applies to the yellow card that ended it); everyone else's until-color-change effects end **immediately** (e.g. Knight's Stand Behind Me drops the moment another player changes the color).
- **A7.** Armed effects ("upon being targeted…", "upon taking damage…", "next attack…") are played in normal turn order and stay armed **until triggered** — no expiry (Q9, Q22).
- **A8.** Damage-over-time and recurring effects tick at the **start of the source's turn**; saves are rolled fresh on each tick (Q20).

### 1.6 Special cards (SP)

- **SP1. Stun (Skip):** stuns (skip 1 turn) and attacks the **next player**, like a standard attack — no targeting. Exception: if the card is your class color **and** you are the odd class of that color, your class Stun ability fires instead (targeted and upgraded) (Q8). Color bonus applies on class color for either class.
- **SP2. Counter (Reverse):** reverses play order and hits the player who last hit you. If class color + you are the even class: your class Counter ability fires (Q8). Played in normal turn order; reactive texts arm per A7 (Q9).
- **SP3. Rally (Draw Two):** if the card matches your class color (either class of the color): attack a **targeted** player, they draw 2, and your class Rally ability fires. Off-color: attack the next player, they draw 2, no ability (Q7).
- **SP4. Advantage (Wild):** playable only on your own turn, but on top of anything — no color/number restriction (Q4/Q5). Choose the new active color. Class bonus and your class Advantage ability always apply.
- **SP5. Inspiration (Wild Draw Four):** same play rules as SP4. Choose the color; the targeted player draws 4 — unless your class Inspiration ability **replaces** the draw with its own draw effects (Q13; e.g. Knight's per-strike draws, Sorcerer's Fireball draw-2s). Class bonus and class Inspiration ability always apply.
- **SP6. Ultimate / Tetrad (0):** must match active color **or** number (0 on 0). Any color of 0 triggers **your** class's 0 ability (Q15), and class bonus applies regardless of the card's color.
- **SP7. Discard is an action, not a card type** (Q14). Discarded cards go under the field pile (SP10's "under the pile" in the source doc).
- **SP8. Any-time discards (true interrupts):** Knight's 0 and Priest's 0 may be discarded from hand at **any time**, ignoring color/number, to activate their effect; the activated card goes to the **bottom of the draw pile** (Q9). These are the only true interrupts; everything else "outside turn order" is an armed trigger firing.
- **SP9. Saves:** target rolls 2d6; effect applies unless roll ≥ N.
- **SP10. Ill effects:** stuns, counter effects, damage over time, forced draws.

### 1.7 Combat & lifecycle (C)

- **C1.** Class stats (dice | color bonus | HP) — see roster table §1.8.
- **C2. Damage pipeline (Q16):** "whatever makes the biggest number for the attacker and the smallest for the defender — defender has priority on benefit." Deterministically: attacker-side modifiers are ordered to **maximize** output (roll → roll manipulations → flat adds → multipliers); defender-side modifiers (halvings, flat reductions, damage-taken multipliers like Frenzy) are ordered to **minimize** the final result — the engine evaluates defender-side orderings and takes the minimum. Floors apply last (min 0; raging Press On's 1-HP floor).
- **C3.** Roll manipulations: advantage/disadvantage rerolls, forced max (Loaded Dice — Thief's own next roll only, Q28), forced failure (Tripwire), ±up-to-2 (Arcane Influence — Sorcerer is prompted **after seeing each roll** while active, default "no change", Q17).
- **C4.** **Curse** is a marker status with no intrinsic effect; other effects read it (Hex duration extension).
- **C5. Death (Q10):** at 0 HP a player is removed from turn order and their hand is discarded under the field pile — except any-time cards (SP8), which their owner may choose to activate as they go (this is how a dying Priest self-revives). All ongoing effects sourced by the dead player end.
- **C6. Revival (Q10):** the revived player returns at **50% of max HP (rounded down)**, draws 5 cards, and resumes their original seat in turn order.
- **C7. Carding out (Q11):** when a player reaches 0 cards, an interrupt window opens (Priest's 0 can force them to draw 5). If uninterrupted, they win: placement is recorded, they leave turn order, and effects they sourced end. The match may continue for remaining placements (T9).
- **C8. Teams (Q12):** any ally carding out wins for the team; the game ends immediately on a team win. Standard attacks and generic stuns/rallies target the next **enemy** in order, never an ally.
- **C9.** Forced draws are real draws: they trigger draw-keyed passives (Sorcerer heals 2 HP per card, Scout's passive applies) (Q40).

### 1.8 Class roster

| Class | Color | Parity | HP | Attack dice | Color bonus |
|---|---|---|---|---|---|
| Zerker | RED | ODD | 110 | 2d6 | +3 |
| Knight | RED | EVEN | 100 | 2d6 | +2 |
| Warlock | BLUE | ODD | 100 | 2d6 | +1 |
| Sorcerer | BLUE | EVEN | 80 | 1d6 | +3 (always applies) |
| Thief | GREEN | ODD | 100 | 1d6 | +7 |
| Scout | GREEN | EVEN | 95 | 1d6 | +4 |
| Priest | YELLOW | ODD | 100 | 1d6 | +3 |
| Paladin | YELLOW | EVEN | 110 | 1d6 | +4 |

### 1.9 Zerker (ZK) — RED, ODD, 110 HP, 2d6 (+3)

Rage is a status activated by ZK-A/ZK-I; while Raging, abilities use their "While Raging" text.

- **ZK-1. Battle Cry (Red 1):** recover half of all damage Zerker deals, as healing, until color change. *Raging:* until rage ends.
- **ZK-3. Frenzy (Red 3):** deal 2× damage and take 2× damage until color change. *Raging:* 3×/3× until rage ends.
- **ZK-5. Double Strike (Red 5):** deal 3d6+6 to target. *Raging:* 4d6+6.
- **ZK-7. Danger Sense (Red 7):** roll twice against ill effects, take the better, until color change. *Raging:* roll three times for Saves, take the best, until rage ends.
- **ZK-9. Second Wind (Red 9):** heal 2d6+3 and skip your attack this turn. *Raging:* heal 2d6+3 and regain 1d6 HP per turn (ticks per A8) until rage ends.
- **ZK-0. Whirlwind (0):** all enemies take 6d6+3; Save 8 for half. *Raging:* 6d6+9; Save 9 for half.
- **ZK-S. Sweep (Red Stun):** stun the targeted player 1 turn. *Raging:* stun 2 targeted players 1 turn each.
- **ZK-A. Battle Rage (Advantage):** Raging until color change; Zerker may continue the rage by changing the color **back to the color chosen when the rage started** on their turn (Q21). While this rage is active: +3 bonus damage on all attacks.
- **ZK-R. Press On (Red Rally):** take 3 less damage from the next attack and return a standard attack at the attacker. *Raging:* cannot drop below 1 HP and take 1 less damage until rage ends.
- **ZK-I. War Rage (Inspiration):** Raging for 2 color changes; continuable as ZK-A. While active: +4 bonus damage on all attacks. **ZK-A and ZK-I rages stack (+7)** (Q21). Target still draws 4 (no replacement stated).

### 1.10 Knight (KN) — RED, EVEN, 100 HP, 2d6 (+2)

- **KN-P. Opportunity Maker (Passive):** when Knight deals color-bonus damage, the next attack against that enemy deals +1d6. During Multi-attack, triggers **once per distinct target**, however many strikes land on them (Q13).
- **KN-2. Back At You (Red 2):** armed (A7): the next time Knight is targeted by an ability, reflect its effect to a target of Knight's choice.
- **KN-4. For Me Alone (Red 4):** taunt target; Knight takes half damage from them until color change; **every turn** until color change the target must Save 8 to target anyone other than Knight (Q23).
- **KN-6. Revenge (Red 6):** armed (A7): the next time Knight is targeted by an ability, Knight takes it and deals **double the incoming damage** back (hit for 30 → return 60) (Q24).
- **KN-8. Heavy Handed (Red 8):** 2d6+4 to target; roll twice, take the better.
- **KN-0. Stand Behind Me (0):** no damage to all chosen players until color change (ends immediately when someone else changes color — A6). Any-time discard (SP8). Retain standard attack.
- **KN-C. Shield Master (Red Counter):** armed: upon taking damage, stun the attacker 1 turn and they draw a card.
- **KN-A. Multi-layered Defense (Advantage):** take 1 less damage (additional) until color change.
- **KN-R. Riposte (Red Rally):** block the next attack, strike the attacker for 1d6+4, heal for the damage done. Retain standard attack.
- **KN-I. Multi-attack (Inspiration):** four strikes of **1d6+1 each** (F3), distributed among any targets; each strike makes its target draw a card. These draws **replace** the standard Inspiration draw-4 (Q13).

### 1.11 Warlock (WL) — BLUE, ODD, 100 HP, 2d6 (+1)

- **WL-1. Life Drain (Blue 1):** deal 2d6+1 to target and heal self for the damage done.
- **WL-3. Hex (Blue 3):** target takes 1d6+1 per turn (source's turn — A8) until color change; +1 color change of duration per curse on the target. Retain standard attack.
- **WL-5. Crippling Curse (Blue 5):** curse target; once per turn until color change, view any card in their hand; they cannot play the viewed card unless Warlock allows it or the color changes.
- **WL-7. Dark One's Own Luck (Blue 7):** take any card from the discard (field) pile into your or a target's hand.
- **WL-9. Blind Curse (Blue 9):** target cursed until end of Warlock's next turn; on their turn they shuffle their hand and pick blind; if unplayable, their turn ends.
- **WL-0. Finger of Death (0):** one target takes 8d6+6; Save 10 for half.
- **WL-S. Cursed Soul Link (Blue Stun):** curse the target; until color change, damage Warlock receives is dealt to the target too.
- **WL-A. Summon Pact Demon (Advantage):** until color change, **all** of Warlock's attacks gain +6, whatever the card color (replacing the +1 color-bonus mechanic — per the designer's Q6 example, a yellow-card attack still gets it); damage abilities are upgraded by the difference (+5).
- **WL-R. Devil's Cursed Eyes (Blue Rally):** view both cards the rally target draws; curse the target until color change.
- **WL-I. Delirium (Inspiration):** pick an enemy; when their turn arrives, Warlock plays it instead, **from Warlock's own hand**; attacks made on the stolen turn count against the **stolen player's** once-per-turn attack, not Warlock's (Q25). Warlock's own turn happens as normal. Target draws 4.

### 1.12 Sorcerer (SO) — BLUE, EVEN, 80 HP, 1d6 (+3)

- **SO-P. Arcane Flux (Passive):** regain 2 HP whenever Sorcerer draws a card (including forced draws — C9); standard attacks always carry the color bonus.
- **SO-2. Counter Spell (Blue 2):** block damage and effects of the next 2 abilities/attacks against Sorcerer, including AoE.
- **SO-4. Tempest Feedback (Blue 4):** 1d6+3 to a random enemy each turn (source's turn; re-roll target and damage) until color change. Retain standard attack.
- **SO-6. Paradoxal Whims (Blue 6):** shuffle the field pile into the deck; reveal a new field card, treated as if Sorcerer played it (attack/ability, with color bonus). **Chains without limit** if it keeps triggering (Q26).
- **SO-8. Shock & Draw (Blue 8):** 2d6+3 to target; chains to the next 2 enemies in play order — 2nd takes half, 3rd draws a card.
- **SO-0. Wish (0):** roll 2d6 **once**, choose affected players after seeing it; the one result applies to all chosen targets (Q27): 2–4 swap hands between targets as Sorcerer decides; 5–7 heal 10d6+3 **or** deal 5d6+3 (one roll, all targets); 8–10 targets take 3 less damage until color change; 11–12 pick any other option.
- **SO-C. Dispel Magic (Blue Counter):** roll 2d6: 2–6 the next/current **special** card (Rally, Inspiration, 0, Advantage, Stun, Counter) has no effect on target; 7 Sorcerer chooses which; 8–12 the next/current numbered **ability** (1–9) has no effect on target.
- **SO-A. Arcane Influence (Advantage):** until color change, Sorcerer may adjust **any** dice roll by up to ±2, choosing **after seeing the roll** (Q17). Engine: decision prompt on each roll, default "no change".
- **SO-R. Fate Maker (Blue Rally):** draw 2 cards, assign each to any player; each recipient takes 8 damage per card received; Sorcerer may keep either/both damage-free.
- **SO-I. Fireball (Inspiration):** all enemies split 30 damage equally, then each draws 2. Replaces the standard draw-4.

### 1.13 Thief (TH) — GREEN, ODD, 100 HP, 1d6 (+7)

- **TH-1. Stealin' Your Heart (Green 1):** deal 1d6+7; heal self for the damage done.
- **TH-3. Three's A Crowd (Green 3):** armed: dodge the next AoE or multi-target ability.
- **TH-5. Finger Discount (Green 5):** take a card from another player's hand, give one of yours back in exchange.
- **TH-7. Loaded Dice (Green 7):** **Thief's own** next dice roll after the attack is an automatic max roll (Q28).
- **TH-9. Disarm Trap (Green 9):** remove or prevent the next ill effect.
- **TH-0. Anything You Can Do (0):** use **any ability of any class in play** — numbered, special, or ultimate, including the any-time-discard ultimates — with Thief's own bonus (Q29). Resolved as a normal play.
- **TH-S. Rigged Game (Green Stun):** Thief picks a card from hand; target guesses its color — right: target takes the card; wrong: stunned 2 turns instead of 1.
- **TH-A. Surprise! (Advantage):** the next player to change the color takes 1d6+7.
- **TH-R. Sleight of Hand (Green Rally):** target draws 1 (instead of 2); Thief may give them 1 card from hand.
- **TH-I. It's Not Cheating (Inspiration):** the next card Thief plays may be treated as any color, but otherwise works as normal. Target draws 4.

### 1.14 Scout (SC) — GREEN, EVEN, 95 HP, 1d6 (+4)

- **SC-P. Calculated Risk (Passive)** — *rewritten by designer (Q4/Q5), replaces the doc version:* whenever Scout draws cards — voluntarily, forced, or via an ability — they draw **2 extra**, keep the required number, and return 2 to the **top of the draw pile in an order they choose**. (Forced to draw 4 → draw 6, keep 4, stack 2 back.)
- **SC-2. Lucky Break (Green 2):** heal 1d6+4; each 6 rolled adds another 1d6 (exploding).
- **SC-4. Prepared (Green 4):** draw 2, discard 2; armed: auto-redirect the next ill effect to the next enemy in play order.
- **SC-6. Twinshot (Green 6):** 2d6+4 to one target, or the total split equally between 2 targets.
- **SC-8. Ricochet (Green 8):** up to 3 enemies in play order: 1st takes 1d6+4 plus a card **from Scout's hand** (Q30); 2nd draws 2; 3rd draws 1.
- **SC-0. Battlefield Intelligence (0):** all players except Scout and allies play with hands revealed for 2 color changes.
- **SC-C. Tripwire (Green Counter):** armed: target automatically fails their next roll or attack and loses their next turn.
- **SC-A. Home Field (Advantage):** until color change, each time Scout attacks, give the attacked player(s) 1 card **from Scout's hand** (max 2 per turn) (Q31).
- **SC-R. Misdirection (Green Rally):** choose 2 targets; they swap 1 card each, then attack each other with their own standard attack + color bonus.
- **SC-I. Mastermind (Inspiration):** draw 8 cards, arrange them in any order on top of the draw pile; targeted player then draws 4.

### 1.15 Priest (PR) — YELLOW, ODD, 100 HP, 1d6 (+3)

- **PR-1. Healing Word (Yellow 1):** heal 2d6+3 to any player or self.
- **PR-3. Guiding Bolt (Yellow 3):** deal 2d6+3 (bonus included); until end of Priest's next turn, all attacks against the target deal +1d6.
- **PR-5. Protection Circle (Yellow 5):** no ill effects until color change, on **self or a chosen player** (Q32). Priest still gets the standard attack against anyone. *(Client UX: confirm if the chosen recipient isn't an ally.)*
- **PR-7. Absolute Restore (Yellow 7):** remove all negative effects and prevent the next ill effect, for up to 3 players.
- **PR-9. Preserve Life (Yellow 9):** split 30 HP of healing among up to 3 targets (may include self).
- **PR-0. Divine Intervention (0):** revive one dead player (C6: 50% HP, draw 5) **and/or** force a player to draw 5 (even at 0 cards — the C7 interrupt). Any-time discard (SP8); a dying Priest's own copy triggers as their hand discards, letting them self-revive (Q10).
- **PR-S. Banish (Yellow Stun):** stun 2 turns; Save 8 for 1. While banished: untargetable; standard attacks that would hit them pass to the next player in order.
- **PR-A. Sanctuary (Advantage):** Priest takes no damage until color change; attackers Save 9 to bypass.
- **PR-R. Pray (Yellow Rally):** choose 1 or 2 heal targets — they receive the rally draws (2 cards to a single target, 1 each for two — F4); heal each target 1d6+4, +1d6+4 more per yellow card that target drew (Q33).
- **PR-I. Spiritual Guardian (Inspiration):** 1d6+4 to all enemies **each turn** (Priest's turn — A8) until color change; Save 9 each tick for half (Q20). Retain standard attack. Target draws 4.

### 1.16 Paladin (PA) — YELLOW, EVEN, 110 HP, 1d6 (+4)

- **PA-P. Holy Favor (Passive):** +1 damage to non-Holy enemies; −1 damage taken from Holy enemies.
- **PA-2. Lay on Hands (Yellow 2):** heal 1d6+4, split as desired between self and a chosen player (10 → 10/0, 0/10, or 5/5) (Q34).
- **PA-4. Blessed Weapon (Yellow 4):** roll attacks twice, take the higher, until color change.
- **PA-6. Shield of Faith (Yellow 6):** take 2 less damage from all attacks until color change.
- **PA-8. Even the Odds (Yellow 8):** armed: the next ability card played is reduced to a standard card attack.
- **PA-0. Holy Smite (0):** all enemies take 2d6+4; Save 9 or also lose their turn.
- **PA-C. Golden Rule (Yellow Counter):** forgo your attack; heal 5 HP and prevent the damage of the next attack against self or a chosen target.
- **PA-A. Flame Strike (Advantage):** 1d6 to target each turn (Paladin's turn — A8) until color change; may move it to the closest enemy once per turn. Retain standard attack.
- **PA-R. Rally (unnamed, Yellow Rally):** deal 1d6+4 to target, +1d6+4 per yellow card among the rally draws.
- **PA-I. Zone of Truth (Inspiration):** target reveals to Paladin all cards of a chosen color, or all of a chosen number/type. Target draws 4.

---

## 2. Rulings ledger

Every v1 open question, answered by the designer. `F` = follow-up round.

| # | Ruling |
|---|---|
| Q1 | UNO-derived 108-card deck (§1.3): Stun=Skip, Counter=Reverse, Rally=Draw 2, Advantage=Wild, Inspiration=Wild+4, Tetrad/Ultimate=0. |
| Q2 | Color bonus = flat +N added only when playing class color; base attack is dice-only (Thief: 1d6 / 1d6+7). Sorcerer always gets it; Warlock's pact modifies it. |
| Q3 | Voluntary draw allowed while holding playables. (See F1/F2 for post-draw play.) |
| Q4/Q5 | No Discard card type. Scout passive rewritten (SC-P). Advantage/Inspiration: own turn only, unrestricted by color/number. |
| Q6 | Explicit duration wins; acting player keeps their own until-color-change buffs through end of their turn (A6). |
| Q7 | Rally is not parity-gated (each color's classes have their own rally). Advantage/Inspiration/Ultimate benefit everyone. |
| Q8 | Generic Stuns hit the next player like a standard attack; only the odd class playing its color gets the targeted class stun. Stun ≈ 11 (odd), Counter ≈ 12 (even). |
| Q9 | Stuns/Counters play in normal turn order; "upon X" texts stay armed until they happen. Any-time discards (KN-0/PR-0) ignore color/number and go to the bottom of the draw pile; ultimates are the only true interrupts. |
| Q10 | Death: removed from turn order, hand discarded, sourced effects end. Revive: 50% HP + draw 5. Dying Priest's Divine Intervention triggers on the death-discard (self-save). |
| Q11 | Card-out wins, but the match may continue for placements; concede supported; the Priest-0 interrupt window exists. |
| Q12 | Teams: any ally carding out wins; standard attacks target the next **enemy** in order. |
| Q13 | Class Inspiration draw effects replace the standard draw-4. KN passive triggers once per person targeted per Multi-attack. |
| Q14 | "Discard" is an action certain cards take, not a card type. |
| Q15 | Off-class-color 0 still triggers your class ultimate. |
| Q16 | Damage ordering: maximize for attacker, minimize for defender; defender has priority on benefit. |
| Q17 | Arcane Influence: Sorcerer chooses after seeing the roll; may adjust any roll (self or enemy). |
| Q18/Q19 | Same-color wild ≠ color change; number-match different color = change; card causing the change keeps its owner's benefits until end of that turn, others' effects end immediately. |
| Q20 | DoT ticks on the source's turn; Spiritual Guardian recurs on Priest's turn with a save each turn. |
| Q21 | Rage continues by changing back to the color chosen at rage start; ZK-A and ZK-I stack. |
| Q22 | Reactive numbered abilities are armed until triggered. |
| Q23 | For Me Alone's Save-8 retarget check applies every turn until color change. |
| Q24 | Revenge returns double the incoming damage (30 in → 60 back). |
| Q25 | Delirium: Warlock plays from own hand; stolen-turn attacks count against the stolen player's allowance. |
| Q26 | Paradoxal Whims chains without limit. |
| Q27 | Wish: one roll, applied to all chosen targets. |
| Q28 | Loaded Dice: Thief's own next roll only. |
| Q29 | Thief-0 can copy any ability of any class in play, including any-time ultimates. |
| Q30/Q31 | Ricochet's given card and Home Field's given cards come from Scout's hand. |
| Q32 | Protection Circle: self or another player; client confirms non-ally targets. |
| Q33 | Pray: 1–2 heal targets; heal targets receive the rally draws; yellow draws boost that target's heal. |
| Q34 | Lay on Hands heal can be split between self and target. |
| Q35 | Duplicate classes allowed. |
| Q36 | Draw pile exhaustion → reshuffle field pile (minus top) + under-pile. |
| Q37 | No hand limit. |
| Q38 | Roll-off ties re-roll (optional future: "call out" reaction minigame). |
| Q39 | Initial wild field card: dealer picks color, no other effect. |
| Q40 | Forced draws trigger draw-keyed passives (Sorcerer heal, Scout passive). |
| F1 | Draw-then-play resolves fully as normal, standard attack included. "No attack" only describes drawing and not playing (turn ends). |
| F2 | After drawing you may play **any** playable card, not just the drawn one. |
| F3 | Knight Multi-attack: **1d6+1 per strike**. |
| F4 | Pray with 2 targets: rally draws split 1 each. |

### 2.1 Derived micro-rulings (mine — flag if wrong)

- **M1.** Written ability damage formulas are final (no color bonus stacked on top); the wild/0 "bonus regardless of color" rule applies to the standard attacks those cards grant (§1.4 T6).
- **M2.** One draw action per turn.
- **M3.** Revive HP rounds down (Scout: 95 → 47).
- **M4.** A player who cards out or concedes: hand (if any) goes under the field pile, their sourced effects end (same cleanup as death, minus the death triggers).
- **M5.** Death-discard: the dying player chooses whether to activate any-time cards in their hand as it discards.
- **M6** *(revised by designer, 2026-07-11)***.** Arcane Influence's default is **lower enemy rolls, raise ally/self rolls** (by the full 2). The engine auto-applies this default to every roll while the status is active; an interactive per-roll override is a client affordance to add later.
- **M7.** In team mode placements are per-team; the game ends at the team win (no placement play-out).

### 2.2 Build-time micro-rulings (added during engine implementation — flag if wrong)

- **M8.** Deck-manipulation draws (Mastermind's stack-and-arrange) are "raw" — the Scout passive does not apply to them; it applies to every normal, forced, or ability draw.
- **M9.** Any-time cards (KN-0/PR-0) are usable proactively at any point of your own turn, plus at the automatic windows: incoming damage (KN-0), a player reaching 0 cards (PR-0), and your own death (M5). Finer-grained interrupts (e.g. mid-ability) are not offered.
- **M10.** Crippling Curse is simplified to a hard lock: the viewed card simply cannot be played until color change (no "unless the Warlock allows it" flow). The Warlock views/locks a fresh card at the start of each of their turns while it lasts.
- **M11.** A generic Counter with no last-attacker on record falls back to hitting the next enemy. With 2 players, Reverse just flips direction (no UNO-style skip).
- **M12.** Rally attack targeting: abilities that repurpose the rally draws toward allies or third parties (Pray, Fate Maker, Misdirection) attack a freely chosen target (default next enemy); all other rallies attack the rally victim.
- **M13.** It's Not Cheating (TH-I): the declared color drives matching and becomes the new active color; ability triggering and the color bonus use the card's printed color ("works as normal").
- **M14.** Stuns don't stack: applying a stun to an already-stunned player keeps the longer of the two durations. Loaded Dice arms after the granted attack of the card that created it (per the ability text). A player's own AoE-causing color change cannot trigger their own Surprise! trap (A5).

---

## 3. Architecture

*(Confirmed in v1 review; unchanged in shape. Deltas from rulings are folded in below.)*

### 3.1 Overview

```
tetrad/
├─ packages/
│  ├─ engine/          (a) pure rules engine — zero deps, no I/O, no Date/Math.random
│  └─ server/          (b) authoritative server — Node + WebSocket, owns the engine
└─ apps/
   └─ client/          (c) React + Expo (web-first) — renders views, sends actions
```

TypeScript monorepo (pnpm workspaces). The engine is the only place rules exist. The server imports the engine; the client imports only the engine's type definitions.

### 3.2 (a) Rules engine — `packages/engine`

**Core signature:**

```ts
function applyAction(state: GameState, action: Action): Reply
// Reply = { ok: true; state: GameState; events: GameEvent[] }
//       | { ok: false; error: RuleViolation }        // state unchanged

function legalActions(state: GameState, playerId: PlayerId): ActionSpec[]
function initialState(config: GameConfig, seed: string): GameState
function redact(state: GameState, viewer: PlayerId): PlayerView
```

**Determinism.** The RNG lives inside `GameState` as `{ seed, cursor }` (PCG32-class PRNG); every roll advances the cursor and emits `DiceRolled`. A game is exactly `(seed, config, [actions])` — the replay file and golden-test format. Tests may substitute `rng: { kind: "scripted", values: [...] }` to force rolls. The seed never leaves the server.

**Cards and abilities are data** — the primary design driver. A generic effect interpreter executes a closed set of primitives; every card, class, ability, and status is a data record. New class or card = new data file. Deck composition (§1.3) is itself a data file (D1).

Primitive families (~30 primitives):
- **Actions:** `damage`, `heal`, `draw`, `forceDraw`, `discard`, `moveCard`, `viewCard`, `revealHand`, `swapHands`, `changeColor`, `stun`, `reverseOrder`, `applyStatus`, `removeStatus`, `revive`, `splitPool`, `stackDeck` (Mastermind / Scout returns)…
- **Modifiers:** `damageOut(+/×)`, `damageIn(−/½/×/floor)`, `rollAdvantage`, `rollForce`, `rollAdjust`, `preventNext(...)`, `redirect`, `untargetable`, `taunt`, `cardLock`…
- **Triggers:** `onTargetedByAbility`, `onTakeDamage`, `onDealDamage`, `onDraw`, `onColorChange`, `onTurnStart/End`, `onPlayerCardOut`, `onDeath`…
- **Selectors/values:** `chosen`, `nextEnemyInOrder`, `allEnemies`, `randomEnemy`, `self`, dice expressions, `ref:damageDealt`, save specs `{ save: 9, onPass: "half" }`.

Bespoke behaviors (Delirium turn-steal, Paradoxal Whims, Thief-0 copy, Wish tables) are **named primitives** in the same registry — data-referenced escape hatches, not scattered branches.

**State model:**

```ts
interface GameState {
  config: GameConfig;                    // mode, players, deck list
  phase: "classSelect" | "playing" | "finished";
  rng: RngState;
  players: PlayerState[];                // seat order = table order
  turn: TurnState;
  field: FieldState;
  drawPile: CardId[];
  activeEffects: EffectInstance[];       // statuses, buffs, DoTs, armed triggers
  decisions: DecisionRequest[];          // pending mid-resolution choices
  colorChangeCount: number;
  placements: PlayerId[];                // Q11 — card-out order
  winner: PlayerId | TeamId | null;
}

interface PlayerState {
  id: PlayerId; seat: number; team?: TeamId;
  classId: ClassId | null;
  hp: number;
  status: "active" | "dead" | "won" | "conceded";   // C5–C7
  hand: CardId[];
  handRevealedTo: PlayerId[] | "all";
}

interface TurnState {
  activePlayer: PlayerId;
  direction: 1 | -1;
  step: "start" | "main" | "resolving" | "end";
  hasDrawn: boolean;                     // M2 — one draw action per turn
  attacksUsed: number;                   // charged to the stolen player under Delirium (Q25)
  stolenBy?: PlayerId;
}

interface FieldState {
  activeColor: Color; activeNumber: number | null;
  pile: CardId[];                        // top = field card
  underPile: CardId[];                   // discard actions (SP7)
}

interface EffectInstance {
  id: string; sourceCard: CardId; sourcePlayer: PlayerId;
  targets: PlayerId[] | "global";
  spec: EffectSpecRef;
  duration: { kind: "colorChange" | "turnEnd" | "sourceNextTurnEnd"
                   | "rageEnd" | "untilTriggered";   // A7 armed effects
              expiresAt?: number;
              graceUntilSourceTurnEnd?: boolean };   // A6 acting-player persistence
  usesLeft?: number;
  data?: Record<string, unknown>;
}
```

**Decision queue.** Resolution is a micro-step machine: when an effect needs input (Wish targets after the roll, Rigged Game guess, reflect targets, Arcane Influence adjustments after each roll, Scout's keep/return picks, any-time-discard windows, the C7 card-out interrupt), the engine pushes `DecisionRequest { id, playerId, kind, options, default }` and halts; the only legal action is `{ type: "decide", ... }`, which resumes exactly there. Saves need no decision — the engine rolls them. **Timeouts are the server's job** (engine has no clock): stale decisions get answered with their default (e.g. M6).

**Damage pipeline (C2):** base roll → roll manipulations (advantage / forced max / ±2 prompts) → attacker flat adds (color bonus, rage, Holy Favor, riders like Guiding Bolt / Opportunity Maker) → attacker multipliers (Frenzy) → defender preventions/immunities (Sanctuary + bypass save, Counter Spell, Stand Behind Me, dodges, redirects) → defender-side ordering search over {halvings, taken-multipliers, flat reductions} taking the **minimum** (defender priority, Q16) → floors (min 0; rage Press On 1-HP floor) → apply → on-damage triggers (Battle Cry, Soul Link, Shield Master, Riposte, Revenge). Each consulted modifier emits an event, so combat is auditable in the client.

**Turn phase machine:**

```
TURN_START ─ stun/banish/Delirium check ─ start-of-turn ticks (DoTs, rage regen; A8)
   │
 MAIN ─ playCard | drawAction | concede
   │      └ drawAction (once; Scout: +2/return-2 flow) → may play ANY playable card,
   │        fully normal incl. attack (F1/F2), or end turn
 RESOLVING ─ field pile + activeColor/Number update → color-change expiries/triggers
   │         (A6: acting player's effects get end-of-turn grace) → card-kind dispatch
   │         → effect interpreter → standard attack unless replaced/skipped
   │         → decisions & interrupt windows as needed
 TURN_END ─ end-of-turn expiries (A4 fallback + A6 grace) → card-out/win checks
             (C7 interrupt window) → advance (skip dead/won/stunned/banished)
```

### 3.3 (b) Authoritative server — `packages/server`

Node + TypeScript, plain `ws`, one process, in-memory rooms + append-only action log on disk.

- **Rooms & seats:** join code; up to 4 players over IP; per-player reconnect tokens.
- **Authority loop:** client sends an intended `Action`; server maps socket→seat, calls `applyAction` (the engine is the sole validator), rejects privately on `ok: false`, otherwise logs the action and broadcasts.
- **Redaction:** clients receive `PlayerView`s, never `GameState`: own hand visible, others as counts (except `handRevealedTo` — SC-0, PA-I, WL-5), draw pile as count, RNG state stripped, events filtered per viewer.
- **Legal-action hints:** every broadcast includes `legalActions(state, viewer)` and pending `DecisionRequest`s for that viewer — this is what keeps the client 100% rules-free.
- **Timers:** decision timeouts (answer with default), disconnect grace, optional turn timers. The engine never sees time.
- **Reconnect & replay:** reconnect = current redacted view + version. `(seed, config, actionLog)` reproduces any game byte-for-byte — also the bug-report format.

### 3.4 (c) Client — `apps/client`

Expo (React Native + `react-native-web`), web-first, responsive flex layouts, no touch-specific UI yet.

- **No rules logic.** Renders the latest `PlayerView` + a `GameEvent` animation queue; playability, targets, and damage math all arrive precomputed.
- **State:** thin WebSocket client + one store (Zustand). Messages `{ view, version, events, legalActions, decisions }`; stale versions dropped.
- **Screens:** Lobby → Class Select → Table (field card, color indicator, player panels with HP/statuses/hand counts, own hand with server-flagged playables, decision prompts, event ticker) → Game Over (placements — Q11).
- **UX rulings:** confirm prompt when Protection Circle targets a non-ally (Q32); quick ±2 adjust prompt for Arcane Influence with a "skip rest of this roll" affordance (Q17).

### 3.5 One full turn, end to end

Warlock's turn; field is Green 1; Warlock plays Blue 1 targeting the Knight.

1. Client highlights Blue 1 (number match, per server-sent `legalActions`); player taps it, picks Knight. Client sends `{ type: "playCard", card: "blue-1-a", ability: true, targets: ["knight"] }`.
2. Server authenticates socket→seat, calls `applyAction`.
3. Engine, in one pure call: validates → card to field pile, activeColor=blue (`colorChangeCount`++; A6 expiries — green-keyed effects of other players end now, Warlock's own get end-of-turn grace) → dispatches WL-1 → `damage`: 2d6 from `state.rng` (+1 baked in), pipeline consults modifiers, Knight's armed effects checked → `heal(self, ref:damageDealt)` → damage ability replaces the standard attack (A3) → end-of-turn expiries → win check → advance. Returns new state + events.
4. Server logs the action, computes 4 redacted views + filtered events + fresh legal actions, broadcasts.
5. Clients animate the event queue: card flies, color flips, dice tumble, HP ticks with breakdown, turn marker advances.

Mid-resolution choices (Wish, saves-with-prompts, Scout returns) pause at step 3 with a `DecisionRequest`; the answering `decide` action re-enters the same loop.

### 3.6 Testing strategy

- **Unit:** every primitive in isolation; every class ability as a scripted-RNG scenario asserting state + events, named by rule ID (`ZK-3 frenzy doubles outgoing and incoming`).
- **Determinism:** golden replays — `(seed, config, actions)` tuples must reproduce identical final state hashes.
- **Fuzz:** thousands of random games sampling `legalActions`; invariants: card conservation across hands/piles, HP bounds, a legal action or decision always exists, termination.
- **Server:** integration with fake sockets; redaction tests assert no client message ever contains another hand or the RNG seed.

---

## 4. Build plan (on "go")

1. `packages/engine`: state types, RNG, deck data (§1.3), turn machine, matching/legality.
2. Combat pipeline + effect interpreter + decision queue.
3. Class data files ×8, each with its scenario test suite (rule IDs as test names).
4. Fuzz + golden replay harness.
5. `packages/server`: rooms, authority loop, redaction, timers, action log.
6. `apps/client`: lobby → class select → table → game over, event animations.
