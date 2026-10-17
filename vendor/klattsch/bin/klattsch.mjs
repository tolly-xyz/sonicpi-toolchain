#!/usr/bin/env node
// Standalone WAV renderer
//
//   node bin/klattsch.mjs "HH AH L OW" hello.wav
//   node bin/klattsch.mjs "b140 AY+30 . AY-30" sweep.wav

import { writeFileSync } from 'node:fs';
import {
  compileString, renderToBuffer, encodeWav,
} from '../src/engine/index.js';

const [, , text, outPath = 'klattsch.wav'] = process.argv;
if (!text) {
  console.error('usage: klattsch <phoneme-string> [output.wav]');
  console.error('  e.g. klattsch "HH AH L OW" hello.wav');
  process.exit(1);
}

const sampleRate = 48000;
const { voices, totalMs, warnings } = compileString(text);
if (warnings.length) {
  console.error('warnings: ' + warnings.join(', '));
}

// Render each voice section to its own buffer and sum. encodeWav peak-normalizes
// the mix, so summing pre-clipped voices is safe.
const buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000));
for (const v of voices) {
  if (!v.schedule.length) continue;
  const vb = renderToBuffer({ sampleRate, schedule: v.schedule, totalMs: v.totalMs });
  const n = Math.min(buf.length, vb.length);
  for (let i = 0; i < n; i++) buf[i] += vb[i];
}

const { bytes, gain } = encodeWav(buf, sampleRate, {
  metadata: {
    software: 'klattsch · https://tgies.github.io/klattsch',
    comment: text,
  },
});
writeFileSync(outPath, bytes);
console.error(
  `wrote ${outPath}: ${(bytes.length / 1024).toFixed(0)} KB, ` +
  `${(totalMs / 1000).toFixed(2)}s, normalize gain ${gain.toFixed(2)}x`
);
