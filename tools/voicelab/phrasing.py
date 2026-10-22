#!/usr/bin/env python3
"""A small Kokoro phrasing set: what the Harvard corpus lacks (it has one comma and no question).

usage (/home/user/tts/venv/bin/python):
  phrasing.py build [--voice am_onyx]     synthesize PHRASING with Kokoro into work/voicelab/phrasing/ (idempotent)
  phrasing.py stats                       Kokoro's F0 at phrase ends: the last vowel's rise/fall (st), comma resets
  phrasing.py measure CONFIG_JSON         the prosodyfit proxy (r, r_detrended, rmse_st) of a speak config on the set,
                                          and the same phrase-end statistics for klattsing

Records have the corpus format (tools/voicelab/corpus.py, which builds them: same Kokoro export, F0 and phone
conversion), ids p01_onyx ...; the Harvard corpus (work/voicelab/corpus) is not touched. Statistics per phrase
end, in semitones re the utterance's median, from the F0 at 20% and 80% of the phrase's last vowel ("rise") and of
the vowel's mean against the line through the earlier voiced frames of the phrase ("offset"); a phrase is a run of
words up to punctuation; kinds as klattsing's prosody (src/prosody.js accentPlan): comma (continuation), yes/no
question, wh-question, final.
"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import corpus as K  # noqa: E402

ROOT = K.ROOT
REL = "work/voicelab/phrasing"
OUT = f"{ROOT}/{REL}"
PHRASING = [
    # commas (continuation rises, resets)
    "When the sun rose, the birds began to sing.", "If you go to the store, buy some fresh bread.",
    "The old man, who lived alone, kept a small dog.", "After the rain stopped, we walked to the river.",
    "Bring the map, the lamp, and the rope.", "Before dinner, she painted the fence.",
    "Although it was late, the shop was still open.", "On Monday morning, the train left early.",
    "Yes, the door was open.", "Well, the plan might work.",
    # yes/no questions
    "Is the water warm enough to swim?", "Did you see the boat on the lake?", "Can you hear the music from the hall?",
    "Will the bus stop near the park?", "Are the green apples ripe yet?", "Do you like the taste of lemons?",
    # wh-questions
    "Where did you put the blue box?", "Why is the river so cold today?", "What time does the market open?",
    "How far is the farm from the town?",
]
WH = set("who whom whose what which when where why how".split())

def build(voice):
    os.makedirs(OUT, exist_ok=True)
    K.OUT, K.REL = OUT, REL                                     # corpus.entry writes there
    K.utt_id = lambda i, v: f"p{i:02d}_{v.split('_', 1)[-1]}"
    cmu = K.cmu_lookup(PHRASING)
    k = K.Lazy(2)
    recs = [K.entry(i + 1, t, voice, c, k) for i, (t, c) in enumerate(zip(PHRASING, cmu))]
    for r in recs: r.pop("tokens", None)
    idx = f"{OUT}/index.json"
    others = [r for r in json.load(open(idx)) if r["voice"] != voice] if os.path.exists(idx) else []
    K._dump(others + recs, idx, indent=None)
    print(f"{len(recs)} records in {REL}/index.json")

def load(voice="am_onyx"):
    return [r for r in json.load(open(f"{OUT}/index.json")) if r["voice"] == voice]

def phrase_ends(phones, f0, words, punct_after, median):
    """phones [{p, start, end, word}] (s), f0 [[t, hz]], punct_after {word: mark} -> [(kind, rise st, offset st)]."""
    import fidelity as F
    t, f = np.array(f0)[:, 0], np.array(f0)[:, 1]
    st = np.where(f > 0, 12 * np.log2(np.maximum(f, 1) / median), np.nan)
    out, first = [], 0
    ends = sorted(punct_after)
    for w in ends:
        mark = punct_after[w]
        vs = [p for p in phones if p["word"] is not None and first <= p["word"] <= w and p["p"] in F.VOWELS]
        if not vs: first = w + 1; continue
        v = vs[-1]; d = v["end"] - v["start"]
        at = lambda u: np.nanmean(st[(t >= v["start"] + (u - 0.1) * d) & (t <= v["start"] + (u + 0.1) * d)]) if d > 0 else np.nan
        rise = at(0.8) - at(0.2)
        p0 = min(p["start"] for p in phones if p["word"] is not None and p["word"] >= first)
        m = (t >= p0) & (t < v["start"]) & np.isfinite(st)
        inv = (t >= v["start"]) & (t < v["end"]) & np.isfinite(st)
        off = np.nan
        if m.sum() > 5 and inv.any():
            b, a = np.polyfit(t[m], st[m], 1)
            off = float(np.mean(st[inv] - (a + b * t[inv])))
        q = "?" in mark
        kind = ("wh" if words[0] in WH else "yesno") if q else ("final" if any(c in mark for c in ".!") else "comma")
        out.append((kind, float(rise), off))
        first = w + 1
    return out

def kokoro_stats(recs):
    rows = []
    for r in recs:
        punct = {}
        for p in r["pauses"]:
            if p["after"] < len(r["phones"]): punct[r["phones"][p["after"]]["word"]] = p["mark"]
        punct.setdefault(len(r["words"]) - 1, r["text"].strip()[-1])
        rows += phrase_ends(r["phones"], r["f0"], r["words"], punct, r["f0_median"])
    return rows

def summary(rows):
    out = {}
    for kind in ("comma", "yesno", "wh", "final"):
        x = [(a, b) for k, a, b in rows if k == kind]
        if x: out[kind] = {"n": len(x), "rise_st": round(float(np.nanmean([a for a, _ in x])), 2), "offset_st": round(float(np.nanmean([b for _, b in x])), 2)}
    return out

def cmd_measure(cfg, voice):
    import fidelity as F, prosodyfit as PF
    recs = load(voice)
    p = PF.proxy(cfg, recs, voice)
    res = PF.W.request([F.spec_of(cfg, r) for r in recs])
    rows = []
    for rec, x in zip(recs, res):
        ph = [{"p": q["p"], "start": q["start"] / 1000, "end": q["end"] / 1000, "word": q.get("word")} for q in x["phones"] if not q.get("asp")]
        f0 = [[i * 0.01, h] for i, h in enumerate(x["f0"])]
        voiced = [h for h in x["f0"] if h > 0]
        words = [w for w in rec["words"]]
        import re
        toks = re.findall(r"[\w']+|[,;:.!?]+", rec["text"].lower())
        punct, wi = {}, -1
        for tk in toks:
            if re.match(r"[\w']", tk): wi += 1
            else: punct[wi] = tk
        rows += phrase_ends(ph, f0, words, punct, float(np.median(voiced)))
    print(json.dumps({"proxy": {k: round(p[k], 4) for k in ("r", "r_detrended", "rmse_st", "sd_ratio")}, "ends": summary(rows)}))

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["build", "stats", "measure"]); ap.add_argument("config", nargs="?")
    ap.add_argument("--voice", default="am_onyx")
    a = ap.parse_args()
    if a.cmd == "build": build(a.voice)
    elif a.cmd == "stats": print(json.dumps(summary(kokoro_stats(load(a.voice)))))
    else:
        cfg = json.loads(open(a.config).read() if os.path.exists(a.config) else a.config)
        cmd_measure(cfg, a.voice)

if __name__ == "__main__":
    main()
