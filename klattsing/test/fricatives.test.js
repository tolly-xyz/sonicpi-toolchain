// "fricatives" (klattsing) and klattsch's [FRIC=x] patch: a frication path in the synth (noise through resonators of
// its own and a bypass, Klatt 1980's parallel branch), per-fricative entries fitted to Kokoro, envelopes; inert
// unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf } from '../src/compile.js';
import { bankName, banksFor } from '../src/banks.js';
import { FRICATION, FRICATIVES, FRIC_CODES, fricOptions, fricDirectives } from '../src/fricatives.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, renderToBuffer, FormantSynth, banks } from '../../vendor/klattsch/src/engine/index.js';
import { FRIC_PARAMS } from '../../vendor/klattsch/src/engine/synth-core.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const hasFricKey = (t) => FRIC_PARAMS.some((k) => k in t);
const compiled = (spec) => { for (const b of banksFor(spec)) registerBank(b); return compileString(toKlattsch(spec)); };
const audio = (spec, sr = 16000) => { const c = compiled(spec); return renderToBuffer({ sampleRate: sr, schedule: c.schedule, totalMs: c.totalMs }); };
const rmsDb = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, b - a) + 1e-30); };
// power in dB of x[a, b) in the band lo-hi Hz (a plain DFT over the band's bins)
function bandDb(x, a, b, lo, hi, sr) {
  const n = b - a; let p = 0;
  for (let k = Math.ceil(lo * n / sr); k <= Math.floor(hi * n / sr); k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n), v = x[a + i] * w; re += v * Math.cos(2 * Math.PI * k * i / n); im -= v * Math.sin(2 * Math.PI * k * i / n); }
    p += re * re + im * im;
  }
  return 10 * Math.log10(p + 1e-30);
}

test('defaults: no fricatives option (or false/null) gives the reference strings; no frication keys in their schedules', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, fricatives: false }), out);
    assert.equal(toKlattsch({ ...spec, fricatives: null }), out);
    assert.ok(!out.includes('[FRIC'));
  }
  for (const { out } of REF.slice(0, 30)) {
    for (const e of compileString(out).schedule) assert.ok(!hasFricKey(e.target) && !e.fricOnly, out);
  }
});

test('option: [FRIC=gain] and a generated bank <base>--fr<hash> with an entry per fricative', () => {
  const s = speak({ text: 'Five thick shoes.', fricatives: true });
  assert.match(s, /^\[bank=klatt1980-en--fr[0-9a-f]{12}\] \[FRIC=1\] g0\.5/);
  const b = banks.get(bankName({ fricatives: true }));
  for (const c of FRIC_CODES) {
    const e = b.phonemes[c];
    assert.ok(e.frication && typeof e.frication.AF1 === 'number', c);
    for (const k of ['rise', 'fall', 'fallTo', 'fallToC', 'in']) assert.equal(e.frication[k], FRICATION[c].frication[k] ?? FRICATIVES[k], `${c}.${k}`);
    assert.equal(e.voicing, FRICATION[c].voicing);
  }
  // the chain: after coarticulation (its loci carry over), before stops
  const all = { text: 'Five thick shoes.', coarticulation: true, nasals: true, stops: true, fricatives: true };
  assert.match(speak(all), /^\[bank=klatt1980-en--nas[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\]/);
  const S = banks.get(bankName(all)).phonemes.S;
  assert.ok(S.locus && S.frication, 'coarticulation locus and frication on S');
  // fields over the defaults, an envelope for all, gain
  const o = { text: 'Sass.', fricatives: { gain: 0.5, fall: 0.2, phonemes: { S: { frication: { FF2: 6000, fall: 0.4 } } } } };
  assert.match(speak(o), /\[FRIC=0\.5\]/);
  const S2 = banks.get(bankName(o)).phonemes.S.frication;
  assert.equal(S2.FF2, 6000); assert.equal(S2.fall, 0.4); assert.equal(S2.FF1, FRICATION.S.frication.FF1);
  assert.equal(banks.get(bankName(o)).phonemes.F.frication.fall, 0.2);
  assert.equal(fricDirectives(null), '');
  // timings unchanged
  const t = { text: 'She sells five thin vases.', coarticulation: true, stops: true };
  assert.deepEqual(durationsOf({ ...t, fricatives: true }), durationsOf(t));
  assert.deepEqual(timelineOf({ ...t, fricatives: true }).phones.map((p) => [p.p, p.start, p.end]), timelineOf(t).phones.map((p) => [p.p, p.start, p.end]));
});

test('option: bad values throw', () => {
  assert.throws(() => fricOptions({ fricatives: 3 }), /true or an object/);
  assert.throws(() => fricOptions({ fricatives: { bogus: 1 } }), /fricatives\.bogus: unknown/);
  assert.throws(() => fricOptions({ fricatives: { gain: -1 } }), /fricatives\.gain/);
  assert.throws(() => fricOptions({ fricatives: { phonemes: { M: {} } } }), /fricatives\.phonemes\.M/);
  assert.throws(() => fricOptions({ fricatives: { phonemes: { S: { frication: { FF9: 1 } } } } }), /frication\.FF9: unknown/);
  assert.throws(() => fricOptions({ fricatives: { phonemes: { S: { A1: 'x' } } } }), /phonemes\.S\.A1/);
});

test('engine: without [FRIC] a bank\'s frication fields do nothing (the schedule is the plain entry\'s)', () => {
  const fr = { voicing: 0, F1: 320, F2: 1390, F3: 5500, BW1: 200, BW2: 200, BW3: 1000, A1: 0, A2: 0, A3: 0.95 };
  registerBank({ schemaVersion: 1, name: 'frictest-a', extends: 'klatt1980-en', phonemes: { S: fr } });
  registerBank({ schemaVersion: 1, name: 'frictest-b', extends: 'klatt1980-en', phonemes: { S: { ...fr, frication: { FF1: 5000, BF1: 1000, AF1: 1, fall: 0.3 } } } });
  const a = compileString('[bank=frictest-a] b110 r100 AA S AA p100 S'), b = compileString('[bank=frictest-b] b110 r100 AA S AA p100 S');
  assert.deepEqual(b.schedule, a.schedule);
  // with [FRIC]: fricOnly events at the S (frequencies, the rise, the fall), the vowel after it and the pause zero it
  const c = compileString('[bank=frictest-b] [FRIC=1] b110 r100 AA S AA p100 S').schedule;
  const fo = c.filter((e) => e.fricOnly);
  assert.equal(fo.length, 6);
  assert.deepEqual(fo[0].target, { FF1: 5000, BF1: 1000 });
  assert.deepEqual(fo[1].target, { AF1: 1, AF2: 0, AF3: 0, AB: 0 });
  assert.equal(fo[1].atMs, 100); assert.equal(fo[1].transitionMs, 5);
  assert.equal(fo[2].atMs, 170); assert.equal(fo[2].transitionMs, 30);
  assert.deepEqual(fo[2].target, { AF1: 0, AF2: 0, AF3: 0, AB: 0 });          // fallTo default 0
  const vowel = c.find((e) => !e.fricOnly && e.atMs === 200);
  assert.deepEqual([vowel.target.AF1, vowel.target.AB], [0, 0]);
  assert.ok(c.filter((e) => !e.fricOnly && e.atMs === 300).every((e) => e.target.AF1 === 0), 'the pause zeroes the frication');
  for (let i = 1; i < c.length; i++) assert.ok(c[i].atMs >= c[i - 1].atMs, 'sorted');
});

test('engine: the fall goes to fallTo before a vowel, fallToC before a consonant or a pause; `in` times the first event', () => {
  const base = { voicing: 0, F1: 320, F2: 1390, F3: 5500, BW1: 200, BW2: 200, BW3: 1000, A1: 0, A2: 0, A3: 0 };
  registerBank({ schemaVersion: 1, name: 'frictest-c', extends: 'klatt1980-en', phonemes: { S: { ...base, frication: { FF2: 5000, AF2: 0.5, fall: 0.5, fallTo: 0.4, fallToC: 0.1, in: 8 } } } });
  const c = compileString('[bank=frictest-c] [FRIC=2] b110 r100 AA S AA S T AA S').schedule;
  const falls = c.filter((e) => e.fricOnly && e.transitionMs === 50).map((e) => e.target.AF2);
  assert.deepEqual(falls.map((x) => Math.round(x * 100) / 100), [0.4, 0.1, 0.1]);   // gain 2 x 0.5 x (0.4 | 0.1)
  const sIn = c.filter((e) => !e.fricOnly && e.target.F3 === 5500 && e.atMs === 100);
  assert.equal(sIn[0].transitionMs, 8);
  // a fricative next to a nasal is not nasalized under [NAS] (a vowel is)
  registerBank({ schemaVersion: 1, name: 'frictest-d', extends: 'klatt1980-en', phonemes: { Z: { ...base, voicing: 1, A1: 0.1, frication: { AF2: 0.2 } } } });
  const n = compileString('[bank=frictest-d] [NAS=1] [FRIC=1] b110 r100 AA N Z').schedule;
  assert.ok(!n.some((e) => e.nasalOnly && e.atMs >= 200), 'no nasalization of Z');
});

test('engine: frication parameters move on their own clocks; fricOnly events leave the rest alone', () => {
  const sr = 16000;
  const schedule = [
    { atMs: 0, target: { F0: 100, voicing: 1, A1: 1, F1: 500 }, transitionMs: 1 },
    { atMs: 10, target: { F1: 900 }, transitionMs: 100 },
    { atMs: 20, target: { FF1: 4000, BF1: 500 }, transitionMs: 1, fricOnly: true },
    { atMs: 20, target: { AF1: 1 }, transitionMs: 40, fricOnly: true },
  ];
  const synth = new FormantSynth({ sampleRate: sr, schedule });
  assert.ok(!synth.fric);
  synth.process(new Float32Array(sr * 0.04));           // 40 ms
  assert.ok(synth.fric);
  assert.equal(synth.current.FF1, 4000); assert.equal(synth.current.BF1, 500);
  assert.ok(Math.abs(synth.current.AF1 - 0.5) < 0.01, `AF1 ${synth.current.AF1}`);
  assert.ok(Math.abs(synth.current.F1 - 620) < 2, `F1 ${synth.current.F1} keeps its own glide`);
  // a synth that never sees a frication key renders as before (the audio fixture checks whole utterances)
  const plain = new FormantSynth({ sampleRate: sr, schedule: schedule.slice(0, 2) });
  plain.process(new Float32Array(160));
  assert.ok(!plain.fric);
});

test('engine: the frication path puts the noise where its resonators are, at its amplitude', () => {
  const sr = 24000;
  const mk = (fr) => {
    const name = `frictest-${Math.random().toString(36).slice(2, 8)}`;
    registerBank({ schemaVersion: 1, name, extends: 'klatt1980-en', phonemes: { S: { voicing: 0, F1: 320, F2: 1390, F3: 5500, BW1: 200, BW2: 200, BW3: 1000, A1: 0, A2: 0, A3: 0, frication: { rise: 1, ...fr } } } });
    const c = compileString(`[bank=${name}] [FRIC=1] b110 r300 S`);
    return renderToBuffer({ sampleRate: sr, schedule: c.schedule, totalMs: c.totalMs });
  };
  const a = 0.1 * sr, b = a + 2048;
  const hi = mk({ FF1: 7000, BF1: 800, AF1: 0.5 }), lo = mk({ FF1: 2000, BF1: 800, AF1: 0.5 });
  assert.ok(bandDb(hi, a, b, 6000, 8000, sr) - bandDb(hi, a, b, 1500, 2500, sr) > 15, 'a 7 kHz resonance');
  assert.ok(bandDb(lo, a, b, 1500, 2500, sr) - bandDb(lo, a, b, 6000, 8000, sr) > 15, 'a 2 kHz resonance');
  const half = mk({ FF1: 7000, BF1: 800, AF1: 0.25 });
  assert.ok(Math.abs(rmsDb(hi, a, b) - rmsDb(half, a, b) - 6.02) < 0.1, 'amplitude');
  const ab = mk({ AB: 0.1 });
  assert.ok(Math.abs(bandDb(ab, a, b, 1000, 2000, sr) - bandDb(ab, a, b, 8000, 9000, sr)) < 3, 'the bypass is flat');
  const none = mk({ FF1: 7000, BF1: 800, AF1: 0 });
  assert.ok(rmsDb(none, a, b) < -100, 'no frication, no main path: silence');
});

test('fricatives: the fitted entries change the sound in speech and song; sing mode carries [FRIC]', () => {
  const text = 'She sells five thin vases, the zoo.';
  const x = audio({ text, fricatives: true }), y = audio({ text });
  assert.equal(x.length, y.length);
  assert.ok(x.some((v, i) => v !== y[i]));
  const s = sing({ text: 'She sells sea shells', notes: 'auto', fricatives: true });
  assert.match(s, /\[FRIC=1\] g0\.55/);
  assert.ok(audio({ mode: 'sing', text: 'She sells sea shells', notes: 'auto', fricatives: true }).length > 0);
});
