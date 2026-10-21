import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
const key = fs.readFileSync(process.env.HOME + '/.hermes/.env', 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY=')).split('=').slice(1).join('=').trim();
const ai = new GoogleGenAI({ apiKey: key });

const withTimeout = (p, ms, label) => Promise.race([
  p.then(v => ({ ok: true, v })).catch(e => ({ ok: false, e: String(e.message).slice(0, 100) })),
  new Promise(r => setTimeout(() => r({ ok: false, e: 'TIMEOUT/HANG' }), ms)),
]);

for (const m of ['gemini-3.8-flash-live', 'gemini-3.8-flash-live-preview', 'gemini-3.1-flash-live', 'gemini-3.1-flash-lite-live-preview']) {
  const r = await withTimeout(
    ai.live.connect({ model: m, config: { responseModalities: ['AUDIO'] }, callbacks: { onerror: e => {} } }).then(s => { s.close(); return s; }),
    15000, m
  );
  console.log(m, '=>', r.ok ? 'CONNECTED' : r.e);
}

for (const m of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash']) {
  const r = await withTimeout(ai.models.generate_content({ model: m, contents: 'Reply with exactly: READY' }).then(r => r.text), 20000, m);
  console.log(m, 'text =>', r.ok ? r.v : r.e);
}
process.exit(0);
