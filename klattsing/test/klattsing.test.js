// Fast checks for klattsing (node --test klattsing/test). The listening tests are tools/voicelab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, addLexicon } from '../src/lexicon.js';
import { syllabify } from '../src/syllables.js';
import { words, speak, sing, hz, midi } from '../src/compile.js';
import { DUR, VOWELS } from '../src/phones.js';
import { RULES } from '../src/durations.js';
import { compileString } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const syl = (w) => syllabify(lookup(w)[0].phones).map((s) => [s.onset.join(' '), s.nucleus, s.coda.join(' ')].join('|'));

test('lexicon: CMUdict with stress, punctuation kept, unknown words named', () => {
  const [w] = lookup('Lower,');
  assert.equal(w.word, 'lower'); assert.equal(w.punct, ',');
  assert.deepEqual(w.phones.map((p) => p.p), ['L', 'OW', 'ER']);
  assert.deepEqual(w.phones.map((p) => p.stress), [null, 1, 0]);
  assert.throws(() => lookup('glorpth'), /glorpth/);
});

test('syllables: maximal onset with legal English onsets', () => {
  assert.deepEqual(syl('bucket'), ['B|AH|', 'K|AH|T']);
  assert.deepEqual(syl('extra'), ['|EH|K', 'S T R|AH|']);
  assert.deepEqual(syl('strength'), ['S T R|EH|NG K TH']);
  assert.deepEqual(syl('sunday'), ['S|AH|N', 'D|EY|']);
});

test('durations: every phoneme in the table, none below its minimum (halved when unstressed)', () => {
  for (const ph of Object.keys(DUR)) assert.ok(DUR[ph][0] >= DUR[ph][1], ph);
  for (const s of words('The birch canoe slid on the smooth planks, and strength returned.').flatMap((w) => w.syllables)) {
    s.onset.forEach((p, i) => assert.ok(s.onsetMs[i] >= DUR[p][1] / 2 - 1e-9, `${p} ${s.onsetMs[i]}`));
    if (s.nucleus) assert.ok(s.nucleusMs >= DUR[s.nucleus][1] / 2 - 1e-9, s.nucleus);
  }
});

test('durations: phrase-final lengthening and unstressed shortening go the right way', () => {
  const [a] = words('bat bat.').slice(1), [b] = words('bat bat.').slice(0, 1);
  assert.ok(a.syllables[0].nucleusMs > b.syllables[0].nucleusMs, 'phrase-final vowel longer');
  const [the] = words('the cat');
  assert.ok(the.syllables[0].nucleusMs < words('cat')[0].syllables[0].nucleusMs, 'unstressed vowel shorter');
});

test('aspiration only after P/T/K opening a stressed syllable, not after S', () => {
  assert.ok(words('pin')[0].syllables[0].aspMs > 0);
  assert.equal(words('spin')[0].syllables[0].aspMs, 0);
  assert.equal(words('bin')[0].syllables[0].aspMs, 0);
});

test('notes: names to MIDI and Hz', () => {
  assert.equal(midi('A4'), 69); assert.equal(midi('E2'), 40); assert.equal(midi('Bb1'), 34);
  assert.ok(Math.abs(hz('A2') - 110) < 1e-9);
});

test('speak and sing compile in klattsch without warnings, in every bank and option', () => {
  const opts = [{}, { bank: 'silt-stops' }, { bank: 'mitalk-bursts', transition: 70, dynamics: true }, { durations: 'v0', aspiration: false }];
  for (const o of opts) {
    const s1 = speak({ text: 'Lower the bucket, lower the bell.', pitch: 'A2', ...o });
    const s2 = sing({ text: 'Lower the bucket', bpm: 168, gate: 190, notes: [['E2', 3], ['G2', 3], ['F2', 3], ['A2', 3], ['G2', 4]], ...o });
    const s3 = sing({ text: 'Every window holding a light', notes: 'auto', ...o });
    for (const s of [s1, s2, s3]) assert.deepEqual(compileString(s).warnings, [], s);
  }
});

test('sing: one note per syllable, and the line lasts exactly as long as its notes', () => {
  assert.throws(() => sing({ text: 'Lower the bucket', notes: [['E2', 3]] }), /5 syllables but 1 notes/);
  const bpm = 168, notes = [['E2', 3], ['G2', 3], ['F2', 3], ['A2', 3], ['G2', 4]];
  const { totalMs } = compileString(sing({ text: 'Lower the bucket', bpm, gate: 190, notes }));
  const TRAIL = 150;                         // klattsch lets every phrase decay for 150 ms
  assert.ok(Math.abs(totalMs - TRAIL - 16 * 15000 / bpm) < 2, `${totalMs}`);
});

test('project lexicon overrides CMUdict', () => {
  addLexicon(new URL('./lexicon.fixture.json', import.meta.url).pathname);
  assert.deepEqual(lookup('tomato')[0].phones.map((p) => p.p), ['T', 'AH', 'M', 'AA', 'T', 'OW']);
});

test('sing: rests take time but no syllable', () => {
  const bpm = 120, notes = [['E2', 3], ['r', 2], ['G2', 6], ['r', 2], ['F2', 2], ['E2', 6]];
  const s = sing({ text: 'Say van again', bpm, notes });
  assert.equal((s.match(/ p250 /g) ?? []).length, 2);
  assert.ok(Math.abs(compileString(s).totalMs - 150 - 21 * 15000 / bpm) < 2);
});
