/**
 * ORATOR Speech Metrics Engine
 *
 * Computes objective, coachable metrics from a recorded session:
 *  - pace (words per minute)
 *  - filler density (um, uh, like, you know, actually, basically, sort of, kind of)
 *  - pause structure (mean length, count, longest pause, "power pauses")
 *  - volume stability (RMS energy variance -> "screaming" / "drifting")
 *  - pitch range (via autocorrelation on a coarse fundamental estimate)
 *  - articulation proxy (via spectral rolloff / zero-crossing rate energy)
 *  - vocabulary richness (type-token ratio + hapax legomena)
 *  - sentence length variance (monotony detection)
 *  - structure signals (question rate, imperative rate, "so what" density)
 *
 * Input is raw PCM audio (mono 16kHz) captured client-side plus the
 * transcript with word-level timings.
 */

import { fft, ifft, nextPow2 } from './fft.js';

const FILLERS = [
  'um', 'uh', 'erm', 'ah', 'eh',
  'like', 'you know', 'i mean', 'sort of', 'kind of',
  'basically', 'actually', 'literally', 'right?', 'right',
  'okay', 'so yeah', 'anyway', 'whatever',
];

/** Remove filler phrases from text, returning cleaned text + counts. */
export function extractFillers(text) {
  const lower = ' ' + text.toLowerCase().replace(/[—–]/g, ' ').replace(/[^a-z'?\s]/g, ' ') + ' ';
  const counts = {};
  let cleaned = lower;

  // Multi-word fillers first (longest match wins)
  const multi = FILLERS.filter(f => f.includes(' ')).sort((a, b) => b.length - a.length);
  for (const f of multi) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const m = cleaned.match(re);
    if (m) {
      counts[f] = (counts[f] || 0) + m.length;
      cleaned = cleaned.replace(re, ' ');
    }
  }
  for (const f of FILLERS.filter(f => !f.includes(' '))) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const m = cleaned.match(re);
    if (m) {
      counts[f] = (counts[f] || 0) + m.length;
      cleaned = cleaned.replace(re, ' ');
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, cleaned: cleaned.replace(/\s+/g, ' ').trim() };
}

/**
 * Compute pause structure from word timings.
 * @param {Array<{word:string,start:number,end:number}>} words
 */
export function analyzePauses(words) {
  if (!words || words.length < 2) {
    return { count: 0, meanMs: 0, medianMs: 0, longestMs: 0, powerPauses: 0, silenceRatio: 0, timeline: [] };
  }
  const gaps = [];
  for (let i = 1; i < words.length; i++) {
    const gap = (words[i].start - words[i - 1].end) * 1000;
    if (gap > 120) gaps.push({ index: i, ms: gap, before: words[i - 1].word, after: words[i].word });
  }
  const ms = gaps.map(g => g.ms).sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / (ms.length || 1);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : 0;

  const totalSpan = (words[words.length - 1].end - words[0].start) * 1000;
  const silenceTotal = ms.reduce((a, b) => a + b, 0);

  return {
    count: gaps.length,
    meanMs: Math.round(mean),
    medianMs: Math.round(median),
    longestMs: Math.round(ms[ms.length - 1] || 0),
    // "power pauses" = long enough to be a deliberate rhetorical device
    powerPauses: gaps.filter(g => g.ms >= 700).length,
    silenceRatio: totalSpan > 0 ? +(silenceTotal / totalSpan).toFixed(3) : 0,
    timeline: gaps.map(g => ({ ms: Math.round(g.ms), before: g.before, after: g.after })),
  };
}

/** Filler rate per 100 words, and density. */
export function fillerMetrics(text, wordCount) {
  const { counts, total } = extractFillers(text);
  const per100 = wordCount > 0 ? +((total / wordCount) * 100).toFixed(2) : 0;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([term, n]) => ({ term, count: n }));
  return { total, per100, top, counts };
}

/**
 * RMS energy envelope + volume stability from Int16 PCM.
 */
export function analyzeVolume(pcm, sampleRate = 16000, frameMs = 50) {
  if (!pcm || pcm.length < sampleRate / 10) {
    return { meanDb: -Infinity, peakDb: -Infinity, dynamicRangeDb: 0, clipped: false, silentRatio: 0, envelope: [] };
  }
  const frameLen = Math.floor((sampleRate * frameMs) / 1000);
  const frames = Math.floor(pcm.length / frameLen);
  const envelope = [];

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const off = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const s = pcm[off + i] / 32768;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / frameLen);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    envelope.push(db);
  }

  // Trim silence for stats
  const voiced = envelope.filter(d => d > -55);
  if (!voiced.length) {
    return { meanDb: -Infinity, peakDb: -Infinity, dynamicRangeDb: 0, clipped: false, silentRatio: 1, envelope };
  }

  const sorted = [...voiced].sort((a, b) => a - b);
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  // clipping: fraction of samples at/near full scale
  let clipped = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) >= 32000) clipped++;
  }

  return {
    meanDb: +mean.toFixed(1),
    peakDb: +sorted[sorted.length - 1].toFixed(1),
    p10Db: +p10.toFixed(1),
    p95Db: +p95.toFixed(1),
    dynamicRangeDb: +(p95 - p10).toFixed(1),
    clipped: +(clipped / pcm.length).toFixed(4),
    silentRatio: +(1 - voiced.length / envelope.length).toFixed(3),
    envelope,
  };
}

/**
 * Fundamental frequency estimate via the YIN algorithm (de Cheveigne & Kawahara 2002).
 *
 * YIN is used instead of plain autocorrelation because autocorrelation has a
 * well-known octave-error failure: for a 120 Hz voice the correlation envelope
 * peaks just as strongly at 240 Hz, and naive peak-picking reports the pitch
 * an octave too low (or too high, depending on the tie-break).
 *
 * YIN fixes this with a cumulative mean normalized difference function and an
 * absolute threshold: it walks upward from the shortest lag and takes the FIRST
 * lag whose normalized difference drops below the threshold. Because the true
 * period is always the earliest such dip, a genuine harmonic peak at 2T can
 * never win over it.
 *
 * The difference function is computed with an FFT-based autocorrelation
 * (O(n log n)) rather than the naive O(n^2) form.
 *
 * Returns median f0 (Hz), range in semitones, and monotonicity.
 */
export function analyzePitch(pcm, sampleRate = 16000) {
  const W = 1024;              // analysis window
  const HOP = 512;
  const MIN_F = 65, MAX_F = 400;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_F));
  const maxLag = Math.min(Math.floor(W / 2), Math.floor(sampleRate / MIN_F));
  const THRESHOLD = 0.15;     // YIN absolute threshold

  const f0s = [];
  const re = new Float64Array(W * 2);
  const im = new Float64Array(W * 2);

  for (let off = 0; off + W + maxLag < pcm.length; off += HOP) {
    let energy = 0;
    for (let i = 0; i < W; i++) {
      const s = pcm[off + i] / 32768;
      energy += s * s;
    }
    if (Math.sqrt(energy / W) < 0.01) continue; // silence / noise floor

    // Hann-windowed frame
    re.fill(0); im.fill(0);
    for (let i = 0; i < W; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (W - 1));
      re[i] = (pcm[off + i] / 32768) * w;
    }

    fft(re, im);
    for (let i = 0; i < re.length; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    ifft(re, im);
    // re[tau] is now the autocorrelation r(tau) of the windowed frame

    // YIN difference function:
    //   d(tau) = sum_j (x[j] - x[j+tau])^2
    //          = power(0) + power(tau) - 2*r(tau)
    // power(tau) is the running energy of the shifted window, computed directly.
    const diff = new Float64Array(maxLag + 1);
    let shiftedPower = 0;
    for (let tau = 0; tau <= maxLag; tau++) {
      // power of x[tau .. tau+W-1]
      let p = 0;
      for (let j = 0; j < W; j++) {
        const s = pcm[off + tau + j] / 32768;
        p += s * s;
      }
      diff[tau] = p + re[0] - 2 * re[tau];
      if (diff[tau] < 0) diff[tau] = 0;
    }

    // cumulative mean normalized difference
    const cmnd = new Float64Array(maxLag + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      running += diff[tau];
      cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
    }

    // Absolute-threshold step: FIRST dip below threshold wins (kills octave errors)
    let bestTau = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < THRESHOLD) {
        while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
        bestTau = tau;
        break;
      }
    }
    if (bestTau < 0) {
      // no dip below threshold: fall back to the global minimum
      let minV = Infinity;
      for (let tau = minLag; tau <= maxLag; tau++) {
        if (cmnd[tau] < minV) { minV = cmnd[tau]; bestTau = tau; }
      }
    }
    if (bestTau <= 0) continue;

    // parabolic interpolation around the chosen lag
    const y0 = cmnd[bestTau - 1] ?? cmnd[bestTau];
    const y1 = cmnd[bestTau];
    const y2 = cmnd[bestTau + 1] ?? cmnd[bestTau];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const refined = bestTau + (Math.abs(shift) < 1 ? shift : 0);
    if (refined > 0) f0s.push(sampleRate / refined);
  }

  if (f0s.length < 5) {
    return { medianF0: 0, minF0: 0, maxF0: 0, rangeSemitones: 0, voicedFrames: f0s.length, monotonicity: 0 };
  }
  const sorted = [...f0s].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[Math.floor(sorted.length * 0.05)];
  const max = sorted[Math.floor(sorted.length * 0.95)];
  const semitones = 12 * Math.log2(max / Math.max(min, 1));

  // monotonicity: how often consecutive f0 deltas keep the same sign.
  // A perfectly steady tone has no measurable movement at all; we report 1.0
  // ("no change of direction") rather than 0, because 0 would read as
  // "actively drifting" and would wrongly be credited as melodic movement.
  let same = 0, total = 0;
  for (let i = 1; i < f0s.length; i++) {
    const d = f0s[i] - f0s[i - 1];
    if (Math.abs(d) < 2) continue;
    total++;
    if (i > 1 && Math.sign(d) === Math.sign(f0s[i - 1] - f0s[i - 2])) same++;
  }

  return {
    medianF0: Math.round(median),
    minF0: Math.round(min),
    maxF0: Math.round(max),
    rangeSemitones: +semitones.toFixed(1),
    voicedFrames: f0s.length,
    monotonicity: total ? +(same / total).toFixed(3) : 1,
    // Fraction of frames that moved at all - a direct measure of how much
    // melodic movement the delivery actually contains.
    movementRatio: f0s.length > 1 ? +(total / (f0s.length - 1)).toFixed(3) : 0,
  };
}

/**
 * Articulation proxy: spectral energy distribution.
 *
 * Clearer articulation concentrates energy in the high-frequency band
 * (3-8 kHz) where the second and third formants live, and produces more
 * zero-crossings per sample. We report the high-band ratio as the clarity
 * score and spectral flatness (noise-like vs tonal) as a supporting signal.
 */
export function analyzeArticulation(pcm, sampleRate = 16000) {
  if (!pcm || pcm.length < sampleRate / 5) {
    return { clarity: 0, zeroCrossingRate: 0, highBandRatio: 0, flatness: 0 };
  }
  // zero-crossing rate
  let zc = 0;
  for (let i = 1; i < pcm.length; i++) {
    if ((pcm[i] >= 0) !== (pcm[i - 1] >= 0)) zc++;
  }
  const zcr = zc / (pcm.length - 1);

  const FRAME = 1024;
  const NFFT = 2048;
  const HOP = FRAME * 2;
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  let hi = 0, mid = 0, lo = 0, logSum = 0, linSum = 0, bins = 0, frames = 0;

  for (let off = 0; off + FRAME < pcm.length; off += HOP) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = pcm[off + i] / 32768;
      energy += s * s;
    }
    if (Math.sqrt(energy / FRAME) < 0.012) continue;

    re.fill(0); im.fill(0);
    for (let i = 0; i < FRAME; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
      re[i] = (pcm[off + i] / 32768) * w;
    }
    fft(re, im);

    for (let k = 1; k < NFFT / 2; k++) {
      const mag = re[k] * re[k] + im[k] * im[k];
      const freq = (k * sampleRate) / NFFT;
      if (freq >= 3000 && freq <= 8000) hi += mag;
      else if (freq >= 300 && freq < 3000) mid += mag;
      else if (freq < 300) lo += mag;
      if (freq > 100 && freq < 8000) {
        logSum += Math.log(mag + 1e-12);
        linSum += mag;
        bins++;
      }
    }
    frames++;
  }
  if (!frames || bins === 0) {
    return { clarity: 0, zeroCrossingRate: +zcr.toFixed(4), highBandRatio: 0, flatness: 0 };
  }

  const highBandRatio = hi / (hi + mid + lo + 1e-9);
  // spectral flatness: geometric mean / arithmetic mean (0 = tonal, 1 = noise)
  const flatness = Math.exp(logSum / bins) / (linSum / bins + 1e-12);

  return {
    clarity: +(highBandRatio * 100).toFixed(2),
    zeroCrossingRate: +zcr.toFixed(4),
    highBandRatio: +highBandRatio.toFixed(4),
    flatness: +flatness.toFixed(4),
  };
}

/** Lexical richness and sentence stats. */
export function analyzeLanguage(text) {
  const words = (text.match(/[A-Za-z']+/g) || []).map(w => w.toLowerCase());
  const unique = new Set(words);
  const ttr = words.length ? unique.size / words.length : 0;

  // hapax legomena: words appearing exactly once (vocabulary freshness)
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const hapax = Object.values(freq).filter(v => v === 1).length;
  const hapaxRatio = words.length ? hapax / words.length : 0;

  // Long words = lexical sophistication proxy
  const longWords = words.filter(w => w.length >= 8).length;
  const longRatio = words.length ? longWords / words.length : 0;

  // sentence splitting and length variance
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.split(/\s+/).length > 1);
  const sentLens = sentences.map(s => s.split(/\s+/).length);
  const meanSent = sentLens.length ? sentLens.reduce((a, b) => a + b, 0) / sentLens.length : 0;
  const varSent = sentLens.length
    ? sentLens.reduce((a, b) => a + (b - meanSent) ** 2, 0) / sentLens.length
    : 0;

  // structure signals
  const questionCount = (text.match(/\?/g) || []).length;
  const questionRate = sentences.length ? +(questionCount / sentences.length).toFixed(3) : 0;
  const soWhat = (text.match(/\bso (what|why|how)\b/gi) || []).length;
  const because = (text.match(/\bbecause\b/gi) || []).length;
  const contrast = (text.match(/\b(but|however|instead|although|yet)\b/gi) || []).length;

  return {
    wordCount: words.length,
    uniqueWords: unique.size,
    typeTokenRatio: +ttr.toFixed(4),
    hapaxRatio: +hapaxRatio.toFixed(4),
    longWordRatio: +longRatio.toFixed(4),
    sentenceCount: sentences.length,
    meanSentenceLength: +meanSent.toFixed(1),
    sentenceLengthStdDev: +Math.sqrt(varSent).toFixed(2),
    questionRate,
    contrastMarkers: contrast,
    causalMarkers: because,
    soWhatCount: soWhat,
  };
}

/**
 * Full analysis.
 * @param {object} input
 * @param {string} input.transcript
 * @param {Array} [input.words] word-level timings
 * @param {Int16Array|number[]} [input.pcm] mono 16kHz
 * @param {number} [input.sampleRate]
 * @param {number} [input.durationSec]
 */
export function analyzeSpeech({ transcript = '', words = [], pcm = null, sampleRate = 16000, durationSec = 0 }) {
  const lang = analyzeLanguage(transcript);
  const fillers = fillerMetrics(transcript, lang.wordCount);
  const pauses = analyzePauses(words);
  const volume = pcm ? analyzeVolume(pcm, sampleRate) : null;
  const pitch = pcm ? analyzePitch(pcm, sampleRate) : null;
  const articulation = pcm ? analyzeArticulation(pcm, sampleRate) : null;

  const spokenSec = durationSec || (words.length ? words[words.length - 1].end - words[0].start : 0);
  const wpm = spokenSec > 0 ? Math.round((lang.wordCount / spokenSec) * 60) : 0;

  const scores = scoreMetrics({ wpm, fillers, pauses, volume, pitch, articulation, lang });
  return {
    durationSec: +spokenSec.toFixed(1),
    wpm,
    fillers,
    pauses,
    volume,
    pitch,
    articulation,
    language: lang,
    scores,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Score 0-100 per dimension with explicit band thresholds.
 * Every threshold is defensible and coach-facing.
 */
export function scoreMetrics({ wpm, fillers, pauses, volume, pitch, articulation, lang }) {
  const s = {};

  // PACE: ideal band 130-160 wpm for presentation
  if (wpm > 0) {
    if (wpm >= 125 && wpm <= 165) s.pace = 92;
    else if (wpm >= 110 && wpm <= 185) s.pace = 78;
    else if (wpm >= 95 && wpm <= 200) s.pace = 62;
    else s.pace = wpm < 95 ? 38 : 42;
  } else s.pace = 0;

  // CLARITY of language: penalize filler density, reward variety
  if (fillers.per100 <= 1) s.clarity = 95;
  else if (fillers.per100 <= 2.5) s.clarity = 85;
  else if (fillers.per100 <= 4) s.clarity = 70;
  else if (fillers.per100 <= 6) s.clarity = 52;
  else s.clarity = 32;
  if (lang.sentenceLengthStdDev > 0 && lang.sentenceLengthStdDev < 4) s.clarity -= 8; // monotony

  // DELIVERY (volume stability + articulation)
  if (volume && articulation) {
    let d = 70;
    if (volume.dynamicRangeDb >= 8 && volume.dynamicRangeDb <= 18) d += 12;
    else if (volume.dynamicRangeDb >= 5) d += 6;
    else d -= 8;
    if (volume.clipped > 0.005) d -= 15;
    if (volume.silentRatio > 0.45) d -= 12;
    if (articulation.clarity >= 12) d += 12;
    else if (articulation.clarity >= 7) d += 6;
    else d -= 8;
    s.delivery = Math.max(0, Math.min(100, d));
  } else s.delivery = 0;

  // PITCH: range and melodic movement.
  // A wide pitch range combined with a HIGH movement ratio means the speaker
  // is deliberately modulating. A wide range with a LOW movement ratio means
  // the pitch swung once and then locked - which reads as monotone drift.
  if (pitch && pitch.medianF0 > 0) {
    let p = 60;
    if (pitch.rangeSemitones >= 8 && pitch.rangeSemitones <= 18) p += 20;
    else if (pitch.rangeSemitones >= 5) p += 10;
    else p -= 15;

    const movement = pitch.movementRatio ?? 0.3;
    if (movement >= 0.35 && pitch.monotonicity < 0.6) p += 12;   // active, varied melody
    else if (movement < 0.12) p -= 8;                            // almost no pitch movement
    else if (pitch.monotonicity > 0.7) p -= 6;                    // one-directional drift

    if (pitch.medianF0 < 95) p -= 8;
    s.pitch = Math.max(0, Math.min(100, p));
  } else s.pitch = 0;

  // PAUSE CONTROL
  if (pauses.count > 0) {
    let pc = 55;
    if (pauses.powerPauses >= 2) pc += 22;
    else if (pauses.powerPauses === 1) pc += 11;
    if (pauses.silenceRatio >= 0.08 && pauses.silenceRatio <= 0.3) pc += 15;
    else if (pauses.silenceRatio < 0.05) pc -= 8;
    else pc -= 12;
    if (pauses.longestMs > 3500) pc -= 10;
    s.pauseControl = Math.max(0, Math.min(100, pc));
  } else s.pauseControl = 0;

  // VOCABULARY
  if (lang.wordCount > 0) {
    let v = 55;
    if (lang.typeTokenRatio >= 0.45) v += 18;
    else if (lang.typeTokenRatio >= 0.35) v += 10;
    if (lang.hapaxRatio >= 0.35) v += 12;
    else if (lang.hapaxRatio >= 0.25) v += 6;
    if (lang.longWordRatio >= 0.12) v += 10;
    s.vocabulary = Math.max(0, Math.min(100, v));
  } else s.vocabulary = 0;

  // STRUCTURE
  let st = 60;
  if (lang.contrastMarkers >= 2) st += 10;
  if (lang.causalMarkers >= 2) st += 8;
  if (lang.questionRate >= 0.1 && lang.questionRate <= 0.4) st += 10;
  if (lang.soWhatCount >= 1) st += 8;
  s.structure = Math.max(0, Math.min(100, st));

  // COMPOSITE
  const dims = ['pace', 'clarity', 'delivery', 'pitch', 'pauseControl', 'vocabulary', 'structure'];
  const overall = Math.round(dims.reduce((a, k) => a + (s[k] || 0), 0) / dims.length);

  return { overall, ...s };
}

/** Human-readable coaching notes derived from the metrics. */
export function coachNotes(m) {
  const notes = [];
  const sc = m.scores;

  if (m.wpm > 180) notes.push({ dimension: 'Pace', severity: 'high', note: `You are running at ${m.wpm} wpm. Public delivery lands best near 130-160. Slow the opening 20% and add deliberate pauses at your key beats.` });
  else if (m.wpm < 110) notes.push({ dimension: 'Pace', severity: 'medium', note: `At ${m.wpm} wpm you risk reading as tentative or dragging. Bring energy up and connect short sentences with intent.` });
  else notes.push({ dimension: 'Pace', severity: 'info', note: `Pace at ${m.wpm} wpm is in the effective presentation band.` });

  if (m.fillers.per100 > 4) notes.push({ dimension: 'Fillers', severity: 'high', note: `${m.fillers.per100} fillers per 100 words. Top: ${m.fillers.top.map(t => `"${t.term}" x${t.count}`).join(', ')}. Replace each with a one-beat silence - the silence sounds far more composed than the filler.` });
  else if (m.fillers.per100 > 2) notes.push({ dimension: 'Fillers', severity: 'medium', note: `${m.fillers.per100} fillers per 100 words. Close to clean. Your most common is "${m.fillers.top[0]?.term || 'n/a'}" - rehearse replacing that one and the rest usually follows.` });
  else notes.push({ dimension: 'Fillers', severity: 'info', note: `Filler rate is clean at ${m.fillers.per100} per 100 words.` });

  if (m.pauses.powerPauses >= 1) notes.push({ dimension: 'Pause', severity: 'info', note: `${m.pauses.powerPauses} power pause(s) detected (>=700ms). Longest ${m.pauses.longestMs}ms. These are the moments that make a room lean in.` });
  else notes.push({ dimension: 'Pause', severity: 'medium', note: `No power pauses detected. Strategic silence before your key line is the single highest-leverage delivery habit you are missing.` });

  if (m.volume && m.volume.dynamicRangeDb < 5) notes.push({ dimension: 'Volume', severity: 'medium', note: `Flat volume (${m.volume.dynamicRangeDb} dB dynamic range). Push the key sentences up and let the setup sentences settle down - contrast is what carries in a large room.` });
  if (m.volume && m.volume.clipped > 0.005) notes.push({ dimension: 'Volume', severity: 'medium', note: `Audio is clipping (${(m.volume.clipped * 100).toFixed(1)}% of samples at full scale). Pull back ~10% from the mic - clipping reads as harshness, not power.` });

  if (m.pitch && m.pitch.rangeSemitones < 5) notes.push({ dimension: 'Pitch', severity: 'medium', note: `Pitch range is only ${m.pitch.rangeSemitones} semitones. Deliberate pitch movement on emphasis - not volume - is what makes a key sentence land.` });
  else if (m.pitch && (m.pitch.movementRatio ?? 1) < 0.15) notes.push({ dimension: 'Pitch', severity: 'medium', note: `Your pitch barely moves (movement ratio ${m.pitch.movementRatio}). One-sentence paragraphs with a deliberate pitch reset on the key word will fix this pattern quickly.` });
  else if (m.pitch && m.pitch.monotonicity > 0.7) notes.push({ dimension: 'Pitch', severity: 'medium', note: `Your pitch is trending one direction (${m.pitch.monotonicity}). Reset your pitch down at the end of a sentence so the next one has somewhere to go.` });

  if (m.language.typeTokenRatio < 0.35) notes.push({ dimension: 'Vocabulary', severity: 'medium', note: `Repetitive vocabulary (type-token ${m.language.typeTokenRatio}). Swap one word in every third sentence for a more precise alternative - precision reads as authority.` });

  if (m.language.sentenceLengthStdDev < 4 && m.language.sentenceCount > 3) notes.push({ dimension: 'Structure', severity: 'medium', note: `Your sentences are nearly the same length (std dev ${m.language.sentenceLengthStdDev}). Vary deliberately: a short sentence after a long one is a hammer.` });

  return notes;
}
