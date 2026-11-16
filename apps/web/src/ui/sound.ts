import { create } from "zustand";
import type { EventKind } from "@gs/sim";

/**
 * Short alert tones for important news involving your country (war, peace, annexation, battles), made with the Web
 * Audio API: no sound files. On by default; the setting is remembered in this browser.
 */
const KEY = "wa.sound";
const initial = (() => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();

export const useSound = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: initial,
  setOn: (on) => {
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* not remembered */
    }
    set({ on });
  },
}));

let ctx: AudioContext | null = null;

/** Notes (Hz) for each kind of alert: falling for bad news, rising for good. */
const TONES: Partial<Record<EventKind, number[]>> = {
  war: [440, 330, 247],
  annexation: [392, 294],
  battle: [330, 262],
  peace: [392, 523],
  alliance: [440, 554],
  occupation: [294, 247],
};

export function playAlert(kind: EventKind) {
  const notes = TONES[kind];
  if (!notes || !useSound.getState().on || typeof AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  } catch {
    /* no audio: fine */
  }
}
