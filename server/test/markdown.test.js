/**
 * Test the client-side markdown renderer.
 *
 * The previous implementation was a pile of regex substitutions that lost
 * paragraph breaks ("thirty.\n\nHere" rendered as "thirty.Here"). These
 * checks pin the block-level behaviour.
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
  // Handles both `function name(...)` and `const name = (...) =>` forms.
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
    // Arrow bodies end at the matching close of the statement.
    let depth = 0, i = src.indexOf('(', start);
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        depth--;
        if (depth === 0) { i++; break; }
      }
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
  this.md = md; this.inline = inline;
`, ctx);
const { md } = ctx;

console.log('\n=== 1. Paragraph breaks are preserved ===');
{
  const h = md('First sentence ends here.\n\nSecond sentence starts here.');
  ok('two separate <p> elements', (h.match(/<p>/g) || []).length === 2, h);
  // The two sentences must live in different paragraphs, not be glued together.
  ok('paragraphs are not glued together', !h.includes('here.Second'), h);
  ok('text between paragraphs intact', h.includes('First sentence ends here.') && h.includes('Second sentence starts here.'), h);
}

console.log('\n=== 2. Single newline inside a paragraph -> <br> ===');
{
  const h = md('Line one\nLine two');
  ok('one paragraph', (h.match(/<p>/g) || []).length === 1, h);
  ok('contains <br>', h.includes('<br>'), h);
}

console.log('\n=== 3. Headings ===');
{
  const h = md('### The Decision Anchor');
  ok('h3 rendered', h.includes('<h3>') && h.includes('The Decision Anchor'), h);
  const h2 = md('## Second level');
  ok('h2 -> h3', h2.includes('<h3>Second level</h3>'), h2);
  const h3 = md('# Top level');
  ok('h1 -> h3', h3.includes('<h3>Top level</h3>'), h3);
}

console.log('\n=== 4. Lists ===');
{
  const ul = md('- First item\n- Second item\n- Third item');
  ok('ul rendered', ul.includes('<ul>') && ul.includes('</ul>'), ul);
  ok('three li', (ul.match(/<li>/g) || []).length === 3, ul);
  ok('list is not wrapped in a p', !ul.includes('<p><ul>'), ul);

  const ol = md('1. Step one\n2. Step two');
  ok('ol rendered', ol.includes('<ol>') && ol.includes('</ol>'), ol);
  ok('two li', (ol.match(/<li>/g) || []).length === 2, ol);
}

console.log('\n=== 5. Blockquote ===');
{
  const b = md('> The one line they remember.');
  ok('blockquote rendered', b.includes('<blockquote>'), b);
  ok('quote text inside', b.includes('The one line they remember.'), b);
}

console.log('\n=== 6. Inline formatting ===');
{
  const h = md('Use **Control** and the *Audience Contract* plus `code`.');
  ok('bold', h.includes('<strong>Control</strong>'), h);
  ok('italic', h.includes('<em>Audience Contract</em>'), h);
  ok('inline code', h.includes('<code>code</code>'), h);
}

console.log('\n=== 7. Escaping (XSS) ===');
{
  const h = md('Beware <script>alert(1)</script> here.');
  ok('script tag escaped', !h.includes('<script>'), h);
  ok('escaped form present', h.includes('&lt;script&gt;'), h);
  const h2 = md('Text with "quotes" and \'apostrophes\'');
  ok('quotes escaped', h2.includes('&quot;') && h2.includes('&#39;'), h2);
}

console.log('\n=== 8. Fenced code ===');
{
  const h = md('Here:\n\n```js\nconst x = 1;\n```');
  ok('pre rendered', h.includes('<pre>'), h);
  ok('code content present', h.includes('const x = 1;'), h);
  ok('code is escaped', !h.includes('<code>const'), h);
}

console.log('\n=== 9. Mixed document (the real tutor shape) ===');
{
  const doc = `Board members check email because your opening says nothing.

**1. The Pre-Verbal Pause (Control):**

- Plant both feet beneath your hips.
- Drop your shoulders, exhale completely.
- Sweep the room silently for three full seconds.

**2. The Decision Anchor:**

State the stakes: "We are losing 14% margin."

> They are not waiting for your agenda. They are waiting for a decision.

**Do this next:** Record the first 20 seconds.`;
  const h = md(doc);
  ok('multiple paragraphs', (h.match(/<p>/g) || []).length >= 1, h);
  ok('two bold sub-headings became h3', (h.match(/<h3>/g) || []).length === 2, h);
  ok('one unordered list', (h.match(/<ul>/g) || []).length === 1, h);
  ok('blockquote present', h.includes('<blockquote>'), h);
  ok('Do this next is bold', h.includes('<strong>Do this next:</strong>'), h);
  ok('no raw markdown left', !/\*\*/.test(h.replace(/<[^>]+>/g, '')), h);
  ok('no doubled periods', !h.includes('..'), h);
}

console.log('\n=== 10. Edge cases ===');
{
  ok('empty string', md('') === '');
  ok('whitespace only', md('   \n  ') === '');
  ok('null-safe', md(null) === '');
  ok('single word', md('Hello').includes('Hello'));
  ok('no throw on weird input', (() => { try { md('*&#*&*&#'); return true; } catch { return false; } })());
}

console.log('\n=== 11. Headings with NO blank line before them ===');
{
  // This is the shape the model actually produces: a heading immediately
  // after a paragraph line. A blank-line splitter misses these entirely.
  const doc = `Kill the throat-clearing. Their phones come out.
### The Opening Formula
Tension (The Stake): State the variance immediately.
- Plant both feet beneath your hips.
- Sweep the room for three seconds.
Downward Inflection: Drop your pitch at the end.
> They are not waiting for your agenda.
**Do this next:** Record the opening.`;
  const h = md(doc);
  ok('heading recognised without a blank line', h.includes('<h3>The Opening Formula</h3>'), h);
  ok('no literal ### in output', !h.includes('###'), h);
  ok('bullet list recognised', h.includes('<ul>') && h.includes('<li>Plant both feet'), h);
  ok('blockquote recognised', h.includes('<blockquote>'), h);
  ok('bold inline works', h.includes('<strong>Do this next:</strong>'), h);
  ok('heading is its own block', h.indexOf('<h3>') < h.indexOf('<ul>'), h);
}

console.log('\n=== 12. Single-line bold acts as a sub-heading ===');
{
  const h = md('**The Physical Mechanics of the Open**');
  ok('becomes a heading', h.includes('<h3>'), h);
  ok('not left as a paragraph', !h.includes('<p>'), h);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL MARKDOWN TESTS PASSED');
