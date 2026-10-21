import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const key = fs.readFileSync(process.env.HOME + '/.hermes/.env', 'utf8')
  .split('\n').find(l => l.startsWith('GEMINI_API_KEY=')).split('=').slice(1).join('=').trim();
const ai = new GoogleGenAI({ apiKey: key });

async function trial(label, model, config) {
  let audioBytes = 0, text = '';
  try {
    const s = await ai.live.connect({
      model, config,
      callbacks: {
        onmessage: (m) => {
          const sc = m.serverContent;
          if (sc?.modelTurn?.parts) for (const p of sc.modelTurn.parts) {
            if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
          }
          if (sc?.outputTranscription?.text) text += sc.outputTranscription.text;
        },
        onerror: (e) => console.log('  err:', JSON.stringify(e.error || e).slice(0, 200)),
      },
    });
    s.sendRealtimeInput({ text: 'Say the word BEGINNING and nothing else.' });
    await new Promise(r => setTimeout(r, 9000));
    s.close();
    console.log(`${label} | audio=${audioBytes}B | text=${JSON.stringify(text.slice(0,80))}`);
  } catch (e) {
    console.log(`${label} | CONNECT FAIL ${String(e.message).slice(0, 150)}`);
  }
}

const M = 'gemini-3.1-flash-live-preview';
await trial('A: audio+transcripts', M, { responseModalities: ['AUDIO'], inputAudioTranscription: {}, outputAudioTranscription: {}, systemInstruction: 'Reply with one word.' });
await trial('B: audio only', M, { responseModalities: ['AUDIO'], systemInstruction: 'Reply with one word.' });
await trial('C: audio+voice', M, { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, systemInstruction: 'Reply with one word.' });
await trial('D: audio+voice+outTrans', M, { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, outputAudioTranscription: {}, systemInstruction: 'Reply with one word.' });
await trial('E: lite model', 'gemini-3.1-flash-lite-live-preview', { responseModalities: ['AUDIO'], systemInstruction: 'Reply with one word.' });
process.exit(0);
