// Text (+ notes) -> a klattsch string. Two modes:
//   speak({ text, pitch, rate, voice })                  all durations from the rules, a simple intonation
//   sing({ text, notes, bpm, voice, gate, hold, ... })   consonants keep their rule durations, vowels fill the notes
// durationsOf(spec): the per-phoneme durations either mode assigns, without building a string (fast, for optimizers)
import { lookup, lexiconVersion } from './lexicon.js';
import { syllabify } from './syllables.js';
import { timeWords, RULES } from './durations.js';
import { timeWordsV0 } from './durations_v0.js';
import { FUNCTION_WORDS } from './function_words.js';
import { bankName, BREATH_PREFIX } from './banks.js';
import { DUR } from './phones.js';
import { coartOptions, coartDirectives } from './coarticulation.js';

const DIPH = { AY: ['AA', 'IY'], EY: ['EH', 'IY'], OW: ['AO', 'UW'], AW: ['AA', 'UW'], OY: ['AO', 'IY'] };
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(n) {
  if (typeof n === 'number') return n;
  const m = n.match(/^([A-G])([b#]?)(-?\d)$/); if (!m) throw new Error(`bad note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (m) => 440 * 2 ** ((midi(m) - 69) / 12);
const f1 = (x) => Math.round(x * 10) / 10;
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;
// defaults overridden by the fields of x that are set (null and undefined keep the default)
const merged = (def, x) => ({ ...def, ...Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => v != null)) });

export const VOICES = {
  speak: 'g0.5 t0 h0.05',
  sing: 'g0.55 t0.1 h0.06',
  shout: 'g0.8 t0.35 h0.12 s0.97',
  whisper: 'g0.25 h0.55 t-0.2',
};

// Defaults of the opt-in options (each reproduces the output from before the option existed)
export const INTONATION = { accent: 2, finalFall: 3, declination: 0, questionRise: 0 }; // semitones, st/s
export const ACCENT_DELTA = { speak: { g: 0.1, t: 0 }, sing: { g: 0.15, t: 0.15 } };    // effort/tilt on stress 1
export const PAUSE_MS = 250;   // speak: silence after a phrase's punctuation (times rate)
export const BREATH_LEVEL = 1; // aspiration: "breath": klattsch aspiration (h) during the breath
// glottal: the LF voice source (klattsch [GS=1], a patch): option field -> directive, and the values `true` gives
export const GLOTTAL_KEYS = { rd: 'RD', rdEffort: 'RDE', tilt: 'TL', jitter: 'JIT', shimmer: 'SHIM', aspMod: 'AM', flutter: 'FL', aspTilt: 'AT', noiseTilt: 'NT' };
export const GLOTTAL = { rd: 1, rdEffort: 6, tilt: 0, jitter: 0.5, shimmer: 5, aspMod: 1, flutter: 0, aspTilt: 0, noiseTilt: 15 };

// lookup + syllables, cached per text: durationsOf sees the same sentences thousands of times
const parsed = new Map();
let parsedVersion = -1;
function parse(text) {
  if (parsedVersion !== lexiconVersion()) { parsed.clear(); parsedVersion = lexiconVersion(); }
  let ws = parsed.get(text);
  if (!ws) {
    ws = lookup(text).map((w) => ({ ...w, syllables: syllabify(w.phones) }));
    if (parsed.size >= 20000) parsed.clear();
    parsed.set(text, ws);
  }
  return ws;
}

// o.phoneDur: { PHONE: [inherent, minimum] } (ms) over phones.js DUR, for the duration rules of either version
export function durTable(phoneDur) {
  if (!phoneDur) return undefined;
  for (const [p, v] of Object.entries(phoneDur)) {
    if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) {
      throw new Error(`phoneDur.${p}: expected [inherent, minimum] ms, got ${JSON.stringify(v)}`);
    }
  }
  return { ...DUR, ...phoneDur };
}

// o.functionWords: true (FUNCTION_WORDS) or a list of words: one-syllable ones get stress 0 before the rules
export function words(text, rules, version, o = {}) {
  const fw = o.functionWords && (o.functionWords === true ? FUNCTION_WORDS : new Set(o.functionWords.map((x) => x.toLowerCase())));
  const ws = parse(text).map((w) => {
    const reduce = fw && w.syllables.length === 1 && fw.has(w.word);
    return { ...w, syllables: w.syllables.map((s) => (reduce ? { ...s, stress: 0 } : { ...s })) };
  });
  const dur = durTable(o.phoneDur);
  return version === 'v0' ? timeWordsV0(ws, rules ?? undefined, dur) : timeWords(ws, { ...RULES, ...(rules ?? {}) }, dur);
}

// loudness by stress ([AV=x], a patch to the vendored klattsch): unstressed syllables recede, as in speech
export const DYNAMICS = { 1: 1.0, 2: 0.8, 0: 0.55 };
const av = (s, o) => (!o.dynamics ? '' : `[AV=${(o.dynamics === true ? DYNAMICS : o.dynamics)[s.stress] ?? 1}] `);
// opts: { bank (name or inline bank), bankPatch, transition, aspiration (true | false | "breath"), accent (true),
// dynamics (true | {stress: gain}; off by default until voicelab says otherwise), voice }
const voiceOf = (o) => VOICES[o.voice] ?? o.voice ?? VOICES.speak;
// o.glottal: true (GLOTTAL) or { rd, rdEffort, tilt, jitter, shimmer, aspMod, flutter, aspTilt, noiseTilt } over GLOTTAL -> klattsch directives
export function glottalDirs(g) {
  if (!g) return '';
  if (g !== true && (typeof g !== 'object' || Array.isArray(g))) throw new Error(`glottal: expected true or an object, got ${JSON.stringify(g)}`);
  const x = merged(GLOTTAL, g === true ? {} : g);
  for (const k of Object.keys(x)) {
    if (!(k in GLOTTAL_KEYS)) throw new Error(`glottal.${k}: unknown (${Object.keys(GLOTTAL_KEYS).join(', ')})`);
    if (typeof x[k] !== 'number' || !Number.isFinite(x[k])) throw new Error(`glottal.${k}: expected a number, got ${JSON.stringify(x[k])}`);
  }
  const num = (v) => String(Math.round(v * 1e4) / 1e4);
  return ['[GS=1]', ...Object.entries(GLOTTAL_KEYS).map(([k, d]) => `[${d}=${num(x[k])}]`)].join(' ');
}
function prefix(o) {
  const bank = bankName(o), co = coartOptions(o.coarticulation);
  return [bank ? `[bank=${bank}]` : '', o.transition ? `[TR=${o.transition}]` : '', co ? coartDirectives(co) : '', glottalDirs(o.glottal), voiceOf(o)].filter(Boolean).join(' ');
}
const asp = (s, o) => (o.aspiration !== false && s.aspMs ? `r${f1(s.aspMs)} HH ` : '');
// the klattsch aspiration (h) a voice string leaves set, so "breath" can restore it
export function voiceAspiration(voice) {
  let h = 0;
  for (const m of voice.matchAll(/(?:^|\s)h(?:(=)?([+-]?\d+(?:\.\d+)?))?(?=\s|$)/g)) {
    h = m[2] === undefined ? 0 : !m[1] && /^[+-]/.test(m[2]) ? h + Number(m[2]) : Number(m[2]);
  }
  return Math.round(h * 1e6) / 1e6;
}
// accent directives {g, t} -> [before the vowel, after it]
function accentDirs(d) {
  let up = '', down = '';
  for (const k of ['g', 't']) if (d[k]) { up += `${k}${signed(d[k])} `; down += `${k}${signed(-d[k])} `; }
  return [up, down];
}
// o.pauseMs: ms, or { ",": ms, ".": ms, ..., default: ms } by the phrase's punctuation
function pauseOf(o, punct) {
  const p = o.pauseMs ?? PAUSE_MS;
  if (typeof p === 'number') return p;
  for (const ch of punct) if (p[ch] !== undefined) return p[ch];
  return p.default ?? PAUSE_MS;
}
const breathDirs = (o, voice) => [`h${o.breathLevel ?? BREATH_LEVEL} `, `h${voiceAspiration(voice)} `];

// meta (optional array): one { word, syl, asp?, p? } per phoneme token, in string order (for timelines; p names
// the vowel a BR<vowel> breath token belongs to)
export function speak(o, meta) {
  const m = Array.isArray(meta) ? meta : null;
  const rate = o.rate ?? 1, base = hz(o.pitch ?? 'A2'), ws = words(o.text, o.rules, o.durations, o);
  const I = merged(INTONATION, o.intonation);
  const [accUp, accDown] = accentDirs(merged(ACCENT_DELTA.speak, o.accentDelta));
  const breath = o.aspiration === 'breath', [hUp, hDown] = breathDirs(o, voiceOf(o));
  let out = `${prefix(o)} b${f1(base)} `, t = 0, lastB = f1(base);   // t: ms since the sentence began (declination)
  const ph = (ms, p, info, suffix = '') => { out += `r${f1(ms)} ${p}${suffix} `; m?.push(info); t += ms; };
  ws.forEach((w, wi) => {
    w.syllables.forEach((s, si) => {
      const final = (w.punct !== '' || wi === ws.length - 1) && si === w.syllables.length - 1;
      const at = { word: wi, syl: si };
      const b = I.declination ? base * 2 ** (-I.declination * t / 12000) : base;
      if (I.declination && f1(b) !== lastB) { lastB = f1(b); out += `b${lastB} `; }
      out += av(s, o);
      s.onset.forEach((p, i) => ph(s.onsetMs[i] * rate, p, at));
      const breathHere = breath && s.nucleus && s.aspMs;
      if (!breathHere && asp(s, o)) ph(s.aspMs, 'HH', { ...at, asp: true });
      if (s.nucleus) {
        // pitch: a rise on primary stress, a fall at the end of a phrase (a rise, with questionRise, after '?')
        const st = final ? (I.questionRise && w.punct.includes('?') ? I.questionRise : -I.finalFall) : s.stress === 1 ? I.accent : 0;
        const delta = st ? f1(b * (2 ** (st / 12) - 1)) : 0;
        const acc = o.accent !== false && s.stress === 1;
        if (acc) out += accUp;
        if (breathHere) { out += hUp; ph(s.aspMs, BREATH_PREFIX + s.nucleus, { ...at, asp: true, p: s.nucleus }); out += hDown; }
        ph(s.nucleusMs * rate, s.nucleus, at, delta ? `(${delta > 0 ? '+' : ''}${delta})` : '');
        if (acc) out += accDown;
      }
      s.coda.forEach((p, i) => ph(s.codaMs[i] * rate, p, at));
      if (final && w.punct) {
        out += `p${Math.round(pauseOf(o, w.punct) * rate)} `;
        t = /[.!?]/.test(w.punct) ? 0 : t + pauseOf(o, w.punct) * rate;
      }
    });
  });
  return out.trim();
}

// notes: one per syllable: [note, length] with length in sixteenths at bpm (or { ms }), or null for a rest
// gate: ms a vowel is held before the rest of its slot is silence (null = legato); hold: share of a
// long note (>= 6 sixteenths) held regardless of gate. Consonants sit on the beat.
// A melody for any text: stressed syllables get `long` sixteenths, others `short`, stepping through
// `scale` (note names) and ending on its first note; for tests and sketches.
export function autoNotes(syl, { scale = ['E2', 'G2', 'A2', 'G2', 'F2'], long = 4, short = 2, last = 6 } = {}) {
  return syl.map((s, i) => [i === syl.length - 1 ? scale[0] : scale[i % scale.length], i === syl.length - 1 ? last : s.stress === 1 ? long : short]);
}
// sing's timing, shared by sing() and durationsOf(): per syllable { s, at, rests, note, ons, coda, a, parts, to, rest }
function singPlan(o) {
  const bpm = o.bpm ?? 120, st = (n) => n * 15000 / bpm;
  const ws = words(o.text, o.rules, o.durations, o);
  const syl = ws.flatMap((w) => w.syllables);
  const where = ws.flatMap((w, wi) => w.syllables.map((_, si) => ({ word: wi, syl: si })));
  // a note named 'r' (or 'rest') is a rest: [ 'r', sixteenths ]
  const all = (o.notes === 'auto' || !o.notes ? autoNotes(syl, o.melody) : o.notes).filter((n) => n !== null);
  const isRest = (n) => n[0] === 'r' || n[0] === 'rest';
  const sung = all.filter((n) => !isRest(n));
  if (sung.length !== syl.length) throw new Error(`${syl.length} syllables but ${sung.length} notes in "${o.text}"`);
  const restsBefore = []; let k = 0;
  for (const n of all) { if (isRest(n)) (restsBefore[k] ??= []).push(n); else k++; }
  const restMs = (n) => (typeof n[1] === 'object' ? n[1].ms : st(n[1]));
  const plan = syl.map((s, i) => {
    const [note, len, extra = {}] = sung[i];
    const slot = typeof len === 'object' ? len.ms : st(len);
    let ons = s.onsetMs.slice(), coda = s.codaMs.slice(), a = o.aspiration !== false ? s.aspMs : 0;
    let cons = ons.reduce((x, y) => x + y, 0) + coda.reduce((x, y) => x + y, 0) + a;
    let v = slot - cons;
    if (v < 45) { const k = Math.max((slot - 45) / cons, 0.5); ons = ons.map((x) => x * k); coda = coda.map((x) => x * k); a *= k; v = slot - cons * k; }
    let rest = 0;
    let gate = extra.gate ?? o.gate;
    if (gate && (typeof len === 'number' ? len : 0) >= 6) gate = Math.max(gate, slot * (o.hold ?? 0.55));
    if (gate && v > gate) { rest = v - gate; v = gate; }
    const to = extra.to !== undefined ? f1(hz(extra.to) - hz(note)) : 0;
    const parts = DIPH[s.nucleus] && v > 200 ? [[DIPH[s.nucleus][0], v * 0.8], [DIPH[s.nucleus][1], v * 0.2]] : [[s.nucleus, v]];
    return { s, at: where[i], rests: (restsBefore[i] ?? []).map(restMs), note, ons, coda, a, parts, to, rest };
  });
  return { ws, plan, tail: (restsBefore[syl.length] ?? []).map(restMs) };
}
export function sing(o, meta) {
  const m = Array.isArray(meta) ? meta : null;
  const { plan, tail } = singPlan(o);
  const vo = { voice: 'sing', ...o };
  const [accUp, accDown] = accentDirs(merged(ACCENT_DELTA.sing, o.accentDelta));
  const breath = o.aspiration === 'breath', [hUp, hDown] = breathDirs(o, voiceOf(vo));
  let out = `${prefix(vo)} `;
  const ph = (ms, p, info, suffix = '') => { out += `r${f1(ms)} ${p}${suffix} `; m?.push(info); };
  for (const x of plan) {
    const { s, at } = x;
    for (const r of x.rests) out += `p${f1(r)} `;
    out += `v0 b${f1(hz(x.note))} ${av(s, o)}`;
    s.onset.forEach((p, j) => ph(x.ons[j], p, at));
    if (x.a && !breath) ph(x.a, 'HH', { ...at, asp: true });
    const acc = o.accent !== false && s.stress === 1;
    if (acc) out += accUp;
    if (x.a && breath) { out += hUp; ph(x.a, BREATH_PREFIX + x.parts[0][0], { ...at, asp: true, p: x.parts[0][0] }); out += hDown; }
    x.parts.forEach(([p, len2], j) => ph(len2, p, at, x.to && j === x.parts.length - 1 ? `${x.to > 0 ? '+' : ''}${x.to}` : ''));
    if (acc) out += accDown;
    s.coda.forEach((p, j) => ph(x.coda[j], p, at));
    if (x.rest > 0) out += `p${f1(x.rest)} `;
  }
  for (const r of tail) out += `p${f1(r)} `;
  return out.trim();
}

// a spec (mode "speak" or "sing") -> its klattsch string
export const toKlattsch = (spec, meta) => (spec.mode === 'sing' ? sing(spec, meta) : speak(spec, meta));

// The durations klattsing assigns before klattsch, per phoneme in lexical order:
//   { text, words: [word], totalMs, phones: [{ p, ms, word, syl, stress, asp? }] }
// ms is unrounded (the klattsch string rounds to 0.1 ms) and includes rate; asp (on a vowel) is the
// aspiration before it (an HH segment, or the breath with aspiration: "breath"); { p: "pau", ms } is a
// silence (speak: after punctuation; sing: rests and gated note ends). totalMs = sum of ms + asp.
// An array of specs gives an array of results.
export function durationsOf(spec) {
  if (Array.isArray(spec)) return spec.map((x) => durationsOf(x));
  const o = spec, phones = [];
  let ws;
  if (o.mode === 'sing') {
    const r = singPlan(o);
    ws = r.ws;
    for (const x of r.plan) {
      const info = { word: x.at.word, syl: x.at.syl, stress: x.s.stress };
      for (const ms of x.rests) phones.push({ p: 'pau', ms });
      x.s.onset.forEach((p, j) => phones.push({ p, ms: x.ons[j], ...info }));
      if (x.s.nucleus) phones.push({ p: x.s.nucleus, ms: x.parts.reduce((a, q) => a + q[1], 0), ...info, ...(x.a ? { asp: x.a } : {}) });
      x.s.coda.forEach((p, j) => phones.push({ p, ms: x.coda[j], ...info }));
      if (x.rest > 0) phones.push({ p: 'pau', ms: x.rest });
    }
    for (const ms of r.tail) phones.push({ p: 'pau', ms });
  } else {
    const rate = o.rate ?? 1;
    ws = words(o.text, o.rules, o.durations, o);
    ws.forEach((w, wi) => w.syllables.forEach((s, si) => {
      const info = { word: wi, syl: si, stress: s.stress };
      const a = o.aspiration !== false && s.aspMs ? s.aspMs : 0;
      s.onset.forEach((p, i) => phones.push({ p, ms: s.onsetMs[i] * rate, ...info }));
      if (s.nucleus) phones.push({ p: s.nucleus, ms: s.nucleusMs * rate, ...info, ...(a ? { asp: a } : {}) });
      else if (a) phones.push({ p: 'HH', ms: a, ...info });
      s.coda.forEach((p, i) => phones.push({ p, ms: s.codaMs[i] * rate, ...info }));
      if (si === w.syllables.length - 1 && w.punct) phones.push({ p: 'pau', ms: Math.round(pauseOf(o, w.punct) * rate) });
    }));
  }
  const totalMs = phones.reduce((a, x) => a + x.ms + (x.asp ?? 0), 0);
  return { text: o.text, words: ws.map((w) => w.word), totalMs, phones };
}
