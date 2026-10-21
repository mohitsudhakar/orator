/**
 * Capture the EXACT wire payload the SDK sends, by monkey-patching the
 * WebSocket factory, then replay it against a raw socket to see the frames.
 */
import { ai, MODELS } from '../gemini.js';
import WebSocket from 'ws';
import fs from 'node:fs';

const captured = [];

const CFG = {
  responseModalities: ['AUDIO'],
  systemInstruction: 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.',
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};

// Patch the client's websocket factory to record outgoing frames.
const client = ai;
const origFactory = client.live.webSocketFactory;
client.live.webSocketFactory = {
  create(url, headers, callbacks) {
    const real = origFactory.create(url, headers, callbacks);
    const origSend = real.send.bind(real);
    real.send = (msg) => { captured.push(msg); return origSend(msg); };
    return real;
  },
};

const sess = await client.live.connect({
  model: MODELS.live,
  config: CFG,
  callbacks: {
    onmessage: (m) => {
      const parts = m.serverContent?.modelTurn?.parts || [];
      for (const p of parts) if (p.inlineData?.data) console.log('  SDK saw AUDIO b64len', p.inlineData.data.length);
    },
    onerror: e => console.log('  sdk err', String(e?.error?.message || e?.message).slice(0, 150)),
  },
});
console.log('connected');
sess.sendRealtimeInput({ text: 'Welcome. Tell me the single sentence you most want to land in your next talk.' });
await new Promise(r => setTimeout(r, 13000));

fs.writeFileSync('/tmp/wire_frames.json', JSON.stringify(captured, null, 2));
console.log('\ncaptured frames:', captured.length);
for (const f of captured) {
  const s = typeof f === 'string' ? f : JSON.stringify(f);
  console.log('  ', s.slice(0, 400));
}
sess.close();
process.exit(0);
