// Klatt's segmental duration model (Klatt 1976, 1979; MITalk ch. 9): each phoneme starts from its
// inherent duration and context rules scale the part above its minimum:  DUR = (INH - MIN) * k + MIN.
// Every factor is in RULES so tools/voicelab can tune them against a listener (Whisper).
import { DUR, VOWELS, VOICED, FRICATIVES, STOPS, NASALS, VOICELESS_STOPS } from './phones.js';

export const RULES = {
  phraseFinal: 1.4,          // nucleus and coda of a phrase's last syllable
  nonPhraseFinal: 0.6,       // vowels elsewhere
  nonWordFinal: 0.85,        // vowels not in a word's last syllable
  polysyllabic: 0.8,         // vowels in words of 2+ syllables
  nonInitialConsonant: 0.85, // consonants not word-initial
  unstressedVowel: 0.5,      // and its minimum halves
  secondaryVowel: 0.75,
  unstressedConsonant: 0.7,  // consonants in unstressed syllables
  beforeVoicedFricative: 1.6, beforeVoicedStop: 1.2, beforeNasal: 0.85, beforeVoicelessStop: 0.7,
  cluster: 0.7,              // a consonant next to another consonant in the same word
  aspirationMs: 30,          // breath after P/T/K opening a stressed syllable (not after S)
};

// words: [{ syllables: [{ onset, nucleus, coda, stress }], punct }] -> same, each syllable gets
// { onsetMs: [], nucleusMs, codaMs: [], aspMs }
export function timeWords(words, rules = RULES) {
  words.forEach((w, wi) => {
    const syl = w.syllables;
    const phraseEnd = w.punct !== '' || wi === words.length - 1;
    const flat = syl.flatMap((s) => [...s.onset, s.nucleus, ...s.coda].filter(Boolean));
    let pos = 0;
    syl.forEach((s, si) => {
      const lastSyl = si === syl.length - 1;
      const stressed = s.stress > 0;
      const dur = (p, isVowel, inCoda) => {
        const [inh, min0] = DUR[p] ?? [80, 40];
        let k = 1, min = min0;
        const idx = pos;
        if (isVowel) {
          if (phraseEnd && lastSyl) k *= rules.phraseFinal; else k *= rules.nonPhraseFinal;
          if (!lastSyl) k *= rules.nonWordFinal;
          if (syl.length > 1) k *= rules.polysyllabic;
          if (s.stress === 0) { k *= rules.unstressedVowel; min /= 2; } else if (s.stress === 2) k *= rules.secondaryVowel;
          const next = flat[idx + 1];
          if (next && !VOWELS.has(next)) {
            if (FRICATIVES.has(next) && VOICED.has(next)) k *= rules.beforeVoicedFricative;
            else if (STOPS.has(next) && VOICED.has(next)) k *= rules.beforeVoicedStop;
            else if (NASALS.has(next)) k *= rules.beforeNasal;
            else if (VOICELESS_STOPS.has(next)) k *= rules.beforeVoicelessStop;
          }
        } else {
          if (idx > 0) k *= rules.nonInitialConsonant;
          if (!stressed) k *= rules.unstressedConsonant;
          const prev = flat[idx - 1], next = flat[idx + 1];
          if ((prev && !VOWELS.has(prev)) || (next && !VOWELS.has(next))) k *= rules.cluster;
          if (inCoda && phraseEnd && lastSyl) k *= rules.phraseFinal;
        }
        pos++;
        return (inh - min) * k + min;
      };
      s.onsetMs = s.onset.map((p) => dur(p, false, false));
      s.nucleusMs = s.nucleus ? dur(s.nucleus, true, false) : 0;
      s.codaMs = s.coda.map((p) => dur(p, false, true));
      const last = s.onset[s.onset.length - 1];
      s.aspMs = stressed && VOICELESS_STOPS.has(last) && s.onset[s.onset.length - 2] !== 'S' ? rules.aspirationMs : 0;
    });
  });
  return words;
}
