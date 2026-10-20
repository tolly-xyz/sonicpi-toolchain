// When each phoneme sounds in the rendered audio: klattsch's own schedule (compileString, voice 0 phrases).
//   timelineOf(spec) -> { text, totalMs, phones: [{ p, start, end, word, syl, asp? }] }      (ms)
// start/end are klattsch's phoneme slots; the last phoneme ends where the closing fade starts (klattsch holds
// its phrase to the end of the 150 ms trail, which is silence). word/syl index the spec's words and their
// syllables (as in durationsOf); asp marks the aspiration after P/T/K (HH, or the breath part of a vowel).
import { compileString } from '../../vendor/klattsch/src/engine/index.js';
import '../../bin/klatt-render.mjs';                    // registers banks/*.json
import { toKlattsch } from './compile.js';

const r2 = (x) => Math.round(x * 100) / 100;

// from an already compiled spec: string -> compileString(string) must have run right after toKlattsch(spec, meta)
export function timelineFrom(spec, meta, compiled) {
  const v = compiled.voices[0];
  const ph = v.phrases.filter((p) => p.kind === 'phoneme');
  const end = v.schedule.length ? v.schedule[v.schedule.length - 1].atMs : v.totalMs;
  const known = meta && meta.length === ph.length;
  const phones = ph.map((p, i) => ({ p: p.phoneme, start: r2(p.tStartMs), end: r2(Math.min(p.tEndMs, end)), ...(known ? meta[i] : {}) }));
  return { text: spec.text, totalMs: r2(compiled.totalMs), phones };
}

// spec or array of specs; throws on klattsch warnings (an unknown phoneme takes no time)
export function timelineOf(spec) {
  if (Array.isArray(spec)) return spec.map((x) => timelineOf(x));
  const meta = [], text = toKlattsch(spec, meta), compiled = compileString(text);
  if (compiled.warnings.length) throw new Error(`klattsch: ${compiled.warnings.join(', ')}`);
  return timelineFrom(spec, meta, compiled);
}
