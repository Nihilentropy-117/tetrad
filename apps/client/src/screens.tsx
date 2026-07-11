// Pre-game screens: connect/create/join, lobby, class select.

import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Btn, ColorChip, theme } from "./components";
import { defaultServerUrl, loadSession, useGame } from "./store";
import { CLASS_META } from "./types";

export function ConnectScreen() {
  const { st, create, join, rejoin } = useGame();
  const [url, setUrl] = useState(defaultServerUrl());
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"ffa" | "teams">("ffa");
  const last = loadSession();

  return (
    <ScrollView style={s.root} contentContainerStyle={s.center}>
      <Text style={s.logo}>TETRAD</Text>
      <Text style={s.tag}>match cards · roll dice · last one standing</Text>

      <View style={s.form}>
        <Text style={s.label}>server</Text>
        <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none" />
        <Text style={s.label}>your name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="name" placeholderTextColor={theme.dim} />

        <View style={s.row}>
          <Btn label="Free-for-all" kind={mode === "ffa" ? "primary" : "normal"} onPress={() => setMode("ffa")} />
          <Btn label="Teams (2v2)" kind={mode === "teams" ? "primary" : "normal"} onPress={() => setMode("teams")} />
        </View>
        <Btn label="Create game" kind="primary" disabled={!name} onPress={() => create(url, name, mode)} />

        <View style={s.divider} />
        <Text style={s.label}>room code</Text>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="ABCD"
          placeholderTextColor={theme.dim}
          autoCapitalize="characters"
        />
        <Btn label="Join game" disabled={!name || code.length < 4} onPress={() => join(url, name, code)} />

        {last ? (
          <>
            <View style={s.divider} />
            <Btn label={`Resume ${last.code} as ${last.you}`} kind="ghost" onPress={() => rejoin(last)} />
          </>
        ) : null}

        {st.status === "connecting" ? <Text style={s.dim}>connecting…</Text> : null}
        {st.error ? <Text style={s.error}>⚠ {st.error}</Text> : null}
        {st.status === "closed" && st.session ? <Text style={s.error}>connection lost — resume above</Text> : null}
      </View>
    </ScrollView>
  );
}

export function LobbyScreen() {
  const { st, start, leave } = useGame();
  const lobby = st.lobby!;
  const you = st.session?.you;
  const isHost = lobby.host === you;

  return (
    <View style={[s.root, s.center]}>
      <Text style={s.logo}>TETRAD</Text>
      <Text style={s.tag}>
        room <Text style={{ color: theme.text, fontWeight: "900", letterSpacing: 2 }}>{lobby.code}</Text> ·{" "}
        {lobby.mode === "teams" ? "teams" : "free-for-all"}
      </Text>
      <View style={s.form}>
        {lobby.players.map((p) => (
          <Text key={p.playerId} style={s.lobbyRow}>
            {p.playerId === you ? "• You" : `• ${p.name}`} ({p.playerId}){p.connected ? "" : " — offline"}
            {p.playerId === lobby.host ? "  👑" : ""}
          </Text>
        ))}
        <Text style={s.dim}>{lobby.players.length}/4 players</Text>
        {isHost ? (
          <Btn label="Start game" kind="primary" disabled={lobby.players.length < 2} onPress={start} />
        ) : (
          <Text style={s.dim}>waiting for the host to start…</Text>
        )}
        <Btn label="Leave" kind="ghost" onPress={leave} />
        {st.error ? <Text style={s.error}>⚠ {st.error}</Text> : null}
      </View>
    </View>
  );
}

export function ClassSelectScreen() {
  const { st, action } = useGame();
  const game = st.game!;
  const you = st.session?.you ?? "";
  const choices = game.legal.filter((l) => l.type === "chooseClass");
  const picked = choices.length === 0;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.center}>
      <Text style={s.logo}>choose your class</Text>
      <Text style={s.tag}>picks are hidden until everyone locks in</Text>
      {picked ? (
        <Text style={[s.dim, { marginTop: 30 }]}>locked in — waiting for the others…</Text>
      ) : (
        <View style={s.classGrid}>
          {choices.map((c) => {
            const meta = CLASS_META[c.classId!] ?? { name: c.classId!, color: "red", blurb: "" };
            return (
              <View key={c.classId} style={s.classCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ColorChip color={meta.color} />
                  <Text style={s.className}>{meta.name}</Text>
                </View>
                <Text style={s.classBlurb}>{meta.blurb}</Text>
                <Btn
                  label="Pick"
                  kind="primary"
                  onPress={() => action({ type: "chooseClass", player: you, classId: c.classId! })}
                />
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", padding: 20, paddingTop: 48 },
  logo: { color: theme.text, fontSize: 34, fontWeight: "900", letterSpacing: 6 },
  tag: { color: theme.dim, marginTop: 6, marginBottom: 20 },
  form: { width: "100%", maxWidth: 380, gap: 8 },
  label: { color: theme.dim, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  row: { flexDirection: "row", gap: 8, marginVertical: 4 },
  divider: { height: 1, backgroundColor: theme.line, marginVertical: 12 },
  dim: { color: theme.dim, textAlign: "center", marginTop: 6 },
  error: { color: "#ff8a8a", textAlign: "center", marginTop: 8 },
  lobbyRow: { color: theme.text, fontSize: 15, marginVertical: 2 },
  classGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    maxWidth: 760,
  },
  classCard: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 12,
    padding: 12,
    width: 170,
    gap: 8,
  },
  className: { color: theme.text, fontWeight: "800", fontSize: 15 },
  classBlurb: { color: theme.dim, fontSize: 11, minHeight: 28 },
});
