// For each klattsch string, print each voice's phoneme timings (ms) as JSON.
import { compileString } from '../../vendor/klattsch/src/engine/index.js';
import { readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(0, 'utf8'));
const out = {};
for (const [name, text] of Object.entries(table)) {
  const { voices, warnings } = compileString(text);
  out[name] = { warnings, voices: voices.map(v => v.phrases.filter(p => p.phoneme).map(p => [p.phoneme, +p.tStartMs.toFixed(1), +p.tEndMs.toFixed(1)])) };
}
console.log(JSON.stringify(out));
