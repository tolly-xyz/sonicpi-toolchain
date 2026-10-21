// "coarticulation" (klattsing) and klattsch's [CO=x] / [TC=n] patch: locus-equation boundaries, VC transitions,
// HH taking the next vowel's formants, velar bursts, shaped transitions; all of it inert unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf } from '../src/compile.js';
import { bankName, banksFor, coartBank } from '../src/banks.js';
import { LOCI, lociOf, coartOptions, coartDirectives, COARTICULATION } from '../src/coarticulation.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, renderToBuffer, FormantSynth, PARAMS, banks } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const KLATT = banks.get('klatt1980-en').phonemes;
const formantEvents = (c) => c.schedule.filter((e) => e.params && e.params.join() === 'F1,F2,F3');
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('defaults: no coarticulation option (or false/null) gives the reference strings, no curve or params in the schedule', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, coarticulation: false }), out);
    assert.equal(toKlattsch({ ...spec, coarticulation: null }), out);
  }
  for (const { out } of REF.slice(0, 20)) {
    for (const e of compileString(out).schedule) assert.ok(!('curve' in e) && !('params' in e), out);
  }
});

test('defaults: the engine renders default strings sample for sample as before the patch', () => {
  // sha1 of the float audio (16 kHz) of every 7th reference string and one with [TR]/[AV], from the engine before [CO]/[TC]
  const h = createHash('sha1');
  const strings = REF.filter((_, i) => i % 7 === 0).map((r) => r.out).concat(['[TR=70] [AV=0.8] HH AH L OW p200 b=C3 (D IY P) (S IY)']);
  for (const s of strings) {
    const c = compileString(s);
    for (const v of c.voices) if (v.schedule.length) h.update(Buffer.from(renderToBuffer({ sampleRate: 16000, schedule: v.schedule, totalMs: v.totalMs }).buffer));
  }
  assert.equal(h.digest('hex'), 'e0357552625a2441483dbe796f2ccc1812624e53');
});

test('option: directives in the prefix and a generated bank with the coarticulation fields', () => {
  const s = speak({ text: 'Keep the cat.', bank: 'mitalk-bursts', coarticulation: true });
  assert.match(s, /^\[bank=mitalk-bursts--co[0-9a-f]{12}\] \[CO=2\] \[TC=2\] \[COCV=60\] \[COVC=50\] g0\.5/);
  assert.deepEqual(compileString(s).warnings, []);
  const name = bankName({ bank: 'mitalk-bursts', coarticulation: true });
  assert.equal(name, bankName({ bank: 'mitalk-bursts', coarticulation: {} }), 'true = the defaults');
  assert.notEqual(name, bankName({ bank: 'mitalk-bursts', coarticulation: { burst: false } }));
  const b = banks.get(name).phonemes;
  assert.equal(b.IY.vowel, true); assert.equal(b.AA.vowel, true); assert.equal(b.S.vowel, undefined);
  assert.deepEqual(b.D.locus, { F1: LOCI.alveolar.F1, F2: LOCI.alveolar.F2, F3: LOCI.alveolar.F3 });
  assert.equal(b.K.locusBurst, true); assert.equal(b.T.locusBurst, undefined); assert.equal(b.NG.locusBurst, undefined);
  assert.equal(b.HH.transparent, true);
  assert.equal(b.D.burstMs, banks.get('mitalk-bursts').phonemes.D.burstMs, 'the base entry is kept');
  assert.deepEqual(banksFor({ bank: 'mitalk-bursts', coarticulation: true }).map((x) => x.name), [name]);
  // with bankPatch and breath: patch, then coarticulation, then the breath entries (which inherit vowel: true)
  const chain = banksFor({ bank: 'mitalk-bursts', bankPatch: { AA: { F1: 700 } }, coarticulation: true, aspiration: 'breath' });
  assert.deepEqual(chain.map((x) => x.name.replace(/[0-9a-f]{12}/g, '#')), ['mitalk-bursts--#', 'mitalk-bursts--#--co#', 'mitalk-bursts--#--co#--br#']);
  assert.equal(banks.get(chain[2].name).phonemes.BRAA.vowel, true);
  assert.equal(banks.get(chain[2].name).phonemes.AA.F1, 700);
  assert.match(speak({ text: 'a', coarticulation: { degree: 0.5, codaDegree: 0.25, curve: 'linear', cv: 40, vc: 30 } }),
    /\[CO=0\.5\] \[COR=0\.25\] \[COCV=40\] \[COVC=30\]/);
  assert.throws(() => speak({ text: 'a', coarticulation: { curve: 'wobbly' } }), /curve/);
  assert.throws(() => speak({ text: 'a', coarticulation: { cv: -1 } }), /cv/);
  assert.throws(() => speak({ text: 'a', coarticulation: { loci: { D: { F2: [0.5] } } } }), /loci\.D\.F2/);
  assert.deepEqual(coartOptions(true), COARTICULATION);
  assert.equal(coartDirectives(coartOptions({ curve: 'cos' })), '[CO=2] [TC=1] [COCV=60] [COVC=50]');
  assert.equal(coartDirectives(coartOptions({ formantCurve: 'linear' })), '[CO=2] [TC=2] [TCF=0] [COCV=60] [COVC=50]');
  assert.equal(coartDirectives(coartOptions({ curve: 0, formantCurve: 'out' })), '[CO=2] [TCF=2] [COCV=60] [COVC=50]');
  assert.throws(() => coartOptions({ formantCurve: 7 }), /formantCurve/);
  // liquids and glides: loci that glide (smooth), unless sonorants: false
  assert.deepEqual(b.L.locus.F2, LOCI.lateral.F2); assert.equal(b.L.smooth, true); assert.equal(b.D.smooth, undefined);
  assert.equal(banks.get(bankName({ bank: 'mitalk-bursts', coarticulation: { sonorants: false } })).phonemes.L.locus, undefined);
  assert.deepEqual(lociOf({ loci: { D: { F2: [0.4, 1200] } } }).D.F2, [0.4, 1200]);
  assert.equal(lociOf({ loci: { D: null } }).D, undefined);
});

test('durations and timeline: the same phonemes and times with or without coarticulation', () => {
  const spec = { mode: 'speak', text: 'Pin the top, then stop.', bank: 'mitalk-bursts' };
  assert.deepEqual(durationsOf({ ...spec, coarticulation: true }), durationsOf(spec));
  const a = timelineOf(spec), b = timelineOf({ ...spec, coarticulation: true });
  assert.deepEqual(b.phones, a.phones); assert.equal(b.totalMs, a.totalMs);
  const sungSpec = { mode: 'sing', text: 'Lower the bucket', bpm: 168, notes: [['E2', 3], ['G2', 3], ['F2', 3], ['A2', 3], ['G2', 4]] };
  assert.deepEqual(timelineOf({ ...sungSpec, coarticulation: true }).phones, timelineOf(sungSpec).phones);
  assert.deepEqual(compileString(sing({ ...sungSpec, coarticulation: true })).warnings, []);
});

// a hand-written klattsch string over a bank carrying the fields
const BANK = coartBank('klatt1980-en', true).name;
if (!banks.list().includes(BANK)) speak({ text: 'a', coarticulation: true });
const co = (s, pre = '[CO=1]') => compileString(`[bank=${BANK}] ${pre} ${s}`);

test('CV: the vowel starts at the locus-equation value for it, then moves to its target', () => {
  const c = co('r100 D r200 AA');
  assert.deepEqual(c.warnings, []);
  const aa = c.phrases.find((p) => p.phoneme === 'AA');
  const fe = formantEvents(c).filter((e) => e.atMs >= aa.tStartMs - 1e-9);
  const [k, b] = LOCI.alveolar.F2;
  assert.ok(near(fe[0].target.F2, KLATT.AA.F2 + (k * KLATT.AA.F2 + b - KLATT.AA.F2)), `${fe[0].target.F2}`);
  assert.ok(near(fe[0].atMs, aa.tStartMs) && fe[0].transitionMs <= 3);
  assert.ok(near(fe[1].target.F2, KLATT.AA.F2) && fe[1].transitionMs === 60 && fe[1].curve === undefined);
  // degree x scales the pull; 0 starts on the vowel's own target
  const half = formantEvents(co('r100 D r200 AA', '[CO=0.5]')).find((e) => e.atMs >= aa.tStartMs - 1e-9);
  assert.ok(near(half.target.F2, KLATT.AA.F2 + 0.5 * (k * KLATT.AA.F2 + b - KLATT.AA.F2)));
  const none = formantEvents(co('r100 D r200 AA', '[CO=0]')).find((e) => e.atMs >= aa.tStartMs - 1e-9);
  assert.ok(near(none.target.F2, KLATT.AA.F2));
  // other parameters move in their own events, at their usual times (formants excluded)
  const other = c.schedule.filter((e) => e.params && e.params.includes('A1'));
  assert.ok(other.length && other.every((e) => !e.params.includes('F2') && e.params.length === PARAMS.length - 3));
  // the formant scale applies to the boundary too
  const sc = formantEvents(co('s0.9 r100 D r200 AA')).find((e) => e.atMs >= aa.tStartMs - 1e-9);
  assert.ok(near(sc.target.F2, 0.9 * fe[0].target.F2, 1e-6));
});

test('velars: the burst and the vowel onset front before front vowels', () => {
  const burstF2 = (v) => {
    const c = co(`r100 G r200 ${v}`), g = c.phrases.find((p) => p.phoneme === 'G');
    return formantEvents(c).find((e) => e.atMs > g.tStartMs + 1).target.F2;   // at the burst
  };
  const [k, b] = LOCI.velar.F2;
  assert.ok(near(burstF2('IY'), k * KLATT.IY.F2 + b));
  assert.ok(near(burstF2('UW'), k * KLATT.UW.F2 + b));
  assert.ok(burstF2('IY') > burstF2('UW') + 500, 'fronted before IY');
  // with burst: false the burst keeps the stop's own formants
  const nb = coartBank('klatt1980-en', { burst: false }).name;
  speak({ text: 'a', coarticulation: { burst: false } });
  const c = compileString(`[bank=${nb}] [CO=1] r100 G r200 IY`), g = c.phrases.find((p) => p.phoneme === 'G');
  assert.equal(formantEvents(c).find((e) => e.atMs > g.tStartMs + 1).target.F2, KLATT.G.F2);
});

test('VC: the vowel moves toward the next consonant\'s value over its last COVC ms (at most 60% of it)', () => {
  const c = co('[COVC=40] r200 AA r100 D'), aa = c.phrases.find((p) => p.phoneme === 'AA');
  const last = formantEvents(c).filter((e) => e.atMs < aa.tEndMs).at(-1);
  const [k, b] = LOCI.alveolar.F2;
  assert.ok(near(last.atMs, aa.tEndMs - 40) && last.transitionMs === 40);
  assert.ok(near(last.target.F2, k * KLATT.AA.F2 + b));
  const short = co('r50 AA r100 D'), a2 = short.phrases.find((p) => p.phoneme === 'AA');
  const l2 = formantEvents(short).filter((e) => e.atMs < a2.tEndMs).at(-1);
  assert.ok(near(l2.transitionMs, 30) && near(l2.atMs, a2.tEndMs - 30), 'capped at 60% of a short vowel');
  // [COR=x] sets the VC pull on its own
  const r0 = co('r200 AA r100 D', '[CO=1] [COR=0]'), a3 = r0.phrases.find((p) => p.phoneme === 'AA');
  assert.ok(near(formantEvents(r0).filter((e) => e.atMs < a3.tEndMs).at(-1).target.F2, KLATT.AA.F2));
  // a diphthong ends from its glide target
  const ay = co('r200 AY r100 D'), a4 = ay.phrases.find((p) => p.phoneme === 'AY');
  assert.ok(near(formantEvents(ay).filter((e) => e.atMs < a4.tEndMs).at(-1).target.F2, k * KLATT.AY.glideTo.F2 + b));
  // no consonant with a locus after the vowel: no VC event
  const al = co('r200 AA r100 IY'), a5 = al.phrases.find((p) => p.phoneme === 'AA');
  assert.equal(formantEvents(al).filter((e) => e.atMs > a5.tStartMs + 1 && e.atMs < a5.tEndMs).length, 0);
});

test('HH takes the next vowel\'s formants; after a stop the CV transition starts at the release', () => {
  const c = co('r80 HH r200 IY'), hh = c.phrases.find((p) => p.phoneme === 'HH');
  const first = formantEvents(c).find((e) => e.atMs >= hh.tStartMs);
  assert.deepEqual([first.target.F1, first.target.F2, first.target.F3], [KLATT.IY.F1, KLATT.IY.F2, KLATT.IY.F3]);
  const k2 = co('r80 K r25 HH r200 AA'), h2 = k2.phrases.find((p) => p.phoneme === 'HH'), aa = k2.phrases.find((p) => p.phoneme === 'AA');
  const ev = formantEvents(k2).filter((e) => e.atMs >= h2.tStartMs - 1e-9);
  const [k, b] = LOCI.velar.F2;
  assert.ok(near(ev[0].target.F2, k * KLATT.AA.F2 + b), 'HH at the velar boundary for AA');
  assert.ok(near(ev[1].target.F2, KLATT.AA.F2) && ev[1].transitionMs === 60, 'then toward AA');
  assert.equal(ev.length, 2, 'no new formant event when the vowel starts');
  assert.ok(ev.every((e) => e.atMs < aa.tStartMs));
  // without coarticulation HH keeps its own formants
  const plain = compileString('r80 HH r200 IY');
  assert.equal(plain.schedule[0].target.F2, KLATT.HH.F2);
});

test('liquids and glides: entered at the usual pace, and a vowel after one glides from its formants', () => {
  const c = co('r200 AA r100 L r200 IY'), l = c.phrases.find((p) => p.phoneme === 'L'), iy = c.phrases.find((p) => p.phoneme === 'IY');
  const fe = formantEvents(c);
  const vc = fe.filter((e) => e.atMs < l.tStartMs).at(-1), [k, b] = LOCI.lateral.F2;
  assert.ok(near(vc.target.F2, k * KLATT.AA.F2 + b), 'VC toward the lateral boundary');
  const intoL = fe.find((e) => near(e.atMs, l.tStartMs));
  assert.ok(intoL.target.F2 === KLATT.L.F2 && intoL.transitionMs === 35, `${intoL.transitionMs}`);
  const intoIY = fe.filter((e) => near(e.atMs, iy.tStartMs));
  assert.equal(intoIY.length, 1);
  assert.ok(intoIY[0].target.F2 === KLATT.IY.F2 && intoIY[0].transitionMs === 60, 'no jump: from L itself over COCV');
});

test('obstruents reach their own formants at once; a phoneme-free pause breaks the context', () => {
  const c = co('r200 AA r100 S'), s = c.phrases.find((p) => p.phoneme === 'S');
  const e = formantEvents(c).find((x) => near(x.atMs, s.tStartMs));
  assert.ok(e.target.F3 === KLATT.S.F3 && e.transitionMs <= 3);
  const p = co('r100 D p200 r200 AA'), aa = p.phrases.find((x) => x.phoneme === 'AA');
  const fe = formantEvents(p).find((x) => x.atMs >= aa.tStartMs - 1e-9);
  assert.ok(near(fe.target.F2, KLATT.AA.F2), 'no locus across a pause');
});

test('[TCF=n]: the formant events\' own curve', () => {
  const c = co('r100 D r200 AA', '[CO=1] [TC=2] [TCF=0]');
  assert.ok(formantEvents(c).every((e) => e.curve === undefined));
  assert.ok(c.schedule.filter((e) => !formantEvents(c).includes(e)).every((e) => e.curve === 2));
  assert.ok(formantEvents(co('r100 D r200 AA', '[CO=1] [TCF=1]')).every((e) => e.curve === 1));
  // [TC] alone, without [CO]: every event shaped, all parameters together
  const t = compileString('[TC=2] r100 D r200 AA');
  assert.ok(t.schedule.every((e) => e.curve === 2 && !('params' in e)));
});

test('synth: shaped transitions (raised cosine, ease-out) and per-parameter events', () => {
  const sr = 1000, at = (synth, n) => { synth.process(new Float32Array(n)); return synth.current; };
  const ev = (curve, params) => [{ atMs: 0, target: { F2: 2000, A1: 1 }, transitionMs: 100, ...(curve ? { curve } : {}), ...(params ? { params } : {}) }];
  const lin = new FormantSynth({ sampleRate: sr, schedule: ev(0) });
  assert.equal(lin.shaped, false);
  assert.ok(near(at(lin, 50).F2, 1500 + 500 * 0.5, 1e-6));
  const cos = new FormantSynth({ sampleRate: sr, schedule: ev(1) });
  assert.equal(cos.shaped, true);
  assert.ok(near(at(cos, 25).F2, 1500 + 500 * (0.5 - 0.5 * Math.cos(Math.PI * 0.25)), 1e-6));
  const out = new FormantSynth({ sampleRate: sr, schedule: ev(2) });
  assert.ok(near(at(out, 50).F2, 1500 + 500 * 0.75, 1e-6));
  assert.ok(near(at(out, 60).F2, 2000) && near(out.current.A1, 1), 'reaches the target');
  // params: only the named parameters move; another event keeps running for the rest
  const two = new FormantSynth({
    sampleRate: sr, schedule: [{ atMs: 0, target: { F2: 2000, A1: 1 }, transitionMs: 100 },
      { atMs: 20, target: { F2: 1000 }, transitionMs: 10, params: ['F2'] }],
  });
  const c1 = at(two, 30);
  assert.ok(near(c1.F2, 1000) && near(c1.A1, 0.3, 1e-9), `${c1.F2} ${c1.A1}`);
  assert.ok(near(at(two, 70).A1, 1));
  // live setTarget in shaped mode: a linear move of every parameter
  out.setTarget({ F1: 700 }, 10);
  assert.ok(near(at(out, 5).F1, 500 + 200 * 0.5, 1e-6));
  // a coarticulated render: finite, not silent, same length
  const spec = { mode: 'speak', text: 'Keep the cat, he said.', bank: 'mitalk-bursts' };
  const c = compileString(speak({ ...spec, coarticulation: true })), d = compileString(speak(spec));
  assert.equal(c.totalMs, d.totalMs);
  const y = renderToBuffer({ sampleRate: 16000, schedule: c.schedule, totalMs: c.totalMs });
  assert.ok(y.every(Number.isFinite) && Math.max(...y.map(Math.abs)) > 0.05);
});

test('very short slots: the schedule stays in time order, formant events never go back', () => {
  for (const s of ['r100 D r5 AA r100 D', 'r100 D r2 AA r2 D r3 IY r100 G', 'r8 B r8 AY r8 L r8 IY', 'r1 D r1 AA r1 D r1 IY r1 K']) {
    const c = co(s, '[CO=2] [TC=2]');
    assert.deepEqual(c.warnings, []);
    for (let i = 1; i < c.schedule.length; i++) assert.ok(c.schedule[i].atMs >= c.schedule[i - 1].atMs, `${s}: event ${i}`);
    const y = renderToBuffer({ sampleRate: 16000, schedule: c.schedule, totalMs: c.totalMs });
    assert.ok(y.every(Number.isFinite));
  }
  // a 5 ms vowel between two alveolars: its VC move starts after its CV jump, so it ends heading for the coda's locus
  const c = co('r100 D r5 AA r100 D', '[CO=2] [TC=2]'), aa = c.phrases.find((p) => p.phoneme === 'AA');
  const fe = formantEvents(c).filter((e) => e.atMs >= aa.tStartMs - 1e-9 && e.atMs < aa.tEndMs);
  const [k, b] = LOCI.alveolar.F2;
  assert.ok(near(fe.at(-1).target.F2, KLATT.AA.F2 + 2 * (k * KLATT.AA.F2 + b - KLATT.AA.F2)), `${fe.at(-1).target.F2}`);
  assert.ok(fe.every((e, i) => i === 0 || e.atMs >= fe[i - 1].atMs));
});
