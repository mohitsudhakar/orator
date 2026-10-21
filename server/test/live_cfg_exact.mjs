import { ai, MODELS } from '../gemini.js';

const CFG = {
  responseModalities: ['AUDIO'],
  systemInstruction: 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.',
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  automaticActivityDetection: {
    disabled: false,
    startOfSpeechThreshold: 0.5,
    endOfSpeechThreshold: 0.9,
    prefixPaddingMs: 300,
    silenceDurationMs: 700,
  },
};

let audioParts = 0, audioBytes = 0, turns = 0, modelTurns = 0, partKeys = new Set();

const sess = await ai.live.connect({
  model: MODELS.live,
  config: CFG,
  callbacks: {
    onmessage: (m) => {
      if (m.setupComplete) console.log('>> setupComplete');
      const sc = m.serverContent;
      if (!sc) return;
      if (sc.modelTurn) {
        modelTurns++;
        const parts = sc.modelTurn.parts || [];
        console.log('>> modelTurn parts:', parts.length);
        for (const p of parts) {
          Object.keys(p).forEach(k => partKeys.add(k));
          if (p.inlineData?.data) { audioParts++; audioBytes += p.inlineData.data.length; }
        }
      }
      if (sc.outputTranscription?.text) console.log('>> outText:', JSON.stringify(sc.outputTranscription.text.slice(0, 80)));
      if (sc.turnComplete) { turns++; console.log('>> turnComplete'); }
    },
    onerror: e => console.log('>> ERROR', String(e?.error?.message || e?.message).slice(0, 200)),
    onclose: () => console.log('>> closed'),
  },
});
console.log('connected');
sess.sendRealtimeInput({ text: 'Welcome. Tell me the single sentence you most want to land in your next talk.' });
await new Promise(r => setTimeout(r, 14000));
console.log('\n=== SUMMARY ===');
console.log('modelTurns:', modelTurns, 'audioParts:', audioParts, 'b64 bytes:', audioBytes);
console.log('part keys seen:', [...partKeys].join(', '));
console.log('turns:', turns);
sess.close();
process.exit(0);
