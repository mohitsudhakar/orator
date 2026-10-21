import { ai, MODELS } from '../gemini.js';

const base = {
  responseModalities: ['AUDIO'],
  systemInstruction: 'You are a coach.',
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  automaticActivityDetection: { disabled: false, startOfSpeechThreshold: 0.5, endOfSpeechThreshold: 0.9, prefixPaddingMs: 300, silenceDurationMs: 700 },
};

const variants = {
  'full (as in live.js)': { ...base, contextWindowCompression: { triggerTokens: 16000, slidingWindowSize: 8000 } },
  'no contextWindowCompression': { ...base },
  'bare': { responseModalities: ['AUDIO'] },
  'with speechConfig': { ...base, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } },
};

for (const [label, config] of Object.entries(variants)) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = (verdict, extra = '') => {
      if (settled) return; settled = true;
      console.log(`${label}: ${verdict} ${extra}`);
      resolve();
    };
    let sess;
    const t = setTimeout(() => finish('TIMEOUT', '(no setupComplete)'), 15000);
    try {
      sess = ai.live.connect({
        model: MODELS.live,
        config,
        callbacks: {
          onopen: () => {},
          onmessage: (m) => {
            if (m.setupComplete) { clearTimeout(t); finish('CONNECTED'); }
          },
          onerror: (e) => { clearTimeout(t); finish('ERROR', String(e?.error?.message || e?.message || e).slice(0, 200)); },
          onclose: () => { clearTimeout(t); finish('CLOSED'); },
        },
      }).then(s => { sess = s; }).catch(e => { clearTimeout(t); finish('CONNECT-REJECT', String(e.message).slice(0, 200)); });
    } catch (e) {
      clearTimeout(t); finish('THROW', String(e.message).slice(0, 200));
    }
  });
}
process.exit(0);
