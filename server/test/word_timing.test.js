/**
 * Test the client-side word-timing algorithm (buildWordTimings).
 *
 * The Live API gives transcript text but no word timings. The client detects
 * speech segments from the mic energy envelope and spreads words across them.
 * If this is wrong, every pause metric is wrong - so it gets its own test.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0, checks = 0;
function ok(name, cond, detail = '') {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}  ${detail}`); }
}

// Extract the function from app.js rather than duplicating it, so the test
// exercises the real shipped code.
const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const start = src.indexOf('function buildWordTimings');
if (start < 0) { console.log('buildWordTimings not found'); process.exit(1); }
const end = src.indexOf('\nfunction ', start + 10);
const fnSource = src.slice(start, end);
console.log(`\n=== extracted buildWordTimings (${fnSource.length} chars) ===`);

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`${fnSource}; this.buildWordTimings = buildWordTimings;`, ctx);
const buildWordTimings = ctx.buildWordTimings;

console.log('\n=== 1. No segments -> even spread ===');
{
  const words = buildWordTimings('one two three four', [], 8);
  ok('returns 4 words', words.length === 4, `${words.length}`);
  ok('words are monotonic', words.every((w, i) => i === 0 || w.start >= words[i - 1].start));
  ok('last word ends near duration', words[3].end <= 8.5, `${words[3].end}`);
  ok('each word has start<end', words.every(w => w.end > w.start));
}

console.log('\n=== 2. Words distributed across segments proportionally ===');
{
  const segs = [
    { start: 0, end: 2 },     // 2s
    { start: 3, end: 4 },     // 1s  (a 1s pause between)
    { start: 6, end: 7 },     // 1s  (a 2s pause between)
  ];
  const tokens = 'aaa bbb ccc ddd eee fff ggg hhh'.split(' ');
  const words = buildWordTimings(tokens.join(' '), segs, 8);
  ok('all words returned', words.length === tokens.length, `${words.length}/${tokens.length}`);
  ok('words monotonic', words.every((w, i) => i === 0 || w.start >= words[i - 1].start));
  ok('words land inside their segment', words.every(w => {
    const seg = segs.find(s => w.start >= s.start - 0.01 && w.start <= s.end + 0.01);
    return !!seg;
  }), JSON.stringify(words.map(w => [w.word, w.start.toFixed(2)])));
}

console.log('\n=== 3. Pause gaps are preserved in the timeline ===');
{
  const segs = [
    { start: 0, end: 1 },
    { start: 2.5, end: 3.5 },   // 1.5s gap -> should be a power pause
  ];
  const words = buildWordTimings('alpha beta gamma delta', segs, 4);
  const gap = words[2].start - words[1].end;
  ok('gap between segments is ~1.5s', Math.abs(gap - 1.5) < 0.6, `gap=${gap.toFixed(2)}`);
  ok('gap exceeds 700ms (power pause)', gap > 0.7, `gap=${gap.toFixed(2)}`);
}

console.log('\n=== 4. Edge cases ===');
{
  ok('empty transcript -> []', buildWordTimings('', [], 5).length === 0);
  ok('whitespace only -> []', buildWordTimings('   ', [], 5).length === 0);
  const one = buildWordTimings('hello', [{ start: 0, end: 1 }], 1);
  ok('single word works', one.length === 1 && one[0].word === 'hello');
  const many = buildWordTimings('a b c d e f g h i j', [{ start: 0, end: 1 }], 1);
  ok('more words than fit still returns all', many.length === 10, `${many.length}`);
  ok('all words monotonic even when overfull', many.every((w, i) => i === 0 || w.start >= many[i - 1].start));
  const zero = buildWordTimings('a b', [{ start: 0, end: 0 }], 1);
  ok('zero-length segment does not divide by zero', zero.length === 2, `${zero.length}`);
  // NB: every(Number.isFinite) passes the index as a second argument, which
  // Number.isFinite rejects - use an explicit arrow instead.
  ok('no NaN anywhere', zero.every(w => Number.isFinite(w.start) && Number.isFinite(w.end)),
     JSON.stringify(zero));
}

console.log('\n=== 5. Rounding does not lose words ===');
{
  const segs = [{ start: 0, end: 3 }, { start: 3.1, end: 3.2 }];
  const tokens = Array.from({ length: 17 }, (_, i) => `w${i}`);
  const words = buildWordTimings(tokens.join(' '), segs, 4);
  ok('no words lost across uneven segments', words.length === 17, `${words.length}/17`);
  ok('word order preserved', words.map(w => w.word).join(',') === tokens.join(','));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL WORD-TIMING TESTS PASSED');
