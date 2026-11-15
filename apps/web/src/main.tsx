import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { handleCheckoutReturn, refreshAccess, useAccess } from "./net/access";
import { Welcome } from "./ui/Welcome";
import "./styles.css";

/** Show the game, or (when the server has a paywall and you haven't unlocked it) the welcome menu. */
function Root() {
  const status = useAccess((s) => s.status);
  useEffect(() => {
    void handleCheckoutReturn().then(refreshAccess);
    void refreshAccess();
  }, []);
  if (status === "checking") return <div className="splash" aria-label="Loading" />;
  return status === "open" ? <App /> : <Welcome />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
