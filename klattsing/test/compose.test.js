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
test('stops composes with coarticulation and glottal: each of the three changes the audio, the other two stay on', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'A good cat got it, but the dog kept to the party.';
  const all = { text, coarticulation: true, glottal: true, stops: true };
  const h = audio(all);
  assert.notEqual(h, audio({ text, coarticulation: true, glottal: true }), 'stops ignored under coarticulation + glottal');
  assert.notEqual(h, audio({ text, glottal: true, stops: true }), 'coarticulation ignored under stops');
  assert.notEqual(h, audio({ text, coarticulation: true, stops: true }), 'glottal ignored under stops');
  // the string carries all three: the stops bank (extending coarticulation's), [CO], [GS], context entries
  const s = speak(all);
  assert.match(s, /^\[bank=klatt1980-en--co[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\]/);
  assert.match(s, / GQVUH /); assert.match(s, / DQF /); assert.match(s, / HQAE /); assert.match(s, / PQTU /);
  // coarticulation's formant-only events survive, and the LF source stays on through closures, voice bars and bursts
  for (const b of banksFor(all)) registerBank(b);
  const v = compileString(s).voices[0];
  assert.ok(v.schedule.some((e) => Object.keys(e.target).every((k) => /^F[123]$/.test(k))), 'expected formant-only events');
  assert.ok(v.schedule.some((e) => e.target.voicing === 1 && e.target.A2 === 0 && e.target.BW1 === 60), 'expected a voice bar');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let on = 0, n = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; on += synth.src.GS; }
  assert.ok(on / n > 0.95, `LF source on ${(100 * on / n).toFixed(0)}% of blocks`);
});

test('all four together (coarticulation, glottal, nasals, stops): each still changes the sound', () => {
  const text = 'Nine good men kept the bottom of the morning.';
  const on = { coarticulation: true, glottal: true, nasals: true, stops: true };
  const all = audio({ text, ...on });
  for (const k of Object.keys(on)) {
    const without = { text, ...on }; delete without[k];
    assert.notEqual(all, audio(without), `${k} has no effect with the other three on`);
  }
});
