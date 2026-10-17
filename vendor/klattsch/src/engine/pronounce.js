/**
 * English text to ARPABET lookup via the CMU Pronouncing Dictionary.
 *
 * import { pronounce } from 'klattsch/pronounce';
 * pronounce('hello')  // [{ code: 'HH', stressed: false }, { code: 'AH', stressed: false }, ...]
 * pronounce('computer') // [{ code: 'K', ... }, { code: 'AH', ... }, { code: 'M', ... }, ...]
 */

import { dictionary } from 'cmu-pronouncing-dictionary';

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY',
  'EH', 'ER', 'EY', 'IH', 'IY',
  'OW', 'OY', 'UH', 'UW',
]);

function parsePhone(raw) {
  const stress = raw.match(/[012]$/);
  const code = stress ? raw.slice(0, -1) : raw;
  if (!VOWELS.has(code) && code.length > 2) return null;
  return {
    code,
    stressed: stress ? stress[0] === '1' : false,
  };
}

export function pronounce(word) {
  const entry = dictionary[word.toLowerCase()];
  if (!entry) return null;
  const phones = entry.split(' ').map(parsePhone).filter(Boolean);
  return phones.length ? phones : null;
}

export function pronounceText(text) {
  return text.split(/\s+/).filter(Boolean).map(word => {
    const clean = word.replace(/[^a-zA-Z'-]/g, '');
    if (!clean) return null;
    const phones = pronounce(clean);
    return phones ? { word: clean, phones } : { word: clean, phones: null };
  }).filter(Boolean);
}

export function textToPhonemes(text) {
  const results = pronounceText(text);
  const phonemes = [];
  for (const { phones } of results) {
    if (!phones) continue;
    phonemes.push(...phones);
  }
  return phonemes;
}

export function hasWord(word) {
  return word.toLowerCase() in dictionary;
}
