/**
 * Reliability comparison: gemini-3.8-live vs gemini-3.1-flash-live-preview.
 *
 * A single successful run proves nothing - the 3.1 model returned audio on
 * only 1/6 runs when no explicit voice was set. So run each N times with
 * the production config and compare the hit rate.
 */
import { ai } from '../gemini.js';

const N = 6;
const MODELS_TO_TEST = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];

async function runOnce(model) {
  let audioBytes = 0, audioParts = 0, transcript = '', setup = false, error = null;
  let session = null;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const t = setTimeout(finish, 25000);

    const s = ai.live.connect({
      model,
      config: {
        responseModalities: ['AUDIO'],
        systemInstruction: 'You are a public speaking coach. Reply in under 12 words.',
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        automaticActivityDetection: {
          disabled: false, startOfSpeechThreshold: 0.5, endOfSpeechThreshold: 0.9,
          prefixPaddingMs: 300, silenceDurationMs: 700,
        },
      },
      callbacks: {
        onmessage: (m) => {
          if (m?.setupComplete) setup = true;
          const sc = m?.serverContent;
          if (!sc) return;
          for (const p of sc.modelTurn?.parts || []) {
            if (p.inlineData?.data) { audioParts++; audioBytes += Buffer.from(p.inlineData.data, 'base64').length; }
          }
          if (sc.outputTranscription?.text) transcript += sc.outputTranscription.text;
          if (sc.turnComplete) { clearTimeout(t); setTimeout(finish, 200); }
        },
        onerror: (e) => { error = String(e?.error?.message || e?.message || '').slice(0, 100); clearTimeout(t); finish(); },
      },
    });

    s.then((sess) => {
      session = sess;
      sess.sendRealtimeInput({ text: 'Give me one tip for opening a talk.' });
    }).catch((e) => { error = String(e.message).slice(0, 100); clearTimeout(t); finish(); });
  });

  try { session?.close(); } catch { /* noop */ }
  await new Promise(r => setTimeout(r, 200));
  return { audioBytes, audioParts, transcript, setup, error };
}

const results = {};
for (const model of MODELS_TO_TEST) {
  console.log(`\n--- ${model} ---`);
  const runs = [];
  for (let i = 0; i < N; i++) {
    const r = await runOnce(model);
    runs.push(r);
    const good = r.audioBytes > 10000;
    console.log(`  run ${i + 1}: ${good ? 'AUDIO' : 'NO AUDIO'}  ${String(r.audioParts).padStart(3)} parts  ${String(r.audioBytes).padStart(7)} bytes  ${good ? '' : r.error || ''}`);
  }
  const withAudio = runs.filter(r => r.audioBytes > 10000).length;
  const avgBytes = Math.round(runs.reduce((a, r) => a + r.audioBytes, 0) / runs.length);
  results[model] = { withAudio, of: N, avgBytes };
  console.log(`  => ${withAudio}/${N} runs produced audio, avg ${avgBytes} bytes`);
}

console.log('\n' + '='.repeat(60));
for (const [m, r] of Object.entries(results)) {
  console.log(`  ${m.padEnd(32)} ${r.withAudio}/${r.of} audio  avg ${r.avgBytes} bytes`);
}
const best = Object.entries(results).sort((a, b) => b[1].withAudio - a[1].withAudio)[0];
console.log(`\nMOST RELIABLE: ${best[0]} (${best[1].withAudio}/${best[1].of})`);
