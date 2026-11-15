/// <reference lib="webworker" />
// Runs the game simulation in the background so the map and menus never stutter.
// The page sends commands and speed changes; this worker sends back the game state
// a few times a second (and right away while paused, so changes show instantly).
import { applyCommand, tick, type Command, type GameState } from "@gs/sim";
import { DAYS_PER_SECOND, type SimRequest, type SimResponse, type Speed } from "./protocol";

const STEP_MS = 50;
const POST_EVERY_MS = 200;
/** Never run more than this many days in one step, so a slow device can't freeze. */
const MAX_DAYS_PER_STEP = 20;

let state: GameState | null = null;
let speed: Speed = 1;
let paused = true;
let queue: Command[] = [];
let carry = 0;
let last = performance.now();
let lastPost = 0;
let dirty = false;
let errors: string[] = [];

const post = (msg: SimResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const msg = e.data;
  if (msg.type === "start") {
    state = msg.state;
    queue = [];
    carry = 0;
    dirty = true;
  } else if (msg.type === "command") queue.push(msg.command);
  else if (msg.type === "setSpeed") speed = msg.speed;
  else if (msg.type === "setPaused") {
    paused = msg.paused;
    carry = 0;
    dirty = true;
  }
};

setInterval(() => {
  const now = performance.now();
  const seconds = (now - last) / 1000;
  last = now;
  if (!state) return;

  if (paused) {
    // While paused, apply commands straight away so the player sees the effect.
    for (const cmd of queue.splice(0)) {
      const err = applyCommand(state, cmd);
      if (err) errors.push(err);
      dirty = true;
    }
  } else {
    carry += seconds * DAYS_PER_SECOND[speed];
    const days = Math.min(Math.floor(carry), MAX_DAYS_PER_STEP);
    carry = Math.min(carry - days, 5); // drop backlog rather than racing to catch up
    for (let i = 0; i < days; i++) {
      errors.push(...tick(state, i === 0 ? queue.splice(0) : []));
      dirty = true;
    }
  }

  if (dirty && (paused || now - lastPost >= POST_EVERY_MS)) {
    post({ type: "state", state, errors, paused });
    errors = [];
    dirty = false;
    lastPost = now;
  }
}, STEP_MS);
