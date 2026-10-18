#!/usr/bin/env node
// klattsch's WAV renderer, plus the phoneme banks in banks/*.json (select one with [bank=NAME]).
//   bin/klatt-render.mjs "[bank=kokoro-male-en] HH AH L OW" hello.wav
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString, renderToBuffer, encodeWav } from '../vendor/klattsch/src/engine/index.js';
import { registerBank } from '../vendor/klattsch/src/engine/banks/index.js';

const BANKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'banks');
export function loadBanks() {
  for (const f of readdirSync(BANKS).filter((f) => f.endsWith('.json'))) registerBank(JSON.parse(readFileSync(join(BANKS, f), 'utf8')));
}
loadBanks();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , text, outPath = 'klattsch.wav'] = process.argv;
  if (!text) { console.error('usage: klatt-render.mjs <phoneme-string> [output.wav]'); process.exit(1); }
  const sampleRate = 48000;
  const { voices, totalMs, warnings } = compileString(text);
  if (warnings.length) { console.error('warnings: ' + warnings.join(', ')); process.exit(2); }
  const buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000));
  for (const v of voices) {
    if (!v.schedule.length) continue;
    const vb = renderToBuffer({ sampleRate, schedule: v.schedule, totalMs: v.totalMs });
    for (let i = 0; i < Math.min(buf.length, vb.length); i++) buf[i] += vb[i];
  }
  writeFileSync(outPath, encodeWav(buf, sampleRate).bytes);
}
