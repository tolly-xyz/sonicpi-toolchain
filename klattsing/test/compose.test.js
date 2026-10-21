// Features must compose. Two bugs found on merging: coarticulation's shaped-transition path never applied the
// [GS] voice source, and then its formant-only events (F1-F3 alone) read as "GS absent" and switched it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { speak } from '../src/compile.js';
import { banksFor } from '../src/banks.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import { compileString, renderToBuffer } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const audio = (spec) => {
  for (const b of banksFor(spec)) registerBank(b);
  const v = compileString(speak(spec)).voices[0];
  const buf = renderToBuffer({ sampleRate: 16000, schedule: v.schedule, totalMs: v.totalMs });
  return createHash('sha1').update(Buffer.from(buf.buffer)).digest('hex');
};

test('coarticulation + glottal renders differently from either alone', () => {
  const text = 'Lower the bucket, lower the bell.';
  const co = audio({ text, coarticulation: true });
  const gl = audio({ text, glottal: true });
  const both = audio({ text, coarticulation: true, glottal: true });
  assert.notEqual(both, co, 'glottal source ignored under coarticulation');
  assert.notEqual(both, gl, 'coarticulation ignored under glottal');
});

test('under coarticulation the LF source stays on through formant-only events', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const spec = { text: 'Lower the bucket.', coarticulation: true, glottal: true };
  for (const b of banksFor(spec)) registerBank(b);
  const v = compileString(speak(spec)).voices[0];
  assert.ok(v.schedule.some((e) => Object.keys(e.target).every((k) => /^F[123]$/.test(k))), 'expected formant-only events');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let on = 0, n = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; on += synth.src.GS; }
  assert.ok(on / n > 0.95, `LF source on ${(100 * on / n).toFixed(0)}% of blocks`);
});

// nasals (klattsch [NAS]) on top of both: its vowel nasalization rides in nasalOnly events (nasal parameters alone),
// which must neither read as "GS absent" nor retime coarticulation's formant moves.
test('nasals + coarticulation + glottal: each of the three still changes the sound', () => {
  const text = 'Nine men ran home in the morning.';
  const all = audio({ text, coarticulation: true, glottal: true, nasals: true });
  assert.notEqual(all, audio({ text, coarticulation: true, glottal: true }), 'nasals ignored under coarticulation + glottal');
  assert.notEqual(all, audio({ text, glottal: true, nasals: true }), 'coarticulation ignored under nasals');
  assert.notEqual(all, audio({ text, coarticulation: true, nasals: true }), 'glottal source ignored under nasals');
});

test('under nasals + coarticulation the LF source stays on through nasalOnly and formant-only events', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const spec = { text: 'Nine men ran home in the morning.', coarticulation: true, glottal: true, nasals: true };
  for (const b of banksFor(spec)) registerBank(b);
  const v = compileString(speak(spec)).voices[0];
  assert.ok(v.schedule.some((e) => e.nasalOnly), 'expected nasalOnly events');
  assert.ok(v.schedule.some((e) => e.params && e.params.join() === 'F1,F2,F3'), 'expected coarticulation formant events');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let on = 0, n = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; on += synth.src.GS; }
  assert.ok(on / n > 0.95, `LF source on ${(100 * on / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal, 'nasal path on');
});
