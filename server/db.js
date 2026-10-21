/**
 * ORATOR persistence layer (node:sqlite).
 *
 * Schema:
 *   progress    - per-module learner state
 *   sessions    - recorded practice sessions (metrics snapshots)
 *   attempts    - individual exercise attempts
 *   scenarios   - scenario responses with coach grading
 *   assessments - module capstone scores
 *   streaks     - daily activity for the habit tracker
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.ORATOR_DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'orator.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS progress (
    module_id      TEXT PRIMARY KEY,
    started_at     TEXT,
    completed_at   TEXT,
    percent        INTEGER DEFAULT 0,
    concepts_done  TEXT DEFAULT '[]',
    exercises_done TEXT DEFAULT '[]',
    scenarios_done TEXT DEFAULT '[]',
    notes          TEXT DEFAULT '',
    last_score     INTEGER DEFAULT 0,
    updated_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    module_id     TEXT,
    exercise_id   TEXT,
    kind          TEXT,
    transcript    TEXT,
    words_json    TEXT,
    duration_sec  REAL,
    wpm           INTEGER,
    overall       INTEGER,
    scores_json   TEXT,
    metrics_json  TEXT,
    coach_json    TEXT,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_module ON sessions(module_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

  CREATE TABLE IF NOT EXISTS attempts (
    id            TEXT PRIMARY KEY,
    module_id     TEXT,
    exercise_id   TEXT,
    kind          TEXT,
    score         INTEGER,
    passed        INTEGER DEFAULT 0,
    notes         TEXT,
    metrics_json  TEXT,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_module ON attempts(module_id);

  CREATE TABLE IF NOT EXISTS scenario_responses (
    id            TEXT PRIMARY KEY,
    module_id     TEXT,
    scenario_id   TEXT,
    option_index  INTEGER,
    rating        TEXT,
    feedback      TEXT,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_scenario_module ON scenario_responses(module_id);

  CREATE TABLE IF NOT EXISTS assessments (
    id            TEXT PRIMARY KEY,
    module_id     TEXT,
    rubric_json   TEXT,
    total         INTEGER,
    passed        INTEGER DEFAULT 0,
    notes         TEXT,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_assessments_module ON assessments(module_id);

  CREATE TABLE IF NOT EXISTS activity (
    day           TEXT PRIMARY KEY,
    count         INTEGER DEFAULT 0,
    minutes       REAL DEFAULT 0
  );
`);

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

function touchActivity(minutes = 0) {
  const d = today();
  db.prepare(`INSERT INTO activity(day, count, minutes) VALUES(?,1,?)
              ON CONFLICT(day) DO UPDATE SET count = count + 1, minutes = minutes + excluded.minutes`)
    .run(d, minutes);
}

/* ---------------- progress ---------------- */

export function getProgress(moduleId) {
  const row = db.prepare('SELECT * FROM progress WHERE module_id = ?').get(moduleId);
  if (!row) {
    db.prepare('INSERT INTO progress(module_id, started_at, updated_at) VALUES(?,?,?)').run(moduleId, now(), now());
    return { moduleId, startedAt: now(), completedAt: null, percent: 0, concepts: [], exercises: [], scenarios: [], notes: '', lastScore: 0 };
  }
  return {
    moduleId: row.module_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    percent: row.percent,
    concepts: JSON.parse(row.concepts_done || '[]'),
    exercises: JSON.parse(row.exercises_done || '[]'),
    scenarios: JSON.parse(row.scenarios_done || '[]'),
    notes: row.notes,
    lastScore: row.last_score,
    updatedAt: row.updated_at,
  };
}

export function updateProgress(moduleId, patch = {}) {
  const cur = getProgress(moduleId);
  const concepts = patch.concepts ?? cur.concepts;
  const exercises = patch.exercises ?? cur.exercises;
  const scenarios = patch.scenarios ?? cur.scenarios;
  const notes = patch.notes ?? cur.notes;
  const lastScore = patch.lastScore ?? cur.lastScore;

  // percent = weighted completion across concepts / exercises / scenarios
  const parts = [];
  if (patch.totalConcepts) parts.push([concepts.length, patch.totalConcepts, 0.4]);
  if (patch.totalExercises) parts.push([exercises.length, patch.totalExercises, 0.4]);
  if (patch.totalScenarios) parts.push([scenarios.length, patch.totalScenarios, 0.2]);
  let percent = cur.percent;
  if (parts.length) {
    const wSum = parts.reduce((a, p) => a + p[2], 0);
    const got = parts.reduce((a, p) => a + Math.min(1, p[0] / p[1]) * p[2], 0);
    percent = Math.round((got / wSum) * 100);
  }
  if (patch.percent !== undefined) percent = Math.max(0, Math.min(100, patch.percent));

  const completedAt = percent >= 100 ? (cur.completedAt || now()) : null;

  db.prepare(`UPDATE progress SET concepts_done=?, exercises_done=?, scenarios_done=?, notes=?,
              percent=?, last_score=?, completed_at=?, updated_at=? WHERE module_id=?`)
    .run(JSON.stringify(concepts), JSON.stringify(exercises), JSON.stringify(scenarios), notes,
         percent, lastScore, completedAt, now(), moduleId);
  touchActivity();
  return getProgress(moduleId);
}

export function allProgress() {
  const rows = db.prepare('SELECT * FROM progress').all();
  return rows.map(r => ({
    moduleId: r.module_id,
    percent: r.percent,
    completedAt: r.completed_at,
    startedAt: r.started_at,
    lastScore: r.last_score,
    concepts: JSON.parse(r.concepts_done || '[]').length,
    exercises: JSON.parse(r.exercises_done || '[]').length,
    scenarios: JSON.parse(r.scenarios_done || '[]').length,
  }));
}

/* ---------------- sessions ---------------- */

export function saveSession(s) {
  const id = s.id || `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO sessions(id, module_id, exercise_id, kind, transcript, words_json,
              duration_sec, wpm, overall, scores_json, metrics_json, coach_json, created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, s.moduleId || null, s.exerciseId || null, s.kind || 'practice',
         s.transcript || '', JSON.stringify(s.words || []),
         s.durationSec || 0, s.wpm || 0, s.overall || 0,
         JSON.stringify(s.scores || {}), JSON.stringify(s.metrics || {}),
         JSON.stringify(s.coach || []), now());
  touchActivity((s.durationSec || 0) / 60);
  return id;
}

export function listSessions(moduleId) {
  const rows = moduleId
    ? db.prepare('SELECT id, module_id, exercise_id, kind, duration_sec, wpm, overall, scores_json, coach_json, created_at FROM sessions WHERE module_id = ? ORDER BY created_at DESC').all(moduleId)
    : db.prepare('SELECT id, module_id, exercise_id, kind, duration_sec, wpm, overall, scores_json, coach_json, created_at FROM sessions ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id, moduleId: r.module_id, exerciseId: r.exercise_id, kind: r.kind,
    durationSec: r.duration_sec, wpm: r.wpm, overall: r.overall,
    scores: JSON.parse(r.scores_json || '{}'), coach: JSON.parse(r.coach_json || '[]'),
    createdAt: r.created_at,
  }));
}

export function sessionDetail(id) {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id, moduleId: r.module_id, exerciseId: r.exercise_id, kind: r.kind,
    transcript: r.transcript, words: JSON.parse(r.words_json || '[]'),
    durationSec: r.duration_sec, wpm: r.wpm, overall: r.overall,
    scores: JSON.parse(r.scores_json || '{}'),
    metrics: JSON.parse(r.metrics_json || '{}'),
    coach: JSON.parse(r.coach_json || '[]'),
    createdAt: r.created_at,
  };
}

/* ---------------- attempts ---------------- */

export function saveAttempt(a) {
  const id = a.id || `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO attempts(id, module_id, exercise_id, kind, score, passed, notes, metrics_json, created_at)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, a.moduleId || null, a.exerciseId || null, a.kind || 'drill',
         a.score || 0, a.passed ? 1 : 0, a.notes || '',
         JSON.stringify(a.metrics || {}), now());
  touchActivity();
  return id;
}

export function listAttempts(moduleId) {
  const rows = moduleId
    ? db.prepare('SELECT * FROM attempts WHERE module_id = ? ORDER BY created_at DESC').all(moduleId)
    : db.prepare('SELECT * FROM attempts ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id, moduleId: r.module_id, exerciseId: r.exercise_id, kind: r.kind,
    score: r.score, passed: !!r.passed, notes: r.notes,
    metrics: JSON.parse(r.metrics_json || '{}'), createdAt: r.created_at,
  }));
}

/* ---------------- scenarios ---------------- */

export function saveScenarioResponse(r) {
  const id = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO scenario_responses(id, module_id, scenario_id, option_index, rating, feedback, created_at)
              VALUES(?,?,?,?,?,?,?)`)
    .run(id, r.moduleId, r.scenarioId, r.optionIndex ?? -1, r.rating || '', r.feedback || '', now());
  touchActivity();
  return id;
}

export function listScenarioResponses(moduleId) {
  const rows = db.prepare('SELECT * FROM scenario_responses WHERE module_id = ? ORDER BY created_at DESC').all(moduleId);
  return rows.map(r => ({
    id: r.id, moduleId: r.module_id, scenarioId: r.scenario_id,
    optionIndex: r.option_index, rating: r.rating, feedback: r.feedback, createdAt: r.created_at,
  }));
}

/* ---------------- assessments ---------------- */

export function saveAssessment(a) {
  const id = `as_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO assessments(id, module_id, rubric_json, total, passed, notes, created_at)
              VALUES(?,?,?,?,?,?,?)`)
    .run(id, a.moduleId, JSON.stringify(a.rubric || []), a.total || 0, a.passed ? 1 : 0, a.notes || '', now());
  touchActivity();
  return id;
}

export function listAssessments(moduleId) {
  const rows = moduleId
    ? db.prepare('SELECT * FROM assessments WHERE module_id = ? ORDER BY created_at DESC').all(moduleId)
    : db.prepare('SELECT * FROM assessments ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id, moduleId: r.module_id, rubric: JSON.parse(r.rubric_json || '[]'),
    total: r.total, passed: !!r.passed, notes: r.notes, createdAt: r.created_at,
  }));
}

/* ---------------- activity / streak ---------------- */

export function activityRange(days = 30) {
  const rows = db.prepare('SELECT day, count, minutes FROM activity ORDER BY day DESC LIMIT ?').all(days);
  return rows.reverse();
}

export function streakInfo() {
  const rows = db.prepare('SELECT day FROM activity ORDER BY day DESC').all();
  const days = new Set(rows.map(r => r.day));
  const d = new Date();
  let streak = 0;
  // grace: today not yet logged does not break the streak
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (!days.has(iso(d))) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(iso(d))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const total = db.prepare('SELECT COUNT(*) c FROM activity').get().c;
  return { streak, activeDays: total };
}

export function overallStats() {
  const prog = allProgress();
  const completed = prog.filter(p => p.percent >= 100).length;
  const sessions = db.prepare('SELECT COUNT(*) c, AVG(overall) a FROM sessions').get();
  const attempts = db.prepare('SELECT COUNT(*) c, AVG(score) a FROM attempts').get();
  const assessments = db.prepare('SELECT COUNT(*) c, AVG(total) a FROM assessments').get();
  const { streak } = streakInfo();
  return {
    modulesStarted: prog.length,
    modulesCompleted: completed,
    sessionCount: sessions.c || 0,
    avgSessionScore: sessions.a ? Math.round(sessions.a) : 0,
    attemptCount: attempts.c || 0,
    avgAttemptScore: attempts.a ? Math.round(attempts.a) : 0,
    assessmentCount: assessments.c || 0,
    avgAssessment: assessments.a ? Math.round(assessments.a) : 0,
    streak,
  };
}

/** Per-dimension trend across recent sessions. */
export function dimensionTrends(limit = 20) {
  const rows = db.prepare('SELECT scores_json, created_at FROM sessions ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.reverse().map(r => ({ ...JSON.parse(r.scores_json || '{}'), at: r.created_at }));
}
