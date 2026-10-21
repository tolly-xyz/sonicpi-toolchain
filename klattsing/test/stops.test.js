// The opt-in "stops" option (src/stops.js) and its klattsch patch (a stop entry's closure / release: false).
// Off by default: the reference fixture stays byte-identical (extensions.test.js), and here stops: false/null too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf, words } from '../src/compile.js';
import { bankName, banksFor, canonical } from '../src/banks.js';
import { stopOptions, stopsBank, planStops, STOP_DEFAULTS, VOT_KLATT1975, afterSilence, beforeSilence } from '../src/stops.js';
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
  assert.deepEqual(codesOf({ ...o, text: 'that is' }, 0), ['DH', 'AE', 'TQIH']);
  assert.deepEqual(codesOf({ ...o, text: 'that, time' }, 0), ['DH', 'AE', 'T'], 'released, no vowel context: the plain entry');
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
  const o = stopOptions(true);
  const b = stopsBank('mitalk-bursts', o, canonical), P = b.phonemes, V = banks.get('mitalk-bursts').phonemes;
  assert.match(b.name, /^mitalk-bursts--st[0-9a-f]{12}$/);
  // velar: one compact peak that follows the vowel (higher before front vowels)
  assert.ok(P.KQIY.F2 > P.KQAA.F2 + 500, `${P.KQIY.F2} ${P.KQAA.F2}`);
  assert.ok(P.KQIY.A2 > P.KQIY.A3 && P.KQIY.BW2 <= 200);
  // alveolar: rising (A3 > A2), the high peak lower before rounded vowels
  assert.ok(P.TQIY.A3 > P.TQIY.A2 && P.TQUW.F3 < P.TQIY.F3);
  // labial: falling (A2 > A3), F2 below the vowel's
  assert.ok(P.PQIY.A2 > P.PQIY.A3 && P.PQIY.F2 < V.IY.F2 && P.PQAA.F2 < P.PQIY.F2);
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
  assert.equal(stopOptions({ unreleased: true }).unreleased, 'consonant');
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
  }
});
