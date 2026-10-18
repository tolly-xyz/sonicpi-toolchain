// The notes a klattsch string actually sings: compile it and read each phoneme's target F0.
// Flags any pitch more than 30 cents from a note of the given scale.
// usage: node pitches.mjs "E F G A Bb B C D" < table.json
import { compileString } from '../../vendor/klattsch/src/engine/index.js';
import { readFileSync } from 'node:fs';
import '../../bin/klatt-render.mjs';   // registers banks/*.json
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const scale = new Set((process.argv[2] || 'E F G A Bb B C D').split(/\s+/));
const table = JSON.parse(readFileSync(0, 'utf8'));
let bad = 0;
for (const [name, text] of Object.entries(table)) {
  const notes = [];
  for (const [vi, v] of compileString(text).voices.entries()) {
    for (const ev of v.schedule) {
      const f = ev.target.F0; if (!f || !(ev.target.A1 || ev.target.A2 || ev.target.A3)) continue;
      const m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), cents = Math.round((m - n) * 100);
      const label = NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
      const off = !scale.has(NAMES[((n % 12) + 12) % 12]) || Math.abs(cents) > 30;
      if (off) bad++;
      if (notes.at(-1)?.label !== label) notes.push({ label: (vi ? 'v1:' : '') + label + (off ? `(!${cents > 0 ? '+' : ''}${cents}c)` : '') , label2: label });
      notes.at(-1).label = notes.at(-1).label; notes.at(-1).label2 = label;
    }
  }
  console.log(`${name.padEnd(9)} ${notes.map(n => n.label).join(' ')}`);
}
console.log(bad ? `${bad} pitch targets off the scale` : 'every pitch target is in the scale');
