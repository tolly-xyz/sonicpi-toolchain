// "nasals": nasal murmurs with a nasal pole-zero pair and a place-dependent zero, and nasalized vowels next to
// nasal consonants (klattsch [NAS=x], a patch to the vendored engine: vendor/klattsch/VENDORED).
//   "nasals": true                                   the defaults below
//   "nasals": { strength, vc, cv, murmur: { M: {field: value}, ... }, nasalized: {FNP, BNP, FNZ, BNZ, AN} }
// strength: [NAS=x], how strongly a vowel next to M/N/NG is nasalized (0: murmurs only); vc / cv: [NASVC] /
// [NASCV], the share of a vowel before / after a nasal consonant that is nasalized (klattsch's defaults 0.5 / 0.3
// when left out); murmur: fields laid over NASAL_MURMUR per phoneme (null removes one); nasalized: the nasal
// parameters of a fully nasalized vowel (klattsch's default FNP 250, BNP 100, FNZ 450, BNZ 100, AN 0).
// The murmur entries go into a generated bank "<base>--nas<hash>" that extends the spec's bank (before bankPatch,
// so a bankPatch can still change them).
//
// Engine parameters (Klatt 1980, "Software for a cascade/parallel formant synthesizer", JASA 67: FNP/BNP, FNZ/BNZ,
// AN): FNP/FNZ, a pole-zero pair in cascade with the excitation, both unity gain at 0 Hz: with the zero above the
// pole it lifts the lowest harmonics and takes 20 log((FNP / FNZ)^2) dB off everything above the zero, the murmur's
// low, heavily damped spectrum. FNP2/FNZ2: a second pair, here a notch (pole and zero at one frequency, the pole
// broader), the antiresonance of the closed oral cavity, whose frequency marks the place of articulation: about
// 750-1250 Hz for /m/, 1450-2200 Hz for /n/, above 3000 Hz for /ng/ (Fujimura 1962, JASA 34; Stevens 1998,
// Acoustic Phonetics, ch. 9). AN: a parallel nasal formant at FNP.
export const NASAL_MURMUR = {
  M: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 1000, BNP2: 600, FNZ2: 1000, BNZ2: 150 },
  N: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 1800, BNP2: 800, FNZ2: 1800, BNZ2: 200 },
  NG: { FNP: 270, BNP: 100, FNZ: 450, BNZ: 100, AN: 0, FNP2: 3000, BNP2: 1000, FNZ2: 3000, BNZ2: 300 },
};

export function nasalOptions(o) {
  if (!o.nasals) return null;
  const x = o.nasals === true ? {} : o.nasals;
  if (typeof x !== 'object' || Array.isArray(x)) throw new Error(`nasals: true or an object, got ${JSON.stringify(o.nasals)}`);
  for (const k of Object.keys(x)) {
    if (!['strength', 'vc', 'cv', 'murmur', 'nasalized'].includes(k)) throw new Error(`nasals.${k}: unknown (strength, vc, cv, murmur, nasalized)`);
  }
  for (const k of ['strength', 'vc', 'cv']) {
    if (x[k] != null && !(typeof x[k] === 'number' && Number.isFinite(x[k]) && x[k] >= 0)) throw new Error(`nasals.${k}: a number >= 0`);
  }
  return { strength: x.strength ?? 1, vc: x.vc ?? null, cv: x.cv ?? null, murmur: x.murmur ?? {}, nasalized: x.nasalized ?? null };
}

// the klattsch directives that switch the nasal rendering on
export function nasalDirectives(n) {
  if (!n) return '';
  return [`[NAS=${n.strength}]`, n.vc != null ? `[NASVC=${n.vc}]` : '', n.cv != null ? `[NASCV=${n.cv}]` : ''].filter(Boolean).join(' ');
}

// the bank entries: each nasal's resolved base entry with the murmur fields (and nasal: true, nasalizes) laid over it
export function nasalEntries(resolved, n) {
  const phonemes = {};
  for (const code of new Set([...Object.keys(NASAL_MURMUR), ...Object.keys(n.murmur)])) {
    const base = resolved.phonemes[code];
    if (!base) continue;
    const e = { ...base, ...NASAL_MURMUR[code], nasal: true };
    for (const [k, v] of Object.entries(n.murmur[code] ?? {})) { if (v === null) delete e[k]; else e[k] = v; }
    if (n.nasalized) e.nasalizes = { ...n.nasalized };
    phonemes[code] = e;
  }
  return phonemes;
}
