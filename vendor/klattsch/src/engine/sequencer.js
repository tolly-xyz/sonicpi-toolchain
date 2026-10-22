// Phoneme-string parser and schedule compiler

import { banks, resolveBank } from './banks/index.js';
import { PARAMS, NASAL_PARAMS, NASAL_DEFAULT } from './synth-core.js';

// (sonicpi-toolchain patch) coarticulation ([CO=x]): formant frequencies move in their own schedule events
const FORMANTS = ['F1', 'F2', 'F3'];
const NON_FORMANTS = PARAMS.filter((k) => !FORMANTS.includes(k));

const PAUSE_MS = { ',': 100, ';': 200, '.': 300 };

// Convert note names like "C4", "C#5", "Db3", "A-1" to Hz.
const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToHz(name) {
  const m = name.match(/^([A-G])([b#]?)(-?\d+)$/);
  if (!m) return null;
  const [, letter, accidental, octaveStr] = m;
  let semi = NOTE_SEMITONES[letter];
  if (accidental === '#') semi += 1;
  else if (accidental === 'b') semi -= 1;
  const octave = parseInt(octaveStr, 10);
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const DEFAULTS = Object.freeze({
  baseF0: 120,
  rate: 110,                  // ms per phoneme
  stressDurationFactor: 1.5,
  stressF0Lift: 8,            // Hz
  stopBurstMs: 25,
  defaultTransitionMs: 35,
  sentenceFinalHoldMs: 0,
  fadeOutMs: 100,
  trailOffMs: 150,
  // (sonicpi-toolchain patch) coarticulation: CV transition (locus -> vowel), VC transition (vowel -> locus),
  // the step onto a locus or an obstruent's own formants, and the most of a vowel the VC transition may take
  coCvMs: 60,
  coVcMs: 50,
  coJumpMs: 3,
  coVcShare: 0.6,
  // (sonicpi-toolchain patch) [NAS=x]: share of a vowel nasalized before a nasal consonant ([NASVC]) and after
  // one ([NASCV]; carryover nasalization is shorter than anticipatory in English, Cohn 1990), and the nasal
  // parameters of a fully nasalized vowel: a parallel nasal formant AN at FNP 250 Hz, the low nasal pole of
  // nasalized vowels (P0: Hawkins & Stevens 1985, Chen 1997), the pairs neutral, the level unchanged (GN 1).
  // AN is set so that the last third of a vowel before a nasal gains what Kokoro's do over its other vowel ends
  // below 300 Hz (+4 dB; above 300 Hz they lose nothing). Klatt's (1980) recipe, a zero raised above the pole
  // (FNZ ~450), took 10 dB off everything above it and made the vowels less Kokoro-like at every strength tried
  // (voicelab fidelity). (Kokoro's vowels are quieter at their ends before nasals, but as much before any consonant.)
  nasalVC: 0.8,
  nasalCV: 0.5,
  nasalized: Object.freeze({ FNP: 250, BNP: 100, FNZ: 250, BNZ: 100, AN: 0.4 }),
});
const NASAL_FREQ = /^(F|B)N[PZ]2?$/;   // nasal pole/zero frequencies and bandwidths: they follow the formant scale

const HOMOGLYPH_MAP = {
  // Greek uppercase that look like Latin uppercase
  'Α':'A', 'Β':'B', 'Ε':'E', 'Η':'H', 'Ι':'I', 'Κ':'K',
  'Μ':'M', 'Ν':'N', 'Ο':'O', 'Ρ':'P', 'Τ':'T', 'Υ':'Y', 'Ζ':'Z',
  // Cyrillic uppercase that look like Latin uppercase
  'А':'A', 'В':'B', 'С':'C', 'Е':'E', 'Н':'H', 'К':'K',
  'М':'M', 'О':'O', 'Р':'P', 'Т':'T',
  // Cyrillic lowercase
  'а':'a', 'с':'c', 'е':'e', 'о':'o', 'р':'p',
};
const HOMOGLYPH_RE = new RegExp('[' + Object.keys(HOMOGLYPH_MAP).join('') + ']', 'g');
const ZERO_WIDTH_RE = new RegExp(
  '[' + [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF].map(c => String.fromCharCode(c)).join('') + ']',
  'g',
);

function normalize(input) {
  return input
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(HOMOGLYPH_RE, ch => HOMOGLYPH_MAP[ch] ?? ch);
}

function classifyPart(part) {
  if (part === '(') return { type: 'syllable_open' };
  if (part === ')') return { type: 'syllable_close' };
  if (part in PAUSE_MS) return { type: 'pause', ms: PAUSE_MS[part] };
  if (part === '!' || part === "'") return { type: 'stress_mark' };

  const bankSwitch = part.match(/^\[bank=([A-Za-z0-9_.\-]+)\]$/);
  if (bankSwitch) return { type: 'bank_switch', name: bankSwitch[1] };
  if (part === '[bank]') return { type: 'bank_reset' };

  const engineSwitch = part.match(/^\[engine=([A-Za-z0-9_.\-]+)\]$/);
  if (engineSwitch) return { type: 'engine_switch', name: engineSwitch[1] };
  if (part === '[engine]') return { type: 'engine_reset' };

  const bracket = part.match(/^\[(\w+)=(-?\d+(?:\.\d+)?)\]$/);
  if (bracket) {
    return { type: 'directive', key: bracket[1], value: Number(bracket[2]), relative: false };
  }

  // Bare uppercase bracket resets an extended (engine-specific) directive to its
  // default, e.g. `[FNZ]`. The value form `[FNZ=450]` is caught by the generic
  // bracket above; lowercase brackets are not directives.
  const bracketReset = part.match(/^\[([A-Z]\w*)\]$/);
  if (bracketReset) return { type: 'directive', key: bracketReset[1], reset: true };

  const noteForm = part.match(/^(b)(=)?([A-G][b#]?-?\d+)$/);
  if (noteForm) {
    const hz = noteToHz(noteForm[3]);
    if (hz != null) return { type: 'directive', key: 'base', value: hz, relative: false };
  }

  const compact = part.match(/^([a-z])(?:(=)?(([+-])?\d+(?:\.\d+)?))?$/);
  if (compact) {
    const [, letter, eq, full, sign] = compact;
    const keyMap = {
      b: 'base', r: 'rate', p: 'pause', s: 'scale',
      v: 'vibrato', w: 'vibratoRate',
      m: 'tremolo', n: 'tremoloRate',
      h: 'aspiration', t: 'tilt', g: 'effort',
    };
    const key = keyMap[letter];
    if (key) {
      if (full === undefined) {
        // Bare letter reset to initial value, drop bare `p`
        if (key !== 'pause') return { type: 'directive', key, reset: true };
        return null;
      }
      const value = Number(full);
      const relative = !eq && (sign === '+' || sign === '-');
      return { type: 'directive', key, value, relative };
    }
  }

  const phoneme = part.match(/^([A-Z]+)(['!])?(?:\(([+-]\d+(?:\.\d+)?)\)|([+-]\d+(?:\.\d+)?))?$/);
  if (phoneme) {
    const transientDelta = phoneme[3] !== undefined ? Number(phoneme[3]) : null;
    const stickyDelta = phoneme[4] !== undefined ? Number(phoneme[4]) : null;
    return {
      type: 'phoneme',
      code: phoneme[1],
      stressed: phoneme[2] !== undefined,
      pitchDelta: transientDelta ?? stickyDelta ?? 0,
      transient: transientDelta !== null,
    };
  }

  return { type: 'unknown', text: part };
}

export function tokenize(rawInput) {
  const source = normalize(rawInput);
  const len = source.length;
  const tokens = [];
  let i = 0;

  const findBlockEnd = (start) => {
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? len : end + 2;
  };

  while (i < len) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    // Line comment: # only at boundary (start of input or after whitespace).
    if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && source[i + 1] === '*') {
      i = findBlockEnd(i);
      continue;
    }

    const srcStart = i;
    let part = '';
    while (i < len && !/\s/.test(source[i])) {
      if (source[i] === '/' && source[i + 1] === '*') {
        i = findBlockEnd(i);
        continue;
      }
      part += source[i];
      i++;
    }
    const srcEnd = i;
    if (!part) continue;

    const tok = classifyPart(part);
    if (!tok) continue;
    tok.srcStart = srcStart;
    tok.srcEnd = srcEnd;

    if (tok.type === 'stress_mark') {
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].type === 'phoneme') { tokens[j].stressed = true; break; }
      }
      continue;
    }
    tokens.push(tok);
  }

  return { tokens, source };
}

// Compile one voice section (a run of tokens with no [voice=N] marker) into a
// standalone schedule. Each section derives its initial state from opts.
function compileSection(tokens, opts = {}, source = '', sectionSrcStart = 0) {
  const initialBaseF0      = opts.baseF0 ?? DEFAULTS.baseF0;
  const initialRate        = opts.rate ?? DEFAULTS.rate;
  const initialScale       = opts.scale ?? 1.0;
  const initialVibrato     = opts.vibratoDepth ?? 0;
  const initialVibratoRate = opts.vibratoRate ?? 5;
  const initialTremolo     = opts.tremoloDepth ?? 0;
  const initialTremoloRate = opts.tremoloRate ?? 5;
  const initialAspiration  = opts.aspiration ?? 0;
  const initialTilt        = opts.tilt ?? 0;
  const initialEffort      = opts.effort ?? 0.5;
  const registry           = opts.registry ?? banks;
  const initialPhonemes    = resolveBank(opts.bank, registry).phonemes;
  let phonemes             = initialPhonemes;
  let f0           = initialBaseF0;
  let rate         = initialRate;
  let scale        = initialScale;
  let vibrato      = initialVibrato;
  let vibratoRate  = initialVibratoRate;
  let tremolo      = initialTremolo;
  let tremoloRate  = initialTremoloRate;
  let aspiration   = initialAspiration;
  let tilt         = initialTilt;
  let effort       = initialEffort;
  // Bare `b` / `r` / `s` / `v` / `h` / `t` / `g` reset to opts values
  let engine       = opts.engine ?? null;
  // Extended engine-specific directives (uppercase bracket forms like [OQ=0.6]).
  // klattsch does not interpret these; they ride into every subsequent schedule
  // target for a consuming engine to read.
  const extras = { ...(opts.extras ?? {}) };
  const schedule = [];
  const warnings = [];
  const phrases = [];
  let timeMs = 0;
  // phrase covers [phraseSrcStart .. token.srcEnd) of source and time
  // [phraseTimeStart .. timeMs] when the next sound finishes
  let phraseSrcStart = sectionSrcStart;
  let phraseTimeStart = 0;
  const emitPhrase = (t) => {
    phrases.push({
      srcStart: phraseSrcStart,
      srcEnd: t.srcEnd,
      // the audible token
      tokenSrcStart: t.srcStart,
      tStartMs: phraseTimeStart,
      tEndMs: timeMs,
      kind: t.type,
      phoneme: t.type === 'phoneme' ? t.code : null,
    });
    phraseSrcStart = t.srcEnd;
    phraseTimeStart = timeMs;
  };

  // Apply the running formant scale to a phoneme parameter set.
  // `glideTo` overrides the formant fields for diphthong endpoints
  const scaled = (p, f0Hz, glideTo = null) => {
    const src = glideTo ? { ...p, ...glideTo } : p;
    const out = {
      ...p, ...glideTo,
      F0: f0Hz,
      F1: src.F1 * scale, F2: src.F2 * scale, F3: src.F3 * scale,
      BW1: src.BW1 * scale, BW2: src.BW2 * scale, BW3: src.BW3 * scale,
    };
    // Scale any higher formant fields a bank defines (F4/BW4 and up) so an
    // engine reading them tracks the running formant scale like F1-3 do.
    for (const k of Object.keys(src)) {
      if (/^(F|BW)[4-9]$/.test(k)) out[k] = src[k] * scale;
      else if (NASAL_FREQ.test(k)) out[k] = src[k] * scale;    // (sonicpi-toolchain patch) a bank's nasal pole/zero
    }
    // (sonicpi-toolchain patch) a bank's nasal fields act only with [NAS] (which also resets them after a nasal)
    if (!nasalMode()) for (const k of NASAL_PARAMS) delete out[k];
    return out;
  };

  // (sonicpi-toolchain patch) coarticulation, active while [CO=x] is set (x: how far a vowel's formants are
  // pulled toward a consonant's locus at a CV boundary, 0 none; [COR=x] the same at a VC boundary, default x;
  // a bare [CO] switches it off).
  // In this mode formant frequencies (F1-F3) move only in their own events, so a consonant's locus can set
  // where a vowel's formants start (CV) and end (VC) while the other parameters keep their usual timing.
  // Bank fields it reads (none of them does anything without [CO]):
  //   vowel: true         a vowel (a nucleus that takes loci)
  //   locus: {F1: [k, c], F2: [k, c], F3: [k, c]}   a consonant's locus equations (Sussman et al. 1991):
  //                       next to a vowel with formant F, the boundary value is F + x (k F + c - F)
  //   locusVC: {...}      the same at the consonant's VC boundaries (default: locus)
  //   locusBurst: true    a stop whose burst takes the following vowel's CV boundary formants (velars)
  //   transparent: true   takes the formants of the vowel after it (HH), through the locus before it
  //   smooth: true        a consonant with a locus whose formants glide (liquids, glides): a vowel after it moves
  //                       from the consonant's own formants over COCV, and it is entered at the usual pace
  // Timing: [COCV=ms] locus -> vowel target, [COVC=ms] vowel target -> locus (at most coVcShare of the
  // vowel); a consonant with a locus reaches its own formants in coJumpMs (the vowel carries the transitions).
  // A phoneme's neighbours are the phonemes next to it with only directives between (a pause breaks it).
  // [TC=n] shapes the transitions (1 raised cosine, 2 ease-out; synth-core CURVES), with or without [CO];
  // [TCF=n] the formant events' own (default TC).
  const prevPh = new Map(), nextPh = new Map();
  {
    let last = null;
    for (const t of tokens) {
      if (t.type === 'phoneme') { if (last) { nextPh.set(last, t); prevPh.set(t, last); } last = t; }
      else if (t.type === 'pause' || t.type === 'unknown' || (t.type === 'directive' && t.key === 'pause')) last = null;
    }
  }
  const entryOf = (t) => (t ? phonemes[t.code] : undefined);
  const rawF = (p, end = false) => {
    const src = end && p.glideTo ? { ...p, ...p.glideTo } : p;
    return { F1: src.F1, F2: src.F2, F3: src.F3 };
  };
  const scaleF = (F) => ({ F1: F.F1 * scale, F2: F.F2 * scale, F3: F.F3 * scale });
  // the boundary formants between consonant entry c and vowel formants V (unscaled), scaled
  const boundary = (c, V, vc) => {
    const L = (vc && c.locusVC) || c.locus, x = vc ? (extras.COR ?? extras.CO) : extras.CO, out = {};
    for (const k of FORMANTS) out[k] = (L[k] ? V[k] + x * (L[k][0] * V[k] + L[k][1] - V[k]) : V[k]) * scale;
    return out;
  };
  // Formant events never go back in time (in a vowel shorter than ~8 ms the VC move or a diphthong's glide
  // would start before the CV move); `formantEvents` makes the schedule be sorted by time at the end (stably,
  // so events at one time keep their order), since such a short slot can also put a formant event after the
  // next non-formant one.
  let lastFormantAt = -Infinity, formantEvents = false;
  const moveFormants = (F, transitionMs, atMs, curve = extras.TCF ?? extras.TC) => {
    atMs = Math.max(atMs, lastFormantAt);
    lastFormantAt = atMs;
    formantEvents = true;
    schedule.push({
      atMs, target: { F1: F.F1, F2: F.F2, F3: F.F3 }, transitionMs: Math.max(transitionMs, 0.1),
      params: FORMANTS, ...(curve ? { curve } : {}),
    });
  };
  const sameF = (a, b) => a && b && FORMANTS.every((k) => a[k] === b[k]);
  // the vowel a stop's burst or an HH belongs to: the next phoneme, or the one after an HH
  const vowelAfter = (t) => {
    let n = nextPh.get(t);
    if (entryOf(n)?.transparent) n = nextPh.get(n);
    return entryOf(n)?.vowel ? n : null;
  };
  const cvMs = () => extras.COCV ?? DEFAULTS.coCvMs;
  // formants into phoneme t (entry p) at its start (timeMs); usualMs: the transition its other parameters take
  const formantsIn = (t, p, usualMs, slotMs) => {
    if (extras.CO === undefined) return;
    const prev = prevPh.get(t), pe = entryOf(prev), jump = Math.min(DEFAULTS.coJumpMs, slotMs * 0.5);
    if (p.transparent) {
      const v = nextPh.get(t), ve = entryOf(v);
      if (ve?.vowel) {
        const V = rawF(ve);
        moveFormants(pe?.locus ? boundary(pe, V, false) : scaleF(V), jump, timeMs);
        moveFormants(scaleF(V), cvMs(), timeMs + jump);   // the CV transition starts at the release
        return;
      }
    }
    if (p.vowel && pe) {
      if (pe.transparent && nextPh.get(prev) === t) return;           // under way since the HH
      if (pe.vowel && sameF(rawF(pe), rawF(p))) return;                // the same vowel continues (breath part)
      if (pe.locus && pe.smooth) { moveFormants(scaleF(rawF(p)), cvMs(), timeMs); return; }   // from the liquid itself
      if (pe.locus) {
        moveFormants(boundary(pe, rawF(p), false), jump, timeMs);
        moveFormants(scaleF(rawF(p)), cvMs(), timeMs + jump);
        return;
      }
    }
    moveFormants(scaleF(rawF(p)), p.locus && !p.smooth ? jump : usualMs, timeMs);
  };
  // a vowel's formants toward the locus of the consonant after it, over its last COVC ms (slot: [start, start+ms])
  const formantsOut = (t, p, slotStart, slotMs) => {
    if (extras.CO === undefined || !p.vowel) return;
    const ne = entryOf(nextPh.get(t));
    if (!ne?.locus || ne.transparent) return;
    const ms = Math.min(extras.COVC ?? DEFAULTS.coVcMs, slotMs * DEFAULTS.coVcShare);
    moveFormants(boundary(ne, rawF(p, true), true), ms, slotStart + slotMs - ms);
  };

  // (sonicpi-toolchain patch) nasals, active while [NAS=x] is set. Every phoneme's first event (and every silence)
  // carries all nasal parameters: a nasal consonant's own (bank fields FNP, BNP, FNZ, BNZ, AN, FNP2 ..., and
  // nasal: true), neutral ones (the pairs cancel, AN 0) for everything else, so a murmur never leaks into what
  // follows. A vowel-like neighbour of a nasal consonant (voicing >= 1, not a stop, not nasal; neighbours as for
  // [CO]: no pause between) is nasalized: from the first [NASVC] of it before a nasal consonant it glides to the
  // nasalized values (DEFAULTS.nasalized, over which the consonant's bank field nasalizes {...} is laid), and after
  // one it starts nasalized and is back to neutral after [NASCV] of it; x scales the nasalization (0: murmurs
  // only). [NASMS=ms] caps each nasalized span at ms (a long sung vowel stays oral until its last ms before a
  // nasal, as singers keep it; absent: the shares alone). The vowel's nasal glides are nasalOnly events, which
  // move only the nasal parameters. Without [NAS] nothing here runs.
  const nasalMode = () => extras.NAS !== undefined;
  let pendingNasal = null;     // nasal parameters for the next emit (the first event of a phoneme)
  let nasalUsed = false;       // [NAS] was on: after a bare [NAS] the next event puts the nasal parameters back
  let nasalOnlyEvents = 0;
  const nasalScaled = (x) => {
    const out = {};
    for (const k of NASAL_PARAMS) if (k in x) out[k] = NASAL_FREQ.test(k) ? x[k] * scale : x[k];
    return out;
  };
  const nasalOf = (t) => { const e = entryOf(t); return e && e.nasal ? e : null; };
  // the nasal parameters of a vowel next to nasal consonant entry n, at strength x
  const nasalizedBy = (n) => {
    const x = extras.NAS, full = { ...NASAL_DEFAULT, ...DEFAULTS.nasalized, ...(n.nasalizes ?? {}) }, out = {};
    for (const k of NASAL_PARAMS) out[k] = NASAL_DEFAULT[k] + x * (full[k] - NASAL_DEFAULT[k]);
    return nasalScaled(out);
  };
  const nasalOnly = (atMs, target, transitionMs) => {
    schedule.push({ atMs, target, transitionMs, nasalOnly: true });
    nasalOnlyEvents++;
  };
  // before a phoneme renders: its first event's nasal parameters; after: the vowel's nasal glides
  // [NASMS=ms]: a share of slotMs, capped at ms (unchanged when absent or not binding)
  const nasalCap = (share, slotMs) => (extras.NASMS !== undefined && slotMs * share > extras.NASMS ? Math.max(0, extras.NASMS) / slotMs : share);
  const nasalBefore = (t, p, slotMs) => {
    if (!nasalMode()) {
      if (nasalUsed) { pendingNasal = nasalScaled(NASAL_DEFAULT); nasalUsed = false; }
      return null;
    }
    nasalUsed = true;
    pendingNasal = nasalScaled(NASAL_DEFAULT);
    if (!(extras.NAS > 0) || p.nasal || p.isStop || !((p.voicing ?? 0) >= 1)) return null;
    const prevN = nasalOf(prevPh.get(t)), nextN = nasalOf(nextPh.get(t));
    if (!prevN && !nextN) return null;
    const cv = nasalCap(extras.NASCV ?? DEFAULTS.nasalCV, slotMs), vc = nasalCap(extras.NASVC ?? DEFAULTS.nasalVC, slotMs);
    if (prevN) pendingNasal = nasalizedBy(prevN);
    else if (vc >= 1) pendingNasal = nasalizedBy(nextN);
    return { start: timeMs, prevN, nextN, cv, vc };
  };
  const nasalAfter = (plan, slotMs) => {
    if (!plan) return;
    const { start, prevN, nextN, cv, vc } = plan;
    if (prevN && nextN && cv + vc >= 1) {
      nasalOnly(start + slotMs * Math.min(cv, 1 - vc / 2), nasalizedBy(nextN), Math.max(1, slotMs * 0.25));
      return;
    }
    if (prevN && cv < 1) nasalOnly(start + slotMs * Math.min(cv * 0.5, 0.1), nasalScaled(NASAL_DEFAULT), Math.max(1, slotMs * Math.max(cv - Math.min(cv * 0.5, 0.1), 0.01)));
    if (nextN && vc < 1 && vc > 0) nasalOnly(start + slotMs * (1 - vc), nasalizedBy(nextN), slotMs * vc);
  };

  const renderPhoneme = (t, slotMs) => {
    const p = phonemes[t.code];
    if (!p) {
      warnings.push(`unknown phoneme: ${t.code}`);
      return 0;
    }
    const nasalPlan = nasalBefore(t, p, slotMs);
    const r = renderPhonemeEvents(t, p, slotMs);
    pendingNasal = null;
    nasalAfter(nasalPlan, slotMs);
    return r;
  };
  // (sonicpi-toolchain patch) [NAST=ms] under [NAS]: the transition of the first event into a nasal consonant and
  // into a (non-stop) phoneme after one (amplitudes, bandwidths, nasal parameters; [CO]'s formant moves keep their
  // own): the oral closure and release that bound a murmur are abrupt. Absent: the usual transition.
  const nasalTrans = (t, p, usual, slotMs) => (nasalMode() && extras.NAST !== undefined && (p.nasal || nasalOf(prevPh.get(t)))
    ? Math.max(0.1, Math.min(extras.NAST, slotMs * 0.9)) : usual);
  const renderPhonemeEvents = (t, p, slotMs) => {
    const startF0 = t.stressed ? f0 + DEFAULTS.stressF0Lift : f0;
    const endF0 = startF0 + t.pitchDelta;
    const slotStart = timeMs;
    if (p.isStop) {
      // (sonicpi-toolchain patch) a bank entry's burstMs sets its release burst (MITalk: P 5, T 15, K 25 ms)
      // (sonicpi-toolchain patch) release: false -> no burst, the closure fills the slot (an unreleased stop)
      const burstMs = p.release === false ? 0 : Math.min(p.burstMs ?? DEFAULTS.stopBurstMs, slotMs * 0.3);
      const silenceMs = slotMs - burstMs;
      if (p.closure) {
        // (sonicpi-toolchain patch) closure: what sounds while the tract is closed instead of silence (a voice
        // bar), the parameters it sets (the others carry on, as through silence) reached in inMs (default 20, at
        // most 40% of the closure), then its A1-A3 times fade (default 1) by the end of the closure
        const { inMs = 20, fade = 1, ...c } = p.closure;
        const tIn = Math.min(inMs, silenceMs * 0.4);
        const target = { F0: startF0 };
        for (const [k, v] of Object.entries(c)) target[k] = /^(F|BW)[1-9]$/.test(k) ? v * scale : v;
        emit(target, tIn);
        // under [CO] formants move only in their own events: the closure's formants, the others where the vowel
        // before moved them (its VC boundary), or the stop's own
        if (extras.CO !== undefined && FORMANTS.some((k) => k in c)) {
          const pe = entryOf(prevPh.get(t));
          const at = pe?.vowel && p.locus ? boundary(p, rawF(pe, true), true) : scaleF(rawF(p));
          for (const k of FORMANTS) if (k in c) at[k] = c[k] * scale;
          moveFormants(at, tIn, timeMs);
        }
        if (fade !== 1 && silenceMs - tIn > 0) {
          timeMs += tIn;
          const faded = { ...target };
          for (const k of ['A1', 'A2', 'A3']) if (k in faded) faded[k] *= fade;
          emit(faded, silenceMs - tIn);
          timeMs -= tIn;
        }
      } else silence(Math.min(20, silenceMs * 0.4));
      timeMs += silenceMs;
      if (p.release !== false) {
        emit(scaled(p, startF0), Math.min(5, burstMs * 0.2));
        if (extras.CO !== undefined) {
          // the burst's formants: its own, or (locusBurst, velars) the following vowel's CV boundary
          const v = p.locusBurst && p.locus ? vowelAfter(t) : null;
          moveFormants(v ? boundary(p, rawF(entryOf(v)), false) : scaleF(rawF(p)), Math.min(5, burstMs * 0.2), timeMs);
        }
      }
      timeMs += burstMs;
      return slotMs;
    } else if (p.glideTo) {
      const onset = slotMs * 0.25, glide = slotMs * 0.50, offset = slotMs * 0.25;
      emit(scaled(p, startF0), nasalTrans(t, p, Math.min(20, onset), onset));
      formantsIn(t, p, Math.min(20, onset), slotMs);
      timeMs += onset;
      emit(scaled(p, endF0, p.glideTo), glide);
      if (extras.CO !== undefined) moveFormants(scaleF(rawF(p, true)), glide, timeMs);
      timeMs += glide + offset;
      formantsOut(t, p, slotStart, slotMs);
      return slotMs;
    } else if (t.pitchDelta !== 0) {
      emit(scaled(p, startF0), nasalTrans(t, p, Math.min(25, slotMs * 0.25), slotMs * 0.25));
      formantsIn(t, p, Math.min(25, slotMs * 0.25), slotMs);
      timeMs += slotMs * 0.25;
      emit(scaled(p, endF0), slotMs * 0.6);
      timeMs += slotMs * 0.75;
      formantsOut(t, p, slotStart, slotMs);
      return slotMs;
    } else {
      // [TR=ms] (sonicpi-toolchain patch): how long formants take to move into a phoneme
      const trans = Math.min(extras.TR ?? DEFAULTS.defaultTransitionMs, slotMs * (extras.TR ? 0.9 : 0.4));
      emit(scaled(p, startF0), nasalTrans(t, p, trans, slotMs));
      formantsIn(t, p, trans, slotMs);
      timeMs += slotMs;
      formantsOut(t, p, slotStart, slotMs);
      return slotMs;
    }
  };

  let inSyllable = false;
  let syllableQueue = [];
  const flushSyllable = () => {
    if (!syllableQueue.length) { inSyllable = false; return; }
    const slot = rate / syllableQueue.length;
    for (const t of syllableQueue) {
      renderPhoneme(t, slot);
      emitPhrase(t);
      if (!t.transient) f0 += t.pitchDelta;
    }
    syllableQueue = [];
    inSyllable = false;
  };

  const stateExtras = () => ({
    vibratoDepth: vibrato,
    vibratoRate,
    tremoloDepth: tremolo,
    tremoloRate,
    aspiration,
    tilt,
    effort,
  });

  const emit = (target, transitionMs) => {
    if (pendingNasal) { target = { ...pendingNasal, ...target }; pendingNasal = null; }
    schedule.push({
      atMs: timeMs,
      // [AV=x] (sonicpi-toolchain patch): loudness multiplier, moved like any other parameter
      target: { ...target, ...extras, ...stateExtras(), ...(extras.AV !== undefined ? { gain: 3.5 * extras.AV } : {}) },
      transitionMs,
      // [TC=n], [CO=x] (sonicpi-toolchain patch): shaped transitions; formants left to their own events
      ...(extras.TC ? { curve: extras.TC } : {}),
      ...(extras.CO !== undefined ? { params: NON_FORMANTS } : {}),
    });
  };
  const silence = (transitionMs = 30) => emit(
    nasalMode() ? { ...nasalScaled(NASAL_DEFAULT), A1: 0, A2: 0, A3: 0 } : { A1: 0, A2: 0, A3: 0 }, transitionMs);

  for (const t of tokens) {
    if (t.type === 'unknown') {
      warnings.push(`unknown token: ${t.text}`);
      continue;
    }

    if (t.type === 'bank_switch') {
      const target = registry.get(t.name);
      if (!target) {
        warnings.push(`unknown bank: ${t.name}`);
        continue;
      }
      phonemes = target.phonemes;
      continue;
    }
    if (t.type === 'bank_reset') {
      phonemes = initialPhonemes;
      continue;
    }

    if (t.type === 'engine_switch') {
      engine = t.name;
      continue;
    }
    if (t.type === 'engine_reset') {
      engine = opts.engine ?? null;
      continue;
    }

    if (t.type === 'syllable_open') {
      if (inSyllable) {
        warnings.push('nested ( ignored');
        continue;
      }
      inSyllable = true;
      syllableQueue = [];
      continue;
    }
    if (t.type === 'syllable_close') {
      if (!inSyllable) {
        warnings.push('unmatched )');
        continue;
      }
      flushSyllable();
      continue;
    }

    if (t.type === 'directive') {
      switch (t.key) {
        case 'base':
        case 'pitch':
          if (t.reset) f0 = initialBaseF0;
          else if (t.relative) f0 += t.value;
          else f0 = t.value;
          break;
        case 'rate':
          if (t.reset) rate = initialRate;
          else if (t.relative) rate += t.value;
          else rate = t.value;
          break;
        case 'scale':
          if (t.reset) scale = initialScale;
          else if (t.relative) scale += t.value;
          else scale = t.value;
          break;
        case 'vibrato':
          if (t.reset) vibrato = initialVibrato;
          else if (t.relative) vibrato += t.value;
          else vibrato = t.value;
          break;
        case 'vibratoRate':
          if (t.reset) vibratoRate = initialVibratoRate;
          else if (t.relative) vibratoRate += t.value;
          else vibratoRate = t.value;
          break;
        case 'tremolo':
          if (t.reset) tremolo = initialTremolo;
          else if (t.relative) tremolo += t.value;
          else tremolo = t.value;
          break;
        case 'tremoloRate':
          if (t.reset) tremoloRate = initialTremoloRate;
          else if (t.relative) tremoloRate += t.value;
          else tremoloRate = t.value;
          break;
        case 'aspiration':
          if (t.reset) aspiration = initialAspiration;
          else if (t.relative) aspiration += t.value;
          else aspiration = t.value;
          break;
        case 'tilt':
          if (t.reset) tilt = initialTilt;
          else if (t.relative) tilt += t.value;
          else tilt = t.value;
          break;
        case 'effort':
          if (t.reset) effort = initialEffort;
          else if (t.relative) effort += t.value;
          else effort = t.value;
          break;
        case 'pause':
          silence();
          timeMs += Math.abs(t.value);
          emitPhrase(t);
          break;
        default:
          // Uppercase directive keys (e.g. [OQ=0.6], [FNZ=450]) are extended,
          // engine-specific state. Accumulate them into `extras` so they ride
          // into every subsequent target; a bare [OQ] clears the override.
          if (/^[A-Z]/.test(t.key)) {
            if (t.reset) delete extras[t.key];
            else extras[t.key] = t.value;
          } else {
            warnings.push(`unknown directive: ${t.key}`);
          }
      }
      continue;
    }

    if (t.type === 'pause') {
      silence();
      timeMs += t.ms;
      emitPhrase(t);
      continue;
    }

    // phoneme: defer to the group buffer if inside (...), otherwise render
    // straight to the schedule
    if (inSyllable) {
      syllableQueue.push(t);
      continue;
    }

    const phoneRate = t.stressed ? rate * DEFAULTS.stressDurationFactor : rate;
    renderPhoneme(t, phoneRate);
    emitPhrase(t);

    if (!t.transient) f0 += t.pitchDelta;
  }

  if (inSyllable) {
    warnings.push('unclosed (');
    flushSyllable();
  }

  timeMs += DEFAULTS.sentenceFinalHoldMs;
  silence(DEFAULTS.fadeOutMs);
  timeMs += DEFAULTS.trailOffMs;

  // Hold the final phrase highlighted
  if (phrases.length) phrases[phrases.length - 1].tEndMs = timeMs;

  // (sonicpi-toolchain patch) [CO]: the synth applies events in array order
  // (sonicpi-toolchain patch) [NAS]: a vowel's nasal glides were pushed after its own events
  if (formantEvents || nasalOnlyEvents) schedule.sort((a, b) => a.atMs - b.atMs);

  return { schedule, totalMs: timeMs, warnings, phrases, source, engine };
}

export function compile(parsed, opts = {}) {
  // accept { tokens, source } shape from tokenize(), fallback to legacy array
  const tokens = Array.isArray(parsed) ? parsed : parsed.tokens;
  const source = Array.isArray(parsed) ? '' : (parsed.source ?? '');

  // Partition tokens into voice sections at each [voice=N] marker. Sections are
  // positional. Text before the first marker is voice 0. Each section compiles
  // independently.
  const sections = [[]];
  const sectionStarts = [0];
  for (const t of tokens) {
    if (t.type === 'directive' && t.key === 'voice') {
      sections.push([]);
      sectionStarts.push(t.srcEnd ?? 0);
      continue;
    }
    sections[sections.length - 1].push(t);
  }

  const voices = sections.map((toks, i) => compileSection(toks, opts, source, sectionStarts[i]));

  // Backward-compatible top level: schedule/phrases are voice 0, totalMs is the
  // max across sections, warnings are merged.
  return {
    schedule: voices[0].schedule,
    totalMs: Math.max(...voices.map(v => v.totalMs)),
    warnings: voices.flatMap(v => v.warnings),
    phrases: voices[0].phrases,
    engine: voices[0].engine,
    source,
    voices: voices.map(v => ({ schedule: v.schedule, totalMs: v.totalMs, phrases: v.phrases, engine: v.engine })),
  };
}

export function compileString(input, opts) {
  return compile(tokenize(input), opts);
}
