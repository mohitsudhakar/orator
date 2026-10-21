const SR = 16000;
function synth({ durSec = 2, f0 = 120, amp = 0.3, vib = 6, vibHz = 4 }) {
  const n = SR * durSec;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + vib * Math.sin(2 * Math.PI * vibHz * t);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f * h * t);
    pcm[i] = Math.round((s * amp * 0.35) * 32767);
  }
  return pcm;
}
const pcm = synth({ f0: 120 });
const frameLen = 2048, off = 0;
const minLag = Math.floor(SR / 400), maxLag = Math.floor(SR / 70);
console.log('minLag', minLag, 'maxLag', maxLag, 'true lag', (SR / 120).toFixed(1));
const scores = [];
for (let lag = minLag; lag <= maxLag; lag++) {
  let corr = 0, norm = 0;
  for (let i = 0; i + lag < frameLen; i++) {
    const a = pcm[off + i] / 32768, b = pcm[off + i + lag] / 32768;
    corr += a * b; norm += a * a + b * b;
  }
  scores.push({ lag, v: norm > 0 ? corr / Math.sqrt(norm) : 0 });
}
scores.sort((a, b) => b.v - a.v);
console.log('TOP 8 by score:');
for (const s of scores.slice(0, 8)) console.log(`  lag=${s.lag} f0=${(SR / s.lag).toFixed(1)}Hz v=${s.v.toFixed(4)}`);

console.log('\ncorrelation at key lags:');
for (const L of [40, 73, 133, 160, 200, 228]) {
  const s = scores.find(x => x.lag === L);
  if (s) console.log(`  lag=${L} f0=${(SR / L).toFixed(1)}Hz v=${s.v.toFixed(4)}`);
}
