// Connected-speech forms (the opt-in "reductions" option): CMUdict gives citation forms ("to" T UW1, "was" W AA1 Z,
// "for" F AO1 R, "can" K AE1 N), but in running speech the unstressed function words take their weak forms ("to" tə,
// "was" wəz, "for" fɚ, "can" kən), "the" is ði before a vowel, and a heteronym's reading follows its context ("read"
// the verb, "their lives" the noun). With the option every word of a phrase is looked at in its context, after the
// lexicon and before syllables are timed:
//   weak      a function word in WEAK (true; "all": WEAK_ALL, with to / into / do, which need a schwa the banks
//             do not have, below) takes its weak form unless it ends a phrase (punctuation or the text's end:
//             "who is it for?", "faced us."), where English uses the strong form (Jones 1956 / EPD; Gimson 1962,
//             Cruttenden 2014 §12.3; Roach 2009 ch. 12, whose list this follows; American forms after Kenyon &
//             Knott 1953: rhotic "for" fɚ, "are" ɚ, "your" jɚ, "or" ɚ). Context-dependent ones (STRONG_UNLESS):
//             "that" only as a conjunction or relative (before a determiner or a subject pronoun: "said that the",
//             not "that year"), "there" only existential (before a form of be or a modal), "some" not before
//             "of", have/has/had only as auxiliaries (before "been" or a participle-like word, not "have to"),
//             do/does only before "not" or a subject pronoun (you / it in a question only: not "do it now"). The
//             weak syllable is unstressed (stress 0).
//             `weak: {word: "PHONES" | ["before a consonant", "before a vowel"] | null}` changes or removes entries of WEAK
//             (the vowel count must stay the citation form's: sing gives every syllable a note).
//   the       "the" before a vowel: DH IY0 ("IY", the default; Jones, Gimson, Roach), DH IH0 ("IH", Kokoro's ði
//             / ðɪ) or false (DH AH0 everywhere)
//   heteronyms read / lives / live / close / use / used / wind / tear / lead / perfect and the stress-shifting
//             noun-verb pairs (record, present, object, ...) read by their neighbours (HETERONYMS): a verb after
//             "to", a modal or do, or a subject pronoun, or with an object after it (a determiner or object
//             pronoun next, nothing determiner-like before: "always close the door", "Use a pencil"); a noun or
//             adjective after a determiner; "read" past after be/have and he/she/it, else present; "used" yuːst
//             before "to" unless after be/get ("I used to", not "is used to catch"); "lead" L IY D but the metal
//             in its contexts ("lead pipe", "made of lead"); else the entry's default
//   hDrop     (off) him / his / her / have / has / had lose their H inside a phrase when weak ("tell 'im";
//             Roach 2009, Cruttenden 2014: usual in unstressed pronouns and auxiliaries, not phrase-initially)
//   elision   (off) "and" loses its D before a consonant (ən: the most frequent -t/-d deletion of all, Neu 1980,
//             Guy 1980), "must" its T before a consonant
//   assimilation (off) a word-final N takes the place of a following word-initial labial (M before P B M) or
//             velar (NG before K G) in the same phrase ("ten pins", "in case"; regressive place assimilation of
//             word-final alveolars, Gimson 1962; gradient and optional, Nolan 1992, Ellis & Hardcastle 2002: off)
// Not here (elsewhere): the duration of function words (functionWords), the flapped T/D (stops: DQF, acoustically;
// the lexical phoneme stays T/D). The number of syllables never changes, so sing's notes still fit.
import { syllabify } from './syllables.js';
import { VOWELS } from './phones.js';
import { lexiconHas } from './lexicon.js';

export const REDUCTIONS = { weak: true, the: 'IY', heteronyms: true, hDrop: false, elision: false, assimilation: false };
const KEYS = Object.keys(REDUCTIONS);

// weak forms: one form, or [before a consonant, before a vowel] (Roach 2009 ch. 12; Kenyon & Knott 1953): the full
// table (`weak: "all"`)
export const WEAK_ALL = {
  a: 'AH0', an: 'AH0 N', the: 'DH AH0',
  and: 'AH0 N D', but: 'B AH0 T', or: 'ER0', nor: 'N ER0', than: 'DH AH0 N', that: 'DH AH0 T', as: 'AH0 Z',
  at: 'AH0 T', for: 'F ER0', from: 'F R AH0 M', of: 'AH0 V', to: ['T AH0', 'T UW0'], into: ['IH0 N T AH0', 'IH0 N T UW0'],
  some: 'S AH0 M', there: 'DH ER0',
  am: 'AH0 M', are: 'ER0', is: 'IH0 Z', was: 'W AH0 Z', were: 'W ER0', be: 'B IY0', been: 'B IH0 N',
  can: 'K AH0 N', could: 'K AH0 D', would: 'W AH0 D', should: 'SH AH0 D', shall: 'SH AH0 L', must: 'M AH0 S T', will: 'W AH0 L',
  do: ['D AH0', 'D UW0'], does: 'D AH0 Z', have: 'HH AH0 V', has: 'HH AH0 Z', had: 'HH AH0 D',
  he: 'HH IY0', she: 'SH IY0', we: 'W IY0', me: 'M IY0', you: 'Y UW0',
  him: 'HH IH0 M', his: 'HH IH0 Z', her: 'HH ER0', them: 'DH AH0 M', us: 'AH0 S', your: 'Y ER0',
};
// The default table (`weak: true`) leaves out to / into / do: their weak vowel is a schwa, and klattsch's banks have
// none: AH0 is rendered as AH, [ʌ] (F1 620 Hz), so tə comes out as an open "tuh", further from Kokoro's tə than
// the short unstressed T UW0 is (the vowel's MCD to Kokoro 3.55 -> 3.83 dB over the corpus's 18) and harder for
// Whisper (Harvard sentences whose only change is "to": 6 worse, 2 better). With a schwa-like unstressed AH (a
// vowel bank that has one), `weak: "all"` gives them back.
export const NEEDS_SCHWA = ['to', 'into', 'do'];
export const WEAK = Object.fromEntries(Object.entries(WEAK_ALL).filter(([w]) => !NEEDS_SCHWA.includes(w)));

const set = (s) => new Set(s.split(' '));
const SUBJECT_STRICT = set("i he she we they");
const SUBJECT_BASE = set("i you we they who");                     // a base-form verb can follow
const SUBJECT_3 = set("he she it who that which one everyone someone nobody everybody somebody");   // a verb in -s
const MODAL_TO = set("to will would can could shall should may might must do does did don't doesn't didn't won't can't cannot couldn't wouldn't shouldn't mustn't let's please not never");
const BE = set("am is are was were be been being isn't aren't wasn't weren't");
const HAVE = set("have has had having haven't hasn't hadn't");
const GET = set("get gets got gotten getting");
const DET = set("a an the this these those my your his her its our their whose no every each some any many few several all both either neither another such own one two three four five six seven eight nine ten twelve twenty hundred thousand of");
const OBJECT = set("me you him her it us them this that these those myself yourself himself herself itself ourselves themselves");
const EXISTENTIAL_NEXT = set("is are was were will would can could must may might should has have had seems seem seemed appears appear isn't aren't wasn't weren't won't");
const CONJ_NEXT = set("the a an i you he she it we they there his her my our their its this these those some no every all one nothing everyone someone");
const AUX_NEXT = set("been got gotten had done seen gone made come become known taken given never not just already ever always also");

// strong (citation) forms unless the context says otherwise: (prev, next) -> true when the weak form applies
const STRONG_UNLESS = {
  that: (prev, next) => CONJ_NEXT.has(next),
  there: (prev, next) => EXISTENTIAL_NEXT.has(next),
  some: (prev, next) => next !== 'of',
  have: (prev, next) => aux(next), has: (prev, next) => aux(next), had: (prev, next) => aux(next),
  do: (prev, next, q) => auxDo(next, q), does: (prev, next, q) => auxDo(next, q),
};
// do / does as an auxiliary: before "not" or a subject pronoun ("you" and "it" only in a question: "do it now")
const auxDo = (next, question) => next === 'not' || SUBJECT_STRICT.has(next) || (question && (next === 'you' || next === 'it'));
const aux = (next) => next !== 'to' && (AUX_NEXT.has(next) || (next.length > 4 && /(ed|en|wn)$/.test(next)));
const H_DROP = set('him his her have has had');

// heteronyms: { noun, verb, def } (def: the form when the context says neither) or a rule of its own
const nv = (noun, verb, def = 'noun') => ({ noun, verb, def });
export const HETERONYMS = {
  close: nv('K L OW1 S', 'K L OW1 Z'), use: nv('Y UW1 S', 'Y UW1 Z'), excuse: nv('IH0 K S K Y UW1 S', 'IH0 K S K Y UW1 Z'),
  abuse: nv('AH0 B Y UW1 S', 'AH0 B Y UW1 Z'), live: nv('L AY1 V', 'L IH1 V'), wind: nv('W IH1 N D', 'W AY1 N D'),
  tear: nv('T IH1 R', 'T EH1 R'), lead: 'lead', perfect: nv('P ER1 F IH2 K T', 'P ER0 F EH1 K T'),
  // noun-verb stress pairs: the noun stressed on the first syllable, the verb on the second
  record: nv('R EH1 K ER0 D', 'R IH0 K AO1 R D'), present: nv('P R EH1 Z AH0 N T', 'P R IY0 Z EH1 N T'),
  object: nv('AA1 B JH EH0 K T', 'AH0 B JH EH1 K T'), permit: nv('P ER1 M IH2 T', 'P ER0 M IH1 T'),
  produce: nv('P R OW1 D UW0 S', 'P R AH0 D UW1 S'), project: nv('P R AA1 JH EH0 K T', 'P R AH0 JH EH1 K T'),
  refuse: nv('R EH1 F Y UW2 S', 'R IH0 F Y UW1 Z', 'verb'), conduct: nv('K AA1 N D AH0 K T', 'K AH0 N D AH1 K T'),
  contract: nv('K AA1 N T R AE2 K T', 'K AH0 N T R AE1 K T'), increase: nv('IH1 N K R IY2 S', 'IH2 N K R IY1 S'),
  decrease: nv('D IY1 K R IY2 S', 'D IH0 K R IY1 S'), insult: nv('IH1 N S AH2 L T', 'IH2 N S AH1 L T'),
  progress: nv('P R AA1 G R EH2 S', 'P R AH0 G R EH1 S'), rebel: nv('R EH1 B AH0 L', 'R IH0 B EH1 L'),
  subject: nv('S AH1 B JH IH0 K T', 'S AH0 B JH EH1 K T'), convict: nv('K AA1 N V IH0 K T', 'K AH0 N V IH1 K T'),
  conflict: nv('K AA1 N F L IH0 K T', 'K AH0 N F L IH1 K T'), contest: nv('K AA1 N T EH0 S T', 'K AH0 N T EH1 S T'),
  import: nv('IH1 M P AO2 R T', 'IH2 M P AO1 R T'), extract: nv('EH1 K S T R AE2 K T', 'IH0 K S T R AE1 K T'),
  protest: nv('P R OW1 T EH2 S T', 'P R AH0 T EH1 S T'), suspect: nv('S AH1 S P EH2 K T', 'S AH0 S P EH1 K T'),
  desert: nv('D EH1 Z ER0 T', 'D IH0 Z ER1 T'),
  // -s forms: a verb only after a third-person subject
  lives: { noun: 'L AY1 V Z', verb: 'L IH1 V Z', def: 'verb', third: true }, tears: { noun: 'T IH1 R Z', verb: 'T EH1 R Z', def: 'noun', third: true },
  records: { noun: 'R EH1 K ER0 D Z', verb: 'R IH0 K AO1 R D Z', def: 'noun', third: true },
  presents: { noun: 'P R EH1 Z AH0 N T S', verb: 'P R IY0 Z EH1 N T S', def: 'noun', third: true },
  objects: { noun: 'AA1 B JH EH0 K T S', verb: 'AH0 B JH EH1 K T S', def: 'noun', third: true },
  read: 'read', used: 'used',
};
// "lead": L IY1 D (the verb, and the noun of "take the lead", "the lead role"), the metal L EH1 D only in its
// contexts: before a noun it makes ("lead pipe", "lead poisoning"), after "of" ("made of lead") and in black /
// red / white lead (graphite, the pigments)
const METAL_NEXT = set('pipe pipes paint pencil pencils poisoning weight weights shot ore mine mines crystal oxide foil sinker sinkers soldier soldiers');
const METAL_PREV = set('of black red white');

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const vowelsIn = (pron) => pron.split(' ').filter((t) => VOWELS.has(t.replace(/\d$/, ''))).length;
const PHONES = /^[A-Z]{1,2}[012]?( [A-Z]{1,2}[012]?)*$/;

// "reductions": true | { weak, the, heteronyms, hDrop, elision, assimilation } -> the full options, or null (off)
export function reductionOptions(x) {
  if (!x) return null;
  if (x !== true && !isObj(x)) throw new Error(`reductions: true or an object, got ${JSON.stringify(x)}`);
  const o = { ...REDUCTIONS };
  for (const [k, v] of Object.entries(x === true ? {} : x)) {
    if (!KEYS.includes(k)) throw new Error(`reductions.${k}: unknown (${KEYS.join(', ')})`);
    if (v != null) o[k] = v;
  }
  for (const k of ['heteronyms', 'hDrop', 'elision', 'assimilation']) {
    if (typeof o[k] !== 'boolean') throw new Error(`reductions.${k}: true or false, got ${JSON.stringify(o[k])}`);
  }
  if (![false, 'IY', 'IH'].includes(o.the)) throw new Error(`reductions.the: "IY", "IH" or false, got ${JSON.stringify(o.the)}`);
  o.custom = new Set();
  if (o.weak === true) o.weak = WEAK;
  else if (o.weak === 'all') o.weak = WEAK_ALL;
  else if (o.weak === false) o.weak = {};
  else if (isObj(o.weak)) {
    const w = { ...WEAK };
    for (const [word, f] of Object.entries(o.weak)) {
      const forms = f === null ? null : Array.isArray(f) ? f : [f];
      if (forms && !(forms.length >= 1 && forms.length <= 2 && forms.every((s) => typeof s === 'string' && PHONES.test(s.trim())))) {
        throw new Error(`reductions.weak.${word}: ARPABET ("T AH0") or [before a consonant, before a vowel], got ${JSON.stringify(f)}`);
      }
      if (forms) { w[word.toLowerCase()] = forms.length === 1 ? forms[0].trim() : forms.map((s) => s.trim()); o.custom.add(word.toLowerCase()); }
      else delete w[word.toLowerCase()];
    }
    o.weak = w;
  } else throw new Error(`reductions.weak: true, "all", false or {word: phones}, got ${JSON.stringify(o.weak)}`);
  return o;
}

const parsePron = (s) => s.split(' ').map((t) => { const m = t.match(/^([A-Z]+)([012])?$/); return { p: m[1], stress: m[2] === undefined ? null : Number(m[2]) }; });
const sylCache = new Map();
const syllables = (phones) => {
  const k = phones.map((x) => x.p + (x.stress ?? '')).join(' ');
  let s = sylCache.get(k);
  if (!s) { s = syllabify(phones); if (sylCache.size > 5000) sylCache.clear(); sylCache.set(k, s); }
  return s.map((x) => ({ ...x, onset: x.onset.slice(), coda: x.coda.slice() }));
};
const startsWithVowel = (w) => !!w && VOWELS.has(w.phones[0]?.p);

// one word's heteronym reading in its context (prev/next: the neighbouring words in its phrase, '' at its edges)
function heteronym(word, prev, next) {
  const h = HETERONYMS[word];
  if (!h) return null;
  if (h === 'read') {
    if (BE.has(prev) || HAVE.has(prev) || SUBJECT_3.has(prev)) return 'R EH1 D';
    return 'R IY1 D';
  }
  if (h === 'lead') return METAL_NEXT.has(next) || METAL_PREV.has(prev) ? 'L EH1 D' : 'L IY1 D';
  if (h === 'used') {
    const accustomed = BE.has(prev) || GET.has(prev);
    return next === 'to' && !accustomed ? 'Y UW1 S T' : 'Y UW1 Z D';
  }
  if (h.third) {
    if (SUBJECT_3.has(prev)) return h.verb;
    if (DET.has(prev)) return h.noun;
    return h[h.def];
  }
  if (MODAL_TO.has(prev) || SUBJECT_BASE.has(prev)) return h.verb;
  if (DET.has(prev)) return h.noun;
  if ((DET.has(next) || OBJECT.has(next)) && next !== 'of') return h.verb;   // an object follows: "close the door", "Use a pencil"
  return h[h.def];
}

// words (lookup + syllables) -> the same with reduced forms; unchanged words are passed through as they are.
// A word in a project lexicon (dict/lexicon.json) keeps its pronunciation unless it is a weak function word.
export function reduceWords(ws, o) {
  const out = ws.slice();
  const phraseEnd = (i) => i === ws.length - 1 || ws[i].punct !== '';
  const phraseStart = (i) => i === 0 || ws[i - 1].punct !== '';
  const question = (i) => { while (i < ws.length - 1 && !/[.!?]/.test(ws[i].punct)) i++; return ws[i].punct.includes('?'); };
  // right to left: a word's form can depend on the next word's (reduced) first phoneme
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i], word = w.word;
    const prev = phraseStart(i) ? '' : ws[i - 1].word, next = phraseEnd(i) ? '' : ws[i + 1].word;
    const nextW = phraseEnd(i) ? null : out[i + 1];
    let pron = null, weak = false;
    const f = o.weak[word];
    if (f && !phraseEnd(i) && (!STRONG_UNLESS[word] || STRONG_UNLESS[word](prev, next, question(i)))) {
      pron = Array.isArray(f) ? f[startsWithVowel(nextW) ? 1 : 0] : f;
      weak = true;
      if (o.hDrop && H_DROP.has(word) && !phraseStart(i)) pron = pron.replace(/^HH /, '');
      if (o.elision && nextW && !startsWithVowel(nextW)) {
        if (word === 'and') pron = pron.replace(/ D$/, '');
        if (word === 'must') pron = pron.replace(/ T$/, '');
      }
    }
    if (word === 'the' && o.the && !phraseEnd(i) && startsWithVowel(nextW)) { pron = o.the === 'IY' ? 'DH IY0' : 'DH IH0'; weak = true; }
    if (!pron && o.heteronyms && HETERONYMS[word] && !lexiconHas(word)) pron = heteronym(word, prev, next);
    // a form with another number of syllables than the word's own (a project lexicon's) is not used; one given in
    // the option is an error
    if (pron && vowelsIn(pron) !== w.phones.filter((x) => VOWELS.has(x.p)).length) {
      if (o.custom.has(word) && weak) throw new Error(`reductions.weak.${word}: "${pron}" has ${vowelsIn(pron)} syllables, "${word}" ${w.phones.filter((x) => VOWELS.has(x.p)).length} (sing gives each a note)`);
      pron = null; weak = false;
    }
    let phones = pron ? parsePron(pron) : w.phones;
    if (weak) phones = phones.map((x) => (x.stress === null ? x : { ...x, stress: 0 }));
    // assimilation: a word-final N takes the place of the next word's initial labial or velar
    const first = nextW?.phones[0]?.p;
    if (o.assimilation && phones[phones.length - 1]?.p === 'N' && (first === 'P' || first === 'B' || first === 'M' || first === 'K' || first === 'G')) {
      phones = [...phones.slice(0, -1), { p: first === 'K' || first === 'G' ? 'NG' : 'M', stress: null }];
    }
    if (phones === w.phones) continue;
    const same = phones.length === w.phones.length && phones.every((x, k) => x.p === w.phones[k].p && x.stress === w.phones[k].stress);
    if (!same) out[i] = { ...w, phones, syllables: syllables(phones) };
  }
  return out;
}
