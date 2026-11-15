import { WorldMap } from "./map/WorldMap";
import { InfoPanel } from "./ui/InfoPanel";
import { Legend } from "./ui/Legend";
import { TopBar } from "./ui/TopBar";
import { ZoomControls } from "./ui/ZoomControls";

export function App() {
  return (
    <div className="app">
      <WorldMap />
      <TopBar />
      <InfoPanel />
      <Legend />
      <ZoomControls />
      <footer className="credits">
        Map, cities, population &amp; GDP: Natural Earth (public domain) · Country facts: mledoze/countries (ODbL) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}
