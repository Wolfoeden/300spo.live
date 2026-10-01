"use client";

// The sounds of 300 Games, made in the browser with Web Audio: no audio files,
// nothing to license, nothing to download. Browsers only let sound start after
// the player has touched the page, so the first tap or key press unlocks it.
// The mute switch is remembered per browser.

export type Sound =
  | "chip" // a chip lands on a lane
  | "click" // a small control (undo, clear)
  | "start" // races start
  | "flip" // a card is turned
  | "back" // an ace has to step back
  | "win" // one win
  | "bigWin" // the sum of several wins
  | "tick" // counting up
  | "hop" // the cock crosses a lane
  | "cluck" // the cock sets off
  | "crash" // a car hits
  | "spin" // the coin is thrown
  | "land" // the coin lands
  | "knock"; // the dealer knocks twice: the dealer's turn

const MUTE_KEY = "300spo:muted";
const VOLUME = 0.32;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
const listeners = new Set<() => void>();
// The same sound twice within this many milliseconds plays once (four races flip cards together).
const lastPlayed = new Map<Sound, number>();
const GAP_MS = 45;

function readMuted() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function audio() {
  if (typeof window === "undefined" || muted) return null;
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    master = context.createGain();
    master.gain.value = VOLUME;
    master.connect(context.destination);
  }
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context.state === "running" ? context : null;
}

// Sound may only start after a user gesture: the first one creates and resumes the context.
if (typeof window !== "undefined") {
  const unlock = () => {
    audio();
    if (context?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export const isMuted = () => muted;

export function setMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // Only this visit remembers it.
  }
  if (!next) audio();
  listeners.forEach((listener) => listener());
}

export function subscribeMuted(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A tone that starts at `at` seconds from now: frequency glide, attack and exponential decay. */
function tone(
  ctx: AudioContext,
  { type = "sine", from, to = from, at = 0, length, volume = 1, attack = 0.005 }: { type?: OscillatorType; from: number; to?: number; at?: number; length: number; volume?: number; attack?: number },
) {
  const start = ctx.currentTime + at;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(master!);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

/** A burst of noise through a band-pass filter, optionally sweeping. */
function noise(ctx: AudioContext, { at = 0, length, volume = 1, from, to = from, q = 1.2 }: { at?: number; length: number; volume?: number; from: number; to?: number; q?: number }) {
  const start = ctx.currentTime + at;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, start + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(gain).connect(master!);
  source.start(start);
}

const RECIPES: Record<Sound, (ctx: AudioContext) => void> = {
  chip: (ctx) => {
    tone(ctx, { type: "triangle", from: 2100, length: 0.07, volume: 0.35 });
    tone(ctx, { type: "sine", from: 3150, at: 0.035, length: 0.09, volume: 0.25 });
    noise(ctx, { from: 5000, length: 0.03, volume: 0.25 });
  },
  click: (ctx) => tone(ctx, { type: "triangle", from: 900, to: 700, length: 0.05, volume: 0.25 }),
  start: (ctx) => {
    noise(ctx, { from: 400, to: 2600, length: 0.32, volume: 0.35, q: 0.8 });
    tone(ctx, { type: "sine", from: 110, to: 70, length: 0.25, volume: 0.6 });
  },
  flip: (ctx) => noise(ctx, { from: 2600, to: 1500, length: 0.075, volume: 0.45, q: 1.6 }),
  back: (ctx) => {
    tone(ctx, { type: "sine", from: 170, to: 70, length: 0.22, volume: 0.7 });
    noise(ctx, { from: 300, length: 0.12, volume: 0.35 });
  },
  win: (ctx) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => tone(ctx, { type: "triangle", from: frequency, at: index * 0.075, length: 0.22, volume: 0.45 }));
    tone(ctx, { type: "sine", from: 2093, at: 0.3, length: 0.35, volume: 0.18 });
  },
  bigWin: (ctx) => {
    [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => tone(ctx, { type: "triangle", from: frequency, at: index * 0.08, length: 0.3, volume: 0.42 }));
    [523.25, 659.25, 783.99].forEach((frequency) => tone(ctx, { type: "sine", from: frequency, at: 0.5, length: 0.8, volume: 0.22, attack: 0.02 }));
  },
  tick: (ctx) => tone(ctx, { type: "square", from: 1500, length: 0.025, volume: 0.08 }),
  hop: (ctx) => tone(ctx, { type: "sine", from: 320, to: 640, length: 0.11, volume: 0.45 }),
  cluck: (ctx) => {
    tone(ctx, { type: "square", from: 760, to: 520, length: 0.06, volume: 0.16 });
    tone(ctx, { type: "square", from: 820, to: 560, at: 0.09, length: 0.07, volume: 0.16 });
  },
  crash: (ctx) => {
    tone(ctx, { type: "sawtooth", from: 440, length: 0.18, volume: 0.18 });
    tone(ctx, { type: "sawtooth", from: 466, length: 0.18, volume: 0.18 });
    noise(ctx, { from: 900, to: 200, at: 0.12, length: 0.45, volume: 0.7, q: 0.6 });
    tone(ctx, { type: "sine", from: 120, to: 45, at: 0.12, length: 0.35, volume: 0.8 });
  },
  spin: (ctx) => {
    for (let index = 0; index < 9; index += 1) tone(ctx, { type: "sine", from: 2400 + index * 60, at: index * 0.16, length: 0.08, volume: 0.12 });
    noise(ctx, { from: 1200, to: 3000, length: 1.3, volume: 0.12, q: 2 });
  },
  knock: (ctx) => {
    // Two knuckles on wood: a short low thump with a dry click on top, twice.
    for (const at of [0, 0.17]) {
      tone(ctx, { type: "sine", from: 190, to: 95, at, length: 0.12, volume: 0.9 });
      noise(ctx, { from: 1400, to: 700, at, length: 0.05, volume: 0.55, q: 2.2 });
    }
  },
  land: (ctx) => {
    tone(ctx, { type: "sine", from: 2637, length: 0.4, volume: 0.3 });
    tone(ctx, { type: "sine", from: 3951, at: 0.02, length: 0.3, volume: 0.15 });
  },
};

/** Plays a sound unless muted or the browser has not allowed sound yet. */
export function play(sound: Sound) {
  const ctx = audio();
  if (!ctx || !master) return;
  const now = performance.now();
  if (now - (lastPlayed.get(sound) ?? 0) < GAP_MS) return;
  lastPlayed.set(sound, now);
  try {
    RECIPES[sound](ctx);
  } catch {
    // A sound that fails to play never gets in the way of the game.
  }
}
