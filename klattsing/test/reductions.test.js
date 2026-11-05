// "reductions" (src/reductions.js): weak forms of function words in context, "the" before a vowel, heteronyms by
// context, and the opt-in h-dropping, elision and nasal place assimilation; inert unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { words, speak, sing, toKlattsch, durationsOf } from '../src/compile.js';
import { reductionOptions, reduceWords, WEAK, WEAK_ALL, NEEDS_SCHWA, HETERONYMS, REDUCTIONS } from '../src/reductions.js';
import { lookup, addLexicon } from '../src/lexicon.js';
import { syllabify } from '../src/syllables.js';
import { timelineOf } from '../src/timeline.js';
import { compileString } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
// the words of text as "PH ON0 ES" strings (stress digits on vowels), with option r
const pron = (text, r = true, o = {}) => words(text, null, null, { reductions: r, ...o })
  .map((w) => w.syllables.flatMap((s) => [...s.onset, ...(s.nucleus ? [s.nucleus + s.stress] : []), ...s.coda]).join(' '));
const at = (text, word, r = true) => { const ws = text.toLowerCase().match(/[a-z']+/g); return pron(text, r)[ws.indexOf(word)]; };

test('defaults: no reductions option (or false / null) gives the reference strings', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, reductions: false }), out);
    assert.equal(toKlattsch({ ...spec, reductions: null }), out);
  }
  assert.deepEqual(pron('It was to be.', false), ['IH1 T', 'W AA1 Z', 'T UW1', 'B IY1']);
});

test('weak forms inside a phrase, the strong (citation) form at its end', () => {
  assert.deepEqual(pron("It's easy to tell the depth of a well.", { weak: 'all' }), ['IH1 T S', 'IY1 Z IY0', 'T AH0', 'T EH1 L', 'DH AH0', 'D EH1 P TH', 'AH0 V', 'AH0', 'W EH1 L']);
  // the default table leaves out to / into / do (their schwa would be rendered as an open AH): citation forms
  assert.deepEqual(pron("It's easy to tell the depth of a well."), ['IH1 T S', 'IY1 Z IY0', 'T UW1', 'T EH1 L', 'DH AH0', 'D EH1 P TH', 'AH0 V', 'AH0', 'W EH1 L']);
  assert.deepEqual(NEEDS_SCHWA.filter((w) => w in WEAK), []);
  assert.deepEqual(Object.keys(WEAK_ALL).filter((w) => !(w in WEAK)).sort(), [...NEEDS_SCHWA].sort());
  assert.equal(at('Do you see?', 'do'), 'D UW1');
  assert.equal(at('Cut the pie into large parts.', 'into'), 'IH1 N T UW0');
  assert.equal(at('The box was thrown.', 'was'), 'W AH0 Z');
  assert.equal(at('Read verse for pleasure.', 'for'), 'F ER0');
  assert.equal(at('Who is it for?', 'for'), 'F AO1 R');          // stranded: strong
  assert.equal(at('Four hours of steady work faced us.', 'us'), 'AH1 S');
  assert.equal(at('He can go.', 'can'), 'K AH0 N');
  assert.equal(at('Yes, he can.', 'can'), 'K AE1 N');
  assert.equal(at('More than two.', 'than'), 'DH AH0 N');
  assert.equal(at('I want them home.', 'them'), 'DH AH0 M');
  assert.equal(at('Hoist the load to your left shoulder.', 'your'), 'Y ER0');
  // "to" / "do" / "into" (weak: "all"): [before a consonant, before a vowel]
  const all = { weak: 'all' };
  assert.equal(at('Go to bed.', 'to', all), 'T AH0');
  assert.equal(at('Go to it now.', 'to', all), 'T UW0');
  assert.equal(at('Do you see?', 'do', all), 'D AH0');
  assert.equal(at('Do I see?', 'do', all), 'D UW0');
  assert.equal(at('Cut the pie into large parts.', 'into', all), 'IH0 N T AH0');
  // a weak syllable is unstressed whether or not functionWords is on
  assert.equal(words('It was red.', null, null, { reductions: true })[1].syllables[0].stress, 0);
});

test('weak forms by context: that, there, some, have / has / had, do / does', () => {
  assert.equal(at('He said that the man went.', 'that'), 'DH AH0 T');    // conjunction
  assert.equal(at('The term ended in late June that year.', 'that'), 'DH AE1 T');   // demonstrative
  assert.equal(at('That is fine.', 'that'), 'DH AE1 T');
  assert.equal(at('There are more than two factors here.', 'there'), 'DH ER0');   // existential
  assert.equal(at('Put it there now.', 'there'), 'DH EH1 R');
  assert.equal(at('Some men left.', 'some'), 'S AH0 M');
  assert.equal(at('Some of them left.', 'some'), 'S AH1 M');
  assert.equal(at('They have been there.', 'have'), 'HH AH0 V');      // auxiliary
  assert.equal(at('They have a dog.', 'have'), 'HH AE1 V');           // main verb
  assert.equal(at('She has to go.', 'has'), 'HH AE1 Z');              // "has to"
  assert.equal(at('He had walked home.', 'had'), 'HH AH0 D');
  assert.equal(at('Do it now.', 'do', { weak: 'all' }), 'D UW1');      // main verb
  assert.equal(at('Does he know?', 'does'), 'D AH0 Z');
  assert.equal(at('Do you see it?', 'do', { weak: 'all' }), 'D AH0');  // "you", "it": auxiliary in a question only
  assert.equal(at('I do not know.', 'do', { weak: 'all' }), 'D AH0');
});

test('"the" before a vowel: DH IY0 (default), DH IH0, or DH AH0 throughout', () => {
  assert.equal(at('Pass the evening here.', 'the'), 'DH IY0');
  assert.equal(at('Pass the morning here.', 'the'), 'DH AH0');
  assert.equal(at('Pass the evening here.', 'the', { the: 'IH' }), 'DH IH0');
  assert.equal(at('Pass the evening here.', 'the', { the: false }), 'DH AH0');
  assert.equal(at('Pass the hour here.', 'the'), 'DH IY0');           // by phonemes: "hour" starts with a vowel
  assert.equal(at('Pass the one here.', 'the'), 'DH AH0');            // ... "one" with W
});

test('heteronyms by context', () => {
  assert.equal(at('Read verse out loud for pleasure.', 'read'), 'R IY1 D');
  assert.equal(at('I want to read it.', 'read'), 'R IY1 D');
  assert.equal(at('He read the book.', 'read'), 'R EH1 D');
  assert.equal(at('The book was read twice.', 'read'), 'R EH1 D');
  assert.equal(at('Both lost their lives in the raging storm.', 'lives'), 'L AY1 V Z');
  assert.equal(at('She lives here.', 'lives'), 'L IH1 V Z');
  assert.equal(at('Always close the barn door tight.', 'close'), 'K L OW1 Z');
  assert.equal(at('Stay close to me.', 'close'), 'K L OW1 S');
  assert.equal(at('Use a pencil to write the first draft.', 'use'), 'Y UW1 Z');
  assert.equal(at('It has no use at all.', 'use'), 'Y UW1 S');
  assert.equal(at('A rod is used to catch pink salmon.', 'used'), 'Y UW1 Z D');
  assert.equal(at('I used to go there.', 'used'), 'Y UW1 S T');
  assert.equal(at('The swan dive was far short of perfect.', 'perfect'), 'P ER1 F IH2 K T');
  assert.equal(at('They record the show.', 'record'), 'R IH0 K AO1 R D');
  assert.equal(at('The record was old.', 'record'), 'R EH1 K ER0 D');
  assert.equal(at('Where do they live now?', 'live'), 'L IH1 V');
  assert.equal(at('A live wire.', 'live'), 'L AY1 V');
  assert.equal(at('The wind blew.', 'wind'), 'W IH1 N D');
  assert.equal(at('Wind the clock.', 'wind'), 'W AY1 N D');
  assert.equal(at('Two: lead.', 'lead'), 'L IY1 D');                  // context does not cross punctuation
  assert.equal(at('They took the lead early.', 'lead'), 'L IY1 D');  // the noun of "take the lead"
  assert.equal(at('The old lead pipe burst.', 'lead'), 'L EH1 D');    // the metal
  assert.equal(at('A ball made of lead sank.', 'lead'), 'L EH1 D');
  assert.equal(at('They refuse to go.', 'refuse'), 'R IH0 F Y UW1 Z');
  assert.equal(at('The refuse was burned.', 'refuse'), 'R EH1 F Y UW2 S');
  assert.equal(at('Read verse out loud.', 'read', { heteronyms: false }), 'R EH1 D');
  // every form keeps its word's syllable count (sing gives each syllable a note)
  for (const [w, h] of Object.entries(HETERONYMS)) {
    const n = lookup(w)[0].phones.filter((x) => /[012]/.test(String(x.stress))).length;
    for (const f of typeof h === 'string' ? [] : [h.noun, h.verb]) assert.equal(f.split(' ').filter((t) => /\d$/.test(t)).length, n, `${w} ${f}`);
  }
});

test('weak forms keep the citation form\'s syllable count; sung, only the lexical forms unless sing: true', () => {
  for (const [w, f] of Object.entries(WEAK_ALL)) {
    const n = lookup(w)[0].phones.filter((x) => x.stress !== null).length;
    for (const s of Array.isArray(f) ? f : [f]) assert.equal(s.split(' ').filter((t) => /\d$/.test(t)).length, n, `${w} ${s}`);
  }
  const text = 'There are more than two of them to read, and she was at the end of it';
  const n = words(text, null, null, {}).flatMap((w) => w.syllables).length;
  assert.equal(words(text, null, null, { reductions: true }).flatMap((w) => w.syllables).length, n);
  // sung (sing: "lexical", the default): heteronyms and "the" before a vowel, no weak forms
  const lex = sing({ text, notes: 'auto', reductions: true });
  assert.match(lex, / W (?:[gt][+-][\d.]+ )*r[\d.]+ AA /);                          // she was at: strong
  assert.match(lex, / R (?:[gt][+-][\d.]+ )*r[\d.]+ IY /);                          // to read: the verb
  assert.notEqual(lex, sing({ text, notes: 'auto' }));
  assert.equal(sing({ text, notes: 'auto', reductions: { sing: false } }), sing({ text, notes: 'auto' }));
  const s = sing({ text, notes: 'auto', reductions: { sing: true } });
  assert.match(s, / W r[\d.]+ AH /);                            // sing: true: the spoken forms
  assert.match(sing({ text, notes: 'auto', reductions: { sing: true, weak: 'all' } }), / T r[\d.]+ AH /);   // to read
  assert.deepEqual(compileString(s).warnings, []);
  assert.throws(() => reductionOptions({ sing: 'yes' }), /reductions\.sing/);
  assert.equal(durationsOf({ mode: 'sing', text: 'It was red', notes: 'auto', reductions: true }).phones[3].p, 'AA');
});

test('opt-in: hDrop, elision, assimilation', () => {
  const t = 'Tell him that his man can go, and must be ten pins in case.';
  const base = pron(t), x = pron(t, { hDrop: true, elision: true, assimilation: true });
  assert.equal(base[1], 'HH IH0 M'); assert.equal(x[1], 'IH0 M');                 // tell 'im
  assert.equal(x[3], 'IH0 Z');
  assert.equal(pron('His man left.', { hDrop: true })[0], 'HH IH0 Z');           // not phrase-initially
  assert.equal(base[5], 'K AH0 N'); assert.equal(x[5], 'K AH0 NG');               // can go: N -> NG before G
  assert.equal(x[4], 'M AE1 NG');
  assert.equal(base[7], 'AH0 N D'); assert.equal(x[7], 'AH0 M');                  // and must: elision, then assimilation
  assert.equal(x[8], 'M AH0 S');                                                  // must be
  assert.equal(x[10], 'T EH1 M');                                                 // ten pins
  assert.equal(x[12], 'IH0 NG');                                                  // in case
  assert.equal(pron('Go, and eat.', { elision: true })[1], 'AH0 N D');            // before a vowel: kept
  assert.equal(pron('Ten, pins.', { assimilation: true })[0], 'T EH1 N');         // not across a pause
});

test('options: weak overrides and removals, validation', () => {
  assert.equal(at('Read verse for pleasure.', 'for', { weak: { for: null } }), 'F AO1 R');
  assert.equal(at('Read verse for pleasure.', 'for', { weak: { for: 'F AO0 R' } }), 'F AO0 R');
  assert.equal(at('Go to it now.', 'to', { weak: { to: ['T AH0', 'T IH0'] } }), 'T IH0');
  assert.deepEqual(pron('It was to be.', { weak: false, heteronyms: false }), pron('It was to be.', false).map((x) => x));
  assert.throws(() => pron('He can go.', { weak: { can: 'K N' } }), /reductions\.weak\.can: .*syllables/);
  assert.throws(() => reductionOptions({ nope: 1 }), /reductions\.nope: unknown/);
  assert.throws(() => reductionOptions({ the: 'AH' }), /reductions\.the/);
  assert.throws(() => reductionOptions({ hDrop: 1 }), /reductions\.hDrop/);
  assert.throws(() => reductionOptions({ weak: { to: 'tə' } }), /reductions\.weak\.to/);
  assert.throws(() => reductionOptions('yes'), /reductions: true or an object/);
  assert.throws(() => reductionOptions({ weak: 'some' }), /reductions\.weak: true, "all"/);
  assert.equal(reductionOptions({ weak: 'all' }).weak, WEAK_ALL);
  assert.equal(reductionOptions(true).weak, WEAK);
  assert.deepEqual(Object.keys(reductionOptions(true)).filter((k) => k !== 'custom').sort(), Object.keys(REDUCTIONS).sort());
  assert.equal(reductionOptions(false), null);
  // the parsed words are not changed in place (they are cached per text)
  const ws = lookup('Go to bed.').map((w) => ({ ...w, syllables: syllabify(w.phones) }));
  const before = JSON.stringify(ws);
  reduceWords(ws, reductionOptions(true));
  assert.equal(JSON.stringify(ws), before);
});

test('a project lexicon keeps its heteronyms; weak forms still apply', () => {
  const dir = mkdtempSync(join(tmpdir(), 'klattsing-red-'));
  writeFileSync(join(dir, 'lex.json'), JSON.stringify({ read: 'R EH1 D' }));
  addLexicon(join(dir, 'lex.json'));
  assert.equal(at('Read verse for pleasure.', 'read'), 'R EH1 D');
  assert.equal(at('Read verse for pleasure.', 'for'), 'F ER0');
});

test('durations and timelines name the reduced phonemes; speak strings carry them', () => {
  const spec = { mode: 'speak', text: 'It was to be the evening.', reductions: true };
  const d = durationsOf(spec).phones.map((x) => x.p);
  assert.deepEqual(d.slice(0, 7), ['IH', 'T', 'W', 'AH', 'Z', 'T', 'UW']);
  assert.equal(d[10], 'IY');                                   // the (before "evening")
  const tl = timelineOf(spec).phones.filter((x) => !x.asp).map((x) => x.p);
  assert.deepEqual(tl, d.filter((p) => p !== 'pau'));
  assert.match(speak(spec), / W r[\d.]+ AH r/);
});

test('with vowels: reductions owns its words (to / into / do back), vowels gives the weak vowels AX / AXR', () => {
  const code = (t, o) => words(t, null, null, { functionWords: true, ...o }).map((w) => w.syllables.map((x) => [...x.onset, x.nucleusCode ?? x.nucleus, ...x.coda].join(' ')).join('.'));
  const t = 'Go to bed, go to it, and that was for us; I know what it was.';
  const both = code(t, { vowels: true, reductions: true }), v = code(t, { vowels: true }), r = code(t, { reductions: true });
  assert.equal(both[1], 'T AX'); assert.equal(r[1], 'T UW');            // to bed: the weak form, now with a schwa
  assert.equal(both[4], 'T UW'); assert.equal(v[4], 'T AX');            // to it: reductions' form before a vowel
  assert.equal(both[8], 'W AX Z'); assert.equal(both[9], 'F AXR');      // was for: weak, reduced codes
  assert.equal(both[10], 'AH S'); assert.equal(v[10], 'AX S');          // us; (phrase end): the strong form keeps its vowel
  assert.equal(both[15], 'W AA Z'); assert.equal(v[15], 'W AX Z');      // ... was. (the end): strong
  // no word gets two forms: every vowel code of a weak-table word is its reduced form's or the strong one's
  assert.equal(code('Cut the pie into large parts.', { vowels: true, reductions: true })[3], 'IX N.T AX');
  // without reductions, vowels is as before; without vowels, reductions is as before
  assert.deepEqual(code(t, { vowels: true, reductions: false }), v);
  assert.deepEqual(code(t, { reductions: true, vowels: false }), r);
});
