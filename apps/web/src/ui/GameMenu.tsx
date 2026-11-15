import { useEffect, useRef, useState } from "react";
import { online, useOnline } from "../net/online";
import { newGameState, useGame } from "../state/gameStore";
import { deleteSlot, describe, exportSave, importSave, listSlots, loadFromSlot, saveToSlot, SLOTS, type SaveInfo, type Slot } from "../state/saves";
import { useUi } from "../state/uiStore";
import { SCENARIOS } from "../data/scenarios";
import { listWorlds, type SavedWorld } from "../state/worlds";
import { scenarioFromCustom } from "../data/scenarios";
import { formatDate } from "./format";

/** New game, save, load, export and import. */
export function GameMenu() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      useGame.getState().setPaused(true);
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button className="menu-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Game</span>
      </button>
      <dialog ref={dialog} className="dialog" onClose={() => setOpen(false)} aria-label="Game menu">
        {open && <MenuBody close={() => setOpen(false)} />}
      </dialog>
    </>
  );
}

function MenuBody({ close }: { close: () => void }) {
  const [slots, setSlots] = useState<Partial<Record<Slot, SaveInfo>>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replace = useGame((s) => s.replace);
  const select = useUi((s) => s.select);
  const refresh = () => listSlots().then(setSlots, (e: unknown) => setMessage({ text: String(e instanceof Error ? e.message : e), error: true }));
  useEffect(() => {
    refresh();
  }, []);

  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  const loaded = (text: string) => {
    select(null);
    setMessage({ text });
    close();
  };

  const current = describe(useGame.getState().state);

  return (
    <div className="dialog__body">
      <div className="dialog__head">
        <h2>Game</h2>
        <button className="icon-btn" onClick={close} aria-label="Close menu">
          ×
        </button>
      </div>
      <p className="dialog__sub">
        {formatDate(current.gameDate)} · {current.country ? `Playing as ${current.country}` : "No country chosen yet"}
      </p>

      <OnlineSection close={close} />

      {useGame.getState().mode === "online" ? (
        <p className="dialog__hint">This is an online game: the server saves it automatically. You can still export a copy below.</p>
      ) : (
        <>
      <h3>Save slots</h3>
      <p className="dialog__hint">Saves are kept in this browser on this device. Use Export to keep a copy elsewhere.</p>
      <ul className="slots">
        {SLOTS.map((slot) => {
          const info = slots[slot];
          return (
            <li key={slot} className="slot" data-testid={`slot-${slot}`}>
              <div className="slot__info">
                <strong>Slot {slot}</strong>
                <span>{info ? `${info.country ?? "No country"} · ${formatDate(info.gameDate)}` : "Empty"}</span>
                {info && <span className="slot__time">Saved {new Date(info.savedAt).toLocaleString()}</span>}
              </div>
              <div className="slot__actions">
                <button
                  className="btn btn--small"
                  onClick={() =>
                    attempt(async () => {
                      await saveToSlot(slot, useGame.getState().state);
                      await refresh();
                      setMessage({ text: `Saved to slot ${slot}.` });
                    })
                  }
                >
                  Save
                </button>
                <button
                  className="btn btn--small btn--ghost"
                  disabled={!info}
                  onClick={() =>
                    attempt(async () => {
                      replace(await loadFromSlot(slot));
                      loaded(`Loaded slot ${slot}.`);
                    })
                  }
                >
                  Load
                </button>
                <button
                  className="icon-btn"
                  disabled={!info}
                  aria-label={`Delete slot ${slot}`}
                  title="Delete"
                  onClick={() =>
                    attempt(async () => {
                      await deleteSlot(slot);
                      await refresh();
                    })
                  }
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>

        </>
      )}

      <h3>Files</h3>
      <div className="dialog__row">
        <button className="btn btn--ghost" onClick={() => exportSave(useGame.getState().state)}>
          Export save file
        </button>
        <button className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
          Import save file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              attempt(async () => {
                replace(await importSave(file));
                loaded(`Loaded ${file.name}.`);
              });
          }}
        />
      </div>

      {useGame.getState().mode === "local" && <NewGame onStarted={(name) => loaded(`New game started: ${name}.`)} onEditor={close} />}

      {message && (
        <p className={message.error ? "dialog__msg dialog__msg--error" : "dialog__msg"} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

function OnlineSection({ close }: { close: () => void }) {
  const room = useOnline((s) => s.room);
  const setOnlineDialog = useUi((s) => s.setOnlineDialog);
  return (
    <>
      <h3>Online</h3>
      {room ? (
        <div className="dialog__row">
          <span>
            Playing on <strong>{room.name}</strong>
          </span>
          <button
            className="btn btn--ghost btn--small"
            onClick={() => {
              online.leave();
              close();
            }}
          >
            Leave server
          </button>
        </div>
      ) : (
        <button
          className="btn btn--primary"
          onClick={() => {
            close();
            setOnlineDialog(true);
          }}
        >
          Play online…
        </button>
      )}
    </>
  );
}

/** Pick a world and start over. */
function NewGame({ onStarted, onEditor }: { onStarted: (name: string) => void; onEditor: () => void }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<SavedWorld[]>([]);
  const [error, setError] = useState<string | null>(null);
  const replace = useGame((s) => s.replace);
  const setEditor = useUi((s) => s.setEditor);
  useEffect(() => {
    listWorlds().then(setWorlds, () => {});
  }, []);
  const start = async (id: string) => {
    try {
      const builtIn = SCENARIOS.find((x) => x.id === id);
      const saved = worlds.find((w) => `world:${w.id}` === id);
      const scenario = builtIn ? await builtIn.load() : saved ? await scenarioFromCustom(saved.world) : null;
      if (!scenario) return;
      replace(newGameState(scenario));
      onStarted(scenario.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <h3>New game</h3>
      <p className="dialog__hint">Starting a new game replaces the current one (save first if you want to keep it).</p>
      <ul className="slots" aria-label="Scenarios">
        {SCENARIOS.map((sc) => (
          <li key={sc.id} className="slot" data-testid={`scenario-${sc.id}`}>
            <div className="slot__info">
              <strong>
                {sc.name} <span className="tag">{sc.year}</span>
              </strong>
              <span>{sc.description}</span>
            </div>
            <ScenarioButton id={sc.id} choice={choice} setChoice={setChoice} start={start} />
          </li>
        ))}
        {worlds.map((w) => (
          <li key={w.id} className="slot" data-testid={`world-${w.world.name}`}>
            <div className="slot__info">
              <strong>
                {w.world.name} <span className="tag">custom</span>
              </strong>
              <span>
                Based on {SCENARIOS.find((s) => s.id === w.world.base)?.name ?? w.world.base} · {Object.keys(w.world.owners).length} provinces changed ·{" "}
                {Object.keys(w.world.newCountries).length} new countries
              </span>
            </div>
            <ScenarioButton id={`world:${w.id}`} choice={choice} setChoice={setChoice} start={start} />
          </li>
        ))}
      </ul>
      <div className="dialog__row">
        <button
          className="btn btn--ghost"
          onClick={() => {
            onEditor();
            setEditor(true);
          }}
          data-testid="open-editor"
        >
          Create a custom world…
        </button>
      </div>
      {error && <p className="dialog__msg dialog__msg--error">{error}</p>}
    </>
  );
}

function ScenarioButton({ id, choice, setChoice, start }: { id: string; choice: string | null; setChoice: (c: string | null) => void; start: (id: string) => void }) {
  if (choice !== id)
    return (
      <button className="btn btn--ghost btn--small" onClick={() => setChoice(id)}>
        Start…
      </button>
    );
  return (
    <div className="slot__actions">
      <button className="btn btn--danger btn--small" onClick={() => start(id)}>
        Start new game
      </button>
      <button className="btn btn--ghost btn--small" onClick={() => setChoice(null)}>
        Cancel
      </button>
    </div>
  );
}
