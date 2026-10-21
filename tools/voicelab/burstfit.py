#!/usr/bin/env python3
"""Fit the amplitudes and bandwidths of klattsing's stop-burst templates (stops.js burstTemplate) to Kokoro's bursts,
from stopscope.py rows.

A klattsch burst is noise ((1 - voicing) of it) through the parallel formant bandpasses (klattsch's 0-dB-peak RBJ
biquads at 48 kHz), weighted A1-A3 and summed, after glottal's one-pole noise low-pass (NT dB at 3 kHz). Its
expected spectrum is computed from the filters; what stopscope measures (an 11 ms window at the detected release,
re the vowel's level) differs from it by a per-band amount that depends on the stop (window, the aspiration or
vowel inside a short burst's window, a voiced burst's pulses): calibrated per stop as the median, over the rows'
klattsch bursts, of measured - model, with the entries klattsch rendered (BANK: the config's resolved bank). Then
per stop and vowel class (front: IY IH EY EH AE, F2 >= 1500 Hz at the onset; back: the others), with the template's formant frequencies for
each token's vowel kept, BW1-BW3 and A1-A3 minimise the squared dB difference between the median model and the
median Kokoro burst in 7 bands (0.2-0.7-1.3-2-3-4.5-6.5-10 kHz), bounded (BW 60-2500 Hz, A 0-3). Releases into a
vowel with Kokoro's prominence >= 15 dB (a burst there).

usage: burstfit.py ROWS.json BANK.json [--nt 15] [--json OUT]
  ROWS: stopscope.py CONFIG --rows ROWS.json, with stops: {burstLocus: false} (the template's formants rendered)
"""
import argparse, json, math, os, sys
import numpy as np
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F

SR_SYN = 48000
f = np.fft.rfftfreq(F.NFFT, 1 / F.SR)             # the analysis bins (24 kHz, 1024 points)
z1 = np.exp(-1j * 2 * np.pi * f / SR_SYN)
fb, _ = F.melbank()
centres = (fb * f).sum(1) / fb.sum(1)
GROUPS = [(200, 700), (700, 1300), (1300, 2000), (2000, 3000), (3000, 4500), (4500, 6500), (6500, 10000)]
GM = [(centres >= lo) & (centres < hi) for lo, hi in GROUPS]
FRONT = set("IY IH EY EH AE".split())
VOICED_STOPS = set("B D G".split())

def bp(F0, BW):
    F0 = np.clip(F0, 40, SR_SYN * 0.45); BW = max(BW, 20)
    w0 = 2 * np.pi * F0 / SR_SYN; alpha = np.sin(w0) / (2 * F0 / BW); a0 = 1 + alpha
    b0, b2, a1, a2 = alpha / a0, -alpha / a0, -2 * np.cos(w0) / a0, (1 - alpha) / a0
    return (b0 + b2 * z1 ** 2) / (1 + a1 * z1 + a2 * z1 ** 2)

def tilt_coef(db, hz=3000, sr=SR_SYN):
    if not db > 0: return 0.0
    G = 10 ** (-db / 10); c = math.cos(2 * math.pi * min(hz, sr * 0.49) / sr)
    A, B = 1 - G, 1 - G * c
    return (B - math.sqrt(max(0, B * B - A * A))) / A

def model_db(e, nt):
    """the 40 mel bands (dB, unnormalised) of burst entry e = {F1.., BW1.., A1.., voicing}."""
    a = tilt_coef(nt)
    H = sum(e[f"A{i}"] * bp(e[f"F{i}"], e[f"BW{i}"]) for i in (1, 2, 3)) * (1 - a) / (1 - a * z1) * (1 - e.get("voicing", 0))
    return 10 * np.log10(fb @ (np.abs(H) ** 2) + 1e-20)

def bands(mel): return np.array([np.asarray(mel)[m].mean() for m in GM])

def code_of(r):
    return f"{r['p']}Q{'V' if r['prev'] == 'voiced' and r['p'] in VOICED_STOPS else ''}{r['vowel']}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows"); ap.add_argument("bank"); ap.add_argument("--nt", type=float, default=15)
    ap.add_argument("--json"); ap.add_argument("--min-prominence", type=float, default=15)
    ap.add_argument("--from-hz", type=float, default=1300, help="fit the bands from here up (below 1300: A1, BW1 too)")
    ap.add_argument("--pooled", action="store_true", help="also fit one BW2, BW3 per stop over both vowel classes")
    a = ap.parse_args()
    bank = json.load(open(a.bank))
    rows = [r for r in json.load(open(a.rows)) if r["vowel"] and code_of(r) in bank]
    out = {}
    for p in "PBTDKG":
        Rp = [r for r in rows if r["p"] == p]
        off = np.median([np.array(r["k"]["_mel"]) - model_db(bank[code_of(r)], a.nt) for r in Rp], 0)
        out[p] = {}
        for cls in ("front", "back"):
            R = [r for r in Rp if (r["vowel"] in FRONT) == (cls == "front") and r["K"].get("prominence", 0) >= a.min_prominence]
            if len(R) < 4: continue
            tgt = np.median([bands(r["K"]["_mel"]) for r in R], 0)
            now = np.median([bands(r["k"]["_mel"]) for r in R], 0)
            ents = [dict(bank[code_of(r)]) for r in R]
            # the fitted fields (F1's: only when the loss reaches below 1.3 kHz, where Kokoro's window also holds the
            # voicing that follows its short VOT)
            keys = ["BW1", "BW2", "BW3", "A1", "A2", "A3"] if a.from_hz < 1300 else ["BW2", "BW3", "A2", "A3"]
            use = np.array([lo >= a.from_hz for lo, hi in GROUPS])
            def pred(theta):
                return np.median([bands(model_db({**e, **dict(zip(keys, theta))}, a.nt) + off) for e in ents], 0)
            loss = lambda th: float(((pred(th) - tgt)[use] ** 2).mean())
            e0 = ents[0]
            x_now = np.array([e0[k] for k in keys])
            x0 = np.array([max(e0[k], 0.05) if k[0] == "A" else e0[k] for k in keys])
            bounds = [(60, 2500) if k[0] == "B" else (0, 3) for k in keys]
            alt = np.array([{"BW1": 400, "BW2": 600, "BW3": 1000}.get(k, 0.4) for k in keys])
            best = min((minimize(loss, s, method="L-BFGS-B", bounds=bounds) for s in (x0, alt)), key=lambda r_: r_.fun)
            th = best.x
            out[p][cls] = {**{k: (round(float(v)) if k[0] == "B" else round(float(v), 3)) for k, v in zip(keys, th)}, "n": len(R)}
            print(f"{p} {cls:5s} n {len(R):3d} rms dB now {np.sqrt(((now - tgt)[use] ** 2).mean()):5.2f} model(now) {np.sqrt(loss(x_now)):5.2f} -> fit {np.sqrt(best.fun):5.2f}  "
                  f"{json.dumps(out[p][cls])}   target {np.round(tgt, 1).tolist()} fit {np.round(pred(th), 1).tolist()}")
        if a.pooled and a.from_hz >= 1300:
            # one BW2, BW3 per stop for both vowel classes (A2, A3 per class): fewer free parameters
            cells = []
            for cls in ("front", "back"):
                R = [r for r in Rp if (r["vowel"] in FRONT) == (cls == "front") and r["K"].get("prominence", 0) >= a.min_prominence]
                if len(R) >= 4: cells.append((cls, R, np.median([bands(r["K"]["_mel"]) for r in R], 0), [dict(bank[code_of(r)]) for r in R]))
            if not cells: continue
            use = np.array([lo >= a.from_hz for lo, hi in GROUPS])
            def predc(th, ents, j):
                x = {"BW2": th[0], "BW3": th[1], "A2": th[2 + 2 * j], "A3": th[3 + 2 * j]}
                return np.median([bands(model_db({**e, **x}, a.nt) + off) for e in ents], 0)
            def lossp(th): return float(np.mean([((predc(th, ents, j) - tgt)[use] ** 2).mean() for j, (_, _, tgt, ents) in enumerate(cells)]))
            e0 = cells[0][3][0]
            x0 = [max(e0["BW2"], 100), max(e0["BW3"], 100)] + [0.4, 0.4] * len(cells)
            bounds = [(100, 2000)] * 2 + [(0, 3)] * (2 * len(cells))
            best = min((minimize(lossp, s, method="L-BFGS-B", bounds=bounds) for s in (x0, [600, 1000] + [0.3, 0.3] * len(cells))), key=lambda r_: r_.fun)
            th = best.x
            out[p] = {"BW2": round(float(th[0])), "BW3": round(float(th[1]))}
            for j, (cls, R, tgt, ents) in enumerate(cells):
                out[p][cls] = {"A2": round(float(th[2 + 2 * j]), 3), "A3": round(float(th[3 + 2 * j]), 3), "n": len(R)}
            print(f"{p} pooled: rms dB fit {np.sqrt(best.fun):5.2f}  {json.dumps(out[p])}")
    if a.json: json.dump(out, open(a.json, "w"), indent=1)

if __name__ == "__main__":
    main()
