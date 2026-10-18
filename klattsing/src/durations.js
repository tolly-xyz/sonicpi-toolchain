// Klatt's segmental duration model (Klatt 1979; Allen, Hunnicutt & Klatt 1987, "From Text to Speech:
// The MITalk System", ch. 9, rules 2-11; cross-checked against Festival's Klatt.cc / klatt_durs.scm):
//   DUR = (INHDUR - MINDUR) * PRCNT + MINDUR, each rule multiplying PRCNT.
// Every factor is in RULES so tools/voicelab can tune them against a listener (Whisper).
import { DUR, VOWELS, VOICED, FRICATIVES, STOPS, NASALS, LIQUIDS, GLIDES, VOICELESS_STOPS } from './phones.js';

export const RULES = {
  phraseFinal: 1.4,           // 2: vowel of a phrase's last syllable and the consonants after it
  nonPhraseFinal: 0.6,        // 3: syllabic segments elsewhere
  nonWordFinal: 0.85,         // 4: syllabic segments not in a word's last syllable
  polysyllabic: 0.8,          // 5: syllabic segments in words of 2+ syllables
  nonInitialConsonant: 0.85,  // 6: consonants not word-initial
  unstressedMedial: 0.5,      // 7: unstressed (MINDUR halved): word-medial syllabic segment
  unstressedSyllabic: 0.7,    //    other syllabic segments
  unstressedLiquidGlide: 0.1, //    prevocalic liquid or glide
  unstressedOther: 0.7,       //    everything else
  openFinal: 1.2,             // 9: vowel ending a word (open syllable)
  beforeVoicedFricative: 1.6, beforeVoicedStop: 1.2, beforeNasal: 0.85, beforeVoicelessStop: 0.7,
  vowelBeforeVowel: 1.2, vowelAfterVowel: 0.7,     // 10: clusters
  consonantBetween: 0.5, consonantNext: 0.7,
  aspirationMs: 25,           // 11: a stressed vowel/sonorant after P/T/K is 25 ms longer (the aspiration)
};

// words: [{ syllables: [{ onset, nucleus, coda, stress }], punct }] -> each syllable gets
// { onsetMs: [], nucleusMs, codaMs: [], aspMs }
export function timeWords(words, rules = RULES) {
  words.forEach((w, wi) => {
    const syl = w.syllables;
    const phraseEnd = w.punct !== '' || wi === words.length - 1;
    const flat = syl.flatMap((s) => [...s.onset, s.nucleus, ...s.coda].filter(Boolean));
    let pos = 0;
    syl.forEach((s, si) => {
      const lastSyl = si === syl.length - 1, firstSyl = si === 0;
      const finalSyl = phraseEnd && lastSyl;
      const unstressed = s.stress === 0;
      const dur = (p, isVowel, inCoda) => {
        const [inh, min0] = DUR[p] ?? [80, 40];
        let k = 1, min = min0;
        const idx = pos, prev = flat[idx - 1], next = flat[idx + 1];
        const isC = (x) => x && !VOWELS.has(x), isV = (x) => x && VOWELS.has(x);
        if (isVowel) {
          k *= finalSyl ? rules.phraseFinal : rules.nonPhraseFinal;
          if (!lastSyl) k *= rules.nonWordFinal;
          if (syl.length > 1) k *= rules.polysyllabic;
          if (unstressed) { min /= 2; k *= !firstSyl && !lastSyl ? rules.unstressedMedial : rules.unstressedSyllabic; }
          let c = 1;                                    // 9: what follows the vowel
          if (!next) c = lastSyl ? rules.openFinal : 1;
          else if (isC(next)) {
            if (FRICATIVES.has(next) && VOICED.has(next)) c = rules.beforeVoicedFricative;
            else if (STOPS.has(next) && VOICED.has(next)) c = rules.beforeVoicedStop;
            else if (NASALS.has(next)) c = rules.beforeNasal;
            else if (VOICELESS_STOPS.has(next)) c = rules.beforeVoicelessStop;
          }
          k *= finalSyl ? c : 0.7 + 0.3 * c;            //    full at a phrase boundary, damped elsewhere
          if (isV(next)) k *= rules.vowelBeforeVowel;   // 10
          if (isV(prev)) k *= rules.vowelAfterVowel;
        } else {
          if (inCoda && finalSyl) k *= rules.phraseFinal;
          if (idx > 0) k *= rules.nonInitialConsonant;
          if (unstressed) {
            min /= 2;
            k *= (LIQUIDS.has(p) || GLIDES.has(p)) && isV(next) ? rules.unstressedLiquidGlide : rules.unstressedOther;
          }
          if (!(inCoda && finalSyl)) {                  // 10 (phrase-final codas exempt)
            if (isC(prev) && isC(next)) k *= rules.consonantBetween;
            else if (isC(prev) || isC(next)) k *= rules.consonantNext;
          }
        }
        pos++;
        return (inh - min) * k + min;
      };
      s.onsetMs = s.onset.map((p) => dur(p, false, false));
      s.nucleusMs = s.nucleus ? dur(s.nucleus, true, false) : 0;
      s.codaMs = s.coda.map((p) => dur(p, false, true));
      const last = s.onset[s.onset.length - 1];
      s.aspMs = !unstressed && VOICELESS_STOPS.has(last) && s.onset[s.onset.length - 2] !== 'S' ? rules.aspirationMs : 0;
    });
  });
  return words;
}
