/**
 * Move the camera with the keyboard: W/A/S/D (and the arrow keys) pan while held, smoothly, at the same speed
 * on screen whatever the zoom. Ignored while typing (search, chat, names) or with Ctrl/Cmd/Alt held.
 *
 * `pan(dx, dy)` gets the distance to move this frame in screen pixels: positive dx = look further right (east),
 * positive dy = look further down (south). `active()` says whether this view is the one on screen.
 */
const KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  arrowup: [0, -1],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowright: [1, 0],
};
/** Screen pixels per second; holding Shift goes twice as fast. */
const SPEED = 650;

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || !!t.closest("input, textarea, select, [role=listbox]"));

export function startKeyPan(pan: (dx: number, dy: number) => void, active: () => boolean): () => void {
  const held = new Set<string>();
  let frame = 0;
  let last = 0;
  let fast = false;

  const step = (now: number) => {
    frame = 0;
    if (!held.size || !active()) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let x = 0;
    let y = 0;
    for (const k of held) {
      x += KEYS[k]![0];
      y += KEYS[k]![1];
    }
    const len = Math.hypot(x, y);
    if (len) pan((x / len) * SPEED * (fast ? 2 : 1) * dt, (y / len) * SPEED * (fast ? 2 : 1) * dt);
    frame = requestAnimationFrame(step);
  };
  const onDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!(k in KEYS) || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !active()) return;
    // Arrow keys would otherwise scroll a list or move a slider that has focus.
    e.preventDefault();
    fast = e.shiftKey;
    held.add(k);
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(step);
    }
  };
  const onUp = (e: KeyboardEvent) => {
    held.delete(e.key.toLowerCase());
    fast = e.shiftKey;
  };
  const clear = () => held.clear();
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", clear);
  return () => {
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
    window.removeEventListener("blur", clear);
    cancelAnimationFrame(frame);
  };
}
