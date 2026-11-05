#!/usr/bin/env python3
"""Vowels up close: formant trajectories of klattsing (a speak config) against the Kokoro corpus, token by token.

Each vowel fidelity aligns (klattsing's lexical vowel against a Kokoro vowel) is measured in both audios with the same
analysis: Praat Burg formants (parselmouth; 5 formants under 5000 Hz, 25 ms window, 5 ms step, pre-emphasis from 50
Hz, the usual adult-male setting) at 20, 35, 50, 65 and 80% of the vowel, each the median of the frames within
+-10% of the vowel's duration (at most +-12.5 ms) around that point; the vowel's duration in both. As in Hillenbrand
et al. (1995), 20% and 80% stand for a vowel's onset and offset (vowel-inherent spectral change) and 50% for its
middle. Context comes from klattsing's phones: the stress of its syllable (after functionWords), the phones before and
after (None across a pause) and whether an R follows in the same syllable ("dark", "four", "there").

Because the same contexts are measured on both sides, the paired difference Kokoro - klattsing per token already
contains what klattsing's coarticulation (and the tracker's own bias on a three-formant parallel synthesizer) does to
the vowel: the median difference per vowel, stress class and R context, at each point, is how far the bank's targets
are off in context (tools/voicelab/vowelfit.py turns it into targets).

usage: vowelscope.py CONFIG_JSON_OR_FILE [--limit N] [--voice am_onyx] [--by p|p,red|p,red,r|...] [--rows FILE] [--json]
  prints per group n, durations, fidelity's mean mcd / mcd_cmn of those vowels, and F1-F3 at 20/50/80% as Kokoro /
  klattsing (median Hz) with the median paired difference. --by keys: p (lexical vowel), code (klattsch's), kp
  (Kokoro's), red (0 unstressed / 1), r (R after it in the syllable), same (= when Kokoro's vowel is klattsing's), next.
  from python: sys.path.insert(0, "tools/voicelab"); import vowelscope as VS; rows = VS.run(config)
"""
import argparse, collections, hashlib, json, os, pickle, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fidelity as F

POINTS = (0.2, 0.35, 0.5, 0.65, 0.8)
NFORM, FMAX, WINDOW, STEP = 5, 5000.0, 0.025, 0.005
CACHE = os.path.join(F.ROOT, "work", "voicelab", "vowels")

def formants(x, sr=F.SR):
    """24 kHz audio -> (frame times s, [frames, 3] F1-F3 Hz, nan where undefined)."""
    import parselmouth
    fm = parselmouth.Sound(np.asarray(x, np.float64), sampling_frequency=sr).to_formant_burg(
        time_step=STEP, max_number_of_formants=NFORM, maximum_formant=FMAX, window_length=WINDOW, pre_emphasis_from=50)
    t = np.asarray(fm.xs())
    out = np.full((len(t), 3), np.nan)
    for i, tt in enumerate(t):
        for j in range(3):
            v = fm.get_value_at_time(j + 1, tt)
            if v == v: out[i, j] = v
    return t, out

def track_points(trk, s, e, points=POINTS):
    """[len(points), 3] median F1-F3 around each point of the segment [s, e] (s)."""
    t, Fm = trk
    d = e - s; w = min(0.0125, 0.1 * d)
    out = np.full((len(points), 3), np.nan)
    for k, q in enumerate(points):
        c = s + q * d
        m = (t >= c - w) & (t <= c + w)
        if not m.any(): m = np.abs(t - c) == np.abs(t - c).min()
        with np.errstate(all="ignore"):
            out[k] = np.nanmedian(Fm[m], axis=0) if np.isfinite(Fm[m]).any() else np.nan
    return out

_kcache = {}
def kokoro_tracks(voice, recs):
    """Kokoro's formant tracks per record id (cached in work/voicelab/vowels/, keyed by corpus content and settings)."""
    key = f"{voice}-{F.corpus_key(recs)}-{NFORM}-{FMAX:g}-{WINDOW:g}-{STEP:g}"
    if key in _kcache: return _kcache[key]
    path = os.path.join(CACHE, f"kokoro-formants-{key}.pkl")
    if os.path.exists(path): out = pickle.load(open(path, "rb"))
    else:
        import soundfile as sf
        out = {}
        for r in recs:
            x, sr = sf.read(os.path.join(F.ROOT, r["wav"]), dtype="float32")
            out[r["id"]] = formants(x, sr)
        os.makedirs(CACHE, exist_ok=True)
        tmp = f"{path}.{os.getpid()}"; pickle.dump(out, open(tmp, "wb")); os.replace(tmp, path)
    _kcache[key] = out
    return out

def klattsing_phones(tl, durs):
    """timeline + durationsOf result -> [{p, start, end, word, syl, stress, gap_before, gap_after}] (s), the aspiration
    after P/T/K dropped (a vowel starts after it), pauses noted as gaps."""
    lex = [x for x in durs["phones"] if x["p"] != "pau"]
    pau_after = set()
    for i, x in enumerate(durs["phones"]):
        if x["p"] == "pau" and i > 0: pau_after.add(len([y for y in durs["phones"][:i] if y["p"] != "pau"]) - 1)
    ph = [x for x in tl["phones"] if not x.get("asp")]
    if len(ph) != len(lex): raise RuntimeError(f"{tl['text']}: {len(ph)} timeline phones, {len(lex)} lexical")
    out = []
    for i, (x, d) in enumerate(zip(ph, lex)):
        out.append({"p": x["p"], "code": x.get("code", x["p"]), "start": x["start"] / 1000, "end": x["end"] / 1000, "word": d["word"], "syl": d["syl"],
                    "stress": d.get("stress"), "gap_after": i in pau_after, "gap_before": (i - 1) in pau_after or i == 0})
    return out

def analyse(rec, tl, dur, y, shift, KT, tracks=True):
    """One sentence: klattsing's timeline, durationsOf result and 24 kHz audio y against Kokoro's record -> the vowel
    rows, each with its formant points in both and fidelity's per-segment mcd / mcd_cmn (the cepstral mean over all the
    sentence's aligned segments subtracted on each side, as fidelity.compare_audio does)."""
    kph = klattsing_phones(tl, dur); Kph = F.kokoro_phones(rec, shift)
    ktr = formants(y) if tracks else None
    pairs = [(a, b) for a, b in F.align([q["p"] for q in kph], [q["p"] for q in Kph]) if not Kph[b]["last"]]
    keep = [(a, b) for a, b in pairs if kph[a]["end"] > kph[a]["start"] and Kph[b]["end"] > Kph[b]["start"]]
    tK, CK = F.kokoro_features(rec); tk, Ck = F.cepstra(y)
    cep = {}
    if keep:
        A = np.array([F.sample_seg(tk, Ck, kph[a]["start"], kph[a]["end"]) for a, b in keep])
        B = np.array([F.sample_seg(tK, CK, Kph[b]["start"], Kph[b]["end"]) for a, b in keep])
        ma, mb = A.reshape(-1, F.NCEP).mean(0), B.reshape(-1, F.NCEP).mean(0)
        raw = (F.MCD_K * np.sqrt(((A - B) ** 2).sum(-1))).mean(-1)
        cmn = (F.MCD_K * np.sqrt((((A - ma) - (B - mb)) ** 2).sum(-1))).mean(-1)
        cep = {ab: (float(r), float(c)) for ab, r, c in zip(keep, raw, cmn)}
    out = []
    for a, b in pairs:
        x, X = kph[a], Kph[b]
        if x["p"] not in F.VOWELS or X["p"] not in F.VOWELS: continue
        if x["end"] - x["start"] < 0.02 or X["end"] - X["start"] < 0.02: continue
        prev = kph[a - 1]["p"] if a > 0 and not x["gap_before"] else None
        nxt = kph[a + 1] if a + 1 < len(kph) and not x["gap_after"] else None
        r_after = bool(nxt and nxt["p"] == "R" and nxt["word"] == x["word"] and nxt["syl"] == x["syl"])
        m = cep.get((a, b), (float("nan"), float("nan")))
        out.append({"p": x["p"], "code": x["code"], "kp": X["p"], "stress": x["stress"], "prev": prev, "next": nxt["p"] if nxt else None,
                    "r": r_after, "word": rec["words"][x["word"]] if x["word"] < len(rec["words"]) else "?", "utt": rec["id"],
                    "ms": (x["end"] - x["start"]) * 1000, "msK": X["ms"], "mcd": m[0], "mcd_cmn": m[1],
                    **({"k": track_points(ktr, x["start"], x["end"]).tolist(), "K": track_points(KT[rec["id"]], X["start"], X["end"]).tolist()} if tracks else {})})
    return out

def run(config, limit=None, voice="am_onyx", jobs=2):
    recs = F.corpus(voice, limit)
    shift = F.kokoro_shift(voice)
    KT = kokoro_tracks(voice, F.corpus(voice))
    durs = F._worker.request([F.spec_of(config, r) for r in recs])
    rows = []
    for r in F.render(config, recs, jobs, lambda i, tl, y: analyse(recs[i], tl, durs[i], y, shift, KT)): rows += r
    return rows

def group_key(r, by):
    out = []
    for k in by:
        if k == "red": out.append("0" if r["stress"] == 0 else "1")
        elif k == "r": out.append("R" if r["r"] else "-")
        elif k == "same": out.append("=" if r["p"] == r["kp"] else "~")
        else: out.append(str(r[k]))
    return tuple(out)

def table(rows, by=("p",), same_only=False):
    g = collections.defaultdict(list)
    for r in rows:
        if same_only and r["p"] != r["kp"]: continue
        g[group_key(r, by)].append(r)
    out = {}
    for key, rs in sorted(g.items()):
        K = np.array([r["K"] for r in rs]); k = np.array([r["k"] for r in rs])
        with np.errstate(all="ignore"):
            out["/".join(key)] = {"n": len(rs), "same": sum(r["p"] == r["kp"] for r in rs),
                                  "ms": [float(np.median([r["msK"] for r in rs])), float(np.median([r["ms"] for r in rs]))],
                                  "K": np.nanmedian(K, 0).tolist(), "k": np.nanmedian(k, 0).tolist(), "d": np.nanmedian(K - k, 0).tolist(),
                                  "mcd": float(np.nanmean([r["mcd"] for r in rs])), "mcd_cmn": float(np.nanmean([r["mcd_cmn"] for r in rs]))}
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config"); ap.add_argument("--limit", type=int); ap.add_argument("--voice", default="am_onyx")
    ap.add_argument("--by", default="p"); ap.add_argument("--rows", help="save every row to this JSON file")
    ap.add_argument("--json", action="store_true"); ap.add_argument("--same", action="store_true", help="only tokens where Kokoro's vowel is klattsing's")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else json.loads(a.config)
    rows = run(cfg, a.limit, a.voice)
    if a.rows: json.dump(rows, open(a.rows, "w"))
    t = table(rows, tuple(a.by.split(",")), a.same)
    if a.json: print(json.dumps({"n": len(rows), "table": t})); return
    print(f"{len(rows)} vowels   (Kokoro/klattsing median Hz at 20/50/80%; d = median paired Kokoro - klattsing)")
    ix = [POINTS.index(q) for q in (0.2, 0.5, 0.8)]
    for key, c in t.items():
        cells = []
        for j, f in enumerate(("F1", "F2", "F3")):
            cells.append(f"{f} " + " ".join(f"{c['K'][i][j]:4.0f}/{c['k'][i][j]:4.0f}({c['d'][i][j]:+4.0f})" for i in ix))
        print(f"{key:10s} n {c['n']:3d} ({c['same']:3d}) ms {c['ms'][0]:3.0f}/{c['ms'][1]:3.0f} mcd {c['mcd']:.2f}/{c['mcd_cmn']:.2f}  " + "  ".join(cells))

if __name__ == "__main__":
    main()
