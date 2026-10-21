import { ai, MODELS } from '../gemini.js';

const PROMPT = 'Welcome. Tell me the single sentence you most want to land in your next talk.';
const SYS = 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.';

async function trial(label, extra) {
  let audioParts = 0, b64 = 0, text = '';
  const cfg = {
    responseModalities: ['AUDIO'],
    systemInstruction: SYS,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...extra,
  };
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 14000);
    const s = ai.live.connect({
      model: MODELS.live, config: cfg,
      callbacks: {
        onmessage: (m) => {
          const sc = m.serverContent;
          if (!sc) return;
          for (const p of (sc.modelTurn?.parts || [])) if (p.inlineData?.data) { audioParts++; b64 += p.inlineData.data.length; }
          if (sc.outputTranscription?.text) text += sc.outputTranscription.text;
          if (sc.turnComplete) { clearTimeout(t); resolve(); }
        },
        onerror: () => { clearTimeout(t); resolve(); },
      },
    });
    s.then(sess => sess.sendRealtimeInput({ text: PROMPT })).catch(() => { clearTimeout(t); resolve(); });
  });
  console.log(`${label.padEnd(36)} audio=${String(audioParts).padEnd(4)} b64=${String(b64).padEnd(8)} ${audioParts > 0 ? 'OK' : '*** NO AUDIO ***'}`);
  return audioParts;
}

console.log('--- voice Puck x6 (reliability) ---');
let ok = 0;
for (let i = 0; i < 6; i++) {
  const r = await trial(`Puck run ${i}`, { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } });
  if (r > 0) ok++;
}
console.log(`\nPuck reliability: ${ok}/6 produced audio`);

console.log('\n--- no voice x6 (baseline reliability) ---');
let ok2 = 0;
for (let i = 0; i < 6; i++) {
  const r = await trial(`no-voice run ${i}`, {});
  if (r > 0) ok2++;
}
console.log(`\nno-voice reliability: ${ok2}/6 produced audio`);
process.exit(0);
