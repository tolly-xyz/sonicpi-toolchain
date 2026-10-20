// The opt-in extensions: inline banks and bankPatch, timelines, durationsOf, functionWords, intonation,
// breath aspiration, exposed constants, and the CLI. Defaults must keep producing the strings captured
// before these existed (reference.fixture.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { speak, sing, toKlattsch, durationsOf, words, voiceAspiration, hz } from '../src/compile.js';
import { bankName, banksFor, patchedBank, canonical } from '../src/banks.js';
import { FUNCTION_WORDS } from '../src/function_words.js';
import { lookup } from '../src/lexicon.js';
import { syllabify } from '../src/syllables.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, banks } from '../../vendor/klattsch/src/engine/index.js';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const BIN = fileURLToPath(new URL('../bin/klattsing.mjs', import.meta.url));
const cli = (args, input) => spawnSync('node', [BIN, ...args], { input, encoding: 'utf8' });
const tokens = (s) => s.split(/\s+/);
const phonemeTokens = (s) => tokens(s).filter((t) => /^[A-Z]+(\(|[+-]|$)/.test(t));
const rOf = (s) => tokens(s).filter((t) => /^r\d/.test(t)).map((t) => Number(t.slice(1)));

test('defaults: byte-identical to the strings captured before the extensions', () => {
  assert.ok(REF.length > 50);
  for (const { spec, out } of REF) assert.equal(toKlattsch(spec), out, JSON.stringify(spec));
});

test('defaults: the new options at their default values change nothing', () => {
  for (const { spec, out } of REF) {
    const sp = spec.mode === 'sing';
    const o = {
      ...spec, intonation: { accent: 2, finalFall: 3, declination: 0, questionRise: 0 }, functionWords: false, bankPatch: {},
      accentDelta: sp ? { g: 0.15, t: 0.15 } : { g: 0.1, t: 0 }, ...(sp ? {} : { pauseMs: 250 }),
      ...(spec.aspiration === undefined ? { aspiration: true } : {}),
    };
    assert.equal(toKlattsch(o), out, JSON.stringify(spec));
  }
  const q = REF.find((r) => r.spec.text.endsWith('?') || r.spec.text.includes('?'));
  assert.equal(speak({ ...q.spec, intonation: { questionRise: 0 } }), q.out);
});

test('inline bank: registered under its name and selected', () => {
  const bank = { schemaVersion: 1, name: 'test-inline', extends: 'silt-stops', phonemes: { AA: { ...banks.get('klatt1980-en').phonemes.AA, F1: 777 } } };
  const s = speak({ text: 'Stop the car.', bank });
  assert.ok(s.startsWith('[bank=test-inline] '), s);
  const c = compileString(s);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.schedule.some((e) => e.target.F1 === 777), 'patched AA in the schedule');
  assert.equal(banks.get('test-inline').phonemes.D.voicing, banks.get('silt-stops').phonemes.D.voicing, 'inherits silt-stops');
  // the same name with new content replaces it
  speak({ text: 'car', bank: { ...bank, phonemes: { AA: { ...bank.phonemes.AA, F1: 701 } } } });
  assert.equal(banks.get('test-inline').phonemes.AA.F1, 701);
  assert.throws(() => speak({ text: 'car', bank: { schemaVersion: 1, phonemes: {} } }), /needs a name/);
});

test('bankPatch: a deterministic generated bank that extends the named one', () => {
  const patch = { AA: { F1: 760, BW1: 90 }, T: { burstMs: 30 } };
  const name = bankName({ bank: 'silt-stops', bankPatch: patch });
  assert.match(name, /^silt-stops--[0-9a-f]{12}$/);
  assert.equal(bankName({ bank: 'silt-stops', bankPatch: { T: { burstMs: 30 }, AA: { BW1: 90, F1: 760 } } }), name, 'key order does not matter');
  assert.notEqual(bankName({ bank: 'silt-stops', bankPatch: { AA: { F1: 761 } } }), name);
  assert.match(bankName({ bankPatch: { AA: { F1: 760 } } }), /^klatt1980-en--/, 'default base');
  const r = banks.get(name), base = banks.get('silt-stops');
  assert.equal(r.phonemes.AA.F1, 760); assert.equal(r.phonemes.AA.F2, base.phonemes.AA.F2, 'other fields kept');
  assert.equal(r.phonemes.T.burstMs, 30); assert.equal(r.phonemes.T.isStop, true);
  assert.deepEqual(r.phonemes.D, base.phonemes.D, 'unpatched entries inherited');
  assert.equal(patchedBank('klatt1980-en', { AY: { glideTo: { F2: 2100 } } }).phonemes.AY.glideTo.F1,
    banks.get('klatt1980-en').phonemes.AY.glideTo.F1, 'glideTo merged one level');
  assert.equal(patchedBank('klatt1980-en', { T: { burstMs: null } }).phonemes.T.burstMs, undefined, 'null removes a field');
  const s = speak({ text: 'Stop the car.', bank: 'silt-stops', bankPatch: patch });
  assert.ok(s.startsWith(`[bank=${name}] `));
  assert.deepEqual(compileString(s).warnings, []);
  assert.ok(compileString(s).schedule.some((e) => e.target.F1 === 760));
  // patch on an inline bank; banksFor lists what a renderer elsewhere must register
  const inline = { schemaVersion: 1, name: 'test-inline2', extends: 'klatt1980-en', phonemes: {} };
  const list = banksFor({ bank: inline, bankPatch: { AA: { F1: 700 } }, aspiration: 'breath' });
  assert.deepEqual(list.map((b) => b.extends), ['klatt1980-en', 'test-inline2', list[1].name]);
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
});

test('bankPatch and inline banks: refuse what klattsch would render silently wrong', () => {
  // a phoneme the base lacks: a partial entry would give NaN formants (no "unknown phoneme" warning)
  const mini = { schemaVersion: 1, name: 'test-mini', phonemes: { AA: { ...banks.get('klatt1980-en').phonemes.AA } } };
  assert.throws(() => speak({ text: 'saw', bank: mini, bankPatch: { S: { F1: 300 } } }), /bankPatch\.S: bank test-mini has no S, and the patch lacks voicing/);
  assert.throws(() => bankName({ bankPatch: { DX: { F2: 1500 } } }), /has no DX/);
  // a complete entry may add a phoneme; null on a missing one is a no-op
  const full = { ...banks.get('klatt1980-en').phonemes.S, F1: 310 };
  const added = bankName({ bank: mini, bankPatch: { S: full, ZH: null } });
  assert.equal(banks.get(added).phonemes.S.F1, 310);
  // [bank=NAME] only takes [A-Za-z0-9_.-]: another name would never select the bank
  assert.throws(() => speak({ text: 'car', bank: { schemaVersion: 1, name: 'my bank', extends: 'klatt1980-en', phonemes: {} } }), /inline bank name/);
});

test('bankPatch loads a banks/*.json base on its own (no klatt-render registration)', () => {
  const r = spawnSync('node', ['-e', `import('${new URL('../src/compile.js', import.meta.url).href}').then((m) => console.log(m.speak({ text: 'car', bank: 'mitalk-bursts', bankPatch: { AA: { F1: 700 } } })))`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[bank=mitalk-bursts--[0-9a-f]{12}\] /);
});

test('timeline: klattsch phoneme times, in order, with word/syllable indices', () => {
  const spec = { mode: 'speak', text: 'Pin the top, then stop.', bank: 'silt-stops' };
  const tl = timelineOf(spec), s = speak(spec), c = compileString(s);
  assert.equal(tl.totalMs, Math.round(c.totalMs * 100) / 100);
  assert.deepEqual(tl.phones.map((p) => p.p), phonemeTokens(s).map((t) => t.match(/^[A-Z]+/)[0]));
  for (let i = 1; i < tl.phones.length; i++) assert.ok(tl.phones[i].start >= tl.phones[i - 1].end - 1e-6);
  const r = rOf(s);
  tl.phones.forEach((p, i) => assert.ok(Math.abs(p.end - p.start - r[i]) < 0.02, `${p.p} ${p.end - p.start} vs ${r[i]}`));
  assert.ok(tl.phones.at(-1).end <= tl.totalMs - 150 + 1e-6, 'last phoneme ends before the trail');
  assert.deepEqual(tl.phones.filter((p) => p.asp).map((p) => p.p), ['HH', 'HH']);   // pin, top (stop: after S)
  assert.deepEqual([...new Set(tl.phones.map((p) => p.word))], [0, 1, 2, 3, 4]);
  // gap after the comma: the pause
  const top = tl.phones.filter((p) => p.word === 2).at(-1), then = tl.phones.find((p) => p.word === 3);
  assert.ok(Math.abs(then.start - top.end - 250) < 0.02);
  const sungTl = timelineOf({ mode: 'sing', text: 'Lower the bucket', bpm: 168, notes: [['E2', 3], ['G2', 3], ['F2', 3], ['A2', 3], ['G2', 4]] });
  assert.ok(sungTl.phones.length >= 10);
});

test('durationsOf: the rule durations the string carries, before klattsch', () => {
  const spec = { mode: 'speak', text: 'Pin the top, then stop.', rate: 1.1 };
  const d = durationsOf(spec), s = speak(spec);
  assert.deepEqual(d.words, ['pin', 'the', 'top', 'then', 'stop']);
  const lexical = d.phones.filter((p) => p.p !== 'pau');
  assert.deepEqual(lexical.map((p) => p.p), words(spec.text).flatMap((w) => w.phones.map((x) => x.p)));
  // the string's r values: each phoneme, with the aspiration (HH) before its vowel
  const fromD = lexical.flatMap((p) => (p.asp ? [p.asp, p.ms] : [p.ms]));
  const r = rOf(s);
  assert.equal(fromD.length, r.length);
  fromD.forEach((ms, i) => assert.ok(Math.abs(Math.round(ms * 10) / 10 - r[i]) < 1e-9, `${i}: ${ms} vs ${r[i]}`));
  assert.deepEqual(d.phones.filter((p) => p.p === 'pau').map((p) => p.ms), [275, 275]);
  assert.ok(Math.abs(d.totalMs - (compileString(s).totalMs - 150)) < 0.5, `${d.totalMs} vs ${compileString(s).totalMs}`);
  assert.equal(lexical.find((p) => p.p === 'IH').asp, 25);
  assert.equal(lexical.find((p) => p.p === 'IH').stress, 1);
  assert.equal(lexical.filter((p) => p.word === 2).every((p) => p.syl === 0), true);
  // an array gives an array; sing: the line lasts as long as its notes
  const [a, b] = durationsOf([spec, { mode: 'sing', text: 'Lower the bucket', bpm: 168, gate: 190, notes: [['E2', 3], ['G2', 3], ['F2', 3], ['A2', 3], ['G2', 4]] }]);
  assert.deepEqual(a, d);
  assert.ok(Math.abs(b.totalMs - 16 * 15000 / 168) < 1e-6, `${b.totalMs}`);
  assert.equal(durationsOf({ text: 'pin', aspiration: false }).phones[1].asp, undefined);
});

test('durationsOf: 100 specs in one call take well under a second', () => {
  const H = ['The birch canoe slid on the smooth planks.', 'Glue the sheet to the dark blue background.',
    "It's easy to tell the depth of a well.", 'These days a chicken leg is a rare dish.', 'Rice is often served in round bowls.'];
  const specs = (k) => Array.from({ length: 100 }, (_, i) => ({ text: `${H[i % 5]} ${['Yes', 'Now', 'Again', 'Well'][i % 4]}.`, rules: { phraseFinal: 1.2 + k / 100 }, functionWords: i % 2 === 0 }));
  durationsOf(specs(0));
  const t0 = performance.now();
  for (let k = 0; k < 10; k++) durationsOf(specs(k));
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < 100, `${ms.toFixed(1)} ms per call`);
});

test('functionWords: one-syllable function words lose their stress', () => {
  assert.ok(FUNCTION_WORDS.size >= 90, `${FUNCTION_WORDS.size}`);
  const multi = [...FUNCTION_WORDS].filter((w) => { try { return syllabify(lookup(w)[0].phones).length > 1; } catch { return false; } });
  assert.ok(multi.length <= 1, `two-syllable entries: ${multi}`);           // "our" AW1 ER0: left alone
  const text = 'Glue it to the sheet of paper.';
  const plain = words(text), fw = words(text, null, null, { functionWords: true });
  const stress = (ws, w) => ws.find((x) => x.word === w).syllables.map((s) => s.stress);
  assert.deepEqual(stress(plain, 'to'), [1]); assert.deepEqual(stress(fw, 'to'), [0]);
  assert.deepEqual(stress(plain, 'of'), [1]); assert.deepEqual(stress(fw, 'of'), [0]);
  assert.deepEqual(stress(fw, 'paper'), stress(plain, 'paper'));
  assert.deepEqual(stress(fw, 'glue'), [1]);
  const nuc = (ws, w) => ws.find((x) => x.word === w).syllables[0].nucleusMs;
  assert.ok(nuc(fw, 'to') < nuc(plain, 'to'), 'shorter');
  assert.equal(fw.find((x) => x.word === 'to').syllables[0].aspMs, 0, 'no aspiration on an unstressed "to"');
  // accents (pitch rises) go with the stress: glue it to sheet of pa-  ->  glue sheet pa-
  const rises = (o) => (speak({ text, ...o }).match(/\(\+/g) ?? []).length;
  assert.equal(rises({}), 6); assert.equal(rises({ functionWords: true }), 3); assert.equal(rises({ functionWords: ['of'] }), 5);
  assert.deepEqual(stress(words(text, null, null, { functionWords: ['Of'] }), 'of'), [0]);
  assert.deepEqual(stress(words(text, null, null, { functionWords: ['Of'] }), 'to'), [1]);
  // the cached parse is not changed by a reduced call
  assert.deepEqual(stress(words(text), 'to'), [1]);
});

test('intonation: accent, final fall, question rise, declination', () => {
  const text = 'The cat sat on the mat.';
  const delta = (s) => tokens(s).filter((t) => /\(/.test(t)).map((t) => Number(t.match(/\(([+-][\d.]+)\)/)[1]));
  const base = hz('A2');
  const d0 = delta(speak({ text }));
  assert.equal(d0.at(-1), Math.round(base * (2 ** (-3 / 12) - 1) * 10) / 10);
  const d4 = delta(speak({ text, intonation: { accent: 4, finalFall: 5 } }));
  assert.equal(d4[0], Math.round(base * (2 ** (4 / 12) - 1) * 10) / 10);
  assert.equal(d4.at(-1), Math.round(base * (2 ** (-5 / 12) - 1) * 10) / 10);
  assert.equal(delta(speak({ text, intonation: { finalFall: 0 } })).length, d0.length - 1, 'no final fall');
  // questions
  const q = 'Is the cat on the mat?';
  assert.ok(delta(speak({ text: q })).at(-1) < 0, 'falls by default');
  assert.equal(delta(speak({ text: q, intonation: { questionRise: 4 } })).at(-1), Math.round(base * (2 ** (4 / 12) - 1) * 10) / 10);
  assert.equal(speak({ text, intonation: { questionRise: 4 } }), speak({ text }), 'statements unaffected');
  // declination: falling b directives through the sentence, reset after a full stop
  const s = speak({ text: `${text} ${text}`, intonation: { declination: 2 } });
  const bs = tokens(s).filter((t) => /^b[\d.]+$/.test(t)).map((t) => Number(t.slice(1)));
  const reset = bs.indexOf(110, 1);
  assert.ok(reset > 2, `${bs}`);
  for (let i = 1; i < reset; i++) assert.ok(bs[i] < bs[i - 1]);
  assert.ok(bs[reset - 1] < 110 * 2 ** (-1 / 12), 'more than a semitone by the end of the sentence');
  assert.deepEqual(compileString(s).warnings, []);
});

test('aspiration "breath": aspiration raised over the vowel onset instead of an HH segment', () => {
  const text = 'Pin the top.';
  const hh = speak({ text }), br = speak({ text, aspiration: 'breath' });
  assert.ok(/ HH /.test(hh)); assert.ok(!/ HH /.test(br), br);
  assert.match(br, /h1 r25 BRIH h0\.05 r[\d.]+ IH\(/);
  assert.match(br, /^\[bank=klatt1980-en--br[0-9a-f]{12}\] /);
  const c1 = compileString(hh), c2 = compileString(br);
  assert.deepEqual(c2.warnings, []);
  assert.equal(c2.totalMs, c1.totalMs, 'same timing as the HH segment');
  // the breath holds the vowel's onset formants (no glide) and restores the voice's aspiration
  const bank = banks.get(br.match(/^\[bank=([^\]]+)\]/)[1]);
  assert.equal(bank.phonemes.BRIH.glideTo, undefined);
  assert.equal(bank.phonemes.BRIH.F2, banks.get('klatt1980-en').phonemes.IH.F2);
  assert.ok(c2.schedule.some((e) => e.target.aspiration === 1));
  assert.equal(c2.schedule.at(-2).target.aspiration, 0.05);
  // other voices, levels, banks, and sing
  assert.match(speak({ text, aspiration: 'breath', voice: 'whisper', breathLevel: 0.8 }), /h0\.8 r25 BRIH h0\.55 /);
  assert.equal(voiceAspiration('g0.5 h0.2 h+0.1'), 0.3);
  assert.equal(voiceAspiration('h=0.4 g0.5 h'), 0);
  assert.equal(voiceAspiration('g0.5 t0'), 0);
  assert.match(speak({ text, aspiration: 'breath', bank: 'silt-stops' }), /^\[bank=silt-stops--br[0-9a-f]{12}\] /);
  assert.equal(banksFor({ aspiration: 'breath', breathVoicing: 0 })[0].phonemes.BRAA.voicing, 0);
  const sg = sing({ text: 'Kite time', notes: [['E2', 8], ['G2', 8]], aspiration: 'breath' });
  assert.match(sg, /h1 r25 BRAA h0\.06 r[\d.]+ AA r[\d.]+ IY/);
  assert.deepEqual(compileString(sg).warnings, []);
  assert.equal(compileString(sg).totalMs, compileString(sing({ text: 'Kite time', notes: [['E2', 8], ['G2', 8]] })).totalMs);
  // the timeline names the breath by its vowel
  const tl = timelineOf({ text, aspiration: 'breath' });
  assert.deepEqual(tl.phones.filter((p) => p.asp).map((p) => p.p), ['IH', 'AA']);
});

test('pauseMs and accentDelta replace the hard-coded values', () => {
  const text = 'Lower the bucket, lower the bell.';
  const pauses = (s) => tokens(s).filter((t) => /^p\d/.test(t));
  assert.deepEqual(pauses(speak({ text })), ['p250', 'p250']);
  assert.deepEqual(pauses(speak({ text, pauseMs: 120, rate: 1.5 })), ['p180', 'p180']);
  assert.deepEqual(pauses(speak({ text, pauseMs: { ',': 90, '.': 400 } })), ['p90', 'p400']);
  assert.deepEqual(pauses(speak({ text, pauseMs: { '.': 400, default: 50 } })), ['p50', 'p400']);
  assert.deepEqual(durationsOf({ text, pauseMs: { ',': 90 } }).phones.filter((p) => p.p === 'pau').map((p) => p.ms), [90, 250]);
  const s = speak({ text, accentDelta: { g: 0.2, t: 0.1 } });
  assert.ok(s.includes('g+0.2 t+0.1 r') && s.includes(' g-0.2 t-0.1 '), s);
  assert.ok(!/ g[+-]/.test(speak({ text, accentDelta: { g: 0 } })));
  const sg = sing({ text: 'Lower the bucket', notes: 'auto', accentDelta: { g: 0.3, t: 0 } });
  assert.ok(sg.includes('g+0.3 r') && !sg.includes('t+'), sg);
});

test('CLI: --print as before, --timeline, --durations, --serve', () => {
  const spec = { mode: 'speak', text: 'Lower the bucket.' };
  const p = cli(['-', '--print'], JSON.stringify(spec));
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout.trim(), speak(spec));
  assert.equal(cli(['-'], JSON.stringify(spec)).stdout, p.stdout, 'no output file: print');
  const two = JSON.stringify([spec, { ...spec, text: 'Pin the top.', aspiration: 'breath', bankPatch: { IH: { F1: 420 } } }]);
  const t = cli(['-', '--timeline'], two);
  assert.equal(t.status, 0, t.stderr);
  const [t1, t2] = t.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(t1), ['text', 'totalMs', 'offsetMs', 'phones']);
  assert.equal(t1.offsetMs, 0);
  assert.ok(Math.abs(t2.offsetMs - (Math.ceil(t1.totalMs * 48) / 48 + 600)) < 0.02, `${t2.offsetMs}`);
  assert.deepEqual(Object.keys(t1.phones[0]), ['p', 'start', 'end', 'word', 'syl']);
  const d = cli(['-', '--durations'], two);
  assert.equal(d.status, 0, d.stderr);
  const [d1] = d.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(d1), ['text', 'words', 'totalMs', 'phones']);
  assert.deepEqual(Object.keys(d1.phones[0]), ['p', 'ms', 'word', 'syl', 'stress']);
  const sv = cli(['--serve', '--durations'], `${JSON.stringify(spec)}\n${two}\n{"text":"glorpth"}\n`);
  assert.equal(sv.status, 0, sv.stderr);
  const lines = sv.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, spec.text); assert.equal(lines[1].length, 2); assert.match(lines[2].error, /glorpth/);
  assert.equal(cli(['-', '--bogus'], '{}').status, 1);
});
