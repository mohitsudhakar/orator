import { analyzePitch } from '../metrics.js';
const SR = 16000;

/** Physically-correct synth: integrate instantaneous frequency, harmonics locked to phase. */
function synthGood({ durSec = 2, f0 = 120, amp = 0.3, vib = 6, vibHz = 4, drift = 0, harmonics = 6 }) {
  const n = Math.floor(SR * durSec);
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + drift * t + vib * Math.sin(2 * Math.PI * vibHz * t);
    phase += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) s += (1 / h) * Math.sin(h * phase);
    pcm[i] = Math.round((s * amp * 0.35) * 32767);
  }
  return pcm;
}

/** The OLD broken synth (harmonics not phase-locked). */
function synthBad({ durSec = 2, f0 = 120, amp = 0.3, vib = 6, vibHz = 4, drift = 0 }) {
  const n = Math.floor(SR * durSec);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + drift * t + vib * Math.sin(2 * Math.PI * vibHz * t);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f * h * t);
    pcm[i] = Math.round((s * amp * 0.35) * 32767);
  }
  return pcm;
}

console.log('--- GOOD synth (phase-locked) ---');
for (const f0 of [100, 120, 150, 200, 250]) {
  const r = analyzePitch(synthGood({ f0 }), SR);
  const err = Math.abs(r.medianF0 - f0);
  console.log(`true=${f0} -> median=${r.medianF0} err=${err} frames=${r.voicedFrames} range=${r.rangeSemitones}`);
}

console.log('\n--- BAD synth (unlocked harmonics) ---');
for (const f0 of [120, 200]) {
  const r = analyzePitch(synthBad({ f0 }), SR);
  console.log(`true=${f0} -> median=${r.medianF0} frames=${r.voicedFrames}`);
}

console.log('\n--- drift monotonicity (good synth) ---');
const d1 = analyzePitch(synthGood({ durSec: 3, f0: 120, drift: 40 }), SR);
const d2 = analyzePitch(synthGood({ durSec: 2, f0: 150 }), SR);
console.log('drift mono=', d1.monotonicity, 'flat mono=', d2.monotonicity);
console.log('drift range=', d1.rangeSemitones, 'flat range=', d2.rangeSemitones);
