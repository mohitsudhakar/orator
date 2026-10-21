import { fft, ifft } from '../fft.js';
const SR = 16000, F = 120, N = 2048;
const x = new Float64Array(N);
for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * F * i) / SR);
const re = Float64Array.from(x), im = new Float64Array(N);
fft(re, im);
for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
ifft(re, im);
console.log('r[0] =', re[0].toFixed(4));
for (const lag of [130, 131, 132, 133, 134, 135, 266, 267, 268]) {
  console.log(`lag=${lag} f0=${(SR / lag).toFixed(1)}Hz r=${re[lag].toFixed(4)} norm=${(re[lag] / re[0]).toFixed(4)}`);
}
let best = 0, bestV = -Infinity;
for (let lag = 20; lag < 300; lag++) if (re[lag] > bestV) { bestV = re[lag]; best = lag; }
console.log('peak lag', best, 'norm', (bestV / re[0]).toFixed(4));

// Now WITHOUT window (pure rectangular) to compare
const re2 = Float64Array.from(x), im2 = new Float64Array(N);
fft(re2, im2);
for (let i = 0; i < N; i++) { re2[i] = re2[i] * re2[i] + im2[i] * im2[i]; im2[i] = 0; }
ifft(re2, im2);
console.log('\nno-window: r[0]=', re2[0].toFixed(4), 'norm@133 =', (re2[133] / re2[0]).toFixed(4), 'norm@66 =', (re2[66] / re2[0]).toFixed(4));
