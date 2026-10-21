// The opt-in "stops" option (src/stops.js) and its klattsch patch (a stop entry's closure / release: false).
// Off by default: the reference fixture stays byte-identical (extensions.test.js), and here stops: false/null too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf, words } from '../src/compile.js';
import { bankName, banksFor, canonical } from '../src/banks.js';
import { stopOptions, stopsBank, planStops, STOP_DEFAULTS, VOT_KLATT1975, BURST_FIT, MIN_CLOSURE_MS, afterSilence, beforeSilence } from '../src/stops.js';
import { timelineOf } from '../src/timeline.js';
import { compileString, banks } from '../../vendor/klattsch/src/engine/index.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const tokens = (s) => s.split(/\s+/);
const phonemes = (s) => tokens(s).filter((t) => /^[A-Z]+(\(|[+-]|$)/.test(t)).map((t) => t.match(/^[A-Z]+/)[0]);
// the klattsch code each lexical phoneme of `word` (index in the text) gets
function codesOf(spec, wi) {
  const meta = [], s = toKlattsch(spec, meta), ph = phonemes(s);
  return ph.filter((_, i) => meta[i].word === wi && !meta[i].asp);
}

test('stops: off (false, null, absent) changes nothing', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, stops: false }), out, JSON.stringify(spec));
    assert.equal(toKlattsch({ ...spec, stops: null }), out, JSON.stringify(spec));
  }
});

test('stops: a generated bank that extends the spec\'s, every string compiles, timelines and durations keep their phonemes', () => {
  for (const { spec } of REF) {
    const o = { ...spec, stops: true };
    const s = toKlattsch(o);
    const base = typeof spec.bank === 'string' ? spec.bank : 'klatt1980-en';
    assert.match(s, new RegExp(`^\\[bank=${base.replace(/[.-]/g, '\\$&')}(--[0-9a-z]+)*--st[0-9a-f]{12}\\] `), s.slice(0, 80));
    const c = compileString(s);
    assert.deepEqual(c.warnings, [], `${JSON.stringify(spec)}: ${c.warnings}`);
    // the timeline names every token by its lexical phoneme, as without stops
    assert.deepEqual(timelineOf(o).phones.map((p) => [p.p, p.word, p.syl, !!p.asp]), timelineOf(spec).phones.map((p) => [p.p, p.word, p.syl, !!p.asp]));
    // default stops (no vot, flapMs 0) keep every duration
    assert.deepEqual(durationsOf(o), durationsOf(spec));
  }
  assert.equal(bankName({ bank: 'mitalk-bursts', stops: true }), bankName({ bank: 'mitalk-bursts', stops: { ...STOP_DEFAULTS } }), 'true = the defaults');
  assert.notEqual(bankName({ bank: 'mitalk-bursts', stops: true }), bankName({ bank: 'mitalk-bursts', stops: { burst: 0.5 } }));
  const list = banksFor({ bank: 'mitalk-bursts', bankPatch: { AA: { F1: 710 } }, stops: true });
  assert.equal(list.length, 2);
  assert.equal(list[1].extends, list[0].name, 'the stops bank extends the patched one');
});

test('stops: context -> entries (voice bar, release into the vowel, unreleased, flap, aspiration)', () => {
  const o = { bank: 'mitalk-bursts', stops: true };
  // "a good": G after a vowel -> voice bar, released into UH; "Good." after nothing -> no voice bar
  assert.deepEqual(codesOf({ ...o, text: 'A good one.' }, 1), ['GQVUH', 'UH', 'DQVU']);
  assert.deepEqual(codesOf({ ...o, text: 'Good.' }, 0), ['GQUH', 'UH', 'DQVX'], 'final D after the vowel keeps its voice bar, released');
  // unreleased before a consonant, released before a vowel and before a pause
  assert.deepEqual(codesOf({ ...o, text: 'that time' }, 0), ['DH', 'AE', 'TQU']);
  assert.deepEqual(codesOf({ ...o, text: 'that is', stops: { flap: true } }, 0), ['DH', 'AE', 'TQIH']);
  assert.deepEqual(codesOf({ ...o, text: 'that, time' }, 0), ['DH', 'AE', 'T'], 'released, no vowel context: the plain entry');
  // per stop: only T and D unreleased
  assert.deepEqual(codesOf({ ...o, text: 'black cat sat', stops: { unreleased: { T: 'consonant', D: 'consonant' } } }, 0), ['BQAE', 'L', 'AE', 'K'],
    'K before a consonant released (the plain entry: no vowel)');
  assert.deepEqual(codesOf({ ...o, text: 'black cat sat', stops: { unreleased: { T: 'consonant' } } }, 1), ['KQAE', 'AE', 'TQU']);
  // glottalStop: an unreleased T after a sonorant closes abruptly
  assert.deepEqual(codesOf({ ...o, text: 'that man', stops: { glottalStop: true } }, 0), ['DH', 'AE', 'TQGU']);
  assert.deepEqual(codesOf({ ...o, text: 'its', stops: { glottalStop: true } }, 0), ['IH', 'TQGU', 'S'], 'after a vowel');
  assert.deepEqual(codesOf({ ...o, text: 'acts', stops: { glottalStop: true } }, 0).slice(2), ['TQU', 'S'], 'not after K');
  assert.deepEqual(codesOf({ ...o, text: 'cats' }, 0), ['KQAE', 'AE', 'TQU', 'S']);
  assert.deepEqual(codesOf({ ...o, text: 'cats', stops: { unreleased: 'closure' } }, 0), ['KQAE', 'AE', 'T', 'S']);
  assert.deepEqual(codesOf({ ...o, text: 'napkin', stops: { unreleased: 'closure' } }, 0).slice(0, 3), ['N', 'AE', 'PQU']);
  // a stop released into its own onset's liquid takes the nucleus: "play", "street"
  assert.deepEqual(codesOf({ ...o, text: 'play' }, 0), ['PQEY', 'L', 'EY']);
  assert.deepEqual(codesOf({ ...o, text: 'street' }, 0).slice(0, 2), ['S', 'TQIY']);
  // flap: word-internal T/D before an unstressed vowel after a vowel or R; not before a stressed one
  assert.equal(codesOf({ ...o, text: 'water' }, 0)[2], 'DQF');
  assert.equal(codesOf({ ...o, text: 'party' }, 0)[3], 'DQF');
  assert.notEqual(codesOf({ ...o, text: 'attack' }, 0)[1], 'DQF');
  assert.equal(codesOf({ ...o, text: 'water', stops: { flap: false } }, 0)[2], 'TQER');
  // across words ("words", the default): a word-final T/D after a vowel or R before a vowel-initial word, no pause
  assert.deepEqual(codesOf({ ...o, text: 'get it' }, 0), ['GQEH', 'EH', 'DQF']);
  assert.deepEqual(codesOf({ ...o, text: 'part of it' }, 0), ['PQAA', 'AA', 'R', 'DQF']);
  assert.deepEqual(codesOf({ ...o, text: 'get, it' }, 0), ['GQEH', 'EH', 'T'], 'not across a pause');
  assert.deepEqual(codesOf({ ...o, text: 'get it', stops: { flap: true } }, 0), ['GQEH', 'EH', 'TQIH'], 'true: inside words only');
  assert.deepEqual(codesOf({ ...o, text: 'kept it' }, 0).slice(-1), ['TQIH'], 'not after a consonant');
  // aspiration through the vowel's formants: HQ<vowel>, named HH in the timeline
  const s = speak({ ...o, text: 'Cat.' });
  assert.match(s, / r[\d.]+ HQAE /);
  assert.deepEqual(timelineOf({ ...o, text: 'Cat.' }).phones.map((p) => p.p), ['K', 'HH', 'AE', 'T']);
  assert.doesNotMatch(speak({ ...o, text: 'Cat.', stops: { aspiration: 0 } }), /HQ/);
  // everything off: the plain phonemes (only the bank name differs)
  const off = { voiceBar: false, burst: 0, aspiration: 0, flap: false, unreleased: false }, T = 'A good cat at the party.';
  const unbanked = (x) => x.replace(/^\[bank=\S+\]/, '');
  assert.equal(unbanked(speak({ ...o, text: T, stops: off })), unbanked(speak({ bank: 'mitalk-bursts', text: T })));
});

test('stops: the generated entries follow Stevens & Blumstein, Klatt', () => {
  // the rules alone (burstFit false)
  const R = stopsBank('mitalk-bursts', stopOptions({ burstFit: false }), canonical).phonemes;
  // velar: one compact peak that follows the vowel (higher before front vowels)
  assert.ok(R.KQIY.F2 > R.KQAA.F2 + 500, `${R.KQIY.F2} ${R.KQAA.F2}`);
  assert.ok(R.KQIY.A2 > R.KQIY.A3 && R.KQIY.BW2 <= 200);
  // alveolar: rising (A3 > A2), the high peak lower before rounded vowels
  assert.ok(R.TQIY.A3 > R.TQIY.A2 && R.TQUW.F3 < R.TQIY.F3);
  // labial: falling (A2 > A3), F2 below the vowel's
  const V = banks.get('mitalk-bursts').phonemes;
  assert.ok(R.PQIY.A2 > R.PQIY.A3 && R.PQIY.F2 < V.IY.F2 && R.PQAA.F2 < R.PQIY.F2);
  // the default: T D K with the Kokoro-fitted bandwidths and amplitudes (BURST_FIT) over the rules' frequencies
  const o = stopOptions(true);
  const b = stopsBank('mitalk-bursts', o, canonical), P = b.phonemes;
  assert.match(b.name, /^mitalk-bursts--st[0-9a-f]{12}$/);
  assert.equal(P.KQIY.F2, R.KQIY.F2); assert.equal(P.KQIY.A3, 0, 'compact'); assert.equal(P.KQIY.A2, BURST_FIT.K.front.A2);
  assert.equal(P.KQAA.A2, BURST_FIT.K.back.A2);
  assert.equal(P.TQUW.BW3, BURST_FIT.T.BW3); assert.equal(P.TQUW.F3, R.TQUW.F3);
  assert.deepEqual(P.PQIY, R.PQIY, 'P B G keep the rules');
  assert.deepEqual(stopsBank('mitalk-bursts', stopOptions({ burstFit: ['P'] }), canonical).phonemes.PQIY.A3, BURST_FIT.P.front.A3);
  assert.throws(() => stopOptions({ burstFit: ['X'] }), /stops.burstFit/);
  // blend 0: the bank's own burst
  const b0 = stopsBank('mitalk-bursts', stopOptions({ burst: 0 }), canonical).phonemes;
  assert.equal(b0.KQIY, undefined);
  assert.deepEqual(b0.KQX, V.K);
  // voice bar: B D G only, voiced low F1 closure, no F2/F3
  assert.deepEqual(P.DQVAA.closure, { voicing: 1, F1: 180, BW1: 60, A1: 0.07, A2: 0, A3: 0, inMs: 20, fade: 0.35 });
  assert.equal(P.TQVAA, undefined);
  assert.equal(P.DQU.release, false);
  // aspiration: the vowel's formants, F1 cut back and widened, voiceless
  assert.equal(P.HQAE.F2, V.AE.F2); assert.equal(P.HQAE.F3, V.AE.F3);
  assert.ok(P.HQAE.A1 < V.HH.A1 && P.HQAE.BW1 > V.AE.BW1 && P.HQAE.voicing === 0);
  assert.equal(P.HQAY.glideTo, undefined); assert.equal(P.HQAY.F2, V.AY.F2, 'the onset of a diphthong');
  // DQF: a voiced non-stop
  assert.equal(P.DQF.voicing, 1); assert.equal(P.DQF.isStop, undefined);
  // options are checked
  assert.throws(() => stopOptions({ burst: 2 }), /stops.burst/);
  assert.throws(() => stopOptions({ unreleased: 'some' }), /stops.unreleased/);
  assert.throws(() => stopOptions({ burstGain: -1 }), /stops.burstGain/);
  assert.equal(stopOptions({ unreleased: true }).unreleased.K, 'consonant');
  assert.deepEqual(stopOptions({ unreleased: { T: 'closure' } }).unreleased, { P: false, B: false, T: 'closure', D: false, K: false, G: false });
  assert.throws(() => stopOptions({ unreleased: { T: 'x' } }), /stops.unreleased.T/);
  assert.throws(() => stopOptions({ flap: 'yes' }), /stops.flap/);
  assert.throws(() => stopOptions({ closureMs: -1 }), /stops.closureMs/);
  assert.throws(() => stopOptions({ vot: { B: 10 } }), /stops.vot/);
  assert.deepEqual(stopOptions({ burst: { K: 1 } }).burst, { P: 0, B: 0, T: 0, D: 0, K: 1, G: 0 });
});

test('stops: vot and flapMs change the durations, consistently in durationsOf and the string', () => {
  const text = 'Pick a tall cup.';
  const plain = durationsOf({ text }), vot = durationsOf({ text, stops: { vot: true } });
  const asp = (d) => d.phones.filter((p) => p.asp).map((p) => p.asp);
  const mean = (47 + 65 + 70) / 3;
  assert.deepEqual(asp(plain), [25, 25, 25]);
  assert.ok(Math.abs(asp(vot)[0] - 25 * VOT_KLATT1975.P / mean) < 1e-9);
  assert.ok(Math.abs(asp(vot)[1] - 25 * VOT_KLATT1975.T / mean) < 1e-9);
  assert.ok(Math.abs(asp(vot)[2] - 25 * VOT_KLATT1975.K / mean) < 1e-9);
  assert.deepEqual(asp(durationsOf({ text, stops: { vot: { P: 47, T: 65, K: 70 } } })), [47, 65, 70]);
  const s = speak({ text, stops: { vot: { P: 47, T: 65, K: 70 } } });
  assert.match(s, /r47 HQIH .* r65 HQAO .* r70 HQAH/);
  // flapMs: the flap at most that long
  const w = (o) => durationsOf({ text: 'water', ...o }).phones[2].ms;
  assert.equal(w({ stops: true }), w({}));
  assert.equal(w({ stops: { flapMs: 20 } }), Math.min(20, w({})));
  assert.match(speak({ text: 'water', stops: { flapMs: 20 } }), /r20 DQF/);
  // a flap across words takes flapMs too (a coda)
  const g = (o) => durationsOf({ text: 'get it', ...o }).phones[2].ms;
  assert.equal(g({ stops: { flapMs: 15 } }), Math.min(15, g({})));
  // votTotal: the closure gives what the aspiration gains, the stop + aspiration keeps its length
  const k = (o) => durationsOf({ text, ...o }).phones.filter((p) => p.p === 'K' || p.p === 'T' || p.p === 'P');
  const tot = (o) => { const d = durationsOf({ text, ...o }); return d.phones.map((p) => p.ms + (p.asp ?? 0)); };
  const vt = { stops: { vot: { P: 47, T: 65, K: 70 }, votTotal: true } };
  assert.deepEqual(asp(durationsOf({ text, ...vt })), [47, 65, 70]);
  assert.ok(Math.abs(durationsOf({ text, ...vt }).totalMs - plain.totalMs) < 1e-9 || k(vt).some((p) => p.ms === MIN_CLOSURE_MS), 'total kept unless a closure hit its minimum');
  assert.ok(k(vt)[0].ms < k({})[0].ms);
  assert.equal(tot(vt).length, tot({}).length);
});

test('stops: closureMs, glottalStop, burstLocus and flapLocus entries', () => {
  const P = stopsBank('mitalk-bursts', stopOptions({ closureMs: 8, glottalStop: true }), canonical).phonemes;
  assert.deepEqual(P.TQX.closure, { A1: 0, A2: 0, A3: 0, inMs: 8 }, 'closureMs: every silent closure');
  assert.deepEqual(P.TQGU.closure, { A1: 0, A2: 0, A3: 0, inMs: 5 }); assert.equal(P.TQGU.release, false);
  assert.equal(P.KQGU, undefined, 'T only');
  assert.equal(P.DQVAA.closure.F1, 180, 'a voice bar is not a silent closure');
  // closureMs: every stop takes a generated entry
  assert.deepEqual(codesOf({ bank: 'mitalk-bursts', text: 'that, time', stops: { closureMs: 8 } }, 0), ['DH', 'AE', 'TQX']);
  // under coarticulation: locusBurst (the velar's burst at the vowel's CV boundary) only with burstLocus
  const co = { bank: 'mitalk-bursts', coarticulation: true };
  const last = (o) => { const l = banksFor(o); return banks.get(l[l.length - 1].name).phonemes; };
  assert.equal(last({ ...co, stops: true }).KQIY.locusBurst, undefined);
  assert.equal(last({ ...co, stops: { burstLocus: true } }).KQIY.locusBurst, true);
  assert.equal(last({ ...co, stops: true }).DQF.locus, undefined);
  assert.deepEqual(last({ ...co, stops: { flapLocus: true } }).DQF.locus, last(co).D.locus);
  // the generated stop entries keep the coarticulation fields (a vowel next to them takes their locus)
  assert.deepEqual(last({ ...co, stops: true }).TQIY.locus, last(co).T.locus);
  assert.equal(last({ ...co, stops: true }).HQAA.transparent, true);
});

test('stops: sing keeps the context across notes, and a rest breaks it', () => {
  const o = { mode: 'sing', text: 'a dog a dog', bpm: 120, stops: true };
  const legato = sing({ ...o, notes: [['E2', 2], ['G2', 4], ['E2', 2], ['G2', 4]] });
  const rest = sing({ ...o, notes: [['E2', 2], ['G2', 4], ['r', 2], ['E2', 2], ['G2', 4]] });
  assert.match(legato, /DQVAO .* GQVAH .* DQVAO .* GQVX/);
  assert.match(rest, /DQVAO .* GQVX p[\d.]+ .* DQVAO .* GQVX/, 'G before the rest: released without a vowel context');
  const gated = sing({ mode: 'sing', text: 'go dog', bpm: 120, stops: true, gate: 120, notes: [['E2', 8], ['G2', 4]] });
  assert.match(gated, /p[\d.]+ (v0 \S+ )?r[\d.]+ DQAO/, 'after a gated note: no voice bar');
  assert.deepEqual(compileString(gated).warnings, []);
  assert.equal(afterSilence('BQVIY'), 'BQIY'); assert.equal(afterSilence('TQTAA'), 'TQAA'); assert.equal(afterSilence('DQF'), 'DQF');
  assert.equal(beforeSilence('GQVAH'), 'GQVX'); assert.equal(beforeSilence('TQU'), 'TQX');
  assert.equal(beforeSilence('DQF', 'T'), 'T', 'a flap before a rest: its own stop'); assert.equal(afterSilence('DQF', 'D'), 'D');
  assert.equal(afterSilence('TQGU'), 'TQU');
  const flap = sing({ mode: 'sing', text: 'get it', bpm: 120, stops: true, notes: [['E2', 4], ['r', 2], ['G2', 4]] });
  assert.match(flap, / T p[\d.]+ /); assert.doesNotMatch(flap, /DQF/);
  assert.match(sing({ mode: 'sing', text: 'get it', bpm: 120, stops: true, notes: [['E2', 4], ['G2', 4]] }), /DQF/);
});

test('klattsch patch: closure (voice bar) and release: false', () => {
  const D = { ...banks.get('klatt1980-en').phonemes.D };
  const mk = (name, entry) => registerBank({ schemaVersion: 1, name, extends: 'klatt1980-en', phonemes: { D: entry } });
  mk('test-stop-plain', D);
  mk('test-stop-bar', { ...D, closure: { voicing: 1, F1: 180, BW1: 60, A1: 0.1, A2: 0, A3: 0, inMs: 20, fade: 0.5 } });
  mk('test-stop-unrel', { ...D, release: false });
  {
    const s = (b) => compileString(`[bank=${b}] r200 AA r100 D r200 AA`).schedule;
    const plain = s('test-stop-plain'), bar = s('test-stop-bar'), unrel = s('test-stop-unrel');
    const orig = compileString('r200 AA r100 D r200 AA').schedule;
    assert.deepEqual(plain, orig, 'an entry without the fields renders as before');
    // plain: silence at 200, burst at 200 + 100 - burst; bar: the closure target, its fade, the burst
    const at = (sch) => sch.map((e) => Math.round(e.atMs * 10) / 10);
    assert.deepEqual(at(plain), [0, 200, 275, 300, 500]);
    assert.deepEqual(at(bar), [0, 200, 220, 275, 300, 500]);
    const clo = bar[1].target;
    assert.equal(clo.voicing, 1); assert.equal(clo.F1, 180); assert.equal(clo.A1, 0.1); assert.equal(clo.A2, 0);
    assert.equal(bar[1].transitionMs, 20);
    assert.equal(bar[2].target.A1, 0.05); assert.equal(bar[2].transitionMs, 55);
    assert.equal(bar[3].target.voicing, D.voicing, 'then the burst');
    // unreleased: the closure (here silence) fills the slot, no burst
    assert.deepEqual(at(unrel), [0, 200, 300, 500]);
    assert.equal(unrel[1].target.A1, 0);
    // the closure sets only its own fields: the vowel's F2/F3 carry on through it (as through silence)
    assert.equal(clo.F2, undefined); assert.equal(clo.F3, undefined); assert.equal(clo.BW1, 60);
  }
  {
    // under [CO]: the closure's F1 in a formant event, F2/F3 where the vowel's VC transition went (D's locus)
    const AA = { ...banks.get('klatt1980-en').phonemes.AA, vowel: true };
    const locus = { F1: [0.54, 176], F2: [0.531, 763], F3: [0.141, 2136] };
    registerBank({ schemaVersion: 1, name: 'test-stop-bar-co', extends: 'klatt1980-en', phonemes: { AA, D: { ...D, locus, closure: { voicing: 1, F1: 180, A1: 0.1, A2: 0, A3: 0 } } } });
    registerBank({ schemaVersion: 1, name: 'test-stop-plain-co', extends: 'klatt1980-en', phonemes: { AA, D: { ...D, locus } } });
    const co = (b) => compileString(`[bank=${b}] [CO=1] r200 AA r100 D r200 AA`).schedule;
    const F = co('test-stop-bar-co').filter((e) => e.params && e.params.length === 3 && 'F1' in e.target);
    const clo = F.find((e) => e.atMs === 200);
    assert.ok(clo, 'a formant event at the closure');
    assert.equal(clo.target.F1, 180);
    const vc = F.filter((e) => e.atMs < 200).pop();
    assert.ok(Math.abs(vc.target.F2 - (0.531 * AA.F2 + 763)) < 1e-9, 'the VC boundary');
    assert.equal(clo.target.F2, vc.target.F2); assert.equal(clo.target.F3, vc.target.F3);
    const plainCo = co('test-stop-plain-co');
    assert.ok(!plainCo.some((e) => e.atMs === 200 && e.params?.length === 3), 'no closure formant event without a closure');
    // no locus (or no vowel before): the stop's own F2/F3
    const own = co('test-stop-bar').filter((e) => e.params && e.params.length === 3 && e.atMs === 200)[0];
    assert.equal(own.target.F1, 180); assert.equal(own.target.F2, D.F2);
  }
});
