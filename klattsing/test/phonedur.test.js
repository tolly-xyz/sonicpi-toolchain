// phoneDur: a per-call override of the [inherent, minimum] duration table (phones.js DUR), for the duration
// fit in tools/voicelab/climb.py. Opt-in: without it (or with the default values) nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toKlattsch, durationsOf, durTable } from '../src/compile.js';
import { DUR } from '../src/phones.js';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const ms = (d, p) => d.phones.filter((x) => x.p === p).map((x) => x.ms);

test('phoneDur: absent, empty, or the default values give the reference strings', () => {
  const same = Object.fromEntries(Object.entries(DUR).map(([p, v]) => [p, [...v]]));
  for (const { spec, out } of REF) {
    assert.equal(toKlattsch({ ...spec, phoneDur: {} }), out, JSON.stringify(spec));
    assert.equal(toKlattsch({ ...spec, phoneDur: same }), out, JSON.stringify(spec));
  }
});

test('phoneDur: scales the overridden phoneme only (DUR = (INH - MIN) * k + MIN)', () => {
  const text = 'The cat sat on a mat.';
  const a = durationsOf({ mode: 'speak', text });
  const [inh, min] = DUR.AE;
  const b = durationsOf({ mode: 'speak', text, phoneDur: { AE: [2 * inh, 2 * min] } });
  ms(a, 'AE').forEach((x, i) => assert.ok(Math.abs(ms(b, 'AE')[i] - 2 * x) < 1e-9));
  for (const p of ['DH', 'K', 'T', 'S', 'M', 'AA']) assert.deepEqual(ms(b, p), ms(a, p), p);
  // min = inh: the rules no longer matter for that phoneme (every T here is in a stressed syllable)
  const c = durationsOf({ mode: 'speak', text, phoneDur: { T: [90, 90] } });
  assert.ok(ms(c, 'T').length === 3 && ms(c, 'T').every((x) => Math.abs(x - 90) < 1e-9), ms(c, 'T').join());
});

test('phoneDur: also with durations "v0", in sing mode, and in the string', () => {
  const text = 'The cat sat on a mat.';
  const v0 = durationsOf({ mode: 'speak', text, durations: 'v0' });
  const v0b = durationsOf({ mode: 'speak', text, durations: 'v0', phoneDur: { S: [210, 120] } });
  ms(v0, 'S').forEach((x, i) => assert.ok(Math.abs(ms(v0b, 'S')[i] - 2 * x) < 1e-9));
  const sg = { mode: 'sing', text: 'Lower the bucket', bpm: 120, notes: 'auto' };
  const s1 = durationsOf(sg), s2 = durationsOf({ ...sg, phoneDur: { K: [160, 120] } });
  ms(s1, 'K').forEach((x, i) => assert.ok(Math.abs(ms(s2, 'K')[i] - 2 * x) < 1e-9));
  assert.notEqual(toKlattsch({ mode: 'speak', text, phoneDur: { AE: [400, 100] } }), toKlattsch({ mode: 'speak', text }));
});

test('phoneDur: malformed entries throw; durTable merges over DUR', () => {
  assert.throws(() => durationsOf({ mode: 'speak', text: 'cat', phoneDur: { AE: 200 } }), /phoneDur\.AE/);
  assert.throws(() => durationsOf({ mode: 'speak', text: 'cat', phoneDur: { AE: [200] } }), /phoneDur\.AE/);
  assert.throws(() => durationsOf({ mode: 'speak', text: 'cat', phoneDur: { AE: [200, -1] } }), /phoneDur\.AE/);
  assert.equal(durTable(undefined), undefined);
  const t = durTable({ AE: [300, 90] });
  assert.deepEqual(t.AE, [300, 90]);
  assert.deepEqual(t.IY, DUR.IY);
  assert.deepEqual(DUR.AE, [230, 80]);   // the shared table is untouched
});
