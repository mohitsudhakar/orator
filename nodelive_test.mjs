import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const key = fs.readFileSync(process.env.HOME + '/.hermes/.env', 'utf8')
  .split('\n').find(l => l.startsWith('GEMINI_API_KEY=')).split('=').slice(1).join('=').trim();

const ai = new GoogleGenAI({ apiKey: key });
const MODEL = 'gemini-3.1-flash-live-preview';

let audioChunks = 0, outText = '', inText = '';

const session = await ai.live.connect({
  model: MODEL,
  config: {
    responseModalities: ['AUDIO'],
    systemInstruction: 'You are a public speaking coach. Reply in under 12 words.',
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    automaticActivityDetection: { disabled: false, startOfSpeechThreshold: 0.5, endOfSpeechThreshold: 0.8 },
  },
  callbacks: {
    onopen: () => console.log('SOCKET OPEN'),
    onmessage: (m) => {
      const sc = m.serverContent;
      if (sc?.modelTurn?.parts) {
        for (const p of sc.modelTurn.parts) {
          if (p.inlineData?.data) { audioChunks++; if (audioChunks === 1) console.log('FIRST AUDIO b64len', p.inlineData.data.length); }
        }
      }
      if (sc?.outputTranscription?.text) { outText += sc.outputTranscription.text; }
      if (sc?.inputTranscription?.text) { inText += sc.inputTranscription.text; }
      if (sc?.turnComplete) console.log('TURN COMPLETE');
    },
    onerror: (e) => console.log('ERROR', JSON.stringify(e.error || e).slice(0, 300)),
    onclose: () => console.log('CLOSED'),
  },
});
console.log('SESSION CONNECTED');

session.sendRealtimeInput({ text: 'Give me one tip for opening a talk.' });
await new Promise(r => setTimeout(r, 12000));
console.log('audioChunks:', audioChunks);
console.log('OUT-TEXT:', JSON.stringify(outText.slice(0, 200)));

console.log('--- barge-in test ---');
session.sendRealtimeInput({ text: 'Wait, actually say the single word ACKNOWLEDGED.' });
await new Promise(r => setTimeout(r, 8000));
console.log('OUT-TEXT2:', JSON.stringify(outText.slice(0, 400)));
session.close();
console.log('DONE');
process.exit(0);
