import { useRef, useState } from "react";
import { applyCustomWorld } from "@gs/sim";
import { flagUrl, getCountry } from "../data/countries";
import { SCENARIOS, scenarioFromCustom } from "../data/scenarios";
import { online, useOnline } from "../net/online";
import { playDraft, useEditor } from "../state/editor";
import { useGame } from "../state/gameStore";
import { exportWorld, saveWorld } from "../state/worlds";
import { useUi } from "../state/uiStore";

const PALETTE = ["#c0504d", "#4f81bd", "#9bbb59", "#8064a2", "#f79646", "#4bacc6", "#d4a017", "#2e8b57"];

/** The world editor's side panel. */
export function EditorPanel() {
  const ed = useEditor();
  const draft = ed.draft;
  const state = useGame((s) => s.state);
  const signedIn = useOnline((s) => s.user !== null && s.status === "online");
  const setOnlineDialog = useUi((s) => s.setOnlineDialog);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[Object.keys(draft.newCountries).length % PALETTE.length]!);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // A country just created in the editor isn't on the map yet: take its name and color from the draft.
  const fresh = ed.brush ? draft.newCountries[ed.brush] : undefined;
  const brush = ed.brush ? (fresh ? { name: fresh.name, hasFlag: false, id: ed.brush } : getCountry(ed.brush)) : undefined;
  const brushColor = fresh?.color ?? (ed.brush ? (state.countries[ed.brush]?.color ?? null) : null);
  const changed = Object.keys(draft.owners).length;
  const created = Object.keys(draft.newCountries).length;

  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  return (
    <aside className="panel editor" aria-label="World editor" data-testid="editor">
      <div className="panel__head">
        <div className="panel__titles">
          <p className="panel__eyebrow">World editor</p>
          <input className="input editor__name" aria-label="World name" value={draft.name} maxLength={40} onChange={(e) => ed.setName(e.target.value)} />
        </div>
        <button className="icon-btn" onClick={ed.close} aria-label="Close editor" title="Close without playing (your game comes back)">
          ×
        </button>
      </div>

      <section>
        <h3>Start from</h3>
        <select
          className="input editor__select"
          aria-label="Base scenario"
          value={draft.base}
          disabled={ed.busy}
          onChange={(e) => {
            if (!changed || confirm("Switching the starting world clears your changes. Continue?")) void ed.setBase(e.target.value);
          }}
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.year})
            </option>
          ))}
        </select>
      </section>

      {ed.busy && <p className="panel__small">Loading the starting world…</p>}
      <fieldset className="editor__tools" disabled={ed.busy}>
      <section>
        <h3>Brush</h3>
        <div className="brush" data-testid="brush">
          {brush ? (
            <>
              {brushColor ? (
                <span className="brush__swatch" style={{ background: brushColor }} />
              ) : !fresh && flagUrl(brush as never) ? (
                <img src={flagUrl(brush as never)!} alt="" />
              ) : (
                <span className="flag-placeholder brush__swatch" />
              )}
              <strong>{brush.name}</strong>
            </>
          ) : (
            <span className="muted">No country chosen</span>
          )}
        </div>
        <div className="diplomacy__actions">
          <button className={`btn btn--small ${ed.picking ? "btn--primary" : "btn--ghost"}`} onClick={() => ed.setPicking(!ed.picking)}>
            {ed.picking ? "Click a country on the map…" : "Pick a country from the map"}
          </button>
        </div>
        <form
          className="dialog__row editor__new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            ed.addCountry(newName, newColor);
            setNewName("");
            setNewColor(PALETTE[(created + 1) % PALETTE.length]!);
          }}
        >
          <input className="input" aria-label="New country name" placeholder="New country name" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
          <input type="color" aria-label="New country color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
          <button className="btn btn--ghost btn--small" type="submit" disabled={!newName.trim()}>
            Create
          </button>
        </form>
        <div className="segmented editor__mode" role="radiogroup" aria-label="Paint">
          <button role="radio" aria-checked={!ed.paintWhole} className={!ed.paintWhole ? "is-on" : undefined} onClick={() => ed.setPaintWhole(false)}>
            One province
          </button>
          <button role="radio" aria-checked={ed.paintWhole} className={ed.paintWhole ? "is-on" : undefined} onClick={() => ed.setPaintWhole(true)}>
            Whole country
          </button>
        </div>
        <p className="panel__small">
          {brush
            ? `Click the map to give land to ${brush.name}. Zoom in (3× or more) to see province borders.`
            : "Pick a country from the map, or create a new one, then click the map to give it land."}
        </p>
      </section>

      <section>
        <h3>Changes</h3>
        <p data-testid="editor-stats">
          {changed} province{changed === 1 ? "" : "s"} changed · {created} new countr{created === 1 ? "y" : "ies"}
        </p>
        <div className="diplomacy__actions">
          <button className="btn btn--ghost btn--small" disabled={!ed.history.length} onClick={ed.undo}>
            Undo
          </button>
          <button className="btn btn--ghost btn--small" disabled={!changed && !created} onClick={() => confirm("Clear all changes?") && ed.reset()}>
            Clear all
          </button>
        </div>
      </section>

      <section>
        <h3>Save and share</h3>
        <div className="diplomacy__actions">
          <button
            className="btn btn--ghost btn--small"
            onClick={() =>
              attempt(async () => {
                await saveWorld(draft);
                setMessage({ text: `Saved "${draft.name}" in this browser. It's listed under Game → New game.` });
              })
            }
          >
            Save in browser
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => exportWorld(draft)}>
            Export file
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => fileInput.current?.click()}>
            Import file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="world-import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                attempt(async () => {
                  const world = JSON.parse(await file.text()) as unknown;
                  await scenarioFromCustom(world); // checks it
                  await ed.load(world as typeof draft);
                  setMessage({ text: `Loaded ${file.name}.` });
                });
            }}
          />
        </div>
      </section>

      </fieldset>

      <div className="panel__actions">
        <button
          className="btn btn--primary"
          disabled={ed.busy || !ed.base}
          onClick={() =>
            attempt(async () => {
              if (!draft.name.trim()) throw new Error("Give your world a name first.");
              playDraft(applyCustomWorld(ed.base!, draft));
            })
          }
        >
          Play this world
        </button>
        <button
          className="btn btn--ghost"
          disabled={ed.busy || !ed.base}
          title="Create a private online server with this world"
          onClick={() =>
            attempt(async () => {
              if (!signedIn) {
                setOnlineDialog(true);
                throw new Error("Sign in to play online first (the Play online window is open), then press this again.");
              }
              await scenarioFromCustom(draft); // checks it
              useEditor.getState().close();
              online.create(draft.name, { custom: draft });
            })
          }
        >
          Host it online
        </button>
      </div>
      {message && (
        <p className={message.error ? "dialog__msg dialog__msg--error" : "dialog__msg"} role="status">
          {message.text}
        </p>
      )}
    </aside>
  );
}
