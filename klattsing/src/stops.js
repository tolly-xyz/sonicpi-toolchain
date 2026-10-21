// Realistic stop consonants (the opt-in "stops" option). klattsch renders a stop as silence plus one fixed burst
// (the bank entry), and klattsing adds the aspiration after P/T/K as an HH segment with fixed formants. With
// "stops", each stop gets a bank entry chosen by its context, from a generated bank "<base>--st<hash>" that extends
// the spec's bank (content-addressed like bankPatch's):
//   voiceBar   B D G after a voiced sound (no pause between): low-frequency voicing through the closure
//              (klattsch patch: a stop entry's `closure`), fading as the oral pressure builds up
//              (Lisker & Abramson 1964: English voiced stops are voiced through the closure intervocalically
//              but not after a pause; Westbury & Keating 1986: the voicing decays through the closure)
//   voicingTail P T K after a voiced sound: the voicing of the vowel dies away over the closure's start (A1 of
//              a fading voice-bar-like closure; 0 = silent closure)
//   burst      the release burst's spectrum by place and the vowel it is released into (Stevens & Blumstein
//              1978): labial diffuse-falling (energy below the vowel's F2), alveolar diffuse-rising (a high
//              F2 locus near 1.8 kHz and a strong 3.5-4 kHz peak, lower before rounded vowels), velar compact (a
//              single mid-frequency peak tied to the vowel: between F2 and F3 of a front vowel, just above F2 of
//              a back one); a number blends the bank's burst (0) into these (1); {P, B, T, D, K, G}: per stop
//   burstGain / aspirationGain  scale the burst / aspiration amplitudes (1)
//   aspiration the aspiration after P/T/K (VOT) is noise through the following vowel's formants with F1 cut
//              back and widened (Klatt 1975, 1980: aspiration excites the vocal tract of the vowel; the open
//              glottis damps F1), as HQ<vowel> entries, instead of HH; a number blends HH (0) into these (1)
//   vot        place-dependent VOT: true scales the aspiration (rules.aspirationMs) by Klatt's (1975) P 47 /
//              T 65 / K 70 ms (relative to their mean), {P, T, K}: ms
//   flap       T/D between a vowel (or R) and an unstressed vowel inside a word ("water", "city", "party") is
//              a flap DQF: voiced, a brief dip (Zue & Laferriere 1979), at most flapMs ms (0: the rule duration;
//              real flaps last ~20-30 ms)
//   unreleased a stop before another consonant (no pause between, not released into its own onset: "play" keeps
//              its burst) has no burst (klattsch patch: release: false): "that time", "napkin", "cats"
//              (Crystal & House 1988, Byrd 1993: unreleased stops are the norm before consonants in American
//              English); "closure": only before a consonant with an oral closure (a stop, an affricate, a nasal)
// Codes: <stop>Q<closure><release>, closure "" (silent), "V" (voice bar) or "T" (voicing tail), release a vowel
// (released into it), "X" (released, no vowel context) or "U" (unreleased); HQ<vowel>; DQF. The timeline names
// them by their lexical phoneme (p).
import { createHash } from 'node:crypto';
import { banks } from '../../vendor/klattsch/src/engine/banks/index.js';
import { VOWELS, STOPS, VOICED, LIQUIDS, GLIDES, NASALS, AFFRICATES } from './phones.js';

// "stops": true = these (each chosen with tools/voicelab/fidelity.py against Kokoro; see VENDORED / README)
export const STOP_DEFAULTS = {
  voiceBar: { F1: 180, BW1: 60, A1: 0.07, inMs: 20, fade: 0.35 },   // ~8-10 dB under the vowel's low band, fading ~9 dB
  voicingTail: 0,
  burst: 1,
  burstGain: 1,
  aspiration: 1,
  aspirationGain: 1,
  vot: false,
  votTotal: false,
  flap: true,
  flapMs: 0,
  flapLocus: false,
  unreleased: 'consonant',
  burstLocus: true,
  burstFit: false,
};
export const VOT_KLATT1975 = { P: 47, T: 65, K: 70 };
export const MIN_CLOSURE_MS = 20;
const PLACE = { P: 'lab', B: 'lab', T: 'alv', D: 'alv', K: 'vel', G: 'vel' };
const VOICELESS = new Set(['P', 'T', 'K']);
const ROUNDED = new Set('UW UH OW OY AO ER'.split(' '));
const FRONT = (v) => v.F2 >= 1500;

// "stops": true | { ...STOP_DEFAULTS fields } -> the full options (voiceBar: true/false/object)
export function stopOptions(x) {
  if (!x) return null;
  const o = { ...STOP_DEFAULTS, ...(x === true ? {} : Object.fromEntries(Object.entries(x).filter(([, v]) => v != null))) };
  if (o.voiceBar === true) o.voiceBar = STOP_DEFAULTS.voiceBar;
  else if (o.voiceBar && typeof o.voiceBar === 'object') o.voiceBar = { ...STOP_DEFAULTS.voiceBar, ...o.voiceBar };
  const unit = (v, k) => { const n = v === true ? 1 : Number(v || 0); if (!(n >= 0 && n <= 1)) throw new Error(`stops.${k}: expected 0..1, got ${JSON.stringify(v)}`); return n; };
  const b = o.burst && typeof o.burst === 'object' ? o.burst : null;
  o.burst = Object.fromEntries(['P', 'B', 'T', 'D', 'K', 'G'].map((c) => [c, unit(b ? b[c] : o.burst, `burst${b ? `.${c}` : ''}`)]));
  o.aspiration = unit(o.aspiration, 'aspiration');
  o.voicingTail = Number(o.voicingTail || 0);
  for (const k of ['burstGain', 'aspirationGain']) if (!(typeof o[k] === 'number' && o[k] >= 0)) throw new Error(`stops.${k}: expected a number >= 0, got ${JSON.stringify(o[k])}`);
  const ur = o.unreleased && typeof o.unreleased === 'object' ? o.unreleased : null;
  o.unreleased = Object.fromEntries(['P', 'B', 'T', 'D', 'K', 'G'].map((c) => {
    let v = ur ? ur[c] ?? false : o.unreleased;
    if (v === true) v = 'consonant';
    if (![false, 'consonant', 'closure'].includes(v)) throw new Error(`stops.unreleased${ur ? `.${c}` : ''}: "consonant", "closure" or false, got ${JSON.stringify(v)}`);
    return [c, v];
  }));
  if (![true, false, 'words'].includes(o.flap)) throw new Error(`stops.flap: true, false or "words", got ${JSON.stringify(o.flap)}`);
  for (const k of ['burstLocus', 'flapLocus', 'votTotal']) o[k] = !!o[k];
  // burstFit: true (every stop), false, or a list of stops
  const bf = o.burstFit;
  if (!(typeof bf === 'boolean' || (Array.isArray(bf) && bf.every((c) => PLACE[c])))) throw new Error(`stops.burstFit: true, false or a list of P B T D K G, got ${JSON.stringify(bf)}`);
  o.burstFit = Object.fromEntries(['P', 'B', 'T', 'D', 'K', 'G'].map((c) => [c, bf === true || (Array.isArray(bf) && bf.includes(c))]));
  return o;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const mix = (a, b, k) => (a === undefined ? b : b === undefined ? a : a + (b - a) * k);

// The bursts' BW2, BW3 and A2, A3 by stop and the vowel's class (front: F2 >= 1500 Hz at its onset), fitted to
// Kokoro's bursts (tools/voicelab/burstfit.py --pooled on stopscope.py rows of the BASE + stops config, bands
// 1.3-10 kHz; below, Kokoro's 11 ms window after the release already holds voicing): klattsch's were 5-15 dB weak
// at 1.3-3 and 4.5-10 kHz (the glottal noise low-pass, and narrow F2/F3 leave a dip between them). The formant
// frequencies stay the templates'; velars fit to one compact peak (A3 0), alveolars to a broad one.
export const BURST_FIT = {
  P: { BW2: 909, BW3: 1543, front: { A2: 0.133, A3: 0.389 }, back: { A2: 0.298, A3: 0.213 } },
  B: { BW2: 125, BW3: 432, front: { A2: 0.903, A3: 0.673 }, back: { A2: 1.69, A3: 0.37 } },
  T: { BW2: 2000, BW3: 2000, front: { A2: 0.16, A3: 0.117 }, back: { A2: 0.199, A3: 0.324 } },
  D: { BW2: 788, BW3: 1389, front: { A2: 0.149, A3: 0.253 }, back: { A2: 0.12, A3: 0.412 } },
  K: { BW2: 470, BW3: 1000, front: { A2: 1.292, A3: 0 }, back: { A2: 1.31, A3: 0 } },
  G: { BW2: 282, BW3: 284, front: { A2: 1.871, A3: 0 }, back: { A2: 1.033, A3: 0.198 } },
};

// the burst template for stop entry e (bank) released into vowel entry v (its onset formants); fit: BURST_FIT's
// bandwidths and amplitudes over the rules'
export function burstTemplate(code, e, v, fit = false) {
  const t = burstRules(code, e, v);
  const f = fit && BURST_FIT[code];
  return f ? { ...t, BW2: f.BW2, BW3: f.BW3, ...f[FRONT(v) ? 'front' : 'back'] } : t;
}
function burstRules(code, e, v) {
  const tot = (e.A2 ?? 0) + (e.A3 ?? 0);
  const voiced = !VOICELESS.has(code);
  switch (PLACE[code]) {
    case 'lab':    // diffuse-falling: energy at and below the vowel's F2, a weak F3
      return { F1: e.F1, BW1: e.BW1, A1: voiced ? e.A1 : Math.max(e.A1, 0.2), F2: 0.6 * v.F2 + 350, BW2: 200, A2: 0.6 * tot,
               F3: Math.min(e.F3, v.F3), BW3: 300, A3: 0.3 * tot };
    case 'alv':    // diffuse-rising: F2 locus ~1.8 kHz, strong high peak (lower before rounded vowels)
      return { F1: e.F1, BW1: e.BW1, A1: e.A1, F2: 0.25 * v.F2 + 1300, BW2: Math.max(e.BW2, 150), A2: 0.4 * tot,
               F3: e.F3 - (v.rounded ? 400 : 0), BW3: Math.max(e.BW3, 400), A3: 0.6 * tot };
    default: {     // compact: one mid-frequency peak tied to the vowel
      const peak = FRONT(v) ? (v.F2 + v.F3) / 2 : v.F2 + 300;
      return { F1: e.F1, BW1: e.BW1, A1: e.A1, F2: peak, BW2: 200, A2: 0.65 * tot,
               F3: FRONT(v) ? v.F3 + 200 : v.F3, BW3: Math.max(e.BW3, 250), A3: 0.35 * tot };
    }
  }
}
const KEYS = ['F1', 'BW1', 'A1', 'F2', 'BW2', 'A2', 'F3', 'BW3', 'A3'];
function blend(e, t, k) {
  const out = { ...e };
  for (const f of KEYS) if (t[f] !== undefined) out[f] = mix(e[f], t[f], k);
  return out;
}
// a vowel's onset formants are its entry's F1-F3 (glideTo is where it ends)
const vowelOnset = (v, code) => ({ ...v, rounded: ROUNDED.has(code) });

// aspiration into vowel entry v: noise through the vowel's formants, F1 cut back and widened (blend k from HH)
function aspirationEntry(hh, v, k) {
  const t = { voicing: 0, F1: v.F1, BW1: v.BW1 + 200, A1: hh.A1 * 0.4, F2: v.F2, BW2: Math.max(v.BW2, 100) * 1.5, A2: hh.A2,
              F3: v.F3, BW3: Math.max(v.BW3, 150) * 1.5, A3: hh.A3 };
  const out = blend({ ...hh }, t, k);
  out.voicing = hh.voicing;
  return out;
}

const aspirates = (o) => o.aspiration > 0 || o.aspirationGain !== 1;
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const cache = new Map();
// The generated bank for base bank `base` (registered) and options o (stopOptions): every stop x closure x
// release variant, HQ<vowel>, DQF. canonical: banks.js's canonical JSON (passed in to avoid an import cycle).
export function stopsBank(base, o, canonical) {
  const resolved = banks.get(base);
  if (!resolved) throw new Error(`unknown bank: ${base}`);
  const key = `${base}\n${canonical(o)}\n${canonical(resolved.phonemes)}`;
  if (cache.has(key)) return cache.get(key);
  const P = resolved.phonemes, phonemes = {};
  const vowels = Object.keys(P).filter((c) => VOWELS.has(c) && P[c]);
  for (const s of ['P', 'B', 'T', 'D', 'K', 'G']) {
    const e = P[s];
    if (!e || !e.isStop) continue;
    const closures = [''];
    if (o.voiceBar && !VOICELESS.has(s)) closures.push('V');
    if (o.voicingTail > 0 && VOICELESS.has(s)) closures.push('T');
    for (const c of closures) {
      const closure = c === 'V' ? { voicing: 1, F1: o.voiceBar.F1, BW1: o.voiceBar.BW1, A1: o.voiceBar.A1, A2: 0, A3: 0, inMs: o.voiceBar.inMs, fade: o.voiceBar.fade }
        : c === 'T' ? { voicing: 1, F1: 200, BW1: 80, A1: o.voicingTail, A2: 0, A3: 0, inMs: 15, fade: 0 } : null;
      const withClosure = (x) => (closure ? { ...x, closure } : x);
      const gain = (x) => (o.burstGain === 1 ? x : { ...x, A1: x.A1 * o.burstGain, A2: x.A2 * o.burstGain, A3: x.A3 * o.burstGain });
      phonemes[`${s}Q${c}X`] = withClosure(gain({ ...e }));
      phonemes[`${s}Q${c}U`] = withClosure({ ...e, release: false });
      // burstLocus false: the template's formants, not coarticulation's velar locus burst (locusBurst), under [CO]
      const own = (x) => { if (!o.burstLocus) delete x.locusBurst; return x; };
      if (o.burst[s] > 0) for (const v of vowels) phonemes[`${s}Q${c}${v}`] = withClosure(own(gain(blend(e, burstTemplate(s, e, vowelOnset(P[v], v), o.burstFit[s]), o.burst[s]))));
    }
  }
  const hh = P.HH;
  if (aspirates(o) && hh) {
    for (const v of vowels) {
      const a = aspirationEntry(hh, P[v], o.aspiration), g = o.aspirationGain;
      phonemes[`HQ${v}`] = g === 1 ? a : { ...a, A1: a.A1 * g, A2: a.A2 * g, A3: a.A3 * g };
    }
  }
  // a flap: voiced, F1 down, F2 near the alveolar locus, weaker (a ~25 ms dip between the vowels)
  phonemes.DQF = { voicing: 1, F1: 300, BW1: 90, A1: 0.55, F2: 1700, BW2: 150, A2: 0.3, F3: 2600, BW3: 250, A3: 0.2 };
  // flapLocus: under coarticulation the vowels around it move toward D's locus, as around a D
  if (o.flapLocus && P.D?.locus) Object.assign(phonemes.DQF, { locus: P.D.locus, ...(P.D.locusVC ? { locusVC: P.D.locusVC } : {}) });
  for (const x of Object.values(phonemes)) for (const f of KEYS) if (typeof x[f] === 'number') x[f] = r3(x[f]);
  const bank = { schemaVersion: 1, name: `${base}--st${hash(canonical({ extends: base, phonemes }))}`, extends: base, phonemes };
  cache.set(key, bank);
  return bank;
}

// Context per stop, on klattsing's syllabified words (after the duration rules): sets s.onsetCode / s.codaCode
// (the entry per consonant, undefined = the plain phoneme), s.aspCode (HQ<vowel>), and changes s.aspMs (vot) and
// the flap's duration. A pause (a word with punctuation) breaks the context.
export function planStops(ws, o) {
  const flat = [];
  ws.forEach((w, wi) => w.syllables.forEach((s, si) => {
    s.onset.forEach((p, i) => flat.push({ p, wi, si, s, part: 'onset', i }));
    if (s.nucleus) flat.push({ p: s.nucleus, wi, si, s, part: 'nucleus' });
    s.coda.forEach((p, i) => flat.push({ p, wi, si, s, part: 'coda', i }));
  }));
  const pauseBetween = (a, b) => a.wi !== b.wi && ws[a.wi].punct !== '';
  flat.forEach((x, k) => {
    if (!STOPS.has(x.p)) return;
    const prevX = k > 0 && !pauseBetween(flat[k - 1], x) ? flat[k - 1] : null;
    const nextX = k + 1 < flat.length && !pauseBetween(x, flat[k + 1]) ? flat[k + 1] : null;
    const prev = prevX?.p, next = nextX?.p;
    const s = x.s;
    const set = (code) => { const f = x.part === 'onset' ? 'onsetCode' : 'codaCode'; (s[f] ??= [])[x.i] = code; };
    // flap: word-internal T/D, the whole onset of an unstressed syllable, after a vowel or R; "words" also a
    // word-final T/D after a vowel or R before a vowel-initial word ("get it", "a lot of")
    const flapV = (q) => VOWELS.has(q) || q === 'R';
    const inWord = x.part === 'onset' && x.si > 0 && s.onset.length === 1 && s.nucleus && s.stress === 0 && prevX && prevX.wi === x.wi;
    const acrossWords = o.flap === 'words' && x.part === 'coda' && x.i === s.coda.length - 1 && x.si === ws[x.wi].syllables.length - 1
      && nextX && nextX.wi === x.wi + 1 && VOWELS.has(next) && prevX && prevX.s === s;
    if (o.flap && (x.p === 'T' || x.p === 'D') && (inWord || acrossWords) && flapV(prev)) {
      set('DQF');
      if (o.flapMs) { const f = x.part === 'onset' ? s.onsetMs : s.codaMs; f[x.i] = Math.min(f[x.i], o.flapMs); }
      return;
    }
    const sameOnset = nextX && x.part === 'onset' && nextX.s === s && nextX.part === 'onset';
    const ur = o.unreleased[x.p];
    const unrel = ur && next && !sameOnset && !VOWELS.has(next)
      && (ur === 'consonant' || STOPS.has(next) || AFFRICATES.has(next) || NASALS.has(next));
    let rel = 'X';
    if (unrel) rel = 'U';
    else if (o.burst[x.p] > 0 && next) {
      if (VOWELS.has(next)) rel = next;
      else if (sameOnset && (LIQUIDS.has(next) || GLIDES.has(next)) && s.nucleus) rel = s.nucleus;
    }
    const voicedCtx = prev !== undefined && VOICED.has(prev);
    const clo = !voicedCtx ? '' : !VOICELESS.has(x.p) ? (o.voiceBar ? 'V' : '') : (o.voicingTail > 0 ? 'T' : '');
    if (clo || rel !== 'X' || o.burstGain !== 1) set(`${x.p}Q${clo}${rel}`);
  });
  for (const w of ws) for (const s of w.syllables) {
    if (!s.aspMs || !s.nucleus) continue;
    const i = s.onset.length - 1, stop = s.onset[i], a0 = s.aspMs;
    if (o.vot) s.aspMs = o.vot === true ? s.aspMs * VOT_KLATT1975[stop] / ((47 + 65 + 70) / 3) : (o.vot[stop] ?? s.aspMs);
    // votTotal: the stop keeps its total (closure + aspiration): the closure gives what the aspiration gains (it
    // keeps at least MIN_CLOSURE_MS)
    if (o.votTotal && s.aspMs !== a0) s.onsetMs[i] = Math.max(s.onsetMs[i] - (s.aspMs - a0), Math.min(s.onsetMs[i], MIN_CLOSURE_MS));
    if (aspirates(o)) s.aspCode = `HQ${s.nucleus}`;
  }
  return ws;
}

// sing: a rest next to a stop that planStops saw in context (rests come from the notes, after the durations):
// after a rest, no voice bar or voicing tail; before one, released without a vowel context
// (a flap DQF next to a rest is its lexical stop, p)
const CODE = /^([PBTDKG])Q([VT]?)(.*)$/;
export const afterSilence = (c, p) => { if (c === 'DQF') return c; const m = c.match(CODE); return m ? `${m[1]}Q${m[3]}` : c; };
export const beforeSilence = (c, p) => { if (c === 'DQF') return p ?? c; const m = c.match(CODE); return m ? `${m[1]}Q${m[2]}X` : c; };
