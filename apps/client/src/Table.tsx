// The game table: field, players, hand, decisions, feed. Playability comes
// exclusively from server-sent legal actions.

import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Btn, CardView, ColorChip, DecisionPrompt, EventFeed, PlayerPanel, theme } from "./components";
import { PlaySheet } from "./PlaySheet";
import { useGame } from "./store";
import type { ActionSpec } from "./types";

export function Table() {
  const { st, action } = useGame();
  const [sheet, setSheet] = useState<ActionSpec | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
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

  const tapCard = (cardId: string) => {
    const spec = legalByCard.get(cardId);
    if (!spec) return;
    const needs = spec.needs ?? {};
    const needsInput =
      needs.targets || needs.chosenColor || needs.attackTarget || (needs.extra && needs.extra.length > 0);
    if (needsInput) setSheet(spec);
    else action({ type: "playCard", player: you, card: cardId });
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
          <Text style={s.dim}>{view.turn.direction === 1 ? "⟳" : "⟲"}</Text>
        </View>
        <Text style={[s.turnText, myTurn && { color: theme.accent }]}>
          {view.phase === "finished" ? "game over" : myTurn ? "YOUR TURN" : `${view.turn.actingPlayer}'s turn`}
        </Text>
      </View>

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
            onDecide={(choice) =>
              action({ type: "decide", player: you, decisionId: view.decision!.id, choice })
            }
          />
        ) : null}

        {/* game over */}
        {view.phase === "finished" ? (
          <View style={s.gameOver}>
            <Text style={s.gameOverTitle}>
              {view.winner === you ? "🏆 You win!" : `Winner: ${view.winner}`}
            </Text>
            {view.placements.map((p, i) => (
              <Text key={p} style={s.dim}>
                {i + 1}. {p === you ? "You" : p}
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
                  onPress={legalByCard.has(c) || anytimeCards.has(c) ? () => tapCard(c) : undefined}
                  disabled={!legalByCard.has(c) && !anytimeCards.has(c)}
                  highlight={legalByCard.has(c)}
                  badge={anytimeCards.has(c) ? "any time" : undefined}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* actions */}
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

        <EventFeed lines={st.feed} />
      </ScrollView>

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
