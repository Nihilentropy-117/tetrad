// Pre-game screens: connect/create/join, lobby, class select.

import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ArtLightbox, Btn, ColorChip, theme } from "./components";
import { defaultServerUrl, loadSession, useGame } from "./store";
import { ABILITY_TEXT, CLASS_META } from "./types";
import { classArt, CLASS_ART_RATIO } from "./art";

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
  const { st, start, leave, recuse } = useGame();
  const lobby = st.lobby!;
  const you = st.session?.you;
  const isHost = lobby.host === you;
  const [addingBot, setAddingBot] = useState(false);

  const botCount = lobby.players.filter((p) => p.bot).length;
  const spectating = lobby.players.find((p) => p.playerId === you)?.spectating ?? false;
  const activeCount = lobby.players.filter((p) => !p.spectating).length;
  const canStart = activeCount >= 2;

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
            {p.playerId === you ? "• You" : `• ${p.name}`} ({p.playerId}){p.bot ? " 🤖" : ""}
            {p.connected ? "" : " — offline"}
            {p.playerId === lobby.host ? "  👑" : ""}
            {p.spectating ? "  👁 spectating" : ""}
          </Text>
        ))}
        <Text style={s.dim}>{lobby.players.length}/4 players</Text>
        {isHost ? (
          <Btn label="Start game" kind="primary" disabled={!canStart} onPress={start} />
        ) : (
          <Text style={s.dim}>waiting for the host to start…</Text>
        )}
        <Btn label="Leave" kind="ghost" onPress={leave} />
        {isHost ? (
          <>
            <Btn
              label="Add bot"
              disabled={lobby.players.length >= 4 || botCount >= 3}
              onPress={() => setAddingBot(true)}
            />
            {botCount >= 2 ? (
              <Btn
                label={spectating ? "Rejoin the match" : "Recuse (watch the bots)"}
                kind="ghost"
                onPress={() => recuse(!spectating)}
              />
            ) : null}
          </>
        ) : null}
        {st.error ? <Text style={s.error}>⚠ {st.error}</Text> : null}
      </View>
      {addingBot ? <AddBotModal onClose={() => setAddingBot(false)} /> : null}
    </View>
  );
}

/** Popup for spawning a bot: model dropdown (list served by the game server)
 * plus free-text instructions appended to the bot's system prompt. */
function AddBotModal({ onClose }: { onClose: () => void }) {
  const { st, listBotModels, addBot } = useGame();
  const models = st.botModels;
  const [model, setModel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    listBotModels();
  }, [listBotModels]);
  useEffect(() => {
    if (model === null && models?.length) setModel(models[0]);
  }, [models, model]);

  const add = () => {
    if (!model) return;
    addBot(model, instructions.trim() || undefined);
    // the bot appears in the lobby when it joins; server errors land in st.error
    onClose();
  };

  return (
    <Pressable style={s.modalOverlay} onPress={onClose}>
      <Pressable style={s.modalCard} onPress={() => {}}>
        <Text style={s.modalTitle}>Add a bot</Text>
        <Text style={s.label}>model</Text>
        <Pressable style={s.input} onPress={() => setOpen(!open)}>
          <Text style={{ color: model ? theme.text : theme.dim }}>
            {model ?? (models === null ? "loading models…" : "no models")} {open ? "▴" : "▾"}
          </Text>
        </Pressable>
        {open && models ? (
          <ScrollView style={s.dropdown}>
            {models.map((m) => (
              <Pressable
                key={m}
                style={[s.dropdownRow, m === model && { backgroundColor: theme.panelHi }]}
                onPress={() => {
                  setModel(m);
                  setOpen(false);
                }}
              >
                <Text style={{ color: theme.text, fontSize: 13 }}>{m}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Text style={s.label}>instructions (optional)</Text>
        <TextInput
          style={[s.input, { minHeight: 64 }]}
          value={instructions}
          onChangeText={setInstructions}
          placeholder='e.g. "always play the Scout class"'
          placeholderTextColor={theme.dim}
          multiline
        />
        <View style={s.row}>
          <Btn label="Add" kind="primary" disabled={!model} onPress={add} />
          <Btn label="Cancel" kind="ghost" onPress={onClose} />
        </View>
      </Pressable>
    </Pressable>
  );
}

export function ClassSelectScreen() {
  const { st, action } = useGame();
  const game = st.game!;
  const you = st.session?.you ?? "";
  const choices = game.legal.filter((l) => l.type === "chooseClass");
  const spectating = !game.view.players.some((p) => p.id === you);
  const picked = choices.length === 0;
  const [zoomClass, setZoomClass] = useState<string | null>(null);
  const zoomArt = zoomClass ? classArt(zoomClass) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <ScrollView style={s.root} contentContainerStyle={s.center}>
      <Text style={s.logo}>{spectating ? "class select" : "choose your class"}</Text>
      <Text style={s.tag}>picks are hidden until everyone locks in</Text>
      {picked ? (
        <Text style={[s.dim, { marginTop: 30 }]}>
          {spectating ? "👁 spectating — waiting for players to pick…" : "locked in — waiting for the others…"}
        </Text>
      ) : (
        <View style={s.classGrid}>
          {choices.map((c) => {
            const meta = CLASS_META[c.classId!];
            const abilities = ABILITY_TEXT[c.classId!] ?? {};
            const keyOrder = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "stun", "counter", "rally", "advantage", "inspiration", "0"];
            const keyLabel: Record<string, string> = { stun: "S", counter: "C", rally: "R", advantage: "A", inspiration: "I", "0": "0" };
            if (!meta) return null;
            return (
              <View key={c.classId} style={s.classCard}>
                {classArt(c.classId!) ? (
                  <Pressable onPress={() => setZoomClass(c.classId!)}>
                    <Image source={classArt(c.classId!)!} style={s.classArt} resizeMode="contain" />
                  </Pressable>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ColorChip color={meta.color} />
                  <Text style={s.className}>{meta.name}</Text>
                </View>
                <Text style={s.classBlurb}>{meta.blurb}</Text>
                <View style={s.statsRow}>
                  <Text style={s.stat}>❤ {meta.hp} HP</Text>
                  <Text style={s.stat}>🎲 {meta.dice}</Text>
                  <Text style={s.stat}>{meta.color} bonus {meta.bonus}</Text>
                </View>
                {meta.passive ? <Text style={s.passive}>{meta.passive}</Text> : null}
                <View style={{ gap: 1 }}>
                  {keyOrder
                    .filter((k) => abilities[k])
                    .map((k) => (
                      <Text key={k} style={s.abilityLine}>
                        <Text style={s.abilityKey}>{keyLabel[k] ?? k}</Text> {abilities[k].name}
                      </Text>
                    ))}
                </View>
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
    {zoomArt ? <ArtLightbox source={zoomArt} ratio={CLASS_ART_RATIO} onClose={() => setZoomClass(null)} /> : null}
    </View>
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
    width: 230,
    gap: 8,
  },
  // explicit height: RN-web doesn't map aspectRatio to CSS, and without it
  // the Image falls back to the PNG's intrinsic 1500px height
  classArt: { width: "100%", height: 206 / CLASS_ART_RATIO, borderRadius: 8 },
  className: { color: theme.text, fontWeight: "800", fontSize: 15 },
  classBlurb: { color: theme.dim, fontSize: 11 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    color: theme.text,
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: theme.panelHi,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  passive: { color: "#d8c27a", fontSize: 10.5, lineHeight: 15 },
  abilityLine: { color: theme.dim, fontSize: 10.5, lineHeight: 15 },
  abilityKey: { color: theme.accent, fontWeight: "800" },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 12,
    padding: 16,
    width: "100%",
    maxWidth: 380,
    gap: 8,
  },
  modalTitle: { color: theme.text, fontWeight: "800", fontSize: 16 },
  dropdown: {
    maxHeight: 180,
    backgroundColor: theme.panelHi,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
  },
  dropdownRow: { paddingHorizontal: 12, paddingVertical: 8 },
});
