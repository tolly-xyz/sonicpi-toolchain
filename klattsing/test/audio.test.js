// Golden audio (test/audio-hash.mjs): every reference spec and the voicelab configs (with coarticulation + glottal
// too) render the same samples as with the engine from before the nasal patch ([NAS] and the nasal pole-zero path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPECS, audioHash } from './audio-hash.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./audio.fixture.json', import.meta.url), 'utf8'));

test('engine: specs without "nasals" render bit-identical audio (reference specs, durations preset, BASE)', () => {
  assert.equal(SPECS.length, FIXTURE.length);
  const bad = SPECS.map((s, i) => [i, audioHash(s)]).filter(([i, h]) => h !== FIXTURE[i]);
  assert.deepEqual(bad.map(([i]) => SPECS[i].text), []);
});
