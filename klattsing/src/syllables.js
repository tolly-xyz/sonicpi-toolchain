// A word's phonemes -> syllables { onset: [], nucleus, coda: [], stress } by maximal onset.
import { VOWELS, ONSETS } from './phones.js';

export function syllabify(phones) {
  const vi = phones.map((x, i) => (VOWELS.has(x.p) ? i : -1)).filter((i) => i >= 0);
  if (!vi.length) return [{ onset: phones.map((x) => x.p), nucleus: null, coda: [], stress: 0 }];
  const syl = [];
  let start = 0;
  vi.forEach((v, k) => {
    const next = vi[k + 1];
    let end;                                   // index after this syllable's coda
    if (next === undefined) end = phones.length;
    else {
      const between = phones.slice(v + 1, next).map((x) => x.p);
      let split = 0;                           // give the next syllable the longest legal onset
      while (split < between.length && !ONSETS.has(between.slice(split).join(' '))) split++;
      end = v + 1 + split;
    }
    syl.push({
      onset: phones.slice(start, v).map((x) => x.p),
      nucleus: phones[v].p,
      coda: phones.slice(v + 1, end).map((x) => x.p),
      stress: phones[v].stress ?? 0,
    });
    start = end;
  });
  return syl;
}
