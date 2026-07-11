// Turn/decision chime: WebAudio on web, silent no-op elsewhere. No assets —
// the tones are synthesized. Mute preference persists in localStorage.

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    const AC =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const MUTE_KEY = "tetrad.muted";

export function isMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* native: session-only default */
  }
}

function tone(ac: AudioContext, freq: number, at: number, dur: number, gainPeak = 0.12): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(gainPeak, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** "turn": rising two-note ding. "decision": single urgent note. */
export function chime(kind: "turn" | "decision" = "turn"): void {
  if (isMuted()) return;
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  if (kind === "turn") {
    tone(ac, 660, t, 0.25);
    tone(ac, 880, t + 0.13, 0.35);
  } else {
    tone(ac, 523, t, 0.2);
    tone(ac, 523, t + 0.22, 0.2);
  }
}

/** Prefix the browser tab title while it's your turn (web only). */
export function setTitleAlert(on: boolean): void {
  try {
    if (typeof document === "undefined") return;
    const base = document.title.replace(/^● /, "");
    document.title = on ? `● ${base}` : base;
  } catch {
    /* native */
  }
}
