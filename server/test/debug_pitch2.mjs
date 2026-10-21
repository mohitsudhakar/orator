import { analyzePitch } from '../metrics.js';
const SR = 16000;
function synth({ durSec = 2, f0 = 120, amp = 0.3 }) {
  const n = SR * durSec;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + 6 * Math.sin(2 * Math.PI * 4 * t);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f * h * t);
    pcm[i] = Math.round((s * amp * 0.35) * 32767);
  }
  return pcm;
}
for (const f0 of [120, 200]) {
  const pcm = synth({ f0 });
  const r = analyzePitch(pcm, SR);
  console.log(`true=${f0} -> median=${r.medianF0} min=${r.minF0} max=${r.maxF0} frames=${r.voicedFrames} range=${r.rangeSemitones}`);
}

// manual replica of analyzePitch inner loop, printing per-frame winners
const pcm = synth({ f0: 120 });
const frameLen = 2048, hop = 512;
const winners = [];
for (let off = 0; off + frameLen < pcm.length; off += hop) {
  let energy = 0;
  for (let i = 0; i < frameLen; i++) { const s = pcm[off + i] / 32768; energy += s * s; }
  const rms = Math.sqrt(energy / frameLen);
  if (rms < 0.008) { winners.push(['skip-silent', rms]); continue; }
  const minLag = Math.floor(SR / 400), maxLag = Math.floor(SR / 70);
  let bestLag = -1, bestVal = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, norm = 0;
    for (let i = 0; i + lag < frameLen; i++) {
      const a = pcm[off + i] / 32768, b = pcm[off + i + lag] / 32768;
      corr += a * b; norm += a * a + b * b;
    }
    const v = norm > 0 ? corr / Math.sqrt(norm) : 0;
    if (v > bestVal) { bestVal = v; bestLag = lag; }
  }
  winners.push([bestLag, bestVal, (SR / bestLag).toFixed(1)]);
}
console.log('\nper-frame winners [lag, val, f0]:');
for (const w of winners.slice(0, 12)) console.log(' ', w);
