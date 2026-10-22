#!/usr/bin/env python3
"""Fit the "fricatives" option's per-fricative entries (klattsing/src/fricatives.js FRICATION: the frication path's
resonators and bypass, and for the voiced ones the voice bar's level) to Kokoro's fricative spectra.

Targets: Kokoro's median mean-spectrum per fricative from fricscope.py --rows (40 mel bands, dB re the reference
vowel's 60-11000 Hz level; the K side of the rows). Candidates are rendered in vowel contexts (klattsing's prefix for
CONFIG, the entry laid over the config's resolved one through tools/voicelab/render_worker.mjs; the fricative at its
median klattsing duration in the rows, between vowels, before a stop and after a pause) and measured with fricscope's
analysis (its 25 ms spectra over the middle 60%; the vowel after, else before, as the reference).

The frication path is linear: white noise through A1 H1 - A2 H2 + A3 H3 + AB (klattsch's bandpass biquads at 48 kHz),
so its spectrum is known in closed form up to one scale (the vowel's level, the envelope, the analysis). Each round
renders the current entry twice, as it is and with the frication off (what is left: the voice bar, the vowels' voicing
leaking into the fricative's edges), takes the scale c from the bands the frication dominates, and fits the model
  mel_b = 10 log10(c N_b(resonators) + s V_b)    (V: the frication-off render; s: the voice bar's level squared, voiced)
to the target by least squares over the bands from --fmin to 11 kHz, both sides held above --floor dB (fidelity's
cepstrum floor is ~-60 to -65 dB re the vowel), from several starts; then renders again (--rounds).

--calib CALIB_CONFIG with --kokoro ROWS rendered from it (fricscope.py --rows of CALIB_CONFIG): the target becomes
Kokoro's spectrum + (CALIB_CONFIG's fricative in the synthetic contexts - its median in the corpus rows), per band,
for what the synthetic contexts get wrong (pass 2: CALIB_CONFIG = the config with pass 1's entries).

usage: fricfit.py CONFIG --kokoro ROWS.json [--calib CALIB_CONFIG] [--phones S,Z,...] [--start FIT.json] [--rounds 3]
                  [--out FIT.json]
  prints per fricative the rendered RMS error before / after and the fitted entry (JSON, for FRICATION).
"""
import argparse, base64, collections, json, math, os, subprocess, sys, threading
import numpy as np
from scipy.optimize import least_squares
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F
import fricscope as FS

ROOT = F.ROOT
FRICS = ["F", "V", "TH", "DH", "S", "Z", "SH", "ZH"]
VOICED = {"V", "DH", "Z", "ZH"}
RES = ["FF1", "BF1", "AF1", "FF2", "BF2", "AF2", "FF3", "BF3", "AF3", "AB"]
SR_SYNTH = 48000


class Worker:
    def __init__(self):
        self.p = subprocess.Popen(["node", os.path.join(HERE, "render_worker.mjs")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, cwd=ROOT)
        self.lock = threading.Lock()

    def render(self, config, body, entries=None, ms=None):
        with self.lock:
            self.p.stdin.write(json.dumps({"config": config, "entries": entries or {}, "body": body, "sr": SR_SYNTH, "ms": ms}) + "\n")
            self.p.stdin.flush()
            r = json.loads(self.p.stdout.readline())
        if "error" in r: raise RuntimeError(r["error"])
        y = np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)
        return resample_poly(y, 1, 2)

    def resolve(self, config, codes):
        """the config's bank entries for codes, as klattsch resolves them"""
        with self.lock:
            self.p.stdin.write(json.dumps({"config": config, "resolve": codes}) + "\n"); self.p.stdin.flush()
            r = json.loads(self.p.stdout.readline())
        if "error" in r: raise RuntimeError(r["error"])
        return r["entries"]


CTX = [("AA", "AH"), ("IY", "IH"), ("AE", "ER"), ("UW", "EH"), ("AE", "T"), (None, "IY")]
PREV = {"V": ["AA", "IY", "AE", "UW", "AH", "EH"], "C": ["N", "T", "N", "K", "N", "T"], "pause": [None] * 6}
NEXT = {"V": ["AH", "IH", "ER", "EH", "IY", "AA"], "C": ["T", "D", "T", "N", "T", "D"], "pause": ["T"] * 6}
def contexts_like(counts, n=6):
    """n (before, after) contexts in the proportions of the corpus's (prev, next) classes (largest remainder)"""
    tot = sum(counts.values()); share = {k: n * v / tot for k, v in counts.items()}
    alloc = {k: int(v) for k, v in share.items()}
    for k in sorted(share, key=lambda k: share[k] - alloc[k], reverse=True)[:n - sum(alloc.values())]: alloc[k] += 1
    out, i = [], 0
    for (pv, nx), m in sorted(alloc.items(), key=lambda kv: -kv[1]):
        for _ in range(m): out.append((PREV[pv][i % 6], NEXT[nx][i % 6])); i += 1
    return out

def body(prev, p, nxt, dur, vdur=140, pitch=100):
    s = f"b{pitch} "
    s += f"r{vdur} {prev} " if prev else "p120 "
    s += f"r{dur:.1f} {p} "
    s += f"r{vdur if nxt in F.VOWELS else 60} {nxt} "
    if nxt not in F.VOWELS: s += f"r{vdur} AH"
    return s


class Lean:
    """fricscope.Side's 25 ms power spectra alone (what its spectrum, level and mel measures read)"""
    spec = FS.Side.spec
    def __init__(self, x):
        x = np.asarray(x, np.float64)
        if len(x) < FS.WIN: x = np.pad(x, (0, FS.WIN - len(x)))
        n = 1 + (len(x) - FS.WIN) // FS.HOP
        self.P = np.abs(np.fft.rfft(x[np.arange(FS.WIN)[None] + FS.HOP * np.arange(n)[:, None]] * np.hanning(FS.WIN), FS.NFFT, axis=1)) ** 2
        self.tp = (np.arange(n) * FS.HOP + FS.WIN / 2) / FS.SR

FB = F.melbank()[0]

def synth_mel(worker, config, p, entry, dur, ctxs=CTX):
    if not ctxs: ctxs = CTX
    """fricscope's mel spectrum of the fricative re the vowel (the vowel after, else before), dB, the median over
    the contexts"""
    mels = []
    for prev, nxt in ctxs:
        t0 = 0.12 if prev is None else 0.14
        y = worker.render(config, body(prev, p, nxt, dur), {p: entry} if entry else None, ms=1000 * t0 + dur + 140)
        side = Lean(y)
        s, e = t0, t0 + dur / 1000
        ph = [{"p": prev or "pau", "start": 0, "end": t0}, {"p": p, "start": s, "end": e},
              {"p": nxt, "start": e, "end": e + (0.14 if nxt in F.VOWELS else 0.06)}]
        ref = FS.vowel_ref(side, ph, 2) if nxt in F.VOWELS else FS.vowel_ref(side, ph, 0)
        d = e - s
        P = side.spec(s + 0.2 * d, e - 0.2 * d)
        mels.append(10 * np.log10(FB @ P + 1e-20) - ref[0])
    return np.median(np.array(mels), axis=0)


def kokoro_targets(rows):
    t = {}
    for p in FRICS:
        rs = [r for r in rows if r["p"] == p]
        if not rs: continue
        t[p] = {"mel": np.median(np.array([r["K"]["_mel"] for r in rs]), axis=0),
                "kmel": np.median(np.array([r["k"]["_mel"] for r in rs]), axis=0),
                "dur": float(np.median([1000 * (r["t"][1] - r["t"][0]) for r in rs])), "n": len(rs),
                "ctx": collections.Counter((r["prev"], r["next"]) for r in rs)}
    return t


# ---------------------------------------------------------------- the frication path in closed form
_z1 = np.exp(-2j * np.pi * FS.f_ax / SR_SYNTH); _z2 = _z1 * _z1
def bandpass(f, bw):
    """klattsch's BandpassBiquad (RBJ constant 0 dB peak) at 48 kHz, on fidelity's FFT bins"""
    f = max(40.0, min(SR_SYNTH * 0.45, f)); bw = max(20.0, bw)
    w0 = 2 * math.pi * f / SR_SYNTH; alpha = math.sin(w0) / (2 * f / bw); a0 = 1 + alpha
    return (alpha / a0) * (1 - _z2) / (1 + (-2 * math.cos(w0) / a0) * _z1 + ((1 - alpha) / a0) * _z2)

def path_mel(fr):
    """the mel-band power of the frication path's output for white noise (arbitrary units)"""
    H = (fr["AF1"] * bandpass(fr["FF1"], fr["BF1"]) - fr["AF2"] * bandpass(fr["FF2"], fr["BF2"])
         + fr["AF3"] * bandpass(fr["FF3"], fr["BF3"]) + fr["AB"])
    return FB @ (np.abs(H) ** 2) + 1e-30

# fitted vector: log frequencies / bandwidths in bounds (each resonator keeps a role: FF1 low-mid, FF2 mid-high, FF3
# high), log amplitudes (the bypass and resonators can switch off), log of the voice bar's level (voiced)
# (bandwidths from 200 Hz: narrower noise resonances whistle)
BOUNDS = {"FF1": (700, 4500), "FF2": (1500, 8500), "FF3": (4000, 11500), "BF1": (200, 8000), "BF2": (200, 8000),
          "BF3": (200, 8000), "AF1": (1e-6, 3), "AF2": (1e-6, 3), "AF3": (1e-6, 3), "AB": (1e-7, 1)}

def vec(fr):
    return np.array([math.log(np.clip(fr.get(k, 0), *BOUNDS[k])) for k in RES])

def unvec(x):
    fr = {k: float(math.exp(v)) for k, v in zip(RES, x)}
    for k in ("AF1", "AF2", "AF3", "AB"):
        if fr[k] < 3 * BOUNDS[k][0]: fr[k] = 0.0
    return fr


def fit_model(target, band, floor, c, V, L, fr0, voiced, rng, starts=12):
    """least squares of the closed-form model c N + s V + L to the target (dB) -> (frication dict, voice scale s, rms)"""
    lo = np.log([BOUNDS[k][0] for k in RES]); hi = np.log([BOUNDS[k][1] for k in RES])
    if voiced: lo, hi = np.append(lo, math.log(0.01)), np.append(hi, math.log(100))
    tgt = np.maximum(target, floor)[band]
    def resid(x):
        fr = unvec(x[:10]); s = math.exp(x[10]) if voiced else 1.0
        pred = 10 * np.log10(c * path_mel(fr) + s * V + L + 1e-30)
        return np.maximum(pred, floor)[band] - tgt
    x0 = vec(fr0)
    if voiced: x0 = np.append(x0, 0.0)
    best = None
    for k in range(starts):
        x = x0 if k == 0 else np.clip(x0 + rng.normal(0, 1, len(x0)) * np.where(np.arange(len(x0)) % 3 == 2, 1.5, 0.5), lo + 1e-9, hi - 1e-9)
        x = np.clip(x, lo + 1e-9, hi - 1e-9)
        r = least_squares(resid, x, bounds=(lo, hi), x_scale=1.0, diff_step=1e-3, max_nfev=400)
        if best is None or r.cost < best.cost: best = r
    fr = unvec(best.x[:10])
    return fr, (math.exp(best.x[10]) if voiced else 1.0), float(np.sqrt(np.mean(best.fun ** 2)))


MAIN = ["voicing", "F1", "BW1", "A1", "A2", "A3"]
def rnd(e):
    """the fitted fields (FRICATION's), rounded"""
    out = {k: round(float(e[k]), 4) for k in MAIN if k in e}
    out["frication"] = {k: (round(float(v)) if k[0] in "FB" else round(float(v), 5)) for k, v in e["frication"].items() if k in RES + ["FM"]}
    return out

def off(e, voice=True):
    """the entry with the frication path silent (and without its voice, voice=False)"""
    out = {**e, "frication": {**e["frication"], "AF1": 0, "AF2": 0, "AF3": 0, "AB": 0}}
    if not voice: out["A1"] = 0
    return out


# ---------------------------------------------------------------- corpus mode: the corpus itself as the context
def corpus_medians(rows, phones):
    """per fricative: Kokoro's and klattsing's median 40-band spectra (dB re the vowel) over the rows where both say
    it, and Kokoro's median cepstrum floor (dB re the vowel)"""
    out = {}
    for p in phones:
        rs = [r for r in rows if r["p"] == p and r["kp"] == p]
        if not rs: continue
        out[p] = {"K": np.median(np.array([r["K"]["_mel"] for r in rs]), axis=0),
                  "k": np.median(np.array([r["k"]["_mel"] for r in rs]), axis=0),
                  "floor": float(np.median([r["K"]["_floor"] for r in rs])), "n": len(rs)}
    return out

def fit_fields(e):
    """an entry's fitted fields, as a "fricatives.phonemes" override"""
    return {**{k: e[k] for k in MAIN if k in e}, "frication": {k: v for k, v in e["frication"].items() if k in RES + ["FM"]}}

def with_entries(cfg, E):
    fr = cfg.get("fricatives"); fr = {} if fr is True or not isinstance(fr, dict) else dict(fr)
    ph = {p: dict(v) for p, v in (fr.get("phonemes") or {}).items()}
    for p, e in E.items(): ph[p] = {**ph.get(p, {}), **fit_fields(e)}
    return {**cfg, "fricatives": {**fr, "phonemes": ph}}

def derive_zh(fits):
    """ZH (one token in the corpus): SH's spectrum at Z's frication level re S (power over the bands), Z's voice"""
    if not all(p in fits for p in ("SH", "Z", "S")): return None
    pw = lambda fr: float(path_mel(fr).sum())
    k = math.sqrt(pw(fits["Z"]["frication"]) / pw(fits["S"]["frication"]))
    fr = {q: (v * k if q in ("AF1", "AF2", "AF3", "AB") else v) for q, v in fits["SH"]["frication"].items()}
    fr.pop("FM", None)
    return {**{q: fits["Z"][q] for q in MAIN if q in fits["Z"]}, "frication": fr}

def corpus_fit(a, cfg, start):
    """--corpus: each round renders the whole corpus three times through fricscope (as it is, with every fricative's
    frication off, and with their voice off too) and fits each fricative's closed-form model to Kokoro's median
    spectrum, the scale c, the voice V and what leaks in L read from klattsing's median spectra in the corpus"""
    phones = [p for p in a.phones.split(",") if p in start]
    E = {p: fit_fields(start[p]) for p in phones}
    for p in phones:
        if a.murmur is not None and p not in VOICED and E[p].get("voicing", 0) < 1:
            E[p] = {**E[p], "voicing": 1, "F1": a.murmur_f1, "BW1": a.murmur_bw1, "A1": a.murmur, "A2": 0, "A3": 0,
                    "frication": {**E[p]["frication"], "FM": 0}}
    voiced = {p: p in VOICED or E[p].get("voicing", 0) >= 1 for p in phones}
    rng = np.random.default_rng(0)
    run = lambda E2: corpus_medians(FS.run(with_entries(cfg, E2), a.limit), phones)
    silent = lambda e, voice=True: {**e, "frication": {**e["frication"], "AF1": 0, "AF2": 0, "AF3": 0, "AB": 0},
                                    **({} if voice else {"A1": 0})}
    R = run(E)
    def err(p, mel):
        fl = a.floor if a.floor is not None else R[p]["floor"]; band = bands(p)
        return float(np.sqrt(np.mean((np.maximum(mel, fl)[band] - np.maximum(R[p]["K"], fl)[band]) ** 2)))
    bands = lambda p: FS.MEL_F >= (a.fmin if a.fmin is not None else 100 if voiced[p] else 1000)
    first = {p: R[p]["k"] for p in phones if p in R}
    for rd in range(a.rounds):
        Roff = run({p: silent(e) for p, e in E.items()})
        Rleak = run({p: silent(e, False) for p, e in E.items()}) if any(voiced.values()) else Roff
        for p in phones:
            if p not in R: continue
            fl = a.floor if a.floor is not None else R[p]["floor"]
            full, V, L = (10 ** (R[p]["k"] / 10), 10 ** (Roff[p]["k"] / 10), 10 ** (Rleak[p]["k"] / 10))
            if not voiced[p]: L = V
            fric = full - V
            good = fric > 0.5 * full
            if good.sum() < 3: good = np.argsort(-(fric / full))[:8]
            c = float(np.median(full[good] / path_mel(E[p]["frication"])[good]))
            fr, s, mrms = fit_model(R[p]["K"], bands(p), fl, c, np.maximum(V - L, 0), L, {**E[p]["frication"]}, voiced[p], rng)
            E[p] = {**E[p], "frication": {**E[p]["frication"], **fr}}
            if voiced[p]: E[p]["A1"] = float(E[p]["A1"] * math.sqrt(s))
            print(f"  {p} round {rd + 1}: model {mrms:.2f} dB (c {c:.3g}, voice x{math.sqrt(s) if voiced[p] else 1:.2f})", flush=True)
        R = run(E)
        print(f"round {rd + 1}: " + "  ".join(f"{p} {err(p, R[p]['k']):.2f}" for p in phones if p in R), flush=True)
    fits = {p: rnd(E[p]) for p in phones}
    zh = derive_zh(fits)
    if zh and "ZH" not in fits: fits["ZH"] = rnd(zh)
    sel = [i for i in range(40) if i % 3 == 0]
    for p in phones:
        if p not in R: continue
        print(f"{p} (n {R[p]['n']}): rms {err(p, first[p]):.2f} -> {err(p, R[p]['k']):.2f} dB  {json.dumps(fits[p])}")
        print("   band   " + " ".join(f"{FS.MEL_F[i] / 1000:5.1f}" for i in sel))
        print("   kokoro " + " ".join(f"{R[p]['K'][i]:5.0f}" for i in sel))
        print("   before " + " ".join(f"{first[p][i]:5.0f}" for i in sel))
        print("   after  " + " ".join(f"{R[p]['k'][i]:5.0f}" for i in sel), flush=True)
    if a.out: json.dump(fits, open(a.out, "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--kokoro", help="fricscope --rows (synthetic mode: the targets)")
    ap.add_argument("--corpus", action="store_true", help="fit in the corpus (fricscope renders of CONFIG), not in "
                    "synthetic contexts: no --kokoro or --calib needed; the fricatives' medians over the whole corpus")
    ap.add_argument("--limit", type=int, help="--corpus: the first N sentences")
    ap.add_argument("--murmur-f1", type=float, default=200); ap.add_argument("--murmur-bw1", type=float, default=100)
    ap.add_argument("--phones", default=",".join(p for p in FRICS if p != "ZH")); ap.add_argument("--calib")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--fmin", type=float, help="lowest band fitted (default: 1000 Hz voiceless, below which the vowels' "
                    "voicing leaking in dominates, not the frication; 100 Hz voiced, the voice bar)")
    ap.add_argument("--floor", type=float, help="dB re the vowel both sides are held above (default -65; --corpus: "
                    "Kokoro's median cepstrum floor per fricative)"); ap.add_argument("--out")
    ap.add_argument("--start", help="JSON {P: entry fields} over the config's entries to start from")
    ap.add_argument("--murmur", type=float, help="voiceless fricatives get a weak voice (voicing 1, FM 0, F1 200, BW1 100) "
                    "starting at A1 = this, fitted like the voiced ones' voice bar, over the bands from --fmin (default 100)")
    ap.add_argument("--lownoise", type=float, help="voiceless fricatives get low-frequency noise through the main path "
                    "(voicing 0, F1 500, BW1 600: the noise klattsch sends through F1, low-passed by the glottal option's NT) "
                    "starting at A1 = this, its level fitted like the voice bar's, over the bands from --fmin (default 100)")
    ap.add_argument("--ctx", default="corpus", choices=["corpus", "fixed"], help="synthetic contexts: in the corpus's "
                    "proportions of vowel / consonant / pause neighbours per fricative, or CTX")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    if not cfg.get("fricatives"): cfg["fricatives"] = True
    if a.corpus:
        worker = Worker()
        start = worker.resolve(cfg, FRICS)
        if a.start:
            for p, e in json.load(open(a.start)).items():
                start[p] = {**start[p], **{k: v for k, v in e.items() if k != "frication"},
                            "frication": {**start[p].get("frication", {}), **e.get("frication", {})}}
        return corpus_fit(a, cfg, start)
    if a.floor is None: a.floor = -65
    T = kokoro_targets(json.load(open(a.kokoro)))
    calib = (json.load(open(a.calib)) if os.path.exists(a.calib) else json.loads(a.calib)) if a.calib else None
    worker = Worker()
    # the entries as the config's bank resolves them (FRICATION, the option's envelope, coarticulation's loci)
    start = worker.resolve(cfg, FRICS)
    if a.start:
        for p, e in json.load(open(a.start)).items():
            start[p] = {**start[p], **{k: v for k, v in e.items() if k != "frication"},
                        "frication": {**start[p].get("frication", {}), **e.get("frication", {})}}
    rng = np.random.default_rng(0)
    fits = {}
    sel = [i for i in range(40) if i % 3 == 0]
    for p in a.phones.split(","):
        if p not in T or p not in start: continue
        e, dur = start[p], T[p]["dur"]
        if a.murmur is not None and p not in VOICED and e.get("voicing", 0) < 1:
            e = {**e, "voicing": 1, "F1": 200, "BW1": 100, "A1": a.murmur, "A2": 0, "A3": 0, "frication": {**e["frication"], "FM": 0}}
        if a.lownoise is not None and p not in VOICED and e.get("voicing", 0) < 1:
            e = {**e, "voicing": 0, "F1": 500, "BW1": 600, "A1": a.lownoise, "A2": 0, "A3": 0}
        voiced = p in VOICED or a.murmur is not None or a.lownoise is not None
        ctx = contexts_like(T[p]["ctx"]) if a.ctx == "corpus" else CTX
        band = FS.MEL_F >= (a.fmin if a.fmin is not None else 100 if voiced else 1000)
        target = T[p]["mel"].copy()
        if calib is not None:
            target = target + (synth_mel(worker, calib, p, None, dur, ctx) - T[p]["kmel"])
        tgt = np.maximum(target, a.floor)
        err = lambda mel: float(np.sqrt(np.mean((np.maximum(mel, a.floor)[band] - tgt[band]) ** 2)))
        M = synth_mel(worker, cfg, p, e, dur, ctx)
        before, first = err(M), M
        for rd in range(a.rounds):
            V = 10 ** (synth_mel(worker, cfg, p, off(e), dur, ctx) / 10)
            L = 10 ** (synth_mel(worker, cfg, p, off(e, False), dur, ctx) / 10) if voiced else 0 * V
            full = 10 ** (M / 10)
            fric = full - V
            good = fric > 0.5 * full
            if good.sum() < 3: good = np.argsort(-(fric / full))[:8]
            c = float(np.median(full[good] / path_mel(e["frication"])[good]))
            fr, s, mrms = fit_model(target, band, a.floor, c, np.maximum(V - L, 0), L, e["frication"], voiced, rng)
            e = {**e, "frication": {**e["frication"], **fr}}
            if voiced: e["A1"] = float(e["A1"] * math.sqrt(s))
            M = synth_mel(worker, cfg, p, e, dur, ctx)
            print(f"  {p} round {rd + 1}: model {mrms:.2f} dB, rendered {err(M):.2f} dB", flush=True)
        fits[p] = rnd(e)
        print(f"{p}: rms {before:.2f} -> {err(M):.2f} dB  contexts {ctx}  {json.dumps(fits[p])}", flush=True)
        print("   band   " + " ".join(f"{FS.MEL_F[i] / 1000:5.1f}" for i in sel))
        print("   target " + " ".join(f"{tgt[i]:5.0f}" for i in sel))
        print("   before " + " ".join(f"{first[i]:5.0f}" for i in sel))
        print("   after  " + " ".join(f"{M[i]:5.0f}" for i in sel), flush=True)
    if a.out: json.dump(fits, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
