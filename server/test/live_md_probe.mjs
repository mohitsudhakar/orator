import { ai, MODELS } from '../gemini.js';

async function trial(label, sys, prompt) {
  let audioParts = 0, b64 = 0, text = '';
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 14000);
    const s = ai.live.connect({
      model: MODELS.live,
      config: { responseModalities: ['AUDIO'], systemInstruction: sys, inputAudioTranscription: {}, outputAudioTranscription: {} },
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
    s.then(sess => sess.sendRealtimeInput({ text: prompt })).catch(() => {});
  });
  const hasMd = /[*_`#]/.test(text);
  console.log(`${label.padEnd(34)} audio=${String(audioParts).padEnd(4)} md=${hasMd ? 'YES' : 'no '} text=${JSON.stringify(text.slice(0, 55))}`);
}

const PROMPT = 'Welcome. Tell me the single sentence you most want to land in your next talk.';
const BASE = 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.';

await trial('base', BASE, PROMPT);
await trial('base + no markdown', BASE + ' Never use markdown, asterisks, or bullet points. Speak in plain sentences only.', PROMPT);
await trial('base + plain speech', 'You are ORATOR, a public-speaking coach. Speak in plain spoken sentences. Never use markdown, asterisks, bullets, or formatting of any kind. Speak in under 20 words.', PROMPT);
process.exit(0);
