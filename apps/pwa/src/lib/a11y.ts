/** Per-device accessibility settings (roadmap principle 1: audio/visual
 *  parity — nothing conveyed by sound alone). Persisted locally; every
 *  client honors them independently, so one player's large captions never
 *  change another's screen. */

import { writable } from "svelte/store";

export interface A11ySettings {
  captions: boolean;          // the screen's caption band
  captionSize: "normal" | "large";
  highContrast: boolean;
  reduceMotion: "auto" | "on" | "off";  // auto = follow the OS
  haptics: boolean;           // phone vibration cues
}

const DEFAULTS: A11ySettings = {
  captions: true, captionSize: "normal", highContrast: false,
  reduceMotion: "auto", haptics: true,
};

const KEY = "hermys.a11y";

function load(): A11ySettings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
  catch { return DEFAULTS; }
}

export const a11y = writable<A11ySettings>(load());
a11y.subscribe(v => {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(v));
});

export function motionReduced(s: A11ySettings): boolean {
  if (s.reduceMotion === "on") return true;
  if (s.reduceMotion === "off") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Haptic cue — silently a no-op where unsupported (desktop, iOS Safari). */
export function vibrate(pattern: number | number[], s: A11ySettings): void {
  if (!s.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export const HAPTIC = {
  narration: 30,
  rollCall: [70, 50, 70] as number[],
  privateReveal: [120] as number[],
  yourTurn: [90, 60, 90, 60, 90] as number[],
};
