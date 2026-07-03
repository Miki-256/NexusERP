let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function tone(freq: number, durationMs: number, gain = 0.12) {
  const ac = ctx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  amp.gain.value = gain;
  osc.connect(amp);
  amp.connect(ac.destination);
  const t = ac.currentTime;
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);
  osc.start(t);
  osc.stop(t + durationMs / 1000 + 0.02);
}

/** Short success beep — standard POS scan sound. */
export function playScanSuccessSound() {
  tone(880, 90, 0.1);
  setTimeout(() => tone(1175, 70, 0.08), 70);
}

/** Lower error tone when barcode unknown or invalid. */
export function playScanErrorSound() {
  tone(220, 160, 0.1);
}
