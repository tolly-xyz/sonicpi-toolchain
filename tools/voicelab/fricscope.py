#!/usr/bin/env python3
"""Fricatives up close: noise spectra, level against the vowels, voicing and envelopes, klattsing (a speak config) vs
the Kokoro corpus.

fidelity.py's MCD leaves out c0, so it sees a fricative's spectral shape but not how loud it is next to its vowels;
this measures both, on the fricatives fidelity aligns (klattsing's lexical phone and Kokoro's are the same fricative,
or a voicing pair S~Z, F~V, TH~DH, SH~ZH), in both voices' audio with the same analysis:

  spectrum  the mean power spectrum (fidelity's 25 ms Hann frames, 5 ms hop, 1024-point FFT) over the middle 60% of the
            fricative; levels in dB re the reference vowel's whole-band (60-11000 Hz) level from the same analysis over
            its middle 50% (the vowel after the fricative when there is one, no pause between, else the one before)
              level      60-11000 Hz;  b0.06-0.4 .. b8-11: bands (b0.06-0.4: the voicing);  mel: fidelity's 40 bands
              moments    centroid, sd, skewness, excess kurtosis of the 0.5-11 kHz power spectrum, and the peak (the
                         loudest of the 40 mel bands above 1 kHz), as Jongman, Wayland & Wong (2000, JASA 108) measure
              fric_mcd   the mel-cepstral distance (c1..c13, fidelity's floor) between the pair's mean spectra
  voicing   lf: 60-400 Hz level of the middle 60% re the reference vowel's 60-400 Hz level; periodic: the share of 1 ms
            frames in the middle 60% that are periodic (stopscope's detector: autocorrelation >= 0.5 at 70-300 Hz)
  envelope  the 2-8 kHz level (1 ms hop, 8 ms Hann) at 0, 10, ..., 100% of the fricative and 10 / 20 ms before its start
            and after its end, dB re the fricative's middle (30-70%): rise / fall = the profile at 10% / 90%
Context: prev / next = vowel / consonant / pause (klattsing's phones), pos = initial / medial / final in the word.

usage: fricscope.py CONFIG_JSON_OR_FILE [--limit N] [--voice am_onyx] [--by p|p,next|p,pos|...] [--json] [--rows FILE]
  prints per fricative and context Kokoro's and klattsing's medians ([Kokoro, klattsing]) and the mean fric_mcd.
"""
import argparse, collections, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F
import stopscope as S

FRICS = set("F V TH DH S Z SH ZH HH".split())
PAIRS = {frozenset(x.split()) for x in ("S Z", "F V", "TH DH", "SH ZH")}
SR, WIN, HOP, NFFT = F.SR, F.WIN, F.HOP, F.NFFT
f_ax = np.fft.rfftfreq(NFFT, 1 / SR)
BANDS = {"b0.06-0.4": (60, 400), "b0.4-1.5": (400, 1500), "b1.5-3": (1500, 3000), "b3-5": (3000, 5000),
         "b5-8": (5000, 8000), "b8-11": (8000, 11000)}
M_ALL = (f_ax >= 60) & (f_ax < 11000)
M_LF = (f_ax >= 60) & (f_ax < 400)
M_MOM = (f_ax >= 500) & (f_ax < 11000)
PROFILE = [-0.02, -0.01] + [i / 10 for i in range(11)] + ["+0.01", "+0.02"]   # seconds before / after, or a share

def mel_centres():
    fb, _ = F.melbank()
    return (fb * f_ax[None, :]).sum(1) / fb.sum(1)
MEL_F = mel_centres()

class Side(S.Side):
    """stopscope's envelopes and periodicity, plus fidelity's 25 ms frames' power spectra."""
    def __init__(self, x):
        super().__init__(x)
        x = np.asarray(x, np.float64)
        if len(x) < WIN: x = np.pad(x, (0, WIN - len(x)))
        n = 1 + (len(x) - WIN) // HOP
        self.P = np.abs(np.fft.rfft(x[np.arange(WIN)[None] + HOP * np.arange(n)[:, None]] * np.hanning(WIN), NFFT, axis=1)) ** 2
        self.tp = (np.arange(n) * HOP + WIN / 2) / SR
        fb, _ = F.melbank()
        self.mfloor = np.percentile((self.P @ fb.T).mean(1), 95) * 10 ** (-F.FLOOR_DB / 10) + 1e-20
    def spec(self, a, b):
        """mean power spectrum of the frames centred in [a, b] (at least the nearest one)"""
        m = (self.tp >= a) & (self.tp <= b)
        if not m.any(): m = np.abs(self.tp - 0.5 * (a + b)) == np.abs(self.tp - 0.5 * (a + b)).min()
        return self.P[m].mean(0)

db = lambda x: 10 * math.log10(x + 1e-20)

def vowel_ref(side, ph, i):
    """(whole-band dB, 60-400 Hz dB) of vowel ph[i]'s middle 50%, or None"""
    if i is None or i < 0 or i >= len(ph) or ph[i]["p"] not in F.VOWELS: return None
    a, b = ph[i]["start"], ph[i]["end"]; q = 0.25 * (b - a)
    P = side.spec(a + q, b - q)
    return db(P[M_ALL].sum()), db(P[M_LF].sum())

def measure(side, s, e, ref):
    d = e - s
    if d < 0.02: return None
    P = side.spec(s + 0.2 * d, e - 0.2 * d)
    tot, lf = ref
    out = {"level": db(P[M_ALL].sum()) - tot, "lf": db(P[M_LF].sum()) - lf}
    for k, (lo, hi) in BANDS.items(): out[k] = db(P[(f_ax >= lo) & (f_ax < hi)].sum()) - tot
    w, f = P[M_MOM], f_ax[M_MOM]; w = w / w.sum()
    m1 = float((w * f).sum()); sd = float(np.sqrt((w * (f - m1) ** 2).sum()))
    out.update(centroid=m1, sd=sd, skew=float((w * (f - m1) ** 3).sum() / sd ** 3), kurt=float((w * (f - m1) ** 4).sum() / sd ** 4 - 3))
    fb, dctm = F.melbank()
    mel = fb @ P
    out["peak"] = float(MEL_F[MEL_F > 1000][np.argmax(mel[MEL_F > 1000])])
    out["_mel"] = 10 * np.log10(mel + 1e-20) - tot
    out["_cep"] = dctm @ (0.5 * np.log(mel + side.mfloor))
    out["_floor"] = db(side.mfloor) - tot      # fidelity's cepstrum floor, dB re the vowel
    v = side.voiced[side.idx(s + 0.2 * d):side.idx(e - 0.2 * d) + 1]
    out["periodic"] = float(np.mean(v)) if len(v) else float("nan")
    mid = side.mean(side.hf, s + 0.3 * d, e - 0.3 * d)
    prof = []
    for x in PROFILE:
        t = s + x if isinstance(x, float) and x < 0 else e + float(x) if isinstance(x, str) else s + x * d
        prof.append(side.hf[side.idx(t)] - mid)
    out["_prof"] = prof
    out["rise"], out["fall"] = prof[3], prof[11]
    return out

def klattsing_phones(tl):
    ph = S.klattsing_phones(tl)
    return ph

def ctx(p): return "pause" if p is None else "V" if p in F.VOWELS else "C"

def run(config, limit=None, voice="am_onyx"):
    import soundfile as sf
    recs = F.corpus(voice, limit)
    shift = F.kokoro_shift(voice)
    def per(i, tl, y):
        rec = recs[i]
        x, _ = sf.read(os.path.join(F.ROOT, rec["wav"]), dtype="float32")
        K, k = Side(x), Side(y)
        Kph = F.kokoro_phones(rec, shift); kph = klattsing_phones(tl)
        out = []
        for a, b in F.align([q["p"] for q in kph], [q["p"] for q in Kph]):
            pk, pK = kph[a]["p"], Kph[b]["p"]
            if pk not in FRICS or pK not in FRICS or Kph[b]["last"]: continue
            if pk != pK and frozenset((pk, pK)) not in PAIRS: continue
            gap_before = a > 0 and kph[a - 1].get("gap")
            prev = kph[a - 1]["p"] if a > 0 and not gap_before else None
            nxt = kph[a + 1]["p"] if a + 1 < len(kph) and not kph[a].get("gap") else None
            # the reference vowel: after the fricative when there is one (no pause between), else before
            def ref(side, ph, j, nv, pv):
                return (vowel_ref(side, ph, j + 1) if nv in F.VOWELS else None) or (vowel_ref(side, ph, j - 1) if pv in F.VOWELS else None)
            # Kokoro's neighbours are its own phones next to b (they may differ from klattsing's)
            Kn = Kph[b + 1]["p"] if b + 1 < len(Kph) else None; Kp = Kph[b - 1]["p"] if b > 0 else None
            rK = ref(K, Kph, b, Kn if nxt in F.VOWELS else None, Kp if prev in F.VOWELS else None)
            rk = ref(k, kph, a, nxt, prev)
            if rK is None or rk is None: continue
            mK = measure(K, Kph[b]["start"], Kph[b]["end"], rK)
            mk = measure(k, kph[a]["start"], kph[a]["end"], rk)
            if mK is None or mk is None: continue
            w = kph[a]["word"]
            first = a == 0 or kph[a - 1]["word"] != w; last = a + 1 == len(kph) or kph[a + 1]["word"] != w
            out.append({"p": pk, "kp": pK, "prev": ctx(prev), "next": ctx(nxt),
                        "pos": "initial" if first and not last else "final" if last and not first else "medial" if not first else "alone",
                        "K": mK, "k": mk, "utt": rec["id"], "word": rec["words"][w] if w is not None and w < len(rec["words"]) else "?",
                        "t": [round(kph[a]["start"], 3), round(kph[a]["end"], 3)], "tK": [round(Kph[b]["start"], 3), round(Kph[b]["end"], 3)],
                        "fric_mcd": F.MCD_K * float(np.sqrt(((mK["_cep"] - mk["_cep"]) ** 2).sum()))})
        return out
    rows = []
    for r in F.render(config, recs, 2, per): rows += r
    return rows

KEYS = ["level", "lf", "periodic", "b0.4-1.5", "b1.5-3", "b3-5", "b5-8", "b8-11", "centroid", "sd", "skew", "kurt", "peak", "rise", "fall"]
def table(rows, by=("p",)):
    g = collections.defaultdict(list)
    for r in rows:
        g[tuple(r[k] for k in by)].append(r)
        if len(by) > 1: g[(r["p"],) + ("*",) * (len(by) - 1)].append(r)
    out = {}
    for key, rs in sorted(g.items()):
        cell = {"n": len(rs), "fric_mcd": round(float(np.mean([r["fric_mcd"] for r in rs])), 2),
                "same": sum(r["p"] == r["kp"] for r in rs)}
        for k in KEYS:
            a = [r["K"][k] for r in rs if np.isfinite(r["K"][k]) and np.isfinite(r["k"][k])]
            b = [r["k"][k] for r in rs if np.isfinite(r["K"][k]) and np.isfinite(r["k"][k])]
            if a: cell[k] = [round(float(np.median(a)), 2 if k in ("periodic", "skew", "kurt") else 1), round(float(np.median(b)), 2 if k in ("periodic", "skew", "kurt") else 1)]
        cell["prof"] = [[round(float(np.median([r[s]["_prof"][i] for r in rs])), 1) for i in range(len(PROFILE))] for s in "Kk"]
        out["/".join(key)] = cell
    return out

def lst(v): return v.tolist() if isinstance(v, np.ndarray) else float(v) if isinstance(v, np.floating) else v

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--limit", type=int); ap.add_argument("--voice", default="am_onyx")
    ap.add_argument("--json", action="store_true"); ap.add_argument("--by", default="p")
    ap.add_argument("--rows", help="save every row (with the 40-band spectra and envelope profiles) to this JSON file")
    ap.add_argument("--profile", action="store_true", help="also print the envelope profiles")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    rows = run(cfg, a.limit, a.voice)
    if a.rows:
        json.dump([{k: ({q: lst(w) for q, w in v.items() if q != "_cep"} if k in "Kk" else v) for k, v in r.items()} for r in rows], open(a.rows, "w"))
    t = table(rows, tuple(a.by.split(",")))
    allm = float(np.mean([r["fric_mcd"] for r in rows]))
    if a.json: print(json.dumps({"n": len(rows), "fric_mcd": allm, "table": t})); return
    print(f"{len(rows)} fricatives, fric MCD {allm:.2f} dB   (cells: Kokoro median/klattsing median; levels dB re the vowel)")
    for k, c in t.items():
        print(f"{k:14s} n {c['n']:3d} ({c['same']:3d} same)  fMCD {c['fric_mcd']:5.2f}  " + "  ".join(
            f"{q} {c[q][0]:.{2 if q in ('periodic', 'skew', 'kurt') else 0}f}/{c[q][1]:.{2 if q in ('periodic', 'skew', 'kurt') else 0}f}" for q in KEYS if q in c))
        if a.profile: print(f"{'':14s} profile K {c['prof'][0]}\n{'':14s}         k {c['prof'][1]}")

if __name__ == "__main__":
    main()
