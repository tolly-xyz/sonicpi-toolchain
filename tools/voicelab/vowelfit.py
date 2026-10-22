#!/usr/bin/env python3
"""Fit the "vowels" option's targets to Kokoro by analysis-by-synthesis (klattsing/src/vowels.js VOWEL_TARGETS).

Each vowel code (the 15 vowels, the reduced AX IX AXR, the r-colored <vowel>QR) has an onset target (F1-F3), an
offset target (glideTo) and a glide window [a, b]: klattsch holds the onset over [0, a] of the vowel, moves to the
offset over [a, b] and holds it to the end, with coarticulation ([CO]) moving the edges toward the neighbouring
consonants' loci on top. One round:
  1. render the corpus with the current entries (as vowels.phonemes over the config), measure every aligned vowel's
     formants at 20/35/50/65/80% in Kokoro and klattsch (tools/voicelab/vowelscope.py) and fidelity's score;
  2. per code, the median paired difference d_q = Kokoro - klattsch at each point (tokens where Kokoro's vowel is the
     code's lexical vowel; weak forms: Kokoro's schwa) says how far the rendered trajectory is off *in context*: the
     same consonants surround both, so what coarticulation and the tracker do to the vowel is on both sides;
  3. per formant, the change of onset and offset that moves the nominal trajectory by d at the five points (least
     squares, ridge 0.1, shrunk by n / (n + 5) for codes with few tokens, at most `--max-step` Hz per round), added to
     the targets. The rendered formants move less than the targets (the loci pull the edges), so it is iterated.
The glide windows: fitted once to Kokoro's own median trajectories (onset/offset least squares over a grid of
windows) for the diphthongs and the r-colored codes; the monophthongs keep klattsch's 0.25-0.75 (their Kokoro
trajectories are mostly the consonants', which coarticulation already gives).

usage: vowelfit.py CONFIG_JSON_OR_FILE [--rounds 4] [--start ENTRIES.json] [--out ENTRIES.json] [--codes AA,AE,..]
                   [--no-windows] [--max-step 250] [--fields F1,F2,F3]
  CONFIG: the speak config the vowels are fitted under (BASE); "vowels" in it is replaced. Prints per round the
  fidelity score and per code n, d at 20/50/80 and MCD; writes the entries (code -> {F1, F2, F3, glideTo, glide}).
"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F
import vowelscope as VS

ROOT = F.ROOT
PTS = np.array(VS.POINTS)
LEX = {"AX": "AH", "IX": "IH", "AXR": "ER"}
def lex(code): return LEX.get(code) or (code[:-2] if code.endswith("QR") else code)
DIPH = {"AY", "AW", "OY", "EY", "OW"}
FS = ("F1", "F2", "F3")
LIMITS = {"F1": (200, 950), "F2": (550, 2700), "F3": (1300, 3400)}

def klatt_bank():
    return json.load(open(os.path.join(ROOT, "vendor", "klattsch", "src", "engine", "banks", "klatt1980-en.json")))["phonemes"]

def initial(codes):
    """entries from klatt1980-en (the reduced / r-colored codes from their lexical vowel; QR: offset F3 1900, late)."""
    k = klatt_bank(); out = {}
    for c in codes:
        e = k[lex(c)]; g = e.get("glideTo", {})
        on = {f: float(e[f]) for f in FS}; off = {f: float(g.get(f, e[f])) for f in FS}
        x = {**on, "glideTo": off}
        if c.endswith("QR"): x["glideTo"]["F3"] = min(off["F3"], 1900.0); x["glide"] = [0.35, 1.0]
        out[c] = x
    # ER: Kokoro's (F2 ~1200, F3 ~1750 Hz, against Klatt's 1270 / 1540): with F2 and F3 300 Hz apart Praat merges them in
    # klattsch's audio, so the paired differences start from Kokoro's own values instead
    for c, on, off in (("ER", (450, 1190, 1780), (420, 1240, 1740)), ("AXR", (436, 1200, 1800), (380, 1330, 1780))):
        if c in out: out[c].update(dict(zip(FS, map(float, on)))); out[c]["glideTo"] = dict(zip(FS, map(float, off)))
    return out

def ramp(w):
    a, b = w
    return np.clip((PTS - a) / (b - a), 0, 1)

def window_of(e): return e.get("glide") or [0.25, 0.75]

def fit_window(K):
    """K: [5, 3] Kokoro's median F1-F3 at PTS -> the window [a, b] whose two-target ramp fits it best (and its
    residual against the default window's)."""
    sc = np.array([1 / 60.0, 1 / 150.0, 1 / 200.0])     # residuals in units of each formant's typical token spread
    def resid(w):
        r = ramp(w); X = np.vstack([1 - r, r]).T
        tot = 0.0
        for j in range(3):
            y = K[:, j]
            if not np.isfinite(y).all(): continue
            c, *_ = np.linalg.lstsq(X, y, rcond=None)
            tot += float(np.sum(((X @ c - y) * sc[j]) ** 2))
        return tot
    best = ([0.25, 0.75], resid([0.25, 0.75])); base = best[1]
    for a in np.arange(0.0, 0.65, 0.05):
        for b in np.arange(a + 0.2, 1.0001, 0.05):
            r = resid([float(a), float(b)])
            if r < best[1] - 1e-9: best = ([round(float(a), 2), round(float(min(b, 1.0)), 2)], r)
    return best[0], best[1], base

def update(e, d, n, max_step, fields, ridge=0.1):
    """entry e, d [5, 3] median paired differences -> e moved by the least-squares onset/offset change."""
    r = ramp(window_of(e)); X = np.vstack([1 - r, r]).T
    shrink = n / (n + 5.0)
    out = json.loads(json.dumps(e))
    for j, f in enumerate(FS):
        if f not in fields: continue
        y = d[:, j]; ok = np.isfinite(y)
        if ok.sum() < 2: continue
        A = X[ok]; c = np.linalg.solve(A.T @ A + ridge * np.eye(2), A.T @ y[ok]) * shrink
        c = np.clip(c, -max_step, max_step)
        lo, hi = LIMITS[f]
        out[f] = float(np.clip(e[f] + c[0], lo, hi))
        out["glideTo"][f] = float(np.clip(e["glideTo"][f] + c[1], lo, hi))
    return out

EXTRA = ("BW1", "BW2", "BW3", "A1", "A2", "A3")
def rounded(entries):
    out = {}
    for c, e in entries.items():
        x = {f: int(round(e[f])) for f in FS}
        x["glideTo"] = {f: int(round(e["glideTo"][f])) for f in FS}
        if e.get("glide"): x["glide"] = [round(float(v), 2) for v in e["glide"]]
        for f in EXTRA:
            if f in e: x[f] = round(float(e[f]), 1 if f.startswith("BW") else 3)
        out[c] = x
    return out

def config_with(config, entries, vowels=None):
    v = dict(vowels or (config.get("vowels") if isinstance(config.get("vowels"), dict) else {}) or {})
    v["phonemes"] = {**v.get("phonemes", {}), **{c: {**{f: e[f] for f in FS + EXTRA if f in e}, "glideTo": e["glideTo"], "glide": e.get("glide")}
                                                for c, e in rounded(entries).items()}}
    return {**config, "vowels": v}

def measure(config, jobs=2, recs=None, tracks=True):
    """one render: fidelity's score (as fidelity.evaluate, audio; relative to {} on the same records) and vowelscope's rows."""
    recs = recs or F.corpus("am_onyx"); shift = F.kokoro_shift("am_onyx")
    KT = VS.kokoro_tracks("am_onyx", F.corpus("am_onyx"))
    dur, per_utt = F.duration_metrics(config, recs, "stop")
    for r in recs: F.kokoro_features(r)
    durs = F._worker.request([F.spec_of(config, r) for r in recs])
    def then(i, tl, y):
        ft, ff = F.f0_track(y)
        return (F.compare_audio(F.klattsing_phones_tl(tl, "stop"), y, ft, ff, recs[i], shift),
                VS.analyse(recs[i], tl, durs[i], y, shift, KT, tracks))
    out = F.render(config, recs, jobs, then)
    spectral, prosody, pu = F.aggregate_audio([a for a, _ in out]); per_utt.update(pu)
    res = {"duration": dur, "spectral": spectral, "prosody": prosody}
    comp = F.components(res, per_utt)
    ref = F.reference(recs, "am_onyx", True, "stop", jobs, shift)
    total, groups, _ = F.score(comp, ref)
    rows = [r for _, v in out for r in v]
    return {"score": total, "scores": groups, "mcd": spectral["mcd"], "mcd_cmn": spectral["mcd_cmn"],
            "vowel": spectral["by_class"]["vowel"], "by_phone": spectral["by_phone"]}, rows

def usable(r):
    return r["kp"] == lex(r["code"]) or (r["code"] == "AX" and r["kp"] == "AH")

def per_code(rows):
    g = {}
    for r in rows:
        if usable(r): g.setdefault(r["code"], []).append(r)
    return g

# ---------------------------------------------------------------- stage 2: the vowels' MCD against Kokoro's
# Parallel coordinate descent: one parameter of every code moved by +delta (one render) and by -delta (another);
# each code keeps the best of -delta / 0 / +delta by its own vowels' summed mcd + mcd_cmn (a code's entry mostly
# shapes its own vowels; the full score checks the joint move). Parameters: onset F1-F3, offset gF1-gF3 (glideTo),
# the glide window ga / gb, and (multiplicative) A2, A3, BW1, BW2, BW3.
DELTA = {"F1": 30, "F2": 80, "F3": 120, "gF1": 30, "gF2": 80, "gF3": 120, "ga": 0.1, "gb": 0.1,
         "A2": 0.15, "A3": 0.15, "BW1": 0.2, "BW2": 0.2, "BW3": 0.2}
def base_entry(code):
    return klatt_bank()[lex(code)]

def moved(e, code, p, dx):
    e = json.loads(json.dumps(e))
    if p in FS:
        lo, hi = LIMITS[p]; e[p] = float(np.clip(e[p] + dx, lo, hi))
    elif p.startswith("gF"):
        f = p[1:]; lo, hi = LIMITS[f]; e["glideTo"][f] = float(np.clip(e["glideTo"][f] + dx, lo, hi))
    elif p in ("ga", "gb"):
        a, b = e.get("glide") or [0.25, 0.75]
        if p == "ga": a = float(np.clip(a + dx, 0, b - 0.15))
        else: b = float(np.clip(b + dx, a + 0.15, 1))
        e["glide"] = [round(a, 3), round(b, 3)]
    else:
        v = e.get(p, base_entry(code)[p]); e[p] = float(v * (1 + dx))
    return e

def probe(cfg, entries, vopt, recs, jobs=2):
    """per code: (sum of mcd + mcd_cmn over its usable vowels, n), and the overall mean mcd / mcd_cmn of all segments"""
    res, rows = measure(config_with(cfg, entries, vopt), jobs, recs, tracks=False)
    J = {}
    for r in rows:
        if not usable(r) or not np.isfinite(r["mcd"]): continue
        j = J.setdefault(r["code"], [0.0, 0]); j[0] += r["mcd"] + r["mcd_cmn"]; j[1] += 1
    return J, res

def mcd_stage(cfg, entries, vopt, recs, held, params, sweeps, movable, scale=1.0, log=None, jobs=2):
    J0, res0 = probe(cfg, entries, vopt, recs, jobs)
    print(f"mcd stage start: train score {res0['score']:.4f} spec {res0['scores']['spec']:.3f} vowels {res0['vowel'][0]:.4f}/{res0['vowel'][1]:.4f}", flush=True)
    best_score, best = res0["score"], json.loads(json.dumps(entries))
    for sw in range(sweeps):
        for p in params:
            d = DELTA[p] * scale
            codes = [c for c in entries if c in J0 and (movable is None or c in movable)]
            Jp, _ = probe(cfg, {c: (moved(e, c, p, d) if c in codes else e) for c, e in entries.items()}, vopt, recs, jobs)
            Jm, _ = probe(cfg, {c: (moved(e, c, p, -d) if c in codes else e) for c, e in entries.items()}, vopt, recs, jobs)
            moves = {}
            for c in codes:
                f0, fp, fm = J0[c][0], Jp.get(c, [np.inf])[0], Jm.get(c, [np.inf])[0]
                curv = fp - 2 * f0 + fm
                if curv > 1e-9: x = float(np.clip(0.5 * (fm - fp) / curv, -1, 1))       # the parabola's minimum
                else: x = 1.0 if fp < fm else -1.0
                if min(fp, fm) >= f0 and curv > 1e-9 and abs(x) < 0.25: continue
                if min(fp, fm) >= f0 and not curv > 1e-9: continue
                moves[c] = x * d
            trial = {c: (moved(e, c, p, moves[c]) if c in moves else e) for c, e in entries.items()}
            Jt, rest = probe(cfg, trial, vopt, recs, jobs)
            gain = sum(J0[c][0] - Jt.get(c, J0[c])[0] for c in J0) / max(1, sum(v[1] for v in J0.values()))
            line = (f"sweep {sw} {p:4s} d {d:g}: {len(moves)} codes moved, train score {res0['score']:.4f} -> {rest['score']:.4f} "
                    f"(spec {res0['scores']['spec']:.3f} -> {rest['scores']['spec']:.3f}, pros {res0['scores']['pros']:.3f} -> {rest['scores']['pros']:.3f}), "
                    f"vowels {rest['vowel'][0]:.4f}/{rest['vowel'][1]:.4f}, per-vowel gain {gain:+.4f}  "
                    + " ".join(f"{c}{moves[c]:+.3g}" for c in sorted(moves)))
            if rest["score"] >= res0["score"] - 0.002:
                entries, J0, res0 = trial, Jt, rest
                if rest["score"] > best_score: best_score, best = rest["score"], json.loads(json.dumps(entries))
            else: line += "  (rejected)"
            print(line, flush=True)
            if log: json.dump(rounded(entries), open(log, "w"), indent=1)
    if held:
        rh, _ = measure(config_with(cfg, best, vopt), jobs, held, tracks=False)
        print(f"held-out: score {rh['score']:.4f} {json.dumps({k: round(v, 3) for k, v in rh['scores'].items()})} vowels {rh['vowel'][0]:.4f}/{rh['vowel'][1]:.4f}", flush=True)
    return best

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--start"); ap.add_argument("--out")
    ap.add_argument("--codes", help="only these codes move (default: all with tokens)")
    ap.add_argument("--no-windows", action="store_true"); ap.add_argument("--max-step", type=float, default=250)
    ap.add_argument("--fields", default="F1,F2,F3"); ap.add_argument("--vowels", help="vowels option fields (JSON) besides phonemes")
    ap.add_argument("--min-n", type=int, default=3)
    ap.add_argument("--mcd", type=int, default=0, help="then this many sweeps of the MCD stage (on the train split)")
    ap.add_argument("--params", default="F1,F2,F3,gF1,gF2,gF3", help="MCD stage parameters (" + ",".join(DELTA) + ")")
    ap.add_argument("--scale", type=float, default=1.0, help="MCD stage: deltas times this")
    ap.add_argument("--all", action="store_true", help="MCD stage on all 100 sentences (default: climb.py's train split, held-out reported)")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    vopt = json.loads(a.vowels) if a.vowels else {}
    sys.path.insert(0, HERE)
    codes = "AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW AX IX AXR AAQR AEQR AHQR AOQR EHQR IHQR IYQR UHQR UWQR".split()
    entries = initial(codes)
    if a.start: entries.update(json.load(open(a.start)))
    movable = set(a.codes.split(",")) if a.codes else None
    fields = set(a.fields.split(","))
    hist = []
    for rnd in range(a.rounds + 1 if a.rounds >= 0 else 0):
        res, rows = measure(config_with(cfg, entries, vopt))
        G = per_code(rows)
        print(f"round {rnd}: score {res['score']:.4f} {json.dumps({k: round(v, 3) for k, v in res['scores'].items()})} "
              f"mcd {res['mcd']:.4f} cmn {res['mcd_cmn']:.4f} vowels {res['vowel'][0]:.4f}/{res['vowel'][1]:.4f}", flush=True)
        hist.append((res["score"], json.loads(json.dumps(entries))))
        if rnd == 0 and not a.no_windows:
            for c, rs in G.items():
                if (c in DIPH or c.endswith("QR")) and len(rs) >= 4 and (movable is None or c in movable):
                    K = np.nanmedian(np.array([r["K"] for r in rs]), 0)
                    w, rw, r0 = fit_window(K)
                    print(f"   window {c}: {w} (residual {rw:.2f} vs {r0:.2f} at 0.25-0.75)")
                    if rw < 0.7 * r0: entries[c]["glide"] = w
        for c, rs in sorted(G.items()):
            K = np.array([r["K"] for r in rs]); k = np.array([r["k"] for r in rs])
            with np.errstate(all="ignore"): d = np.nanmedian(K - k, 0)
            mc = np.nanmean([r["mcd"] for r in rs]); mm = np.nanmean([r["mcd_cmn"] for r in rs])
            print(f"   {c:5s} n {len(rs):3d} mcd {mc:.2f}/{mm:.2f}  d20 {d[0].round().astype(int).tolist()} d50 {d[2].round().astype(int).tolist()} d80 {d[4].round().astype(int).tolist()}", flush=True)
            if rnd < a.rounds and len(rs) >= a.min_n and (movable is None or c in movable):
                entries[c] = update(entries[c], d, len(rs), a.max_step, fields)
        if a.out: json.dump(rounded(entries), open(a.out, "w"), indent=1)
    if a.rounds >= 0 and hist:
        best = max(hist, key=lambda x: x[0])
        print(f"best round score {best[0]:.4f}")
        if a.out: json.dump(rounded(best[1]), open(a.out.replace(".json", ".best.json"), "w"), indent=1)
        entries = best[1]
    if a.mcd:
        import climb
        train, held = (F.corpus("am_onyx"), None) if a.all else climb.split()
        entries = mcd_stage(cfg, entries, vopt, train, held, a.params.split(","), a.mcd, movable, a.scale,
                            a.out.replace(".json", ".mcd.json") if a.out else None)
        if a.out: json.dump(rounded(entries), open(a.out.replace(".json", ".mcd.best.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
