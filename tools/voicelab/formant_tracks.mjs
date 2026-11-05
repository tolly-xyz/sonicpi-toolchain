#!/usr/bin/env node
// The formant frequencies klattsch will render for klattsing speak specs, without the audio: a worker for
// tools/voicelab/vowelfit.py (--true). Each stdin line is an array of specs; each reply line is an array of
//   { phones: timeline phones (as klattsing --timeline), totalMs, F: [[F1, F2, F3] Hz every STEP ms from t = 0] }
// The values are the synth's own parameter state (FormantSynth.current, the schedule's transitions as the synth
// moves them, linear or shaped, [CO]'s formant events included), sampled every STEP ms of a run at a low sample
// rate: exact, where a formant tracker on klattsch's audio is not (it merges ER's F2 and F3, or a back vowel's F1
// and F2, when they are close, and then labels klattsch's fixed F4 as F3).
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { addLexicon } = await import(join(ROOT, 'klattsing/src/lexicon.js'));
const { toKlattsch } = await import(join(ROOT, 'klattsing/src/compile.js'));
const { timelineFrom } = await import(join(ROOT, 'klattsing/src/timeline.js'));
const { compileString } = await import(join(ROOT, 'vendor/klattsch/src/engine/index.js'));
const { FormantSynth } = await import(join(ROOT, 'vendor/klattsch/src/engine/synth-core.js'));
addLexicon(join(ROOT, 'dict', 'lexicon.json'));

const SR = 8000, STEP = 1;
export function formantTrack(schedule, totalMs) {
  const synth = new FormantSynth({ sampleRate: SR, schedule });
  const n = SR * STEP / 1000, buf = new Float32Array(n), out = [];
  for (let t = 0; t < totalMs; t += STEP) {
    const c = synth.current;
    out.push([Math.round(c.F1), Math.round(c.F2), Math.round(c.F3)]);
    synth.process(buf);
  }
  return out;
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let reply;
  try {
    reply = JSON.parse(line).map((spec) => {
      const meta = [], text = toKlattsch(spec, meta), c = compileString(text);
      if (c.warnings.length) throw new Error(`klattsch: ${c.warnings.join(', ')}`);
      const tl = timelineFrom(spec, meta, c), v = c.voices[0];
      return { phones: tl.phones, totalMs: tl.totalMs, step: STEP, F: formantTrack(v.schedule, v.totalMs) };
    });
  } catch (e) { reply = { error: String(e?.message ?? e) }; }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
