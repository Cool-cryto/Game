import { useEffect, useState } from "react";
import { WorldMap } from "./map/WorldMap";
import { GlobeView } from "./map/globe/GlobeView";
import { useUi } from "./state/uiStore";
import { useEditor } from "./state/editor";
import { EditorPanel } from "./ui/EditorPanel";
import { startSimulation } from "./state/gameStore";
import { GameErrors } from "./ui/GameErrors";
import { InfoPanel } from "./ui/InfoPanel";
import { NewsFeed } from "./ui/NewsFeed";
import { OnlineDialog } from "./ui/OnlineDialog";
import { OnlinePanel } from "./ui/OnlinePanel";

function OnlineDialogHost() {
  const open = useUi((s) => s.onlineDialog);
  const setOpen = useUi((s) => s.setOnlineDialog);
  return <OnlineDialog open={open} onClose={() => setOpen(false)} />;
}
import { Legend } from "./ui/Legend";
import { ZoomControls } from "./ui/ZoomControls";
import { Guide, StartScreen } from "./ui/simple/SimpleHud";
import { InfoBar, TopNav } from "./ui/nav/TopNav";
import { MapModeControl } from "./ui/nav/MapModeControl";
import { ScreenHost } from "./ui/screens/ScreenHost";

export function App() {
  useEffect(() => startSimulation(), []);
  const view = useUi((s) => s.view);
  const editorWanted = useUi((s) => s.editor);
  const editing = useEditor((s) => s.active);
  useEffect(() => {
    if (!editorWanted) return;
    useUi.getState().setEditor(false);
    useUi.getState().select(null);
    void useEditor.getState().open();
  }, [editorWanted]);
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
      <TopNav />
      <InfoBar />
      {!editing && <ScreenHost />}
      {editing ? <EditorPanel /> : <InfoPanel />}
      {!editing && <StartScreen />}
      {!editing && <Guide />}
      <MapModeControl />
      <Legend />
      <ZoomControls />
      <GameErrors />
      <NewsFeed />
      <OnlinePanel />
      <OnlineDialogHost />
      <footer className="credits">
        Map, cities, modern population &amp; GDP: Natural Earth (public domain) · 1991 figures: World Bank (CC BY 4.0) · Country facts: mledoze/countries (ODbL) · Governments: V-Dem Regimes of the World (CC BY-SA 4.0, via Our World in Data) and Wikidata (CC0) · International organizations: Wikidata (CC0) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}
