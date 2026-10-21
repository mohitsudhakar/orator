/**
 * Metrics engine test harness.
 * Synthesizes PCM with KNOWN properties, then asserts the engine measures them.
 */
import {
  analyzeSpeech, analyzeVolume, analyzePitch, analyzeLanguage,
  extractFillers, analyzePauses, scoreMetrics, coachNotes,
} from '../metrics.js';

const SR = 16000;
let failures = 0;
let checks = 0;

function ok(name, cond, detail = '') {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

/**
 * Synthesize a voiced signal.
 * The fundamental and its harmonics MUST share one accumulated phase - if each
 * harmonic is computed as sin(2*pi*f*h*t) independently, the waveform is not a
 * real voice-like signal and pitch detection results are meaningless.
 */
function synth({ durSec = 5, f0 = 120, amp = 0.3, gapAt = null, gapLenSec = 0, drift = 0, vib = 6, vibHz = 4 }) {
  const n = Math.floor(SR * durSec);
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + drift * t + vib * Math.sin(2 * Math.PI * vibHz * t);
    phase += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(h * phase);
    let a = amp;
    if (gapAt !== null && t >= gapAt && t < gapAt + gapLenSec) a = 0;
    pcm[i] = Math.round((s * a * 0.35) * 32767);
  }
  return pcm;
}

console.log('\n=== 1. Filler extraction ===');
{
  const t = "So um, like, I basically think that you know, we should, uh, actually do it. So yeah.";
  const r = extractFillers(t);
  ok('detects um', r.counts['um'] === 1, JSON.stringify(r.counts));
  ok('detects like', r.counts['like'] === 1, JSON.stringify(r.counts));
  ok('detects you know (multiword)', r.counts['you know'] === 1, JSON.stringify(r.counts));
  ok('total > 4', r.total >= 4, `total=${r.total}`);
  ok('cleaned text loses fillers', !/um|uh|basically/.test(r.cleaned), r.cleaned);
}

console.log('\n=== 2. Pause analysis ===');
{
  const words = [];
  let t = 0;
  const script = [['Hello', 0.4], ['there', 0.4], ['this', 0.4], ['is', 0.4], ['a', 0.4], ['test', 0.4]];
  for (const [w, d] of script) { words.push({ word: w, start: t, end: t + d }); t += d; }
  // insert a 1.2s gap before 'this'
  words[2].start += 0.8; words[2].end += 0.8;
  for (let i = 3; i < words.length; i++) { words[i].start += 0.8; words[i].end += 0.8; }
  // Each word is 0.4s long, so consecutive words are 0.2s apart.
  // 'this' is pushed +0.6s, so the gap before it becomes 0.2 + 0.6 = 0.8s.
  const p = analyzePauses(words);
  ok('finds 1 gap', p.count === 1, `count=${p.count}`);
  ok('gap length ~800ms', Math.abs(p.timeline[0].ms - 800) < 60, `ms=${p.timeline[0].ms}`);
  ok('power pause counted', p.powerPauses === 1, `power=${p.powerPauses}`);
  ok('longest recorded', p.longestMs > 700, `longest=${p.longestMs}`);
}

console.log('\n=== 3. Volume analysis ===');
{
  const loud = synth({ durSec: 2, amp: 0.5 });
  const quiet = synth({ durSec: 2, amp: 0.05 });
  const vL = analyzeVolume(loud, SR);
  const vQ = analyzeVolume(quiet, SR);
  ok('loud meanDb > quiet meanDb', vL.meanDb > vQ.meanDb, `${vL.meanDb} vs ${vQ.meanDb}`);
  ok('loud dynamic range sane', vL.dynamicRangeDb >= 0 && vL.dynamicRangeDb < 25, `${vL.dynamicRangeDb}`);
  ok('quiet detected as lower', vQ.meanDb < -20, `${vQ.meanDb}`);

  // clipping test
  const clipped = new Int16Array(SR).fill(32767);
  const vC = analyzeVolume(clipped, SR);
  ok('clipping detected', vC.clipped > 0.99, `clipped=${vC.clipped}`);
}

console.log('\n=== 4. Pitch analysis (YIN) ===');
{
  for (const f0 of [100, 120, 150, 180, 220]) {
    const p = analyzePitch(synth({ durSec: 2, f0, vib: 0 }), SR);
    ok(`f0~${f0} detected`, Math.abs(p.medianF0 - f0) < 8, `got ${p.medianF0}`);
  }
  const p120 = analyzePitch(synth({ durSec: 2, f0: 120, vib: 0 }), SR);
  const p200 = analyzePitch(synth({ durSec: 2, f0: 200, vib: 0 }), SR);
  ok('higher tone detected higher', p200.medianF0 > p120.medianF0 + 40);

  // monotonic drift => high monotonicity, wide range
  const drift = analyzePitch(synth({ durSec: 3, f0: 120, drift: 40, vib: 0 }), SR);
  const flat = analyzePitch(synth({ durSec: 2, f0: 150, vib: 0 }), SR);
  ok('drift has wide pitch range', drift.rangeSemitones > 8, `range=${drift.rangeSemitones}`);
  ok('flat tone has narrow range', flat.rangeSemitones < 4, `range=${flat.rangeSemitones}`);
  ok('flat tone is monotonic', flat.monotonicity > 0.8, `mono=${flat.monotonicity}`);
}

console.log('\n=== 5. Language analysis ===');
{
  const rich = "We rebuilt the pipeline. Latency fell forty percent. Customers noticed immediately. Revenue followed within a quarter.";
  const poor = "We did the thing. The thing was good. The thing helped us. The thing made money.";
  const lr = analyzeLanguage(rich);
  const lp = analyzeLanguage(poor);
  ok('rich TTR > poor TTR', lr.typeTokenRatio > lp.typeTokenRatio, `${lr.typeTokenRatio} vs ${lp.typeTokenRatio}`);
  ok('rich hapax ratio higher', lr.hapaxRatio > lp.hapaxRatio);
  ok('sentence count', lr.sentenceCount === 4, `${lr.sentenceCount}`);
  ok('contrast markers detected', analyzeLanguage("It is fast, but it is also wrong. However we shipped.").contrastMarkers >= 2);
  ok('causal markers detected', analyzeLanguage("We shipped because the risk was lower.").causalMarkers === 1);
}

console.log('\n=== 6. Full pipeline + scoring ===');
{
  const pcm = synth({ durSec: 6, f0: 130, amp: 0.35 });
  const transcript = "Um, so like, I basically think that we should, you know, ship it, uh, actually. We rebuilt the pipeline because it was slow. But now it is fast. Is that not interesting? It should be.";
  const words = transcript.split(/\s+/).map((w, i) => ({ word: w, start: i * 0.35, end: i * 0.35 + 0.3 }));
  const m = analyzeSpeech({ transcript, words, pcm, sampleRate: SR, durationSec: 6 });
  ok('wpm computed > 0', m.wpm > 0, `wpm=${m.wpm}`);
  ok('fillers found', m.fillers.total >= 5, `${m.fillers.total}`);
  ok('scores object has 7 dims + overall',
    ['overall', 'pace', 'clarity', 'delivery', 'pitch', 'pauseControl', 'vocabulary', 'structure'].every(k => typeof m.scores[k] === 'number'),
    JSON.stringify(m.scores));
  ok('all scores in 0-100', Object.entries(m.scores).every(([, v]) => v >= 0 && v <= 100));
  const notes = coachNotes(m);
  ok('coach notes produced', notes.length >= 3, `${notes.length}`);
  ok('notes have dimension+note', notes.every(n => n.dimension && n.note && n.severity));
}

console.log('\n=== 7. Scoring band behavior ===');
{
  const good = scoreMetrics({
    wpm: 145, fillers: { per100: 0.8 }, pauses: { count: 5, powerPauses: 3, silenceRatio: 0.15, longestMs: 1800 },
    volume: { dynamicRangeDb: 12, clipped: 0, silentRatio: 0.2 },
    pitch: { medianF0: 120, rangeSemitones: 12, monotonicity: 0.4, movementRatio: 0.42 },
    articulation: { clarity: 14 },
    lang: { typeTokenRatio: 0.48, hapaxRatio: 0.38, longWordRatio: 0.14, sentenceLengthStdDev: 6, sentenceCount: 8, questionRate: 0.2, contrastMarkers: 3, causalMarkers: 2, soWhatCount: 1 },
  });
  const bad = scoreMetrics({
    wpm: 220, fillers: { per100: 8 }, pauses: { count: 0, powerPauses: 0, silenceRatio: 0.01, longestMs: 0 },
    volume: { dynamicRangeDb: 1, clipped: 0.02, silentRatio: 0.6 },
    pitch: { medianF0: 90, rangeSemitones: 2, monotonicity: 0.8, movementRatio: 0.03 },
    articulation: { clarity: 2 },
    lang: { typeTokenRatio: 0.22, hapaxRatio: 0.1, longWordRatio: 0.03, sentenceLengthStdDev: 1, sentenceCount: 8, questionRate: 0, contrastMarkers: 0, causalMarkers: 0, soWhatCount: 0 },
  });
  // A pitch with NO movement at all must NOT be credited as melodic variety.
  const dead = scoreMetrics({
    wpm: 145, fillers: { per100: 0.8 }, pauses: { count: 5, powerPauses: 3, silenceRatio: 0.15, longestMs: 1800 },
    volume: { dynamicRangeDb: 12, clipped: 0, silentRatio: 0.2 },
    pitch: { medianF0: 120, rangeSemitones: 12, monotonicity: 1, movementRatio: 0.02 },
    articulation: { clarity: 14 },
    lang: { typeTokenRatio: 0.48, hapaxRatio: 0.38, longWordRatio: 0.14, sentenceLengthStdDev: 6, sentenceCount: 8, questionRate: 0.2, contrastMarkers: 3, causalMarkers: 2, soWhatCount: 1 },
  });
  ok('good scores > bad scores', good.overall > bad.overall, `${good.overall} vs ${bad.overall}`);
  ok('good overall >= 80', good.overall >= 80, `${good.overall}`);
  ok('bad overall <= 45', bad.overall <= 45, `${bad.overall}`);
  ok('good pace high', good.pace >= 90, `${good.pace}`);
  ok('bad pace low', bad.pace <= 50, `${bad.pace}`);
  ok('good clarity > bad clarity', good.clarity > bad.clarity);
  ok('dead-flat pitch scores below varied pitch', dead.pitch < good.pitch, `${dead.pitch} vs ${good.pitch}`);
  ok('dead-flat pitch loses the melodic bonus', dead.overall < good.overall, `${dead.overall} vs ${good.overall}`);
}

console.log('\n=== 8. Edge cases ===');
{
  const m1 = analyzeSpeech({ transcript: '', words: [], pcm: null });
  ok('empty transcript does not throw', typeof m1.scores.overall === 'number');
  ok('empty filler count 0', m1.fillers.total === 0);
  const m2 = analyzeSpeech({ transcript: 'hi', words: [{ word: 'hi', start: 0, end: 0.2 }], pcm: new Int16Array(100) });
  ok('tiny pcm does not throw', typeof m2.scores.overall === 'number');
  const m3 = analyzePauses([]);
  ok('empty pauses safe', m3.count === 0);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL METRICS TESTS PASSED');
