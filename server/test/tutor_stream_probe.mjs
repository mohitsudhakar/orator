import { ai, MODELS, streamTutor } from '../gemini.js';

console.log('--- direct generateContentStream with parts array ---');
try {
  const s = await ai.models.generateContentStream({
    model: MODELS.tutor,
    contents: [{ role: 'user', parts: [{ text: 'Say READY' }] }],
    config: { systemInstruction: 'Be brief.', temperature: 0.7, maxOutputTokens: 4096 },
  });
  let n = 0, text = '';
  for await (const chunk of s) {
    n++;
    const t = chunk.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join('');
    if (t) text += t;
  }
  console.log(`chunks=${n} text=${JSON.stringify(text.slice(0, 120))}`);
} catch (e) {
  console.log('ERROR:', e.message?.slice(0, 400));
}

console.log('\n--- direct with string contents ---');
try {
  const s = await ai.models.generateContentStream({
    model: MODELS.tutor,
    contents: 'Say READY',
    config: { systemInstruction: 'Be brief.', temperature: 0.7 },
  });
  let n = 0, text = '';
  for await (const chunk of s) {
    n++;
    const t = chunk.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join('');
    if (t) text += t;
  }
  console.log(`chunks=${n} text=${JSON.stringify(text.slice(0, 120))}`);
} catch (e) {
  console.log('ERROR:', e.message?.slice(0, 400));
}

console.log('\n--- via streamTutor() helper ---');
try {
  let out = '';
  for await (const c of streamTutor('Say READY', { context: 'CONTEXT:\ntest\n---\n' })) out += c;
  console.log(`len=${out.length} text=${JSON.stringify(out.slice(0, 120))}`);
} catch (e) {
  console.log('ERROR:', e.message?.slice(0, 400));
}
process.exit(0);
