/**
 * Replay the exact SDK wire frames against a raw WebSocket and log EVERY
 * inbound frame, so we can see whether the server sends audio that the SDK
 * is silently dropping.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import { apiKey } from '../gemini.js';

const key = apiKey;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;

const frames = JSON.parse(fs.readFileSync('/tmp/wire_frames.json', 'utf8'));
const ws = new WebSocket(url, { headers: { 'Content-Type': 'application/json' } });
let audioCount = 0, textCount = 0;

ws.on('open', () => {
  console.log('raw open, replaying', frames.length, 'frames');
  frames.forEach((f, i) => setTimeout(() => {
    const s = typeof f === 'string' ? f : JSON.stringify(f);
    console.log(`  -> send frame ${i}: ${s.slice(0, 120)}`);
    ws.send(s);
  }, i * 1200));
});

ws.on('message', (raw) => {
  const t = raw.toString();
  let m; try { m = JSON.parse(t); } catch { console.log('  <- non-json len', t.length); return; }
  const sc = m.serverContent;
  if (sc?.modelTurn) {
    for (const p of (sc.modelTurn.parts || [])) {
      if (p.inlineData?.data) { audioCount++; console.log(`  <- AUDIO b64len=${p.inlineData.data.length} mime=${p.inlineData.mimeType}`); }
      else console.log('  <- modelTurn part (no inlineData):', JSON.stringify(p).slice(0, 250));
    }
  }
  if (sc?.outputTranscription?.text) { textCount++; console.log('  <- text:', JSON.stringify(sc.outputTranscription.text.slice(0, 100))); }
  if (m.setupComplete) console.log('  <- setupComplete');
  if (m.error) console.log('  <- ERROR', JSON.stringify(m.error).slice(0, 300));
});

ws.on('error', e => console.log('raw err', e.message));
ws.on('close', (c, r) => console.log('raw close', c, r?.toString?.().slice(0, 300)));

setTimeout(() => {
  console.log(`\n=== audio frames: ${audioCount}, text frames: ${textCount} ===`);
  ws.close(); process.exit(0);
}, 16000);
