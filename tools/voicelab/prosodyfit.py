#!/usr/bin/env python3
"""Fit klattsing's "prosody" option (pitch accents, downstep, declination, phrase-final lowering) to Kokoro's F0.

usage (/home/user/tts/venv/bin/python):
  prosodyfit.py measure CONFIG_JSON [--split train|held|all]          proxy F0 metrics of a speak config
  prosodyfit.py fit BASE_JSON [--evals N] [--start PROSODY_JSON] [--free k1,k2,...] [--out FILE] [--split train|phrasing]
  prosodyfit.py check CONFIG_JSON                                   fidelity.py --audio prosody on train and held-out

A proxy of fidelity.py's prosody group, ~50x faster: instead of rendering audio and running Praat, the F0 klattsch
will render is read off the compiled schedule (tools/voicelab/prosody_f0.mjs: the synth's F0 transitions, voiced
where the voicing parameter is >= 0.5 with some amplitude). It is compared with Kokoro's F0 exactly as fidelity.py
compare_audio does (aligned non-final phones, Kokoro frames mapped piecewise-linearly into klattsing time, semitones
re each one's median): r, r_detrended, rmse_st, sd_ratio, and the pros score (the mean z of 1 - r, rmse_st,
1 - r_detrended against config {} on the same sentences, as fidelity's). Fitting maximises the proxy pros score on
the train split (tools/voicelab/climb.py split) by Nelder-Mead over the free parameters (bounded by clipping);
`check` scores the result with fidelity.py itself (audio, Praat) on both splits.
"""
import argparse, json, math, os, subprocess, sys, threading, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F  # noqa: E402
import climb as C     # noqa: E402

ROOT = F.ROOT
HELPER = os.path.join(HERE, "prosody_f0.mjs")
# fittable parameters: (lower, upper, initial step). `top` only shifts the whole contour, which the F0 metrics
# (semitones re each side's median) cannot see: it is set from median_st (`check`), not fitted, so it is left out
# of the default free set (FREE). continuation, question and reset have nothing to fit on in the Harvard corpus (one
# comma, no question): tools/voicelab/phrasing.py has a Kokoro set for them (--split phrasing).
SPACE = {"accent": (0, 10, 1.0), "downstep": (0.3, 1.2, 0.1), "nuclear": (0, 3, 0.2), "peak": (-0.6, 1.5, 0.15),
         "rise": (10, 500, 40), "fall": (40, 800, 50), "declination": (0, 10, 1.0), "initial": (-4, 10, 1.0),
         "initialMs": (10, 1000, 30), "final": (-4, 10, 1.0), "finalFrom": (0, 1, 0.3), "micro": (-2, 6, 0.5),
         "microMs": (10, 300, 30), "dip": (-2, 4, 0.5), "top": (-4, 8, 1.0),
         # phrasing (fit them with --split phrasing --free continuation,reset)
         "continuation": (-6, 8, 1.0), "question": (0, 12, 1.0), "reset": (0, 1, 0.2)}
FREE = [k for k in SPACE if k not in ("top", "continuation", "question", "reset")]

class Worker:
    def __init__(self, n=2):
        self.ps = [None] * n; self.lock = [threading.Lock() for _ in range(n)]
    def _req(self, i, specs):
        with self.lock[i]:
            if self.ps[i] is None or self.ps[i].poll() is not None:
                self.ps[i] = subprocess.Popen(["node", HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)
            p = self.ps[i]; p.stdin.write(json.dumps(specs) + "\n"); p.stdin.flush(); line = p.stdout.readline()
        out = json.loads(line)
        if isinstance(out, dict): raise RuntimeError(out.get("error"))
        return out
    def request(self, specs):
        n = len(self.ps); parts = [specs[k::n] for k in range(n)]; res = [None] * n
        th = [threading.Thread(target=lambda k=k: res.__setitem__(k, self._req(k, parts[k]))) for k in range(n)]
        for t in th: t.start()
        for t in th: t.join()
        out = [None] * len(specs)
        for k in range(n):
            for j, r in enumerate(res[k]): out[k + j * n] = r
        return out
W = Worker()

def f0_compare(sys_ph, ft, ff, rec, shift):
    """fidelity.compare_audio's F0 part: -> (kokoro st, system st, kokoro times) or None."""
    Kph = F.kokoro_phones(rec, shift)
    pairs = [(a, b) for a, b in F.align([x["p"] for x in sys_ph], [x["p"] for x in Kph]) if not Kph[b]["last"]]
    if not pairs: return None
    aK = np.array([t for a, b in pairs for t in (Kph[b]["start"], Kph[b]["end"])])
    ak = np.array([t for a, b in pairs for t in (sys_ph[a]["start"], sys_ph[a]["end"])])
    o = np.argsort(aK, kind="stable"); aK, ak = aK[o], np.maximum.accumulate(ak[o])
    KF = np.array(rec["f0"]); kt, kf = KF[:, 0], KF[:, 1]
    inside = np.zeros(len(kt), bool)
    for a, b in pairs: inside |= (kt >= Kph[b]["start"]) & (kt < Kph[b]["end"])
    j = np.clip(np.round((np.interp(kt, aK, ak) - ft[0]) / 0.01).astype(int), 0, len(ft) - 1)
    kv, vk = ff[j], ff[ff > 0]
    m = inside & (kf > 0) & (kv > 0)
    if m.sum() < 3 or not len(vk): return None
    return 12 * np.log2(kf[m] / rec["f0_median"]), 12 * np.log2(kv[m] / np.median(vk)), kt[m]

def proxy(config, recs, voice="am_onyx"):
    shift = F.kokoro_shift(voice)
    res = W.request([F.spec_of(config, r) for r in recs])
    per = {"f0_r": [], "f0_rmse": [], "f0_r_dt": []}; A1, A2 = [], []
    for rec, x in zip(recs, res):
        sys_ph = F.klattsing_phones_tl({"phones": x["phones"]})
        ff = np.array(x["f0"], float); ft = np.arange(len(ff)) * 0.01
        c = f0_compare(sys_ph, ft, ff, rec, shift)
        if c is None: continue
        a1, a2, tt = c; A1.append(a1); A2.append(a2)
        per["f0_rmse"].append(float(np.sqrt(np.mean((a1 - a2) ** 2))))
        if len(a1) >= 10: per["f0_r"].append(F.pearson(a2, a1)); per["f0_r_dt"].append(F.detrended_r(tt, a2, a1))
    A1, A2 = np.concatenate(A1), np.concatenate(A2)
    for k in per: per[k] = [v for v in per[k] if np.isfinite(v)]
    return {"r": float(np.mean(per["f0_r"])), "r_detrended": float(np.mean(per["f0_r_dt"])),
            "rmse_st": float(np.sqrt(np.mean((A1 - A2) ** 2))), "sd_ratio": float(A2.std() / A1.std()), "per": per}

_ref = {}
def pros_score(p, recs, voice="am_onyx"):
    """fidelity's pros group (mean z of 1 - r, rmse_st, 1 - r_detrended) against config {} on recs, by the proxy."""
    key = (voice, tuple(r["id"] for r in recs))
    if key not in _ref:
        q = proxy({}, recs, voice)
        _ref[key] = {"1-r": (1 - q["r"], np.std(q["per"]["f0_r"])), "rmse": (q["rmse_st"], np.std(q["per"]["f0_rmse"])),
                     "1-r_dt": (1 - q["r_detrended"], np.std(q["per"]["f0_r_dt"]))}
    ref = _ref[key]
    vals = {"1-r": 1 - p["r"], "rmse": p["rmse_st"], "1-r_dt": 1 - p["r_detrended"]}
    z = {k: (ref[k][0] - v) / ref[k][1] for k, v in vals.items()}
    return float(np.mean(list(z.values()))), z

def brief(p, s=None):
    out = {k: round(p[k], 4) for k in ("r", "r_detrended", "rmse_st", "sd_ratio")}
    if s is not None: out["pros"] = round(s, 4)
    return out

def splits(voice):
    """train / held (climb.py split), all (the Harvard corpus), phrasing (tools/voicelab/phrasing.py: commas,
    questions; when built)."""
    tr, he = C.split(voice)
    out = {"train": tr, "held": he, "all": F.corpus(voice)}
    import phrasing
    if os.path.exists(os.path.join(phrasing.OUT, "index.json")): out["phrasing"] = phrasing.load(voice)
    return out

def cmd_measure(a):
    cfg = json.loads(open(a.config).read() if os.path.exists(a.config) else a.config)
    S = splits(a.voice)
    for name in (a.split.split(",")):
        p = proxy(cfg, S[name], a.voice); s, z = pros_score(p, S[name], a.voice)
        print(name, json.dumps(brief(p, s)), json.dumps({k: round(v, 3) for k, v in z.items()}))

def cmd_fit(a):
    base = json.loads(open(a.base).read() if os.path.exists(a.base) else a.base)
    start = json.loads(a.start) if a.start else {}
    pros0 = base.get("prosody") if isinstance(base.get("prosody"), dict) else {}
    S = splits(a.voice); train = S[a.split]
    free = a.free.split(",") if a.free else FREE
    js = ("const p = await import('./klattsing/src/prosody.js'); console.log(JSON.stringify(p.PROSODY))")
    D = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, cwd=ROOT, check=True).stdout)
    x0 = {**D, **pros0, **start}
    lo = np.array([SPACE[k][0] for k in free]); hi = np.array([SPACE[k][1] for k in free]); step = np.array([SPACE[k][2] for k in free])
    def cfg_of(v):
        pr = dict(x0)
        for k, val in zip(free, v): pr[k] = round(float(np.clip(val, SPACE[k][0], SPACE[k][1])), 4)
        return {**base, "prosody": pr}
    cache, log = {}, []
    def f(v):
        c = cfg_of(v); key = json.dumps(c["prosody"], sort_keys=True)
        if key not in cache:
            p = proxy(c, train, a.voice); s, _ = pros_score(p, train, a.voice)
            cache[key] = (s, p); log.append((s, c["prosody"]))
            if len(cache) % 10 == 0: print(f"eval {len(cache)} best {max(x[0] for x in log):.4f}", flush=True)
        return -cache[key][0]
    from scipy.optimize import minimize
    v0 = np.array([x0[k] for k in free], float)
    t0 = time.time()
    best = None
    for rnd_ in range(a.restarts):
        r = minimize(f, v0, method="Nelder-Mead", options={"maxfev": a.evals, "initial_simplex": np.vstack([v0] + [v0 + np.eye(len(free))[i] * step[i] for i in range(len(free))]), "xatol": 1e-3, "fatol": 1e-4})
        v0 = np.clip(r.x, lo, hi)
        if best is None or r.fun < best[0]: best = (r.fun, v0.copy())
        print(f"round {rnd_}: train pros {-r.fun:.4f} ({len(cache)} evals, {time.time() - t0:.0f} s)", flush=True)
    c = cfg_of(best[1])
    out = {"prosody": c["prosody"], "free": free, "evals": len(cache)}
    for name in ([a.split] if a.split not in ("train", "held") else []) + ["train", "held"]:
        p = proxy(c, S[name], a.voice); s, z = pros_score(p, S[name], a.voice)
        p0 = proxy(base, S[name], a.voice); s0, _ = pros_score(p0, S[name], a.voice)
        out[name] = {"fit": brief(p, s), "base": brief(p0, s0)}
    print(json.dumps(out, indent=1))
    if a.out: json.dump(out, open(a.out, "w"), indent=1)

def cmd_check(a):
    cfg = json.loads(open(a.config).read() if os.path.exists(a.config) else a.config)
    S = splits(a.voice)
    shift = F.kokoro_shift(a.voice)
    for name in ("train", "held"):
        # as climb.evaluate_recs (relative to config {} on the same sentences), one render
        res, per_utt = F._measure(cfg, S[name], True, "stop", 2, shift)
        comp = F.components(res, per_utt)
        ref = F.reference(S[name], a.voice, True, "stop", 2, shift, comp if cfg == {} else None)
        total, groups, _ = F.score(comp, ref)
        p = res["prosody"]
        print(name, json.dumps({"score": round(total, 4), "scores": {k: round(v, 4) for k, v in groups.items()},
                                **{k: round(p[k], 4) for k in ("r", "r_detrended", "rmse_st", "sd_ratio", "median_st")},
                                "mcd": round(res["spectral"]["mcd"], 4), "mcd_cmn": round(res["spectral"]["mcd_cmn"], 4)}), flush=True)

def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default="am_onyx")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("measure"); e.add_argument("config"); e.add_argument("--split", default="train,held")
    f = sub.add_parser("fit"); f.add_argument("base"); f.add_argument("--evals", type=int, default=400)
    f.add_argument("--start"); f.add_argument("--free"); f.add_argument("--out"); f.add_argument("--restarts", type=int, default=2)
    f.add_argument("--split", default="train", help="the sentences to fit on (default train; phrasing: the comma/question set)")
    c = sub.add_parser("check"); c.add_argument("config")
    a = ap.parse_args(argv)
    {"measure": cmd_measure, "fit": cmd_fit, "check": cmd_check}[a.cmd](a)

if __name__ == "__main__":
    main(sys.argv[1:])
