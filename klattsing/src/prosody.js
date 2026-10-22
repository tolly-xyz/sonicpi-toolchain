// "prosody" (speak): a pitch-accent intonation model instead of speak's fixed rise on every stressed syllable.
//   "prosody": true                     the defaults below (PROSODY, fitted to the Kokoro corpus)
//   "prosody": { accent, downstep, ... } fields over PROSODY (null keeps one)
// After Pierrehumbert (1980) and ToBI (Silverman et al. 1992; Beckman & Ayers Elam 1997): the F0 of an
// intonational phrase is a sequence of pitch accents on a declining baseline, ended by a phrase accent and a
// boundary tone; and after Fujisaki's model (Fujisaki & Hirose 1984): the log F0 contour is a phrase component
// (here: the baseline, declining in time and reset at each phrase) plus smooth accent components.
//   - accents: the primary-stressed syllable of every content word (not FUNCTION_WORDS, not UNACCENTED); a
//     phrase without a content word accents its last word. Each accent is a smooth rise-fall (raised-cosine
//     flanks, `rise` ms up to the peak, `fall` ms down from it) peaking at `peak` of the stressed vowel (0 its
//     start, 1 its end), `accent` semitones over the baseline for a phrase's first accent; every later accent is
//     `downstep` times the one before (H* !H* ...: Liberman & Pierrehumbert 1984), the nuclear (last) one `nuclear`
//     times that again. Overlapping accents take the higher, so close accents make a plateau (no dip).
//   - baseline: starts `top` semitones over the spec's pitch and falls `declination` semitones per second
//     (Cohen, Collier & 't Hart 1982); after a sentence ends (. ! ?) it starts at `top` again, after a comma
//     (; : and the rest) it is reset by `reset` of the way back up (partial reset: Ladd 1988).
//   - phrase ends: a declarative (. ! or no mark) falls `final` semitones over its last vowel and coda (L-L%);
//     a comma phrase rises `continuation` (L-H%, the continuation rise); a yes/no question ends in a rise of
//     `question` from the start of its nuclear vowel (L* H-H%: its nuclear accent stays low); a question
//     starting with a wh-word falls like a declarative.
//   - effort: true moves speak's effort/tilt accent (accentDelta) from every primary stress to the accented
//     syllables only.
// Rendering: klattsch moves F0 per phoneme (a phoneme's start value, reached over its first transition, and with
// a pitch delta its end value, reached by ~80% of it), so the contour is sampled at those points: a `b` directive
// before each phoneme, and on vowels a transient delta "(+x)" to the value at 80% of the vowel. The timing and the
// phonemes are unchanged.
import { FUNCTION_WORDS } from './function_words.js';

export const PROSODY = {
  accent: 3, downstep: 0.7, nuclear: 1, peak: 0.5, rise: 150, fall: 200,
  top: 2, declination: 3, reset: 0.6, final: 3, continuation: 3, question: 6, effort: true,
};
const NUM = ['accent', 'downstep', 'nuclear', 'peak', 'rise', 'fall', 'top', 'declination', 'reset', 'final', 'continuation', 'question'];
const KEYS = [...NUM, 'effort'];

// closed-class words FUNCTION_WORDS leaves out (it lists one-syllable words, for the duration rules): prepositions
// and conjunctions of two syllables, demonstratives, wh-words, reflexive pronouns. Kokoro's lexicon gives these no
// primary stress either ("across", "before", "into", "over", "these", "when", "what", "while", "without").
export const UNACCENTED = new Set([...FUNCTION_WORDS, ...(
  'about above across after against along among around before behind below beneath beside besides between beyond ' +
  'during except inside into onto outside over toward towards under underneath until unto upon within without ' +
  'because although unless whether while whereas this these those what when where why how ' +
  'myself yourself himself herself itself ourselves yourselves themselves').split(' ')]);
const WH = new Set('who whom whose what which when where why how'.split(' '));

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
  for (const k of ['rise', 'fall']) if (x[k] <= 0) throw new Error(`prosody.${k}: ms > 0`);
  return x;
}

// words (with syllables and punct) -> { accented: Set of "word:syllable", phrases: [{ from, to, kind, sentenceStart }],
// accents: [{ word, syl, phrase, k (index in its phrase), nuclear }] }; kind: "final" | "continuation" | "question"
export function accentPlan(ws) {
  const phrases = [];
  let from = 0, sentenceStart = true, firstWord = 0;
  ws.forEach((w, wi) => {
    const last = wi === ws.length - 1;
    if (!w.punct && !last) return;
    const yesNo = w.punct.includes('?') && !WH.has(ws[firstWord].word);
    const kind = /[.!]/.test(w.punct) || (!w.punct && last) || (w.punct.includes('?') && !yesNo) ? 'final' : yesNo ? 'question' : 'continuation';
    phrases.push({ from, to: wi, kind, sentenceStart });
    sentenceStart = /[.!?]/.test(w.punct);
    from = wi + 1;
    if (sentenceStart) firstWord = from;
  });
  const accents = [], accented = new Set();
  phrases.forEach((ph, pi) => {
    const list = [];
    // the primary-stressed syllable (else a secondary, else the first with a vowel), -1 if none
    const stressed = (w) => {
      const rank = (s) => (!s.nucleus ? -1 : s.stress === 1 ? 2 : s.stress === 2 ? 1 : 0);
      let best = -1;
      w.syllables.forEach((s, si) => { if (rank(s) >= 0 && (best < 0 || rank(s) > rank(w.syllables[best]))) best = si; });
      return best;
    };
    for (let wi = ph.from; wi <= ph.to; wi++) {
      const w = ws[wi];
      if (UNACCENTED.has(w.word)) continue;
      const si = stressed(w);
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

// the contour: plan (accentPlan), tokens [{ start, ms, kind: "vowel" | "other", word, syl }] in time order (ms
// from the start of the utterance) -> t (ms) -> semitones re the spec's pitch
export function contour(plan, tokens, P) {
  const ph = plan.phrases.map((x) => ({ ...x, start: Infinity, end: -Infinity, lastVowel: null, vowels: new Map() }));
  const phraseOf = (word) => ph.findIndex((x) => word >= x.from && word <= x.to);
  for (const t of tokens) {
    const x = ph[phraseOf(t.word)];
    if (!x) continue;
    x.start = Math.min(x.start, t.start); x.end = Math.max(x.end, t.start + t.ms);
    if (t.kind === 'vowel') { x.lastVowel = t; x.vowels.set(`${t.word}:${t.syl}`, t); }
  }
  // baseline at each phrase's start: top after a sentence start, else reset part of the way back to top
  let prevEnd = null;
  for (const x of ph) {
    if (x.start === Infinity) { x.b0 = P.top; continue; }
    x.b0 = x.sentenceStart || prevEnd === null ? P.top : prevEnd + P.reset * (P.top - prevEnd);
    prevEnd = x.b0 - P.declination * (x.end - x.start) / 1000;
    x.peaks = [];
  }
  for (const a of plan.accents) {
    const x = ph[a.phrase], v = x.vowels?.get(`${a.word}:${a.syl}`);
    if (!v) continue;
    let h = P.accent * P.downstep ** a.k * (a.nuclear ? P.nuclear : 1);
    if (a.nuclear && x.kind === 'question') { h = 0; x.nucleus = v; }
    x.peaks.push({ at: v.start + P.peak * v.ms, h });
  }
  const live = ph.filter((x) => x.start !== Infinity);
  return (t) => {
    if (!live.length) return P.top;
    let j = 0;
    while (j + 1 < live.length && t >= live[j + 1].start) j++;
    const x = live[j];
    let f = x.b0 - P.declination * Math.max(0, t - x.start) / 1000, a = 0;
    for (const p of x.peaks) a = Math.max(a, p.h * bump(t - p.at, P.rise, P.fall));
    f += a;
    const lv = x.lastVowel;
    if (lv) {
      if (x.kind === 'final') f -= P.final * ramp((t - lv.start) / Math.max(1, x.end - lv.start));
      else if (x.kind === 'continuation') f += P.continuation * ramp((t - lv.start) / Math.max(1, x.end - lv.start));
      else if (x.kind === 'question') {
        const n = x.nucleus ?? lv;
        f += P.question * ramp((t - n.start) / Math.max(1, x.end - n.start));
      }
    }
    return f;
  };
}

const f1 = (x) => Math.round(x * 10) / 10;
// the speak string with the contour: tokens [{ at, len, start, ms, kind, word, syl }] locate each phoneme token
// ("r<ms> CODE", len chars at index at) in out; base: the spec's pitch in Hz
export function intonate(out, tokens, plan, P, base) {
  const f = contour(plan, tokens, P), hzAt = (t) => f1(base * 2 ** (f(t) / 12));
  let s = '', k = 0, cur = null;
  for (const x of tokens) {
    const a = x.kind === 'vowel' ? hzAt(x.start + 0.25 * x.ms) : hzAt(x.start + Math.min(35, 0.4 * x.ms));
    const d = x.kind === 'vowel' ? f1(hzAt(x.start + 0.8 * x.ms) - a) : 0;
    s += out.slice(k, x.at) + (a !== cur ? `b${a} ` : '') + out.slice(x.at, x.at + x.len) + (d ? `(${d > 0 ? '+' : ''}${d})` : '');
    cur = a; k = x.at + x.len;
  }
  return s + out.slice(k);
}
