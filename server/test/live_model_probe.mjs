/**
 * Exhaustively probe for any gemini-3.8 / 3.7 LIVE model variant.
 * The models.list endpoint does NOT surface -live models, so the only way to
 * know is to try connecting. Each attempt is wrapped in a timeout because an
 * invalid model name HANGS rather than rejecting.
 */
import { ai, MODELS } from '../gemini.js';

const CANDIDATES = [
  'gemini-3.8-flash-live',
  'gemini-3.8-flash-live-preview',
  'gemini-3.8-flash-preview-live',
  'gemini-3.8-flash-native-audio',
  'gemini-3.8-flash-native-audio-preview',
  'gemini-3.7-flash-live',
  'gemini-3.7-flash-live-preview',
  'gemini-3.5-flash-live',
  'gemini-3.5-flash-live-preview',
  'gemini-3.1-flash-live-preview',   // known good
  'gemini-3.1-flash-lite-live-preview',
  'gemini-live-2.5-flash-preview',
  'gemini-2.5-flash-native-audio-preview',
  'gemini-2.0-flash-live-001',
  'gemini-omni-flash-preview',
];

const withTimeout = (p, ms) => Promise.race([
  p.then(v => ({ ok: true, v })).catch(e => ({ ok: false, e: String(e.message).slice(0, 130) })),
  new Promise(r => setTimeout(() => r({ ok: false, e: 'TIMEOUT/HANG' }), ms)),
]);

// A model is live-capable if the socket OPENS and the server sends
// setupComplete. onmessage MUST be provided, otherwise the SDK throws
// "callbacks.onmessage is not a function" as soon as the first frame lands -
// which is itself proof the model connected.
const results = [];
for (const m of CANDIDATES) {
  let connected = false;
  const p = ai.live.connect({
    model: m,
    config: { responseModalities: ['AUDIO'] },
    callbacks: {
      onmessage: (msg) => { if (msg?.setupComplete) connected = true; },
      onerror: () => {},
    },
  }).then(s => { s.close(); return s; });

  const r = await withTimeout(p, 12000);
  let verdict;
  if (r.ok) verdict = 'CONNECTED';
  else if (r.e.includes('onmessage is not a function')) verdict = 'CONNECTED';
  else verdict = r.e;
  results.push({ model: m, verdict });
  console.log(`${m.padEnd(42)} ${verdict}`);
}

const live = results.filter(r => r.verdict === 'CONNECTED').map(r => r.model);
console.log('\nLIVE-CAPABLE MODELS:', live.length ? live.join(', ') : 'none');
process.exit(0);
