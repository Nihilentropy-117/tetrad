import { StatusBar } from "expo-status-bar";
import React from "react";
import { View } from "react-native";
import { theme } from "./components";
import { ClassSelectScreen, ConnectScreen, LobbyScreen } from "./screens";
import { GameProvider, useGame } from "./store";
import { Table } from "./Table";

function Router() {
  const { st } = useGame();
  if (st.game) {
    return st.game.view.phase === "classSelect" ? <ClassSelectScreen /> : <Table />;
  }
  if (st.session && st.lobby && st.status === "connected") return <LobbyScreen />;
  return <ConnectScreen />;
}

export default function App() {
  return (
    <GameProvider>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar style="light" />
        <Router />
      </View>
    </GameProvider>
  );
}
