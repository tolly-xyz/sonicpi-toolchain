#!/usr/bin/env node
// A rendering worker for fitting tools (tools/voicelab/fricfit.py): each stdin line is a request, answered by one
// stdout line.
//   {"config": {klattsing speak options}, "entries": {CODE: {bank fields}}, "body": "b100 r120 AH r90 S r120 AH", "sr": 48000}
//   -> {"pcm": base64 float32 little-endian at sr, "totalMs", "text"}   or {"error"}
// The string is klattsing's prefix for config (bank chain, directives, voice) followed by body. entries (optional):
// laid over the config's resolved bank entries (each a complete entry: the resolved one's fields, e.g. its
// coarticulation locus, with these over them) in an inline bank "fit--<n>" that extends the config's bank.
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { prefixOf } = await import(join(ROOT, 'klattsing/src/compile.js'));
const { bankName } = await import(join(ROOT, 'klattsing/src/banks.js'));
const E = await import(join(ROOT, 'vendor/klattsch/src/engine/index.js'));
await import(join(ROOT, 'bin/klatt-render.mjs'));

let n = 0;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let reply;
  try {
    const req = JSON.parse(line);
    const cfg = { mode: 'speak', ...(req.config ?? {}) };
    let prefix = prefixOf(cfg);
    if (req.entries && Object.keys(req.entries).length) {
      const base = bankName(cfg) ?? E.banks.defaultName, resolved = E.banks.get(base);
      const phonemes = {};
      for (const [c, f] of Object.entries(req.entries)) phonemes[c] = { ...(resolved.phonemes[c] ?? {}), ...f };
      const name = `fit--${n++ % 64}`;
      E.registerBank({ schemaVersion: 1, name, extends: base, phonemes });
      prefix = prefix.includes('[bank=') ? prefix.replace(/\[bank=[^\]]+\]/, `[bank=${name}]`) : `[bank=${name}] ${prefix}`;
    }
    const text = `${prefix} ${req.body}`;
    const c = E.compileString(text);
    if (c.warnings.length) throw new Error(`klattsch: ${c.warnings.join(', ')}`);
    const sr = req.sr ?? 48000;
    const buf = E.renderToBuffer({ sampleRate: sr, schedule: c.schedule, totalMs: c.totalMs });
    reply = { pcm: Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64'), totalMs: c.totalMs, text };
  } catch (e) { reply = { error: String(e?.message ?? e) }; }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
