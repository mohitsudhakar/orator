/**
 * Curriculum loader: reads module JSON from ./content/modules, validates it,
 * and serves a catalogue.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.resolve(process.env.ORATOR_CONTENT_DIR || './content/modules');
const cache = new Map();

export function listModuleIds() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR)
    .filter(f => /^m\d+\.json$/.test(f))
    .sort()
    .map(f => f.replace('.json', ''));
}

/** Load + validate one module. */
export function loadModule(id) {
  if (cache.has(id)) return cache.get(id);
  const file = path.join(CONTENT_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Module ${id} is not valid JSON: ${e.message}`);
  }
  validateModule(id, raw);
  cache.set(id, raw);
  return raw;
}

export function validateModule(id, m) {
  const errors = [];
  const req = (k, type) => {
    if (m[k] === undefined) errors.push(`missing ${k}`);
    else if (type && typeof m[k] !== type) errors.push(`${k} should be ${type}, got ${typeof m[k]}`);
  };
  req('id', 'string'); req('number', 'number'); req('title', 'string');
  req('subtitle', 'string'); req('level', 'string'); req('outcome', 'string');
  req('abstract', 'string'); req('durationMinutes', 'number');
  for (const k of ['objectives', 'keyTerms', 'concepts', 'frameworks', 'scenarios', 'exercises', 'masteryChecklist']) {
    if (!Array.isArray(m[k])) errors.push(`${k} must be an array`);
  }
  if (!m.assessment) errors.push('missing assessment');
  if (!Array.isArray(m.readingList)) errors.push('readingList must be an array');

  if (Array.isArray(m.concepts)) {
    m.concepts.forEach((c, i) => {
      if (!c.id) errors.push(`concepts[${i}] missing id`);
      if (!c.title) errors.push(`concepts[${i}] missing title`);
      if (!c.detail) errors.push(`concepts[${i}] missing detail`);
      const words = (c.detail || '').split(/\s+/).filter(Boolean).length;
      if (words < 150) errors.push(`concepts[${i}] detail too short (${words} words)`);
      if (!c.imagePrompt) errors.push(`concepts[${i}] missing imagePrompt`);
    });
  }
  if (Array.isArray(m.exercises)) {
    m.exercises.forEach((e, i) => {
      if (!e.id) errors.push(`exercises[${i}] missing id`);
      if (!e.title) errors.push(`exercises[${i}] missing title`);
      if (!e.instructions) errors.push(`exercises[${i}] missing instructions`);
      if (!e.liveCoachPrompt) errors.push(`exercises[${i}] missing liveCoachPrompt`);
    });
  }
  if (Array.isArray(m.scenarios)) {
    m.scenarios.forEach((s, i) => {
      if (!Array.isArray(s.options) || s.options.length < 2) errors.push(`scenarios[${i}] needs >=2 options`);
      s.options?.forEach((o, j) => {
        if (!o.text) errors.push(`scenarios[${i}].options[${j}] missing text`);
        if (!o.feedback) errors.push(`scenarios[${i}].options[${j}] missing feedback`);
        if (!['poor', 'fair', 'good', 'excellent'].includes(o.rating)) errors.push(`scenarios[${i}].options[${j}] bad rating`);
      });
    });
  }
  if (m.assessment?.rubric) {
    const sum = m.assessment.rubric.reduce((a, r) => a + (r.weight || 0), 0);
    if (sum !== 100) errors.push(`rubric weights sum to ${sum}, expected 100`);
    m.assessment.rubric.forEach((r, i) => {
      if (!r.excellent || !r.adequate || !r.poor) errors.push(`rubric[${i}] missing band descriptions`);
    });
  }
  if (errors.length) throw new Error(`Module ${id} invalid:\n - ${errors.join('\n - ')}`);
  return true;
}

/** Full catalogue (lightweight - no full concept detail). */
export function catalogue() {
  return listModuleIds().map(id => {
    const m = loadModule(id);
    return {
      id: m.id,
      number: m.number,
      title: m.title,
      subtitle: m.subtitle,
      level: m.level,
      durationMinutes: m.durationMinutes,
      outcome: m.outcome,
      abstract: m.abstract,
      conceptCount: m.concepts.length,
      exerciseCount: m.exercises.length,
      scenarioCount: m.scenarios.length,
      frameworkCount: m.frameworks.length,
      objectives: m.objectives,
      keyTermCount: m.keyTerms.length,
      readingCount: m.readingList.length,
    };
  });
}

/** Validate every module on disk. Returns { ok, errors[] }. */
export function validateAll() {
  const errors = [];
  for (const id of listModuleIds()) {
    try { loadModule(id); } catch (e) { errors.push(e.message); }
  }
  return { ok: errors.length === 0, errors, count: listModuleIds().length };
}
