import { ai, MODELS } from '../gemini.js';

const PROMPT = 'Welcome. Tell me the single sentence you most want to land in your next talk.';
const SYS = 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.';

async function trial(label, extra, prompt = PROMPT, sys = SYS) {
  let audioParts = 0, b64 = 0, text = '';
  const cfg = {
    responseModalities: ['AUDIO'],
    systemInstruction: sys,
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
    s.then(sess => sess.sendRealtimeInput({ text: prompt })).catch(() => { clearTimeout(t); resolve(); });
  });
  console.log(`${label.padEnd(40)} audio=${String(audioParts).padEnd(4)} b64=${String(b64).padEnd(8)} text=${JSON.stringify(text.slice(0, 42))}`);
  return audioParts;
}

console.log('--- determinism: same config x3 ---');
for (let i = 0; i < 3; i++) await trial(`repeat ${i}`, {});

console.log('\n--- vary system instruction only ---');
await trial('sys: plain', {}, PROMPT, 'You are a public speaking coach. Speak in under 20 words.');
await trial('sys: elite', {}, PROMPT, SYS);
await trial('sys: elite + plain speech', {}, PROMPT, 'You are ORATOR, a public-speaking coach. Speak in plain spoken sentences. Never use markdown, asterisks, bullets, or formatting of any kind. Speak in under 20 words.');

console.log('\n--- vary voice / speechConfig ---');
for (const v of ['Puck', 'Charon', 'Kore', 'Aoede']) {
  await trial(`voice ${v}`, { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } });
}

console.log('\n--- vary prompt (same sys) ---');
await trial('prompt: BEGINNING', {}, 'Say the word BEGINNING and nothing else.');
await trial('prompt: coach q', {}, 'What single sentence do you most want to land in your next talk?');
process.exit(0);
