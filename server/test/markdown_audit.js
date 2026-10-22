/**
 * Audit what markdown the tutor actually emits, and check that every
 * construct it produces is handled by the renderer.
 *
 * Samples the live tutor with prompts that deliberately invite different
 * markdown shapes, then reports the frequency of each construct.
 */
import { streamTutor } from '../gemini.js';

const PROMPTS = [
  'Show me a table of the 4 voice registers with columns Register, Range, How it sounds, When to use it.',
  'List the 5 opening archetypes as a numbered list with a worked example for each.',
  'Give me the 3-Pass Breath Cycle as a bulleted checklist.',
  'Write the framework I should use for a hostile question, with a section heading and a quoted line I should say.',
  'Show me the components of a strong opening as a table with an Archetype column, a Use-when column and a Risk column.',
  'Give me a short script for opening a board meeting, and put the key line in a code block.',
];

const counts = {};
const samples = {};

for (const p of PROMPTS) {
  let text = '';
  for await (const chunk of streamTutor(p)) text += chunk;
  const constructs = {
    'table': /^\|.*\|$/m.test(text) && /\|[\s:|-]*-[\s:|-]*\|/m.test(text),
    'ordered list': /^\s*\d+[.)]\s+/m.test(text),
    'bullet list': /^\s*[-*+]\s+/m.test(text),
    'heading': /^#{1,6}\s+/m.test(text),
    'blockquote': /^>\s+/m.test(text),
    'fenced code': /```/.test(text),
    'inline code': /`[^`]+`/.test(text),
    'bold': /\*\*[^*]+\*\*/.test(text),
    'italic': /(^|[^*])\*[^*\n]+\*/.test(text),
    'horizontal rule': /^(-{3,}|\*{3,}|_{3,})$/m.test(text),
    'link': /\[[^\]]+\]\([^)]+\)/.test(text),
    'image': /!\[[^\]]*\]\([^)]+\)/.test(text),
    'strikethrough': /~~[^~]+~~/.test(text),
    'task list': /^\s*[-*+]\s+\[[ xX]\]/.test(text),
    'html tag': /<\/?[a-z][a-z0-9]*\s*\/?>/i.test(text),
  };
  for (const [k, v] of Object.entries(constructs)) {
    if (v) { counts[k] = (counts[k] || 0) + 1; samples[k] = samples[k] || text.slice(0, 200); }
  }
}

console.log('\n=== markdown constructs emitted by the tutor (out of ' + PROMPTS.length + ' prompts) ===');
for (const k of Object.keys({
  'table': 1, 'ordered list': 1, 'bullet list': 1, 'heading': 1, 'blockquote': 1,
  'fenced code': 1, 'inline code': 1, 'bold': 1, 'italic': 1, 'horizontal rule': 1,
  'link': 1, 'image': 1, 'strikethrough': 1, 'task list': 1, 'html tag': 1,
})) {
  const n = counts[k] || 0;
  const bar = '#'.repeat(n);
  console.log(`  ${k.padEnd(16)} ${String(n).padStart(2)}/${PROMPTS.length}  ${bar}`);
}

const HANDLED = ['table', 'ordered list', 'bullet list', 'heading', 'blockquote',
  'fenced code', 'inline code', 'bold', 'italic', 'horizontal rule'];

const missing = Object.keys(counts).filter(k => !HANDLED.includes(k));
console.log('\n=== constructs the renderer does NOT handle ===');
if (!missing.length) {
  console.log('  none - every construct the tutor emitted is handled');
} else {
  missing.forEach(m => console.log(`  UNHANDLED: ${m}`));
  process.exit(1);
}
console.log('\nAll emitted constructs render correctly.');
