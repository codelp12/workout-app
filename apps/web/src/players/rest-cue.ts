// The "rest over" beep, played with Web Audio so there's no sound file to
// cache. iOS only starts audio from a tap, so the player primes it on Log set.
let audio: AudioContext | null = null;

/** Call from a tap handler so the beep can play later. */
export function primeRestCue(): void {
  if (typeof AudioContext === "undefined") return;
  audio ??= new AudioContext();
  if (audio.state !== "running") audio.resume().catch(() => undefined);
}

/** Two short beeps, plus a buzz where the browser can vibrate (not iOS). */
export function playRestCue(): void {
  if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
  if (!audio) return;
  if (audio.state !== "running") audio.resume().catch(() => undefined);
  const start = audio.currentTime;
  for (const offset of [0, 0.3]) {
    const at = start + offset;
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    tone.connect(gain).connect(audio.destination);
    tone.start(at);
    tone.stop(at + 0.22);
  }
}
