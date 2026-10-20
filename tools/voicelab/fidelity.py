#!/usr/bin/env python3
"""How Kokoro-like (human-like) a klattsing speak configuration is, measured against the Kokoro corpus
(tools/voicelab/corpus.py -> work/voicelab/corpus/), without Whisper.

usage: fidelity.py CONFIG_JSON_OR_FILE [--audio] [--voice am_onyx] [--limit N] [--jobs 2] [--brief]
                   [--asp stop|vowel|none] [--kokoro-shift MS]
       fidelity.py --sanity [--voice ..] [--limit N]   defaults, baselines and deliberately broken configs (JSON lines)
       fidelity.py --ceiling [am_michael]              calibration: a second Kokoro voice scored as if it were klattsing
       fidelity.py --selftest                          alignment / MCD / bookkeeping checks
  CONFIG: klattsing speak options, e.g. '{"bank":"silt-stops","transition":70}' or a .json file ({} = defaults).
  Prints one JSON summary. Durations only: ~0.6 s for the 100 sentences (CLI), ~0.05 s per call warm in Python;
  --audio: ~7-9 s (render ~5 s with 2 node processes; analysis overlaps it).
  From Python (the optimizer; keeps a klattsing --serve worker and the Kokoro features between calls):
      sys.path.insert(0, "tools/voicelab"); import fidelity
      r = fidelity.evaluate({"bank": "silt-stops"}, audio=True, limit=None)   # -> the dict the CLI prints
      r["score"], r["scores"]["dur"|"spec"|"pros"], r["components"], r["duration"]["log_rmse"],
      r["spectral"]["mcd"], r["spectral"]["by_phone"]["IY"], r["prosody"]["r"]

Each sentence is spoken by klattsing with the config ({"mode": "speak", **config, "text": ..., "pitch": the
sentence's Kokoro f0_median as a fractional MIDI number (klattsing's midi() takes numbers), unless the config sets
"pitch"}). Kokoro reference: one voice (am_onyx by default), 100 Harvard sentences.

Alignment: klattsing's lexicon phones vs Kokoro's (ARPABET) by Needleman-Wunsch: identical 0, a listed near-
equivalent (AH~IH~AE~AA~UW~UH~ER reductions, AA~AO, IY~IH, T~D flap, S~Z, ...) 0.3, other vowel pairs 0.6, consonants
of one class 0.7, of different classes 1.2, vowel~consonant 3 (never), gap 1. Aligned pairs (exact or substituted)
are compared; unaligned phones are left out (they still count in the total durations). The utterance-final Kokoro
phone is left out everywhere: Kokoro gives it 0.4-0.85 s, mostly fade-out. klattsing's aspiration after P/T/K (HH,
or the breath part of the vowel) counts as part of the stop by default (--asp vowel: of the vowel; none: dropped).
Phone classes: vowel, stop (P B T D K G), affricate (CH JH), fricative (F V TH DH S Z SH ZH HH), nasal, liquid/glide.

Corpus timing: Kokoro's token times lag its audio by ~50 ms (both voices, constant through the utterance; kokoro-
onnx spreads the predicted frame durations linearly over the audio and the decoder's output leads them). corpus.py
now moves the phone times 50 ms earlier (its "lead_s"); kokoro_shift(voice) estimates any residual once (the shift
maximising the fricative-vs-vowel 3.5-9 kHz / 80-1000 Hz energy contrast: am_onyx -2.5 ms, am_michael 0 ms on the
corrected corpus; -52.5 / -50 ms on the old, uncorrected one) and caches it per corpus content; audio comparisons
(spectral, F0) move Kokoro's phone times by it. Durations are unaffected. --kokoro-shift MS overrides it.

1. duration (no audio; klattsing --serve --durations):
   log_rmse = sqrt(mean(ln(d_klattsing / d_kokoro)^2)), r / r_log = Pearson r of durations in ms / of ln ms,
   ratio = geometric mean of d_klattsing / d_kokoro, ratio_sum = sum / sum; all overall, by_class, by_stress
   (klattsing's syllable stress, vowels only), and final (the vowel and coda of a phrase's last syllable, Klatt's
   rule 2) vs nonfinal: each {n, log_rmse, ratio, ratio_sum, r, r_log}. total_ratio: (start of the last aligned
   phone - start of the first), klattsing over Kokoro, pauses included (pooled; utt_total_ratio = mean of the
   per-sentence ratios). pauses: aligned internal pauses (commas; not in the score). matched_exact: identical pairs.
2. spectral (--audio; klattsing --timeline WAV, 48 kHz -> 24 kHz like the corpus): per aligned phone, mel-cepstral
   distortion between the Kokoro and the klattsch segment. Cepstrum: 25 ms Hann, 5 ms hop, 1024-point FFT, 40
   triangular mel bands 50 Hz-11 kHz, power + a floor 50 dB under the utterance's loud frames (95th percentile),
   L = ln amplitude (= 0.5 ln power), c_k = (1/N) sum_n L_n cos(pi k (n + 1/2) / N), k = 1..13 (c0, loudness, out).
   MCD = 10/ln10 * sqrt(2 * sum_k (c_k - c'_k)^2) dB per frame. Each segment's middle 80% is sampled at 5 evenly
   spaced times in both (cepstra linearly interpolated between frames: time-normalized), MCD averaged over them.
     mcd         mean over all aligned pairs (mcd_exact: identical pairs only)
     mcd_cmn     the same after subtracting each side's mean cepstrum over the sentence's sampled segments: the
                 phonetic (segment-to-segment) part, without the constant timbre difference
     mcd_static  distance between those two mean cepstra (long-term timbre/tilt: klattsch is far brighter)
     by_class    {class: [mcd, mcd_cmn, n]} by klattsing's phone, all pairs
     by_phone    {phone: [mcd, mcd_cmn, n]} identical pairs only (what a bank entry controls)
3. prosody (--audio): Praat F0 (10 ms, floor 50, ceiling 300, as the corpus) on the klattsch audio. Kokoro's 10 ms
   frames inside aligned (non-final) phones are mapped to klattsch time piecewise-linearly through the aligned
   phone boundaries; frames voiced in both are compared in semitones re each one's own median (Kokoro: f0_median,
   klattsch: its voiced frames). r = mean of per-sentence Pearson r (>= 10 frames), r_pooled over all frames,
   rmse_st (pooled), sd_ratio = sd(klattsch st) / sd(Kokoro st) (< 1: flatter than Kokoro), median_st = klattsch
   median - Kokoro median in semitones (absolute pitch; not in the score), frames, kokoro_shift_ms.
   r_detrended (in the score since metric v4): r after removing each sentence's least-squares line in time from both contours.
   r is dominated by declination (on the held-out split a straight falling line with no accents scores r 0.76, near
   Kokoro-vs-Kokoro); r_detrended is ~0 for such a line and measures the accents / local F0 movement.
4. score (human-likeness; 0 = klattsing defaults, higher = more Kokoro-like, in units of the defaults'
   sentence-to-sentence spread). Components (each a distance, lower = better):
     dur: log_rmse, 1 - r        spec: mcd, mcd_cmn        pros: 1 - r, rmse_st, 1 - r_detrended
   z_c = (ref_c - value_c) / sd_c, ref_c = the value for config {} on the same sentences (and mode), sd_c = the sd
   across sentences of {}'s per-sentence values of c. scores[group] = mean of its z_c; score = mean of the groups
   measured (dur only without --audio, so the two modes' scores differ). The reference is computed once and cached
   in work/voicelab/fidelity/ (keyed by voice, sentences, mode, shift, the corpus content (corpus_key) and a hash of
   klattsing/, the engine, banks/ and dict/lexicon.json: a change there recomputes it). Output: score, scores, z, components (the raw distances),
   reference ({c: [ref value, sd]}), duration, spectral, prosody, runtime_s.
   Calibration (--ceiling, am_michael scored against am_onyx): log_rmse 0.16, r 0.96, mcd 3.80, mcd_cmn 2.66,
   F0 r 0.78, rmse 2.1 st; klattsing defaults: 0.40, 0.75, 4.72, 3.69, 0.32, 2.6.
Known biases: slower speech scores slightly better spectrally (longer segments reach their targets); MCD is
dominated by the constant brightness gap, so formant errors move it by tenths of a dB (mcd_cmn is the sensitive part).
"""
import glob, hashlib, json, math, os, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CORPUS = os.path.join(ROOT, "work", "voicelab", "corpus")
CACHE = os.path.join(ROOT, "work", "voicelab", "fidelity")
CLI = os.path.join(ROOT, "klattsing", "bin", "klattsing.mjs")
METRIC_VERSION = 4   # 4: prosody also scores the detrended F0 correlation (accents, not just declination)

# ---------------------------------------------------------------- phones, classes, alignment
VOWELS = set("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split())
CLASSES = {"vowel": VOWELS, "stop": set("P B T D K G".split()), "affricate": {"CH", "JH"},
           "fricative": set("F V TH DH S Z SH ZH HH".split()), "nasal": {"M", "N", "NG"},
           "liquid/glide": {"L", "R", "W", "Y"}}
CLASS_OF = {p: c for c, ps in CLASSES.items() for p in ps}
VOICELESS_STOPS = {"P", "T", "K"}
NEAR = {frozenset(x.split()) for x in (
    "AH IH|AH AE|AH AA|AH UW|AH UH|AH ER|AH EH|AH AO|AH OW|AA AO|IY IH|UW UH|EH IH|EH AE|EH IY|AO OW|AO UH|EY EH|"
    "EY IY|OW UH|AY AA|AW AA|OY AO|ER R|T D|D DH|TH DH|S Z|F V|N NG|SH ZH|CH JH|SH CH").split("|")}
GAP = 1.0

def phone_class(p): return CLASS_OF.get(p, "other")

def sub_cost(a, b):
    if a == b: return 0.0
    if frozenset((a, b)) in NEAR: return 0.3
    va, vb = a in VOWELS, b in VOWELS
    if va != vb: return 3.0
    if va: return 0.6
    return 0.7 if phone_class(a) == phone_class(b) else 1.2

_align_cache = {}
def align(a, b):
    """Needleman-Wunsch on two phone lists -> [(i, j)] aligned pairs (substitutions included), in order."""
    key = (tuple(a), tuple(b))
    if key in _align_cache: return _align_cache[key]
    n, m = len(a), len(b)
    D = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): D[i][0] = i * GAP
    for j in range(1, m + 1): D[0][j] = j * GAP
    for i in range(1, n + 1):
        Di, Dp, ai = D[i], D[i - 1], a[i - 1]
        for j in range(1, m + 1):
            Di[j] = min(Dp[j - 1] + sub_cost(ai, b[j - 1]), Dp[j] + GAP, Di[j - 1] + GAP)
    pairs, i, j = [], n, m
    while i > 0 and j > 0:
        if D[i][j] == D[i - 1][j - 1] + sub_cost(a[i - 1], b[j - 1]): pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif D[i][j] == D[i - 1][j] + GAP: i -= 1
        else: j -= 1
    pairs.reverse()
    _align_cache[key] = pairs
    return pairs

# ---------------------------------------------------------------- corpus
_corpus = {}
def corpus(voice="am_onyx", limit=None):
    if voice not in _corpus:
        path = os.path.join(CORPUS, "index.json")
        if not os.path.exists(path): raise SystemExit(f"no corpus at {path}: run tools/voicelab/corpus.py")
        recs = [r for r in json.load(open(path)) if r["voice"] == voice]
        if not recs: raise SystemExit(f"no {voice} utterances in {path}")
        _corpus[voice] = recs
    recs = _corpus[voice]
    return recs[:limit] if limit else recs

_ckey = {}
def corpus_key(recs):
    """Hash of the corpus data these records hold (phones, pauses, F0), for cache keys: a rebuilt corpus (e.g. new
    phone times) must not reuse a reference or shift measured on the old one. The records loaded in this process
    are what is measured, so they are hashed, not index.json (which may have changed since)."""
    ids = tuple(r["id"] for r in recs)
    if ids not in _ckey:
        h = hashlib.sha1()
        for r in recs: h.update(json.dumps([r["id"], r["phones"], r["pauses"], r["f0"], r["f0_median"]]).encode())
        _ckey[ids] = h.hexdigest()[:10]
    return _ckey[ids]

def kokoro_phones(rec, shift=0.0):
    """[{p, start, end, ms, last}]: start/end in seconds, moved by shift (s; audio comparisons, see kokoro_shift)."""
    ph = rec["phones"]
    return [{"p": x["p"], "start": x["start"] + shift, "end": x["end"] + shift, "ms": (x["end"] - x["start"]) * 1000,
             "last": i == len(ph) - 1} for i, x in enumerate(ph)]

FRIC_HI = {"S", "SH", "Z", "ZH", "CH", "JH", "F", "TH"}
def kokoro_shift(voice="am_onyx"):
    """Seconds to add to the corpus phone times so they match its audio. Kokoro's timings are its predicted frame
    durations spread linearly over the audio, and the audio lags them (~50 ms in both voices, constant through the
    utterance). Estimated over all of the voice's sentences: the shift (-150..+100 ms, 2.5 ms steps) that maximises
    (mean 3.5-9 kHz / 80-1000 Hz energy ratio in fricatives) - (the same in vowels). Cached per corpus index."""
    key = corpus_key(corpus(voice))
    path = os.path.join(CACHE, f"kokoro-shift-{voice}-{key}.json")
    if os.path.exists(path): return json.load(open(path))["shift_s"]
    import soundfile as sf
    shifts = np.arange(-150, 100.1, 2.5) / 1000
    fr, vo = np.zeros(len(shifts)), np.zeros(len(shifts)); nf = nv = 0
    for rec in corpus(voice):
        x, sr = sf.read(os.path.join(ROOT, rec["wav"]))
        hop, win = sr // 1000, sr // 50                                  # 1 ms hop, 20 ms window
        nfr = 1 + (len(x) - win) // hop
        P = np.abs(np.fft.rfft(x[np.arange(win)[None] + hop * np.arange(nfr)[:, None]] * np.hanning(win), axis=1)) ** 2
        f = np.fft.rfftfreq(win, 1 / sr)
        ratio = 10 * np.log10((P[:, (f > 3500) & (f < 9000)].sum(1) + 1e-12) / (P[:, (f > 80) & (f < 1000)].sum(1) + 1e-12))
        c = np.concatenate([[0], np.cumsum(ratio)]); t0 = win / 2 / sr      # mean over frames by prefix sums
        for b in kokoro_phones(rec):
            if b["last"] or (b["p"] not in FRIC_HI and b["p"] not in VOWELS): continue
            d = b["end"] - b["start"]
            lo = np.clip(np.ceil((b["start"] + 0.1 * d + shifts - t0) * 1000).astype(int), 0, nfr)
            hi = np.clip(np.floor((b["end"] - 0.1 * d + shifts - t0) * 1000).astype(int) + 1, 0, nfr)
            ok = hi > lo
            m = np.where(ok, (c[hi] - c[lo]) / np.maximum(hi - lo, 1), 0.0)
            if not ok.all(): continue
            if b["p"] in FRIC_HI: fr += m; nf += 1
            else: vo += m; nv += 1
    contrast = fr / max(nf, 1) - vo / max(nv, 1)
    best = float(shifts[int(np.argmax(contrast))])
    os.makedirs(CACHE, exist_ok=True)
    json.dump({"voice": voice, "shift_s": best, "contrast_db_at_best": float(contrast.max()),
               "contrast_db_at_0": float(contrast[np.argmin(np.abs(shifts))]), "fricatives": nf, "vowels": nv}, open(path, "w"))
    return best

def midi_of(hz): return 69 + 12 * math.log2(hz / 440.0)

def spec_of(config, rec):
    spec = {"mode": "speak", **config, "text": rec["text"]}
    if "pitch" not in config: spec["pitch"] = round(midi_of(rec["f0_median"]), 4)
    if spec.get("mode") != "speak": raise ValueError("fidelity measures speak mode only")
    return spec

# ---------------------------------------------------------------- klattsing
class Worker:
    """node klattsing.mjs --serve --durations, kept alive between evaluations."""
    def __init__(self):
        self.p, self.lock = None, threading.Lock()
    def request(self, specs):
        with self.lock:
            if self.p is None or self.p.poll() is not None:
                self.p = subprocess.Popen(["node", CLI, "--serve", "--durations"], stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, text=True, cwd=ROOT)
            self.p.stdin.write(json.dumps(specs) + "\n"); self.p.stdin.flush()
            line = self.p.stdout.readline()
        if not line: raise RuntimeError("klattsing worker died")
        out = json.loads(line)
        if isinstance(out, dict) and "error" in out: raise RuntimeError(f"klattsing: {out['error']}")
        return out
_worker = Worker()

def klattsing_phones_dur(d, asp="stop"):
    """durationsOf result -> ([{p, ms, start, stress, final, word}] without pauses, [(after_word, ms)] pauses)."""
    ph, pauses, t = [], [], 0.0
    words_final = set()
    raw = d["phones"]
    for i, x in enumerate(raw):
        if x["p"] == "pau":
            if i > 0: words_final.add(raw[i - 1].get("word"))
            pauses.append((raw[i - 1].get("word") if i > 0 else -1, x["ms"])); t += x["ms"]; continue
        a = x.get("asp", 0.0)
        e = {"p": x["p"], "ms": x["ms"], "start": t, "stress": x.get("stress"), "word": x.get("word"), "syl": x.get("syl")}
        if a:
            if asp == "stop" and ph and ph[-1]["p"] in VOICELESS_STOPS: ph[-1]["ms"] += a; e["start"] += a
            elif asp == "vowel": e["ms"] += a
            else: e["start"] += a
        ph.append(e); t += x["ms"] + a
    if ph: words_final.add(ph[-1]["word"])
    mark_final(ph, words_final)
    return ph, pauses

def mark_final(ph, words_final):
    """final: the vowel and coda of the last syllable of a phrase-final word."""
    last_syl = {}
    for x in ph: last_syl[x["word"]] = max(last_syl.get(x["word"], 0), x["syl"] or 0)
    seen_v = set()
    for x in ph:
        k = (x["word"], x["syl"])
        if x["p"] in VOWELS: seen_v.add(k)
        x["final"] = x["word"] in words_final and x["syl"] == last_syl[x["word"]] and k in seen_v

def durations(config, recs, asp="stop"):
    return [klattsing_phones_dur(d, asp) for d in _worker.request([spec_of(config, r) for r in recs])]

def render(config, recs, jobs=2, then=None, chunks=None):
    """-> [then(i, timeline dict, 24 kHz float array)] per record (default: the (timeline, audio) pair), rendered by
    klattsing.mjs --timeline in `chunks` pieces (default 2 * jobs), `jobs` processes at a time; `then` runs in the
    worker thread as each piece finishes, so analysis overlaps the remaining renders."""
    import soundfile as sf
    from scipy.signal import resample_poly
    specs = [spec_of(config, r) for r in recs]
    jobs = max(1, min(jobs, len(specs)))
    nch = max(1, min(chunks or 2 * jobs, len(specs)))
    parts = [list(range(len(specs)))[k::nch] for k in range(nch)]
    then = then or (lambda i, tl, y: (tl, y))
    out = [None] * len(specs)
    with tempfile.TemporaryDirectory(prefix="fidelity-") as tmp:
        def run(k):
            sp, wav = os.path.join(tmp, f"s{k}.json"), os.path.join(tmp, f"o{k}.wav")
            json.dump([specs[i] for i in parts[k]], open(sp, "w"))
            r = subprocess.run(["node", CLI, sp, "--timeline", wav], capture_output=True, text=True, cwd=ROOT)
            if r.returncode: raise RuntimeError(f"klattsing render failed: {r.stderr.strip()[-500:]}")
            tls = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
            x, sr = sf.read(wav, dtype="float32")
            for i, tl in zip(parts[k], tls):
                a = int(round(tl["offsetMs"] * sr / 1000)); n = int(math.ceil(tl["totalMs"] * sr / 1000))
                y = x[a:a + n].astype(np.float64)
                out[i] = then(i, tl, resample_poly(y, 1, 2) if sr == 48000 else resample_poly(y, SR, sr))
        with ThreadPoolExecutor(jobs) as ex: list(ex.map(run, range(nch)))
    return out

def klattsing_phones_tl(tl, asp="stop"):
    """timeline -> [{p, start, end}] (seconds); the aspiration after P/T/K is merged into the stop (asp="stop"),
    into the vowel after it ("vowel"), or dropped ("none")."""
    ph, pending = [], None
    for x in tl["phones"]:
        if x.get("asp"):
            if asp == "stop" and ph and ph[-1]["p"] in VOICELESS_STOPS: ph[-1]["end"] = x["end"] / 1000; continue
            if asp == "vowel": pending = x["start"] / 1000; continue
            if asp == "none": continue
            ph.append({"p": "HH", "start": x["start"] / 1000, "end": x["end"] / 1000}); continue
        ph.append({"p": x["p"], "start": (pending if pending is not None else x["start"] / 1000), "end": x["end"] / 1000})
        pending = None
    return ph

# ---------------------------------------------------------------- statistics
def dstats(k, K):
    k, K = np.asarray(k, float), np.asarray(K, float)
    n = len(k)
    if n == 0: return {"n": 0}
    lr = np.log(k / K)
    s = {"n": n, "log_rmse": float(np.sqrt(np.mean(lr ** 2))), "ratio": float(np.exp(lr.mean())),
         "ratio_sum": float(k.sum() / K.sum())}
    if n >= 3:
        s["r"] = pearson(k, K); s["r_log"] = pearson(np.log(k), np.log(K))
    return s

def pearson(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 3 or a.std() == 0 or b.std() == 0: return float("nan")
    return float(np.corrcoef(a, b)[0, 1])

def rnd(x, nd=4):
    if isinstance(x, dict): return {k: rnd(v, nd) for k, v in x.items()}
    if isinstance(x, (list, tuple)): return [rnd(v, nd) for v in x]
    if isinstance(x, (float, np.floating)): return None if not np.isfinite(x) else round(float(x), nd)
    if isinstance(x, np.integer): return int(x)
    return x

def duration_metrics(config, recs, asp="stop"):
    rows, per_utt, tot_k, tot_K, utt_ratio, pau = [], {"log_rmse": [], "r": []}, 0.0, 0.0, [], []
    for rec, (kph, kpau) in zip(recs, durations(config, recs, asp)):
        Kph = kokoro_phones(rec)
        pairs = align([x["p"] for x in kph], [x["p"] for x in Kph])
        u = [(kph[i], Kph[j]) for i, j in pairs if not Kph[j]["last"] and kph[i]["ms"] > 0 and Kph[j]["ms"] > 0]
        rows += u
        if u:
            lr = np.log([a["ms"] / b["ms"] for a, b in u])
            per_utt["log_rmse"].append(float(np.sqrt(np.mean(lr ** 2))))
            per_utt["r"].append(pearson([a["ms"] for a, b in u], [b["ms"] for a, b in u]))
        if len(pairs) >= 2:
            (i0, j0), (i1, j1) = pairs[0], pairs[-1]
            dk = (kph[i1]["start"] - kph[i0]["start"]); dK = (Kph[j1]["start"] - Kph[j0]["start"]) * 1000
            if dK > 0: tot_k += dk; tot_K += dK; utt_ratio.append(dk / dK)
        # internal pauses: Kokoro's pause after word w vs klattsing's
        kp = {w: ms for w, ms in kpau}
        for p in rec["pauses"]:
            if p["after"] >= len(rec["phones"]) - 1: continue
            w = rec["phones"][p["after"]]["word"]
            if w in kp and p["end"] > p["start"]: pau.append((kp[w], (p["end"] - p["start"]) * 1000))
    sel = lambda f: dstats([a["ms"] for a, b in rows if f(a, b)], [b["ms"] for a, b in rows if f(a, b)])
    out = sel(lambda a, b: True)
    out.update({
        "n_kokoro": sum(len(r["phones"]) for r in recs),
        "matched_exact": sum(a["p"] == b["p"] for a, b in rows),
        "total_ratio": tot_k / tot_K if tot_K else float("nan"),
        "utt_total_ratio": float(np.mean(utt_ratio)) if utt_ratio else float("nan"),
        "by_class": {c: sel(lambda a, b, c=c: phone_class(a["p"]) == c) for c in CLASSES},
        "by_stress": {str(s): sel(lambda a, b, s=s: a["p"] in VOWELS and a["stress"] == s) for s in (0, 1, 2)},
        "final": sel(lambda a, b: a["final"]), "nonfinal": sel(lambda a, b: not a["final"]),
        "pauses": dstats([a for a, b in pau], [b for a, b in pau]) if pau else {"n": 0},
    })
    out["by_stress"] = {k: v for k, v in out["by_stress"].items() if v["n"]}
    return out, per_utt

# ---------------------------------------------------------------- spectral
SR, WIN, HOP, NFFT, NMEL, FMIN, FMAX, NCEP, FLOOR_DB = 24000, 600, 120, 1024, 40, 50.0, 11000.0, 13, 50.0
_fb = None
def melbank():
    global _fb
    if _fb is None:
        f = np.fft.rfftfreq(NFFT, 1 / SR)
        mel = lambda h: 2595 * np.log10(1 + h / 700); imel = lambda m: 700 * (10 ** (m / 2595) - 1)
        edges = imel(np.linspace(mel(FMIN), mel(FMAX), NMEL + 2)); fb = np.zeros((NMEL, len(f)))
        for i in range(NMEL):
            l, c, r = edges[i:i + 3]
            fb[i] = np.clip(np.minimum((f - l) / (c - l), (r - f) / (r - c)), 0, None)
            if fb[i].sum() == 0: fb[i, np.argmin(np.abs(f - c))] = 1.0
        n = np.arange(NMEL)
        dctm = np.cos(np.pi * np.outer(np.arange(1, NCEP + 1), n + 0.5) / NMEL) / NMEL     # c_1..c_13
        _fb = (fb, dctm)
    return _fb

def cepstra(x):
    """x (24 kHz) -> (frame centre times s, [frames, 13] mel cepstrum c1..c13 of ln amplitude)."""
    fb, dctm = melbank()
    x = np.asarray(x, np.float64)
    if len(x) < WIN: x = np.pad(x, (0, WIN - len(x)))
    nfr = 1 + (len(x) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(nfr)[:, None]
    P = np.abs(np.fft.rfft(x[idx] * np.hanning(WIN), NFFT, axis=1)) ** 2
    E = P @ fb.T
    floor = np.percentile(E.mean(axis=1), 95) * 10 ** (-FLOOR_DB / 10) + 1e-20
    L = 0.5 * np.log(E + floor)
    return (np.arange(nfr) * HOP + WIN / 2) / SR, L @ dctm.T

def sample_seg(times, C, s, e, n=5):
    """cepstra at n evenly spaced times over the middle 80% of [s, e] (linear interpolation between frames)."""
    d = e - s
    ts = np.linspace(s + 0.1 * d, e - 0.1 * d, n)
    fi = np.clip((ts - times[0]) / (HOP / SR), 0, len(times) - 1)
    lo = np.floor(fi).astype(int); hi = np.minimum(lo + 1, len(times) - 1); w = (fi - lo)[:, None]
    return C[lo] * (1 - w) + C[hi] * w

MCD_K = 10 / math.log(10) * math.sqrt(2)
def mcd(A, B): return float(np.mean(MCD_K * np.sqrt(((A - B) ** 2).sum(axis=1))))

_kfeat = {}
def kokoro_features(rec):
    if rec["id"] not in _kfeat:
        import soundfile as sf
        x, sr = sf.read(os.path.join(ROOT, rec["wav"]), dtype="float32")
        if sr != SR: raise ValueError(f"{rec['wav']}: {sr} Hz, expected {SR}")
        _kfeat[rec["id"]] = cepstra(x)
    return _kfeat[rec["id"]]

# ---------------------------------------------------------------- prosody
def f0_track(y):
    import parselmouth
    p = parselmouth.Sound(np.asarray(y, np.float64), sampling_frequency=SR).to_pitch(time_step=0.01, pitch_floor=50, pitch_ceiling=300)
    return np.asarray(p.xs()), np.asarray(p.selected_array["frequency"])

def compare_audio(sys_ph, y, ft, ff, rec, shift=0.0):
    """One sentence: the system's phones [{p, start, end}] (s), its 24 kHz audio y and F0 track (ft, ff) vs Kokoro's
    record (phone times moved by shift s) -> ([(system phone, kokoro phone, mcd, mcd_cmn, static)],
    (kokoro st, system st, median difference st) or None)."""
    Kph = kokoro_phones(rec, shift)
    pairs = [(a, b) for a, b in align([x["p"] for x in sys_ph], [x["p"] for x in Kph]) if not Kph[b]["last"]]
    tK, CK = kokoro_features(rec)
    tk, Ck = cepstra(y)
    keep = [(a, b) for a, b in pairs if sys_ph[a]["end"] > sys_ph[a]["start"] and Kph[b]["end"] > Kph[b]["start"]]
    s = []
    if keep:
        A = np.array([sample_seg(tk, Ck, sys_ph[a]["start"], sys_ph[a]["end"]) for a, b in keep])     # [segs, 5, 13]
        B = np.array([sample_seg(tK, CK, Kph[b]["start"], Kph[b]["end"]) for a, b in keep])
        ma, mb = A.reshape(-1, NCEP).mean(0), B.reshape(-1, NCEP).mean(0)
        raw = (MCD_K * np.sqrt(((A - B) ** 2).sum(-1))).mean(-1)
        cmn = (MCD_K * np.sqrt((((A - ma) - (B - mb)) ** 2).sum(-1))).mean(-1)
        static = float(MCD_K * np.sqrt(((ma - mb) ** 2).sum()))
        s = [(sys_ph[a]["p"], Kph[b]["p"], float(r), float(c), static) for (a, b), r, c in zip(keep, raw, cmn)]
    if not pairs: return s, None
    # F0: Kokoro frames inside aligned phones -> system time, piecewise-linearly through the aligned boundaries
    aK = np.array([t for a, b in pairs for t in (Kph[b]["start"], Kph[b]["end"])])
    ak = np.array([t for a, b in pairs for t in (sys_ph[a]["start"], sys_ph[a]["end"])])
    o = np.argsort(aK, kind="stable"); aK, ak = aK[o], np.maximum.accumulate(ak[o])
    KF = np.array(rec["f0"]); kt, kf = KF[:, 0], KF[:, 1]
    inside = np.zeros(len(kt), bool)
    for a, b in pairs: inside |= (kt >= Kph[b]["start"]) & (kt < Kph[b]["end"])
    j = np.clip(np.round((np.interp(kt, aK, ak) - ft[0]) / 0.01).astype(int), 0, len(ft) - 1)
    kv, vk = ff[j], ff[ff > 0]
    m = inside & (kf > 0) & (kv > 0)
    if m.sum() < 3 or not len(vk): return s, None
    return s, (12 * np.log2(kf[m] / rec["f0_median"]), 12 * np.log2(kv[m] / np.median(vk)), 12 * math.log2(np.median(vk) / rec["f0_median"]), kt[m])

def detrended_r(t, a, b):
    """Pearson r of a and b after removing each one's least-squares line in t (the sentence's declination)."""
    if len(t) < 10 or np.ptp(t) == 0: return float("nan")
    X = np.vstack([t, np.ones_like(t)]).T
    res = lambda y: y - X @ np.linalg.lstsq(X, y, rcond=None)[0]
    return pearson(res(a), res(b))

def aggregate_audio(res):
    """[compare_audio results] -> spectral, prosody, per-sentence {mcd, f0_r, f0_rmse}."""
    seg, per_utt, stK, stk, meds = [], {"mcd": [], "mcd_cmn": [], "mcd_static": [], "f0_r": [], "f0_rmse": []}, [], [], []
    rdt = []
    for s, f in res:
        seg += s
        if s:
            per_utt["mcd"].append(float(np.mean([x[2] for x in s]))); per_utt["mcd_cmn"].append(float(np.mean([x[3] for x in s])))
            per_utt["mcd_static"].append(s[0][4])
        if f is None: continue
        a1, a2, med, tt = f; stK.append(a1); stk.append(a2); meds.append(med)
        per_utt["f0_rmse"].append(float(np.sqrt(np.mean((a1 - a2) ** 2))))
        if len(a1) >= 10: per_utt["f0_r"].append(pearson(a2, a1)); rdt.append(detrended_r(tt, a2, a1))
    v, vc = np.array([x[2] for x in seg]), np.array([x[3] for x in seg])
    exact = np.array([x[0] == x[1] for x in seg], bool)
    cls = np.array([phone_class(x[0]) for x in seg]); ph = np.array([x[0] for x in seg])
    cell = lambda m: [float(v[m].mean()), float(vc[m].mean()), int(m.sum())]
    nan = float("nan")
    spectral = {"mcd": float(v.mean()) if len(v) else nan, "mcd_cmn": float(vc.mean()) if len(v) else nan,
                "mcd_static": float(np.mean(per_utt["mcd_static"])) if per_utt["mcd_static"] else nan,
                "mcd_exact": float(v[exact].mean()) if exact.any() else nan, "n": len(v),
                "by_class": {c: cell(cls == c) for c in CLASSES if (cls == c).any()},
                "by_phone": {p: cell(exact & (ph == p)) for p in sorted(set(ph.tolist())) if (exact & (ph == p)).any()}}
    A1, A2 = (np.concatenate(stK), np.concatenate(stk)) if stK else (np.zeros(0), np.zeros(0))
    per_utt["f0_r"] = rr = [x for x in per_utt["f0_r"] if np.isfinite(x)]
    rdt = [x for x in rdt if np.isfinite(x)]
    per_utt["f0_r_dt"] = rdt
    prosody = {"r": float(np.mean(rr)) if rr else float("nan"), "r_pooled": pearson(A2, A1),
               "r_detrended": float(np.mean(rdt)) if rdt else float("nan"),
               "rmse_st": float(np.sqrt(np.mean((A1 - A2) ** 2))) if len(A1) else float("nan"),
               "sd_ratio": float(A2.std() / A1.std()) if len(A1) > 2 and A1.std() > 0 else float("nan"),
               "median_st": float(np.mean(meds)) if meds else float("nan"), "frames": int(len(A1))}
    return spectral, prosody, per_utt

def audio_metrics(config, recs, jobs=2, shift=None, asp="stop"):
    t0 = time.time()
    if shift is None: shift = kokoro_shift(recs[0]["voice"])
    for r in recs: kokoro_features(r)
    t1 = time.time()
    res = render(config, recs, jobs, lambda i, tl, y: compare_audio(klattsing_phones_tl(tl, asp), y, *f0_track(y), recs[i], shift))
    t2 = time.time()
    spectral, prosody, per_utt = aggregate_audio(res)
    prosody["kokoro_shift_ms"] = shift * 1000
    return spectral, prosody, per_utt, {"kokoro_features": t1 - t0, "render_and_analysis": t2 - t1}

def ceiling(voice="am_michael", ref_voice="am_onyx", limit=None):
    """Human-to-human calibration: Kokoro `voice` scored as the system against `ref_voice` (overall numbers only)."""
    import soundfile as sf
    sysr = {r["text"]: r for r in corpus(voice)}
    recs = [r for r in corpus(ref_voice, limit) if r["text"] in sysr]
    rows, res, tot = [], [], [0.0, 0.0]
    sh_sys, sh_ref = kokoro_shift(voice), kokoro_shift(ref_voice)
    for rec in recs:
        S = kokoro_phones(sysr[rec["text"]]); K = kokoro_phones(rec)
        pairs = align([x["p"] for x in S], [x["p"] for x in K])
        rows += [(S[i]["ms"], K[j]["ms"], S[i]["p"]) for i, j in pairs if not K[j]["last"] and not S[i]["last"]]
        (i0, j0), (i1, j1) = pairs[0], pairs[-1]
        tot[0] += S[i1]["start"] - S[i0]["start"]; tot[1] += K[j1]["start"] - K[j0]["start"]
        x, sr = sf.read(os.path.join(ROOT, sysr[rec["text"]]["wav"]))
        F = np.array(sysr[rec["text"]]["f0"])
        S = kokoro_phones(sysr[rec["text"]], sh_sys)
        if S[-1]["last"]: S[-1]["end"] = min(S[-1]["end"], S[-1]["start"] + 0.15)
        res.append(compare_audio(S, x, F[:, 0], F[:, 1], rec, sh_ref))
    d = dstats([a for a, b, _ in rows], [b for a, b, _ in rows])
    d["total_ratio"] = tot[0] / tot[1]
    d["by_class"] = {c: dstats([a for a, b, p in rows if phone_class(p) == c], [b for a, b, p in rows if phone_class(p) == c]) for c in CLASSES}
    spectral, prosody, _ = aggregate_audio(res)
    spectral.pop("by_phone")
    return rnd({"system": voice, "reference": ref_voice, "n_utts": len(recs), "kokoro_shift_ms": [sh_sys * 1000, sh_ref * 1000], "duration": d, "spectral": spectral, "prosody": prosody})

# ---------------------------------------------------------------- score
# group -> [(component name, getter of the distance, the per-sentence values its sd comes from)]
COMPONENTS = {
    "dur": [("dur_log_rmse", lambda r: r["duration"]["log_rmse"], "log_rmse"),
            ("dur_1_minus_r", lambda r: 1 - r["duration"]["r"], "r")],
    "spec": [("mcd", lambda r: r["spectral"]["mcd"], "mcd"),
             ("mcd_cmn", lambda r: r["spectral"]["mcd_cmn"], "mcd_cmn")],
    "pros": [("f0_1_minus_r", lambda r: 1 - r["prosody"]["r"], "f0_r"),
             ("f0_rmse_st", lambda r: r["prosody"]["rmse_st"], "f0_rmse"),
             # without this a plain falling line scored as well as anything (declination dominates r)
             ("f0_1_minus_r_detrended", lambda r: 1 - r["prosody"]["r_detrended"], "f0_r_dt")],
}

def components(res, per_utt):
    """{name: (distance, sd across sentences)} for the groups measured."""
    out = {}
    for g, cs in COMPONENTS.items():
        for name, get, key in cs:
            try: val = get(res)
            except KeyError: continue
            vals = [x for x in per_utt.get(key, []) if np.isfinite(x)]
            out[name] = (float(val), float(np.std(vals)) if len(vals) > 1 else float("nan"))
    return out

def score(comp, ref):
    z, groups = {}, {}
    for g, cs in COMPONENTS.items():
        zs = []
        for name, *_ in cs:
            if name not in comp or name not in ref: continue
            rv, sd = ref[name]
            z[name] = (rv - comp[name][0]) / max(sd, 1e-9) if np.isfinite(sd) else float("nan")
            zs.append(z[name])
        if zs: groups[g] = float(np.mean(zs))
    total = float(np.mean(list(groups.values()))) if groups else float("nan")
    return total, groups, z

def source_hash():
    h = hashlib.sha1(str(METRIC_VERSION).encode())
    files = sorted(glob.glob(os.path.join(ROOT, "klattsing", "src", "*.js")) + [CLI]
                   + glob.glob(os.path.join(ROOT, "vendor", "klattsch", "src", "engine", "**", "*.js"), recursive=True)
                   + glob.glob(os.path.join(ROOT, "vendor", "klattsch", "src", "engine", "**", "*.json"), recursive=True)
                   + glob.glob(os.path.join(ROOT, "banks", "*.json")) + glob.glob(os.path.join(ROOT, "dict", "lexicon.json")))
    for f in files:
        h.update(os.path.relpath(f, ROOT).encode()); h.update(open(f, "rb").read())
    return h.hexdigest()[:12]

_ref_mem = {}
def reference(recs, voice, audio, asp, jobs, shift, have=None):
    ids = ",".join(r["id"] for r in recs)
    mode = f"audio{shift * 1000:+.1f}ms" if audio else "dur"
    key = f"{voice}-{len(recs)}-{mode}-{asp}-{hashlib.sha1(ids.encode()).hexdigest()[:8]}-{corpus_key(recs)}-{source_hash()}"
    if key in _ref_mem: return _ref_mem[key]
    path = os.path.join(CACHE, f"reference-{key}.json")
    if os.path.exists(path):
        ref = {k: tuple(v) for k, v in json.load(open(path)).items()}
    else:
        if have is not None: ref = have
        else:
            res, per_utt = _measure({}, recs, audio, asp, jobs, shift)
            ref = components(res, per_utt)
        os.makedirs(CACHE, exist_ok=True)
        tmp = f"{path}.{os.getpid()}"; json.dump(ref, open(tmp, "w")); os.replace(tmp, path)
    _ref_mem[key] = ref
    return ref

def _measure(config, recs, audio, asp, jobs, shift=None):
    t0 = time.time()
    dur, per_utt = duration_metrics(config, recs, asp)
    res = {"duration": dur, "runtime_s": {"durations": time.time() - t0}}
    if audio:
        spectral, prosody, pu, rt = audio_metrics(config, recs, jobs, shift, asp)
        res.update(spectral=spectral, prosody=prosody); per_utt.update(pu); res["runtime_s"].update(rt)
    return res, per_utt

def evaluate(config, audio=True, limit=None, voice="am_onyx", asp="stop", jobs=2, brief=False, kokoro_shift_ms=None):
    """config: klattsing speak options (dict). -> {"score", "scores", "z", "components", "duration", ["spectral",
    "prosody"], "n_utts", "runtime_s", ...}; score/scores/z relative to config {} (see the module docstring).
    kokoro_shift_ms: the corpus timing correction for audio comparisons (None: estimated, see kokoro_shift)."""
    if isinstance(config, str): config = json.loads(config)
    t0 = time.time()
    recs = corpus(voice, limit)
    shift = (kokoro_shift(voice) if kokoro_shift_ms is None else kokoro_shift_ms / 1000) if audio else 0.0
    res, per_utt = _measure(config, recs, audio, asp, jobs, shift)
    comp = components(res, per_utt)
    t1 = time.time()
    ref = reference(recs, voice, audio, asp, jobs, shift, comp if config == {} else None)
    total, groups, z = score(comp, ref)
    res["runtime_s"]["reference"] = time.time() - t1
    res["runtime_s"]["total"] = time.time() - t0
    out = {"config": config, "voice": voice, "n_utts": len(recs), "audio": audio, "score": total, "scores": groups, "z": z,
           "components": {k: v[0] for k, v in comp.items()}, "reference": {k: list(v) for k, v in ref.items()}, **res}
    if brief:
        out.pop("reference")
        if "spectral" in out: out["spectral"].pop("by_phone")
        if "duration" in out: out["duration"].pop("by_stress", None)
    return rnd(out)

# ---------------------------------------------------------------- sanity configs, selftest, CLI
def rules_all_one():
    src = open(os.path.join(ROOT, "klattsing", "src", "durations.js")).read()
    body = src[src.index("export const RULES"):]; body = body[:body.index("};")]
    import re
    keys = [k for k in re.findall(r"(\w+):\s*[\d.]+", body) if k != "aspirationMs"]
    return {"rules": {k: 1.0 for k in keys}}

def f2_scrambled(base="klatt1980-en"):
    """bankPatch reversing the vowels' F2 ranking (front vowels get back-vowel F2 and the reverse; glideTo.F2 moves by
    the same amount): a gross formant error for the sanity check."""
    bank = json.load(open(os.path.join(ROOT, "vendor", "klattsch", "src", "engine", "banks", f"{base}.json")))["phonemes"]
    vs = sorted((v for v in VOWELS if v in bank and "F2" in bank[v]), key=lambda v: bank[v]["F2"])
    patch = {}
    for v, w in zip(vs, reversed(vs)):
        f2 = bank[w]["F2"]; patch[v] = {"F2": f2}
        if "glideTo" in bank[v] and "F2" in bank[v]["glideTo"]: patch[v]["glideTo"] = {"F2": bank[v]["glideTo"]["F2"] + f2 - bank[v]["F2"]}
    return {"bankPatch": patch}

SANITY = lambda: [("defaults", {}), ("durations v0", {"durations": "v0"}), ("silt-stops", {"bank": "silt-stops"}),
                  ("silt-stops TR70", {"bank": "silt-stops", "transition": 70}),
                  ("BROKEN rules=1.0", rules_all_one()), ("BROKEN rate 1.6", {"rate": 1.6}),
                  ("BROKEN vowel F2 reversed", f2_scrambled()),
                  ("BROKEN flat pitch", {"intonation": {"accent": 0, "finalFall": 0}}),
                  ("BROKEN pitch inverted", {"intonation": {"accent": -3, "finalFall": -3}})]

def sanity(voice, limit, jobs):
    rows = []
    for name, cfg in SANITY():
        r = evaluate(cfg, audio=True, limit=limit, voice=voice, jobs=jobs)
        d, s, p = r["duration"], r["spectral"], r["prosody"]
        rows.append({"name": name, "score": r["score"], "dur": r["scores"].get("dur"), "spec": r["scores"].get("spec"),
                     "pros": r["scores"].get("pros"), "log_rmse": d["log_rmse"], "dur_r": d.get("r"), "total_ratio": d["total_ratio"],
                     "mcd": s["mcd"], "mcd_cmn": s["mcd_cmn"], "mcd_static": s["mcd_static"], "f0_r": p["r"], "f0_rmse": p["rmse_st"], "sd_ratio": p["sd_ratio"],
                     "secs": r["runtime_s"]["total"]})
        print(json.dumps(rows[-1]), flush=True)
    return rows

def selftest():
    a = "DH AH B ER CH K AH N UW S L IH D".split()
    b = "DH AH B ER CH K AH N UW S L IH D".split()
    assert align(a, b) == [(i, i) for i in range(len(a))]
    p = align("T UW S IY".split(), "T AH S IY".split()); assert p == [(0, 0), (1, 1), (2, 2), (3, 3)], p
    p = align("AE N D DH AH".split(), "AE N DH AH".split()); assert p == [(0, 0), (1, 1), (3, 2), (4, 3)], p
    p = align("S T R IY T".split(), "S T IY T".split()); assert [x for x in p] == [(0, 0), (1, 1), (3, 2), (4, 3)], p
    assert sub_cost("AA", "S") > 2 * GAP
    # MCD: identical signals 0; a different spectrum > 0; a level change ~0 (c0 excluded)
    rng = np.random.default_rng(0)
    x = rng.standard_normal(SR // 2)
    from scipy.signal import lfilter
    y = lfilter([1, -0.95], [1], x)
    t1, C1 = cepstra(x); t2, C2 = cepstra(y); t3, C3 = cepstra(3 * x)
    s1 = sample_seg(t1, C1, 0.1, 0.3); assert mcd(s1, s1) == 0
    assert mcd(s1, sample_seg(t2, C2, 0.1, 0.3)) > 3
    assert mcd(s1, sample_seg(t3, C3, 0.1, 0.3)) < 0.05
    # final marking: "the planks ." -> the rhyme of the last syllable
    ph = [{"p": q, "word": w, "syl": 0} for q, w in [("DH", 0), ("AH", 0), ("P", 1), ("L", 1), ("AE", 1), ("NG", 1), ("K", 1), ("S", 1)]]
    mark_final(ph, {1}); assert [x["final"] for x in ph] == [False] * 4 + [True] * 4
    # aspiration goes to the stop
    d = {"phones": [{"p": "T", "ms": 50, "word": 0, "syl": 0, "stress": 1}, {"p": "IH", "ms": 80, "word": 0, "syl": 0, "stress": 1, "asp": 25},
                    {"p": "pau", "ms": 250}]}
    ph, pau = klattsing_phones_dur(d); assert ph[0]["ms"] == 75 and ph[1]["start"] == 75 and pau == [(0, 250)], (ph, pau)
    assert abs(midi_of(440) - 69) < 1e-9
    # timeline: aspiration to the stop / the vowel / dropped
    tl = {"phones": [{"p": "T", "start": 0, "end": 50}, {"p": "HH", "start": 50, "end": 75, "asp": True},
                     {"p": "IH", "start": 75, "end": 155}]}
    assert [(x["p"], x["start"], x["end"]) for x in klattsing_phones_tl(tl)] == [("T", 0, 0.075), ("IH", 0.075, 0.155)]
    assert [(x["p"], x["start"]) for x in klattsing_phones_tl(tl, "vowel")] == [("T", 0), ("IH", 0.05)]
    assert [(x["p"], x["end"]) for x in klattsing_phones_tl(tl, "none")] == [("T", 0.05), ("IH", 0.155)]
    rec = {"phones": [{"p": "S", "start": 0.1, "end": 0.2}, {"p": "IY", "start": 0.2, "end": 0.6}]}
    k = kokoro_phones(rec, -0.05)
    assert abs(k[0]["start"] - 0.05) < 1e-12 and abs(k[0]["ms"] - 100) < 1e-9 and k[1]["last"] and not k[0]["last"]
    # statistics and the score
    d = dstats([10, 20, 40], [10, 20, 40]); assert d["log_rmse"] == 0 and abs(d["r"] - 1) < 1e-12 and d["ratio"] == 1
    assert abs(dstats([20, 40, 80], [10, 20, 40])["log_rmse"] - math.log(2)) < 1e-12
    ref = {"dur_log_rmse": (0.4, 0.1), "dur_1_minus_r": (0.25, 0.1), "mcd": (5.0, 0.5), "mcd_cmn": (4.0, 0.5)}
    total, groups, z = score({"dur_log_rmse": (0.3, 0), "dur_1_minus_r": (0.25, 0), "mcd": (5.5, 0), "mcd_cmn": (4.0, 0)}, ref)
    assert abs(z["dur_log_rmse"] - 1) < 1e-9 and abs(groups["dur"] - 0.5) < 1e-9 and abs(groups["spec"] + 0.5) < 1e-9
    assert abs(total) < 1e-9 and "pros" not in groups
    # detrended F0 r: two contours sharing only a declination line -> ~0; sharing a bump on different lines -> ~1
    t = np.linspace(0, 2, 200); bump = np.exp(-((t - 0.7) / 0.1) ** 2)
    assert abs(detrended_r(t, -3 * t + 0.1 * np.sin(17 * t), -2 * t + 0.1 * np.cos(29 * t))) < 0.3
    assert detrended_r(t, -3 * t + 2 * bump, -1 * t + 3 * bump) > 0.99
    print("selftest ok")

def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description="Kokoro-likeness of a klattsing speak configuration (see the module docstring)")
    ap.add_argument("config", nargs="?", default=None, help="JSON object or a .json file ({} = defaults)")
    ap.add_argument("--audio", action="store_true", help="also spectral (MCD) and prosody (F0) fidelity: renders audio")
    ap.add_argument("--voice", default="am_onyx"); ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--jobs", type=int, default=2, help="klattsing render processes (audio)")
    ap.add_argument("--asp", default="stop", choices=["stop", "vowel", "none"], help="where klattsing's aspiration counts")
    ap.add_argument("--brief", action="store_true", help="leave out per-phoneme MCD, per-stress durations and the reference")
    ap.add_argument("--kokoro-shift", type=float, default=None, metavar="MS",
                    help="corpus phone-time correction for audio comparisons (default: estimated from the corpus, ~-50)")
    ap.add_argument("--sanity", action="store_true"); ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--ceiling", nargs="?", const="am_michael", metavar="VOICE",
                    help="calibration: score Kokoro VOICE (am_michael) against --voice instead of klattsing")
    a = ap.parse_args(argv)
    if a.selftest: return selftest()
    if a.sanity: return sanity(a.voice, a.limit, a.jobs)
    if a.ceiling: return print(json.dumps(ceiling(a.ceiling, a.voice, a.limit), indent=1))
    if a.config is None: ap.error("CONFIG needed")
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    print(json.dumps(evaluate(cfg, audio=a.audio, limit=a.limit, voice=a.voice, asp=a.asp, jobs=a.jobs, brief=a.brief,
                              kokoro_shift_ms=a.kokoro_shift), indent=1))

if __name__ == "__main__":
    main(sys.argv[1:])
