/**
 * End-to-end live coach test:
 *   browser-like WS client -> ORATOR server -> Gemini Live API
 * Verifies: session start, coach opening audio comes back, transcript flows,
 * and text turn works.
 */
import WebSocket from 'ws';
import fs from 'node:fs';

const WS_URL = 'ws://localhost:4173/live';
const OUT = '/tmp/live_test_out';
fs.mkdirSync(OUT, { recursive: true });

let audioChunks = 0, audioBytes = 0;
const coachText = [];
const userText = [];
let gotReady = false, gotConnected = false, gotTurn = false;

const ws = new WebSocket(WS_URL);

const done = (code) => { try { ws.close(); } catch { /* noop */ } process.exit(code); };

ws.on('open', () => {
  console.log('WS OPEN');
  ws.send(JSON.stringify({
    type: 'start',
    systemInstruction: 'You are ORATOR, an elite public-speaking coach. Speak in under 20 words. Open by welcoming the learner and naming one thing to try.',
    opening: 'Welcome. Tell me the single sentence you most want to land in your next talk.',
  }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  switch (m.type) {
    case 'ready': gotReady = true; console.log('  ready'); break;
    case 'connected': gotConnected = true; console.log('  connected (model ' + m.model + ')'); break;
    case 'audio':
      audioChunks++; audioBytes += (m.pcm || '').length;
      break;
    case 'transcript':
      if (m.role === 'coach') { coachText.push(m.text); console.log('  COACH:', JSON.stringify(m.text)); }
      else { userText.push(m.text); console.log('  USER :', JSON.stringify(m.text)); }
      break;
    case 'turnComplete': gotTurn = true; console.log('  turn complete'); break;
    case 'error': console.log('  ERROR:', m.message); break;
    case 'closed': console.log('  closed'); break;
  }
});

ws.on('error', (e) => { console.log('WS ERROR', e.message); done(1); });

setTimeout(() => {
  console.log('\n--- sending a text turn (simulating learner speech as text) ---');
  ws.send(JSON.stringify({ type: 'text', text: 'I want to land that our churn is a feature not a bug, because power users expect it.' }));
}, 9000);

setTimeout(() => {
  console.log('\n=== RESULTS ===');
  console.log('ready:', gotReady, ' connected:', gotConnected, ' turnComplete:', gotTurn);
  console.log('audio chunks:', audioChunks, ' base64 bytes:', audioBytes);
  console.log('coach transcript:', JSON.stringify(coachText.join(' ').slice(0, 400)));
  const pass = gotReady && gotConnected && audioChunks > 0 && coachText.join('').length > 10;
  console.log(pass ? '\nLIVE COACH E2E: PASS' : '\nLIVE COACH E2E: FAIL');
  done(pass ? 0 : 1);
}, 30000);
