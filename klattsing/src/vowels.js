// "vowels": vowel targets fitted to Kokoro, with their inherent spectral change, reduced vowels and r-colored vowels.
//   "vowels": true                         the defaults below (VOWELS_DEFAULTS, VOWEL_TARGETS)
//   "vowels": { targets, glide, reduced, weak, rhotic, phonemes: { CODE: {field: value} } }   fields over these
// Entries of a generated bank "<base>--vw<hash>" (after bankPatch, before coarticulation, so coarticulation's loci,
// the stops' bursts and aspiration and the breath entries all take these targets), and per syllable the code its
// vowel is rendered with (the timeline still names the lexical vowel, with `code` beside it):
//   targets   every vowel gets an onset target (F1-F3) and an offset target (glideTo), not only the diphthongs:
//             vowel-inherent spectral change (Nearey & Assmann 1986; Hillenbrand, Getty, Clark & Wheeler 1995: formants
//             at 20% and 80% of the vowel identify American English vowels far better than one steady state; Assmann
//             & Katz 2005: synthetic vowels with their natural trajectories are identified better than flat ones),
//             and its own bandwidths and amplitudes (BW1-BW3, A2, A3), fitted to Kokoro (am_onyx) by analysis-by-
//             synthesis under BASE (tools/voicelab/vowelfit.py): the formants by the median paired difference Kokoro -
//             klattsch of Praat formants at 20/35/50/65/80% of the same aligned vowels (so coarticulation's loci act
//             on both sides alike), then BW and A by coordinate descent on each code's own vowels' MCD + mcd_cmn
//             (train split), then the formants once more
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
//   phonemes  fields over any generated entry (F1-F3, BW1-BW3, A1-A3, glideTo {F1, F2, F3}, glide [a, b]; null: the base
//             bank's value, or none)
// Without the option nothing here runs and the strings are unchanged.
import { VOWELS, REDUCED_CODES, RHOTIC_SUFFIX, vowelOf } from './phones.js';

// Fitted onset (F1-F3) and offset (glideTo) targets, bandwidths and amplitudes, glide windows (tools/voicelab/vowelfit.py;
// IYQR: IHQR's, Kokoro says [ɪɹ] in "here", "near"; the other r-colored codes have no corpus tokens: RHOTIC_RULE).
export const VOWEL_TARGETS = {
  AA: { F1: 715, F2: 1003, F3: 2537, BW1: 137.5, BW2: 25.9, BW3: 194.3, A2: 1.131, A3: 0.483, glideTo: { F1: 787, F2: 1113, F3: 2493 } },
  AE: { F1: 694, F2: 1537, F3: 2359, BW1: 84.0, BW2: 349.1, BW3: 104.8, A2: 0.795, A3: 0.607, glideTo: { F1: 841, F2: 1418, F3: 2252 } },
  AH: { F1: 653, F2: 1199, F3: 2523, BW1: 96.0, BW2: 84.7, BW3: 194.3, A2: 1.043, A3: 0.426, glideTo: { F1: 662, F2: 1113, F3: 2462 } },
  AO: { F1: 601, F2: 789, F3: 2611, BW1: 74.8, BW2: 58.9, BW3: 126.1, A2: 1.036, A3: 0.684, glideTo: { F1: 611, F2: 729, F3: 2582 } },
  AW: { F1: 757, F2: 1396, F3: 2381, BW1: 96.0, BW2: 94.6, BW3: 50.7, A2: 0.853, A3: 0.892, glideTo: { F1: 631, F2: 867, F3: 2444 }, glide: [0.4, 0.8] },
  AY: { F1: 751, F2: 1103, F3: 2461, BW1: 120.0, BW2: 143.3, BW3: 80.5, A2: 1.25, A3: 0.897, glideTo: { F1: 547, F2: 1675, F3: 2193 }, glide: [0.4, 0.8] },
  EH: { F1: 599, F2: 1556, F3: 2359, BW1: 72.0, BW2: 223.9, BW3: 76.2, A2: 0.865, A3: 0.642, glideTo: { F1: 699, F2: 1529, F3: 2365 } },
  ER: { F1: 499, F2: 1041, F3: 1466, BW1: 115.5, BW2: 37.2, BW3: 40.5, A2: 1.401, A3: 0.77, glideTo: { F1: 474, F2: 1045, F3: 1300 } },
  EY: { F1: 550, F2: 1681, F3: 2327, BW1: 84.0, BW2: 239.8, BW3: 94.8, A2: 0.935, A3: 0.749, glideTo: { F1: 368, F2: 2060, F3: 2229 } },
  IH: { F1: 446, F2: 1658, F3: 2421, BW1: 60.0, BW2: 248.8, BW3: 144.0, A2: 0.466, A3: 0.374, glideTo: { F1: 480, F2: 1639, F3: 2158 } },
  IY: { F1: 314, F2: 2303, F3: 2853, BW1: 54.0, BW2: 393.9, BW3: 194.0, A2: 0.648, A3: 0.311, glideTo: { F1: 223, F2: 2700, F3: 3282 } },
  OW: { F1: 551, F2: 1080, F3: 2421, BW1: 64.0, BW2: 32.7, BW3: 97.4, A2: 0.53, A3: 0.42, glideTo: { F1: 369, F2: 594, F3: 2404 } },
  OY: { F1: 619, F2: 750, F3: 2481, BW1: 96.0, BW2: 65.1, BW3: 276.4, A2: 0.861, A3: 0.359, glideTo: { F1: 409, F2: 1669, F3: 2081 }, glide: [0.4, 0.8] },
  UH: { F1: 451, F2: 1027, F3: 2360, BW1: 96.0, BW2: 80.0, BW3: 199.0, A2: 0.715, A3: 0.323, glideTo: { F1: 457, F2: 783, F3: 2043 } },
  UW: { F1: 306, F2: 1537, F3: 2006, BW1: 78.0, BW2: 159.6, BW3: 216.6, A2: 0.4, A3: 0.347, glideTo: { F1: 242, F2: 793, F3: 1708 } },
  AX: { F1: 542, F2: 1314, F3: 2128, BW1: 96.0, BW2: 124.4, BW3: 232.3, A2: 0.95, A3: 0.387, glideTo: { F1: 435, F2: 1111, F3: 2427 } },
  IX: { F1: 419, F2: 1923, F3: 2198, BW1: 60.0, BW2: 248.8, BW3: 45.9, A2: 0.472, A3: 0.311, glideTo: { F1: 501, F2: 1511, F3: 1816 } },
  AXR: { F1: 489, F2: 1045, F3: 1300, BW1: 120.0, BW2: 149.3, BW3: 81.1, A2: 1.056, A3: 0.311, glideTo: { F1: 394, F2: 1083, F3: 1300 } },
  AAQR: { F1: 643, F2: 917, F3: 2351, BW1: 116.5, BW2: 40.2, BW3: 69.7, A2: 1.342, A3: 0.795, glideTo: { F1: 788, F2: 1010, F3: 1980 }, glide: [0.35, 1.0] },
  AOQR: { F1: 328, F2: 550, F3: 2557, BW1: 72.0, BW2: 32.8, BW3: 26.2, A2: 0.401, A3: 0.311, glideTo: { F1: 464, F2: 550, F3: 2212 }, glide: [0.35, 0.75] },
  EHQR: { F1: 566, F2: 1784, F3: 2200, BW1: 72.0, BW2: 189.3, BW3: 65.5, A2: 0.601, A3: 1.054, glideTo: { F1: 625, F2: 2005, F3: 2195 }, glide: [0.4, 0.75] },
  IHQR: { F1: 353, F2: 1921, F3: 2326, BW1: 58.2, BW2: 32.8, BW3: 296.8, A2: 0.4, A3: 0.775, glideTo: { F1: 455, F2: 2151, F3: 2147 }, glide: [0.6, 0.8] },
  IYQR: { F1: 353, F2: 1921, F3: 2326, BW1: 58.2, BW2: 32.8, BW3: 296.8, A2: 0.4, A3: 0.775, glideTo: { F1: 455, F2: 2151, F3: 2147 }, glide: [0.6, 0.8] },
};
export const WEAK_FORMS = ['to', 'was', 'than'];
export const RHOTIC_VOWELS = 'AA AE AH AO EH IH IY UH UW'.split(' ');
// a vowel before R without fitted r-colored targets: its own entry, its offset F3 down to this, gliding from this share
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
      // no fitted r-colored targets: the vowel's own (fitted) entry, its offset's F3 lowered
      const { glide: _g, ...v } = (V.targets && VOWEL_TARGETS[lex]) || base, end = { F1: v.F1, F2: v.F2, F3: v.F3, ...(v.glideTo ?? {}) };
      t = { ...v, glideTo: { F1: end.F1, F2: end.F2, F3: Math.min(end.F3, RHOTIC_RULE.F3) }, glide: RHOTIC_RULE.glide };
    }
    if (t && (V.targets || !own)) {
      const { glideTo, glide, ...f } = t;
      Object.assign(e, f);
      if (glideTo) e.glideTo = { ...glideTo };
      if (glide && V.glide) e.glide = [...glide]; else delete e.glide;
    }
    for (const [k, v] of Object.entries(V.phonemes[code] ?? {})) {
      // null: the base bank's value (none when it has none; F1-F3, BW, A, voicing are never left out)
      if (v === null) { if (k in base) e[k] = k === 'glideTo' ? { ...base[k] } : k === 'glide' ? [...base[k]] : base[k]; else delete e[k]; }
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
