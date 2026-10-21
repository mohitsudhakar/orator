import { ai, MODELS } from '../gemini.js';

async function trial(label, sys, prompt) {
  let audioParts = 0, b64 = 0, text = '', turns = 0;
  const cfg = {
    responseModalities: ['AUDIO'],
    systemInstruction: sys,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
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
          if (sc.turnComplete) turns++;
        },
        onerror: () => { clearTimeout(t); resolve(); },
      },
    });
    s.then(sess => sess.sendRealtimeInput({ text: prompt })).catch(() => {});
  });
  console.log(`${label.padEnd(30)} audioParts=${String(audioParts).padEnd(4)} b64=${String(b64).padEnd(8)} turns=${turns} text=${JSON.stringify(text.slice(0, 60))}`);
}

const SHORT = 'You are a coach. Reply with one short sentence.';
const LONGSYS = 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.';

await trial('short sys + short prompt', SHORT, 'Say the word BEGINNING and nothing else.');
await trial('short sys + long prompt', SHORT, 'Welcome. Tell me the single sentence you most want to land in your next talk.');
await trial('long sys + long prompt', LONGSYS, 'Welcome. Tell me the single sentence you most want to land in your next talk.');
await trial('long sys + short prompt', LONGSYS, 'Say the word BEGINNING and nothing else.');
process.exit(0);
