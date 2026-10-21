// "nasals" (klattsing) and klattsch's [NAS=x] patch: a nasal pole-zero path in the synth (Klatt 1980 FNP/FNZ, a
// second pair, AN), murmur fields per nasal consonant, nasalized vowels next to them; inert unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf } from '../src/compile.js';
import { bankName, banksFor } from '../src/banks.js';
import { NASAL_MURMUR, NASALS, nasalOptions, nasalDirectives } from '../src/nasals.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, renderToBuffer, FormantSynth, banks } from '../../vendor/klattsch/src/engine/index.js';
import { NASAL_PARAMS, NASAL_DEFAULT } from '../../vendor/klattsch/src/engine/synth-core.js';
import { KlattResonator, KlattAntiresonator } from '../../vendor/klattsch/src/engine/dsp.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const render = (s, sr = 16000) => { const c = compileString(s); return renderToBuffer({ sampleRate: sr, schedule: c.schedule, totalMs: c.totalMs }); };
const hasNasalKey = (t) => NASAL_PARAMS.some((k) => k in t);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
// gain in dB of a filter (x -> y per sample) at f Hz, from a steady sine
function gainDb(make, f, sr = 16000) {
  const flt = make(), n = sr, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = Math.sin(2 * Math.PI * f * i / sr); y[i] = flt(x[i]); }
  return 20 * Math.log10(rms(y.subarray(n / 2)) / rms(x.subarray(n / 2)));
}

test('defaults: no nasals option (or false/null) gives the reference strings; no nasal keys in their schedules', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, nasals: false }), out);
    assert.equal(toKlattsch({ ...spec, nasals: null }), out);
  }
  for (const { out } of REF.slice(0, 30)) {
    for (const e of compileString(out).schedule) assert.ok(!hasNasalKey(e.target) && !e.nasalOnly, out);
  }
});

test('dsp: Klatt resonator and antiresonator are unity at DC, cancel at equal F and BW, and give a notch', () => {
  const sr = 16000;
  const pair = (fp, bp, fz, bz) => () => { const r = new KlattResonator(), z = new KlattAntiresonator(); r.setFreq(fp, bp, sr); z.setFreq(fz, bz, sr); return (x) => z.process(r.process(x)); };
  // equal: the identity (up to rounding)
  const id = pair(300, 100, 300, 100)();
  for (let i = 0; i < 200; i++) { const x = Math.sin(i * 0.37) + (i === 3 ? 1 : 0); assert.ok(Math.abs(id(x) - x) < 1e-9); }
  // DC gain 1
  const r = new KlattResonator(); r.setFreq(270, 100, sr); let y = 0; for (let i = 0; i < 4000; i++) y = r.process(1);
  assert.ok(Math.abs(y - 1) < 1e-6, `resonator DC ${y}`);
  // zero above the pole: (FNP / FNZ)^2 off the highs, a dip at FNZ
  const g = (f) => gainDb(pair(270, 100, 450, 100), f, sr);
  assert.ok(Math.abs(g(3000) - 40 * Math.log10(270 / 450)) < 1, `highs ${g(3000)}`);
  assert.ok(g(270) > 5 && g(450) < g(270) - 10, `peak ${g(270)} dip ${g(450)}`);
  // a notch: pole and zero at one frequency, the pole broader: 20 log(BNZ / BNP) at the centre, ~0 dB away from it
  const n = (f) => gainDb(pair(1500, 600, 1500, 100), f, sr);
  assert.ok(Math.abs(n(1500) - 20 * Math.log10(100 / 600)) < 1, `notch ${n(1500)}`);
  assert.ok(Math.abs(n(300)) < 1 && Math.abs(n(5000)) < 1, `${n(300)} ${n(5000)}`);
});

test('engine: neutral nasal parameters (the pairs cancel, AN 0) render the non-nasal sound', () => {
  const s = 'b110 r120 AA M AA N IY';
  const plain = render(s);
  const neutral = Object.entries(NASAL_DEFAULT).map(([k, v]) => `[${k}=${v}]`).join(' ');
  const n = render(`${neutral} ${s}`);
  assert.equal(n.length, plain.length);
  let d = 0; for (let i = 0; i < n.length; i++) d = Math.max(d, Math.abs(n[i] - plain[i]));
  assert.ok(d < 1e-4, `max difference ${d}`);
  assert.ok(!same(render(`[FNZ=600] ${s}`), plain), 'a nasal directive switches the path on');
  // GN: a gain on the nasal path (level only)
  const g = render(`${neutral} [GN=0.5] ${s}`);
  assert.ok(Math.abs(20 * Math.log10(rms(g) / rms(plain)) + 6.02) < 0.3, `GN 0.5: ${20 * Math.log10(rms(g) / rms(plain))} dB`);
});

test('engine: a nasalOnly event moves the nasal parameters alone, on their own clock', () => {
  const sr = 16000;
  const schedule = [
    { atMs: 0, target: { F0: 100, voicing: 1, A1: 1, F1: 500, FNP: 250, FNZ: 250 }, transitionMs: 1 },
    { atMs: 10, target: { F1: 900 }, transitionMs: 100 },
    { atMs: 50, target: { FNZ: 650 }, transitionMs: 20, nasalOnly: true },
  ];
  const synth = new FormantSynth({ sampleRate: sr, schedule });
  const buf = new Float32Array(sr * 0.08);
  synth.process(buf.subarray(0, sr * 0.06));                     // 60 ms: F1 halfway through its 100 ms glide
  assert.ok(Math.abs(synth.current.F1 - 700) < 2, `F1 ${synth.current.F1}`);
  assert.ok(Math.abs(synth.current.FNZ - 450) < 2, `FNZ ${synth.current.FNZ}`);
  synth.process(buf.subarray(sr * 0.06));                        // 80 ms
  assert.ok(Math.abs(synth.current.F1 - 780) < 2, 'the F1 glide was not retimed');
  assert.equal(synth.current.FNZ, 650);
  // shaped mode (coarticulation's per-parameter events) too
  const shaped = new FormantSynth({ sampleRate: sr, schedule: schedule.map((e, i) => (i === 1 ? { ...e, params: ['F1'], curve: 0 } : e)) });
  shaped.process(new Float32Array(sr * 0.06));
  assert.ok(Math.abs(shaped.current.F1 - 700) < 2 && Math.abs(shaped.current.FNZ - 450) < 2, `${shaped.current.F1} ${shaped.current.FNZ}`);
});

test('sequencer: [NAS] gives a nasal its murmur fields, everything else neutral ones; inert without [NAS]', () => {
  const bank = { schemaVersion: 1, name: 'nastest', extends: 'klatt1980-en', phonemes: {
    M: { ...banks.get('klatt1980-en').phonemes.M, nasal: true, FNP: 260, FNZ: 500, AN: 0.3, FNP2: 1100, FNZ2: 1100, BNP2: 500, BNZ2: 80 } } };
  registerBank(bank);
  const plain = compileString('[bank=nastest] b100 AA M AA');
  assert.ok(plain.schedule.every((e) => !hasNasalKey(e.target) && !e.nasalOnly), 'bank nasal fields act only with [NAS]');
  const c = compileString('[bank=nastest] [NAS=0] b100 AA M AA');
  const first = (code) => c.schedule.find((e) => e.target.F1 === banks.get('nastest').phonemes[code].F1 && hasNasalKey(e.target));
  const m = first('M');
  assert.deepEqual([m.target.FNP, m.target.FNZ, m.target.AN, m.target.FNZ2, m.target.BNZ2], [260, 500, 0.3, 1100, 80]);
  const aa = first('AA');
  for (const k of NASAL_PARAMS) assert.equal(aa.target[k], NASAL_DEFAULT[k], k);
  assert.ok(!c.schedule.some((e) => e.nasalOnly), 'strength 0: no vowel nasalization');
  // the formant scale moves the pole/zero frequencies like F1-F3
  const s = compileString('[bank=nastest] [NAS=0] s1.1 b100 M').schedule.find((e) => e.target.FNZ2);
  assert.ok(Math.abs(s.target.FNZ2 - 1210) < 1e-9 && Math.abs(s.target.FNZ - 550) < 1e-9 && s.target.AN === 0.3);
  // after a bare [NAS] the next phoneme puts the neutral parameters back
  const r = compileString('[bank=nastest] [NAS=0] b100 AA M [NAS] AA').schedule;
  const lastNasal = [...r].reverse().find((e) => hasNasalKey(e.target));
  assert.equal(lastNasal.target.FNZ, NASAL_DEFAULT.FNZ);
});

test('sequencer: vowels next to a nasal are nasalized over [NASVC] / [NASCV] of them, scaled by [NAS]', () => {
  const bank = { schemaVersion: 1, name: 'nastest2', extends: 'klatt1980-en', phonemes: {
    N: { ...banks.get('klatt1980-en').phonemes.N, nasal: true, FNP: 270, FNZ: 450, nasalizes: { FNP: 250, FNZ: 400, AN: 0.2 } } } };
  registerBank(bank);
  const c = compileString('[bank=nastest2] [NAS=0.5] [NASVC=0.4] [NASCV=0.3] r200 b100 AA N AA , AA');
  const ev = c.schedule.filter((e) => e.nasalOnly);
  const half = { FNZ: 250 + 0.5 * (400 - 250), AN: 0.1 };
  // vowel 1 (0-200 ms): toward the nasalized values from 60% of it; vowel 2 (400-600) starts nasalized, neutral by 30%
  assert.equal(ev.length, 2);
  assert.ok(Math.abs(ev[0].atMs - 120) < 1e-9 && Math.abs(ev[0].transitionMs - 80) < 1e-9 && ev[0].target.FNZ === half.FNZ && Math.abs(ev[0].target.AN - half.AN) < 1e-12);
  assert.ok(ev[1].atMs > 400 && ev[1].atMs + ev[1].transitionMs <= 400 + 60 + 1e-9 && ev[1].target.FNZ === NASAL_DEFAULT.FNZ);
  const v2 = c.schedule.find((e) => !e.nasalOnly && e.atMs === 400);
  assert.equal(v2.target.FNZ, half.FNZ, 'the vowel after the nasal starts nasalized');
  const v3 = c.schedule.find((e) => !e.nasalOnly && e.atMs > 600 && e.target.A1 > 0);
  assert.equal(v3.target.FNZ, NASAL_DEFAULT.FNZ, 'a pause breaks the context');
  assert.deepEqual(c.schedule.map((e) => e.atMs), [...c.schedule.map((e) => e.atMs)].sort((a, b) => a - b), 'in time order');
});

test('sequencer: [NAST=ms] times the events into a nasal and into the phoneme after it', () => {
  const ev = (s) => compileString(s).schedule.filter((e) => !e.nasalOnly && e.target.A1 > 0).map((e) => e.transitionMs);
  const bank = { schemaVersion: 1, name: 'nastest3', extends: 'klatt1980-en', phonemes: { M: { ...banks.get('klatt1980-en').phonemes.M, nasal: true } } };
  registerBank(bank);
  assert.deepEqual(ev('[bank=nastest3] [NAS=0] r200 AA M AA AH'), [35, 35, 35, 35]);
  assert.deepEqual(ev('[bank=nastest3] [NAS=0] [NAST=4] r200 AA M AA AH'), [35, 4, 4, 35]);
  assert.deepEqual(ev('[bank=nastest3] [NAST=4] r200 AA M AA AH'), [35, 35, 35, 35], 'only under [NAS]');
  const stop = compileString('[bank=nastest3] [NAS=0] [NAST=4] r200 AA M P AA').schedule.filter((e) => !e.nasalOnly);
  assert.equal(stop.find((e) => e.atMs === 400).transitionMs, 20, 'a stop closure after a nasal keeps its own');
});

test('option: directives, generated bank, validation; durations and timing unchanged', () => {
  const spec = { mode: 'speak', text: 'Nine men ran home.', bank: 'mitalk-bursts' };
  const plain = speak(spec), s = speak({ ...spec, nasals: true });
  const name = bankName({ ...spec, nasals: true });
  assert.match(name, /^mitalk-bursts--nas[0-9a-f]{12}$/);
  assert.equal(s, plain.replace('[bank=mitalk-bursts]', `[bank=${name}]`).replace(' g0.5', ` ${nasalDirectives(nasalOptions({ nasals: true }))} g0.5`));
  assert.match(s, /\[NAS=[\d.]+\]/);
  assert.deepEqual(compileString(s).warnings, []);
  const b = banks.get(name).phonemes;
  for (const p of ['M', 'N', 'NG']) {
    assert.equal(b[p].nasal, true);
    for (const [k, v] of Object.entries(NASAL_MURMUR[p])) assert.deepEqual(b[p][k], v, `${p}.${k}`);
  }
  assert.equal(b.AA.nasal, undefined);
  assert.equal(bankName({ ...spec, nasals: {} }), name, 'true = the defaults');
  const m2 = bankName({ ...spec, nasals: { murmur: { M: { FNZ2: 900 } } } });
  assert.notEqual(m2, name); assert.equal(banks.get(m2).phonemes.M.FNZ2, 900);
  assert.equal(banks.get(bankName({ ...spec, nasals: { murmur: { M: { AN: null } } } })).phonemes.M.AN, undefined, 'null removes a field');
  // chain: nasal entries first, then bankPatch, coarticulation (which keep the nasal fields)
  const chain = banksFor({ ...spec, nasals: true, bankPatch: { M: { A1: 0.5 } }, coarticulation: true });
  assert.deepEqual(chain.map((x) => x.name.replace(/[0-9a-f]{12}/g, '#')), ['mitalk-bursts--nas#', 'mitalk-bursts--nas#--#', 'mitalk-bursts--nas#--#--co#']);
  const top = banks.get(chain[2].name).phonemes.M;
  assert.ok(top.nasal && top.A1 === 0.5 && top.locus, 'all three kept');
  assert.match(speak({ ...spec, nasals: { strength: 0.5, vc: 0.4, cv: 0.2, transition: 5 } }), /\[NAS=0\.5\] \[NASVC=0\.4\] \[NASCV=0\.2\] \[NAST=5\]/);
  // validation
  assert.throws(() => nasalOptions({ nasals: 1 }), /nasals: true or an object/);
  assert.throws(() => nasalOptions({ nasals: { strenght: 1 } }), /nasals.strenght: unknown/);
  assert.throws(() => nasalOptions({ nasals: { strength: -1 } }), /nasals.strength: a number >= 0/);
  assert.throws(() => nasalOptions({ nasals: { murmur: { B: { FNZ: 1 } } } }), /nasals.murmur.B/);
  assert.throws(() => nasalOptions({ nasals: { murmur: { M: { FNZ: 'x' } } } }), /nasals.murmur.M.FNZ/);
  assert.throws(() => nasalOptions({ nasals: { nasalized: { F1: 300 } } }), /nasals.nasalized.F1/);
  // timing untouched, sing mode too
  assert.deepEqual(durationsOf({ ...spec, nasals: true }), durationsOf(spec));
  assert.deepEqual(timelineOf({ ...spec, nasals: true }).phones, timelineOf(spec).phones);
  const sg = { mode: 'sing', text: 'Nine men', bpm: 120, notes: 'auto' };
  assert.match(sing({ ...sg, nasals: true }), /\[NAS=/);
  assert.equal(NASALS.strength, nasalOptions({ nasals: true }).strength);
});

test('renders: nasals change the nasal consonants and their vowels, not a sentence without them', () => {
  const nas = { mode: 'speak', text: 'Nine men ran home.', bank: 'mitalk-bursts' };
  const audio = (spec) => { for (const b of banksFor(spec)) registerBank(b); return render(speak(spec)); };
  const a = audio(nas), b = audio({ ...nas, nasals: true });
  assert.equal(a.length, b.length);
  assert.ok(!same(a, b));
  assert.ok(b.every(Number.isFinite) && Math.abs(20 * Math.log10(rms(b) / rms(a))) < 3, `${rms(a)} ${rms(b)}`);
  // no nasal consonant: the nasal path runs, but only with neutral pairs (equal up to rounding)
  const oral = { mode: 'speak', text: "It's easy to tell the depth of a well.", bank: 'mitalk-bursts' };
  const c = audio(oral), d = audio({ ...oral, nasals: true });
  let diff = 0; for (let i = 0; i < c.length; i++) diff = Math.max(diff, Math.abs(c[i] - d[i]));
  assert.ok(diff < 1e-4, `max difference ${diff}`);
});
