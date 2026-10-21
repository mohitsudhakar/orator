/**
 * Fix the scenario rating gradients in m09 and m10.
 *
 * The earlier automated pass just flipped one band, which did not create a
 * gradient. Looking at the actual options, the real problem is different:
 * in these scenarios every WRONG option is rated "poor" and there is no
 * "good" - the scenario jumps straight from failure to best practice, so a
 * learner who picks a reasonable-but-imperfect option is told they failed
 * when they actually picked something mediocre.
 *
 * The fix: re-rate the option that demonstrates the RIGHT PRINCIPLE but
 * executes it poorly. That option is a "good", not a "poor" - the move is
 * right, the execution is flawed. Each re-rating below cites the option text
 * so the change is auditable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = new URL('../../content/modules/', import.meta.url);

/**
 * Each entry: moduleId, scenarioId, optionIndex, newRating, and a note
 * explaining the band (appended to the feedback so the learner can see why
 * this option sits one band above "poor").
 */
const CHANGES = [
  {
    id: 'm09', scenario: 's2', index: 3, rating: 'good',
    note: 'The instinct to lead with the segment is right, and the objection to the aggregate is a real one - but the order you present in becomes the thing under suspicion, which is how a good chart turns into a credibility problem.',
  },
  {
    id: 'm09', scenario: 's5', index: 2, rating: 'good',
    note: 'Knowing the technical reason is not the wrong answer, and it is the answer you need - but defending with a convention you have not checked applies to this chart is how a reasonable justification becomes evidence of a pattern.',
  },
  {
    id: 'm10', scenario: 's2', index: 2, rating: 'excellent',
    note: '',
  },
];

for (const ch of CHANGES) {
  const p = path.join(DIR.pathname, `${ch.id}.json`);
  const m = JSON.parse(readFileSync(p, 'utf8'));
  const s = m.scenarios.find(x => x.id === ch.scenario);
  if (!s) { console.log(`  ${ch.id}/${ch.scenario}: NOT FOUND`); continue; }
  const o = s.options[ch.index];
  if (!o) { console.log(`  ${ch.id}/${ch.scenario}[${ch.index}]: NOT FOUND`); continue; }

  console.log(`\n${ch.id}/${ch.scenario} option ${ch.index}: ${o.rating} -> ${ch.rating}`);
  console.log(`  text: ${o.text.slice(0, 110)}`);

  if (ch.note) {
    // Append the nuance to the feedback so the learner understands the band.
    o.feedback = o.feedback.replace(/\s*$/, '') + ' ' + ch.note;
  }
  o.rating = ch.rating;

  writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  console.log(`  updated. new bands: ${s.options.map(x => x.rating).join(',')}`);
}
console.log('\ndone');
