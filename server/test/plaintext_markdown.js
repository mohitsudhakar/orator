/**
 * Find curriculum fields that CONTAIN markdown but are rendered as plain text
 * (not through md()). These would show raw asterisks, pipes, or backticks in
 * the UI.
 */
import { listModuleIds, loadModuleSafe } from '../curriculum.js';

const MD_PATTERNS = [
  { name: 'bold', re: /\*\*[^*\n]+\*\*/ },
  { name: 'italic', re: /(^|[^*])\*[^*\n]+\*/ },
  { name: 'inline code', re: /`[^`]+`/ },
  { name: 'table', re: /\|.*\|/ },
  { name: 'heading', re: /^#{1,6}\s+/m },
  { name: 'bullet', re: /^\s*[-*+]\s+\S/m },
  { name: 'numbered', re: /^\s*\d+[.)]\s+\S/m },
  { name: 'blockquote', re: /^>\s+/m },
];

// Fields the client renders with md() - these are fine.
const RENDERED_AS_MARKDOWN = new Set(['concept.detail', 'tutor']);

const hits = [];

for (const id of listModuleIds()) {
  const m = loadModuleSafe(id);
  if (!m) continue;

  const scan = (field, text) => {
    if (!text || typeof text !== 'string') return;
    for (const p of MD_PATTERNS) {
      if (p.re.test(text)) {
        hits.push({ module: id, field, kind: p.name, sample: text.match(p.re)[0].slice(0, 70) });
        return;
      }
    }
  };

  m.frameworks.forEach(f => {
    scan('framework.summary', f.summary);
    scan('framework.steps', f.steps.join('\n'));
    scan('framework.whenToUse', f.whenToUse);
    scan('framework.example', f.example);
  });
  m.scenarios.forEach(s => {
    scan('scenario.setting', s.setting);
    scan('scenario.challenge', s.challenge);
    scan('scenario.coachingNote', s.coachingNote);
    s.options.forEach(o => {
      scan('option.text', o.text);
      scan('option.outcome', o.outcome);
      scan('option.feedback', o.feedback);
    });
  });
  m.exercises.forEach(e => {
    scan('exercise.instructions', e.instructions);
    scan('exercise.deliverable', e.deliverable);
    scan('exercise.liveCoachPrompt', e.liveCoachPrompt);
    e.successCriteria.forEach(c => scan('exercise.successCriteria', c));
  });
  m.assessment.rubric.forEach(r => {
    scan('rubric.excellent', r.excellent);
    scan('rubric.adequate', r.adequate);
    scan('rubric.poor', r.poor);
  });
  scan('module.abstract', m.abstract);
  scan('module.outcome', m.outcome);
  m.keyTerms.forEach(t => scan('keyTerm.definition', t.definition));
  m.readingList.forEach(r => scan('reading.why', r.why));
  m.masteryChecklist.forEach(c => scan('masteryChecklist', c));
  m.objectives.forEach(o => scan('objective', o));
}

console.log(`\n=== plain-text fields containing markdown: ${hits.length} ===`);
const byKind = {};
hits.forEach(h => { byKind[h.kind] = (byKind[h.kind] || 0) + 1; });
console.log('  by kind:', JSON.stringify(byKind));
console.log('');
hits.slice(0, 40).forEach(h =>
  console.log(`  ${h.module} ${h.field.padEnd(28)} [${h.kind}] ${JSON.stringify(h.sample)}`));
if (hits.length > 40) console.log(`  ... and ${hits.length - 40} more`);

console.log(`\n${'='.repeat(50)}`);
if (hits.length) {
  console.log(`${hits.length} fields would show raw markdown in the UI`);
  process.exit(1);
}
console.log('No plain-text field contains markdown - the UI is clean');
