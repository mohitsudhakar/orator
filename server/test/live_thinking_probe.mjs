import { ai, MODELS } from '../gemini.js';

const PROMPT = 'Welcome. Tell me the single sentence you most want to land in your next talk.';
const SYS = 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.';

async function trial(label, extra) {
  let audioParts = 0, b64 = 0, text = '', usage = null;
  const cfg = {
    responseModalities: ['AUDIO'],
    systemInstruction: SYS,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...extra,
  };
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 15000);
    const s = ai.live.connect({
      model: MODELS.live, config: cfg,
      callbacks: {
        onmessage: (m) => {
          const sc = m.serverContent;
          if (m.usageMetadata) usage = m.usageMetadata;
          if (!sc) return;
          for (const p of (sc.modelTurn?.parts || [])) if (p.inlineData?.data) { audioParts++; b64 += p.inlineData.data.length; }
          if (sc.outputTranscription?.text) text += sc.outputTranscription.text;
          if (sc.turnComplete) { clearTimeout(t); resolve(); }
        },
        onerror: (e) => { console.log('   err:', String(e?.error?.message || e?.message).slice(0, 160)); clearTimeout(t); resolve(); },
      },
    });
    s.then(sess => sess.sendRealtimeInput({ text: PROMPT })).catch(e => { console.log('   connect err', String(e.message).slice(0,160)); clearTimeout(t); resolve(); });
  });
  console.log(`${label.padEnd(34)} audio=${String(audioParts).padEnd(4)} b64=${String(b64).padEnd(8)} inTok=${usage?.promptTokenCount} outTok=${usage?.totalTokenCount - (usage?.promptTokenCount||0)} text=${JSON.stringify(text.slice(0, 45))}`);
}

await trial('1 baseline', {});
await trial('2 thinkingBudget 0', { thinkingConfig: { thinkingBudget: 0 } });
await trial('3 includeThoughts false', { thinkingConfig: { includeThoughts: false } });
await trial('4 both', { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } });
process.exit(0);
