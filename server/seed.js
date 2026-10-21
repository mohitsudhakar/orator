/**
 * Seed the database with synthetic practice sessions so the trends view and
 * dashboard can be exercised without recording audio.
 *
 * Usage: node server/seed.js [count]
 */
import { saveSession, getProgress, updateProgress } from './db.js';
import { listModuleIds, loadModuleSafe } from './curriculum.js';
import { analyzeSpeech, coachNotes } from './metrics.js';

const SR = 16000;
const COUNT = parseInt(process.argv[2] || '6', 10);

function synthVoice({ durSec, f0, amp, wobble }) {
  const n = Math.floor(SR * durSec);
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + wobble * Math.sin(2 * Math.PI * 1.7 * t);
    phase += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= 5; h++) s += (1 / h) * Math.sin(h * phase);
    pcm[i] = Math.round(s * amp * 0.35 * 32767);
  }
  return pcm;
}

const LINES = [
  "So um, I basically think that, you know, we should ship the thing because it works and honestly the numbers are, uh, good.",
  "We rebuilt the pipeline last quarter. Latency fell by forty percent. Customers noticed within a fortnight, and renewal rates followed.",
  "Let me tell you about the incident. At two in the morning the primary region failed. We had no failover. That cost us four hours and, honestly, three customers.",
  "Um, so the, uh, the thing is basically that we should, like, leverage the data to, you know, drive, uh, better decisions going forward.",
  "Three numbers matter. ARR is up to forty-two million. Net revenue retention is one hundred and nineteen percent. Burn is under nine months. Everything else is detail.",
  "I want to start with the customer who almost left. She had been with us for three years, and then one quarter we changed the billing page and she was gone within a week.",
  "So essentially, you know, the, the basic point is that we, uh, really need to think about, um, how we, like, approach this overall.",
  "The question before us is simple. Do we scale the current model, or do we rebuild it? I am going to argue for the rebuild, and I will show you why.",
];

const MODULES = listModuleIds();

let created = 0;
for (let i = 0; i < COUNT; i++) {
  const mod = MODULES[i % MODULES.length];
  const line = LINES[i % LINES.length];
  const words = line.split(/\s+/).filter(Boolean);

  // Simulate improvement: later takes are faster, cleaner, better modulated.
  const t = i / Math.max(1, COUNT - 1);
  const wpm = Math.round(185 - 45 * t);
  const durSec = words.length / (wpm / 60);
  const pcm = synthVoice({
    durSec,
    f0: Math.round(118 + 14 * t),
    amp: 0.22 + 0.12 * t,
    wobble: 7 - 3 * t,
  });

  const wordList = words.map((w, k) => ({
    word: w,
    start: (k / wpm) * 60,
    end: (k / wpm) * 60 + 60 / wpm * 0.7,
  }));

  const metrics = analyzeSpeech({ transcript: line, words: wordList, pcm, sampleRate: SR, durationSec: durSec });
  const notes = coachNotes(metrics);

  saveSession({
    moduleId: mod,
    exerciseId: null,
    kind: 'seeded',
    transcript: line,
    words: wordList,
    durationSec: metrics.durationSec,
    wpm: metrics.wpm,
    overall: metrics.scores.overall,
    scores: metrics.scores,
    metrics: {
      wpm: metrics.wpm, fillers: metrics.fillers, pauses: metrics.pauses,
      volume: metrics.volume ? { ...metrics.volume, envelope: undefined } : null,
      pitch: metrics.pitch, articulation: metrics.articulation, language: metrics.language,
    },
    coach: notes,
  });
  created++;

  // Also mark a little progress so the dashboard has something to show.
  if (i % 2 === 0) {
    const p = getProgress(mod);
    updateProgress(mod, {
      concepts: p.concepts,
      exercises: i % 4 === 0 ? p.exercises : [...p.exercises],
      scenarios: p.scenarios,
    });
  }
}

console.log(`seeded ${created} sessions across ${MODULES.length} modules`);
