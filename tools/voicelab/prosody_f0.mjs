#!/usr/bin/env node
// The F0 klattsch will render for klattsing speak specs, without rendering audio: a worker for prosodyfit.py.
// Each stdin line is an array of specs; each reply line is an array of
//   { phones: timeline phones (as klattsing --timeline), f0: [Hz or 0 every 10 ms from t = 0] }
// F0 follows the schedule's transitions as the synth moves them (linear, or per parameter along the event's curve
// when the schedule is shaped); a frame is voiced when the voicing parameter is >= 0.5 and A1 + A2 + A3 > 0.01
// (an approximation of what Praat finds voiced in the audio). Jitter, shimmer and flutter are left out.
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { addLexicon } = await import(join(ROOT, 'klattsing/src/lexicon.js'));
const { toKlattsch } = await import(join(ROOT, 'klattsing/src/compile.js'));
const { timelineFrom } = await import(join(ROOT, 'klattsing/src/timeline.js'));
const { compileString } = await import(join(ROOT, 'vendor/klattsch/src/engine/index.js'));
const { CURVES, PARAMS } = await import(join(ROOT, 'vendor/klattsch/src/engine/synth-core.js'));
addLexicon(join(ROOT, 'dict', 'lexicon.json'));

const TRACK = ['F0', 'voicing', 'A1', 'A2', 'A3'];
const INIT = { F0: 120, voicing: 0, A1: 0, A2: 0, A3: 0 };
export function f0Track(schedule, totalMs, stepMs = 10) {
  const shaped = schedule.some((e) => e.curve || e.params);
  const mv = {};                              // param -> { from, to, t0, n, shape }
  for (const k of TRACK) mv[k] = { from: INIT[k], to: INIT[k], t0: 0, n: 0, shape: null };
  const val = (k, t) => {
    const m = mv[k];
    if (m.n <= 0 || t >= m.t0 + m.n) return m.to;
    const u = Math.max(0, (t - m.t0) / m.n);
    return m.from + (m.to - m.from) * (m.shape ? m.shape(u) : u);
  };
  const out = [];
  let ei = 0;
  for (let t = 0; t < totalMs; t += stepMs) {
    while (ei < schedule.length && schedule[ei].atMs <= t) {
      const e = schedule[ei++];
      if (e.nasalOnly) continue;
      const keys = shaped ? (e.params ?? PARAMS) : PARAMS;
      const n = Math.max(e.transitionMs ?? 30, 1000 / 48000);
      for (const k of TRACK) {
        if (!keys.includes(k)) continue;
        const from = val(k, e.atMs), to = k in e.target ? e.target[k] : mv[k].to;
        mv[k] = { from, to, t0: e.atMs, n, shape: shaped ? CURVES[e.curve ?? 0] ?? null : null };
      }
    }
    const voiced = val('voicing', t) >= 0.5 && val('A1', t) + val('A2', t) + val('A3', t) > 0.01;
    out.push(voiced ? Math.round(val('F0', t) * 100) / 100 : 0);
  }
  return out;
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let reply;
  try {
    reply = JSON.parse(line).map((spec) => {
      const meta = [], text = toKlattsch(spec, meta), c = compileString(text);
      if (c.warnings.length) throw new Error(`klattsch: ${c.warnings.join(', ')}`);
      const tl = timelineFrom(spec, meta, c), v = c.voices[0];
      return { phones: tl.phones, totalMs: tl.totalMs, f0: f0Track(v.schedule, v.totalMs) };
    });
  } catch (e) { reply = { error: String(e?.message ?? e) }; }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
