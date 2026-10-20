#!/usr/bin/env python3
"""Hill-climbing klattsing toward Kokoro, scored by tools/voicelab/fidelity.py (no Whisper).

usage (run with /home/user/tts/venv/bin/python, from anywhere):
  climb.py durations [--evals N] [--phones 39] [--prior 0.002] [--function-words auto|on|off] [--voice am_onyx]
                     [--out klattsing/presets/kokoro-durations.json] [--report work/voicelab/climb/durations-fit.json]
  climb.py voice [--evals N] [--resume] [--state work/voicelab/climb/state.json] [--lambda 4] [--mutate 2]
                 [--base PRESET] [--space SPACE] [--limit N] [--jobs 2] [--held accept|end|never] [--seed S]
                 [--out klattsing/presets/kokoro-voice.json]
  climb.py split         the train / held-out sentence split (JSON)
  climb.py selftest      bookkeeping checks (a few seconds, no audio)

Split: 20% of the corpus sentences are held out, chosen by sha1 of the sentence id (h01, h02, ... without the
voice), so the split is the same for both voices and every run. Train = the rest (in corpus order).

1. durations: fits klattsing's duration model to Kokoro's phone durations. Parameters: every factor of
   klattsing/src/durations.js RULES (MITalk ch. 9 rules 2-11, aspirationMs included) and the [inherent, minimum]
   ms (phones.js DUR, set per call with the phoneDur option) of the --phones most frequent phonemes in the train
   sentences. All in log space around the published values: rule = R0 e^u, INH = INH0 e^a, MIN = INH sigmoid(b)
   (so MIN < INH), with bounds. Objective = mean over aligned train phones of ln(d_klattsing / d_kokoro)^2 (the
   square of fidelity's dur log_rmse: same alignment, utterance-final Kokoro phone out, aspiration in the stop) +
   prior * (sum u^2 + sum a^2 + sum ln(MIN/MIN0)^2) (a mild pull toward the published values). L-BFGS-B with a
   central-difference gradient: the 2P+1 configs of one gradient go to the klattsing --serve --durations worker
   as one request (~1.4 s for 59 parameters x 80 sentences, ~2.5 s for 97). --evals: the budget in configs per
   fit (one gradient = 2P+1); the objective plateaus after ~30-40 gradients, and L-BFGS-B usually ends with
   "ABNORMAL" (its line search failing on finite-difference noise at the plateau), which is harmless.
   --function-words auto fits with and without functionWords and keeps the lower train objective.
   Writes the preset (spec fragment: {"functionWords"?, "rules", "phoneDur"}) and work/voicelab/climb/durations-fit.json
   (train / held-out metrics before and after, fitted vs published values, both functionWords fits).
2. voice: a (1+lambda)-ES over the speak options in tools/voicelab/climb/voice-space.json (voice g/t/h, transition,
   intonation, accentDelta, functionWords, aspiration mode/ms, breath, dynamics, bankPatch fields of the worst-MCD
   phonemes), on top of --base (default: the durations preset). Objective = fidelity's combined score in audio
   mode (mean of the dur, spec, pros z-groups vs klattsing defaults) on the train sentences (--limit N: the first N
   of them, for speed). Each generation: lambda children, each mutating ~--mutate parameters (weighted; parameters
   that do not matter, e.g. breathLevel without breath, are not mutated) by sigma * step (reflected at the bounds);
   choices switch. The best child replaces the parent if it scores >= the parent (ties: neutral drift);
   sigma *= 1.5^((p - 0.2) / 0.8), p = the share of children better than the parent (the 1/5 success rule per
   child: x1.5 if all are better, /1.5^(1/4) if none; 0.05 <= sigma <= 3). Held-out score of each new best
   (--held accept), only at the end (end), or never. If klattsing / the engine / the banks change during a run
   (fidelity's source hash) or the corpus does (fidelity.corpus_key), the parent is re-scored before the next
   comparison.
   Checkpoint after every evaluation: work/voicelab/climb/state.json (--resume continues it, --evals more
   evaluations; without --resume an existing state is moved to state-<time>.json). Every evaluation is a JSON line
   in work/voicelab/climb/voice-log.jsonl ("accepted": true on accepted steps, which are also printed and kept in
   the state's history). The best config is written to --out on every strict improvement.
   ~5-6 s per evaluation for the 80 train sentences with --jobs 2 (render dominates), ~2 s per held-out score;
   the first evaluation also computes the defaults' reference for the split (~13 s, cached in work/voicelab/fidelity/).
"""
import argparse, copy, hashlib, json, math, os, re, shutil, subprocess, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F  # noqa: E402

ROOT = F.ROOT
PRESETS = os.path.join(ROOT, "klattsing", "presets")
WORK = os.path.join(ROOT, "work", "voicelab", "climb")
SPACE = os.path.join(HERE, "climb", "voice-space.json")
STATE = os.path.join(WORK, "state.json")
VLOG = os.path.join(WORK, "voice-log.jsonl")
DUR_PRESET = os.path.join(PRESETS, "kokoro-durations.json")
VOICE_PRESET = os.path.join(PRESETS, "kokoro-voice.json")
BANK_DIRS = [os.path.join(ROOT, "vendor", "klattsch", "src", "engine", "banks"), os.path.join(ROOT, "banks")]
DEFAULT_BANK = "klatt1980-en"

def rel(p): return os.path.relpath(p, ROOT)

def write_json(path, obj, indent=1):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f: json.dump(obj, f, indent=indent); f.write("\n")
    os.replace(tmp, path)

# ---------------------------------------------------------------- shared
def split(voice="am_onyx", holdout=0.2):
    """-> (train recs, held-out recs), both in corpus order; held-out = the first round(holdout * n) sentences
    ordered by sha1 of the id without the voice."""
    recs = F.corpus(voice)
    order = sorted(recs, key=lambda r: hashlib.sha1(r["id"].split("_")[0].encode()).hexdigest())
    held = {r["id"] for r in order[:round(holdout * len(recs))]}
    return [r for r in recs if r["id"] not in held], [r for r in recs if r["id"] in held]

_kd = None
def klattsing_defaults():
    """RULES, DUR, VOICES, INTONATION, ACCENT_DELTA, DYNAMICS, BREATH_LEVEL from klattsing itself."""
    global _kd
    if _kd is None:
        js = ("const d = await import('./klattsing/src/durations.js'), p = await import('./klattsing/src/phones.js'), "
              "c = await import('./klattsing/src/compile.js'); console.log(JSON.stringify({RULES: d.RULES, DUR: p.DUR, "
              "VOICES: c.VOICES, INTONATION: c.INTONATION, ACCENT_DELTA: c.ACCENT_DELTA, DYNAMICS: c.DYNAMICS, "
              "BREATH_LEVEL: c.BREATH_LEVEL}))")
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, cwd=ROOT, check=True)
        _kd = json.loads(out.stdout)
    return _kd

def evaluate_recs(config, recs, audio=True, voice="am_onyx", asp="stop", jobs=2):
    """fidelity.evaluate() on a given list of corpus records (a train or held-out split) -> brief result dict:
    score, scores, z, components, the main metrics, runtime_s. Relative to config {} on the same records."""
    t0 = time.time()
    shift = F.kokoro_shift(voice) if audio else 0.0
    res, per_utt = F._measure(config, recs, audio, asp, jobs, shift)
    comp = F.components(res, per_utt)
    ref = F.reference(recs, voice, audio, asp, jobs, shift, comp if config == {} else None)
    total, groups, z = F.score(comp, ref)
    d = res["duration"]
    out = {"score": total, "scores": groups, "z": z, "components": {k: v[0] for k, v in comp.items()},
           "duration": {k: d.get(k) for k in ("log_rmse", "r", "r_log", "ratio", "total_ratio", "n")}}
    if audio:
        s, p = res["spectral"], res["prosody"]
        out["spectral"] = {k: s.get(k) for k in ("mcd", "mcd_cmn", "mcd_static", "n")}
        out["prosody"] = {k: p.get(k) for k in ("r", "rmse_st", "sd_ratio", "median_st", "frames")}
    out["n_utts"] = len(recs)
    out["runtime_s"] = time.time() - t0
    return F.rnd(out)

# ---------------------------------------------------------------- 1. duration fit
def fast_ms(d):
    """durationsOf result -> the ms of its non-pause phones, aspiration after P/T/K added to the stop (= fidelity's
    klattsing_phones_dur(d, "stop") [x["ms"]], without the bookkeeping)."""
    out, last = [], None
    for x in d["phones"]:
        p = x["p"]
        if p == "pau": continue
        a = x.get("asp", 0.0)
        if a and out and last in F.VOICELESS_STOPS: out[-1] += a
        out.append(x["ms"]); last = p
    return out

def sigmoid(b): return 1.0 / (1.0 + math.exp(-b))
def logit(f): return math.log(f / (1.0 - f))

class DurationFit:
    """The duration model's parameters (log space around the published values) and the train objective."""
    def __init__(self, recs, base, phones, prior):
        kd = klattsing_defaults()
        self.recs, self.base, self.prior = recs, base, prior
        self.R0 = {k: float(v) for k, v in kd["RULES"].items()}
        self.D0 = {p: [float(a), float(b)] for p, a_b in kd["DUR"].items() for a, b in [a_b]}
        self.rules = list(self.R0)
        self.phones = list(phones)
        self.names = [f"rules.{k}" for k in self.rules] + [f"{w}.{p}" for p in self.phones for w in ("inh", "minfrac")]
        x0, lo, hi = [], [], []
        for k in self.rules:
            r0 = self.R0[k]
            if k == "aspirationMs": a, b = 3.0, 80.0
            else: a, b = max(0.02, r0 / 5), min(3.0, r0 * 5)
            x0.append(0.0); lo.append(math.log(a / r0)); hi.append(math.log(b / r0))
        for p in self.phones:
            inh, mn = self.D0[p]
            x0 += [0.0, logit(mn / inh)]; lo += [math.log(1 / 3), logit(0.02)]; hi += [math.log(3), logit(0.98)]
        self.x0, self.bounds = np.array(x0), list(zip(lo, hi))
        # alignment (the phone lists do not depend on the parameters): per sentence, klattsing indices and ln Kokoro ms
        base_d = F._worker.request([self.spec(self.base, r) for r in recs])
        self.idx, logK, self.count = [], [], {}
        for rec, d in zip(recs, base_d):
            kp = [x for x in d["phones"] if x["p"] != "pau"]
            K = F.kokoro_phones(rec)
            pairs = [(i, j) for i, j in F.align([x["p"] for x in kp], [x["p"] for x in K]) if not K[j]["last"] and K[j]["ms"] > 0]
            self.idx.append((len(kp), np.array([i for i, _ in pairs], int)))
            logK.append(np.log([K[j]["ms"] for _, j in pairs]))
            for i, _ in pairs: self.count[kp[i]["p"]] = self.count.get(kp[i]["p"], 0) + 1
        self.logK = np.concatenate(logK)
        self.n_evals, self.budget, self.best = 0, None, None

    def spec(self, cfg, rec): return F.spec_of(cfg, rec)

    def config(self, x):
        """parameter vector -> klattsing spec fragment (base merged with rules and phoneDur)"""
        cfg = copy.deepcopy(self.base)
        n = len(self.rules)
        cfg["rules"] = {**cfg.get("rules", {}), **{k: self.R0[k] * math.exp(x[i]) for i, k in enumerate(self.rules)}}
        pd = dict(cfg.get("phoneDur", {}))
        for j, p in enumerate(self.phones):
            a, b = x[n + 2 * j], x[n + 2 * j + 1]
            inh = self.D0[p][0] * math.exp(a)
            pd[p] = [inh, inh * sigmoid(b)]
        if pd: cfg["phoneDur"] = pd
        return cfg

    def penalty(self, x):
        n = len(self.rules)
        s = float(np.sum(np.square(x[:n])))
        for j, p in enumerate(self.phones):
            a, b = x[n + 2 * j], x[n + 2 * j + 1]
            inh0, min0 = self.D0[p]
            s += a * a + (a + math.log(sigmoid(b)) - math.log(min0 / inh0)) ** 2
        return self.prior * s

    def data_losses(self, cfgs):
        """mean squared log-duration error over the aligned train phones, per config (one worker request)"""
        nr = len(self.recs)
        out = F._worker.request([self.spec(c, r) for c in cfgs for r in self.recs])
        self.n_evals += len(cfgs)
        losses = []
        for c in range(len(cfgs)):
            lk = []
            for (n, ix), d in zip(self.idx, out[c * nr:(c + 1) * nr]):
                ms = fast_ms(d)
                if len(ms) != n: raise RuntimeError("phone list changed with the parameters")
                lk.append(np.log(np.asarray(ms)[ix]))
            lr = np.concatenate(lk) - self.logK
            losses.append(float(np.mean(lr * lr)))
        return losses

    def objective(self, xs):
        return [l + self.penalty(x) for l, x in zip(self.data_losses([self.config(x) for x in xs]), xs)]

    def fun_grad(self, x, eps=2e-3):
        if self.budget is not None and self.n_evals + 2 * len(x) + 1 > self.budget: raise Budget()
        xs = [x]
        for i in range(len(x)):
            e = np.zeros(len(x)); e[i] = eps
            xs += [x + e, x - e]
        L = self.objective(xs)
        g = np.array([(L[1 + 2 * i] - L[2 + 2 * i]) / (2 * eps) for i in range(len(x))])
        if self.best is None or L[0] < self.best[0]: self.best = (L[0], np.array(x))
        return L[0], g

class Budget(Exception):
    """the --evals budget is spent (L-BFGS-B checks maxfun only between iterations, so the cap is enforced here)"""

def round_preset(cfg):
    """the preset as written: rules to 4 significant digits, phoneDur to 0.1 ms"""
    out = copy.deepcopy(cfg)
    if "rules" in out: out["rules"] = {k: float(f"{v:.4g}") for k, v in out["rules"].items()}
    if "phoneDur" in out: out["phoneDur"] = {p: [round(a, 1), round(b, 1)] for p, (a, b) in sorted(out["phoneDur"].items())}
    return out

def dur_report(cfg, splits, voice):
    """standard fidelity duration metrics and the dur score (vs defaults) per split {name: recs}"""
    out = {}
    for name, recs in splits.items():
        d, _ = F.duration_metrics(cfg, recs)
        e = evaluate_recs(cfg, recs, audio=False, voice=voice)
        out[name] = F.rnd({"log_rmse": d["log_rmse"], "r": d.get("r"), "r_log": d.get("r_log"), "ratio": d["ratio"],
                           "total_ratio": d["total_ratio"], "score_dur": e["score"], "n": d["n"],
                           "by_class": {c: [v.get("log_rmse"), v.get("ratio"), v["n"]] for c, v in d["by_class"].items() if v["n"]},
                           "by_stress": {s: [v.get("log_rmse"), v.get("ratio"), v["n"]] for s, v in d["by_stress"].items()},
                           "final": [d["final"].get("log_rmse"), d["final"].get("ratio"), d["final"]["n"]],
                           "nonfinal": [d["nonfinal"].get("log_rmse"), d["nonfinal"].get("ratio"), d["nonfinal"]["n"]]})
    return out

def fit_durations(train, base, phones, prior, budget, log=print):
    from scipy.optimize import minimize
    fit = DurationFit(train, base, phones, prior)
    fit.budget = budget
    P = len(fit.x0)
    per_call = 2 * P + 1
    maxfun = max(2, budget // per_call)
    t0, it = time.time(), [0]
    f0 = fit.objective([fit.x0])[0]
    log(f"  {P} parameters, {len(fit.logK)} aligned train phones, start objective {f0:.5f} (log_rmse {math.sqrt(f0):.4f}); "
        f"budget {budget} configs = {maxfun} gradients")
    def cb(xk):
        it[0] += 1
        if it[0] % 10 == 0:
            L = fit.data_losses([fit.config(xk)])[0]
            log(f"  iter {it[0]:4d}  data log_rmse {math.sqrt(L):.4f}  prior {fit.penalty(xk):.5f}  "
                f"{fit.n_evals} configs  {time.time() - t0:.0f} s")
    try:
        r = minimize(fit.fun_grad, fit.x0, jac=True, method="L-BFGS-B", bounds=fit.bounds, callback=cb,
                     options={"maxfun": maxfun, "maxiter": maxfun, "ftol": 1e-10, "gtol": 1e-7})
        x, fx, nit, msg = r.x, float(r.fun), int(r.nit), r.message if isinstance(r.message, str) else r.message.decode()
        if fit.best is not None and fit.best[0] < fx: fx, x = fit.best[0], fit.best[1]
    except Budget:
        fx, x = fit.best if fit.best is not None else (f0, fit.x0)
        nit, msg = it[0], "budget spent (best point kept)"
    data = fit.data_losses([fit.config(x)])[0]
    log(f"  done: {msg} after {nit} iterations, {fit.n_evals} configs, {time.time() - t0:.0f} s; "
        f"data log_rmse {math.sqrt(data):.4f}, prior {fit.penalty(x):.5f}")
    at_bound = [n for n, v, (lo, hi) in zip(fit.names, x, fit.bounds) if v <= lo + 1e-6 or v >= hi - 1e-6]
    return {"fit": fit, "x": x, "objective": float(fx), "data_mse": data, "prior_term": fit.penalty(x),
            "iterations": nit, "configs": fit.n_evals, "seconds": time.time() - t0, "at_bound": at_bound, "message": msg}

def cmd_durations(a):
    t0 = time.time()
    train, held = split(a.voice)
    kd = klattsing_defaults()
    print(f"duration fit: {len(train)} train / {len(held)} held-out sentences ({a.voice}), prior {a.prior}")
    # the most frequent phonemes among the aligned train phones
    probe = DurationFit(train, {}, [], a.prior)
    phones = [p for p, _ in sorted(probe.count.items(), key=lambda kv: -kv[1])][:a.phones]
    cover = sum(probe.count[p] for p in phones) / sum(probe.count.values())
    print(f"  phoneDur for {len(phones)} phonemes ({100 * cover:.0f}% of aligned train phones): {' '.join(phones)}")
    variants = {"off": [{}], "on": [{"functionWords": True}], "auto": [{}, {"functionWords": True}]}[a.function_words]
    fits = []
    for base in variants:
        print(f"fit with {json.dumps(base) if base else 'functionWords off'}:")
        fits.append((base, fit_durations(train, base, phones, a.prior, a.evals, log=print)))
    base, best = min(fits, key=lambda bf: bf[1]["objective"])
    fit = best["fit"]
    preset = round_preset(fit.config(best["x"]))
    splits = {"train": train, "held": held}
    before = dur_report({}, splits, a.voice)
    after = dur_report(preset, splits, a.voice)
    alt = [(b, f) for b, f in fits if f is not best]
    rows = []
    for k in fit.rules:
        v = preset["rules"][k]; rows.append({"name": k, "published": fit.R0[k], "fitted": v, "ratio": v / fit.R0[k]})
    for p in phones:
        inh, mn = preset["phoneDur"][p]; i0, m0 = fit.D0[p]
        rows.append({"name": f"{p} inh", "published": i0, "fitted": inh, "ratio": inh / i0})
        rows.append({"name": f"{p} min", "published": m0, "fitted": mn, "ratio": mn / m0})
    report = {"voice": a.voice, "prior": a.prior, "budget_configs": a.evals, "phones": phones, "phone_coverage": cover,
              "split": {"train": [r["id"] for r in train], "held": [r["id"] for r in held]},
              "chosen": base, "preset": preset, "out": rel(a.out),
              "before": before, "after": after,
              "fits": [{"base": b, "objective": f["objective"], "train_log_rmse": math.sqrt(f["data_mse"]), "prior_term": f["prior_term"],
                        "iterations": f["iterations"], "configs": f["configs"], "seconds": f["seconds"], "message": f["message"],
                        "at_bound": f["at_bound"],
                        "held_log_rmse": dur_report(round_preset(f["fit"].config(f["x"])), {"held": held}, a.voice)["held"]["log_rmse"]}
                       for b, f in fits],
              "values": sorted(rows, key=lambda r: -abs(math.log(r["ratio"]))), "seconds": time.time() - t0}
    write_json(a.out, preset)
    write_json(a.report, F.rnd(report))
    print(f"\nchosen: {json.dumps(base) if base else 'functionWords off'}" + "".join(
        f"  (other: {json.dumps(b) if b else 'functionWords off'} objective {f['objective']:.5f} vs {best['objective']:.5f})" for b, f in alt))
    print(f"{'':10s} {'log_rmse':>9s} {'r':>6s} {'ratio':>6s} {'total':>6s} {'dur z':>6s}")
    for name in ("train", "held"):
        for tag, rep in (("defaults", before), ("fitted", after)):
            x = rep[name]
            print(f"{name:5s} {tag:8s} {x['log_rmse']:9.4f} {x['r']:6.3f} {x['ratio']:6.3f} {x['total_ratio']:6.3f} {x['score_dur']:+6.2f}")
    print("by class (held-out log_rmse, defaults -> fitted):",
          ", ".join(f"{c} {before['held']['by_class'][c][0]:.3f}->{after['held']['by_class'][c][0]:.3f}" for c in after["held"]["by_class"]))
    print("\nmoved most (fitted / published):")
    for r in report["values"][:16]:
        print(f"  {r['name']:24s} {r['published']:8.3f} -> {r['fitted']:8.3f}  x{r['ratio']:.2f}")
    print(f"\nwrote {rel(a.out)} and {rel(a.report)} ({time.time() - t0:.0f} s)")

# ---------------------------------------------------------------- 2. voice search
def load_bank(name):
    for d in BANK_DIRS:
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if not f.endswith(".json"): continue
            path = os.path.join(d, f)
            if f == f"{name}.json":
                b = json.load(open(path))
                if b.get("name") == name: return b
    for d in BANK_DIRS:
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if f.endswith(".json"):
                b = json.load(open(os.path.join(d, f)))
                if b.get("name") == name: return b
    raise SystemExit(f"unknown bank {name}")

def resolved_bank(name):
    """{code: entry} as klattsch layers it: a bank's entry replaces its parent's whole entry"""
    b = load_bank(name)
    out = resolved_bank(b["extends"]) if b.get("extends") else {}
    out.update({k: v for k, v in b["phonemes"].items() if v is not None})
    return out

VOICE_RE = re.compile(r"^([gth])=?([+-]?\d+(?:\.\d+)?)$")
def voice_parts(voice):
    """a voice (preset name or klattsch directives) -> ({g, t, h}, other directives)"""
    s = klattsing_defaults()["VOICES"].get(voice, voice) if voice else klattsing_defaults()["VOICES"]["speak"]
    vals, other = {}, []
    for tok in s.split():
        m = VOICE_RE.match(tok)
        if m: vals[m.group(1)] = float(m.group(2))
        else: other.append(tok)
    return vals, other

def get_path(cfg, path):
    cur = cfg
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur: return None
        cur = cur[k]
    return cur

def set_path(cfg, path, v):
    ks = path.split("."); cur = cfg
    for k in ks[:-1]: cur = cur.setdefault(k, {})
    cur[ks[-1]] = v

def load_space(path, base):
    """the search space with lo/hi/step/res/x0 resolved against the base config (and its bank)"""
    sp = json.load(open(path))
    params = [dict(p) for p in sp["params"]]
    bank = sp.get("bank")
    if bank:
        entries = resolved_bank(base.get("bank") if isinstance(base.get("bank"), str) else DEFAULT_BANK)
        for code, fields in bank["phonemes"].items():
            for fld in fields:
                rg = bank["ranges"][fld]
                v0 = entries.get(code, {}).get(fld, rg.get("default"))
                if v0 is None: continue
                lo, hi = (v0 * rg["rel"][0], v0 * rg["rel"][1]) if "rel" in rg else tuple(rg["abs"])
                lo, hi = min(lo, v0), max(hi, v0)
                params.append({"name": f"bankPatch.{code}.{fld}", "type": "float", "lo": lo, "hi": hi, "step": (hi - lo) / 6,
                               "res": rg.get("res", 0.001), "default": v0, "weight": bank.get("weight", 1)})
    vparts, _ = voice_parts(base.get("voice"))
    for p in params:
        n = p["name"]
        if n.startswith("voice."): x0 = vparts.get(n[6:], p.get("default"))
        elif n == "dynamics": x0 = bool(base.get("dynamics", False))
        elif n.startswith("dynamics."):
            dyn = base.get("dynamics"); x0 = dyn.get(n[9:], p["default"]) if isinstance(dyn, dict) else p["default"]
        elif n.startswith("bankPatch."): x0 = get_path(base, n); x0 = p["default"] if x0 is None else x0
        elif n == "transition": x0 = base.get("transition") or p["default"]
        else:
            x0 = get_path(base, n)
            if x0 is None: x0 = p.get("default")
        p["x0"] = x0
        p.setdefault("weight", 1)
    return params

def active(p, x):
    return all(x.get(k) == v for k, v in (p.get("when") or {}).items())

def build_config(base, params, x):
    """base config + the parameter values -> a klattsing speak config. An option at the value klattsing uses when it
    is absent, and absent from the base, is left out (so the x0 of a space rebuilds the base exactly)."""
    cfg = copy.deepcopy(base)
    by = {p["name"]: p for p in params}
    vbase, other = voice_parts(base.get("voice"))
    vparts = dict(vbase)
    for p in params:
        n, v = p["name"], x[p["name"]]
        if n.startswith("voice."): vparts[n[6:]] = v
        elif n == "dynamics":
            if v:
                d = {"1": 1.0}
                for s in ("0", "2"):
                    q = by.get(f"dynamics.{s}")
                    d[s] = x[q["name"]] if q else klattsing_defaults()["DYNAMICS"][s]
                cfg["dynamics"] = d
            else: cfg.pop("dynamics", None)
        elif n.startswith("dynamics."): continue
        elif not active(p, x): continue
        elif n == "transition":
            if v < p.get("off_below", 0): cfg.pop("transition", None)
            else: cfg["transition"] = v
        elif n.startswith("bankPatch."):
            if v != p["default"]: set_path(cfg, n, v)
        elif v == p.get("default") and get_path(base, n) is None: continue
        else: set_path(cfg, n, v)
    if vparts != vbase:
        cfg["voice"] = " ".join([f"{k}{vparts[k]:g}" for k in ("g", "t", "h") if k in vparts] + other)
    return cfg

def canon(x): return json.dumps(x, sort_keys=True)

def reflect(v, lo, hi):
    if hi <= lo: return lo
    w = hi - lo
    v = (v - lo) % (2 * w)
    return lo + (v if v <= w else 2 * w - v)

def quant(v, res):
    q = round(round(v / res) * res, 10)
    return int(q) if res >= 1 and float(q).is_integer() else q

def mutate(params, x, sigma, rng, m=2.0):
    """-> (child x, [changed names]). Each parameter is picked with probability m * weight / total weight (at least
    one); choices first, so a parameter that only matters under a choice (when) is picked only if it then matters."""
    wsum = sum(p["weight"] for p in params)
    for _ in range(50):
        y, picked = dict(x), []
        for kind in ("choice", "float"):
            act = [p for p in params if (p["type"] == "choice") == (kind == "choice") and active(p, y)]
            for p in act:
                if rng.random() < min(1.0, m * p["weight"] / wsum): picked.append(p)
            if kind == "float" and not picked and act:
                w = np.array([p["weight"] for p in act]); picked.append(act[rng.choice(len(act), p=w / w.sum())])
            for p in picked:
                n = p["name"]
                if p["type"] == "choice":
                    if y[n] != x[n]: continue
                    others = [c for c in p["choices"] if c != y[n]]
                    y[n] = others[rng.integers(len(others))]
                elif y[n] == x[n]:
                    y[n] = quant(reflect(y[n] + sigma * p["step"] * rng.standard_normal(), p["lo"], p["hi"]), p.get("res", 1e-3))
        changed = [p["name"] for p in picked if y[p["name"]] != x[p["name"]]]
        if changed: return y, changed
    return dict(x), []

class Voice:
    def __init__(self, a):
        self.a = a
        self.state_path = os.path.abspath(a.state)
        self.log_path = VLOG if self.state_path == STATE else re.sub(r"\.json$", "", self.state_path) + "-log.jsonl"
        self.train, self.held = split(a.voice)
        if a.limit: self.train = self.train[:a.limit]
        self.state = None

    def score(self, cfg, recs):
        try:
            r = evaluate_recs(cfg, recs, audio=True, voice=self.a.voice, jobs=self.a.jobs)
            r["source"] = self.source()
            return r
        except Exception as e:      # a config klattsing / klattsch refuses scores -inf
            return {"score": float("-inf"), "error": str(e)[-400:], "source": self.source(), "runtime_s": 0}

    def source(self):
        """what a score depends on besides the config: klattsing/engine/banks (fidelity.source_hash) and the corpus"""
        return f"{F.source_hash()}-{F.corpus_key(self.train)}"

    def save(self):
        self.state["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
        write_json(self.state_path, self.state)

    def log(self, row):
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        with open(self.log_path, "a") as f: f.write(json.dumps(F.rnd(row)) + "\n")

    def init_state(self):
        a = self.a
        base = json.load(open(a.base)) if a.base and os.path.exists(a.base) else {}
        params = load_space(a.space, base)
        x0 = {p["name"]: p["x0"] for p in params}
        rng = np.random.default_rng(a.seed)
        self.state = {"version": 1, "voice": a.voice, "base": base, "base_path": rel(a.base) if a.base and os.path.exists(a.base) else None,
                      "space_path": rel(a.space), "params": params, "lambda": a.lam, "mutate": a.mutate, "limit": a.limit,
                      "split": {"train": [r["id"] for r in self.train], "held": [r["id"] for r in self.held]},
                      "out": rel(a.out), "sigma": 1.0, "evals": 0, "gen": 0, "children": [], "history": [],
                      "rng": rng.bit_generator.state, "started": time.strftime("%Y-%m-%d %H:%M:%S")}
        cfg = build_config(base, params, x0)
        t = time.time(); r = self.score(cfg, self.train); self.state["evals"] += 1
        self.state["parent"] = {"x": x0, "config": cfg, "train": r, "held": None, "eval": 1}
        print(f"[eval 1] start: train score {r['score']:+.3f} {fmt_scores(r)}  ({time.time() - t:.1f} s)", flush=True)
        self.log({"eval": 1, "gen": 0, "kind": "start", "score": r["score"], "scores": r.get("scores"), "config": cfg, "secs": time.time() - t})
        if a.held == "accept": self.state["parent"]["held"] = self.held_score(cfg)
        self.state["history"].append({"eval": 1, "gen": 0, "train": r["score"], "scores": r.get("scores"),
                                      "held": (self.state["parent"]["held"] or {}).get("score"), "changed": {}, "config": cfg})
        self.write_preset(); self.save()
        return rng

    def held_score(self, cfg):
        r = evaluate_recs(cfg, self.held, audio=True, voice=self.a.voice, jobs=self.a.jobs)
        print(f"         held-out score {r['score']:+.3f} {fmt_scores(r)}", flush=True)
        return r

    def write_preset(self):
        write_json(os.path.join(ROOT, self.state["out"]), self.state["parent"]["config"])

    def run(self):
        a = self.a
        if a.resume:
            if not os.path.exists(self.state_path): raise SystemExit(f"--resume: no {rel(self.state_path)}")
            self.state = json.load(open(self.state_path))
            st = self.state
            ids = [r["id"] for r in F.corpus(st["voice"])]
            recs = {r["id"]: r for r in F.corpus(st["voice"])}
            self.train = [recs[i] for i in st["split"]["train"] if i in recs]; self.held = [recs[i] for i in st["split"]["held"] if i in recs]
            rng = np.random.default_rng(); rng.bit_generator.state = st["rng"]
            st["sigma"] = float(np.clip(st["sigma"], 0.05, 3.0))
            print(f"resuming {rel(self.state_path)}: {st['evals']} evaluations, generation {st['gen']}, best train score "
                  f"{st['parent']['train']['score']:+.3f}, sigma {st['sigma']:.2f} ({len(ids)} corpus sentences)", flush=True)
            done = 0
        else:
            stamp = time.strftime('%Y%m%d-%H%M%S')
            if os.path.exists(self.state_path):
                old = re.sub(r"\.json$", "", self.state_path) + f"-{stamp}.json"
                shutil.move(self.state_path, old); print(f"moved the previous state to {rel(old)}")
            if os.path.exists(self.log_path): shutil.move(self.log_path, re.sub(r"\.jsonl$", "", self.log_path) + f"-{stamp}.jsonl")
            print(f"voice search: {len(self.train)} train / {len(self.held)} held-out sentences, lambda {a.lam}, "
                  f"{len(load_space(a.space, json.load(open(a.base)) if a.base and os.path.exists(a.base) else {}))} parameters, "
                  f"base {rel(a.base) if a.base and os.path.exists(a.base) else '{}'}", flush=True)
            rng = self.init_state(); done = 1
        st = self.state
        params = st["params"]
        t_run = time.time()
        while done < a.evals:
            P = st["parent"]
            src = self.source()
            if P["train"].get("source") != src:
                t = time.time(); r = self.score(P["config"], self.train); st["evals"] += 1; done += 1
                print(f"[eval {st['evals']}] sources changed: parent re-scored {P['train']['score']:+.3f} -> {r['score']:+.3f}", flush=True)
                self.log({"eval": st["evals"], "gen": st["gen"], "kind": "rescore", "score": r["score"], "scores": r.get("scores"), "secs": time.time() - t})
                P["train"] = r
                st["children"] = [c for c in st["children"] if c.get("source") == src]
                self.save()
                continue
            # one child
            x, changed = mutate(params, P["x"], st["sigma"], rng, st["mutate"])
            cfg = build_config(st["base"], params, x)
            t = time.time(); r = self.score(cfg, self.train); secs = time.time() - t
            st["evals"] += 1; done += 1
            delta = {n: [P["x"][n], x[n]] for n in changed}
            child = {"x": x, "config": cfg, "train": r, "changed": delta, "eval": st["evals"], "source": r["source"]}
            st["children"].append(child)
            print(f"[eval {st['evals']}] gen {st['gen'] + 1} child {len(st['children'])}/{st['lambda']}: {r['score']:+.3f} "
                  f"{fmt_scores(r)} {fmt_delta(delta)}  ({secs:.1f} s)" + (f"  ERROR {r['error']}" if "error" in r else ""), flush=True)
            row = {"eval": st["evals"], "gen": st["gen"] + 1, "kind": "child", "score": r["score"], "scores": r.get("scores"),
                   "components": r.get("components"), "changed": delta, "sigma": st["sigma"], "secs": secs, "accepted": False}
            st["rng"] = rng.bit_generator.state
            if len(st["children"]) >= st["lambda"] or done >= a.evals:
                best = max(st["children"], key=lambda c: c["train"]["score"])
                improved = best["train"]["score"] > P["train"]["score"]
                accept = best["train"]["score"] >= P["train"]["score"] and np.isfinite(best["train"]["score"])
                st["gen"] += 1
                ps = sum(c["train"]["score"] > P["train"]["score"] for c in st["children"]) / len(st["children"])
                st["sigma"] = float(np.clip(st["sigma"] * 1.5 ** ((ps - 0.2) / 0.8), 0.05, 3.0))   # the 1/5 rule per child
                if accept:
                    held = None if improved else P.get("held")     # a tie: the same sound, as a rule
                    if improved and a.held == "accept": held = self.held_score(best["config"])
                    st["parent"] = {"x": best["x"], "config": best["config"], "train": best["train"], "held": held, "eval": best["eval"]}
                    h = {"eval": best["eval"], "gen": st["gen"], "train": best["train"]["score"], "scores": best["train"].get("scores"),
                         "held": held["score"] if held else None, "changed": best["changed"], "improved": improved, "config": best["config"]}
                    st["history"].append(h)
                    print(f"  ACCEPT gen {st['gen']} (eval {best['eval']}): train {best['train']['score']:+.3f}"
                          + (f" held {held['score']:+.3f}" if held else "") + f" {fmt_delta(best['changed'])}"
                          + ("" if improved else " (neutral)") + f"  sigma {st['sigma']:.2f}", flush=True)
                    if best is child: row["accepted"] = True
                    else: self.log({"eval": best["eval"], "gen": st["gen"], "kind": "accept", "score": best["train"]["score"],
                                    "changed": best["changed"], "accepted": True, "held": held["score"] if held else None})
                    if row.get("accepted"): row["held"] = held["score"] if held else None
                    if improved: self.write_preset()
                st["children"] = []
            self.log(row)
            self.save()
        P = st["parent"]
        if a.held in ("accept", "end") and not P.get("held"):
            P["held"] = self.held_score(P["config"]); self.save()
        self.write_preset()
        n = max(done, 1)
        print(f"\n{done} evaluations in {time.time() - t_run:.0f} s ({(time.time() - t_run) / n:.1f} s each); "
              f"{st['evals']} in the state, {st['gen']} generations, sigma {st['sigma']:.2f}")
        print(f"best (eval {P['eval']}): train {P['train']['score']:+.3f} {fmt_scores(P['train'])}"
              + (f"; held-out {P['held']['score']:+.3f} {fmt_scores(P['held'])}" if P.get("held") else ""))
        start = st["history"][0]
        print(f"start:            train {start['train']:+.3f}" + (f"; held-out {start['held']:+.3f}" if start.get("held") is not None else ""))
        print(f"wrote {st['out']}, {rel(self.state_path)}, {rel(self.log_path)}")

def fmt_scores(r):
    s = r.get("scores") or {}
    return "(" + " ".join(f"{k} {v:+.2f}" for k, v in s.items()) + ")"

def fmt_delta(d):
    def f(v): return f"{v:g}" if isinstance(v, (int, float)) and not isinstance(v, bool) else json.dumps(v)
    return " ".join(f"{k}: {f(a)}->{f(b)}" for k, (a, b) in d.items())

def cmd_voice(a):
    Voice(a).run()

# ---------------------------------------------------------------- split, selftest, CLI
def cmd_split(a):
    tr, he = split(a.voice)
    print(json.dumps({"voice": a.voice, "train": [r["id"] for r in tr], "held": [r["id"] for r in he]}))

def selftest(a):
    tr, he = split("am_onyx")
    assert len(he) == round(0.2 * (len(tr) + len(he))) and not {r["id"] for r in tr} & {r["id"] for r in he}
    tr2, he2 = split("am_michael")
    assert [r["id"].split("_")[0] for r in he] == [r["id"].split("_")[0] for r in he2], "split differs between voices"
    # fast_ms == fidelity's bookkeeping
    for cfg in ({}, {"functionWords": True}, {"aspiration": "breath"}):
        for d in F._worker.request([F.spec_of(cfg, r) for r in tr[:10]]):
            ph, _ = F.klattsing_phones_dur(d)
            assert np.allclose(fast_ms(d), [x["ms"] for x in ph]), cfg
    # the duration fit: x0 reproduces the published values; its objective is fidelity's log_rmse squared
    fit = DurationFit(tr[:20], {}, ["AH", "T"], 0.0)
    c0 = fit.config(fit.x0)
    assert all(abs(c0["rules"][k] - v) < 1e-9 for k, v in klattsing_defaults()["RULES"].items())
    assert all(abs(c0["phoneDur"][p][i] - klattsing_defaults()["DUR"][p][i]) < 1e-9 for p in ("AH", "T") for i in (0, 1))
    L = fit.objective([fit.x0])[0]
    d, _ = F.duration_metrics({}, tr[:20])
    assert abs(math.sqrt(L) - d["log_rmse"]) < 1e-3, (math.sqrt(L), d["log_rmse"])
    f, g = fit.fun_grad(fit.x0)
    assert abs(f - L) < 1e-12 and g.shape == fit.x0.shape and np.isfinite(g).all()
    assert fit.penalty(fit.x0) == 0
    # voice space: x0 rebuilds the base config; mutations stay inside the bounds and change something
    for base in ({}, {"functionWords": True, "rules": {"aspirationMs": 30}}):
        params = load_space(SPACE, base)
        x0 = {p["name"]: p["x0"] for p in params}
        assert build_config(base, params, x0) == base, (build_config(base, params, x0), base)
        rng = np.random.default_rng(1)
        for _ in range(200):
            y, ch = mutate(params, x0, 1.0, rng)
            assert ch and all(y[n] != x0[n] for n in ch)
            for p in params:
                if p["type"] == "float": assert p["lo"] - 1e-9 <= y[p["name"]] <= p["hi"] + 1e-9, (p, y[p["name"]])
                else: assert y[p["name"]] in p["choices"]
            cfg = build_config(base, params, y)
            assert "bankPatch" not in cfg or all(cfg["bankPatch"].values())
    params = load_space(SPACE, {})
    x = {p["name"]: p["x0"] for p in params}
    x.update({"voice.t": -0.4, "transition": 5, "dynamics": True, "dynamics.0": 0.6, "bankPatch.S.A3": 0.7, "breathLevel": 0.5})
    cfg = build_config({}, params, x)
    assert cfg["voice"] == "g0.5 t-0.4 h0.05" and "transition" not in cfg and cfg["dynamics"] == {"1": 1.0, "0": 0.6, "2": 0.8}
    assert cfg["bankPatch"] == {"S": {"A3": 0.7}} and "breathLevel" not in cfg
    x.update({"aspiration": "breath", "transition": 40})
    cfg = build_config({}, params, x)
    assert cfg["aspiration"] == "breath" and cfg["breathLevel"] == 0.5 and cfg["transition"] == 40
    assert reflect(1.2, 0, 1) == 0.8 and abs(reflect(-0.3, 0, 1) - 0.3) < 1e-12 and quant(41.6, 1) == 42
    assert resolved_bank("silt-stops")["B"]["voicing"] == 0.25 and "AH" in resolved_bank("silt-stops")
    print("selftest ok")

def main(argv):
    ap = argparse.ArgumentParser(description="hill-climb klattsing toward Kokoro (see the module docstring)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("durations", help="fit the duration rules and the DUR table of the most frequent phonemes")
    d.add_argument("--evals", type=int, default=20000, help="budget in configs per fit (one gradient = 2P+1; default 20000)")
    d.add_argument("--phones", type=int, default=39, help="the N most frequent phonemes whose [inherent, minimum] are "
                   "fitted (default 39 = all that occur; the prior holds the rare ones near the published values)")
    d.add_argument("--prior", type=float, default=0.002, help="weight of the pull toward the published values (default 0.002)")
    d.add_argument("--function-words", default="auto", choices=["auto", "on", "off"])
    d.add_argument("--voice", default="am_onyx"); d.add_argument("--out", default=DUR_PRESET)
    d.add_argument("--report", default=os.path.join(WORK, "durations-fit.json"), help="the fit's report (JSON)")
    v = sub.add_parser("voice", help="(1+lambda)-ES over voice / prosody / bank options on the combined audio score")
    v.add_argument("--evals", type=int, default=30, help="evaluations in this invocation (default 30)")
    v.add_argument("--resume", action="store_true", help="continue the state file")
    v.add_argument("--state", default=STATE, help=f"checkpoint (default {rel(STATE)}; its log: voice-log.jsonl beside it, "
                   "or <state>-log.jsonl for another name)")
    v.add_argument("--lambda", dest="lam", type=int, default=4, help="children per generation (default 4)")
    v.add_argument("--mutate", type=float, default=2.0, help="expected parameters mutated per child (default 2)")
    v.add_argument("--base", default=DUR_PRESET, help="base config (default the durations preset; '' = {})")
    v.add_argument("--space", default=SPACE); v.add_argument("--limit", type=int, default=None, help="first N train sentences only")
    v.add_argument("--jobs", type=int, default=2); v.add_argument("--held", default="accept", choices=["accept", "end", "never"])
    v.add_argument("--seed", type=int, default=0); v.add_argument("--voice", default="am_onyx"); v.add_argument("--out", default=VOICE_PRESET)
    s = sub.add_parser("split"); s.add_argument("--voice", default="am_onyx")
    sub.add_parser("selftest")
    a = ap.parse_args(argv)
    {"durations": cmd_durations, "voice": cmd_voice, "split": cmd_split, "selftest": selftest}[a.cmd](a)

if __name__ == "__main__":
    main(sys.argv[1:])
