/**
 * Dump EVERY inbound raw frame verbatim from the Live API for the failing
 * configuration, so nothing is hidden by field selection.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import { apiKey } from '../gemini.js';

const key = apiKey;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;

const frames = JSON.parse(fs.readFileSync('/tmp/wire_frames.json', 'utf8'));
const ws = new WebSocket(url, { headers: { 'Content-Type': 'application/json' } });
let n = 0;

ws.on('open', () => {
  frames.forEach((f, i) => setTimeout(() => ws.send(typeof f === 'string' ? f : JSON.stringify(f)), i * 1200));
});

ws.on('message', (raw) => {
  n++;
  const t = raw.toString();
  console.log(`\n--- FRAME ${n} (len ${t.length}) ---`);
  console.log(t.slice(0, 900));
});

ws.on('error', e => console.log('err', e.message));
ws.on('close', (c, r) => console.log('close', c, r?.toString?.().slice(0, 300)));

setTimeout(() => { console.log(`\nTOTAL FRAMES: ${n}`); ws.close(); process.exit(0); }, 16000);
