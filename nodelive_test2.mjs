import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const key = fs.readFileSync(process.env.HOME + '/.hermes/.env', 'utf8')
  .split('\n').find(l => l.startsWith('GEMINI_API_KEY=')).split('=').slice(1).join('=').trim();

const ai = new GoogleGenAI({ apiKey: key });
const MODEL = 'gemini-3.1-flash-live-preview';

const session = await ai.live.connect({
  model: MODEL,
  config: {
    responseModalities: ['AUDIO'],
    systemInstruction: 'You are a public speaking coach. Reply in under 12 words.',
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  },
  callbacks: {
    onmessage: (m) => {
      const s = JSON.stringify(m);
      console.log('MSG:', s.slice(0, 600));
    },
    onerror: (e) => console.log('ERROR', JSON.stringify(e.error || e).slice(0, 400)),
  },
});
session.sendRealtimeInput({ text: 'Give me one tip for opening a talk.' });
await new Promise(r => setTimeout(r, 10000));
session.close();
process.exit(0);
