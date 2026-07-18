// PlaySheet: gathers the parameters a play needs (targets, color, extras) as
// declared by the server's legal-action spec, then submits the action verbatim.

import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Btn, CardView, PlayerPanel, theme } from "./components";
import type { Action, ActionSpec, PlayerView } from "./types";
import { cardHelp, cardInfo, COLOR_HEX, shortName } from "./types";

const COLORS = ["red", "blue", "green", "yellow"] as const;
const ABILITY_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "stun", "counter", "rally", "advantage", "inspiration"];

export function PlaySheet({
  spec,
  view,
  you,
  onSubmit,
  onClose,
}: {
  spec: ActionSpec;
  view: PlayerView;
  you: string;
  onSubmit: (a: Action) => void;
  onClose: () => void;
}) {
  const needs = spec.needs ?? {};
  const [targets, setTargets] = useState<string[]>([]);
  const [chosenColor, setChosenColor] = useState<string | null>(null);
  const [declaredColor, setDeclaredColor] = useState<string | null>(null);
  const [attackTarget, setAttackTarget] = useState<string | null>(null);
  // priest 0
  const [diMode, setDiMode] = useState<"draw5" | "revive">("draw5");
  const [diTarget, setDiTarget] = useState<string | null>(null);
  // thief 0
  const [copyClass, setCopyClass] = useState<string | null>(null);
  const [copyKey, setCopyKey] = useState<string | null>(null);
  // paladin inspiration
  const [revealMode, setRevealMode] = useState<"color" | "number">("color");
  const [revealValue, setRevealValue] = useState<string>("red");

  const info = cardInfo(spec.card!);
  const myClass = view.players.find((p) => p.id === you)?.classId ?? null;
  const help = cardHelp(spec.card!, myClass);
  const myHand = view.players.find((p) => p.id === you)?.hand;
  const extra = needs.extra ?? "";
  const isPriestZero = extra.includes("revive");
  const isThiefZero = extra.includes("copy");
  const isZoneOfTruth = extra.includes("reveal");
  const needsDeclared = extra === "declaredColor";

  const isEnemy = (pid: string, seat: number): boolean => {
    if (pid === you) return false;
    if (view.mode !== "teams") return true;
    const mySeat = view.players.find((p) => p.id === you)?.seat ?? 0;
    return seat % 2 !== mySeat % 2;
  };

  const targetPool = useMemo(() => {
    const t = needs.targets;
    if (!t) return [];
    return view.players.filter((p) => {
      if (t.who === "dead") return p.status === "dead";
      if (p.status !== "active") return false;
      if (t.who === "enemy") return isEnemy(p.id, p.seat);
      if (t.who === "other") return p.id !== you;
      return true; // "any" | "allyOrSelf" — server validates
    });
  }, [view, needs.targets, you]);

  const minTargets = needs.targets ? (needs.targets.upTo ? 1 : needs.targets.count) : 0;
  const maxTargets = needs.targets?.count ?? 0;

  const ready =
    (!needs.targets || (targets.length >= minTargets && targets.length <= maxTargets)) &&
    (!needs.chosenColor || chosenColor !== null) &&
    (!needsDeclared || declaredColor !== null) &&
    (!isPriestZero || diTarget !== null) &&
    (!isThiefZero || (copyClass !== null && copyKey !== null));

  const submit = () => {
    const a: Extract<Action, { type: "playCard" }> = {
      type: "playCard",
      player: you,
      card: spec.card!,
    };
    if (targets.length > 0) a.targets = targets;
    if (chosenColor) a.chosenColor = chosenColor as never;
    if (declaredColor) a.declaredColor = declaredColor as never;
    if (attackTarget) a.attackTarget = attackTarget;
    if (isPriestZero && diTarget) a.extra = { [diMode]: diTarget };
    if (isThiefZero && copyClass && copyKey) a.extra = { copy: { classId: copyClass, key: copyKey } };
    if (isZoneOfTruth) a.extra = { reveal: { mode: revealMode, value: revealMode === "color" ? revealValue : Number(revealValue) } };
    onSubmit(a);
  };

  const colorRow = (value: string | null, set: (c: string | null) => void, allowed?: readonly string[], clearable = false) => (
    <View style={s.row}>
      {(allowed ?? COLORS).map((c) => (
        <Btn
          key={c}
          label={c}
          kind={value === c ? "primary" : "normal"}
          onPress={() => set(clearable && value === c ? null : c)}
        />
      ))}
    </View>
  );

  const classesInPlay = view.players.filter((p) => p.status === "active" && p.classId).map((p) => p.classId!) ;

  return (
    <View style={s.overlay}>
      <ScrollView style={s.sheet} contentContainerStyle={{ padding: 14, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <CardView id={spec.card!} />
          <View style={{ flex: 1, maxWidth: 440 }}>
            <Text style={s.title}>
              Play {info.color ?? "wild"} {info.label}
            </Text>
            {help.ability ? (
              <>
                <Text style={s.abilityName}>✦ {help.ability.name}</Text>
                <Text style={s.abilityText}>{help.ability.text}</Text>
              </>
            ) : (
              <Text style={s.abilityText}>{help.generic}</Text>
            )}
          </View>
        </View>

        {needs.targets ? (
          <>
            <Text style={s.section}>
              Choose {needs.targets.upTo ? `up to ${maxTargets}` : maxTargets} target
              {maxTargets > 1 ? "s" : ""} ({needs.targets.who})
            </Text>
            <View style={s.row}>
              {targetPool.map((p) => (
                <PlayerPanel
                  key={p.id}
                  view={view}
                  p={p}
                  isYou={p.id === you}
                  selected={targets.includes(p.id)}
                  onPress={() =>
                    setTargets((t) =>
                      t.includes(p.id) ? t.filter((x) => x !== p.id) : t.length < maxTargets ? [...t, p.id] : t
                    )
                  }
                />
              ))}
            </View>
          </>
        ) : null}

        {needs.chosenColor ? (
          <>
            <Text style={s.section}>Choose the new color</Text>
            {colorRow(chosenColor, setChosenColor)}
          </>
        ) : null}

        {needsDeclared || needs.declareColors ? (
          <>
            <Text style={s.section}>
              {needsDeclared
                ? "Declare a color (It's Not Cheating)"
                : "Declare a color (It's Not Cheating — optional)"}
            </Text>
            {colorRow(declaredColor, setDeclaredColor, needs.declareColors, !needsDeclared)}
          </>
        ) : null}

        {needs.attackTarget ? (
          <>
            <Text style={s.section}>Aim your standard attack (optional)</Text>
            <View style={s.row}>
              {view.players
                .filter((p) => p.status === "active" && isEnemy(p.id, p.seat))
                .map((p) => (
                  <Btn
                    key={p.id}
                    label={shortName(view, p.id)}
                    kind={attackTarget === p.id ? "primary" : "normal"}
                    onPress={() => setAttackTarget(attackTarget === p.id ? null : p.id)}
                  />
                ))}
            </View>
          </>
        ) : null}

        {isPriestZero ? (
          <>
            <Text style={s.section}>Divine Intervention</Text>
            <View style={s.row}>
              <Btn label="Force draw 5" kind={diMode === "draw5" ? "primary" : "normal"} onPress={() => setDiMode("draw5")} />
              <Btn label="Revive" kind={diMode === "revive" ? "primary" : "normal"} onPress={() => setDiMode("revive")} />
            </View>
            <View style={s.row}>
              {view.players
                .filter((p) => (diMode === "revive" ? p.status === "dead" : p.status === "active"))
                .map((p) => (
                  <Btn key={p.id} label={shortName(view, p.id)} kind={diTarget === p.id ? "primary" : "normal"} onPress={() => setDiTarget(p.id)} />
                ))}
            </View>
          </>
        ) : null}

        {isThiefZero ? (
          <>
            <Text style={s.section}>Copy an ability from a class in play</Text>
            <View style={s.row}>
              {[...new Set(classesInPlay)].map((c) => (
                <Btn key={c} label={c} kind={copyClass === c ? "primary" : "normal"} onPress={() => setCopyClass(c)} />
              ))}
            </View>
            <View style={[s.row, { flexWrap: "wrap" }]}>
              {ABILITY_KEYS.map((k) => (
                <Btn key={k} label={k} kind={copyKey === k ? "primary" : "normal"} onPress={() => setCopyKey(k)} />
              ))}
            </View>
          </>
        ) : null}

        {isZoneOfTruth ? (
          <>
            <Text style={s.section}>Zone of Truth: reveal all of a…</Text>
            <View style={s.row}>
              <Btn label="color" kind={revealMode === "color" ? "primary" : "normal"} onPress={() => { setRevealMode("color"); setRevealValue("red"); }} />
              <Btn label="number" kind={revealMode === "number" ? "primary" : "normal"} onPress={() => { setRevealMode("number"); setRevealValue("5"); }} />
            </View>
            <View style={[s.row, { flexWrap: "wrap" }]}>
              {(revealMode === "color" ? [...COLORS] : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]).map((v) => (
                <Btn key={v} label={v} kind={revealValue === v ? "primary" : "normal"} onPress={() => setRevealValue(v)} />
              ))}
            </View>
          </>
        ) : null}

        <View style={[s.row, { marginTop: 16 }]}>
          <Btn label="Play it" kind="primary" disabled={!ready} onPress={submit} />
          <Btn label="Cancel" kind="ghost" onPress={onClose} />
        </View>

        {myHand && myHand.length > 0 ? (
          <>
            <Text style={s.handLabel}>your hand</Text>
            <View style={[s.row, { marginTop: 4 }]}>
              {myHand.map((c, i) => (
                <CardView key={`${c}-${i}`} id={c} small dim={c === spec.card} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(6,9,14,0.88)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
  },
  sheet: {
    backgroundColor: theme.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.line,
    maxWidth: 680,
    width: "94%",
    maxHeight: "88%",
  },
  title: { color: theme.text, fontSize: 18, fontWeight: "800" },
  abilityName: { color: theme.accent, fontWeight: "800", fontSize: 13, marginTop: 4 },
  abilityText: { color: theme.text, fontSize: 12, lineHeight: 17, marginTop: 2 },
  handLabel: { color: theme.dim, fontSize: 11, marginTop: 14, fontWeight: "700" },
  section: { color: theme.dim, marginTop: 14, marginBottom: 6, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
});

export { COLOR_HEX };
