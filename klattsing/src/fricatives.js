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
  F:  { voicing: 0, A1: 0, A2: 0, A3: 0, frication: { FF1: 1500, BF1: 2000, AF1: 0.01, FF2: 5000, BF2: 4000, AF2: 0.01, FF3: 9500, BF3: 5000, AF3: 0.03, AB: 0 } },
  TH: { voicing: 0, A1: 0, A2: 0, A3: 0, frication: { FF1: 1500, BF1: 2000, AF1: 0.005, FF2: 5000, BF2: 4000, AF2: 0.008, FF3: 8500, BF3: 5000, AF3: 0.025, AB: 0 } },
  S:  { voicing: 0, A1: 0, A2: 0, A3: 0, frication: { FF1: 3600, BF1: 600, AF1: 0.03, FF2: 5300, BF2: 1500, AF2: 0.3, FF3: 9000, BF3: 4000, AF3: 0.12, AB: 0 } },
  SH: { voicing: 0, A1: 0, A2: 0, A3: 0, frication: { FF1: 2700, BF1: 500, AF1: 0.2, FF2: 3600, BF2: 1200, AF2: 0.3, FF3: 5200, BF3: 2500, AF3: 0.1, AB: 0 } },
  V:  { voicing: 1, F1: 220, BW1: 80, A1: 0.12, A2: 0, A3: 0, frication: { FF1: 1500, BF1: 2000, AF1: 0.003, FF2: 5000, BF2: 4000, AF2: 0.003, FF3: 9500, BF3: 5000, AF3: 0.008, AB: 0 } },
  DH: { voicing: 1, F1: 270, BW1: 80, A1: 0.1, A2: 0, A3: 0, frication: { FF1: 1500, BF1: 2000, AF1: 0.003, FF2: 5000, BF2: 4000, AF2: 0.003, FF3: 8500, BF3: 5000, AF3: 0.005, AB: 0 } },
  Z:  { voicing: 1, F1: 240, BW1: 80, A1: 0.12, A2: 0, A3: 0, frication: { FF1: 3600, BF1: 600, AF1: 0.02, FF2: 5000, BF2: 1500, AF2: 0.15, FF3: 9000, BF3: 4000, AF3: 0.06, AB: 0 } },
  ZH: { voicing: 1, F1: 270, BW1: 80, A1: 0.12, A2: 0, A3: 0, frication: { FF1: 2700, BF1: 500, AF1: 0.1, FF2: 3600, BF2: 1200, AF2: 0.15, FF3: 5200, BF3: 2500, AF3: 0.05, AB: 0 } },
};
const ENVELOPE = ['rise', 'fall', 'fallTo', 'fallToC', 'in'];
const FRIC_FIELDS = ['FF1', 'BF1', 'AF1', 'FF2', 'BF2', 'AF2', 'FF3', 'BF3', 'AF3', 'AB', ...ENVELOPE];
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
  const out = { ...FRICATIVES, phonemes: {} };
  for (const k of KEYS) if (x[k] != null) out[k] = x[k];
  return out;
}

// the klattsch directive that switches the frication path on
export const fricDirectives = (f) => (f ? `[FRIC=${f.gain}]` : '');

// the bank entries: each fricative's resolved base entry with FRICATION (and the option's envelope and phonemes)
// laid over it
export function fricEntries(resolved, f) {
  const phonemes = {};
  const env = Object.fromEntries(ENVELOPE.map((k) => [k, f[k]]));
  for (const code of FRIC_CODES) {
    const base = resolved.phonemes[code];
    if (!base) continue;
    const { frication: fr0, ...main } = FRICATION[code];
    const { frication: frX = {}, ...mainX } = f.phonemes[code] ?? {};
    const e = { ...base, ...main };
    for (const [k, v] of Object.entries(mainX)) { if (v === null) delete e[k]; else e[k] = v; }
    const fr = { ...fr0, ...env };
    for (const [k, v] of Object.entries(frX)) { if (v === null) delete fr[k]; else fr[k] = v; }
    e.frication = fr;
    phonemes[code] = e;
  }
  return phonemes;
}
