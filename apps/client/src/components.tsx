// Shared presentational pieces: buttons, cards, player panels, event feed,
// decision prompt. Everything renders server-provided data verbatim.

import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { ImageSourcePropType } from "react-native";
import type { DecisionRequest, PlayerView } from "./types";
import { cardHelp, cardInfo, CLASS_META, COLOR_HEX, playerName } from "./types";
import { cardArt, CARD_ART_RATIO } from "./art";

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
  dim,
  highlight,
  small,
  badge,
}: {
  id: string;
  onPress?: () => void;
  disabled?: boolean;
  /** faded but still pressable (e.g. inspectable-but-unplayable hand cards) */
  dim?: boolean;
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
          opacity: disabled ? 0.35 : dim ? 0.5 : 1,
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
  const meta = p.classId ? (CLASS_META[p.classId]?.name ?? p.classId) : "?";
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
        {p.classId ? <ColorChip color={CLASS_META[p.classId]?.color ?? "red"} /> : null}
        <Text style={s.panelTitle}>
          {isYou ? "You" : p.name || p.id} · {meta}
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
      {!isYou && p.hand && p.hand.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
          {p.hand.map((c, i) => (
            <CardView key={`${c}-${i}`} id={c} small />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Slow opacity pulse — used for the YOUR TURN banner. */
export function PulsingText({ children, style }: { children: React.ReactNode; style?: object | object[] }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 650, useNativeDriver: false }),
        Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.Text style={[style, { opacity: v }]}>{children}</Animated.Text>;
}

/** Play order at a glance: seats in flow direction, acting player highlighted,
 * dead/won players struck through, plus who's up next. Presentation only —
 * derived from the server view. */
export function TurnOrderStrip({ view }: { view: PlayerView }) {
  const ordered = [...view.players].sort((a, b) => a.seat - b.seat);
  const seq = view.turn.direction === 1 ? ordered : [...ordered].reverse();
  const acting = view.turn.actingPlayer;
  const alive = seq.filter((p) => p.status === "active");
  const activeIdx = alive.findIndex((p) => p.id === view.turn.activePlayer);
  const next = alive.length > 1 && activeIdx >= 0 ? alive[(activeIdx + 1) % alive.length] : null;
  return (
    <View style={s.orderStrip}>
      <Text style={s.orderLabel}>play order</Text>
      {seq.map((p, i) => (
        <React.Fragment key={p.id}>
          {i > 0 ? <Text style={s.orderArrow}>➜</Text> : null}
          <Text
            style={[
              s.orderName,
              p.id === acting && s.orderActive,
              p.status !== "active" && { textDecorationLine: "line-through", opacity: 0.45 },
            ]}
          >
            {p.name || p.id}
          </Text>
        </React.Fragment>
      ))}
      <Text style={s.orderArrow}>↩</Text>
      {next ? (
        <Text style={s.orderNext}>
          next: <Text style={{ color: theme.text, fontWeight: "700" }}>{next.id === view.you ? "You" : next.name || next.id}</Text>
        </Text>
      ) : null}
    </View>
  );
}

/** Near-full-screen art viewer on the dark overlay. Tap anywhere to close;
 * children (buttons, panels) render below the image and must block their own
 * taps if they shouldn't dismiss. */
export function ArtLightbox({
  source,
  ratio,
  onClose,
  children,
}: {
  source: ImageSourcePropType;
  ratio: number;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const win = useWindowDimensions();
  const w = Math.min(0.92 * win.width, 0.72 * win.height * ratio);
  return (
    <Pressable style={s.detailOverlay} onPress={onClose}>
      <Image source={source} style={{ width: w, height: w / ratio, borderRadius: w * 0.045 }} resizeMode="contain" />
      {children}
    </Pressable>
  );
}

/** Card inspector: what the card is, what it does, and (if it would fire)
 * your class ability. Tap-to-inspect opens this; "Play" routes to the normal
 * play flow when the server says the card is playable. */
export function CardDetail({
  id,
  classId,
  playable,
  playLabel = "Play",
  onPlay,
  onClose,
}: {
  id: string;
  classId: string | null;
  playable: boolean;
  playLabel?: string;
  onPlay: () => void;
  onClose: () => void;
}) {
  const info = cardInfo(id);
  const help = cardHelp(id, classId);
  const [showRules, setShowRules] = useState(false);
  const art = cardArt(id);

  const rulesPanel = (
    <>
      <Text style={s.detailTitle}>
        {(info.color ?? "wild").toUpperCase()} {info.label}
      </Text>
      <Text style={s.detailText}>{help.generic}</Text>
      {help.ability ? (
        <View style={s.detailAbility}>
          <Text style={s.detailAbilityName}>✦ Your ability: {help.ability.name}</Text>
          <Text style={s.detailText}>{help.ability.text}</Text>
        </View>
      ) : null}
      {!playable ? <Text style={[s.detailText, { color: theme.dim }]}>Not playable right now.</Text> : null}
    </>
  );

  if (art) {
    return (
      <ArtLightbox source={art} ratio={CARD_ART_RATIO} onClose={onClose}>
        <Pressable onPress={() => {}} style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {playable ? <Btn label={playLabel} kind="primary" onPress={onPlay} /> : null}
          <Btn label={showRules ? "Hide rules" : "ⓘ Rules"} kind="ghost" onPress={() => setShowRules((v) => !v)} />
        </Pressable>
        {showRules ? (
          <Pressable style={[s.detailBox, { position: "absolute", alignSelf: "center", top: "16%" }]} onPress={() => {}}>
            {rulesPanel}
          </Pressable>
        ) : null}
      </ArtLightbox>
    );
  }

  return (
    <Pressable style={s.detailOverlay} onPress={onClose}>
      <Pressable style={s.detailBox} onPress={() => {}}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <CardView id={id} />
          <View style={{ flex: 1 }}>{rulesPanel}</View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 12 }}>
          {playable ? <Btn label={playLabel} kind="primary" onPress={onPlay} /> : null}
          <Btn label="Close" kind="ghost" onPress={onClose} />
        </View>
      </Pressable>
    </Pressable>
  );
}

/** Heuristic line coloring: damage red, healing green, rolls gold, turn
 * markers accent. Keeps the log scannable without structured events. */
function feedLineColor(l: string): string {
  if (l.startsWith("—")) return theme.accent;
  if (/☠|has fallen| hit .* for /.test(l)) return "#ff9d9d";
  if (/✚|healed|returns at/.test(l)) return "#7fd6a4";
  if (/rolled|save vs/.test(l)) return "#d8c27a";
  if (/^[Yy]ou /.test(l)) return theme.text;
  return theme.dim;
}

export function EventFeed({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View style={s.feedWrap}>
      <Pressable onPress={() => setExpanded(!expanded)} style={s.feedHeader}>
        <Text style={s.feedTitle}>COMBAT LOG</Text>
        <Text style={s.dimSmall}>{expanded ? "▾ collapse" : "▸ expand"}</Text>
      </Pressable>
      <ScrollView
        ref={scrollRef}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        style={[s.feed, { maxHeight: expanded ? 440 : 190 }]}
        contentContainerStyle={{ padding: 10 }}
      >
        {lines.map((l, i) => (
          <Text
            key={`${i}`}
            style={[
              s.feedLine,
              { color: feedLineColor(l) },
              l.startsWith("—") && s.feedTurnSep,
              i === lines.length - 1 && { fontWeight: "700" },
            ]}
          >
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
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
/** Live countdown to a deadline (epoch ms). Renders a bar + seconds left. */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, [deadline]);
  const left = Math.max(0, deadline - now);
  const secs = Math.ceil(left / 1000);
  // total is unknown client-side; scale the bar against the first-seen remainder
  const [total] = useState(left);
  const pct = total > 0 ? Math.min(1, left / total) : 0;
  const urgent = secs <= 5;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={s.cdOuter}>
        <View style={[s.cdInner, { width: `${pct * 100}%`, backgroundColor: urgent ? theme.danger : theme.accent }]} />
      </View>
      <Text style={[s.cdText, urgent && { color: theme.danger, fontWeight: "800" }]}>
        {secs}s — picks the default if time runs out
      </Text>
    </View>
  );
}

export function DecisionPrompt({
  decision,
  view,
  deadline,
  onDecide,
}: {
  decision: DecisionRequest;
  view: PlayerView;
  deadline?: number;
  onDecide: (choice: unknown) => void;
}) {
  const [picked, setPicked] = useState<unknown[]>([]);
  const opts = decision.options;
  const wantsMany = Array.isArray(decision.default);
  const wantCount = wantsMany ? (decision.default as unknown[]).length : 1;

  const renderOpt = (o: unknown, i: number) => {
    const isCard = typeof o === "string" && /^(red|blue|green|yellow|wild)-/.test(o);
    const idx = picked.indexOf(o);
    const toggle = () => {
      if (!wantsMany) return onDecide(o);
      if (idx >= 0) setPicked(picked.filter((x) => x !== o));
      else if (picked.length < wantCount) setPicked([...picked, o]);
    };
    if (isCard) {
      return (
        <View key={`${String(o)}-${i}`} style={{ alignItems: "center" }}>
          <CardView id={o as string} onPress={toggle} highlight={idx >= 0} badge={idx >= 0 ? `pick ${idx + 1}` : undefined} />
        </View>
      );
    }
    const label =
      typeof o === "string" && view.players.some((p) => p.id === o) ? playerName(view, o) : String(o);
    return (
      <Pressable
        key={`${String(o)}-${i}`}
        onPress={toggle}
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
      {deadline ? <Countdown key={deadline} deadline={deadline} /> : null}
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
  feedWrap: { width: "100%", maxWidth: 720, paddingHorizontal: 8, marginTop: 4 },
  feedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  feedTitle: { color: theme.dim, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  feed: { backgroundColor: "#0c1017", borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  orderStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  orderLabel: { color: theme.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginRight: 4 },
  orderName: { color: theme.dim, fontSize: 12, fontWeight: "600" },
  orderActive: { color: theme.accent, fontWeight: "900", fontSize: 13 },
  orderArrow: { color: theme.accent, fontSize: 12 },
  orderNext: { color: theme.dim, fontSize: 12, marginLeft: 8 },
  detailOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(6,9,14,0.82)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 40,
  },
  detailBox: {
    backgroundColor: theme.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 16,
    maxWidth: 440,
    width: "92%",
    gap: 8,
  },
  detailTitle: { color: theme.text, fontSize: 17, fontWeight: "800", marginBottom: 4 },
  detailText: { color: theme.text, fontSize: 13, lineHeight: 19 },
  detailAbility: {
    backgroundColor: theme.panelHi,
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
  },
  detailAbilityName: { color: theme.accent, fontWeight: "800", fontSize: 13, marginBottom: 3 },
  cdOuter: { height: 6, backgroundColor: "#0c1017", borderRadius: 3, overflow: "hidden" },
  cdInner: { position: "absolute", left: 0, top: 0, bottom: 0 },
  cdText: { color: theme.dim, fontSize: 11, textAlign: "center", marginTop: 3 },
  feedLine: { color: theme.dim, fontSize: 12.5, lineHeight: 19, marginBottom: 2 },
  feedTurnSep: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 6,
    marginTop: 4,
    fontWeight: "700",
  },
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
