import { Component, type ReactNode } from "react";
import { useUi } from "../../state/uiStore";
import { CountryScreen, EconomyScreen, MilitaryScreen } from "./CoreScreens";
import { useEscapeCloses } from "./Screen";
import { ConstructionScreen, DiplomacyScreen, MoreScreen, ResearchScreen, StatisticsScreen } from "./WorldScreens";
import { GovernmentScreen } from "./GovernmentScreen";

/** Shows the one open management screen (if any) over the left of the map. */
export function ScreenHost() {
  const screen = useUi((s) => s.screen);
  useEscapeCloses();
  if (!screen) return null;
  return (
    <ScreenErrorBoundary key={screen}>
      <ScreenFor screen={screen} />
    </ScreenErrorBoundary>
  );
}

/** If a screen hits a bug, show that instead of taking the whole game (and the map) down with it. */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Screen failed:", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="screen" aria-label="Screen error">
        <div className="screen__empty">
          <p>Sorry, this screen ran into a problem. The game itself is fine.</p>
          <button className="btn btn--primary btn--small" onClick={() => useUi.getState().setScreen(null)}>
            Back to map
          </button>
        </div>
      </section>
    );
  }
}

function ScreenFor({ screen }: { screen: string }) {
  switch (screen) {
    case "country":
      return <CountryScreen />;
    case "economy":
      return <EconomyScreen />;
    case "military":
      return <MilitaryScreen />;
    case "diplomacy":
      return <DiplomacyScreen />;
    case "government":
      return <GovernmentScreen />;
    case "research":
      return <ResearchScreen />;
    case "construction":
      return <ConstructionScreen />;
    case "statistics":
      return <StatisticsScreen />;
    case "more":
      return <MoreScreen />;
    default:
      return null;
  }
}
