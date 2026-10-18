#!/usr/bin/env node
// klattsing: a JSON spec -> a klattsch string (--print) or a WAV, rendered with banks/*.json.
//   echo '{"mode":"speak","text":"Lower the bucket."}' | klattsing/bin/klattsing.mjs - out.wav
//   echo '{"mode":"sing","text":"Lower the bucket","bpm":168,"notes":[["E2",3],["G2",3],["F2",3],["A2",3],["G2",4]]}' | klattsing/bin/klattsing.mjs - --print
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addLexicon } from '../src/lexicon.js';
import { speak, sing } from '../src/compile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
addLexicon(join(ROOT, 'dict', 'lexicon.json'));
const [, , src, out] = process.argv;
const specs = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8'));
const strings = (Array.isArray(specs) ? specs : [specs]).map((s) => (s.mode === 'sing' ? sing(s) : speak(s)));
if (out === '--print' || !out) { console.log(strings.join('\n')); process.exit(0); }
const { compileString, renderToBuffer, encodeWav } = await import(join(ROOT, 'vendor/klattsch/src/engine/index.js'));
await import(join(ROOT, 'bin/klatt-render.mjs'));
const sr = 48000, bufs = [];
for (const text of strings) {
  const { voices, totalMs, warnings } = compileString(text);
  if (warnings.length) { console.error(`klattsch: ${warnings.join(', ')}`); process.exit(2); }
  const b = new Float32Array(Math.ceil(totalMs * sr / 1000));
  for (const v of voices) {
    if (!v.schedule.length) continue;
    const vb = renderToBuffer({ sampleRate: sr, schedule: v.schedule, totalMs: v.totalMs });
    for (let i = 0; i < Math.min(b.length, vb.length); i++) b[i] += vb[i];
  }
  bufs.push(b);
}
const gap = Math.round(sr * 0.6), n = bufs.reduce((a, b) => a + b.length + gap, 0), all = new Float32Array(n);
let at = 0; for (const b of bufs) { all.set(b, at); at += b.length + gap; }
writeFileSync(out, encodeWav(all, sr).bytes);
