// The presets in presets/ are spec fragments: they must still load, name only options that exist, and compile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speak, GLOTTAL } from '../src/compile.js';
import { banksFor } from '../src/banks.js';
import { COARTICULATION } from '../src/coarticulation.js';
import { NASALS } from '../src/nasals.js';
import { STOP_DEFAULTS } from '../src/stops.js';
import { PROSODY } from '../src/prosody.js';
import { FRICATIVES } from '../src/fricatives.js';
import { registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import { compileString } from '../../vendor/klattsch/src/engine/index.js';

const preset = (name) => JSON.parse(readFileSync(new URL(`../presets/${name}`, import.meta.url), 'utf8'));
const DEFAULTS = { glottal: GLOTTAL, coarticulation: COARTICULATION, nasals: NASALS, stops: STOP_DEFAULTS,
  prosody: PROSODY, fricatives: FRICATIVES };

// every key of o (nested objects too) is a key of the defaults d, so a renamed option fails here, not silently
function known(o, d, path) {
  for (const [k, v] of Object.entries(o)) {
    assert.ok(k in d, `${path}.${k}: not an option`);
    if (v && typeof v === 'object' && !Array.isArray(v)) known(v, d[k], `${path}.${k}`);
  }
}

test('kokoro-features: the durations preset plus the eight features, every option a real one, and it compiles', () => {
  const p = preset('kokoro-features.json'), d = preset('kokoro-durations.json');
  for (const k of ['functionWords', 'rules', 'phoneDur']) assert.deepEqual(p[k], d[k], `${k} differs from kokoro-durations`);
  for (const f of ['coarticulation', 'glottal', 'nasals', 'stops', 'prosody', 'fricatives', 'vowels', 'reductions'])
    assert.ok(p[f] && typeof p[f] === 'object', `${f} is not on`);
  for (const [f, dflt] of Object.entries(DEFAULTS)) known(p[f], dflt, f);

  const text = 'The ship was torn apart on the sharp reef, and five good men kept the bottom of it.';
  const spec = { mode: 'speak', text, ...p };
  const atDefaults = { ...spec, ...Object.fromEntries(Object.keys(DEFAULTS).map((f) => [f, {}])), voice: undefined };
  const s = speak(spec);
  assert.notEqual(s, speak(atDefaults), 'the fitted options change nothing');
  assert.match(s, /\[TL=3\.5\]/, 'glottal.tilt does not reach the string');
  for (const b of banksFor(spec)) registerBank(b);
  assert.deepEqual(compileString(s).warnings, []);
});
