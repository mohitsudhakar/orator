/**
 * Repair the two concepts whose detail ends with a truncated markdown span.
 *
 * The first trimmer cut on sentence boundaries, which can land in the middle
 * of a "**bold**" span. Rather than deleting content (which loses the point),
 * we COMPLETE the cut sentence - the intent is clear from the surrounding
 * text in both cases.
 *
 * Both repairs are verified by re-running the prose check afterwards.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = new URL('../../content/modules/', import.meta.url);
const p = path.join(DIR.pathname, 'm10.json');
const m = JSON.parse(readFileSync(p, 'utf8'));

const REPAIRS = {
  // "...then stop talking."  <- the bold span was cut before its closing **
  c3: '4. **Ask the question that unlocks the discussion, then stop talking.**',
  // "**3:30-4:30 - Name the trade-off aloud." <- cut before the closing **
  c7: '**3:30-4:30 - Name the trade-off aloud.** Then say it plainly, in one sentence, with a number attached. Trade-offs stated aloud are what move a room from discussion to a decision.',
};

for (const c of m.concepts) {
  if (!REPAIRS[c.id]) continue;
  const before = c.detail;
  const boldBefore = (before.match(/\*\*/g) || []).length;

  // Replace the trailing truncated fragment with the completed text.
  const lines = before.split('\n');
  const lastLine = lines[lines.length - 1];
  // The fragment is the trailing part of the last line after the final newline.
  lines[lines.length - 1] = REPAIRS[c.id];
  c.detail = lines.join('\n');

  const boldAfter = (c.detail.match(/\*\*/g) || []).length;
  const words = c.detail.trim().split(/\s+/).length;
  console.log(`${c.id} "${c.title}"`);
  console.log(`  bold ${boldBefore} -> ${boldAfter}, words ${before.split(/\s+/).length} -> ${words}`);
  console.log(`  ends: ${JSON.stringify(c.detail.slice(-140))}`);
}

writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
console.log(`\nwrote ${p}`);
