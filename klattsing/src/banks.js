// Phoneme banks given in a spec rather than a file, so an optimizer can vary phoneme parameters
// without writing banks/*.json:
//   "bank": "silt-stops"                                   a registered bank (banks/*.json or bundled), as before
//   "bank": { schemaVersion: 1, name, extends, phonemes }  an inline bank, registered under its name
//   "bankPatch": { CODE: { field: value } }                fields changed on top of "bank" (default klatt1980-en),
//                                                          as a generated bank "<base>--<hash>" that extends it
//   "aspiration": "breath"                                 adds BR<vowel> entries, a bank "<base>--br<hash>" (below)
//   "coarticulation": true | {...}                         adds klattsch's coarticulation fields (vowel, locus,
//                                                          locusBurst, transparent): a bank "<base>--co<hash>"
//   "stops": true | {...}                                  context-dependent stop entries, "<base>--st<hash>" (stops.js)
// klattsch layers banks by whole phoneme entries, so a patched entry is the base's resolved entry with the
// patch's fields merged in (a field set to null is removed; an object value, e.g. glideTo, is merged one level).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banks, registerBank } from '../../vendor/klattsch/src/engine/banks/index.js';
import { VOWELS } from './phones.js';
import { coartOptions, coartFields } from './coarticulation.js';
import { stopOptions, stopsBank } from './stops.js';

const BANK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'banks');

// JSON with sorted keys, so equal content always hashes the same
export function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// Make sure a bank name resolves: registered already, or banks/<name>.json (any banks/*.json with that
// name), with whatever it extends.
export function ensureBank(name, seen = new Set()) {
  if (banks.list().includes(name)) return;
  if (seen.has(name)) throw new Error(`bank extends cycle: ${[...seen, name].join(' -> ')}`);
  let bank = null;
  const file = join(BANK_DIR, `${name}.json`);
  if (existsSync(file)) bank = JSON.parse(readFileSync(file, 'utf8'));
  if (bank?.name !== name) {
    bank = null;
    for (const f of existsSync(BANK_DIR) ? readdirSync(BANK_DIR).filter((f) => f.endsWith('.json')) : []) {
      const b = JSON.parse(readFileSync(join(BANK_DIR, f), 'utf8'));
      if (b.name === name) { bank = b; break; }
    }
  }
  if (!bank) throw new Error(`unknown bank: ${name}`);
  if (bank.extends) ensureBank(bank.extends, new Set([...seen, name]));
  registerBank(bank);
}

// one phoneme entry with a patch's fields merged in
function patchEntry(entry, patch) {
  if (patch === null) return null;
  const out = { ...(entry ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

// The fields every klattsch phoneme entry carries: a patch that adds a phoneme the base lacks must give them all
// (a partial entry renders NaN formants instead of klattsch's "unknown phoneme" warning)
export const ENTRY_FIELDS = ['voicing', 'F1', 'F2', 'F3', 'BW1', 'BW2', 'BW3', 'A1', 'A2', 'A3'];

// The bank {name, extends, phonemes} that applies `patch` to the bank named `base` (resolved now).
export function patchedBank(base, patch) {
  ensureBank(base);
  const resolved = banks.get(base);
  if (!resolved) throw new Error(`unknown bank: ${base}`);
  const phonemes = {};
  for (const [code, p] of Object.entries(patch)) {
    const entry = resolved.phonemes[code], out = patchEntry(entry, p);
    const missing = !entry && out ? ENTRY_FIELDS.filter((k) => typeof out[k] !== 'number') : [];
    if (missing.length) throw new Error(`bankPatch.${code}: bank ${base} has no ${code}, and the patch lacks ${missing.join(', ')}`);
    phonemes[code] = out;
  }
  const name = `${base}--${hash(canonical({ extends: base, phonemes }))}`;
  return { schemaVersion: 1, name, extends: base, phonemes };
}

// aspiration: "breath" breathes into a vowel through BR<vowel> (BRIH, BRAA, ...): the vowel's entry without its
// glideTo, so the breath holds the vowel's onset formants instead of running the whole glide in 25 ms
// (voicing: breathVoicing when given). Generated per bank, extending it.
export const BREATH_PREFIX = 'BR';
export function breathBank(base, voicing) {
  ensureBank(base);
  const resolved = banks.get(base);
  if (!resolved) throw new Error(`unknown bank: ${base}`);
  const phonemes = {};
  for (const [code, e] of Object.entries(resolved.phonemes)) {
    if (!e || !VOWELS.has(code)) continue;
    const { glideTo, ...steady } = e;
    phonemes[BREATH_PREFIX + code] = voicing === undefined ? steady : { ...steady, voicing };
  }
  return { schemaVersion: 1, name: `${base}--br${hash(canonical({ extends: base, phonemes }))}`, extends: base, phonemes };
}

// coarticulation (src/coarticulation.js): the base's entries with the fields klattsch's [CO=x] reads merged in
export function coartBank(base, c) {
  ensureBank(base);
  const resolved = banks.get(base);
  if (!resolved) throw new Error(`unknown bank: ${base}`);
  const phonemes = {};
  for (const [code, f] of Object.entries(coartFields(coartOptions(c), (p) => !!resolved.phonemes[p]))) phonemes[code] = { ...resolved.phonemes[code], ...f };
  return { schemaVersion: 1, name: `${base}--co${hash(canonical({ extends: base, phonemes }))}`, extends: base, phonemes };
}

// spec -> the bank name to select with [bank=NAME] (undefined: klattsch's default), registering inline and
// generated banks in this process. A plain string bank without a patch is passed through untouched, as before.
// banksFor(spec) lists the banks a spec's string needs that are not files (inline, bankPatch, coarticulation, breath), parents
// first, for a renderer in another process: a --print string naming one renders only where it is registered.
export const bankName = (o) => chain(o).name;
export const banksFor = (o) => chain(o).banks;

function chain(o) {
  let name = o.bank;
  const out = [];
  if (name && typeof name === 'object') {
    if (!name.name) throw new Error('inline bank needs a name');
    // klattsch's [bank=NAME] token takes only these characters; any other name never selects the bank
    if (!/^[A-Za-z0-9_.-]+$/.test(name.name)) throw new Error(`inline bank name ${JSON.stringify(name.name)}: use only A-Z a-z 0-9 _ . -`);
    if (name.extends) ensureBank(name.extends);
    registerBank(name);              // always (re)registered: the same name may carry new content
    out.push(name);
    name = name.name;
  }
  // generated banks are content-addressed: a name already registered is the same bank
  const add = (b) => { if (!banks.list().includes(b.name)) registerBank(b); out.push(b); name = b.name; };
  if (o.bankPatch && Object.keys(o.bankPatch).length) add(patchedBank(name || banks.defaultName, o.bankPatch));
  if (o.coarticulation) add(coartBank(name || banks.defaultName, o.coarticulation));
  if (o.aspiration === 'breath') add(breathBank(name || banks.defaultName, o.breathVoicing));
  if (o.stops) { const base = name || banks.defaultName; ensureBank(base); add(stopsBank(base, stopOptions(o.stops), canonical)); }
  return { name, banks: out };
}
