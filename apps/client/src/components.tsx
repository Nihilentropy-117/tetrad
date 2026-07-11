// Shared presentational pieces: buttons, cards, player panels, event feed,
// decision prompt. Everything renders server-provided data verbatim.

import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DecisionRequest, PlayerView } from "./types";
import { cardInfo, COLOR_HEX, playerName } from "./types";

export const theme = {
  bg: "#10151f",
  panel: "#1a2230",
  panelHi: "#232e42",
  line: "#2e3b52",
  text: "#e8edf5",
  dim: "#8b98ad",
  accent: "#5b8cff",
  danger: "#e5484d",
};

export function Btn({
  label,
  onPress,
  kind = "normal",
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "normal" | "primary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        kind === "primary" && { backgroundColor: theme.accent },
        kind === "danger" && { backgroundColor: "#5c2330" },
        kind === "ghost" && { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.line },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[s.btnText, kind === "primary" && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function ColorChip({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: COLOR_HEX[color] ?? theme.dim,
      }}
    />
  );
}

export function CardView({
  id,
  onPress,
  disabled,
  highlight,
  small,
  badge,
}: {
  id: string;
  onPress?: () => void;
  disabled?: boolean;
  highlight?: boolean;
  small?: boolean;
  badge?: string;
}) {
  const info = cardInfo(id);
  const bg = info.color ? COLOR_HEX[info.color] : "#3a3f52";
  const w = small ? 44 : 62;
  const h = small ? 62 : 88;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        {
          width: w,
          height: h,
          borderRadius: 8,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          margin: 3,
          borderWidth: highlight ? 3 : 1,
          borderColor: highlight ? "#fff" : "rgba(0,0,0,0.35)",
          opacity: disabled ? 0.35 : 1,
        },
        pressed && { transform: [{ translateY: -4 }] },
      ]}
    >
      <Text
        style={{
          color: "#fff",
          fontWeight: "800",
          fontSize: info.kind === "number" ? (small ? 18 : 26) : small ? 8 : 11,
          textAlign: "center",
        }}
      >
        {info.kind === "advantage" || info.kind === "inspiration" ? `★\n${info.label}` : info.label}
      </Text>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  return (
    <View style={s.hpOuter}>
      <View
        style={[
          s.hpInner,
          { width: `${pct * 100}%`, backgroundColor: pct > 0.5 ? "#30a46c" : pct > 0.25 ? "#d6a316" : "#e5484d" },
        ]}
      />
      <Text style={s.hpText}>
        {hp}/{max}
      </Text>
    </View>
  );
}

export function PlayerPanel({
  view,
  p,
  isYou,
  onPress,
  selected,
}: {
  view: PlayerView;
  p: PlayerView["players"][number];
  isYou: boolean;
  onPress?: () => void;
  selected?: boolean;
}) {
  const active = view.turn.activePlayer === p.id;
  const meta = p.classId ?? "?";
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        s.panel,
        active && { borderColor: theme.accent, borderWidth: 2 },
        selected && { borderColor: "#fff", borderWidth: 2, backgroundColor: theme.panelHi },
        (p.status === "dead" || p.status === "conceded") && { opacity: 0.45 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {p.classId ? <ColorChip color={(cardInfoColorOf(meta) ?? "red") as string} /> : null}
        <Text style={s.panelTitle}>
          {isYou ? "You" : p.id} · {meta}
        </Text>
        {view.turn.actingPlayer === p.id && view.turn.actingPlayer !== view.turn.activePlayer ? (
          <Text style={{ color: theme.accent, fontSize: 10 }}>puppeteer</Text>
        ) : null}
      </View>
      {p.classId ? <HpBar hp={p.hp} max={p.maxHp} /> : null}
      <Text style={s.dimSmall}>
        {p.status === "active" ? `${p.handCount} cards` : p.status.toUpperCase()}
        {p.statuses.length > 0 ? ` · ${p.statuses.map((x) => x.key).join(", ")}` : ""}
      </Text>
    </Pressable>
  );
}

// class → display color without importing engine data
function cardInfoColorOf(classId: string): string | null {
  const map: Record<string, string> = {
    zerker: "red",
    knight: "red",
    warlock: "blue",
    sorcerer: "blue",
    thief: "green",
    scout: "green",
    priest: "yellow",
    paladin: "yellow",
  };
  return map[classId] ?? null;
}

export function EventFeed({ lines }: { lines: string[] }) {
  return (
    <ScrollView style={s.feed} contentContainerStyle={{ padding: 8 }}>
      {[...lines].reverse().map((l, i) => (
        <Text key={`${lines.length - i}`} style={[s.feedLine, i === 0 && { color: theme.text }]}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}

/**
 * Generic decision renderer:
 *  - options + array default → ordered multi-pick of default.length items
 *  - options + scalar default → single pick
 *  - no options → accept the default
 * Exotic structured decisions fall back to "accept default" (the server times
 * out to the default anyway).
 */
export function DecisionPrompt({
  decision,
  view,
  onDecide,
}: {
  decision: DecisionRequest;
  view: PlayerView;
  onDecide: (choice: unknown) => void;
}) {
  const [picked, setPicked] = useState<unknown[]>([]);
  const opts = decision.options;
  const wantsMany = Array.isArray(decision.default);
  const wantCount = wantsMany ? (decision.default as unknown[]).length : 1;

  const renderOpt = (o: unknown) => {
    const label =
      typeof o === "string" && /-(\d|stun|counter|rally|advantage|inspiration|0)/.test(o)
        ? `${cardInfo(o).color ?? "wild"} ${cardInfo(o).label}`
        : typeof o === "string" && view.players.some((p) => p.id === o)
          ? playerName(view, o)
          : String(o);
    const idx = picked.indexOf(o);
    return (
      <Pressable
        key={String(o)}
        onPress={() => {
          if (!wantsMany) return onDecide(o);
          if (idx >= 0) setPicked(picked.filter((x) => x !== o));
          else if (picked.length < wantCount) setPicked([...picked, o]);
        }}
        style={[s.opt, idx >= 0 && { borderColor: "#fff", backgroundColor: theme.panelHi }]}
      >
        <Text style={{ color: theme.text }}>
          {idx >= 0 ? `${idx + 1}. ` : ""}
          {label}
        </Text>
      </Pressable>
    );
  };

  const isBoolean = typeof decision.default === "boolean";
  return (
    <View style={s.decision}>
      <Text style={s.decisionTitle}>{decision.prompt}</Text>
      {opts && opts.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {opts.map(renderOpt)}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10, justifyContent: "center" }}>
        {isBoolean ? (
          <>
            <Btn label="Yes" kind="primary" onPress={() => onDecide(true)} />
            <Btn label="No" onPress={() => onDecide(false)} />
          </>
        ) : wantsMany && opts ? (
          <Btn
            label={picked.length === Math.min(wantCount, opts.length) ? "Confirm" : `Pick ${wantCount}`}
            kind="primary"
            disabled={picked.length !== Math.min(wantCount, opts.length)}
            onPress={() => onDecide(picked)}
          />
        ) : null}
        <Btn label="Accept default" kind="ghost" onPress={() => onDecide(decision.default)} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    backgroundColor: theme.panelHi,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: theme.text, fontWeight: "600", fontSize: 13 },
  badge: {
    position: "absolute",
    bottom: 2,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 4,
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 8 },
  hpOuter: {
    height: 14,
    backgroundColor: "#0c1017",
    borderRadius: 7,
    overflow: "hidden",
    marginVertical: 4,
    justifyContent: "center",
  },
  hpInner: { position: "absolute", left: 0, top: 0, bottom: 0 },
  hpText: { color: "#fff", fontSize: 9, textAlign: "center", fontWeight: "700" },
  panel: {
    backgroundColor: theme.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 8,
    minWidth: 150,
    margin: 4,
    flexGrow: 1,
    maxWidth: 260,
  },
  panelTitle: { color: theme.text, fontWeight: "700", fontSize: 13 },
  dimSmall: { color: theme.dim, fontSize: 11 },
  feed: { backgroundColor: "#0c1017", borderRadius: 8, maxHeight: 140 },
  feedLine: { color: theme.dim, fontSize: 11, marginBottom: 2 },
  decision: {
    backgroundColor: theme.panelHi,
    borderColor: theme.accent,
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    margin: 8,
  },
  decisionTitle: { color: theme.text, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  opt: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: theme.panel,
  },
});
