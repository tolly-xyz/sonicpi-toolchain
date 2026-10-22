// Fricatives with their own noise spectra, levels and envelopes (the opt-in "fricatives" option), carried out by
// klattsch's frication path ([FRIC=x], a patch: vendor/klattsch/VENDORED).
//
// Without it a klattsch fricative is the white noise (1 - voicing) through the three formants F1-F3 that also
// carry the voice: one resonance per fricative (S at 5.5 kHz, SH 1.8-2.8 kHz, F and TH at 1-2.5 kHz), the voiced
// ones' noise tied to their voicing (0.45), and under the glottal option's noise low-pass (Klatt's soft low-pass,
// 15 dB at 3 kHz) nothing left above ~6 kHz. Measured against the Kokoro corpus (tools/voicelab/fricscope.py, BASE =
// kokoro-durations + mitalk-bursts + coarticulation + glottal + nasals + stops), F and TH peak at 1.1 / 2.6 kHz
// where Kokoro's are flat up to a rise at 7-10 kHz (Jongman, Wayland & Wong 2000, JASA 108: labiodental and
// interdental spectra flat and diffuse, peaks 7-8 kHz), SH at 1.8 kHz where Kokoro's is at 3.6 (Jongman et al.:
// 3.8 kHz), S lacks Kokoro's 6-11 kHz plateau, V and DH are 8-9 dB too loud against the vowels with 15-20 dB too much
// noise at 1.5-5 kHz (Kokoro's are a weak voice bar with little frication), Z's voicing is 7 dB too strong, and the
// sibilants rise slowly and stop abruptly where Kokoro's start at full strength and die away over their last third.
//
// With it each of F V TH DH S Z SH ZH gets an entry (a generated bank "<base>--fr<hash>" extending the spec's, after
// bankPatch, coarticulation and breath, so coarticulation's loci carry over) whose
//   - noise is the frication path's: white noise through three resonators of its own and a bypass (Klatt 1980's
//     parallel branch for frication; klattsch's main path keeps only the voice), the amplitudes fitted to Kokoro's
//     mean spectra re the neighbouring vowel's level (tools/voicelab/fricfit.py), so the level against the vowels
//     is Kokoro's too;
//   - voice is the main path's: voiced fricatives fully voiced (no main-path noise) through a low F1 (a voice bar)
//     at Kokoro's level under the vowel, with the frication independent of it (mixed voicing; under glottal the
//     noise is modulated by the glottal flow, as the voice source's own noise is); voiceless ones silent there;
//   - envelope: the frication starts at full strength within `rise` ms and dies away over the last `fall` of the
//     slot to `fallTo` of itself before a vowel-like sound (`fallToC` before a consonant or a pause): the
//     constriction opens and the next vowel's voicing takes over (Kokoro's sibilants: -2 dB at 10%, -4 / -8 / -14 dB
//     at 80 / 90 / 100% before a vowel, down 25 dB by the end before a consonant).
//   "fricatives": true                                the defaults below (FRICATIVES, FRICATION)
//   "fricatives": { gain, rise, fall, fallTo, fallToC, phonemes: { S: { field: value, frication: {...} } } }
// gain: [FRIC=x], all frication amplitudes times x; rise / fall / fallTo / fallToC: every fricative's envelope
// (a phoneme's own in phonemes.<P>.frication wins); phonemes: fields laid over FRICATION per fricative (bank fields,
// frication: {FF1, BF1, AF1, FF2, BF2, AF2, FF3, BF3, AF3, AB, rise, fall, fallTo, fallToC}; null removes one).
export const FRIC_CODES = ['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH'];
export const FRICATIVES = { gain: 1, rise: 5, fall: 0.3, fallTo: 0.3, fallToC: 0.05, in: 10 };
// per fricative: main-path fields (the voice) and the frication path's resonators (frequencies, bandwidths in Hz,
// amplitudes) and bypass
export const FRICATION = {
  F:  { voicing: 0, F1: 500, BW1: 600, A1: 0.01397, A2: 0, A3: 0, frication: { FF1: 2039, BF1: 3955, AF1: 0.01734, FF2: 3036, BF2: 395, AF2: 0.0156, FF3: 9521, BF3: 4027, AF3: 0.0182, AB: 0 } },
  TH: { voicing: 0, F1: 500, BW1: 600, A1: 0.01758, A2: 0, A3: 0, frication: { FF1: 1340, BF1: 150, AF1: 0.00844, FF2: 5104, BF2: 287, AF2: 0.02228, FF3: 9491, BF3: 4208, AF3: 0.01464, AB: 0.005074 } },
  S:  { voicing: 0, F1: 500, BW1: 600, A1: 0.03557, A2: 0, A3: 0, frication: { FF1: 1432, BF1: 176, AF1: 0.08834, FF2: 5000, BF2: 943, AF2: 0.1801, FF3: 9825, BF3: 8000, AF3: 0.04606, AB: 0 } },
  SH: { voicing: 0, F1: 500, BW1: 600, A1: 0.04, A2: 0, A3: 0, frication: { FF1: 1459, BF1: 150, AF1: 0.06405, FF2: 3382, BF2: 1470, AF2: 0.2144, FF3: 7014, BF3: 6998, AF3: 0.0151, AB: 0 } },
  V:  { voicing: 1, F1: 220, BW1: 80, A1: 0.0626, A2: 0, A3: 0, frication: { FF1: 1085, BF1: 150, AF1: 0.02341, FF2: 4968, BF2: 8000, AF2: 0.002387, FF3: 4859, BF3: 553, AF3: 0.001158, AB: 0.002867 } },
  DH: { voicing: 1, F1: 270, BW1: 80, A1: 0.0216, A2: 0, A3: 0, frication: { FF1: 703, BF1: 225, AF1: 0.0113, FF2: 1799, BF2: 521, AF2: 0.002361, FF3: 5075, BF3: 743, AF3: 0.001357, AB: 2.5e-05 } },
  Z:  { voicing: 1, F1: 240, BW1: 80, A1: 0.0699, A2: 0, A3: 0, frication: { FF1: 1392, BF1: 150, AF1: 0.05365, FF2: 4796, BF2: 3933, AF2: 0.1287, FF3: 4001, BF3: 2048, AF3: 0.1121, AB: 0.008041 } },
  ZH: { voicing: 1, F1: 270, BW1: 80, A1: 0.0699, A2: 0, A3: 0, frication: { FF1: 1459, BF1: 150, AF1: 0.0324, FF2: 3382, BF2: 1470, AF2: 0.1085, FF3: 7014, BF3: 6998, AF3: 0.007637, AB: 0 } },
};
const ENVELOPE = ['rise', 'fall', 'fallTo', 'fallToC', 'in'];
const FRIC_FIELDS = ['FF1', 'BF1', 'AF1', 'FF2', 'BF2', 'AF2', 'FF3', 'BF3', 'AF3', 'AB', 'FM', ...ENVELOPE];
const KEYS = ['gain', ...ENVELOPE, 'phonemes'];
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// "fricatives": true | {...} -> the full option, or null (off)
export function fricOptions(o) {
  if (!o.fricatives) return null;
  const x = o.fricatives === true ? {} : o.fricatives;
  if (!isObj(x)) throw new Error(`fricatives: true or an object, got ${JSON.stringify(o.fricatives)}`);
  for (const k of Object.keys(x)) if (!KEYS.includes(k)) throw new Error(`fricatives.${k}: unknown (${KEYS.join(', ')})`);
  for (const k of ['gain', ...ENVELOPE]) if (x[k] != null && !(num(x[k]) && x[k] >= 0)) throw new Error(`fricatives.${k}: a number >= 0`);
  if (x.phonemes != null) {
    if (!isObj(x.phonemes)) throw new Error('fricatives.phonemes: {PHONE: {field: value}}');
    for (const [p, f] of Object.entries(x.phonemes)) {
      if (!FRIC_CODES.includes(p)) throw new Error(`fricatives.phonemes.${p}: one of ${FRIC_CODES.join(', ')}`);
      if (!isObj(f)) throw new Error(`fricatives.phonemes.${p}: {field: value}`);
      for (const [k, v] of Object.entries(f)) {
        if (k === 'frication') {
          if (!isObj(v)) throw new Error(`fricatives.phonemes.${p}.frication: {${FRIC_FIELDS.join(', ')}}`);
          for (const [q, w] of Object.entries(v)) {
            if (!FRIC_FIELDS.includes(q)) throw new Error(`fricatives.phonemes.${p}.frication.${q}: unknown (${FRIC_FIELDS.join(', ')})`);
            if (w !== null && !num(w)) throw new Error(`fricatives.phonemes.${p}.frication.${q}: a number or null`);
          }
        } else if (v !== null && !num(v)) throw new Error(`fricatives.phonemes.${p}.${k}: a number or null`);
      }
    }
  }
  // env: the envelope fields the option sets (over every fricative's own); phonemes: the per-fricative fields
  const out = { gain: x.gain ?? FRICATIVES.gain, env: {}, phonemes: x.phonemes ?? {} };
  for (const k of ENVELOPE) if (x[k] != null) out.env[k] = x[k];
  return out;
}

// the klattsch directive that switches the frication path on
export const fricDirectives = (f) => (f ? `[FRIC=${f.gain}]` : '');

// the bank entries: each fricative's resolved base entry with FRICATION (and the option's envelope and phonemes)
// laid over it
export function fricEntries(resolved, f) {
  const phonemes = {};
  const env0 = Object.fromEntries(ENVELOPE.map((k) => [k, FRICATIVES[k]]));
  for (const code of FRIC_CODES) {
    const base = resolved.phonemes[code];
    if (!base) continue;
    const { frication: fr0, ...main } = FRICATION[code];
    const { frication: frX = {}, ...mainX } = f.phonemes[code] ?? {};
    const e = { ...base, ...main };
    for (const [k, v] of Object.entries(mainX)) { if (v === null) delete e[k]; else e[k] = v; }
    // the envelope: the defaults, the fricative's own (FRICATION), the option's, phonemes.<P>.frication
    const fr = { ...env0, ...fr0, ...f.env };
    for (const [k, v] of Object.entries(frX)) { if (v === null) delete fr[k]; else fr[k] = v; }
    e.frication = fr;
    phonemes[code] = e;
  }
  return phonemes;
}
