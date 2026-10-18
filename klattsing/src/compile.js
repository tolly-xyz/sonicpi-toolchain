// Text (+ notes) -> a klattsch string. Two modes:
//   speak({ text, pitch, rate, voice })                  all durations from the rules, a simple intonation
//   sing({ text, notes, bpm, voice, gate, hold, ... })   consonants keep their rule durations, vowels fill the notes
import { lookup } from './lexicon.js';
import { syllabify } from './syllables.js';
import { timeWords, RULES } from './durations.js';

const DIPH = { AY: ['AA', 'IY'], EY: ['EH', 'IY'], OW: ['AO', 'UW'], AW: ['AA', 'UW'], OY: ['AO', 'IY'] };
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(n) {
  if (typeof n === 'number') return n;
  const m = n.match(/^([A-G])([b#]?)(-?\d)$/); if (!m) throw new Error(`bad note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (m) => 440 * 2 ** ((midi(m) - 69) / 12);
const f1 = (x) => Math.round(x * 10) / 10;

export const VOICES = {
  speak: 'g0.5 t0 h0.05',
  sing: 'g0.55 t0.1 h0.06',
  shout: 'g0.8 t0.35 h0.12 s0.97',
  whisper: 'g0.25 h0.55 t-0.2',
};

export function words(text, rules = RULES) {
  return timeWords(lookup(text).map((w) => ({ ...w, syllables: syllabify(w.phones) })), rules);
}

// opts: { bank, transition, aspiration (true), accent (true), voice }
function prefix(o) {
  return [o.bank ? `[bank=${o.bank}]` : '', o.transition ? `[TR=${o.transition}]` : '', VOICES[o.voice] ?? o.voice ?? VOICES.speak]
    .filter(Boolean).join(' ');
}
const asp = (s, o) => (o.aspiration !== false && s.aspMs ? `r${f1(s.aspMs)} HH ` : '');

export function speak(o) {
  const rate = o.rate ?? 1, base = hz(o.pitch ?? 'A2'), ws = words(o.text, o.rules);
  let out = `${prefix(o)} b${f1(base)} `;
  ws.forEach((w, wi) => {
    w.syllables.forEach((s, si) => {
      const final = (w.punct !== '' || wi === ws.length - 1) && si === w.syllables.length - 1;
      s.onset.forEach((p, i) => { out += `r${f1(s.onsetMs[i] * rate)} ${p} `; });
      out += asp(s, o);
      if (s.nucleus) {
        // pitch: a rise on primary stress, a fall at the end of a phrase
        const delta = final ? f1(base * (2 ** (-3 / 12) - 1)) : s.stress === 1 ? f1(base * (2 ** (2 / 12) - 1)) : 0;
        const acc = o.accent !== false && s.stress === 1 ? ['g+0.1 ', 'g-0.1 '] : ['', ''];
        out += `${acc[0]}r${f1(s.nucleusMs * rate)} ${s.nucleus}${delta ? `(${delta > 0 ? '+' : ''}${delta})` : ''} ${acc[1]}`;
      }
      s.coda.forEach((p, i) => { out += `r${f1(s.codaMs[i] * rate)} ${p} `; });
      if (final && w.punct) out += `p${Math.round(250 * rate)} `;
    });
  });
  return out.trim();
}

// notes: one per syllable: [note, length] with length in sixteenths at bpm (or { ms }), or null for a rest
// gate: ms a vowel is held before the rest of its slot is silence (null = legato); hold: share of a
// long note (>= 6 sixteenths) held regardless of gate. Consonants sit on the beat.
export function sing(o) {
  const bpm = o.bpm ?? 120, st = (n) => n * 15000 / bpm;
  const syl = words(o.text, o.rules).flatMap((w) => w.syllables);
  const notes = o.notes.filter((n) => n !== null);
  if (notes.length !== syl.length) throw new Error(`${syl.length} syllables but ${notes.length} notes in "${o.text}"`);
  let out = `${prefix({ voice: 'sing', ...o })} `;
  syl.forEach((s, i) => {
    const [note, len, extra = {}] = notes[i];
    const slot = typeof len === 'object' ? len.ms : st(len);
    let ons = s.onsetMs.slice(), coda = s.codaMs.slice(), a = o.aspiration !== false ? s.aspMs : 0;
    let cons = ons.reduce((x, y) => x + y, 0) + coda.reduce((x, y) => x + y, 0) + a;
    let v = slot - cons;
    if (v < 45) { const k = Math.max((slot - 45) / cons, 0.5); ons = ons.map((x) => x * k); coda = coda.map((x) => x * k); a *= k; v = slot - cons * k; }
    let rest = 0;
    let gate = extra.gate ?? o.gate;
    if (gate && (typeof len === 'number' ? len : 0) >= 6) gate = Math.max(gate, slot * (o.hold ?? 0.55));
    if (gate && v > gate) { rest = v - gate; v = gate; }
    out += `v0 b${f1(hz(note))} `;
    s.onset.forEach((p, j) => { out += `r${f1(ons[j])} ${p} `; });
    if (a) out += `r${f1(a)} HH `;
    const acc = o.accent !== false && s.stress === 1;
    if (acc) out += 'g+0.15 t+0.15 ';
    const to = extra.to !== undefined ? f1(hz(extra.to) - hz(note)) : 0;
    const parts = DIPH[s.nucleus] && v > 200 ? [[DIPH[s.nucleus][0], v * 0.8], [DIPH[s.nucleus][1], v * 0.2]] : [[s.nucleus, v]];
    parts.forEach(([ph, len2], j) => { out += `r${f1(len2)} ${ph}${to && j === parts.length - 1 ? `${to > 0 ? '+' : ''}${to}` : ''} `; });
    if (acc) out += 'g-0.15 t-0.15 ';
    s.coda.forEach((p, j) => { out += `r${f1(coda[j])} ${p} `; });
    if (rest > 0) out += `p${f1(rest)} `;
  });
  return out.trim();
}
