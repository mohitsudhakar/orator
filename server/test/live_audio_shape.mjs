import { ai, MODELS } from '../gemini.js';

const sess = await ai.live.connect({
  model: MODELS.live,
  config: {
    responseModalities: ['AUDIO'],
    systemInstruction: 'You are a coach. Speak briefly.',
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  },
  callbacks: {
    onmessage: (m) => {
      const sc = m.serverContent;
      if (!sc) return;
      if (sc.modelTurn) {
        console.log('--- modelTurn raw ---');
        console.log(JSON.stringify(sc.modelTurn).slice(0, 400));
        const parts = sc.modelTurn.parts || [];
        console.log('parts count:', parts.length);
        for (const p of parts) {
          console.log('  part keys:', Object.keys(p));
          console.log('  inlineData?', !!p.inlineData, ' inline_data?', !!p.inline_data);
          if (p.inlineData) console.log('   data len:', p.inlineData.data?.length, 'mime:', p.inlineData.mimeType);
          if (p.inline_data) console.log('   data len:', p.inline_data.data?.length, 'mime:', p.inline_data.mime_type);
        }
      }
    },
    onerror: e => console.log('err', String(e?.error?.message || e?.message).slice(0, 150)),
  },
});
sess.sendRealtimeInput({ text: 'Say the word BEGINNING and nothing else.' });
await new Promise(r => setTimeout(r, 12000));
sess.close();
process.exit(0);
