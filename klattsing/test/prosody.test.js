// The opt-in "prosody" option (src/prosody.js): pitch accents on content words, downstep, declination with
// resets, phrase-final lowering, continuation and question rises, segmental F0 perturbations. Speak only; off by
// default (the reference fixture stays byte-identical), and here prosody: false/null too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, sing, toKlattsch, durationsOf, words, hz } from '../src/compile.js';
import { prosodyOptions, accentPlan, contour, PROSODY, UNACCENTED } from '../src/prosody.js';
import { timelineOf } from '../src/timeline.js';
import { compileString } from '../../vendor/klattsch/src/engine/index.js';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
// the string's phoneme tokens with the F0 klattsch gives them: [{ code, ms, f0 (start, Hz), end (Hz) }]
function pitches(s) {
  let b = null, r = null;
  const out = [];
  for (const t of s.split(/\s+/)) {
    let m;
    if ((m = t.match(/^b(\d+(?:\.\d+)?)$/))) b = Number(m[1]);
    else if ((m = t.match(/^r(\d+(?:\.\d+)?)$/))) r = Number(m[1]);
    else if ((m = t.match(/^([A-Z]+)(?:\(([+-]\d+(?:\.\d+)?)\))?$/))) out.push({ code: m[1], ms: r, f0: b, end: Math.round((b + Number(m[2] ?? 0)) * 10) / 10 });
  }
  return out;
}
// the string without its pitch: b directives and transient deltas dropped
const unpitched = (s) => s.split(/\s+/).filter((t) => !/^b\d/.test(t)).map((t) => t.replace(/\([+-]\d+(\.\d+)?\)$/, '')).join(' ');
const wordsOf = (text) => words(text, undefined, undefined, { functionWords: true });
const plan = (text) => accentPlan(wordsOf(text));
// tokens as speak() makes them, on a fixed clock: consonants 60 ms, vowels 120 ms, 250 ms pauses after punctuation
function toksOf(text) {
  const ws = wordsOf(text), toks = [];
  let t = 0, gap = true;
  const add = (ms, p, kind, wi, si) => { toks.push({ start: t, ms, kind, p, code: p, asp: false, gap, word: wi, syl: si }); t += ms; gap = false; };
  ws.forEach((w, wi) => w.syllables.forEach((s, si) => {
    for (const p of s.onset) add(60, p, 'other', wi, si);
    if (s.nucleus) add(120, s.nucleus, 'vowel', wi, si);
    for (const p of s.coda) add(60, p, 'other', wi, si);
    if (si === w.syllables.length - 1 && w.punct) { t += 250; gap = true; }
  }));
  return { ws, toks, end: t };
}
// all off: a flat line at the spec's pitch
const FLAT = { accent: 0, top: 0, declination: 0, decay: 0, final: 0, continuation: 0, question: 0, micro: 0, dip: 0 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);

test('prosody: off (false, null, absent) changes nothing; sing ignores it', () => {
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, prosody: false }), out, JSON.stringify(spec));
    assert.equal(toKlattsch({ ...spec, prosody: null }), out, JSON.stringify(spec));
    if (spec.mode === 'sing') assert.equal(sing({ ...spec, prosody: true }), out, 'sing mode has its notes');
  }
});

test('prosody: options are validated', () => {
  assert.equal(prosodyOptions(undefined), null);
  assert.equal(prosodyOptions(false), null);
  assert.deepEqual(prosodyOptions(true), PROSODY);
  assert.deepEqual(prosodyOptions({ accent: 5, downstep: null }), { ...PROSODY, accent: 5 });
  assert.throws(() => prosodyOptions('yes'), /true or an object/);
  assert.throws(() => prosodyOptions({ acent: 1 }), /prosody\.acent: unknown/);
  assert.throws(() => prosodyOptions({ accent: '3' }), /expected a number/);
  assert.throws(() => prosodyOptions({ effort: 1 }), /true or false/);
  assert.throws(() => prosodyOptions({ rise: 0 }), /ms > 0/);
  assert.throws(() => speak({ text: 'Hello.', prosody: { nope: 1 } }), /unknown/);
});

test('prosody: accents on content words only, the nuclear accent on the last; phrases and their kinds', () => {
  const p = plan('The birch canoe slid on the smooth planks.');
  // the, on, the: function words; canoe: its stressed second syllable
  assert.deepEqual(p.accents.map((a) => [a.word, a.syl, a.k, a.nuclear]), [[1, 0, 0, false], [2, 1, 1, false], [3, 0, 2, false], [6, 0, 3, false], [7, 0, 4, true]]);
  assert.deepEqual(p.phrases, [{ from: 0, to: 7, kind: 'final', sentenceStart: true }]);
  assert.ok(['before', 'into', 'these', 'when', 'the', 'of'].every((w) => UNACCENTED.has(w)));
  const q = plan('It snowed, rained, and hailed. Is it raining? Where did you go?');
  assert.deepEqual(q.phrases.map((x) => [x.from, x.to, x.kind, x.sentenceStart]),
    [[0, 1, 'continuation', true], [2, 2, 'continuation', false], [3, 4, 'final', false], [5, 7, 'question', true], [8, 11, 'final', true]]);
  // a phrase of function words alone accents its last word
  assert.deepEqual(plan('Is it?').accents.map((a) => [a.word, a.nuclear]), [[1, true]]);
});

test('prosody: accent heights, downstep, nuclear, peak alignment', () => {
  const { ws, toks } = toksOf('Big dogs dig deep holes.');
  const P = prosodyOptions({ ...FLAT, accent: 3, downstep: 0.7, nuclear: 1.5, peak: 0.5, rise: 80, fall: 80 });
  const f = contour(accentPlan(ws), toks, P), vs = toks.filter((t) => t.kind === 'vowel');
  vs.forEach((v, k) => near(f(v.start + 0.5 * v.ms), 3 * 0.7 ** k * (k === vs.length - 1 ? 1.5 : 1), `accent ${k}`));
  // the peak is the maximum: lower 30 ms either side, back to the baseline before the rise starts
  const v = vs[1];
  assert.ok(f(v.start + 30) < f(v.start + 60) && f(v.start + 90) < f(v.start + 60));
  near(f(v.start + 60 - 80), 0);
  // a peak before the vowel (in the onset)
  const g = contour(accentPlan(ws), toks, { ...P, peak: -0.25 });
  near(g(vs[0].start - 30), 3);
});

test('prosody: baseline: declination, exponential decay, top', () => {
  const { ws, toks, end } = toksOf('Big dogs dig deep holes.');
  const f = contour(accentPlan(ws), toks, prosodyOptions({ ...FLAT, top: 2, declination: 4 }));
  for (const t of [0, 300, 900]) near(f(t), 2 - 4 * t / 1000);
  const g = contour(accentPlan(ws), toks, prosodyOptions({ ...FLAT, decay: 3, decayMs: 200 }));
  for (const t of [0, 100, 700]) near(g(t), -3 * (1 - Math.exp(-t / 200)));
  assert.ok(end > 700);
});

test('prosody: phrase ends: final lowering, from the last or the nuclear vowel; continuation, question rises', () => {
  const { ws, toks, end } = toksOf('The dogs dig in the garden.');
  const vs = toks.filter((t) => t.kind === 'vowel');
  const last = vs.at(-1), nuc = vs.at(-2);               // gar-den: the nuclear accent on "gar"
  const P = prosodyOptions({ ...FLAT, final: 4 });
  const f = contour(accentPlan(ws), toks, P);
  near(f(last.start), 0); near(f(end - 250), -4);        // the phrase ends where its pause begins
  const g = contour(accentPlan(ws), toks, { ...P, finalFrom: 1 });
  near(g(nuc.start), 0); assert.ok(g(last.start) < -1, 'lowered from the nuclear vowel on');
  // continuation rise at a comma, partial reset after it, full reset after a sentence
  const c = toksOf('Dogs dig, cats nap. Dogs dig.');
  const pc = accentPlan(c.ws), cv = c.toks.filter((t) => t.kind === 'vowel');
  const h = contour(pc, c.toks, prosodyOptions({ ...FLAT, continuation: 3, declination: 2, top: 1, reset: 0.5 }));
  const ph = (i) => c.toks.filter((t) => t.word >= pc.phrases[i].from && t.word <= pc.phrases[i].to);
  const e0 = ph(0).at(-1), s1 = ph(1)[0], s2 = ph(2)[0];
  near(h(e0.start + e0.ms - 1e-9), 1 - 2 * (e0.start + e0.ms - 1e-9) / 1000 + 3 * (0.5 - 0.5 * Math.cos(Math.PI * (e0.start + e0.ms - 1e-9 - cv[1].start) / (e0.start + e0.ms - cv[1].start))));
  const prevEnd = 1 - 2 * (e0.start + e0.ms) / 1000;
  near(h(s1.start), prevEnd + 0.5 * (1 - prevEnd), 'partial reset');
  near(h(s2.start), 1, 'full reset');
  // yes/no question: low nuclear accent, a rise from its vowel; a wh-question falls
  const q = toksOf('Will dogs dig?');
  const qf = contour(accentPlan(q.ws), q.toks, prosodyOptions({ ...FLAT, accent: 3, question: 6, final: 4, peak: 0.5, rise: 80, fall: 80 }));
  const qv = q.toks.filter((t) => t.kind === 'vowel').at(-1);
  near(qf(qv.start), 0); near(qf(q.end - 250), 6);
  const w = toksOf('Where do dogs dig?');
  near(contour(accentPlan(w.ws), w.toks, prosodyOptions({ ...FLAT, final: 4 }))(w.end - 250), -4);
});

test('prosody: microprosody: a vowel after a voiceless obstruent starts higher, voiced obstruents dip', () => {
  const { ws, toks } = toksOf('Pat bad tea.');
  const f = contour(accentPlan(ws), toks, prosodyOptions({ ...FLAT, micro: 2, microMs: 50, dip: 1 }));
  const at = (code) => toks.find((t) => t.p === code);
  near(f(at('AE').start), 2); near(f(at('AE').start + 50), 2 * Math.exp(-1));
  near(f(at('B').start + 10), -1); near(f(at('D').start + 10), -1);
  near(f(at('IY').start), 2);                            // after T
  const bad = toks.filter((t) => t.p === 'AE')[1];
  near(f(bad.start), 0, 'after B: no raise');
  // a pause before the vowel breaks the context; a flapped T (stops' DQF) counts as voiced
  const water = toksOf('Water.');
  water.toks.find((t) => t.p === 'T').code = 'DQF';
  const fw = contour(accentPlan(water.ws), water.toks, prosodyOptions({ ...FLAT, micro: 2, dip: 1 }));
  const flap = water.toks.find((t) => t.code === 'DQF');
  near(fw(flap.start + 5), -1); near(fw(flap.start + flap.ms), 0, 'no raise after a flap');
});

test('prosody: the string: only the pitch changes (phonemes, durations, timelines); effort on accented syllables', () => {
  const text = 'The birch canoe slid on the smooth planks, before the rain.';
  const base = { text, functionWords: true };
  const s = speak({ ...base, prosody: true }), s0 = speak({ ...base, intonation: { accent: 0, finalFall: 0 } });
  const noEffort = (x) => unpitched(x).replace(/ g[+-]0\.1/g, '');
  assert.equal(noEffort(s), noEffort(s0));
  assert.deepEqual(durationsOf({ ...base, prosody: true }), durationsOf(base));
  assert.deepEqual(timelineOf({ ...base, prosody: true }), timelineOf(base));
  assert.deepEqual(compileString(s).warnings, []);
  // every phoneme token has its F0 (the opening b of the string is left out: the first token sets it)
  assert.ok(pitches(s).every((x) => x.f0 > 0));
  assert.match(s, /^g0\.5 t0 h0\.05 b\d+(\.\d+)? r/);
  // effort: true (default) puts accentDelta on the accented syllables: "before" (stress 1, unaccented) loses it
  const eff = (x) => (x.match(/g\+0\.1/g) ?? []).length;
  assert.equal(eff(s), plan(text).accents.length);
  assert.equal(eff(speak({ ...base, prosody: { effort: false } })), eff(s0));
  assert.equal(speak({ ...base, prosody: { ...PROSODY } }), s);
});

test('prosody: the string samples the contour: flat, risen at the end of a question, the spec pitch as reference', () => {
  const f = pitches(speak({ text: 'Big dogs dig deep holes.', pitch: 'A2', prosody: FLAT }));
  assert.ok(f.every((x) => x.f0 === 110 && x.end === 110), JSON.stringify(f));
  const top = pitches(speak({ text: 'Big dogs.', pitch: 'A2', prosody: { ...FLAT, top: 12 } }));
  assert.ok(top.every((x) => x.f0 === 220), JSON.stringify(top));
  const q = pitches(speak({ text: 'Will big dogs dig?', pitch: 'A2', prosody: { ...FLAT, question: 6 } })).filter((x) => /^[AEIOU]/.test(x.code)).at(-1);
  assert.ok(q.end > q.f0 && q.end > hz('A2') * 2 ** (2 / 12), JSON.stringify(q));
});
