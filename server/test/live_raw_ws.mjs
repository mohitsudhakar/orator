/**
 * Intercept the raw WebSocket traffic to the Gemini Live API to see exactly
 * what the server sends when audio goes missing.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import { apiKey } from '../gemini.js';

const key = apiKey;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;

const CFG = {
  responseModalities: ['AUDIO'],
  systemInstruction: 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words.',
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};

const setup = { setup: { model: 'models/gemini-3.1-flash-live-preview', config: CFG } };

const ws = new WebSocket(url, { headers: { 'Content-Type': 'application/json' } });
let counts = {};
let seq = 0;

ws.on('open', () => {
  console.log('raw WS open');
  ws.send(JSON.stringify(setup));
  setTimeout(() => {
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Welcome. Tell me the single sentence you most want to land in your next talk.' }] }],
        turnComplete: true,
      },
    }));
  }, 1200);
});

ws.on('message', (raw) => {
  const t = raw.toString();
  let m;
  try { m = JSON.parse(t); } catch { console.log('non-json frame len', t.length); return; }
  const sc = m.serverContent;
  const key2 = Object.keys(m).join('+');
  counts[key2] = (counts[key2] || 0) + 1;

  if (sc?.modelTurn) {
    const parts = sc.modelTurn.parts || [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        console.log(`  [${seq++}] AUDIO part mime=${p.inlineData.mimeType} b64len=${p.inlineData.data.length}`);
      } else {
        console.log(`  [${seq++}] NON-AUDIO part keys=${Object.keys(p).join(',')} ${JSON.stringify(p).slice(0, 200)}`);
      }
    }
  }
  if (sc?.outputTranscription?.text) console.log('  text:', JSON.stringify(sc.outputTranscription.text.slice(0, 90)));
  if (m.setupComplete) console.log('  setupComplete');
});

ws.on('error', e => console.log('raw err', e.message));
ws.on('close', (c, r) => console.log('raw close', c, r?.toString?.().slice(0, 200)));

setTimeout(() => {
  console.log('\nframe type counts:', JSON.stringify(counts, null, 2));
  ws.close();
  process.exit(0);
}, 16000);
