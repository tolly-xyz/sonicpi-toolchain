// Features must compose. Two bugs found on merging: coarticulation's shaped-transition path never applied the
// [GS] voice source, and then its formant-only events (F1-F3 alone) read as "GS absent" and switched it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { speak, toKlattsch } from '../src/compile.js';
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

// prosody (src/prosody.js) only re-pitches the string (a b directive per phoneme, transient deltas on vowels) and
// moves the effort accent: the four engine features must stay on through its directives.
test('prosody + coarticulation + glottal + nasals + stops: prosody changes the sound, each of the four still does', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'Nine good men kept the bottom of the morning, did they?';
  const on = { coarticulation: true, glottal: true, nasals: true, stops: true };
  const all = { text, ...on, prosody: true };
  const h = audio(all);
  assert.notEqual(h, audio({ text, ...on }), 'prosody has no effect with the other four on');
  for (const k of Object.keys(on)) {
    const without = { ...all }; delete without[k];
    assert.notEqual(h, audio(without), `${k} has no effect with prosody and the other three on`);
  }
  // the string carries all of them, and prosody's pitch: a b before (nearly) every phoneme
  const s = speak(all);
  assert.match(s, /^\[bank=klatt1980-en(--[0-9a-z]+)*--co[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\].* \[NAS=[\d.]+\]/);
  assert.ok((s.match(/ b\d/g) ?? []).length > 30, 'per-phoneme pitch');
  for (const b of banksFor(all)) registerBank(b);
  const v = compileString(s).voices[0];
  assert.ok(v.schedule.some((e) => e.params && e.params.join() === 'F1,F2,F3'), 'expected coarticulation formant events');
  assert.ok(v.schedule.some((e) => e.nasalOnly), 'expected nasalOnly events');
  assert.ok(v.schedule.some((e) => e.target.voicing === 1 && e.target.A2 === 0 && e.target.BW1 === 60), 'expected a voice bar');
  // F0 follows the contour: it spans several semitones, and the LF source stays on
  const f0 = v.schedule.map((e) => e.target.F0).filter((x) => x > 0);
  assert.ok(12 * Math.log2(Math.max(...f0) / Math.min(...f0)) > 4, 'F0 range');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let gs = 0, n = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; gs += synth.src.GS; }
  assert.ok(gs / n > 0.95, `LF source on ${(100 * gs / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal, 'nasal path on');
});

// fricatives (klattsch [FRIC]) on top of all four: its envelopes ride in fricOnly events (frication parameters
// alone), which must neither read as "GS absent", nor retime coarticulation's formant moves or the nasal glides, and
// its entries come after coarticulation's (keeping the loci) and before the stops'.
test('fricatives composes with coarticulation, glottal, nasals and stops: each of the five changes the sound, all stay on', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'She has seven thick fish, and the zoo kept five of those.';
  const on = { coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true };
  const all = audio({ text, ...on });
  for (const k of Object.keys(on)) {
    const without = { text, ...on }; delete without[k];
    assert.notEqual(all, audio(without), `${k} has no effect with the other four on`);
  }
  const s = speak({ text, ...on });
  assert.match(s, /^\[bank=klatt1980-en--nas[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\].* \[NAS=1\].* \[FRIC=1\]/);
  for (const b of banksFor({ text, ...on })) registerBank(b);
  const v = compileString(s).voices[0];
  assert.ok(v.schedule.some((e) => e.fricOnly), 'expected fricOnly events');
  assert.ok(v.schedule.some((e) => e.nasalOnly), 'expected nasalOnly events');
  assert.ok(v.schedule.some((e) => e.params && e.params.join() === 'F1,F2,F3'), 'expected coarticulation formant events');
  assert.ok(v.schedule.some((e) => e.target.voicing === 1 && e.target.A2 === 0 && e.target.BW1 === 60), 'expected a voice bar');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let gs = 0, n = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; gs += synth.src.GS; }
  assert.ok(gs / n > 0.95, `LF source on ${(100 * gs / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal && synth.fric, 'nasal and frication paths on');
});

// all six: prosody re-pitches, fricatives adds the frication path; neither may move the other's events
test('all six features: each changes the sound with the other five on; prosody keeps the frication, fricatives the F0', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'Miss Sue sells this sea shell, and five good men kept the bottom of it.';
  const on = { coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true, prosody: true };
  const all = { text, ...on }, h = audio(all);
  for (const k of Object.keys(on)) {
    const without = { ...all }; delete without[k];
    assert.notEqual(h, audio(without), `${k} has no effect with the other five on`);
  }
  const sched = (spec) => { for (const b of banksFor(spec)) registerBank(b); return compileString(speak(spec)).voices[0]; };
  const noF = { ...all, fricatives: false }, noP = { ...all, prosody: false };
  const fo = (v) => JSON.stringify(v.schedule.filter((e) => e.fricOnly).map((e) => [e.atMs.toFixed(2), e.target]));
  const f0 = (v) => JSON.stringify(v.schedule.filter((e) => e.target?.F0 != null).map((e) => [e.atMs.toFixed(2), Math.round(e.target.F0 * 100)]));
  const v = sched(all);
  assert.equal(fo(v), fo(sched(noP)), 'prosody moved the frication events');
  assert.equal(f0(v), f0(sched(noF)), 'fricatives moved the F0 targets');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let gs = 0, n = 0, peak = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; gs += synth.src.GS; }
  for (const x of buf) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
  assert.ok(gs / n > 0.95, `LF source on ${(100 * gs / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal && synth.fric, 'nasal and frication paths on');
  assert.ok(peak < 1, `peak ${peak}`);
});

// reductions (src/reductions.js) changes only the phonemes before syllables are timed: every feature after it must
// see the reduced words (stops' voice bars and flaps, nasal murmurs, fricative entries, prosody's accents), and its
// forms must keep each engine path running
test('reductions on top of all six: it changes the sound, each of the six still does, LF / nasal / frication paths on', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'She was to read the evening paper to them, and five good men kept the bottom of it for us.';
  const six = { coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true, prosody: true };
  const all = { text, ...six, reductions: { weak: true } }, h = audio(all);
  assert.notEqual(audio({ text, ...six, reductions: true }), audio({ text, ...six }), 'the default (lexical) has no effect');
  assert.notEqual(h, audio({ text, ...six }), 'reductions has no effect with the six on');
  for (const k of Object.keys(six)) {
    const without = { ...all }; delete without[k];
    assert.notEqual(h, audio(without), `${k} has no effect with reductions and the other five on`);
  }
  // the string carries every feature's directives and the reduced forms (was, the before a vowel, read; "to" keeps
  // its citation vowel by default), in the stops' context entries (to: released, aspirated into UW; read: voice bar)
  const s = speak(all);
  assert.match(s, /^\[bank=klatt1980-en--nas[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\].* \[NAS=1\].* \[FRIC=1\]/);
  const seq = s.split(' ').filter((t) => /^[A-Z]+(\(|$)/.test(t)).map((t) => t.replace(/\(.*/, '')).join(' ');
  assert.match(seq, /^SH IY W AH Z TQTUW HQUW UW R IY DQVU DH IY IY V /, seq);
  assert.match(seq, / F ER AH S$/, seq);
  for (const b of banksFor(all)) registerBank(b);
  const v = compileString(s).voices[0];
  assert.ok(v.schedule.some((e) => e.fricOnly), 'expected fricOnly events');
  assert.ok(v.schedule.some((e) => e.nasalOnly), 'expected nasalOnly events');
  assert.ok(v.schedule.some((e) => e.params && e.params.join() === 'F1,F2,F3'), 'expected coarticulation formant events');
  assert.ok(v.schedule.some((e) => e.target.voicing === 1 && e.target.A2 === 0 && e.target.BW1 === 60), 'expected a voice bar');
  const f0 = v.schedule.map((e) => e.target.F0).filter((x) => x > 0);
  assert.ok(12 * Math.log2(Math.max(...f0) / Math.min(...f0)) > 4, 'F0 range (prosody)');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let gs = 0, n = 0, peak = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; gs += synth.src.GS; }
  for (const x of buf) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
  assert.ok(gs / n > 0.95, `LF source on ${(100 * gs / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal && synth.fric, 'nasal and frication paths on');
  assert.ok(peak < 1, `peak ${peak}`);
  // sung (pairs.py's sing stack: no glottal, no prosody): reductions changes it too, and it compiles cleanly
  const sungOn = { mode: 'sing', text: 'She was to read the evening paper to them', notes: 'auto', coarticulation: true, nasals: true, stops: true, fricatives: true };
  const sung = toKlattsch({ ...sungOn, reductions: { weak: true } });
  assert.notEqual(sung, toKlattsch(sungOn));
  for (const b of banksFor(sungOn)) registerBank(b);
  assert.deepEqual(compileString(sung).warnings, []);
});

// vowels (src/vowels.js: a vowel-target bank between bankPatch's and coarticulation's, new vowel codes, the glide window)
// on top of all six: coarticulation, the stops, breath and the nasals must take its targets and codes, prosody's pitch and
// the frication must not move, and every one of the six must still change the sound
test('vowels composes with all six: it changes the sound, each of the six still does; targets reach coarticulation and stops', async () => {
  const { FormantSynth } = await import('../../vendor/klattsch/src/engine/synth-core.js');
  const text = 'The dark river was there to hear about her four boats, and five good men kept it.';
  const on = { coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true, prosody: true };
  const all = { text, functionWords: true, ...on, vowels: true }, h = audio(all);
  assert.notEqual(h, audio({ ...all, vowels: false }), 'vowels has no effect with the six on');
  for (const k of Object.keys(on)) {
    const without = { ...all }; delete without[k];
    assert.notEqual(h, audio(without), `${k} has no effect with vowels and the other five on`);
  }
  const s = speak(all);
  assert.match(s, /^\[bank=klatt1980-en--nas[0-9a-f]{12}--vw[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\].* \[NAS=1\].* \[FRIC=1\]/);
  // the codes reach the stops (aspiration and bursts into reduced / r-colored vowels) and coarticulation (vowel: true)
  assert.match(s, / TQTAX /); assert.match(s, / AXR/); assert.match(s, / AAQR/); assert.match(s, / AOQR/);
  for (const b of banksFor(all)) registerBank(b);
  const P = (await import('../../vendor/klattsch/src/engine/index.js')).banks.get(s.match(/^\[bank=([^\]]+)\]/)[1]).phonemes;
  for (const c of ['AX', 'AXR', 'AAQR', 'AOQR', 'OW']) assert.ok(P[c].vowel && P[c].glideTo, c);
  assert.equal(P.HQOW.F2, P.OW.F2, "the aspiration takes the vowel's onset target");
  // the targets act through coarticulation: formant events go to OW's onset (the CV move after B) and its offset (the glide)
  const v = compileString(s).voices[0];
  const fe = v.schedule.filter((e) => e.params && e.params.join() === 'F1,F2,F3');
  assert.ok(fe.some((e) => Math.abs(e.target.F2 - P.OW.F2) < 0.01) && fe.some((e) => Math.abs(e.target.F2 - P.OW.glideTo.F2) < 0.01), 'OW onset and offset');
  // prosody's pitch (the b directives) and the frication envelopes are the same with or without vowels
  const bs = (x) => (x.match(/ b[\d.]+/g) ?? []).join('');
  assert.equal(bs(s), bs(speak({ ...all, vowels: false })), 'vowels moved the pitch contour');
  const sched = (spec) => { for (const b of banksFor(spec)) registerBank(b); return compileString(speak(spec)).voices[0]; };
  const fo = (x) => JSON.stringify(x.schedule.filter((e) => e.fricOnly).map((e) => [e.atMs.toFixed(2), e.target]));
  assert.equal(fo(v), fo(sched({ ...all, vowels: false })), 'vowels moved the frication events');
  assert.ok(v.schedule.some((e) => e.nasalOnly), 'expected nasalOnly events');
  assert.ok(v.schedule.some((e) => e.target.voicing === 1 && e.target.A2 === 0 && e.target.BW1 === 60), 'expected a voice bar');
  const synth = new FormantSynth({ sampleRate: 16000, schedule: v.schedule });
  const buf = new Float32Array(Math.ceil(v.totalMs * 16));
  let gs = 0, n = 0, peak = 0;
  for (let i = 0; i < buf.length; i += 160) { synth.process(buf.subarray(i, i + 160)); n++; gs += synth.src.GS; }
  for (const x of buf) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
  assert.ok(gs / n > 0.95, `LF source on ${(100 * gs / n).toFixed(0)}% of blocks`);
  assert.ok(synth.nasal && synth.fric, 'nasal and frication paths on');
  assert.ok(peak < 1, `peak ${peak}`);
});

// all eight: reductions on top of the seven (vowels included): it changes the sound, each of the seven still does, and
// the weak forms reach vowels' reduced codes (reductions owns to / was / than, vowels renders their schwa)
test('reductions on top of the seven (with vowels): each of the eight changes the sound; weak forms take AX', () => {
  const text = 'She was to read the evening paper to them, and five good men kept the bottom of it for us.';
  const seven = { coarticulation: true, glottal: true, nasals: true, stops: true, fricatives: true, prosody: true, vowels: true };
  const all = { text, functionWords: true, ...seven, reductions: { weak: true } }, h = audio(all);
  assert.notEqual(audio({ ...all, reductions: true }), audio({ ...all, reductions: false }), 'the default (lexical) has no effect');
  assert.notEqual(h, audio({ ...all, reductions: false }), 'reductions has no effect with the seven on');
  for (const k of Object.keys(seven)) {
    const without = { ...all }; delete without[k];
    assert.notEqual(h, audio(without), `${k} has no effect with reductions and the other six on`);
  }
  const s = speak(all);
  assert.match(s, /^\[bank=klatt1980-en--nas[0-9a-f]{12}--vw[0-9a-f]{12}--co[0-9a-f]{12}--fr[0-9a-f]{12}--st[0-9a-f]{12}\] \[CO=2\].* \[GS=1\].* \[NAS=1\].* \[FRIC=1\]/);
  const seq = s.split(' ').filter((t) => /^[A-Z]+(\(|$)/.test(t)).map((t) => t.replace(/\(.*/, '')).join(' ');
  assert.match(seq, /^SH IY W AX Z TQTAX AX R IY DQVU DH IY IY V /, seq);      // was to read the evening
  assert.match(seq, / F AXR AH S$/, seq);                                         // for us.
  for (const b of banksFor(all)) registerBank(b);
  const v = compileString(s).voices[0];
  assert.deepEqual(compileString(s).warnings, []);
  assert.ok(v.schedule.some((e) => e.fricOnly) && v.schedule.some((e) => e.nasalOnly), 'frication and nasal events');
});
