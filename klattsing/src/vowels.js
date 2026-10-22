// "vowels": vowel targets fitted to Kokoro, with their inherent spectral change, reduced vowels and r-colored vowels.
//   "vowels": true                         the defaults below (VOWELS_DEFAULTS, VOWEL_TARGETS)
//   "vowels": { targets, glide, reduced, weak, rhotic, phonemes: { CODE: {field: value} } }   fields over these
// Entries of a generated bank "<base>--vw<hash>" (after bankPatch, before coarticulation, so coarticulation's loci,
// the stops' bursts and aspiration and the breath entries all take these targets), and per syllable the code its
// vowel is rendered with (the timeline still names the lexical vowel, with `code` beside it):
//   targets   every vowel gets an onset target (F1-F3) and an offset target (glideTo), not only the diphthongs:
//             vowel-inherent spectral change (Nearey & Assmann 1986; Hillenbrand, Getty, Clark & Wheeler 1995: formants
//             at 20% and 80% of the vowel identify American English vowels far better than one steady state),
//             fitted to Kokoro (am_onyx) by analysis-by-synthesis (tools/voicelab/vowelfit.py, below)
//   glide     each vowel's glide window [a, b] (the share of the vowel over which it moves from onset to offset;
//             klattsch's own is 0.25-0.75): Kokoro's diphthongs hold their first target longer and move late
//             (Gay 1968; Hillenbrand et al. 1995: AY/AW/OY's offglide mostly after the middle); a klattsch patch
//             (bank field glide, vendor/klattsch/VENDORED)
//   reduced   unstressed AH IH ER (after functionWords) -> AX IX AXR: schwa-like, centralized targets of their own
//             (Lindblom 1963; Koopmans-van Beinum 1980: unstressed vowels centralize; Flemming & Johnson 2007: English
//             schwa vs the reduced high vowel)
//   weak      function words with a full vowel in CMUdict, unstressed by functionWords, take their weak form's schwa
//             AX (Gimson / Cruttenden: "to" [tə], "was" [wəz], "than" [ðən]); true = WEAK_FORMS, or a list
//   rhotic    a vowel before R in its syllable ("dark", "four", "there", "clear") -> <vowel>QR: r-colored, F3 falling
//             through the vowel's second half toward R's (Lehiste 1964; Espy-Wilson 1992: the low F3 of American
//             English /r/ spreads into the vowel before it), /ɔr/ raised toward [o], /ɛr/ /ɪr/ toward [e] [i]
//   singGlideMs  sung: [GLMS=ms], every vowel glide at most this long, late in the note (150; false: none); a sung
//             diphthong is then not split into two vowels either
//   phonemes  fields over any generated entry (F1-F3, BW1-BW3, A1-A3, glideTo {F1, F2, F3}, glide [a, b]; null removes)
// Without the option nothing here runs and the strings are unchanged.
import { VOWELS, REDUCED_CODES, RHOTIC_SUFFIX, vowelOf } from './phones.js';

// Fitted onset (F1-F3) and offset (glideTo) targets and glide windows (tools/voicelab/vowelfit.py): filled in below.
export const VOWEL_TARGETS = {};
export const WEAK_FORMS = ['to', 'was', 'than'];
export const RHOTIC_VOWELS = 'AA AE AH AO EH IH IY UH UW'.split(' ');
// a vowel before R without fitted r-colored targets: its own onset, its offset F3 down to this, gliding from this share
export const RHOTIC_RULE = { F3: 1900, glide: [0.35, 1] };
export const VOWELS_DEFAULTS = { targets: true, glide: true, reduced: true, weak: true, rhotic: true, singGlideMs: 150 };
const KEYS = [...Object.keys(VOWELS_DEFAULTS), 'phonemes'];
const FIELDS = ['F1', 'F2', 'F3', 'BW1', 'BW2', 'BW3', 'A1', 'A2', 'A3', 'voicing'];
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// every code the bank defines: the 15 vowels, the reduced ones, the r-colored ones
export const VOWEL_CODES = [...VOWELS, ...Object.keys(REDUCED_CODES), ...RHOTIC_VOWELS.map((v) => v + RHOTIC_SUFFIX)];
const REDUCE = Object.fromEntries(Object.entries(REDUCED_CODES).map(([c, v]) => [v, c]));   // AH -> AX, ...

// "vowels": true | {...} -> the full option, or null (off)
export function vowelOptions(o) {
  if (!o.vowels) return null;
  const x = o.vowels === true ? {} : o.vowels;
  if (!isObj(x)) throw new Error(`vowels: true or an object, got ${JSON.stringify(o.vowels)}`);
  for (const k of Object.keys(x)) if (!KEYS.includes(k)) throw new Error(`vowels.${k}: unknown (${KEYS.join(', ')})`);
  for (const k of ['targets', 'glide', 'reduced', 'rhotic']) if (x[k] != null && typeof x[k] !== 'boolean') throw new Error(`vowels.${k}: true or false`);
  if (x.singGlideMs != null && x.singGlideMs !== false && !(num(x.singGlideMs) && x.singGlideMs >= 0)) throw new Error('vowels.singGlideMs: ms >= 0, or false');
  if (x.weak != null && typeof x.weak !== 'boolean' && !(Array.isArray(x.weak) && x.weak.every((w) => typeof w === 'string'))) {
    throw new Error('vowels.weak: true, false or a list of words');
  }
  if (x.phonemes != null) {
    if (!isObj(x.phonemes)) throw new Error('vowels.phonemes: {CODE: {field: value}}');
    for (const [c, f] of Object.entries(x.phonemes)) {
      if (!VOWEL_CODES.includes(c)) throw new Error(`vowels.phonemes.${c}: one of ${VOWEL_CODES.join(', ')}`);
      if (!isObj(f)) throw new Error(`vowels.phonemes.${c}: {field: value}`);
      for (const [k, v] of Object.entries(f)) {
        if (v === null) continue;
        if (k === 'glideTo') {
          if (!isObj(v) || !Object.entries(v).every(([q, w]) => ['F1', 'F2', 'F3', 'BW1', 'BW2', 'BW3', 'A1', 'A2', 'A3'].includes(q) && num(w))) {
            throw new Error(`vowels.phonemes.${c}.glideTo: {F1, F2, F3: Hz}`);
          }
        } else if (k === 'glide') {
          if (!(Array.isArray(v) && v.length === 2 && v.every(num) && v[0] >= 0 && v[0] < v[1] && v[1] <= 1)) throw new Error(`vowels.phonemes.${c}.glide: [a, b], 0 <= a < b <= 1`);
        } else if (!FIELDS.includes(k) || !num(v)) throw new Error(`vowels.phonemes.${c}.${k}: one of ${FIELDS.join(', ')}, glideTo, glide (numbers)`);
      }
    }
  }
  const out = { ...VOWELS_DEFAULTS, phonemes: x.phonemes ?? {} };
  for (const k of Object.keys(VOWELS_DEFAULTS)) if (x[k] != null) out[k] = x[k];
  return out;
}

// the bank entries: per code, the resolved base entry of its lexical vowel (a code the base defines: its own), with
// the fitted targets (the 15 with targets; the reduced and r-colored ones always) and the option's phonemes over it
export function vowelEntries(resolved, V) {
  const phonemes = {};
  for (const code of VOWEL_CODES) {
    const lex = vowelOf(code), base = resolved.phonemes[code] ?? resolved.phonemes[lex];
    if (!base) continue;
    const own = VOWELS.has(code);
    if (own && !V.targets && !V.phonemes[code]) continue;
    if (!own && code in REDUCED_CODES && !V.reduced && !V.weak && !V.phonemes[code]) continue;
    if (!own && code.endsWith(RHOTIC_SUFFIX) && !V.rhotic && !V.phonemes[code]) continue;
    const e = { ...base };
    let t = VOWEL_TARGETS[code];
    if (!t && code.endsWith(RHOTIC_SUFFIX)) {
      // no fitted r-colored targets: the vowel's own (fitted) onset, its offset's F3 lowered
      const v = (V.targets && VOWEL_TARGETS[lex]) || base, end = { F1: v.F1, F2: v.F2, F3: v.F3, ...(v.glideTo ?? {}) };
      t = { F1: v.F1, F2: v.F2, F3: v.F3, glideTo: { F1: end.F1, F2: end.F2, F3: Math.min(end.F3, RHOTIC_RULE.F3) }, glide: RHOTIC_RULE.glide };
    }
    if (t && (V.targets || !own)) {
      const { glideTo, glide, ...f } = t;
      Object.assign(e, f);
      if (glideTo) e.glideTo = { ...glideTo };
      if (glide && V.glide) e.glide = [...glide]; else delete e.glide;
    }
    for (const [k, v] of Object.entries(V.phonemes[code] ?? {})) {
      if (v === null) delete e[k];
      else if (k === 'glideTo') e.glideTo = { ...(e.glideTo ?? {}), ...v };
      else if (k === 'glide') e.glide = [...v];
      else e[k] = v;
    }
    phonemes[code] = e;
  }
  return phonemes;
}

// the directive it adds: sung (sing mode), [GLMS=singGlideMs]: a vowel's glide takes at most that long, ending where its
// window ends (a held note keeps its first target and glides late, as singers sustain the vowel and move at the end)
export const vowelDirectives = (V, mode = 'speak') => (V && mode === 'sing' && num(V.singGlideMs) ? `[GLMS=${V.singGlideMs}]` : '');

// per syllable of klattsing's timed words: s.nucleusCode, the code its vowel is rendered with (unset: the vowel itself)
export function planVowels(ws, V) {
  const weak = V.weak ? new Set((V.weak === true ? WEAK_FORMS : V.weak).map((w) => w.toLowerCase())) : null;
  for (const w of ws) for (const s of w.syllables) {
    if (!s.nucleus || !VOWELS.has(s.nucleus)) continue;
    let c = s.nucleus;
    if (s.stress === 0 && weak && weak.has(w.word) && c !== 'ER') c = 'AX';
    else if (s.stress === 0 && V.reduced && REDUCE[c]) c = REDUCE[c];
    else if (V.rhotic && s.coda[0] === 'R' && RHOTIC_VOWELS.includes(c)) c += RHOTIC_SUFFIX;
    if (c !== s.nucleus) s.nucleusCode = c;
  }
  return ws;
}
