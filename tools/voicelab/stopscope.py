#!/usr/bin/env python3
"""Stop consonants up close: closure voicing, release bursts and VOT, klattsing (a speak config) vs the Kokoro corpus.

fidelity.py's MCD samples each phone's middle 80% at 5 points, so it hears a stop's closure but hardly its 5-25 ms
burst; this measures the parts of a stop one by one, on the stops fidelity aligns (klattsing's lexical phone and
Kokoro's are the same stop, or T~D), in both voices' audio with the same detector:

  release   the time of the steepest rise of 2-8 kHz energy (1 ms hop, 8 ms Hann) in [start + 25% of the stop,
            end + 15 ms] (klattsch: the stop's own slot, its aspiration after it). prominence: the 2-8 kHz level in
            the 10 ms after it over the closure's median, dB (a released stop ~15-40, an unreleased one ~0-8)
  closure   [start + 20%, release - 5 ms] (>= 8 ms): its 60-400 Hz level ("voice bar") and its 60-8000 Hz level,
            dB re the neighbouring vowel's middle (the vowel before the stop when it is voiced, else after)
  burst     11 ms (256 samples) Hann from release - 1 ms: band levels 0.5-1.5 / 1.5-3 / 3-5 / 5-8 kHz re the vowel's
            0.06-8 kHz level, the spectral centroid (0.5-8 kHz), and burst_mcd: the mel-cepstral distance (fidelity's
            40 mel bands, c1..c13) between the two bursts of a pair
  vot       voiceless stops before a vowel: release -> the first of 5 periodic 1 ms frames in a row (normalized
            autocorrelation >= 0.5 at 70-300 Hz over 12 ms, at 4 kHz), ms
Context: next = front vowel (F2 > 1500 in klatt1980) / back vowel / consonant / pause, nextc = the same with the
consonant's class (Cstop incl. affricates, Cfric, Cnas, Cliq); prev = voiced / voiceless / pause (klattsing's phones,
a punctuation mark is a pause).

usage: stopscope.py CONFIG_JSON_OR_FILE [--limit N] [--voice am_onyx] [--json] [--by p,next|p,nextc|p,prev|...]
  prints, per stop and context, Kokoro's and klattsing's medians and the pairs' burst MCD; --json: the table as JSON.
"""
import argparse, collections, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F

STOPS = set("P B T D K G".split())
VOICELESS = set("P T K".split())
FRONT = set("IY IH EY EH AE".split())          # F2 >= 1500 Hz at the onset (the banks; AY starts at AA)
VOICED = set("B D G V DH Z ZH JH M N NG L R W Y".split()) | F.VOWELS
SR, HOP, WIN, NFFT = 24000, 24, 192, 512
f_ax = np.fft.rfftfreq(NFFT, 1 / SR)
band = lambda lo, hi: (f_ax >= lo) & (f_ax < hi)
B_LF, B_HF, B_ALL = band(60, 400), band(2000, 8000), band(60, 8000)
f_b = np.fft.rfftfreq(F.NFFT, 1 / SR)                     # the burst spectrum: fidelity's 1024-point FFT
bband = lambda lo, hi: (f_b >= lo) & (f_b < hi)
# levels re the vowel: the burst's 1024-point FFT of 256 samples vs the envelopes' 512-point FFT of 192
# (a band's summed power grows with the FFT length (more bins) and the window's energy)
NORM_DB = 10 * math.log10((F.NFFT / NFFT) * (np.hanning(256) ** 2).sum() / (np.hanning(WIN) ** 2).sum())
BURST_BANDS = {"b0.5-1.5": (500, 1500), "b1.5-3": (1500, 3000), "b3-5": (3000, 5000), "b5-8": (5000, 8000)}

def envelopes(x):
    """1 ms hop, 8 ms Hann: dB levels in the low, high and whole bands; frame centre times."""
    x = np.asarray(x, np.float64)
    if len(x) < WIN: x = np.pad(x, (0, WIN - len(x)))
    n = 1 + (len(x) - WIN) // HOP
    P = np.abs(np.fft.rfft(x[np.arange(WIN)[None] + HOP * np.arange(n)[:, None]] * np.hanning(WIN), NFFT, axis=1)) ** 2
    db = lambda m: 10 * np.log10(P[:, m].sum(1) + 1e-12)
    return (np.arange(n) * HOP + WIN / 2) / SR, db(B_LF), db(B_HF), db(B_ALL)

def burst_spectrum(x, t):
    a = int(round((t - 0.001) * SR)); seg = np.asarray(x[max(a, 0):max(a, 0) + 256], np.float64)
    if len(seg) < 256: seg = np.pad(seg, (0, 256 - len(seg)))
    return np.abs(np.fft.rfft(seg * np.hanning(256), F.NFFT)) ** 2

def burst_cep(P, floor):
    fb, dctm = F.melbank()
    L = 0.5 * np.log(fb @ P + floor)
    return dctm @ L

class Side:
    """One signal's envelopes and how to read them."""
    def __init__(self, x):
        self.x = x
        self.t, self.lf, self.hf, self.all = envelopes(x)
        fb, _ = F.melbank()
        # the cepstrum floor as fidelity's: 50 dB under the loud frames' mel energy (here from 11 ms frames)
        n = 1 + (len(x) - 256) // 120
        E = np.array([(fb @ (np.abs(np.fft.rfft(np.asarray(x[i * 120:i * 120 + 256], np.float64) * np.hanning(256), F.NFFT)) ** 2)).mean() for i in range(max(n, 1))])
        self.floor = np.percentile(E, 95) * 10 ** (-5) + 1e-20
        self.voiced = Periodicity(x, self.t)
    def idx(self, t): return int(np.clip(round((t - self.t[0]) * 1000), 0, len(self.t) - 1))
    def mean(self, env, a, b):
        i, j = self.idx(a), self.idx(b)
        return float(np.mean(env[i:j + 1])) if j >= i else float("nan")

def measure(side, s, e, nxt_end, vowel_ref, vowel_next, voiceless_before_vowel):
    """One stop occurrence in one signal: s, e its slot (s), nxt_end: the latest the release may be."""
    d = e - s
    lo, hi = side.idx(s + 0.25 * d), side.idx(min(e + 0.015, nxt_end))
    if hi - lo < 3: return None
    hf = np.convolve(side.hf, np.ones(3) / 3, mode="same")
    rise = hf[lo + 2:hi + 1] - hf[lo - 2:hi - 3] if lo >= 2 else None
    if rise is None or not len(rise): return None
    ir = lo + int(np.argmax(rise))
    tr = side.t[ir]
    out = {"rel_ms": (tr - s) * 1000}
    c0, c1 = s + 0.2 * d, tr - 0.005
    after = float(np.max(side.hf[ir:ir + 10])) if ir + 10 <= len(side.hf) else float(np.max(side.hf[ir:]))
    if c1 - c0 >= 0.008:
        i, j = side.idx(c0), side.idx(c1)
        out["prominence"] = after - float(np.median(side.hf[i:j + 1]))
        out["clo_lf"] = side.mean(side.lf, c0, c1) - vowel_ref[0]
        out["clo_all"] = side.mean(side.all, c0, c1) - vowel_ref[1]
    P = burst_spectrum(side.x, tr)
    tot = vowel_ref[1]
    for k, (a, b) in BURST_BANDS.items(): out[k] = 10 * math.log10(P[bband(a, b)].sum() + 1e-12) - NORM_DB - tot
    m = bband(500, 8000); out["centroid"] = float((f_b[m] * P[m]).sum() / (P[m].sum() + 1e-20))
    out["_cep"] = burst_cep(P, side.floor)
    fb, _ = F.melbank()
    out["_mel"] = 10 * np.log10(fb @ P + 1e-12) - NORM_DB - tot           # the 40 mel bands, dB re the vowel's level
    if voiceless_before_vowel and vowel_next is not None:
        # voicing onset: the first 1 ms frame from the release on that is periodic (side.voiced) for 5 frames running
        v = side.voiced
        k = ir
        while k + 5 < len(v) and side.t[k] < tr + 0.15 and not v[k:k + 5].all(): k += 1
        out["vot_ms"] = (side.t[min(k, len(side.t) - 1)] - tr) * 1000
    return out

class Periodicity:
    """voiced[i] for envelope frame i (lazily, by ranges): the normalized autocorrelation of the signal decimated to
    4 kHz, over a 12 ms window centred on the frame, peaks >= 0.5 at a lag of 3.3-14 ms (70-300 Hz), and the window
    is no more than 35 dB under the utterance's loud windows."""
    FS, W = SR / 6, 48
    def __init__(self, x, t):
        from scipy.signal import decimate
        self.y = decimate(np.asarray(x, np.float64), 6, ftype="fir")
        self.c = np.round(t * self.FS).astype(int) - self.W // 2
        self.lags = np.arange(int(self.FS / 300), int(self.FS / 70) + 1)
        self.cache = {}
        y2 = np.concatenate([[0], np.cumsum(self.y ** 2)])
        self.energy = lambda a: y2[np.clip(a + self.W, 0, len(self.y))] - y2[np.clip(a, 0, len(self.y))]
        e = self.energy(self.c[::10])
        self.quiet = np.percentile(e, 95) * 10 ** (-3.5) if len(e) else 0.0
    def __len__(self): return len(self.c)
    def __getitem__(self, sl):
        i0, i1 = sl.start, min(sl.stop, len(self.c))
        out = np.zeros(max(i1 - i0, 0), bool)
        for i in range(i0, i1):
            if i not in self.cache:
                a = self.c[i]
                if a < 0 or a + self.W + self.lags[-1] > len(self.y): self.cache[i] = False; continue
                seg = self.y[a:a + self.W]; e0 = seg @ seg
                M = self.y[a + self.lags[:, None] + np.arange(self.W)[None, :]]
                r = (M @ seg) / np.sqrt(e0 * (M ** 2).sum(1) + 1e-20)
                self.cache[i] = bool(r.max() >= 0.5 and e0 > self.quiet)
            out[i - i0] = self.cache[i]
        return out

def vowel_level(side, ph, i):
    """(lf, all, mel) of the middle 50% of vowel ph[i] (dB; mel: its 40 bands re all, 11 ms frames), or None."""
    if i is None or i < 0 or i >= len(ph) or ph[i]["p"] not in F.VOWELS: return None
    a, b = ph[i]["start"], ph[i]["end"]; q = 0.25 * (b - a)
    tot = side.mean(side.all, a + q, b - q)
    fb, _ = F.melbank()
    mel = np.mean([fb @ burst_spectrum(side.x, t) for t in np.linspace(a + q, b - q - 0.011, 5)], axis=0)
    return side.mean(side.lf, a + q, b - q), tot, 10 * np.log10(mel + 1e-12) - NORM_DB - tot

def ctx_next(p): return "pause" if p is None else ("Vfront" if p in FRONT else "Vback") if p in F.VOWELS else "C"
NEXTC = {"stop": "Cstop", "affricate": "Cstop", "fricative": "Cfric", "nasal": "Cnas", "liquid/glide": "Cliq"}
def ctx_nextc(p): return NEXTC.get(F.phone_class(p), ctx_next(p)) if p is not None else "pause"
def ctx_prev(p): return "pause" if p is None else "voiced" if p in VOICED else "voiceless"

def klattsing_phones(tl):
    """timeline -> [{p, start, end, asp_end?, word, pause_after}] (s): lexical phones, a stop's aspiration noted."""
    ph = []
    for x in tl["phones"]:
        if x.get("asp"):
            if ph: ph[-1]["asp_end"] = x["end"] / 1000
            continue
        ph.append({"p": x["p"], "start": x["start"] / 1000, "end": x["end"] / 1000, "word": x.get("word")})
    for a, b in zip(ph, ph[1:]): a["gap"] = b["start"] - a.get("asp_end", a["end"]) > 0.03   # a pause between
    return ph

def run(config, limit=None, voice="am_onyx"):
    import soundfile as sf
    recs = F.corpus(voice, limit)
    shift = F.kokoro_shift(voice)
    rows = []
    def per(i, tl, y):
        rec = recs[i]
        x, _ = sf.read(os.path.join(F.ROOT, rec["wav"]), dtype="float32")
        K, k = Side(x), Side(y)
        Kph = F.kokoro_phones(rec, shift); kph = klattsing_phones(tl)
        out = []
        for a, b in F.align([q["p"] for q in kph], [q["p"] for q in Kph]):
            pk, pK = kph[a]["p"], Kph[b]["p"]
            if pk not in STOPS or pK not in STOPS or Kph[b]["last"]: continue
            if pk != pK and {pk, pK} != {"T", "D"}: continue
            prev = kph[a - 1]["p"] if a > 0 and not kph[a - 1].get("gap") else None
            nxt = kph[a + 1]["p"] if a + 1 < len(kph) and not kph[a].get("gap") else None
            vbefore = prev in VOICED and prev is not None
            # the reference vowel: before the stop when it is voiced, else after
            def refs(side, ph, j):
                before = vowel_level(side, ph, j - 1) if vbefore else None
                after = vowel_level(side, ph, j + 1)
                return before or after, after
            rK, nK = refs(K, Kph, b); rk, nk = refs(k, kph, a)
            if rK is None or rk is None: continue
            vbv = pk in VOICELESS and nxt in F.VOWELS
            kend = kph[a + 1]["start"] + 0.03 if a + 1 < len(kph) else kph[a]["end"]
            Kend = Kph[b + 1]["start"] + 0.03 if b + 1 < len(Kph) else Kph[b]["end"]
            mK = measure(K, Kph[b]["start"], Kph[b]["end"], Kend, rK, nK, vbv)
            mk = measure(k, kph[a]["start"], kph[a]["end"], kend, rk, nk, vbv)
            if mK is None or mk is None: continue
            st = rec["phones"][b + 1].get("stress") if b + 1 < len(rec["phones"]) else None
            out.append({"p": pk, "next": ctx_next(nxt), "nextc": ctx_nextc(nxt), "prev": ctx_prev(prev),
                        "stress": "str" if st in (1, 2) else "unstr" if st == 0 else "-", "K": mK, "k": mk,
                        "utt": rec["id"], "word": rec["words"][kph[a]["word"]] if kph[a].get("word") is not None else "?",
                        "t": [round(kph[a]["start"], 3), round(kph[a]["end"], 3), round(kph[a].get("asp_end", 0), 3)],
                        "vowel": nxt if nxt in F.VOWELS else None,
                        "vmel": [nK[2] if nK else None, nk[2] if nk else None],
                        "burst_mcd": F.MCD_K * float(np.sqrt(((mK["_cep"] - mk["_cep"]) ** 2).sum()))})
        return out
    for r in F.render(config, recs, 2, per): rows += r
    return rows

KEYS = ["clo_lf", "clo_all", "prominence", "b0.5-1.5", "b1.5-3", "b3-5", "b5-8", "centroid", "vot_ms"]
def table(rows, by=("p", "next")):
    g = collections.defaultdict(list)
    for r in rows:
        g[tuple(r[k] for k in by)].append(r)
        g[(r["p"], "*")].append(r)
    out = {}
    for key, rs in sorted(g.items()):
        cell = {"n": len(rs), "burst_mcd": round(float(np.mean([r["burst_mcd"] for r in rs])), 2)}
        for k in KEYS:
            a = [r["K"][k] for r in rs if k in r["K"] and k in r["k"]]
            b = [r["k"][k] for r in rs if k in r["K"] and k in r["k"]]
            if a: cell[k] = [round(float(np.median(a)), 1), round(float(np.median(b)), 1)]
        out["/".join(key)] = cell
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--limit", type=int); ap.add_argument("--voice", default="am_onyx")
    ap.add_argument("--json", action="store_true"); ap.add_argument("--by", default="p,next")
    ap.add_argument("--dump", help="print the rows of one cell, e.g. K/str/Vback (with --by p,stress,next)")
    ap.add_argument("--rows", help="save every row (with the 40-band burst and vowel spectra) to this JSON file")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    rows = run(cfg, a.limit, a.voice)
    if a.rows:
        lst = lambda v: v.tolist() if isinstance(v, np.ndarray) else float(v) if isinstance(v, np.floating) else v
        json.dump([{k: ({q: lst(w) for q, w in v.items()} if k in "Kk" else [lst(w) for w in v] if k == "vmel" else v)
                    for k, v in r.items()} for r in rows], open(a.rows, "w"))
    if a.dump:
        for r in rows:
            if "/".join(r[k] for k in a.by.split(",")) == a.dump:
                print(r["utt"], r["word"], {s: {k: round(v, 1) for k, v in r[s].items() if k != "_cep"} for s in "Kk"})
    t = table(rows, tuple(a.by.split(",")))
    allm = float(np.mean([r["burst_mcd"] for r in rows]))
    if a.json: print(json.dumps({"n": len(rows), "burst_mcd": allm, "table": t})); return
    print(f"{len(rows)} stops, burst MCD {allm:.2f} dB   (cells: [Kokoro median, klattsing median])")
    for k, c in t.items():
        print(f"{k:14s} n {c['n']:3d}  bMCD {c['burst_mcd']:5.2f}  " + "  ".join(f"{q} {c[q][0]:.0f}/{c[q][1]:.0f}" for q in KEYS if q in c))

if __name__ == "__main__":
    main()
