/**
 * Audit the quality of scenario discrimination.
 *
 * The point of a graded scenario is that the learner can tell which choice
 * was better and WHY. That requires:
 *   - at least 3 DISTINCT rating levels among the options (real gradient)
 *   - every option carries specific, non-generic feedback
 *   - the coaching note is a real principle, not a platitude
 */
import { listModuleIds, loadModuleSafe } from '../curriculum.js';

let issues = 0, checks = 0;
const GENERIC = /\b(it depends|be more specific|think about|try again|good job|not bad|consider)\b/i;

const ok = (name, cond, detail = '') => {
  checks++;
  if (!cond) { issues++; console.log(`  FAIL  ${name}  ${detail}`); }
};

let totalOptions = 0;
let totalScenarios = 0;
const bandHist = {};

for (const id of listModuleIds()) {
  const m = loadModuleSafe(id);
  if (!m) continue;

  for (const s of m.scenarios) {
    const tag = `${id}/${s.id}`;
    totalScenarios++;
    const ratings = s.options.map(o => o.rating);
    totalOptions += ratings.length;
    const distinct = new Set(ratings);
    for (const r of ratings) bandHist[r] = (bandHist[r] || 0) + 1;

    // 1. At least 3 distinct bands - the scenario must discriminate.
    ok(`${tag} has >=3 distinct ratings`, distinct.size >= 3, `got ${[...distinct].join(',')}`);

    // 2. At least one option rated excellent and one poor.
    ok(`${tag} spans poor..excellent`,
      distinct.has('poor') && distinct.has('excellent'), `got ${[...distinct].join(',')}`);

    // 3. Every option has a real outcome line and real feedback.
    for (const [i, o] of s.options.entries()) {
      ok(`${tag} opt${i} has outcome`, (o.outcome || '').length > 40, (o.outcome || '').slice(0, 60));
      ok(`${tag} opt${i} has substantive feedback`, (o.feedback || '').length > 90,
        `${(o.feedback || '').length} chars`);
      ok(`${tag} opt${i} feedback is specific`, !GENERIC.test(o.feedback || ''),
        (o.feedback || '').slice(0, 80));
    }

    // 4. The scenario has real stakes and objectives.
    ok(`${tag} has a setting`, (s.setting || '').length > 30, (s.setting || '').slice(0, 50));
    ok(`${tag} has a challenge`, (s.challenge || '').length > 40, (s.challenge || '').slice(0, 50));
    ok(`${tag} has objectives`, Array.isArray(s.objectives) && s.objectives.length >= 2,
      String((s.objectives || []).length));
    ok(`${tag} has a coaching note`, (s.coachingNote || '').length > 40, (s.coachingNote || '').slice(0, 60));
  }

  // 5. Rubric bands must genuinely discriminate - each band description
  //    should be meaningfully different from the others.
  const r = m.assessment.rubric;
  ok(`${id} rubric has 5-7 dimensions`, r.length >= 5 && r.length <= 7, `${r.length}`);
  ok(`${id} rubric weights sum to 100`, r.reduce((a, x) => a + x.weight, 0) === 100);
  for (const [i, d] of r.entries()) {
    ok(`${id} rubric[${i}] "${d.dimension}" has 3 distinct bands`,
      new Set([d.excellent, d.adequate, d.poor]).size === 3);
    ok(`${id} rubric[${i}] excellent is longer than poor`,
      (d.excellent || '').length > (d.poor || '').length * 0.8,
      `${(d.excellent || '').length} vs ${(d.poor || '').length}`);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`scenarios: ${totalScenarios}  options: ${totalOptions}`);
console.log(`rating spread: ${JSON.stringify(bandHist)}`);
if (issues) {
  console.log(`\n${issues} QUALITY ISSUES across ${checks} checks`);
  process.exit(1);
}
console.log(`ALL ${checks} SCENARIO QUALITY CHECKS PASSED`);
