import { ai, MODELS } from '../gemini.js';

async function trial(label, extra) {
  let audioParts = 0, b64 = 0, text = '';
  const cfg = {
    responseModalities: ['AUDIO'],
    systemInstruction: 'You are a coach. Reply with one short sentence.',
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...extra,
  };
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 13000);
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
    s.then(sess => { sess.sendRealtimeInput({ text: 'Say the word BEGINNING and nothing else.' }); }).catch(() => {});
  });
  console.log(`${label.padEnd(42)} audioParts=${String(audioParts).padEnd(4)} b64=${String(b64).padEnd(8)} text=${JSON.stringify(text.slice(0, 50))}`);
}

await trial('A: no VAD', {});
await trial('B: VAD full', { automaticActivityDetection: { disabled: false, startOfSpeechThreshold: 0.5, endOfSpeechThreshold: 0.9, prefixPaddingMs: 300, silenceDurationMs: 700 } });
await trial('C: VAD minimal', { automaticActivityDetection: { disabled: false } });
await trial('D: VAD disabled:true', { automaticActivityDetection: { disabled: true } });
await trial('E: VAD no thresholds', { automaticActivityDetection: { startOfSpeechThreshold: 0.5, endOfSpeechThreshold: 0.9 } });
process.exit(0);
