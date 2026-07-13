// The game table: field, players, hand, decisions, feed. Playability comes
// exclusively from server-sent legal actions.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Btn,
  CardDetail,
  CardView,
  ColorChip,
  DecisionPrompt,
  EventFeed,
  PlayerPanel,
  PulsingText,
  theme,
  TurnOrderStrip,
} from "./components";
import { PlaySheet } from "./PlaySheet";
import { chime, isMuted, setMuted, setTitleAlert } from "./sound";
import { useGame } from "./store";
import type { ActionSpec } from "./types";
import { shortName } from "./types";

export function Table() {
  const { st, action } = useGame();
  const [sheet, setSheet] = useState<ActionSpec | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const lastTap = useRef({ card: "", at: 0 });
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const game = st.game!;
  const view = game.view;
  const you = st.session?.you ?? "";
  const me = view.players.find((p) => p.id === you);

  const legalByCard = useMemo(() => {
    const m = new Map<string, ActionSpec>();
    for (const l of game.legal) if (l.type === "playCard" && l.card) m.set(l.card, l);
    return m;
  }, [game.legal]);
  const anytimeCards = useMemo(
    () => new Set(game.legal.filter((l) => l.type === "anytime").map((l) => l.card!)),
    [game.legal]
  );
  const canDraw = game.legal.some((l) => l.type === "drawCard");
  const canEnd = game.legal.some((l) => l.type === "endTurn");
  const myTurn = view.turn.actingPlayer === you;
  const myDecision = view.decision !== null;
  const [muted, setMutedState] = useState(isMuted());

  // chime + tab-title alert when the turn or a decision arrives at you
  const prevAlert = useRef({ myTurn: false, myDecision: false });
  useEffect(() => {
    const prev = prevAlert.current;
    if (myDecision && !prev.myDecision) chime("decision");
    else if (myTurn && !prev.myTurn) chime("turn");
    prevAlert.current = { myTurn, myDecision };
    setTitleAlert(myTurn || myDecision);
    return () => setTitleAlert(false);
  }, [myTurn, myDecision]);

  const playCard = (cardId: string) => {
    setInspect(null);
    const spec = legalByCard.get(cardId);
    if (spec) {
      const needs = spec.needs ?? {};
      const needsInput =
        needs.targets || needs.chosenColor || needs.attackTarget || (needs.extra && needs.extra.length > 0);
      if (needsInput) setSheet(spec);
      else action({ type: "playCard", player: you, card: cardId });
      return;
    }
    if (anytimeCards.has(cardId)) action({ type: "anytime", player: you, card: cardId });
  };

  // single tap: inspect (tap again to dismiss); double tap: play directly.
  // The single-tap popup is deferred one beat so the second tap of a double
  // still lands on the card instead of the popup overlay.
  const tapCard = (cardId: string) => {
    const playable = legalByCard.has(cardId) || anytimeCards.has(cardId);
    if (tapTimer.current !== null && lastTap.current.card === cardId) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = { card: "", at: 0 };
      if (playable) return playCard(cardId);
      setInspect((c) => (c === cardId ? null : cardId));
      return;
    }
    if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    lastTap.current = { card: cardId, at: Date.now() };
    if (!playable) {
      // nothing a double tap could do — show the popup immediately
      tapTimer.current = null;
      setInspect((c) => (c === cardId ? null : cardId));
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      setInspect((c) => (c === cardId ? null : cardId));
    }, 250);
  };

  return (
    <View style={s.root}>
      {/* top bar */}
      <View style={s.topBar}>
        <Text style={s.code}>room {view ? st.session?.code : ""}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={s.dim}>active</Text>
          <ColorChip color={view.activeColor} size={18} />
          {view.activeNumber !== null ? <Text style={s.turnText}>{fmtNumber(view.activeNumber)}</Text> : null}
          <Text style={s.dim}>deck {view.drawPileCount}</Text>
          <Pressable
            onPress={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            <Text style={s.dim}>{muted ? "🔇" : "🔔"}</Text>
          </Pressable>
        </View>
        {view.phase !== "finished" && myTurn ? (
          <PulsingText style={[s.turnText, { color: theme.accent, fontSize: 15 }]}>▶ YOUR TURN</PulsingText>
        ) : (
          <Text style={s.turnText}>
            {view.phase === "finished" ? "game over" : `${shortName(view, view.turn.actingPlayer)}'s turn`}
          </Text>
        )}
      </View>

      <TurnOrderStrip view={view} />

      <ScrollView contentContainerStyle={{ alignItems: "center", paddingBottom: 12 }}>
        {/* players */}
        <View style={s.players}>
          {view.players.map((p) => (
            <PlayerPanel key={p.id} view={view} p={p} isYou={p.id === you} />
          ))}
        </View>

        {/* field */}
        <View style={s.field}>
          {view.topCard ? <CardView id={view.topCard} /> : null}
        </View>

        {/* decision */}
        {view.decision ? (
          <DecisionPrompt
            decision={view.decision}
            view={view}
            deadline={game.deadline}
            onDecide={(choice) =>
              action({ type: "decide", player: you, decisionId: view.decision!.id, choice })
            }
          />
        ) : null}

        {/* game over */}
        {view.phase === "finished" ? (
          <View style={s.gameOver}>
            <Text style={s.gameOverTitle}>
              {view.winner === you ? "🏆 You win!" : `Winner: ${view.winner ? shortName(view, view.winner) : "—"}`}
            </Text>
            {view.placements.map((p, i) => (
              <Text key={p} style={s.dim}>
                {i + 1}. {p === you ? "You" : shortName(view, p)}
              </Text>
            ))}
          </View>
        ) : null}

        {/* your hand */}
        {me && me.hand ? (
          <>
            <Text style={s.handLabel}>
              your hand ({me.hand.length}){st.error ? `  ·  ⚠ ${st.error}` : ""}
            </Text>
            <View style={s.hand}>
              {me.hand.map((c, i) => (
                <CardView
                  key={`${c}-${i}`}
                  id={c}
                  onPress={() => tapCard(c)}
                  dim={!legalByCard.has(c) && !anytimeCards.has(c)}
                  highlight={legalByCard.has(c)}
                  badge={anytimeCards.has(c) ? "any time" : undefined}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* actions (spectators hold no seat — nothing to act with) */}
        {me ? (
          <View style={s.actions}>
            <Btn label="Draw" disabled={!canDraw} onPress={() => action({ type: "drawCard", player: you })} />
            <Btn label="End turn" disabled={!canEnd} onPress={() => action({ type: "endTurn", player: you })} />
            {confirmConcede ? (
              <>
                <Btn label="Really concede" kind="danger" onPress={() => action({ type: "concede", player: you })} />
                <Btn label="Stay" kind="ghost" onPress={() => setConfirmConcede(false)} />
              </>
            ) : (
              <Btn label="Concede" kind="ghost" onPress={() => setConfirmConcede(true)} />
            )}
          </View>
        ) : (
          <Text style={[s.dim, { marginTop: 10 }]}>👁 spectating</Text>
        )}

        <EventFeed lines={st.feed} />
      </ScrollView>

      {inspect ? (
        <CardDetail
          id={inspect}
          classId={me?.classId ?? null}
          playable={legalByCard.has(inspect) || anytimeCards.has(inspect)}
          playLabel={anytimeCards.has(inspect) && !legalByCard.has(inspect) ? "Discard (any time)" : "Play"}
          onPlay={() => playCard(inspect)}
          onClose={() => setInspect(null)}
        />
      ) : null}

      {sheet ? (
        <PlaySheet
          spec={sheet}
          view={view}
          you={you}
          onClose={() => setSheet(null)}
          onSubmit={(a) => {
            setSheet(null);
            action(a);
          }}
        />
      ) : null}
    </View>
  );
}

function fmtNumber(n: number): string {
  if (n === 11) return "Stun";
  if (n === 12) return "Counter";
  if (n === 13) return "Rally";
  return String(n);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    flexWrap: "wrap",
    gap: 8,
  },
  code: { color: theme.dim, fontWeight: "700", letterSpacing: 1 },
  dim: { color: theme.dim, fontSize: 12 },
  turnText: { color: theme.text, fontWeight: "800", fontSize: 13 },
  players: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    padding: 6,
    width: "100%",
    maxWidth: 900,
  },
  field: { alignItems: "center", marginVertical: 8 },
  handLabel: { color: theme.dim, marginTop: 6, fontSize: 12 },
  hand: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: 720,
    marginVertical: 6,
  },
  actions: { flexDirection: "row", gap: 8, marginVertical: 8, flexWrap: "wrap", justifyContent: "center" },
  gameOver: {
    backgroundColor: theme.panelHi,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    margin: 10,
  },
  gameOverTitle: { color: theme.text, fontSize: 22, fontWeight: "900", marginBottom: 8 },
});
