import { useEffect } from "react";
import { WorldMap } from "./map/WorldMap";
import { startSimulation } from "./state/gameStore";
import { GameErrors } from "./ui/GameErrors";
import { InfoPanel } from "./ui/InfoPanel";
import { Legend } from "./ui/Legend";
import { PlayerCard } from "./ui/PlayerCard";
import { TimeControls } from "./ui/TimeControls";
import { TopBar } from "./ui/TopBar";
import { ZoomControls } from "./ui/ZoomControls";

export function App() {
  useEffect(() => startSimulation(), []);
  return (
    <div className="app">
      <WorldMap />
      <TopBar />
      <PlayerCard />
      <InfoPanel />
      <Legend />
      <ZoomControls />
      <TimeControls />
      <GameErrors />
      <footer className="credits">
        Map, cities, starting population &amp; GDP: Natural Earth (public domain) · Country facts: mledoze/countries (ODbL) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}
