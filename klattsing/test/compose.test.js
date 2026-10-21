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
