import { useEffect, useState } from "react";
import { WorldMap } from "./map/WorldMap";
import { GlobeView } from "./map/globe/GlobeView";
import { useUi } from "./state/uiStore";
import { startSimulation } from "./state/gameStore";
import { GameErrors } from "./ui/GameErrors";
import { InfoPanel } from "./ui/InfoPanel";
import { NewsFeed } from "./ui/NewsFeed";
import { Legend } from "./ui/Legend";
import { PlayerCard } from "./ui/PlayerCard";
import { TimeControls } from "./ui/TimeControls";
import { TopBar } from "./ui/TopBar";
import { ZoomControls } from "./ui/ZoomControls";

export function App() {
  useEffect(() => startSimulation(), []);
  const view = useUi((s) => s.view);
  // Build the globe the first time it's shown, then keep it (switching back is instant).
  const [globeUsed, setGlobeUsed] = useState(false);
  useEffect(() => {
    if (view === "globe") setGlobeUsed(true);
  }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog")) return;
      if (e.key === "g" || e.key === "G") useUi.getState().setView(useUi.getState().view === "flat" ? "globe" : "flat");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`app app--${view}`}>
      <div className="view view--flat" aria-hidden={view !== "flat"}>
        <WorldMap />
      </div>
      {globeUsed && (
        <div className="view view--globe" aria-hidden={view !== "globe"}>
          <GlobeView active={view === "globe"} />
        </div>
      )}
      <TopBar />
      <PlayerCard />
      <InfoPanel />
      <Legend />
      <ZoomControls />
      <TimeControls />
      <GameErrors />
      <NewsFeed />
      <footer className="credits">
        Map, cities, starting population &amp; GDP: Natural Earth (public domain) · Country facts: mledoze/countries (ODbL) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}
