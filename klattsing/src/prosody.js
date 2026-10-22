// "prosody" (speak): a pitch-accent intonation model instead of speak's fixed rise on every stressed syllable.
//   "prosody": true                     the defaults below (PROSODY, fitted to Kokoro: tools/voicelab/prosodyfit.py)
//   "prosody": { accent, downstep, ... } fields over PROSODY (null keeps one)
// After Pierrehumbert (1980) and ToBI (Silverman et al. 1992; Beckman & Ayers Elam 1997): the F0 of an
// intonational phrase is a sequence of pitch accents over a declining baseline, ended by a phrase accent and a
// boundary tone; and after Fujisaki's model (Fujisaki & Hirose 1984): log F0 is a phrase component (a baseline with
// a quick rising onset, reset at each sentence) plus smooth, overlapping accent components. All values are in
// semitones re the spec's pitch, times in ms.
//   - accents: the primary-stressed syllable of every content word (not UNACCENTED: function words, two-syllable
//     prepositions and conjunctions, demonstratives, wh-words, reflexives); a phrase without a content word
//     accents its last word; the last accent of a phrase is its nuclear accent. Each accent is a smooth rise-fall
//     (raised-cosine flanks: `rise` ms up to the peak, `fall` ms down from it) peaking at `peak` of the stressed
//     vowel (0 its start, 1 its end; negative: in the onset). A phrase's first accent is `accent` st over the
//     baseline, every later prenuclear one `downstep` times the one before (H* !H* ...: Liberman & Pierrehumbert
//     1984), and the nuclear accent `nuclear` x `accent` whatever comes before it (Kokoro's nuclear accents are not
//     downstepped: fitted that way 4.07 against 4.02 on the train split, by the proxy). Overlapping accents take the
//     higher, so close accents make a plateau, not a dip (the "hat pattern": 't Hart, Collier & Cohen 1990).
//   - baseline: `top` st over the spec's pitch, falling `declination` st per second (Cohen, Collier & 't Hart
//     1982); a phrase starts `initial` st under it, rising to it with time constant `initialMs` (a low initial
//     boundary %L, the rising onset of a Fujisaki phrase component). After a sentence ends (. ! ?) it starts at
//     `top` again; after a comma (, ; : --) it is reset `reset` of the way back up (a partial reset: Ladd 1988),
//     its initial dip scaled alike.
//   - phrase ends: a declarative (. ! or none) is lowered `final` st by its end (L-L%), ramped from the start of
//     its last vowel (finalFrom 0) or of the nuclear vowel (1: the L- phrase accent spreading from the nuclear
//     accent) or in between; a comma phrase is not lowered but ends `continuation` st up over its last vowel (the
//     continuation rise L-H% when positive); a yes/no question (`?`, the sentence not starting with a wh-word) with
//     `question` > 0 takes a low nuclear accent and rises `question` st from the start of the nuclear vowel to its
//     end (L* H-H%); with `question` 0, and a wh-question always, it ends like a statement.
//   - segmental perturbations (microprosody: Lehiste & Peterson 1961; Hombert 1978; Silverman 1986; Kingston &
//     Diehl 1994): a vowel right after a voiceless obstruent (or its aspiration) starts `micro` st higher,
//     decaying with time constant `microMs`; voiced obstruents (B D G V DH Z ZH JH, stops' flap) are `dip` st lower.
//   - effort: true moves speak's effort/tilt accent (accentDelta) from every primary stress to the accented
//     syllables only. Off: spectral balance marks lexical stress, accented or not (Sluijter & van Heuven 1996), and
//     fidelity ties (2.979 / 2.981 on the train split).
// Fitted (prosodyfit.py fit, a proxy of fidelity's F0 metrics read off the schedule): the accents, baseline, final
// lowering and microprosody on the Harvard corpus's train split (80 sentences); continuation and reset on the
// Kokoro phrasing set (tools/voicelab/phrasing.py: 20 sentences with commas and questions; Kokoro ends a comma
// phrase level or slightly falling, does not reset after it, and ends yes/no questions falling, in both voices:
// -3.0 st over the last vowel in am_onyx, -8.0 in am_michael, like its statements -2.9 / -8.8); `top` so the
// rendered median F0 is the spec's pitch (fidelity median_st ~0; the F0 metrics cannot see it).
// Rendering: klattsch moves F0 per phoneme (each phoneme's first event takes it to the `b` value; a vowel with a
// pitch delta "(+x)" then glides to b + x by ~75-85% of it), so the contour is sampled there: a `b` directive
// before each phoneme token, and on vowels a transient delta to the value near the vowel's end. The timing and
// the phonemes are unchanged.
import { FUNCTION_WORDS } from './function_words.js';

export const PROSODY = {
  accent: 3.3, downstep: 0.52, nuclear: 0.58, peak: -0.14, rise: 43, fall: 470,
  top: 2.65, declination: 3.1, initial: 3.6, initialMs: 86, reset: 0,
  final: 3.4, finalFrom: 0, continuation: -0.6, question: 0,
  micro: 1.6, microMs: 50, dip: 1.2, effort: false,
};
const KEYS = Object.keys(PROSODY);
const POSITIVE = ['rise', 'fall', 'initialMs', 'microMs'];

// closed-class words FUNCTION_WORDS leaves out (it lists one-syllable words, for the duration rules): prepositions
// and conjunctions of two syllables, demonstratives, wh-words, reflexive pronouns. Kokoro's lexicon gives these no
// primary stress either ("across", "before", "into", "over", "these", "when", "what", "while", "without").
export const UNACCENTED = new Set([...FUNCTION_WORDS, ...(
  'about above across after against along among around before behind below beneath beside besides between beyond ' +
  'during except inside into onto outside over toward towards under underneath until unto upon within without ' +
  'because although unless whether while whereas this these those what when where why how ' +
  'myself yourself himself herself itself ourselves yourselves themselves').split(' ')]);
const WH = new Set('who whom whose what which when where why how'.split(' '));
// microprosody classes (lexical phonemes; the aspiration token after P/T/K counts as voiceless)
const VOICELESS = new Set('P T K F TH S SH CH HH'.split(' '));
const VOICED_OBSTRUENT = new Set('B D G V DH Z ZH JH'.split(' '));

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
// "prosody": true | {...} -> the full option, or null (off)
export function prosodyOptions(p) {
  if (!p) return null;
  if (p !== true && !isObj(p)) throw new Error(`prosody: true or an object, got ${JSON.stringify(p)}`);
  const x = { ...PROSODY };
  for (const [k, v] of Object.entries(p === true ? {} : p)) {
    if (!KEYS.includes(k)) throw new Error(`prosody.${k}: unknown (${KEYS.join(', ')})`);
    if (v == null) continue;
    if (k === 'effort' ? typeof v !== 'boolean' : !(typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`prosody.${k}: expected ${k === 'effort' ? 'true or false' : 'a number'}, got ${JSON.stringify(v)}`);
    }
    x[k] = v;
  }
  for (const k of POSITIVE) if (!(x[k] > 0)) throw new Error(`prosody.${k}: ms > 0, got ${x[k]}`);
  return x;
}

// words (with syllables and punct) -> { phrases: [{ from, to, kind, sentenceStart }], accents: [{ word, syl,
// phrase, k (index in its phrase), nuclear }], accented: Set of "word:syllable" }; kind "final" | "continuation" |
// "question"; a phrase ends at a word with punctuation (or the last word)
export function accentPlan(ws) {
  const phrases = [];
  let from = 0, sentenceStart = true, firstWord = 0;
  ws.forEach((w, wi) => {
    const last = wi === ws.length - 1;
    if (!w.punct && !last) return;
    const ends = /[.!?]/.test(w.punct) || (!w.punct && last);
    const yesNo = w.punct.includes('?') && !WH.has(ws[firstWord].word);
    phrases.push({ from, to: wi, kind: yesNo ? 'question' : ends ? 'final' : 'continuation', sentenceStart });
    sentenceStart = /[.!?]/.test(w.punct);
    from = wi + 1;
    if (sentenceStart) firstWord = from;
  });
  // a word's accentable syllable: the primary-stressed one (else a secondary, else the first with a vowel), -1 if none
  const stressed = (w) => {
    const rank = (s) => (!s.nucleus ? -1 : s.stress === 1 ? 2 : s.stress === 2 ? 1 : 0);
    let best = -1;
    w.syllables.forEach((s, si) => { if (rank(s) >= 0 && (best < 0 || rank(s) > rank(w.syllables[best]))) best = si; });
    return best;
  };
  const accents = [], accented = new Set();
  phrases.forEach((ph, pi) => {
    const list = [];
    for (let wi = ph.from; wi <= ph.to; wi++) {
      if (UNACCENTED.has(ws[wi].word)) continue;
      const si = stressed(ws[wi]);
      if (si >= 0) list.push({ word: wi, syl: si });
    }
    if (!list.length) {
      for (let wi = ph.to; wi >= ph.from; wi--) { const si = stressed(ws[wi]); if (si >= 0) { list.push({ word: wi, syl: si }); break; } }
    }
    list.forEach((a, k) => {
      accents.push({ ...a, phrase: pi, k, nuclear: k === list.length - 1 });
      accented.add(`${a.word}:${a.syl}`);
    });
  });
  return { phrases, accents, accented };
}

const ramp = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));
const bump = (x, rise, fall) => (x < 0 ? (x > -rise ? 0.5 + 0.5 * Math.cos(Math.PI * x / rise) : 0) : (x < fall ? 0.5 + 0.5 * Math.cos(Math.PI * x / fall) : 0));

// the contour: plan (accentPlan), tokens [{ start, ms, kind: "vowel" | "other", p (lexical phoneme), code (the
// string's), asp, gap (a pause before it), word, syl }] in time order (ms from the start of the utterance) -> t (ms) -> st re the pitch
export function contour(plan, tokens, P) {
  // tune: the phrase's kind, a yes/no question ending like a statement unless P.question rises it
  const ph = plan.phrases.map((x) => ({ ...x, tune: x.kind === 'question' && !P.question ? 'final' : x.kind,
    start: Infinity, end: -Infinity, lastVowel: null, vowels: new Map(), peaks: [] }));
  const phraseOf = (word) => ph.findIndex((x) => word >= x.from && word <= x.to);
  for (const t of tokens) {
    const x = ph[phraseOf(t.word)];
    if (!x) continue;
    x.start = Math.min(x.start, t.start); x.end = Math.max(x.end, t.start + t.ms);
    if (t.kind === 'vowel') { x.lastVowel = t; x.vowels.set(`${t.word}:${t.syl}`, t); }
  }
  // the baseline at each phrase's start: top at a sentence start, else reset part of the way back to it
  let prevEnd = null;
  for (const x of ph) {
    if (x.start === Infinity) continue;
    const r = x.sentenceStart || prevEnd === null ? 1 : P.reset;
    x.b0 = x.sentenceStart || prevEnd === null ? P.top : prevEnd + r * (P.top - prevEnd);
    x.initial = r * P.initial;
    prevEnd = x.b0 - P.declination * (x.end - x.start) / 1000 - x.initial * Math.exp(-(x.end - x.start) / P.initialMs);
  }
  for (const a of plan.accents) {
    const x = ph[a.phrase], v = x.vowels.get(`${a.word}:${a.syl}`);
    if (!v) continue;
    let h = a.nuclear ? P.accent * P.nuclear : P.accent * P.downstep ** a.k;
    if (a.nuclear) {
      x.nucleus = v;
      if (x.tune === 'question') h = 0;              // L*: the rise comes after it
    }
    x.peaks.push({ at: v.start + P.peak * v.ms, h });
  }
  // segmental perturbations: [from, to, st, decay ms or 0]
  const seg = [];
  const flap = (t) => t.code === 'DQF';                // stops' flap (T or D): voiced
  tokens.forEach((t, i) => {
    if ((VOICED_OBSTRUENT.has(t.p) || flap(t)) && !t.asp && P.dip) seg.push([t.start, t.start + t.ms, -P.dip, 0]);
    const prev = tokens[i - 1];
    if (t.kind === 'vowel' && P.micro && prev && !t.gap && ((VOICELESS.has(prev.p) && !flap(prev)) || prev.asp)) {
      seg.push([t.start, t.start + t.ms, P.micro, P.microMs]);
    }
  });
  const live = ph.filter((x) => x.start !== Infinity);
  return (t) => {
    if (!live.length) return P.top;
    let j = 0;
    while (j + 1 < live.length && t >= live[j + 1].start) j++;
    const x = live[j], dt = Math.max(0, t - x.start);
    let f = x.b0 - P.declination * dt / 1000 - x.initial * Math.exp(-dt / P.initialMs), a = 0;
    for (const p of x.peaks) a = Math.max(a, p.h * bump(t - p.at, P.rise, P.fall));
    f += a;
    const lv = x.lastVowel, nv = x.nucleus ?? lv, span = (from) => ramp((t - from) / Math.max(1, x.end - from));
    if (lv) {
      if (x.tune === 'final') f -= P.final * span(lv.start + P.finalFrom * (Math.min(nv.start, lv.start) - lv.start));
      else if (x.tune === 'continuation') f += P.continuation * span(lv.start);
      else f += P.question * span(nv.start);
    }
    for (const [s, e, st, tau] of seg) if (t >= s && t < e) f += tau ? st * Math.exp(-(t - s) / tau) : st;
    return f;
  };
}

// where klattsch's F0 reaches a phoneme's values: a vowel takes its start value over its first ~20-25 ms and holds
// it to 25% of the vowel, then glides to its end value by 75% (a vowel with a glideTo, most of them) or 85% (the
// others) and holds it; a consonant takes its one value over its first transition (min(35 ms, 40%)). So a vowel's
// contour is sampled at 10% and 85% of it (the proxy: train 3.74 against 3.70 at 25% / 80%), a consonant's where
// its transition ends.
const AT_START = 0.1, AT_END = 0.85;
const f1 = (x) => Math.round(x * 10) / 10;
// the speak string with the contour: tokens [{ at, len, start, ms, kind, p, code, asp, gap, word, syl }] locate each
// phoneme token ("r<ms> CODE", len chars at index at) in out; base: the spec's pitch in Hz
export function intonate(out, tokens, plan, P, base) {
  const f = contour(plan, tokens, P), hzAt = (t) => f1(base * 2 ** (f(t) / 12));
  let s = '', k = 0, cur = null;
  for (const x of tokens) {
    const a = x.kind === 'vowel' ? hzAt(x.start + AT_START * x.ms) : hzAt(x.start + Math.min(35, 0.4 * x.ms));
    const d = x.kind === 'vowel' ? f1(hzAt(x.start + AT_END * x.ms) - a) : 0;
    s += out.slice(k, x.at) + (a !== cur ? `b${a} ` : '') + out.slice(x.at, x.at + x.len) + (d ? `(${d > 0 ? '+' : ''}${d})` : '');
    cur = a; k = x.at + x.len;
  }
  return s + out.slice(k);
}
