/**
 * Print a per-module summary of the curriculum: counts, rubric sums, word
 * lengths, exercise type mix, and image prompt coverage.
 */
import { listModuleIds, loadModuleSafe, validateAll } from '../curriculum.js';

const v = validateAll();
console.log(`\nmodules: ${v.count} | all valid: ${v.ok}`);
if (!v.ok) v.errors.forEach(e => console.log('  ERR:', e.split('\n').slice(0, 3).join(' | ')));

console.log('\n' + '='.repeat(104));
console.log('ID    LEVEL         c  f  s  e  rubric  words        img  realWorld/recorded  title');
console.log('='.repeat(104));

let TC = 0, TF = 0, TS = 0, TE = 0;
const issues = [];

for (const id of listModuleIds()) {
  const x = loadModuleSafe(id);
  if (!x) { console.log(`${id}  INVALID`); continue; }

  const rw = x.assessment.rubric.reduce((a, r) => a + r.weight, 0);
  const cw = x.concepts.map(c => (c.detail || '').split(/\s+/).filter(Boolean).length);
  const img = x.concepts.filter(c => c.imagePrompt).length;
  const rt = x.exercises.filter(e => e.type === 'realWorld').length;
  const rc = x.exercises.filter(e => e.type === 'recorded').length;

  TC += x.concepts.length; TF += x.frameworks.length; TS += x.scenarios.length; TE += x.exercises.length;

  console.log(
    `${x.id}  ${x.level.padEnd(13)} ${String(x.concepts.length).padStart(2)} ${String(x.frameworks.length).padStart(2)} ` +
    `${String(x.scenarios.length).padStart(2)} ${String(x.exercises.length).padStart(2)}  ${String(rw).padStart(5)}  ` +
    `${String(Math.min(...cw)).padStart(3)}-${String(Math.max(...cw)).padEnd(3)}  ${img}/${x.concepts.length}`.padEnd(10) +
    `  ${rt}/${rc}`.padEnd(16) + x.title.slice(0, 40)
  );

  // Spec compliance checks.
  if (rw !== 100) issues.push(`${x.id}: rubric weights sum to ${rw}`);
  if (cw.some(w => w < 250 || w > 450)) issues.push(`${x.id}: concept detail outside 250-450 words (${Math.min(...cw)}-${Math.max(...cw)})`);
  if (img !== x.concepts.length) issues.push(`${x.id}: ${x.concepts.length - img} concepts missing imagePrompt`);
  if (rt < 2) issues.push(`${x.id}: only ${rt} realWorld exercises (need 2)`);
  if (rc < 2) issues.push(`${x.id}: only ${rc} recorded exercises (need 2)`);
  if (x.readingList.length < 4 || x.readingList.length > 6) issues.push(`${x.id}: readingList has ${x.readingList.length} (need 4-6)`);
  if (x.masteryChecklist.length < 5 || x.masteryChecklist.length > 8) issues.push(`${x.id}: masteryChecklist has ${x.masteryChecklist.length} (need 5-8)`);
  if (x.keyTerms.length < 8 || x.keyTerms.length > 14) issues.push(`${x.id}: keyTerms has ${x.keyTerms.length} (need 8-14)`);
  if (x.objectives.length < 4 || x.objectives.length > 6) issues.push(`${x.id}: objectives has ${x.objectives.length} (need 4-6)`);
  if (x.concepts.length < 5 || x.concepts.length > 8) issues.push(`${x.id}: concepts has ${x.concepts.length} (need 5-8)`);
  if (x.scenarios.length < 4 || x.scenarios.length > 6) issues.push(`${x.id}: scenarios has ${x.scenarios.length} (need 4-6)`);
  if (x.exercises.length < 5 || x.exercises.length > 7) issues.push(`${x.id}: exercises has ${x.exercises.length} (need 5-7)`);
  if (x.frameworks.length < 3 || x.frameworks.length > 5) issues.push(`${x.id}: frameworks has ${x.frameworks.length} (need 3-5)`);
  if (!x.exercises.every(e => e.liveCoachPrompt)) issues.push(`${x.id}: some exercises missing liveCoachPrompt`);
  if (!x.scenarios.every(s => s.options?.length >= 2 && s.options.every(o => o.feedback && o.rating))) issues.push(`${x.id}: scenario options missing feedback/rating`);
}

console.log('='.repeat(104));
console.log(`TOTALS  concepts=${TC}  frameworks=${TF}  scenarios=${TS}  exercises=${TE}`);
console.log('='.repeat(104));

if (issues.length) {
  console.log(`\n${issues.length} SPEC ISSUES:`);
  issues.forEach(i => console.log('  - ' + i));
  process.exit(1);
}
console.log('\nALL 12 MODULES COMPLIANT WITH THE SPEC');
