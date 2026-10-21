/**
 * Sanity-check the trimmed concept details: no dangling references, no
 * truncated sentences, no orphaned markdown, no placeholder text.
 */
import { listModuleIds, loadModuleSafe } from '../curriculum.js';

let issues = 0;
let checks = 0;

const ok = (name, cond, detail = '') => {
  checks++;
  if (!cond) { issues++; console.log(`  FAIL  ${name}  ${detail}`); }
};

for (const id of listModuleIds()) {
  const m = loadModuleSafe(id);
  if (!m) continue;
  for (const c of m.concepts) {
    const d = c.detail || '';
    const words = d.trim().split(/\s+/).filter(Boolean);
    const tag = `${id}/${c.id}`;

    // Ends as a complete sentence. A trailing markdown close ("**") is not
    // terminal punctuation, so strip it before testing.
    const bare = d.trim().replace(/\*\*$/, '');
    ok(`${tag} ends with terminal punctuation`, /[.!?]["')\]]?$/.test(bare), JSON.stringify(d.slice(-60)));
    // No double spaces or trailing whitespace.
    ok(`${tag} no trailing whitespace`, !/\s$/.test(d), JSON.stringify(d.slice(-40)));
    ok(`${tag} no double spaces`, !/  /.test(d));
    // No orphaned markdown from the trim.
    ok(`${tag} no unbalanced bold`, (d.match(/\*\*/g) || []).length % 2 === 0, d.slice(-80));
    ok(`${tag} no dangling bullet`, !/^\s*[-*+]\s*$/m.test(d));
    ok(`${tag} no orphan heading`, !/^#{1,6}\s*$/m.test(d));
    // No obvious placeholder or truncation markers.
    ok(`${tag} no ellipsis truncation`, !/\.\.\.\s*$/.test(d.trim()), d.slice(-50));
    ok(`${tag} no TODO/TBD markers`, !/\b(TODO|TBD|FIXME|XXX)\b/.test(d));
    // Not overly short after trimming.
    ok(`${tag} still substantive`, words.length >= 250, `${words.length} words`);
    // Sentence count is still coherent.
    const sentences = d.split(/[.!?]+/).filter(s => s.trim().length > 20);
    ok(`${tag} has multiple sentences`, sentences.length >= 4, `${sentences.length}`);
    // No sentence starts with a lowercase letter right after a period
    // (a sign of a mid-sentence cut). Ellipses and abbreviations are excluded -
    // "once upon a time... every day..." is legitimate prose, not a cut.
    const badStart = d.replace(/\.\.\./g, '').match(/\.\s+[a-z]/);
    ok(`${tag} no mid-sentence cut`, !badStart, badStart ? JSON.stringify(d.slice(badStart.index, badStart.index + 60)) : '');
  }
}

console.log(`\n${'='.repeat(50)}`);
if (issues) {
  console.log(`${issues} PROSE ISSUES across ${checks} checks`);
  process.exit(1);
}
console.log(`ALL ${checks} PROSE CHECKS PASSED`);
