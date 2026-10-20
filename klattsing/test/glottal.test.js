// glottal: the opt-in LF voice source (klattsch [GS=1] and its directives, a patch to the vendored engine) and the
// klattsing option that writes them. Without GS the engine renders exactly what it rendered before the patch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { speak, sing, toKlattsch, glottalDirs, GLOTTAL, durationsOf } from '../src/compile.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, renderToBuffer, FormantSynth } from '../../vendor/klattsch/src/engine/index.js';
import { lfShape, lfPulse, glottalPulse, tiltCoef } from '../../vendor/klattsch/src/engine/dsp.js';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const render = (s, sr = 16000) => { const c = compileString(s); return renderToBuffer({ sampleRate: sr, schedule: c.schedule, totalMs: c.totalMs }); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// sha1 of the 16 kHz Float32 renders of every fixture string (all voices; banks/*.json registered, as importing
// timeline.js does), captured with the engine before the patch (HEAD e0351f1)
const AUDIO_BEFORE = 'b169fd9582a85fb4ee7834428f4ba4a19b51e49a';
test('engine: without GS every fixture string renders the same samples as before the patch', () => {
  const h = createHash('sha1');
  for (const { out } of REF) {
    const c = compileString(out);
    for (const v of c.voices) {
      if (!v.schedule.length) continue;
      h.update(Buffer.from(renderToBuffer({ sampleRate: 16000, schedule: v.schedule, totalMs: v.totalMs }).buffer));
    }
  }
  assert.equal(h.digest('hex'), AUDIO_BEFORE);
});

test('engine: [GS=0], and [GS=1] reset by a bare [GS], fall back to the Rosenberg pulse', () => {
  const s = 'b110 r120 L OW ER DH AH B AH K AH T';
  const plain = render(s);
  assert.ok(same(render(`[GS=0] [RD=0.5] [JIT=3] ${s}`), plain), '[GS=0] is inert');
  const lf = render(`[GS=1] ${s}`);
  assert.ok(!same(lf, plain), 'GS=1 changes the sound');
  // LF for the first phoneme only, then back: identical to plain from shortly after the switch
  const mixed = render(`[GS=1] b110 r120 L [GS] OW ER DH AH B AH K AH T`);
  assert.equal(mixed.length, plain.length);
  assert.ok(!same(mixed.subarray(0, 1000), plain.subarray(0, 1000)));
});

test('dsp: LF shapes (Fant, Liljencrants & Lin 1985; Rd after Fant 1995)', () => {
  for (const rd of [0.3, 0.5, 0.7, 1, 1.5, 2, 2.7]) {
    const s = lfShape(rd), N = 20000;
    let flow = 0, peak = 0, minE = 0;
    for (let i = 0; i < N; i++) { const e = lfPulse((i + 0.5) / N, s); flow += e / N; peak = Math.max(peak, flow); minE = Math.min(minE, e); }
    assert.ok(Math.abs(flow) < 1e-6, `Rd ${rd}: no net flow (${flow})`);
    assert.ok(Math.abs(peak - 0.1) < 1e-3, `Rd ${rd}: peak flow 0.1 like glottalPulse (${peak})`);
    // the negative peak is Ee at te (for lax shapes, Rk > 0.5, the open-phase sine bottoms out just before te)
    assert.ok(-minE >= s.Ee * (1 - 1e-3) && -minE < s.Ee * (rd > 2 ? 1.05 : 1.001), `Rd ${rd}: negative peak ${-minE} vs Ee ${s.Ee}`);
    assert.ok(Math.abs(lfPulse(s.te, s) + s.Ee) < 1e-9 * s.Ee && Math.abs(lfPulse(s.te - 1e-12, s) + s.Ee) < 1e-6 * s.Ee, 'continuous at te');
    // Rd = U0 / (Ee T0) / 0.11 (Fant 1995; his Ra/Rk/Rg regressions hold it within ~15%)
    const rdBack = (0.1 / s.Ee) / 0.11;
    assert.ok(Math.abs(rdBack / rd - 1) < 0.15, `Rd ${rd}: U0/Ee gives Rd ${rdBack}`);
    assert.ok(s.tp < s.te && s.te < 1 && s.ta > 0, `Rd ${rd}: timing`);
    assert.ok(Math.abs(lfPulse(0, s)) < 1e-12 && Math.abs(lfPulse(1 - 1e-9, s)) < 1e-6 * s.Ee, 'starts and ends at 0');
  }
  const m = lfShape(1);
  assert.ok(Math.abs(m.tp - 0.484) < 0.002 && Math.abs(m.te - 0.65) < 0.002 && Math.abs(m.ta - 0.038) < 1e-6, JSON.stringify(m));
  assert.equal(lfShape(0.1).Rd, 0.3); assert.equal(lfShape(9).Rd, 2.7);
});

// harmonic slope of one period of a pulse between 1 and 4 kHz at F0 = 100 Hz, dB per octave
function slope(f) {
  const N = 4096, xs = [], ys = [];
  for (let k = 10; k <= 40; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const t = (i + 0.5) / N, v = f(t); re += v * Math.cos(2 * Math.PI * k * t); im -= v * Math.sin(2 * Math.PI * k * t); }
    xs.push(Math.log2(k)); ys.push(10 * Math.log10(re * re + im * im));
  }
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  return sxy / sxx;
}
test('dsp: the LF pulse falls ~12 dB/oct above 1 kHz (the Rosenberg pulse ~6); tiltCoef gives TL dB at 3 kHz', () => {
  assert.ok(Math.abs(slope((t) => glottalPulse(t, 0.5)) + 6) < 1.5);
  for (const rd of [0.7, 1, 2]) { const s = lfShape(rd), d = slope((t) => lfPulse(t, s)); assert.ok(d < -10.5 && d > -13.5, `Rd ${rd}: ${d}`); }
  for (const [db, sr] of [[3, 48000], [10, 48000], [20, 16000]]) {
    const a = tiltCoef(db, 3000, sr), w = 2 * Math.PI * 3000 / sr;
    const g = (1 - a) ** 2 / (1 - 2 * a * Math.cos(w) + a * a);
    assert.ok(Math.abs(-10 * Math.log10(g) - db) < 1e-9 && a > 0 && a < 1, `${db} dB at ${sr}`);
  }
  assert.equal(tiltCoef(0, 3000, 48000), 0); assert.equal(tiltCoef(-3, 3000, 48000), 0);
});

// a synth on a steady voiced target with the source directives; newCycle is wrapped to log each period
function cycles(extra, ms = 3000, F0 = 100) {
  const target = { F0, voicing: 1, F1: 500, A1: 1, F2: 1500, A2: 0.5, F3: 2500, A3: 0.3, GS: 1, ...extra };
  const syn = new FormantSynth({ sampleRate: 16000, schedule: [{ atMs: 0, target, transitionMs: 1 }] });
  const log = [], orig = syn.newCycle.bind(syn);
  syn.newCycle = (cur) => { orig(cur); log.push({ T: 1 / (F0 * syn.cycleRate), A: syn.cycleAmp, rd: syn.lf.Rd }); };
  syn.process(new Float32Array(16 * ms));
  return log.slice(1);
}
const local = (xs) => xs.slice(1).reduce((a, x, i) => a + Math.abs(x - xs[i]), 0) / (xs.length - 1) / (xs.reduce((a, b) => a + b) / xs.length);
test('engine: JIT and SHIM are local (cycle-to-cycle) jitter and shimmer in %', () => {
  const c = cycles({ JIT: 1, SHIM: 4 });
  assert.ok(c.length > 250);
  const j = 100 * local(c.map((x) => x.T)), s = 100 * local(c.map((x) => x.A));
  assert.ok(j > 0.85 && j < 1.15, `jitter ${j}%`);
  assert.ok(s > 3.4 && s < 4.6, `shimmer ${s}%`);
  const z = cycles({});
  assert.ok(z.every((x) => x.A === 1 && Math.abs(x.T - 0.01) < 1e-12), 'none by default');
  // the same input gives the same perturbations (deterministic renders)
  assert.deepEqual(cycles({ JIT: 1, SHIM: 4 }, 500), cycles({ JIT: 1, SHIM: 4 }, 500));
});

test('engine: effort moves Rd by RDE octaves per unit (RD at effort 0.5)', () => {
  const rd = (extra) => cycles(extra, 200)[3].rd;
  assert.equal(rd({ effort: 0.5 }), 1);
  assert.ok(Math.abs(rd({ effort: 0.6 }) - 2 ** -0.6) < 1e-3);
  assert.ok(Math.abs(rd({ effort: 0.6, RDE: 2, RD: 1.5 }) - 1.5 * 2 ** -0.2) < 1e-3);
  assert.equal(rd({ effort: 0.9, RDE: 0, RD: 0.8 }), 0.8);
  assert.equal(rd({ effort: 1 }), 0.3, 'clamped to the LF range');
});

test('engine: AM gates the noise by the glottal flow while voiced, at the same mean power', () => {
  // constant "noise" 1 and voicedGain 0: lfSample returns the noise terms only (aspiration 0.5 h, frication 0.35 (1 - v))
  const syn = new FormantSynth({ sampleRate: 48000 });
  syn.setSource({ GS: 1, AM: 1 });
  const n = 48000 / 100;
  const run = (cur, v) => { const xs = []; for (let i = 0; i < 4 * n; i++) xs.push(syn.lfSample(cur, 100, v, 0, 1)); return xs.slice(3 * n); };
  const meanSq = (xs) => xs.reduce((a, x) => a + x * x, 0) / xs.length;
  // v = 1 (a vowel): the aspiration follows the flow, none in the closed phase
  const asp = run({ effort: 0.5, aspiration: 1 }, 1), L = syn.lf;
  assert.ok(Math.abs(meanSq(asp) - 0.25) < 0.01, `mean square ${meanSq(asp)} (0.5^2 unmodulated)`);
  const closed = asp.slice(Math.ceil((L.te + 5 * L.ta) * n));
  assert.ok(closed.every((x) => Math.abs(x) < 0.02), 'no noise in the closed phase');
  assert.ok(Math.max(...asp) > 0.8, 'more than the steady 0.5 in the open phase');
  // v = 0.5 (a voiced fricative): frication and aspiration modulated at depth AM v = 0.5, same mean power
  const fr = run({ effort: 0.5, aspiration: 0 }, 0.5);
  assert.ok(Math.abs(meanSq(fr) / 0.175 ** 2 - 1) < 0.03, `mean square ${meanSq(fr)} (0.175^2)`);
  const lo = Math.min(...fr), hi = Math.max(...fr);
  assert.ok(Math.abs(hi / lo - 2) < 0.01 && lo < 0.175 && hi > 0.175, `depth 0.5: ${lo}..${hi} (closed (1 - a) : peak 1)`);
  // v = 0 (HH, S, a burst): the folds do not vibrate, the noise is steady
  assert.ok(run({ effort: 0.5, aspiration: 1 }, 0).every((x) => x === 0.35 + 0.5), 'voiceless: steady');
  syn.setSource({ GS: 1, AM: 0 });
  assert.ok(run({ effort: 0.5, aspiration: 1 }, 1).every((x) => x === 0.5), 'AM 0: steady');
});

test('glottal option: directives, defaults, validation; durations and timing unchanged', () => {
  const d = glottalDirs(true);
  assert.equal(d, '[GS=1] [RD=1] [RDE=6] [TL=0] [JIT=0.7] [SHIM=4] [AM=1] [FL=0]');
  assert.deepEqual(GLOTTAL, { rd: 1, rdEffort: 6, tilt: 0, jitter: 0.7, shimmer: 4, aspMod: 1, flutter: 0 });
  assert.equal(glottalDirs({ rd: 1.2, tilt: 3, jitter: 0 }), '[GS=1] [RD=1.2] [RDE=6] [TL=3] [JIT=0] [SHIM=4] [AM=1] [FL=0]');
  assert.equal(glottalDirs({ rd: 1 / 3 }), '[GS=1] [RD=0.3333] [RDE=6] [TL=0] [JIT=0.7] [SHIM=4] [AM=1] [FL=0]');
  assert.equal(glottalDirs(false), ''); assert.equal(glottalDirs(undefined), '');
  assert.throws(() => glottalDirs({ rdd: 1 }), /glottal.rdd: unknown/);
  assert.throws(() => glottalDirs({ rd: '1' }), /glottal.rd: expected a number/);
  assert.throws(() => glottalDirs([1]), /expected true or an object/);
  const spec = { mode: 'speak', text: 'Lower the bucket, please.', bank: 'mitalk-bursts', transition: 60 };
  const plain = speak(spec), g = speak({ ...spec, glottal: true });
  assert.equal(g, plain.replace('[TR=60] ', `[TR=60] ${d} `), 'after the bank and TR, before the voice');
  assert.equal(speak({ ...spec, glottal: false }), plain);
  const c = compileString(g);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.schedule.every((e) => e.target.GS === 1 && e.target.RDE === 6 && e.target.SHIM === 4), 'rides in every target');
  assert.deepEqual(durationsOf({ ...spec, glottal: true }), durationsOf(spec));
  assert.deepEqual(timelineOf({ ...spec, glottal: true }).phones, timelineOf(spec).phones);
  const sg = { mode: 'sing', text: 'Lower the bucket', bpm: 120, notes: 'auto' };
  assert.ok(sing({ ...sg, glottal: { rd: 1.4 } }).startsWith('[GS=1] [RD=1.4] '));
  for (const { spec: s, out } of REF.slice(0, 20)) assert.equal(toKlattsch({ ...s, glottal: false }), out);
  // renders, differs from the Rosenberg voice, and keeps a similar level
  const a = render(plain, 16000), b = render(g, 16000);
  const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  assert.equal(a.length, b.length);
  assert.ok(!same(a, b) && Math.abs(20 * Math.log10(rms(b) / rms(a))) < 3, `${rms(a)} ${rms(b)}`);
});
