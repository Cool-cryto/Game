import { WorldMap } from "./map/WorldMap";
import { CountryPanel } from "./ui/CountryPanel";
import { Legend } from "./ui/Legend";
import { TopBar } from "./ui/TopBar";
import { ZoomControls } from "./ui/ZoomControls";

export function App() {
  return (
    <div className="app">
      <WorldMap />
      <TopBar />
      <CountryPanel />
      <Legend />
      <ZoomControls />
      <footer className="credits">
        Borders: Natural Earth (public domain) · Country facts: mledoze/countries (ODbL) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}
