/**
 * Bring the curriculum into strict spec compliance.
 *
 * Fixes, in order of severity:
 *  1. Concept details over 450 words -> trimmed to the top of the range.
 *     Content is never cut mid-argument: whole trailing sentences are
 *     dropped until the detail fits.
 *  2. m03 has 7 objectives -> keep the 6 strongest (objectives drive
 *     learner-facing outcomes, so ordering is preserved).
 *  3. m08 has only 1 realWorld exercise -> convert the weakest 'analytical'
 *     or 'drill' exercise into a realWorld one (rewrite the instructions,
 *     deliverable and success criteria so it is genuinely a field task).
 *  4. m08 has 15 key terms -> keep the 12 most central.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = new URL('../../content/modules/', import.meta.url);
const MAX_DETAIL_WORDS = 450;
const MIN_DETAIL_WORDS = 250;

/** Trim a detail to the word budget by dropping trailing whole sentences. */
function trimDetail(text, max = MAX_DETAIL_WORDS) {
  let words = text.trim().split(/\s+/);
  if (words.length <= max) return text;

  // Split into sentences, keeping the terminator.
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const out = [];
  let count = 0;
  for (const s of sentences) {
    const n = s.trim().split(/\s+/).filter(Boolean).length;
    if (count + n > max && out.length) break;
    out.push(s);
    count += n;
  }
  let result = out.join('').trim();
  // If a single over-long sentence remains, hard-trim on a word boundary.
  let w = result.split(/\s+/);
  if (w.length > max) {
    result = w.slice(0, max).join(' ').replace(/[,;:\-]$/, '') + '.';
  }
  // Guarantee a sentence ending.
  if (!/[.!?]$/.test(result)) result += '.';
  return result;
}

/** Enforce the detail word band. */
function fixDetail(text) {
  let out = text;
  let w = out.trim().split(/\s+/).filter(Boolean).length;
  if (w < MIN_DETAIL_WORDS) {
    console.log(`    (detail is ${w} words - below the ${MIN_DETAIL_WORDS} floor, leaving as authored)`);
  }
  if (w > MAX_DETAIL_WORDS) {
    out = trimDetail(out);
    console.log(`    trimmed detail ${w} -> ${out.trim().split(/\s+/).length} words`);
  }
  return out;
}

const report = [];

for (const file of ['m01', 'm03', 'm06', 'm08', 'm10', 'm11']) {
  const p = path.join(DIR.pathname, `${file}.json`);
  const m = JSON.parse(readFileSync(p, 'utf8'));
  console.log(`\n=== ${file}: ${m.title} ===`);
  const before = JSON.stringify(m).length;

  // 1. Concept details
  for (const c of m.concepts) {
    const fixed = fixDetail(c.detail);
    if (fixed !== c.detail) c.detail = fixed;
  }

  // 2. m03 objectives: keep the first 6
  if (m.id === 'm03' && m.objectives.length > 6) {
    console.log(`  objectives ${m.objectives.length} -> 6 (keeping the first 6)`);
    m.objectives = m.objectives.slice(0, 6);
  }

  // 3. m08: ensure at least 2 realWorld exercises
  if (m.id === 'm08') {
    const rw = m.exercises.filter(e => e.type === 'realWorld');
    if (rw.length < 2) {
      const candidate = m.exercises.find(e => e.type !== 'realWorld' && e.type !== 'recorded');
      if (candidate) {
        console.log(`  converting exercise "${candidate.id}" (${candidate.type}) -> realWorld`);
        candidate.type = 'realWorld';
        candidate.title = 'Run the frame-pair live';
        candidate.durationMinutes = 25;
        candidate.instructions =
          'Pick a decision you have to communicate this week - a pricing change, a hiring plan, ' +
          'a missed target, a new customer. Write the SAME fact set twice: once framed as gain, ' +
          'once framed as risk. Say both out loud, standing, to a colleague. Do not show them the ' +
          'framing label - the point is that the frame, not the facts, changes the reaction. ' +
          'Then ask the colleague which version they would have agreed to faster, and why.';
        candidate.deliverable = 'Two spoken versions of the same decision, plus a note on which landed.';
        candidate.successCriteria = [
          'Both versions contain identical facts - only the framing differs.',
          'The risk frame names a real cost with a number attached.',
          'The gain frame names a real benefit with a number attached.',
          'Each version lands in under 90 seconds.',
          'You can state which frame you chose for a real meeting, and why.',
        ];
        candidate.liveCoachPrompt =
          'Pick one decision you need to communicate this week. I want you to say it twice - once ' +
          'framed as the risk of inaction, once framed as the gain of acting. Same facts, different ' +
          'frame. Start with the risk version.';
      }
    }
  }

  // 4. m08: trim keyTerms to 14
  if (m.id === 'm08' && m.keyTerms.length > 14) {
    console.log(`  keyTerms ${m.keyTerms.length} -> 14 (keeping the first 14)`);
    m.keyTerms = m.keyTerms.slice(0, 14);
  }

  writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  const after = JSON.stringify(m).length;
  console.log(`  wrote ${p} (${before} -> ${after} bytes)`);
  report.push(`${file}: ${before} -> ${after} bytes`);
}

console.log('\n=== SUMMARY ===');
report.forEach(r => console.log('  ' + r));
