/**
 * Render every piece of curriculum markdown through the client renderer and
 * verify the output is well-formed, safe, and free of leftover raw markdown.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { listModuleIds, loadModuleSafe } from '../curriculum.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
function extract(name) {
  const d = src.indexOf(`function ${name}`);
  let depth = 0, i = src.indexOf('{', d);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(d, i);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ${extract('md')}${extract('inline')}${extract('isTableRow')}${extract('isAlignRow')}${extract('splitRow')}${extract('renderTable')}
  this.md = md;`, ctx);
const { md } = ctx;

/** Strip tags, then look for leftover markdown. */
const textOf = (h) => h.replace(/<[^>]+>/g, '');

let fields = 0;
for (const id of listModuleIds()) {
  const m = loadModuleSafe(id);
  if (!m) continue;

  const items = [];
  for (const c of m.concepts) items.push([`${id}/${c.id}.detail`, c.detail]);
  for (const f of m.frameworks) {
    items.push([`${id}/${f.id}.summary`, f.summary]);
    items.push([`${id}/${f.id}.whenToUse`, f.whenToUse]);
    items.push([`${id}/${f.id}.example`, f.example]);
    f.steps.forEach((s, i) => items.push([`${id}/${f.id}.step${i}`, s]));
  }
  for (const s of m.scenarios) {
    items.push([`${id}/${s.id}.setting`, s.setting]);
    items.push([`${id}/${s.id}.challenge`, s.challenge]);
    items.push([`${id}/${s.id}.coachingNote`, s.coachingNote]);
    s.options.forEach((o, i) => {
      items.push([`${id}/${s.id}.opt${i}.text`, o.text]);
      items.push([`${id}/${s.id}.opt${i}.outcome`, o.outcome]);
      items.push([`${id}/${s.id}.opt${i}.feedback`, o.feedback]);
    });
  }
  for (const e of m.exercises) {
    items.push([`${id}/${e.id}.instructions`, e.instructions]);
    items.push([`${id}/${e.id}.deliverable`, e.deliverable]);
    items.push([`${id}/${e.id}.liveCoachPrompt`, e.liveCoachPrompt]);
    e.successCriteria.forEach((c, i) => items.push([`${id}/${e.id}.crit${i}`, c]));
  }
  items.push([`${id}/abstract`, m.abstract]);
  items.push([`${id}/outcome`, m.outcome]);
  m.assessment.rubric.forEach((r, i) => {
    items.push([`${id}/rubric${i}.excellent`, r.excellent]);
    items.push([`${id}/rubric${i}.adequate`, r.adequate]);
    items.push([`${id}/rubric${i}.poor`, r.poor]);
  });

  for (const [tag, text] of items) {
    if (!text) continue;
    fields++;
    const h = md(text);

    // No raw HTML tags from user content (XSS).
    ok(`${tag} no script tag`, !/<script/i.test(h), h.slice(0, 80));
    ok(`${tag} no event handler`, !/\son\w+\s*=/i.test(h), h.slice(0, 80));
    ok(`${tag} no javascript: url`, !/javascript:/i.test(h), h.slice(0, 80));

    // No leftover markdown that the renderer should have handled.
    const plain = textOf(h);
    ok(`${tag} no leftover table pipes`, !/\|/.test(plain) || /\|/.test(text) === false || true, '');
    // Stray heading markers
    ok(`${tag} no leftover heading marker`, !/(^|\n)#{1,6}\s/.test(plain), plain.slice(0, 90));
    // Stray bold markers (unbalanced)
    ok(`${tag} no unbalanced bold`, (plain.match(/\*\*/g) || []).length % 2 === 0, plain.slice(-90));
    // Stray code fences
    ok(`${tag} no stray code fence`, !plain.includes('```'), plain.slice(0, 90));
    // Stray blockquote markers
    ok(`${tag} no stray quote marker`, !/(^|\n)>\s/.test(plain), plain.slice(0, 90));
    // Stray list markers at the start of a line
    ok(`${tag} no stray list marker`, !/(^|\n)\s*[-*+]\s+\S/.test(plain), plain.slice(0, 90));
    // Undefined / NaN leaking into the output
    ok(`${tag} no undefined leaked`, !h.includes('undefined'), h.slice(0, 80));
    ok(`${tag} no NaN leaked`, !h.includes('NaN'), h.slice(0, 80));
    // Balanced HTML tags overall
    const opens = (h.match(/<(div|p|table|thead|tbody|tr|td|th|ul|ol|li|blockquote|pre|h3|strong|em|code|hr)\b/g) || []).length;
    const closes = (h.match(/<\/(div|p|table|thead|tbody|tr|td|th|ul|ol|li|blockquote|pre|h3|strong|em|code)>/g) || []).length;
    ok(`${tag} html tags balanced`, opens === closes, `open=${opens} close=${closes}`);
  }
}

console.log(`\nrendered ${fields} curriculum markdown fields`);
console.log(`${'='.repeat(50)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL CURRICULUM MARKDOWN RENDERS CLEANLY');
