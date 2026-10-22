/**
 * Exhaustive probe for a "gemini-3.8-live" model.
 *
 * Earlier probes covered gemini-3.8-flash-live, -live-preview,
 * -preview-live and -native-audio variants, but NOT the bare family name
 * "gemini-3.8-live". That form is plausible because "gemini-3.8-flash"
 * itself carries no infix.
 *
 * Method:
 *  - A KNOWN-GOOD model is included as a control. If the control does not
 *    connect, the probe harness is broken and every result is void.
 *  - Each attempt is bounded: a non-existent live model HANGS rather than
 *    rejecting, so an unbounded probe would hang forever.
 */
import { ai, MODELS } from '../gemini.js';

const CANDIDATES = [
  // --- the bare family names, in several spellings ---
  'gemini-3.8-live',
  'gemini-3.8-live-preview',
  'gemini-3.7-live',
  'gemini-3.7-live-preview',
  'gemini-3.6-live',
  'gemini-3.5-live',
  'gemini-3.4-live',
  'gemini-3-live',
  'gemini-4-live',

  // --- flash + live in every plausible order ---
  'gemini-3.8-flash-live',
  'gemini-3.8-flash-live-preview',
  'gemini-3.8-flash-preview-live',
  'gemini-3.8-flash-live-001',
  'gemini-3.8-flash-latest',
  'gemini-3.8-pro-live',
  'gemini-3.8-pro-preview',

  // --- native audio family ---
  'gemini-3.8-flash-native-audio',
  'gemini-3.8-flash-native-audio-preview',
  'gemini-3.8-native-audio',
  'gemini-3.8-native-audio-preview',

  // --- other spellings seen across the family ---
  'gemini-3.8-flash-audio',
  'gemini-3.8-audio',
  'gemini-3.8-realtime',
  'gemini-3.8-flash-realtime',
  'gemini-3.8-omni',
  'gemini-3.8-omni-preview',
  'gemini-3.8-flash-omni',

  // --- known good: the CONTROL ---
  'gemini-3.1-flash-live-preview',
];

const TIMEOUT_MS = 14000;

async function probe(model) {
  let connected = false;
  let sawError = null;
  const p = ai.live.connect({
    model,
    config: { responseModalities: ['AUDIO'] },
    callbacks: {
      onmessage: (m) => { if (m?.setupComplete) connected = true; },
      onerror: (e) => { sawError = String(e?.error?.message || e?.message || '').slice(0, 90); },
    },
  }).then(s => { try { s.close(); } catch { /* noop */ } return s; });

  const r = await Promise.race([
    p.then(() => ({ done: true })).catch(e => ({ done: true, err: String(e.message).slice(0, 90) })),
    new Promise(res => setTimeout(() => res({ done: false }), TIMEOUT_MS)),
  ]);

  if (r.done) {
    if (connected) return 'CONNECTED';
    if (r.err) return `REJECTED: ${r.err}`;
    if (sawError) return `ERROR: ${sawError}`;
    return 'CONNECTED (no setup yet)';
  }
  return 'TIMEOUT (hangs - does not exist)';
}

console.log(`\n=== probing ${CANDIDATES.length} model names (${TIMEOUT_MS / 1000}s each) ===\n`);

const results = [];
for (const m of CANDIDATES) {
  const verdict = await probe(m);
  results.push({ model: m, verdict });
  const mark = verdict.startsWith('CONNECTED') ? ' <== WORKS' : '';
  console.log(`  ${m.padEnd(40)} ${verdict}${mark}`);
}

const control = results.find(r => r.model === 'gemini-3.1-flash-live-preview');
const working = results.filter(r => r.verdict.startsWith('CONNECTED'));

console.log('\n' + '='.repeat(70));
console.log(`CONTROL (gemini-3.1-flash-live-preview): ${control?.verdict}`);
if (!control || !control.verdict.startsWith('CONNECTED')) {
  console.log('\n!! CONTROL FAILED - the probe harness is broken, results are void.');
  process.exit(1);
}
console.log('CONTROL OK - the probe harness works, so TIMEOUT means "does not exist".');
console.log(`\nMODELS THAT CONNECT (${working.length}):`);
working.forEach(w => console.log(`  ${w.model}`));
