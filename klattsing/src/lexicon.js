// Words -> phonemes with lexical stress. CMUdict, overridden by project lexicons (JSON files of
// {"word": "L OW1 ER0"}), e.g. dict/lexicon.json for names, coinages and preferred pronunciations.
import { readFileSync, existsSync } from 'node:fs';
import { dictionary } from 'cmu-pronouncing-dictionary';

const extra = {};
let version = 0;                       // bumped by addLexicon, so callers can cache lookups
export const lexiconVersion = () => version;
export function addLexicon(path) {
  if (existsSync(path)) { Object.assign(extra, JSON.parse(readFileSync(path, 'utf8'))); version++; }
}

// "Lower the bucket," -> [{ word: 'lower', punct: '', phones: [{ p: 'L', stress: null }, { p: 'OW', stress: 1 }, ...] }, ...]
export function lookup(text) {
  const words = [];
  const missing = [];
  for (const m of text.matchAll(/([A-Za-z][A-Za-z']*)([^A-Za-z]*)/g)) {
    const word = m[1].toLowerCase();
    const entry = extra[word] ?? dictionary[word] ?? dictionary[word.replace(/'/g, '')];
    if (!entry) { missing.push(word); continue; }
    const phones = entry.trim().split(/\s+/).map((t) => {
      const s = t.match(/^([A-Z]+)([012])?$/);
      return { p: s[1], stress: s[2] === undefined ? null : Number(s[2]) };
    });
    words.push({ word, punct: m[2].trim(), phones });
  }
  if (missing.length) throw new Error(`not in the lexicon: ${missing.join(', ')} (add them to dict/lexicon.json)`);
  return words;
}
