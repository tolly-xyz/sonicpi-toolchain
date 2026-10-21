// "nasals": nasal murmurs with a nasal pole-zero pair and a place-dependent zero, and nasalized vowels next to
// nasal consonants (klattsch [NAS=x], a patch to the vendored engine: vendor/klattsch/VENDORED).
//   "nasals": true                                   the defaults below (NASALS, NASAL_MURMUR)
//   "nasals": { strength, vc, cv, transition, murmur: { M: {field: value}, ... }, nasalized: {FNP, BNP, FNZ, BNZ, AN, ...} }
// strength: [NAS=x], how strongly a vowel next to M/N/NG is nasalized (0: murmurs only); vc / cv: [NASVC] /
// [NASCV], the share of a vowel before / after a nasal consonant that is nasalized; transition: [NAST=ms], the
// transition into a nasal consonant and into the phoneme after it (default: klattsch's usual); murmur: fields laid over
// NASAL_MURMUR per nasal (any bank field: F1, BW1, A2, ... and the nasal ones; null removes one); nasalized: the
// nasal parameters of a fully nasalized vowel (bank field nasalizes on each nasal; klattsch's default FNP 250,
// BNP 100, FNZ 450, BNZ 100, AN 0). The murmur entries go into a generated bank "<base>--nas<hash>" that extends
// the spec's bank (before bankPatch, so a bankPatch can still change them, and before coarticulation).
//
// Engine parameters (Klatt 1980, "Software for a cascade/parallel formant synthesizer", JASA 67: FNP/BNP, FNZ/BNZ,
// AN): FNP/FNZ, a pole-zero pair in cascade with the excitation, both unity gain at 0 Hz: with the zero above the
// pole it lifts the lowest harmonics and takes 20 log((FNP / FNZ)^2) dB off everything above the zero. FNP2/FNZ2:
// a second pair, here a notch (pole and zero at one frequency, the pole broader), the antiresonance of the closed
// oral cavity, whose frequency marks the place of articulation (Fujimura 1962, JASA 34; Stevens 1998, Acoustic
// Phonetics, ch. 9). AN: a parallel nasal formant at FNP, fed by the excitation as A1-A3 are.
export const NASAL_MURMUR = {
  M: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 1000, BNP2: 600, FNZ2: 1000, BNZ2: 150 },
  N: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 1800, BNP2: 800, FNZ2: 1800, BNZ2: 200 },
  NG: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 3000, BNP2: 1000, FNZ2: 3000, BNZ2: 300 },
};
// the option's defaults ("nasals": true); vc / cv null: klattsch's own (0.5 / 0.3)
export const NASALS = { strength: 1, vc: null, cv: null, transition: null, nasalized: null };
const NASAL_FIELDS = ['FNP', 'BNP', 'FNZ', 'BNZ', 'AN', 'FNP2', 'BNP2', 'FNZ2', 'BNZ2'];
const KEYS = ['strength', 'vc', 'cv', 'transition', 'murmur', 'nasalized'];
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// "nasals": true | {...} -> the full option, or null (off)
export function nasalOptions(o) {
  if (!o.nasals) return null;
  const x = o.nasals === true ? {} : o.nasals;
  if (!isObj(x)) throw new Error(`nasals: true or an object, got ${JSON.stringify(o.nasals)}`);
  for (const k of Object.keys(x)) if (!KEYS.includes(k)) throw new Error(`nasals.${k}: unknown (${KEYS.join(', ')})`);
  for (const k of ['strength', 'vc', 'cv', 'transition']) {
    if (x[k] != null && !(typeof x[k] === 'number' && Number.isFinite(x[k]) && x[k] >= 0)) throw new Error(`nasals.${k}: a number >= 0`);
  }
  if (x.murmur != null) {
    if (!isObj(x.murmur)) throw new Error('nasals.murmur: {PHONE: {field: value}}');
    for (const [p, f] of Object.entries(x.murmur)) {
      if (!(p in NASAL_MURMUR)) throw new Error(`nasals.murmur.${p}: one of ${Object.keys(NASAL_MURMUR).join(', ')}`);
      if (!isObj(f)) throw new Error(`nasals.murmur.${p}: {field: value}`);
      for (const [k, v] of Object.entries(f)) {
        if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) throw new Error(`nasals.murmur.${p}.${k}: a number or null`);
      }
    }
  }
  if (x.nasalized != null) {
    if (!isObj(x.nasalized)) throw new Error('nasals.nasalized: {FNP, BNP, FNZ, BNZ, AN, ...}');
    for (const [k, v] of Object.entries(x.nasalized)) {
      if (!NASAL_FIELDS.includes(k)) throw new Error(`nasals.nasalized.${k}: unknown (${NASAL_FIELDS.join(', ')})`);
      if (!(typeof v === 'number' && Number.isFinite(v))) throw new Error(`nasals.nasalized.${k}: a number`);
    }
  }
  const out = { ...NASALS, murmur: {} };
  for (const k of KEYS) if (x[k] != null) out[k] = x[k];
  return out;
}

// the klattsch directives that switch the nasal rendering on
export function nasalDirectives(n) {
  if (!n) return '';
  return [`[NAS=${n.strength}]`, n.vc != null ? `[NASVC=${n.vc}]` : '', n.cv != null ? `[NASCV=${n.cv}]` : '',
    n.transition != null ? `[NAST=${n.transition}]` : ''].filter(Boolean).join(' ');
}

// the bank entries: each nasal's resolved base entry with the murmur fields (and nasal: true, nasalizes) laid over it
export function nasalEntries(resolved, n) {
  const phonemes = {};
  for (const code of Object.keys(NASAL_MURMUR)) {
    const base = resolved.phonemes[code];
    if (!base) continue;
    const e = { ...base, ...NASAL_MURMUR[code], nasal: true };
    for (const [k, v] of Object.entries(n.murmur[code] ?? {})) { if (v === null) delete e[k]; else e[k] = v; }
    if (n.nasalized) e.nasalizes = { ...n.nasalized };
    phonemes[code] = e;
  }
  return phonemes;
}
