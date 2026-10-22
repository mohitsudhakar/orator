/**
 * Gemini service layer.
 *
 * Models (all verified live on this account):
 *   - TEXT / TUTOR   : gemini-3.8-flash
 *   - IMAGE          : gemini-3.1-flash-image  (Nano Banana 2)
 *                      gemini-3.1-flash-lite-image (cheaper variant)
 *   - LIVE COACH     : gemini-3.1-flash-live-preview  (AUDIO-only modality)
 *
 * The API key never reaches the browser: the browser talks to our Express/WS
 * server, and the server talks to Google.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

export const MODELS = {
  tutor: 'gemini-3.8-flash',
  image: 'gemini-3.1-flash-image',
  imageLite: 'gemini-3.1-flash-lite-image',
  live: process.env.ORATOR_LIVE_MODEL || 'gemini-3.8-live',
  transcribe: 'gemini-3.5-transcribe',
};

function readKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const envFile = path.join(process.env.HOME || '', '.hermes', '.env');
  if (fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, 'utf8')
      .split('\n')
      .find(l => l.startsWith('GEMINI_API_KEY='));
    if (line) return line.split('=').slice(1).join('=').trim();
  }
  throw new Error('No Gemini API key found (GEMINI_API_KEY / GOOGLE_API_KEY / ~/.hermes/.env)');
}

export const apiKey = readKey();
export const ai = new GoogleGenAI({ apiKey });

/* ------------------------------------------------------------------ */
/* Tutor: streaming text (SSE)                                         */
/* ------------------------------------------------------------------ */

export const TUTOR_SYSTEM = `You are the ORATOR tutor: an elite executive-communication coach.
You teach at the standard of a top-tier Harvard/Stanford MBA leadership program.

RULES:
- Be direct, specific, and ruthlessly practical. No filler, no cheerleading, no "great question!".
- Every claim must be actionable. If a learner asks "how do I sound confident", answer with the
  mechanics (posture, breath, jaw tension, vocal placement, what the room reads), never platitudes.
- Use the learner's own module context when given. Reference the framework names from the curriculum.
- Be honest when research is contested or when a claim is a rule of thumb rather than law. Say so.
- When the learner is presenting, evaluate specific moments: "At 0:42 your pace jumped to 190 wpm
  and the sentence before it landed. That transition is where the energy leaked."
- Push back when the learner is avoiding the hard part. Name the avoidance.
- Keep responses under 400 words unless the learner explicitly asks for depth.
- End every response with a single concrete next action the learner can do in the next 24 hours,
  introduced by "**Do this next:**".

FORMATTING (this matters - the answer is rendered as markdown):
- Put EVERY block on its own line. Never run a paragraph, a heading, a bullet and a sentence
  together on one line. Use a blank line between a paragraph and the next heading.
- Use "## " for the section headings. Use "- " for bullet points. Use "> " for a short quoted
  line you want to stand apart.
- Use "**bold**" for the key term in a sentence, not for whole sections.
- Example of the required shape:

Kill the throat-clearing. Their phones come out.

## The Opening Formula

**Tension (The Stake):** State the variance immediately.
- Plant both feet beneath your hips.
- Sweep the room silently for three seconds.

> They are not waiting for your agenda.

**Do this next:** Record the first 20 seconds.
`;

/**
 * Stream a tutor response.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.context] extra grounding context
 * @param {AbortSignal} [opts.signal]
 * @returns {AsyncGenerator<string>}
 */
export async function* streamTutor(prompt, { context = '', signal } = {}) {
  const parts = [];
  if (context) parts.push({ text: `CONTEXT:\n${context}\n\n---\n` });
  parts.push({ text: `LEARNER: ${prompt}` });

  const stream = await ai.models.generateContentStream({
    model: MODELS.tutor,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: TUTOR_SYSTEM,
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const t = chunk.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join('');
    if (t) yield t;
  }
}

/* ------------------------------------------------------------------ */
/* Image generation                                                    */
/* ------------------------------------------------------------------ */

const IMAGE_DIR = path.resolve(process.env.ORATOR_IMAGE_DIR || './assets/generated');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * Generate an instructional diagram for a concept.
 * @returns {Promise<{file:string, url:string, bytes:number, model:string}>}
 */
export async function generateConceptImage(prompt, { filename, model = MODELS.image } = {}) {
  const res = await ai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  const parts = res.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.data);
  if (!imgPart) {
    const text = parts.map(p => p.text).filter(Boolean).join(' ');
    throw new Error(`No image returned by ${model}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const bytes = Buffer.from(imgPart.inlineData.data, 'base64');
  const mime = imgPart.inlineData.mimeType || 'image/png';
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';

  const safe = (filename || 'concept').replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = path.join(IMAGE_DIR, `${safe}.${ext}`);
  fs.writeFileSync(file, bytes);
  // Return the real filename including its actual extension. The client must
  // not guess the extension - the model may return JPEG, PNG or WebP.
  return { file, url: `/assets/generated/${safe}.${ext}`, filename: `${safe}.${ext}`, bytes: bytes.length, model };
}

/** The full visual prompt for a concept, including house style. */
export function buildImagePrompt(concept, module) {
  return [
    `Create a clean, professional instructional diagram illustrating this concept:`,
    `Concept: ${concept.title}`,
    `Module context: ${module?.title || 'Executive communication'}.`,
    `Summary: ${concept.summary}`,
    '',
    'STYLE REQUIREMENTS:',
    '- Flat vector infographic, clean lines, muted professional palette (navy, warm grey, soft teal, amber accent)',
    '- Light background, generous white space, strong visual hierarchy',
    '- Labeled callouts and connectors showing relationships and flow',
    '- A single clear focal idea, not a collage',
    '- Keep ALL content inside a single centred composition with clear margins on',
    '  every side. Do not let any panel, box, or label run off the edge of the',
    '  canvas - a cropped element makes the diagram unreadable.',
    '- Prefer 2-4 clearly separated elements over a dense multi-panel layout.',
    '- Use a wide 16:9 landscape canvas and centre the composition within it.',
    '- NO watermarks, NO stock-photo look, NO photographic textures',
    '- If any text is included, keep it very short (2-4 words per label), large',
    '  enough to read at 800px wide, and use a clean sans-serif',
    '- High detail, high contrast, professional finish',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Grading helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Grade a scenario option the learner picked against the curriculum's own rubric.
 */
export async function gradeScenarioChoice({ module, scenario, optionText }) {
  const prompt = `The learner chose this response in a scenario:

SCENARIO: ${scenario.title}
SETTING: ${scenario.setting}
CHALLENGE: ${scenario.challenge}
LEARNER'S CHOSEN RESPONSE: "${optionText}"

Grade it. Be specific about what worked and what did not, and give one concrete alternative move.
Return JSON only, no markdown fences, with this shape:
{"verdict":"excellent|good|fair|poor","whatWorked":"...","whatFailed":"...","betterMove":"...","principle":"..."}`;
  const res = await ai.models.generateContent({
    model: MODELS.tutor,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.4 },
  });
  try {
    return JSON.parse(res.text);
  } catch {
    return { verdict: 'fair', whatWorked: '', whatFailed: '', betterMove: '', principle: '', raw: res.text };
  }
}

/**
 * Score a written reflection against the module assessment rubric.
 */
export async function gradeAssessment({ module, submission }) {
  const rubric = module.assessment.rubric.map(r =>
    `- ${r.dimension} (weight ${r.weight}%)\n  EXCELLENT: ${r.excellent}\n  ADEQUATE: ${r.adequate}\n  POOR: ${r.poor}`
  ).join('\n');

  const prompt = `Grade this submission against the rubric.

ASSESSMENT: ${module.assessment.title}
BRIEF: ${module.assessment.brief}

RUBRIC:
${rubric}

SUBMISSION:
${submission}

Return JSON only, no markdown fences:
{"scores":[{"dimension":"...","score":0-100,"comment":"..."}],"total":0-100,"passed":true|false,"summary":"...","nextStep":"..."}`;
  const res = await ai.models.generateContent({
    model: MODELS.tutor,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.3 },
  });
  try {
    return JSON.parse(res.text);
  } catch {
    return { error: 'Could not parse grading response', raw: res.text };
  }
}

/**
 * Turn a metrics snapshot into a written coaching debrief.
 */
export async function coachDebrief({ metrics, transcript, exercise, module }) {
  const prompt = `You are coaching a speaker on a recorded practice attempt.

EXERCISE: ${exercise?.title || 'practice run'}
INSTRUCTIONS: ${exercise?.instructions || 'n/a'}
MODULE: ${module?.title || 'n/a'}

MEASURED METRICS:
${JSON.stringify(metrics, null, 2)}

TRANSCRIPT:
${(transcript || '').slice(0, 6000)}

Write a debrief. Requirements:
- Lead with the single highest-leverage change. One, not five.
- Cite specific numbers from the metrics (wpm, filler rate, pause count, pitch range).
- Quote a specific line from the transcript if there is one worth quoting.
- Give a concrete drill they can run in the next 10 minutes.
- Be demanding. A coach who only praises teaches nothing.

Return JSON only, no markdown fences:
{"headline":"...","strength":"...","primaryFix":"...","secondaryFix":"...","quote":"...","drill":"...","scoreRationale":"..."}`;
  const res = await ai.models.generateContent({
    model: MODELS.tutor,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.5 },
  });
  try {
    return JSON.parse(res.text);
  } catch {
    return { error: 'Could not parse debrief', raw: res.text };
  }
}
