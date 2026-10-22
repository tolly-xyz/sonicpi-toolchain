// Golden audio: sha1 of klattsch's rendered samples for the reference specs and the voicelab configs (durations
// preset + mitalk-bursts, alone and with coarticulation + glottal), so engine patches can be checked to leave every
// render without them bit-identical (test/audio.test.js).
//   node klattsing/test/audio-hash.mjs > klattsing/test/audio.fixture.json   (only with an engine without the patch
//   under test: the fixture holds the audio from before it)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toKlattsch } from '../src/compile.js';
import { compileString, renderToBuffer } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';

const REF = JSON.parse(readFileSync(new URL('./reference.fixture.json', import.meta.url), 'utf8'));
const PRESET = JSON.parse(readFileSync(new URL('../presets/kokoro-durations.json', import.meta.url), 'utf8'));
const BASE4 = { bank: 'mitalk-bursts', coarticulation: true, glottal: true, nasals: true, stops: true };
const FRIC_TEXT = 'Five thick shoes, the zoo; she has seven of those fish.';
const TEXTS = ['The birch canoe slid on the smooth planks.', 'Nine men ran home in the morning, singing a song.', 'mine nine ram ran rang sum sun sung'];
export const SPECS = [
  ...REF.map((r) => r.spec),
  ...TEXTS.map((text) => ({ mode: 'speak', ...PRESET, bank: 'mitalk-bursts', text })),
  // the voicelab BASE of the feature tournament's round 2 (coarticulation + glottal)
  ...TEXTS.map((text) => ({ mode: 'speak', ...PRESET, bank: 'mitalk-bursts', coarticulation: true, glottal: true, text })),
  // round 3's BASE (all four merged features), speech and song, and fricative-heavy text (added before the
  // "fricatives" engine patch: its frication path must leave these bit-identical)
  ...[...TEXTS, FRIC_TEXT].map((text) => ({ mode: 'speak', ...PRESET, ...BASE4, text })),
  { mode: 'sing', bank: 'mitalk-bursts', coarticulation: true, nasals: true, stops: true, text: 'She sells sea shells, five thin vases', notes: 'auto', bpm: 140 },
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
