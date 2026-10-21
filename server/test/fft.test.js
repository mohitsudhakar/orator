import { fft, ifft } from '../fft.js';

let fails = 0;
const chk = (n, c, d = '') => { if (c) console.log(`  PASS ${n}`); else { fails++; console.log(`  FAIL ${n} ${d}`); } };

// 1. round trip: x -> fft -> ifft -> x
{
  const N = 256;
  const re = new Float64Array(N), im = new Float64Array(N);
  const orig = [];
  for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7); orig.push(re[i]); }
  const reCopy = Float64Array.from(re), imCopy = new Float64Array(N);
  fft(re, im);
  ifft(re, im);
  let maxErr = 0;
  for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - orig[i]));
  chk('fft/ifft round trip', maxErr < 1e-9, `maxErr=${maxErr}`);
}

// 2. autocorrelation of a pure sine must peak at its period
{
  const SR = 16000, F = 120, N = 2048;
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * F * i) / SR);
  const re = Float64Array.from(x), im = new Float64Array(N);
  fft(re, im);
  for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  ifft(re, im);
  const trueLag = SR / F;
  let best = 0, bestV = -Infinity;
  for (let lag = 20; lag < 300; lag++) if (re[lag] > bestV) { bestV = re[lag]; best = lag; }
  chk('autocorr peak at true period', Math.abs(best - trueLag) < 3, `best=${best} true=${trueLag.toFixed(1)}`);

  // normalized value at true lag should be high
  const norm = re[Math.round(trueLag)] / re[0];
  chk('normalized autocorr high at period', norm > 0.85, `norm=${norm.toFixed(3)}`);

  // half-period correlation is strongly negative for a pure sine
  const halfNorm = re[Math.round(trueLag / 2)] / re[0];
  chk('autocorr negative at half period', halfNorm < -0.5, `halfNorm=${halfNorm.toFixed(3)}`);
}

console.log(fails ? `\n${fails} FFT FAILURES` : '\nALL FFT TESTS PASSED');
process.exit(fails ? 1 : 0);
