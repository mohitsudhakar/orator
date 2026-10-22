/**
 * Verify gemini-3.8-live actually WORKS - not just that the socket opens.
 *
 * The probe showed it connects. A socket opening is not proof: the same
 * setup can return a transcript with zero audio bytes. So this test does
 * what matters:
 *   1. setupComplete arrives
 *   2. the model PRODUCES AUDIO BYTES (the real test)
 *   3. it returns a transcript
 *   4. the audio is non-trivial in size
 *   5. it works with the explicit voice that we know is required
 */
import { ai, MODELS } from '../gemini.js';

const CANDIDATES = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];

async function fullTest(model) {
  const result = {
    model,
    setupComplete: false,
    audioParts: 0,
    audioBytes: 0,
    transcript: '',
    turnComplete: false,
    error: null,
  };

  let session = null;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    const t = setTimeout(finish, 30000);

    const s = ai.live.connect({
      model,
      config: {
        responseModalities: ['AUDIO'],
        systemInstruction: 'You are a public speaking coach. Reply in under 15 words.',
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // The explicit voice is REQUIRED - without it, audio came back on
        // only 1/6 runs for the 3.1 model.
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        automaticActivityDetection: { disabled: false },
      },
      callbacks: {
        onmessage: (m) => {
          if (m?.setupComplete) result.setupComplete = true;
          const sc = m?.serverContent;
          if (!sc) return;
          for (const p of sc.modelTurn?.parts || []) {
            if (p.inlineData?.data) {
              result.audioParts++;
              result.audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
            }
          }
          if (sc.outputTranscription?.text) result.transcript += sc.outputTranscription.text;
          if (sc.turnComplete) { result.turnComplete = true; clearTimeout(t); setTimeout(finish, 300); }
        },
        onerror: (e) => { result.error = String(e?.error?.message || e?.message || '').slice(0, 150); clearTimeout(t); finish(); },
      },
    });

    s.then((sess) => {
      session = sess;
      sess.sendRealtimeInput({ text: 'Give me one tip for opening a talk.' });
    }).catch((e) => { result.error = String(e.message).slice(0, 150); clearTimeout(t); finish(); });
  });

  // Close the socket, otherwise the event loop stays alive and the process
  // never exits.
  try { session?.close(); } catch { /* noop */ }
  await new Promise(r => setTimeout(r, 300));

  return result;
}

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log('\n=== full audio verification ===\n');
for (const model of CANDIDATES) {
  const r = await fullTest(model);
  console.log(`--- ${model} ---`);
  console.log(`  setupComplete: ${r.setupComplete}`);
  console.log(`  audio parts:   ${r.audioParts}  (${r.audioBytes} bytes)`);
  console.log(`  transcript:    ${JSON.stringify(r.transcript.slice(0, 120))}`);
  console.log(`  turnComplete:  ${r.turnComplete}`);
  if (r.error) console.log(`  error:         ${r.error}`);
  console.log('');

  ok(`${model} completes setup`, r.setupComplete);
  ok(`${model} PRODUCES AUDIO`, r.audioParts > 0, `parts=${r.audioParts}`);
  ok(`${model} audio is substantial`, r.audioBytes > 10000, `${r.audioBytes} bytes`);
  ok(`${model} returns a transcript`, r.transcript.trim().length > 5, JSON.stringify(r.transcript.slice(0, 60)));
  ok(`${model} completes the turn`, r.turnComplete);
}

console.log('\n' + '='.repeat(60));
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('gemini-3.8-live WORKS and produces audio');
