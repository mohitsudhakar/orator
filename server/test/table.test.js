/**
 * Test the GFM table support in the client markdown renderer.
 *
 * The tutor reliably emits tables ("Show me a table comparing..."), and the
 * renderer previously had no table support at all, so tables rendered as raw
 * pipe text.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0, checks = 0;
function ok(name, cond, detail = '') {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

function extract(name) {
  const declIdx = src.indexOf(`function ${name}`);
  if (declIdx >= 0) {
    const start = declIdx;
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
  }
  const arrowIdx = src.indexOf(`const ${name} =`);
  if (arrowIdx >= 0) {
    const start = arrowIdx;
    let depth = 0, i = src.indexOf('(', start);
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i) + ';';
  }
  throw new Error(`${name} not found`);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ${extract('md')}
  ${extract('inline')}
  ${extract('isTableRow')}
  ${extract('isAlignRow')}
  ${extract('splitRow')}
  ${extract('renderTable')}
  this.md = md; this.isTableRow = isTableRow; this.isAlignRow = isAlignRow; this.splitRow = splitRow;
`, ctx);
const { md, isTableRow, isAlignRow, splitRow } = ctx;

console.log('\n=== 1. Table detection ===');
{
  ok('a row is a table row', isTableRow('| a | b |'));
  ok('a single pipe is not', !isTableRow('| a'));
  ok('plain text is not', !isTableRow('just text'));
  ok('text with a mid pipe is not', !isTableRow('a | b'));
  ok('align row detected', isAlignRow('| :--- | :---: | ---: |'));
  ok('align row plain dashes', isAlignRow('| --- | --- |'));
  ok('non-align row rejected', !isAlignRow('| a | b |'));
  ok('a header row is not an align row', !isAlignRow('| Archetype | When |'));
}

console.log('\n=== 2. Cell splitting ===');
{
  const cells = splitRow('| Archetype | When to use | Example |');
  ok('three cells', cells.length === 3, JSON.stringify(cells));
  ok('no stray pipes', cells.every(c => !c.includes('|')), JSON.stringify(cells));
  ok('cells trimmed', cells[0] === 'Archetype', JSON.stringify(cells));
  const esc = splitRow('| a \\| b | c |');
  ok('escaped pipe stays in the cell', esc[0] === 'a | b', JSON.stringify(esc));
  ok('escaped pipe does not split the row', esc.length === 2, JSON.stringify(esc));
}

console.log('\n=== 3. A simple table renders ===');
{
  const h = md('| Archetype | When to use |\n| :--- | :--- |\n| Hard Metric | Boardrooms |\n| Story | All-hands |');
  ok('table element', h.includes('<table'), h);
  ok('thead present', h.includes('<thead>'), h);
  ok('tbody present', h.includes('<tbody>'), h);
  ok('two body rows', (h.match(/<tr>/g) || []).length === 3, h); // 1 header + 2 body
  ok('header cell rendered', h.includes('Archetype'), h);
  ok('body cell rendered', h.includes('Boardrooms'), h);
  ok('no raw pipes left', !h.includes('|'), h);
  ok('wrapped for horizontal scroll', h.includes('table-wrap'), h);
}

console.log('\n=== 4. Alignment is honoured ===');
{
  const h = md('| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |');
  ok('left aligned', h.includes('text-align:left'), h);
  ok('centre aligned', h.includes('text-align:center'), h);
  ok('right aligned', h.includes('text-align:right'), h);
  ok('align row not rendered as content', !h.includes(':---'), h);
}

console.log('\n=== 5. Inline formatting inside cells ===');
{
  const h = md('| Register | Notes |\n| :--- | :--- |\n| **Modal** | `130-200Hz` |');
  ok('bold inside a cell', h.includes('<strong>Modal</strong>'), h);
  ok('code inside a cell', h.includes('<code>130-200Hz</code>'), h);
}

console.log('\n=== 6. Ragged rows are padded ===');
{
  const h = md('| A | B | C |\n| :--- | :--- | :--- |\n| 1 | 2 |\n| 1 | 2 | 3 | 4 |');
  const rows = h.match(/<tr>/g) || [];
  ok('three rows', rows.length === 3, h);
  const body = h.split('<tbody>')[1] || '';
  const firstCells = (body.split('</tr>')[0].match(/<td/g) || []).length;
  const secondCells = (body.split('</tr>')[1].match(/<td/g) || []).length;
  ok('short row padded to 3 cells', firstCells === 3, `${firstCells}`);
  ok('long row trimmed to 3 cells', secondCells === 3, `${secondCells}`);
}

console.log('\n=== 7. Tables mixed with other blocks ===');
{
  const doc = `Here is the comparison.

## The Four Registers

| Register | Sound |
| :--- | :--- |
| **Modal** | full |

> That is the one to aim for.

**Do this next:** record it.`;
  const h = md(doc);
  ok('table rendered', h.includes('<table'), h);
  ok('heading rendered', h.includes('<h3>The Four Registers</h3>'), h);
  ok('paragraph rendered', h.includes('<p>Here is the comparison.</p>'), h);
  ok('blockquote rendered', h.includes('<blockquote>'), h);
  // "**Do this next:** record it." is bold followed by text, so it is a
  // paragraph with bold, NOT a heading (a heading is bold ALONE on the line).
  ok('bold line with trailing text stays a paragraph',
    h.includes('<p><strong>Do this next:</strong> record it.</p>'), h);
  ok('no raw pipes', !h.includes('|'), h);
}

console.log('\n=== 8. Text that merely contains pipes is not a table ===');
{
  const h = md('Use the pipe character | to separate values.');
  ok('not treated as a table', !h.includes('<table'), h);
  const h2 = md('a | b');
  ok('bare pipe line is not a table', !h2.includes('<table'), h2);
}

console.log('\n=== 9. Horizontal rules ===');
{
  ok('dashes -> hr', md('a\n\n---\n\nb').includes('<hr>'), md('a\n\n---\n\nb'));
  ok('asterisks -> hr', md('a\n\n***\n\nb').includes('<hr>'));
  ok('underscores -> hr', md('a\n\n___\n\nb').includes('<hr>'));
  ok('a bullet is not an hr', !md('- item').includes('<hr>'));
  ok('a table separator is not an hr', !md('| :--- | :--- |\n| a | b |').includes('<hr>'));
}

console.log('\n=== 10. XSS safety inside tables ===');
{
  const h = md('| A | B |\n| :--- | :--- |\n| <script>alert(1)</script> | <img src=x onerror=alert(1)> |');
  ok('script tag escaped', !h.includes('<script>'), h);
  ok('img tag escaped', !h.includes('<img'), h);
  ok('escaped form present', h.includes('&lt;script&gt;'), h);
}

console.log('\n=== 11. Empty and edge tables ===');
{
  const h = md('| A | B |\n| :--- | :--- |');
  ok('header-only table renders', h.includes('<thead>'), h);
  ok('header-only table has no tbody', !h.includes('<tbody>'), h);
  ok('no undefined leaked', !h.includes('undefined'), h);
  const h2 = md('| A |\n| :--- |\n| 1 |');
  ok('single column table', h2.includes('<th'), h2);
  ok('no NaN leaked', !h2.includes('NaN'), h2);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL TABLE TESTS PASSED');
