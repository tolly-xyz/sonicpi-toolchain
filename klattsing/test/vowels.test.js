// "vowels" (klattsing) and klattsch's glide window patch (a gliding entry's glide: [a, b], [GLMS=ms]): every vowel's
// onset and offset targets, reduced AX IX AXR, weak forms, r-colored <vowel>QR; inert unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf } from '../src/compile.js';
import { bankName, banksFor } from '../src/banks.js';
import { VOWEL_TARGETS, VOWEL_CODES, WEAK_FORMS, RHOTIC_RULE, vowelOptions } from '../src/vowels.js';
import { VOWELS, vowelOf, isVowelCode } from '../src/phones.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, banks } from '../../vendor/klattsch/src/engine/index.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const compiled = (spec) => { for (const b of banksFor(spec)) registerBank(b); return compileString(toKlattsch(spec)); };
const codes = (s) => s.split(' ').filter((t) => /^[A-Z]+(\([+-][\d.]+\))?$/.test(t)).map((t) => t.replace(/\(.*$/, ''));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} != ${b}`);
const formantEvents = (c) => c.schedule.filter((e) => e.params && e.params.join() === 'F1,F2,F3');

test('defaults: no vowels option (or false/null) gives the reference strings; no glide fields, no GLMS', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, vowels: false }), out);
    assert.equal(toKlattsch({ ...spec, vowels: null }), out);
    assert.ok(!out.includes('[GLMS') && !/--vw[0-9a-f]/.test(out));
  }
  assert.equal(vowelOptions({}), null);
});

test('codes: vowelOf / isVowelCode know the 15 vowels, AX IX AXR and <vowel>QR, nothing else', () => {
  for (const v of VOWELS) assert.equal(vowelOf(v), v);
  assert.equal(vowelOf('AX'), 'AH'); assert.equal(vowelOf('IX'), 'IH'); assert.equal(vowelOf('AXR'), 'ER');
  assert.equal(vowelOf('AOQR'), 'AO'); assert.equal(vowelOf('IHQR'), 'IH');
  for (const c of ['HQAA', 'HQAAQR', 'TQAX', 'BRAA', 'DQF', 'R', 'S', 'QR']) assert.ok(!isVowelCode(c), c);
  for (const c of VOWEL_CODES) assert.ok(isVowelCode(c), c);
});

test('option: a generated bank <base>--vw<hash> (after bankPatch, before coarticulation) with targets for every vowel', () => {
  const s = speak({ text: 'Lower the bucket.', vowels: true });
  assert.match(s, /^\[bank=klatt1980-en--vw[0-9a-f]{12}\] g0\.5/);
  const P = banks.get(bankName({ vowels: true })).phonemes;
  const PB = banks.get(bankName({ vowels: { balance: true } })).phonemes;
  for (const c of VOWEL_CODES) {
    assert.ok(P[c], c);
    assert.ok(P[c].glideTo && ['F1', 'F2', 'F3'].every((f) => typeof P[c].glideTo[f] === 'number'), `${c} glideTo`);
    const t = VOWEL_TARGETS[c];
    if (t) {
      for (const f of ['F1', 'F2', 'F3']) { assert.equal(P[c][f], t[f], `${c}.${f}`); assert.equal(P[c].glideTo[f], t.glideTo[f], `${c}.glideTo.${f}`); }
      for (const f of ['BW1', 'BW2', 'BW3', 'A1', 'A2', 'A3']) if (f in t) assert.equal(PB[c][f], t[f], `${c}.${f}`);
      assert.deepEqual(P[c].glide, t.glide, `${c}.glide`);
    }
    // a complete klattsch entry
    for (const f of ['voicing', 'F1', 'F2', 'F3', 'BW1', 'BW2', 'BW3', 'A1', 'A2', 'A3']) assert.ok(Number.isFinite(P[c][f]), `${c}.${f}`);
  }
  // every vowel has an onset and an offset target (inherent spectral change), not only the diphthongs
  for (const v of VOWELS) assert.ok(['F1', 'F2'].some((f) => P[v][f] !== P[v].glideTo[f]), v);
  // an r-colored code without fitted targets: its vowel's onset, the offset's F3 at most RHOTIC_RULE.F3
  for (const c of VOWEL_CODES.filter((x) => x.endsWith('QR') && !VOWEL_TARGETS[x])) {
    assert.ok(P[c].glideTo.F3 <= RHOTIC_RULE.F3, c);
    assert.equal(P[c].F1, P[vowelOf(c)].F1, c);
  }
  // the chain with the others: nasals, bankPatch, vowels, coarticulation, fricatives, stops
  const all = { text: 'Lower the bucket.', bankPatch: { AA: { A1: 0.8, A3: 0.5 } }, vowels: true, coarticulation: true, nasals: true, stops: true, fricatives: true };
  assert.match(speak(all), /^\[bank=klatt1980-en--nas[0-9a-f]{12}--[0-9a-f]{12}--vw[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\]/);
  const Q = banks.get(bankName(all)).phonemes;
  // bankPatch is under the vowel targets: a field they leave alone is the patch's (A1, and A3 without balance), one
  // they set (A3 with balance: true) theirs
  assert.equal(Q.AA.A1, 0.8, 'bankPatch under the vowel targets'); assert.equal(Q.AA.A3, 0.5);
  assert.equal(banks.get(bankName({ ...all, vowels: { balance: true } })).phonemes.AA.A3, VOWEL_TARGETS.AA.A3);
  for (const c of ['AX', 'IX', 'AXR', 'AAQR', 'IY']) assert.equal(Q[c].vowel, true, `${c}: coarticulation's vowel field`);
  for (const c of ['AX', 'AXR', 'AOQR']) assert.ok(Q[`HQ${c}`] && Q[`TQ${c}`], `stops' aspiration and burst into ${c}`);
});

test('fields: targets, reduced, weak, rhotic and phonemes switch their parts; bad values throw', () => {
  const P = (v) => banks.get(bankName({ vowels: v })).phonemes;
  const k = banks.get('klatt1980-en').phonemes;
  assert.deepEqual(P({ targets: false }).AA, k.AA, 'targets: false leaves the 15 to the base bank');
  assert.ok(P({ targets: false }).AX && P({ targets: false }).AOQR);
  assert.equal(P({ reduced: false, weak: false }).AX, undefined);
  assert.equal(P({ rhotic: false }).AOQR, undefined);
  assert.equal(P({ glide: false }).AY.glide, undefined);
  // balance: false: the fitted formants, the base bank's bandwidths and amplitudes
  const nb = P({ balance: false });
  for (const c of ['AA', 'IY', 'AX', 'AOQR']) {
    assert.equal(nb[c].F2, VOWEL_TARGETS[c].F2, c);
    for (const f of ['BW1', 'BW2', 'BW3', 'A2', 'A3']) assert.equal(nb[c][f], k[vowelOf(c)][f], `${c}.${f}`);
  }
  assert.notEqual(P({ balance: true }).IY.BW2, k.IY.BW2, 'balance: true sets them');
  assert.equal(P({}).IY.BW2, k.IY.BW2, 'balance is off by default');
  const ph = P({ phonemes: { IY: { F2: 2500, glideTo: { F3: 3100 }, glide: [0.1, 0.6] }, AX: { BW1: null, glideTo: null }, AY: { glide: null } } });
  assert.equal(ph.IY.F2, 2500); assert.equal(ph.IY.glideTo.F3, 3100); assert.deepEqual(ph.IY.glide, [0.1, 0.6]);
  // null: the base bank's value (AX: AH's), or none
  assert.equal(ph.AX.BW1, k.AH.BW1); assert.equal(ph.AX.glideTo, undefined); assert.equal(ph.AY.glide, undefined);
  assert.equal(k.AA.glideTo, undefined, 'the base bank is untouched');
  for (const bad of [{ targets: 1 }, { balance: 'no' }, { foo: true }, { weak: 'to' }, { phonemes: { XX: {} } }, { phonemes: { AA: { glide: [0.8, 0.2] } } },
    { phonemes: { AA: { F9: 1 } } }, { singGlideMs: -1 }, 'yes']) {
    assert.throws(() => speak({ text: 'A cat.', vowels: bad }), JSON.stringify(bad));
  }
});

test('codes in the string: reduced AX IX AXR, weak forms, r-colored vowels; the timeline names the lexical vowel', () => {
  const text = 'The dark river was there to help her in the four hours.';
  const spec = { text, functionWords: true, vowels: true };
  const cs = codes(speak(spec));
  for (const c of ['AX', 'AAQR', 'AXR', 'EHQR', 'AOQR', 'IX']) assert.ok(cs.includes(c), c);
  assert.ok(!cs.includes('AH') && !cs.includes('UW'), 'every AH0 and the weak "to" reduced');
  const tl = timelineOf(spec).phones;
  const coded = tl.filter((x) => x.code);
  assert.ok(coded.length >= 8);
  for (const x of coded) assert.equal(vowelOf(x.code) === x.p || (x.code === 'AX' && VOWELS.has(x.p)), true, `${x.p} ${x.code}`);
  assert.deepEqual(tl.filter((x) => x.code === 'AX').map((x) => x.p).sort().filter((p, i, a) => a.indexOf(p) === i), ['AA', 'AH', 'UW'], 'the, was, to');
  // weak forms only for the listed function words, only unstressed (functionWords)
  assert.ok(WEAK_FORMS.includes('to') && WEAK_FORMS.includes('was'));
  assert.ok(codes(speak({ text: 'to was', vowels: true })).includes('UW'), 'without functionWords "to" keeps its stress');
  // no warnings with every feature on, and the durations are the option's own business: unchanged
  const all = { ...spec, coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true, prosody: true, aspiration: 'breath' };
  assert.deepEqual(compiled(all).warnings, []);
  assert.deepEqual(durationsOf(all), durationsOf({ ...all, vowels: false }));
  assert.deepEqual(timelineOf(all).phones.map((x) => [x.p, x.start, x.end]), timelineOf({ ...all, vowels: false }).phones.map((x) => [x.p, x.start, x.end]));
});

test('klattsch patch: glide [a, b] times the formant glide (with and without [CO]); none: as before; [GLMS] caps it', () => {
  const bank = { schemaVersion: 1, name: 'vw-test', extends: 'klatt1980-en', phonemes: {
    UU: { ...banks.get('klatt1980-en').phonemes.AY, glide: [0.5, 0.9] }, VV: { ...banks.get('klatt1980-en').phonemes.AY } } };
  registerBank(bank);
  const glideEvent = (s, F2) => compileString(s).schedule.find((e) => Math.abs((e.target.F2 ?? 0) - F2) < 1e-6 && e.atMs > 0);
  // without [CO]: the second event at 50% of the 200 ms slot over 80 ms; the entry's own (VV) at 25% over 100 ms
  let e = glideEvent('[bank=vw-test] r200 UU', 1880);
  near(e.atMs, 100); near(e.transitionMs, 80);
  e = glideEvent('[bank=vw-test] r200 VV', 1880);
  near(e.atMs, 50); near(e.transitionMs, 100);
  assert.equal(compileString('[bank=vw-test] r200 UU').schedule.some((x) => 'glide' in x.target), false, 'glide is no target');
  // under [CO]: the formant event moves at the window, F0 and the rest at 0.25-0.75 as before
  const co = compileString('[bank=vw-test] [CO=2] r200 UU').schedule;
  const fe = co.filter((x) => x.params && x.params.join() === 'F1,F2,F3' && x.target.F2 === 1880);
  assert.equal(fe.length, 1); near(fe[0].atMs, 100); near(fe[0].transitionMs, 80);
  assert.ok(co.some((x) => x.atMs === 50 && x.transitionMs === 100 && x.params && !x.params.includes('F2')));
  // [GLMS=40]: the glide ends at 0.9 but starts 40 ms before; the bank's own diphthong likewise (from 0.75)
  e = glideEvent('[bank=vw-test] [GLMS=40] r200 UU', 1880);
  near(e.atMs, 140); near(e.transitionMs, 40);
  e = glideEvent('[bank=vw-test] [GLMS=40] r200 VV', 1880);
  near(e.atMs, 110); near(e.transitionMs, 40);
  e = glideEvent('[bank=vw-test] [GLMS=400] r200 UU', 1880);
  near(e.atMs, 100, 'a cap longer than the glide changes nothing');
});

test('onset / offset targets act through coarticulation: the CV move goes to the onset, the glide and VC from the offset', () => {
  const spec = { text: 'Big feet.', vowels: true, coarticulation: true };
  const P = banks.get(bankName(spec)).phonemes, c = compiled(spec);
  const fe = formantEvents(c);
  // the IH of "big": its onset target (CV move after B's locus step), then the glide to its offset
  assert.ok(fe.some((e) => Math.abs(e.target.F2 - P.IH.F2) < 0.01), 'CV move to the onset target');
  assert.ok(fe.some((e) => Math.abs(e.target.F2 - P.IH.glideTo.F2) < 0.01), 'glide to the offset target');
  // the VC boundary toward G is computed from the offset: F + 2 (k F + c - F) with G's locus, F = glideTo
  const L = P.G.locus.F2, F = P.IH.glideTo.F2;
  assert.ok(fe.some((e) => Math.abs(e.target.F2 - (F + 2 * (L[0] * F + L[1] - F))) < 0.01), 'VC boundary from the offset');
});

test('sing: [GLMS=singGlideMs] after the other directives, diphthongs not split; speak has none', () => {
  const o = { mode: 'sing', text: 'High above', notes: [['A2', 8], ['G2', 2], ['F2', 8]], vowels: true };
  const s = sing(o);
  assert.match(s, /\[GLMS=150\] g0\.55/);
  assert.ok(codes(s).includes('AY') && !codes(s).includes('AA'), 'AY is one gliding vowel');
  assert.match(sing({ ...o, vowels: { singGlideMs: 90 } }), /\[GLMS=90\]/);
  assert.ok(!sing({ ...o, vowels: { singGlideMs: false } }).includes('[GLMS'));
  assert.ok(!speak({ text: 'High above.', vowels: true }).includes('[GLMS'));
  assert.ok(codes(sing({ ...o, vowels: false })).includes('AA'), 'without the option the long AY is split as before');
});
