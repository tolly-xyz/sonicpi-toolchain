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
  AA: { F1: 719, F2: 1003, F3: 2544, glideTo: { F1: 791, F2: 1096, F3: 2507 } },
  AE: { F1: 701, F2: 1569, F3: 2382, glideTo: { F1: 833, F2: 1458, F3: 2298 } },
  AH: { F1: 655, F2: 1221, F3: 2559, glideTo: { F1: 658, F2: 1148, F3: 2489 } },
  AO: { F1: 596, F2: 776, F3: 2587, glideTo: { F1: 584, F2: 738, F3: 2594 } },
  AW: { F1: 762, F2: 1423, F3: 2412, glideTo: { F1: 627, F2: 900, F3: 2450 }, glide: [0.4, 0.8] },
  AY: { F1: 759, F2: 1141, F3: 2490, glideTo: { F1: 538, F2: 1666, F3: 2225 }, glide: [0.4, 0.8] },
  EH: { F1: 598, F2: 1586, F3: 2378, glideTo: { F1: 703, F2: 1555, F3: 2386 } },
  ER: { F1: 495, F2: 974, F3: 1530, glideTo: { F1: 472, F2: 1053, F3: 1300 } },
  EY: { F1: 547, F2: 1674, F3: 2319, glideTo: { F1: 364, F2: 2043, F3: 2210 } },
  IH: { F1: 444, F2: 1677, F3: 2436, glideTo: { F1: 482, F2: 1654, F3: 2249 } },
  IY: { F1: 314, F2: 2288, F3: 2780, glideTo: { F1: 229, F2: 2646, F3: 3240 } },
  OW: { F1: 547, F2: 1053, F3: 2422, glideTo: { F1: 353, F2: 606, F3: 2391 } },
  OY: { F1: 624, F2: 759, F3: 2482, glideTo: { F1: 400, F2: 1691, F3: 2146 }, glide: [0.4, 0.8] },
  UH: { F1: 448, F2: 1016, F3: 2358, glideTo: { F1: 463, F2: 816, F3: 2092 } },
  UW: { F1: 312, F2: 1526, F3: 2090, glideTo: { F1: 248, F2: 886, F3: 1821 } },
  AX: { F1: 541, F2: 1325, F3: 2270, glideTo: { F1: 464, F2: 1150, F3: 2501 } },
  IX: { F1: 428, F2: 1938, F3: 2273, glideTo: { F1: 504, F2: 1556, F3: 2066 } },
  AXR: { F1: 481, F2: 994, F3: 1300, glideTo: { F1: 386, F2: 1133, F3: 1300 } },
  AAQR: { F1: 654, F2: 933, F3: 2359, glideTo: { F1: 778, F2: 1025, F3: 1967 }, glide: [0.35, 1.0] },
  AOQR: { F1: 309, F2: 550, F3: 2541, glideTo: { F1: 481, F2: 550, F3: 2199 }, glide: [0.35, 0.75] },
  EHQR: { F1: 563, F2: 1786, F3: 2261, glideTo: { F1: 624, F2: 1888, F3: 2105 }, glide: [0.4, 0.75] },
  IHQR: { F1: 357, F2: 1938, F3: 2351, glideTo: { F1: 452, F2: 2116, F3: 2111 }, glide: [0.6, 0.8] },
  IYQR: { F1: 357, F2: 1938, F3: 2351, glideTo: { F1: 452, F2: 2116, F3: 2111 }, glide: [0.6, 0.8] },
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
