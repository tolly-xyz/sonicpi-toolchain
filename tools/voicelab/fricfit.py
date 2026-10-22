#!/usr/bin/env python3
"""Fit the "fricatives" option's per-fricative entries (klattsing/src/fricatives.js FRICATION: the frication path's
resonators and bypass, and for the voiced ones the voice bar) to Kokoro's fricative spectra.

Targets: Kokoro's median mean-spectrum per fricative from fricscope.py --rows (40 mel bands, dB re the reference
vowel's 60-11000 Hz level; the K side of the rows). Each candidate is rendered in vowel contexts (klattsing's prefix
for CONFIG, the entry laid over the config's resolved one through tools/voicelab/render_worker.mjs; the fricative at
its median klattsing duration in the rows, between vowels / before a stop / after a pause, as often as in the
corpus) and measured with fricscope's own analysis; the error is the RMS dB difference over the mel bands from
--fmin to 11 kHz, both sides held above --floor dB (fidelity's cepstrum floor is ~-60 to -65 dB re the vowel there).

Synthetic contexts are not the corpus's sentences, so the target is calibrated: --calib CALIB_CONFIG with --kokoro
ROWS rendered from it (fricscope --rows CALIB_CONFIG): target = Kokoro's spectrum + (CALIB_CONFIG's fricative in
the synthetic contexts - its median in the corpus rows), per band. Pass 1 calibrates on BASE; pass 2 on BASE with
pass 1's entries, so it fits what the corpus still lacks.

usage: fricfit.py CONFIG --kokoro ROWS.json [--calib CALIB_CONFIG] [--phones S,Z,...] [--start FIT.json] [--maxfev 600]
                  [--out FIT.json]
  prints per fricative the RMS error before / after and the fitted entry (JSON, for FRICATION).
"""
import argparse, base64, collections, json, math, os, subprocess, sys, threading
import numpy as np
from scipy.optimize import minimize
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F
import fricscope as FS

ROOT = F.ROOT
FRICS = ["F", "V", "TH", "DH", "S", "Z", "SH", "ZH"]
VOICED = {"V", "DH", "Z", "ZH"}
RES = ["FF1", "BF1", "AF1", "FF2", "BF2", "AF2", "FF3", "BF3", "AF3", "AB"]


class Worker:
    def __init__(self):
        self.p = subprocess.Popen(["node", os.path.join(HERE, "render_worker.mjs")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, cwd=ROOT)
        self.lock = threading.Lock()

    def render(self, config, body, entries=None, ms=None):
        with self.lock:
            self.p.stdin.write(json.dumps({"config": config, "entries": entries or {}, "body": body, "sr": 48000, "ms": ms}) + "\n")
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


def contexts(p, n_vv=3, n_vc=1, n_pv=1):
    """[(before, after)] phone contexts: vowel_vowel, vowel_stop, pause_vowel"""
    vv = [("AA", "AH"), ("IY", "IH"), ("AE", "ER"), ("UW", "EH"), ("AH", "IY"), ("EH", "AA")][:n_vv]
    vc = [("AE", "T"), ("IH", "T")][:n_vc]
    pv = [(None, "IY"), (None, "AA")][:n_pv]
    return vv + vc + pv


def body(prev, p, nxt, dur, vdur=140, pitch=100):
    s = f"b{pitch} "
    if prev: s += f"r{vdur} {prev} "
    else: s += "p120 "
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

FB = None
def lean_mel(side, s, e, ref):
    """fricscope.measure's _mel (40 mel bands of the middle 60%, dB re the vowel's 60-11000 Hz level) and level"""
    global FB
    if FB is None: FB = F.melbank()[0]
    d = e - s
    P = side.spec(s + 0.2 * d, e - 0.2 * d)
    return 10 * np.log10(FB @ P + 1e-20) - ref[0], FS.db(P[FS.M_ALL].sum()) - ref[0]

def synth_mel(worker, config, p, entry, dur, ctxs):
    """median over contexts of fricscope's mel spectrum re the vowel (the vowel after, else before), and the levels"""
    mels, levels = [], []
    for prev, nxt in ctxs:
        t0 = (0.12 if prev is None else 0.14)
        y = worker.render(config, body(prev, p, nxt, dur), {p: entry} if entry else None, ms=1000 * t0 + dur + 140)
        side = Lean(y)
        t0 = (0.12 if prev is None else 0.14)
        s, e = t0, t0 + dur / 1000
        ph = [{"p": prev or "pau", "start": t0 - (0.14 if prev else 0.12), "end": t0}, {"p": p, "start": s, "end": e},
              {"p": nxt, "start": e, "end": e + (0.14 if nxt in F.VOWELS else 0.06)}]
        ref = FS.vowel_ref(side, ph, 2) if nxt in F.VOWELS else FS.vowel_ref(side, ph, 0)
        m, lv = lean_mel(side, s, e, ref)
        mels.append(m); levels.append(lv)
    return np.median(np.array(mels), axis=0), levels


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


# parameter vector <-> entry
def pack(p, e):
    fr = e["frication"]
    x = []
    for i in (1, 2, 3):
        x += [math.log(fr[f"FF{i}"]), math.log(fr[f"BF{i}"]), math.log(max(fr[f"AF{i}"], 1e-5))]
    x.append(math.log(max(fr.get("AB", 0), 1e-5)))
    if p in VOICED: x += [math.log(e["A1"]), math.log(e["F1"]), math.log(e["BW1"])]
    return np.array(x)


def unpack(p, x, e0):
    e = {k: v for k, v in e0.items() if k != "frication"}
    fr = dict(e0["frication"])
    for i in (1, 2, 3):
        f, bw, a = x[3 * (i - 1):3 * i]
        fr[f"FF{i}"] = float(np.clip(math.exp(f), 200, 11500)); fr[f"BF{i}"] = float(np.clip(math.exp(bw), 50, 12000))
        fr[f"AF{i}"] = float(math.exp(a)) if a > math.log(2e-5) else 0.0
    fr["AB"] = float(math.exp(x[9])) if x[9] > math.log(2e-5) else 0.0
    if p in VOICED:
        e["A1"] = float(math.exp(x[10])); e["F1"] = float(np.clip(math.exp(x[11]), 120, 600)); e["BW1"] = float(np.clip(math.exp(x[12]), 40, 400))
    e["frication"] = fr
    return e


MAIN = ["voicing", "F1", "BW1", "A1", "A2", "A3"]
def rnd(e):
    """the fitted fields (FRICATION's), rounded"""
    out = {k: round(float(e[k]), 4) for k in MAIN if k in e}
    out["frication"] = {k: (round(float(v)) if k[0] in "FB" else round(float(v), 5)) for k, v in e["frication"].items() if k in RES}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--kokoro", required=True)
    ap.add_argument("--phones", default=",".join(FRICS)); ap.add_argument("--calib")
    ap.add_argument("--maxfev", type=int, default=600); ap.add_argument("--fmin", type=float, default=100)
    ap.add_argument("--floor", type=float, default=-65); ap.add_argument("--out")
    ap.add_argument("--start", help="JSON {P: entry} to start from (default: klattsing's FRICATION)")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    if not cfg.get("fricatives"): cfg["fricatives"] = True
    rows = json.load(open(a.kokoro))
    T = kokoro_targets(rows)
    calib = (json.load(open(a.calib)) if os.path.exists(a.calib) else json.loads(a.calib)) if a.calib else None
    band = FS.MEL_F >= a.fmin
    worker = Worker()
    # the entries as the config's bank resolves them (FRICATION, the option's envelope, coarticulation's loci), with
    # --start's fields over them
    start = worker.resolve(cfg, FRICS)
    if a.start:
        for p, e in json.load(open(a.start)).items():
            start[p] = {**start[p], **{k: v for k, v in e.items() if k != "frication"},
                        "frication": {**start[p].get("frication", {}), **e.get("frication", {})}}
    fits = {}
    for p in a.phones.split(","):
        if p not in T or p not in start: continue
        e0 = start[p]
        dur = T[p]["dur"]
        ctx = contexts(p)
        base_mel, _ = synth_mel(worker, cfg, p, e0, dur, ctx)
        target = T[p]["mel"].copy()
        if calib is not None:
            # Kokoro + (the calibration config's fricative here - the same in the corpus rows)
            cal, _ = synth_mel(worker, calib, p, None, dur, ctx)
            target = target + (cal - T[p]["kmel"])
        tgt = np.maximum(target, a.floor)
        err = lambda mel: float(np.sqrt(np.mean((np.maximum(mel, a.floor)[band] - tgt[band]) ** 2)))
        e_before = err(base_mel)
        x0 = pack(p, e0)
        cache = {}
        def f(x):
            k = tuple(np.round(x, 6))
            if k not in cache:
                mel, _ = synth_mel(worker, cfg, p, unpack(p, x, e0), dur, ctx)
                cache[k] = err(mel)
            return cache[k]
        step = np.array([0.3, 0.4, 0.7] * 3 + [0.7] + ([0.5, 0.2, 0.3] if p in VOICED else []))
        sim = [x0] + [x0 + np.eye(len(x0))[i] * step[i] for i in range(len(x0))]
        r = minimize(f, x0, method="Nelder-Mead", options={"maxfev": a.maxfev, "initial_simplex": np.array(sim), "xatol": 1e-3, "fatol": 1e-3})
        best = unpack(p, r.x, e0)
        mel, _ = synth_mel(worker, cfg, p, best, dur, ctx)
        fits[p] = rnd(best)
        print(f"{p}: rms {e_before:.2f} -> {err(mel):.2f} dB ({r.nfev} renders)  {json.dumps(fits[p])}", flush=True)
        sel = [i for i in range(40) if band[i] and (i % 3 == 0)]
        print("   band   " + " ".join(f"{FS.MEL_F[i] / 1000:5.1f}" for i in sel))
        print("   target " + " ".join(f"{tgt[i]:5.0f}" for i in sel))
        print("   before " + " ".join(f"{base_mel[i]:5.0f}" for i in sel))
        print("   after  " + " ".join(f"{mel[i]:5.0f}" for i in sel), flush=True)
    if a.out: json.dump(fits, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
