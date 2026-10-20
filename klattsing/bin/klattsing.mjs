#!/usr/bin/env node
// klattsing: a JSON spec (or an array of specs; a file or '-' for stdin) -> klattsch strings (--print, also the
// default without an output file), a WAV rendered with banks/*.json (lines 0.6 s apart), phoneme timings, or durations.
//   echo '{"mode":"speak","text":"Lower the bucket."}' | klattsing/bin/klattsing.mjs - out.wav
//   echo '{"mode":"sing","text":"Lower the bucket","bpm":168,"notes":[["E2",3],["G2",3],["F2",3],["A2",3],["G2",4]]}' | klattsing/bin/klattsing.mjs - --print
//   klattsing.mjs SPEC --timeline [out.wav]   one JSON line per spec: {"text","totalMs","offsetMs","phones":[{"p","start","end","word","syl","asp"?}]}
//                                             (ms, as rendered; offsetMs: where the line starts in out.wav)
//   klattsing.mjs SPEC --durations            one JSON line per spec: {"text","words","totalMs","phones":[{"p","ms","word","syl","stress","asp"?}]}
//                                             (the rule durations before klattsch; no rendering)
//   klattsing.mjs --serve [--durations|--timeline|--print]   a long-running worker: each stdin line is a spec or an
//                                             array of specs, answered by one stdout line (the same shape; {"error"} on failure)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { addLexicon } from '../src/lexicon.js';
import { toKlattsch, durationsOf } from '../src/compile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SR = 48000, GAP_MS = 600;
addLexicon(join(ROOT, 'dict', 'lexicon.json'));

const args = process.argv.slice(2);
const FLAGS = ['--print', '--timeline', '--durations', '--serve'];
for (const a of args) if (a.startsWith('--') && !FLAGS.includes(a)) { console.error(`klattsing: unknown option ${a} (${FLAGS.join(' ')})`); process.exit(1); }
const flag = (f) => args.includes(f);
const [src, out] = args.filter((a) => !a.startsWith('--'));
const mode = flag('--durations') ? 'durations' : flag('--timeline') ? 'timeline' : flag('--print') || !out || flag('--serve') ? 'print' : 'wav';

class KlattschWarning extends Error {}
let E = null;   // the klattsch engine and the timeline helpers, loaded only when rendering or timing
async function engine() {
  if (!E) E = { ...(await import(join(ROOT, 'vendor/klattsch/src/engine/index.js'))), ...(await import('../src/timeline.js')) };
  return E;
}
// each spec compiles in klattsch right after its string is made, so inline banks reusing a name stay apart
function compileAll(list) {
  return list.map((spec) => {
    const meta = [], text = toKlattsch(spec, meta), c = E.compileString(text);
    if (c.warnings.length) throw new KlattschWarning(`klattsch: ${c.warnings.join(', ')}`);
    return { spec, meta, text, c };
  });
}
const lineSamples = (totalMs) => Math.ceil(totalMs * SR / 1000);
function timelines(compiled) {
  let at = 0;
  return compiled.map(({ spec, meta, c }) => {
    const { text, totalMs, phones } = E.timelineFrom(spec, meta, c);
    const offsetMs = Math.round(at / SR * 1e5) / 100;
    at += lineSamples(c.totalMs) + Math.round(SR * GAP_MS / 1000);
    return { text, totalMs, offsetMs, phones };
  });
}
const r3 = (x) => Math.round(x * 1000) / 1000;
const roundDurations = (d) => ({ ...d, totalMs: r3(d.totalMs), phones: d.phones.map((p) => ({ ...p, ms: r3(p.ms), ...(p.asp ? { asp: r3(p.asp) } : {}) })) });
function handle(list) {
  if (mode === 'durations') return list.map((s) => roundDurations(durationsOf(s)));
  if (mode === 'timeline') return timelines(compileAll(list));
  return list.map((s) => toKlattsch(s));
}

if (flag('--serve')) {
  if (mode === 'timeline') await engine();
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let reply;
    try {
      const req = JSON.parse(line), res = handle(Array.isArray(req) ? req : [req]);
      reply = Array.isArray(req) ? res : res[0];
    } catch (e) { reply = { error: String(e?.message ?? e) }; }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
} else {
  if (!src) { console.error('usage: klattsing.mjs <spec.json | -> [out.wav] [--print | --timeline | --durations] | --serve [...]'); process.exit(1); }
  const specs = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8'));
  const list = Array.isArray(specs) ? specs : [specs];
  try {
    if (mode === 'print') console.log(handle(list).join('\n'));
    else if (mode === 'durations') console.log(handle(list).map((d) => JSON.stringify(d)).join('\n'));
    else {
      await engine();
      const compiled = compileAll(list);
      if (mode === 'timeline') console.log(timelines(compiled).map((d) => JSON.stringify(d)).join('\n'));
      if (out) {
        const bufs = compiled.map(({ c }) => {
          const b = new Float32Array(lineSamples(c.totalMs));
          for (const v of c.voices) {
            if (!v.schedule.length) continue;
            const vb = E.renderToBuffer({ sampleRate: SR, schedule: v.schedule, totalMs: v.totalMs });
            for (let i = 0; i < Math.min(b.length, vb.length); i++) b[i] += vb[i];
          }
          return b;
        });
        const gap = Math.round(SR * GAP_MS / 1000), n = bufs.reduce((a, b) => a + b.length + gap, 0), all = new Float32Array(n);
        let at = 0; for (const b of bufs) { all.set(b, at); at += b.length + gap; }
        writeFileSync(out, E.encodeWav(all, SR).bytes);
      }
    }
  } catch (e) {
    if (!(e instanceof KlattschWarning)) throw e;
    console.error(e.message); process.exit(2);
  }
}
