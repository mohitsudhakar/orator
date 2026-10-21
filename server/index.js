/**
 * ORATOR server
 *
 *  - REST: curriculum, progress, sessions, grading, image generation
 *  - SSE : streaming tutor
 *  - WS  : live voice coach (relayed to Gemini Live API)
 */
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogue, loadModule, listModuleIds, validateAll } from './curriculum.js';
import {
  getProgress, updateProgress, allProgress, saveSession, listSessions, sessionDetail,
  saveAttempt, listAttempts, saveScenarioResponse, listScenarioResponses,
  saveAssessment, listAssessments, activityRange, streakInfo, overallStats, dimensionTrends,
} from './db.js';
import { analyzeSpeech, coachNotes } from './metrics.js';
import {
  streamTutor, generateConceptImage, buildImagePrompt, gradeScenarioChoice,
  gradeAssessment, coachDebrief, MODELS,
} from './gemini.js';
import { attachLiveCoach, buildCoachInstruction, VOICES, DEFAULT_VOICE } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 4173;

const app = express();
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/assets/generated', express.static(path.join(ROOT, 'assets', 'generated')));
app.use('/content', express.static(path.join(ROOT, 'content')));

/* ------------------------------------------------------------------ */
/* Health + meta                                                       */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  const v = validateAll();
  res.json({
    ok: true,
    modules: listModuleIds().length,
    curriculumValid: v.ok,
    curriculumErrors: v.errors,
    models: MODELS,
    voices: VOICES,
    defaultVoice: DEFAULT_VOICE,
    time: new Date().toISOString(),
  });
});

app.get('/api/catalogue', (req, res) => {
  const progress = Object.fromEntries(allProgress().map(p => [p.moduleId, p]));
  res.json({
    modules: catalogue().map(m => ({ ...m, progress: progress[m.id] || null })),
    stats: overallStats(),
    streak: streakInfo(),
  });
});

app.get('/api/modules/:id', (req, res) => {
  try {
    const m = loadModule(req.params.id);
    if (!m) return res.status(404).json({ error: 'Module not found' });
    res.json({ module: m, progress: getProgress(req.params.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/progress/:id', (req, res) => {
  res.json(getProgress(req.params.id));
});

app.post('/api/progress/:id', (req, res) => {
  try {
    const m = loadModule(req.params.id);
    const p = updateProgress(req.params.id, {
      ...req.body,
      totalConcepts: m?.concepts.length,
      totalExercises: m?.exercises.length,
      totalScenarios: m?.scenarios.length,
    });
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/progress', (req, res) => {
  res.json({ modules: allProgress(), stats: overallStats() });
});

/* ------------------------------------------------------------------ */
/* Sessions (recorded practice)                                        */
/* ------------------------------------------------------------------ */

/**
 * Analyse a recorded take.
 * Body: { moduleId, exerciseId, kind, transcript, words[], pcmBase64, sampleRate, durationSec }
 */
app.post('/api/sessions', async (req, res) => {
  const { moduleId, exerciseId, kind, transcript, words = [], pcmBase64, sampleRate = 16000, durationSec = 0 } = req.body || {};
  try {
    let pcm = null;
    if (pcmBase64) {
      const buf = Buffer.from(pcmBase64, 'base64');
      pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    }

    const metrics = analyzeSpeech({ transcript: transcript || '', words, pcm, sampleRate, durationSec });
    const notes = coachNotes(metrics);

    const id = saveSession({
      moduleId, exerciseId, kind, transcript, words,
      durationSec: metrics.durationSec, wpm: metrics.wpm,
      overall: metrics.scores.overall, scores: metrics.scores,
      metrics: {
        wpm: metrics.wpm, fillers: metrics.fillers, pauses: metrics.pauses,
        volume: metrics.volume ? { ...metrics.volume, envelope: undefined } : null,
        pitch: metrics.pitch, articulation: metrics.articulation, language: metrics.language,
      },
      coach: notes,
    });

    res.json({ id, metrics, coach: notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions', (req, res) => {
  res.json(listSessions(req.query.moduleId));
});

app.get('/api/sessions/:id', (req, res) => {
  const s = sessionDetail(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
});

/* ------------------------------------------------------------------ */
/* Attempts, scenarios, assessments                                    */
/* ------------------------------------------------------------------ */

app.post('/api/attempts', (req, res) => {
  const id = saveAttempt(req.body || {});
  res.json({ id });
});

app.get('/api/attempts', (req, res) => {
  res.json(listAttempts(req.query.moduleId));
});

app.post('/api/scenarios/:moduleId/:scenarioId/respond', async (req, res) => {
  const { moduleId, scenarioId } = req.params;
  const { optionIndex, optionText, rating, feedback } = req.body || {};
  try {
    const m = loadModule(moduleId);
    const scenario = m?.scenarios.find(s => s.id === scenarioId);
    let graded = null;
    if (m && scenario && optionText) {
      try { graded = await gradeScenarioChoice({ module: m, scenario, optionText }); } catch (e) { graded = { error: e.message }; }
    }
    const id = saveScenarioResponse({
      moduleId, scenarioId, optionIndex, rating, feedback: feedback || graded?.betterMove || '',
    });
    res.json({ id, graded });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scenarios/:moduleId/responses', (req, res) => {
  res.json(listScenarioResponses(req.params.moduleId));
});

app.post('/api/assessments/:moduleId/submit', async (req, res) => {
  const { moduleId } = req.params;
  const { submission } = req.body || {};
  try {
    const m = loadModule(moduleId);
    if (!m) return res.status(404).json({ error: 'Module not found' });
    const graded = await gradeAssessment({ module: m, submission: submission || '' });
    const passed = (graded.total || 0) >= (m.assessment.passMark || 70);
    const id = saveAssessment({ moduleId, rubric: graded.scores || [], total: graded.total || 0, passed, notes: graded.summary || '' });
    res.json({ id, graded, passed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/assessments', (req, res) => {
  res.json(listAssessments(req.query.moduleId));
});

/* ------------------------------------------------------------------ */
/* Tutor (SSE streaming)                                               */
/* ------------------------------------------------------------------ */

app.post('/api/tutor/stream', async (req, res) => {
  const { prompt, context, moduleId, sessionId } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  // NOTE: do NOT abort on `req.on('close')`. In Express 5 that event fires as
  // soon as the request body has been consumed, which is long before the
  // response finishes streaming - it would kill every tutor response after
  // zero tokens. The correct signal is `res.on('close')`, which fires when the
  // response is actually torn down.
  res.on('close', () => controller.abort());

  // Build grounding context from the learner's actual progress.
  let ctx = context || '';
  try {
    if (moduleId) {
      const m = loadModule(moduleId);
      if (m) {
        const p = getProgress(moduleId);
        ctx += `\n\nThe learner is in module "${m.title}". Module outcome: ${m.outcome}.`;
        ctx += `\nProgress: ${p.percent}% complete. Concepts done: ${p.concepts.length}/${m.concepts.length}.`;
        if (p.lastScore) ctx += `\nMost recent score on this module: ${p.lastScore}.`;
        ctx += `\nKey frameworks available: ${(m.frameworks || []).map(f => `${f.name} - ${f.summary}`).join(' | ')}`;
      }
    }
    if (sessionId) {
      const s = sessionDetail(sessionId);
      if (s) {
        ctx += `\n\nTheir most recent recorded take:\nMetrics: ${JSON.stringify(s.scores)}\nTranscript: ${(s.transcript || '').slice(0, 1500)}`;
      }
    }
  } catch { /* context is best-effort */ }

  try {
    for await (const chunk of streamTutor(prompt, { context: ctx, signal: controller.signal })) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: 'Tutor stream failed' })}\n\n`);
  }
  res.end();
});

/* ------------------------------------------------------------------ */
/* Image generation                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/images/existing', (req, res) => {
  const { moduleId, conceptId } = req.query;
  const dir = path.join(ROOT, 'assets', 'generated');
  if (!fs.existsSync(dir)) return res.json({ url: null });
  const prefix = `${moduleId}_${conceptId}_`;
  const hit = fs.readdirSync(dir).find(f => f.startsWith(prefix) && /\.(png|jpg|jpeg|webp)$/i.test(f));
  res.json({ url: hit ? `/assets/generated/${hit}` : null, filename: hit || null });
});

app.post('/api/images/generate', async (req, res) => {
  const { moduleId, conceptId, prompt, model } = req.body || {};
  try {
    let finalPrompt = prompt;
    let filename = `${moduleId || 'x'}_${conceptId || Date.now()}`;
    if (moduleId && conceptId) {
      const m = loadModule(moduleId);
      const c = m?.concepts.find(x => x.id === conceptId);
      if (c) {
        finalPrompt = buildImagePrompt(c, m);
        filename = `${moduleId}_${conceptId}_${c.title}`.slice(0, 80);
      }
    }
    if (!finalPrompt) return res.status(400).json({ error: 'prompt or moduleId+conceptId required' });

    const out = await generateConceptImage(finalPrompt, { filename, model });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* Coach debrief                                                       */
/* ------------------------------------------------------------------ */

app.post('/api/debrief', async (req, res) => {
  const { sessionId, moduleId, exerciseId } = req.body || {};
  try {
    const s = sessionId ? sessionDetail(sessionId) : null;
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const m = moduleId ? loadModule(moduleId) : null;
    const exercise = m?.exercises.find(e => e.id === exerciseId) || m?.exercises[0];
    const metrics = {
      wpm: s.wpm, scores: s.scores,
      fillers: s.metrics?.fillers, pauses: s.metrics?.pauses,
      pitch: s.metrics?.pitch, volume: s.metrics?.volume, language: s.metrics?.language,
    };
    const debrief = await coachDebrief({ metrics, transcript: s.transcript, exercise, module: m });
    res.json({ debrief });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/dashboard', (req, res) => {
  res.json({
    stats: overallStats(),
    streak: streakInfo(),
    activity: activityRange(30),
    progress: allProgress(),
    trends: dimensionTrends(20),
    sessions: listSessions().slice(0, 10),
  });
});

/* ------------------------------------------------------------------ */
/* Live coach instruction builder (so the client can start a session)  */
/* ------------------------------------------------------------------ */

app.post('/api/live/instruction', (req, res) => {
  const { moduleId, exerciseId, scenarioId, extra, opening } = req.body || {};
  try {
    const m = moduleId ? loadModule(moduleId) : null;
    const exercise = m?.exercises.find(e => e.id === exerciseId);
    const scenario = m?.scenarios.find(s => s.id === scenarioId);
    const instruction = buildCoachInstruction({ module: m, exercise, scenario, extra });
    res.json({ instruction, opening: opening || (exercise ? exercise.liveCoachPrompt : '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
attachLiveCoach(server, { path: '/live' });

server.listen(PORT, () => {
  const v = validateAll();
  console.log(`\n  ORATOR running on http://localhost:${PORT}`);
  console.log(`  modules: ${listModuleIds().length}  curriculum valid: ${v.ok ? 'yes' : 'NO'}`);
  if (!v.ok) v.errors.forEach(e => console.log('   ! ' + e.split('\n')[0]));
  console.log(`  live coach: ws://localhost:${PORT}/live  (model ${MODELS.live})`);
  console.log(`  tutor: ${MODELS.tutor}   images: ${MODELS.image}\n`);
});

export { app, server };
