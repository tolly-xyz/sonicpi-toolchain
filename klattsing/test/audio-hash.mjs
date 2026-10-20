// Golden audio: sha1 of klattsch's rendered samples for the reference specs (and the voicelab BASE config),
// so engine patches can be checked to leave every default render bit-identical.
//   node klattsing/test/audio-hash.mjs > klattsing/test/audio.fixture.json   (only with an unpatched engine)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toKlattsch } from '../src/compile.js';
import { compileString, renderToBuffer } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const PRESET = JSON.parse(readFileSync(new URL('../presets/kokoro-durations.json', import.meta.url), 'utf8'));
export const SPECS = [
  ...REF.map((r) => r.spec),
  ...['The birch canoe slid on the smooth planks.', 'Nine men ran home in the morning, singing a song.', 'mine nine ram ran rang sum sun sung']
    .map((text) => ({ mode: 'speak', ...PRESET, bank: 'mitalk-bursts', text })),
];
export function audioHash(spec, sampleRate = 16000) {
  const c = compileString(toKlattsch(spec));
  const h = createHash('sha1');
  for (const v of c.voices) {
    if (!v.schedule.length) continue;
    h.update(Buffer.from(renderToBuffer({ sampleRate, schedule: v.schedule, totalMs: v.totalMs }).buffer));
  }
  return h.digest('hex').slice(0, 16);
}
if (process.argv[1] && process.argv[1].endsWith('audio-hash.mjs')) {
  console.log(JSON.stringify(SPECS.map((s) => audioHash(s))));
}
