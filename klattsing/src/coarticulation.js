// Coarticulated formant trajectories (opt-in: spec "coarticulation"), carried out by klattsch's [CO=x] patch.
//
// Without it klattsch moves all parameters linearly over a fixed transition (35 ms, or [TR]) into each phoneme's
// fixed targets: a stop's burst formants are the same before every vowel, a vowel ends on its own target right
// up to a following closure, HH keeps neutral formants (500/1500/2500) whatever vowel it breathes into.
// With it:
//   - CV: a vowel after a consonant starts at the consonant's locus-equation value for that vowel,
//     F_onset = F + x (k F + c - F) (x = degree; x = 1: the locus equation F_onset = k F + c of Sussman, McCaffrey
//     & Matthews 1991, a place's onset pointing at its locus as in Delattre, Liberman & Cooper 1955), and moves to
//     its target over `cv` ms; after a liquid or glide (sonorants) it moves from the consonant's own formants;
//   - VC: a vowel before a consonant moves toward that consonant's value over its last `vc` ms (at most 60% of
//     it, so a short vowel between two consonants never reaches its target: Lindblom's 1963 undershoot);
//   - HH takes the following vowel's formants (Klatt 1980: [h] is a voiceless copy of the next vowel), and after
//     P/T/K the CV transition starts at the release, under the aspiration;
//   - a velar's burst takes the following vowel's onset formants (fronted before front vowels);
//   - an obstruent or nasal reaches its own formants in 3 ms (the vowel carries the transitions; fricative and
//     nasal resonances start abruptly), other parameters (amplitudes, voicing, F0) keep their usual timing;
//   - curve: the shape of every transition ("out": ease-out u(2-u), fast at first and settling, the shape of
//     Kokoro's F2 after a consonant (median remaining share 0.71 / 0.47 / 0.30 / 0.16 at 10 / 20 / 30 / 40 ms;
//     (1 - t/60)^2: 0.69 / 0.44 / 0.25 / 0.11); "cos": raised cosine; "linear": klattsch's own ramps).
//     formantCurve: the formants' own (default: curve). In voicelab fidelity the curve matters through the other
//     parameters (amplitude and voicing onsets, F0): formants linear lose 0.005, raised cosine 0.01, while
//     everything else linear loses 0.18.
// Loci per place, fitted to the Kokoro corpus (am_onyx, 100 Harvard sentences; Praat Burg formants 5 ms into
// each vowel vs at its midpoint, robust least squares; F2 slopes: labial 0.71, alveolar 0.53, velar 0.86,
// against 0.87 / 0.43 / 0.66 in Sussman et al. 1991). Unreliable fits (r < 0.3, too few tokens) are replaced:
// postalveolar F1 and F3 by the alveolar ones; Y has no F3 locus.
// degree 2 (the default) pulls twice as far as those fits: the 25 ms analysis window 5 ms into the vowel
// averages the boundary with the vowel, and Kokoro's connected-speech vowels undershoot more than the
// equations alone give. voicelab fidelity (BASE = kokoro-durations + mitalk-bursts) peaks there:
// degree 1 0.70, 1.5 0.74, 2 0.76, 2.5 0.74 (BASE 0.37). The loci and the degree were fitted on all 100 am_onyx
// sentences; the gain holds on climb.py's 20 held-out sentences (BASE 0.21 -> 0.54) and on the other voice,
// am_michael (0.44 -> 0.82). Of the 0.39: the ease-out curve alone (klattsch [TC=2], no loci) 0.19, the loci alone
// (all transitions linear) 0.21; the VC transitions are worth 0.13 (codaDegree 0: 0.63), liquids/glides 0.08, HH 0.02.
// Whisper minimal pairs (tools/voicelab/pairs.py, BASE vs BASE + "coarticulation": true): 46.8% -> 69.1%, McNemar
// p = 1.6e-6 (6 words lost, 37 gained); fricatives 15 -> 62%, liquids/glides 45 -> 82%, place of stops 36 -> 64%,
// vowels 73 -> 67% (one word, n.s.).
import { VOWELS } from './phones.js';

export const LOCI = {
  labial:       { phones: 'P B M',       F1: [0.905, -7],  F2: [0.705, 311], F3: [0.523, 1125] },
  labiodental:  { phones: 'F V',         F1: [0.691, 146], F2: [0.36, 906],  F3: [0.477, 1248] },
  dental:       { phones: 'TH DH',       F1: [0.294, 263], F2: [0.516, 673], F3: [0.154, 2115] },
  alveolar:     { phones: 'T D N',       F1: [0.54, 176],  F2: [0.531, 763], F3: [0.141, 2136] },
  alveolarFric: { phones: 'S Z',         F1: [0.448, 197], F2: [0.575, 620], F3: [0.043, 2337] },
  postalveolar: { phones: 'SH ZH CH JH', F1: [0.54, 176],  F2: [0.39, 1225], F3: [0.141, 2136] },
  velar:        { phones: 'K G NG',      F1: [0.445, 209], F2: [0.862, 345], F3: [0.862, 374] },
  // liquids and glides (sonorants: true): VC boundaries; a vowel after one moves from its formants over cv ms
  lateral:      { phones: 'L', smooth: true, F1: [0.638, 144], F2: [0.545, 338], F3: [0.381, 1619] },
  rhotic:       { phones: 'R', smooth: true, F1: [0.546, 178], F2: [0.321, 761], F3: [0.268, 1177] },
  labiovelar:   { phones: 'W', smooth: true, F1: [0.513, 162], F2: [0.248, 600], F3: [0.441, 1302] },
  palatal:      { phones: 'Y', smooth: true, F1: [0.538, 103], F2: [0.399, 1290] },
};
export const VELAR_STOPS = ['K', 'G'];
export const CURVE = { linear: 0, cos: 1, out: 2 };
// the option's defaults ("coarticulation": true)
export const COARTICULATION = {
  degree: 2, codaDegree: null, curve: 'out', formantCurve: null, cv: 60, vc: 50, burst: true, hh: true, sonorants: true,
};
const curveCode = (c, what) => {
  if (typeof c === 'number' && Object.values(CURVE).includes(c)) return c;
  if (c in CURVE) return CURVE[c];
  throw new Error(`coarticulation.${what}: ${c} (linear, cos, out)`);
};

// "coarticulation": true | {degree, codaDegree, curve, formantCurve, cv, vc, burst, hh, sonorants, loci}
//   -> the full option, or null (off)
export function coartOptions(c) {
  if (!c) return null;
  const o = { ...COARTICULATION, ...(c === true ? {} : Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined))) };
  curveCode(o.curve, 'curve');
  if (o.formantCurve !== null) curveCode(o.formantCurve, 'formantCurve');
  for (const k of ['degree', 'cv', 'vc']) if (typeof o[k] !== 'number' || !(o[k] >= 0)) throw new Error(`coarticulation.${k}: expected a number >= 0`);
  if (o.codaDegree !== null && !(o.codaDegree >= 0)) throw new Error('coarticulation.codaDegree: expected a number >= 0');
  lociOf(o);
  return o;
}

// phone -> {F1: [k, c], ...}: LOCI by place (liquids and glides unless sonorants: false), with o.loci
// ({PHONE: {F2: [k, c], ...}}, or PHONE: null for none) merged over them
export function lociOf(o) {
  const out = {};
  for (const { phones, smooth, ...eq } of Object.values(LOCI)) {
    if (!smooth || o?.sonorants !== false) for (const p of phones.split(' ')) out[p] = { ...eq };
  }
  for (const [p, eq] of Object.entries(o?.loci ?? {})) {
    for (const [k, v] of Object.entries(eq ?? {})) {
      if (!/^F[123]$/.test(k) || !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) {
        throw new Error(`coarticulation.loci.${p}.${k}: expected F1/F2/F3: [slope, intercept Hz]`);
      }
    }
    out[p] = eq === null ? undefined : { ...(out[p] ?? {}), ...eq };
  }
  return out;
}

// the klattsch bank fields that carry it: {CODE: fields to merge into the base bank's entry}
export function coartFields(o, has) {
  const fields = {};
  for (const v of VOWELS) if (has(v)) fields[v] = { vowel: true };
  const smooth = new Set(Object.values(LOCI).filter((x) => x.smooth).flatMap((x) => x.phones.split(' ')));
  for (const [p, locus] of Object.entries(lociOf(o))) if (locus && has(p)) fields[p] = { locus, ...(smooth.has(p) ? { smooth: true } : {}) };
  if (o.burst) for (const p of VELAR_STOPS) if (fields[p]) fields[p].locusBurst = true;
  if (o.hh && has('HH')) fields.HH = { transparent: true };
  return fields;
}

// the directives that switch it on in klattsch
export function coartDirectives(o) {
  const curve = curveCode(o.curve, 'curve'), fc = o.formantCurve === null ? curve : curveCode(o.formantCurve, 'formantCurve');
  return [`[CO=${o.degree}]`, o.codaDegree !== null && o.codaDegree !== o.degree ? `[COR=${o.codaDegree}]` : '',
    curve ? `[TC=${curve}]` : '', fc !== curve ? `[TCF=${fc}]` : '', `[COCV=${o.cv}]`, `[COVC=${o.vc}]`].filter(Boolean).join(' ');
}
