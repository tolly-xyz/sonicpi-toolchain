#!/usr/bin/env python3
"""Minimal-pair intelligibility for klattsing/klattsch voices, scored by Whisper.

Monosyllabic words in contrast sets (after Kent, Weismer, Kent & Rosenbek 1989), six per Whisper
(large-v3-turbo) call in numbered carriers ("One: pat. Two: sip. ..."): identical carriers packed
together get collapsed ("Say that again." for eight), numbered ones don't. A group never holds two
words of one minimal set, and a word counts as heard if it appears anywhere in its group's transcript
(Whisper fuses neighbours: "Sivan", "Save us").
Reports accuracy per contrast class and what each missed word was heard as.

usage: pairs.py CONFIGS.json [OUT.json]
  CONFIGS: [{"name": "...", "mode": "speak"|"sing", "pitch": "A2", "bank": "silt-stops", "transition": 70,
             "aspiration": true, "voice": "speak", "rules": {...}, "notes": ["E2","G2","F2","E2"], "bpm": 120,
             "len": [3,6,2,6], "gate": null}, ...]
"""
import json, os, re, subprocess, sys, tempfile, difflib, collections
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SETS = {
    "voicing-initial": "pat bat|tip dip|coat goat|fan van|sip zip|chin gin|pill bill|tame dame|cap gap",
    "voicing-final": "cap cab|bet bed|back bag|safe save|bus buzz|rich ridge|lock log",
    "place-stops": "pad tad cad|pill till kill|bore door gore|pie tie|bay day gay",
    "manner": "bat mat|dip nip|bee me|dough no|tip sip|ban man|bead need|top shop",
    "fricatives": "sin shin thin fin|sue shoe|sip ship|sell shell fell|vat that",
    "liquids-glides": "lead read weed|lock rock wok|light right white|yell well",
    "nasals": "mine nine|ram ran rang|sum sun sung",
    "vowels": "beat bit bait bet bat bought boat book boot but bite bout boy bird pot",
    "clusters": "play pray pay|slip sip lip|spin pin|black back lack|trip tip rip|grow go row|street treat sweet|split spit slit|drown down brown|fly fry|stay say",
}
SAME = {"sun": "son", "sum": "some", "row": "roe", "sew": "so", "go": "go", "fry": "fry", "bore": "boar", "dough": "doe",
        "no": "know", "bee": "be", "pie": "pi", "sue": "soo", "read": "reed", "white": "wight", "rang": "rang", "weed": "we'd",
        "lead": "lede", "pray": "prey", "pain": "pane", "bait": "bate", "tie": "thai", "ram": "rahm", "nine": "9", "boy": "buoy",
        "right": "write", "rock": "roc", "sell": "cell", "bus": "buss", "him": "hymn", "mine": "mind"}
def ok(want, got):
    got = got.lower().strip("'.,!?\""); return got == want or SAME.get(want) == got or SAME.get(got) == want

def items():
    out = []
    for cls, sets in SETS.items():
        for si, st in enumerate(sets.split("|")):
            for w in st.split(): out.append((cls, w, f"{cls}{si}"))
    return out

PER = 6                                     # words per Whisper call
NUM = ["one", "two", "three", "four", "five", "six", "seven", "eight"]
def groups(its):
    """Deterministic groups of PER words, never two from the same minimal set (a confusion inside a
    group could otherwise read as a hit)."""
    import random
    pool = its[:]; random.Random(1).shuffle(pool); out = []
    while pool:
        g, used = [], set()
        for it in pool[:]:
            if it[2] not in used and len(g) < PER: g.append(it); used.add(it[2]); pool.remove(it)
        out.append(g)
    return out

KOKORO = None
def render(cfg, words, path):
    global KOKORO
    if cfg.get("mode") == "kokoro":                      # the ceiling: a neural voice saying the same carriers
        from kokoro_onnx import Kokoro
        d = os.environ.get("KOKORO_DIR", "/home/user/tts")
        KOKORO = KOKORO or Kokoro(f"{d}/kokoro-v1.0.onnx", f"{d}/voices-v1.0.bin")
        parts = []
        for i, w in enumerate(words):
            x, sr = KOKORO.create(f"{NUM[i].capitalize()}: {w}.", voice=cfg.get("voice", "am_onyx"), speed=1.0, lang="en-us")
            parts += [x, np.zeros(int(sr * 0.6), "float32")]
        sf.write(path, np.concatenate(parts), sr); return
    specs = []
    for i, w in enumerate(words):
        base = {k: v for k, v in cfg.items() if k in ("bank", "transition", "aspiration", "voice", "rules", "accent", "gate", "hold", "durations", "dynamics",
                                                      "coarticulation", "glottal", "nasals", "stops", "prosody")}
        if cfg.get("mode", "speak") == "sing":
            nsyl = 2 if NUM[i] == "seven" else 1
            notes = [["E2", 4 // nsyl]] * nsyl + [["r", 2], ["G2", 8]]
            specs.append({**base, "mode": "sing", "text": f"{NUM[i]} {w}", "bpm": cfg.get("bpm", 120), "notes": notes})
        else:
            specs.append({**base, "mode": "speak", "text": f"{NUM[i].capitalize()}: {w}.", "pitch": cfg.get("pitch", "A2"), "rate": cfg.get("rate", 1)})
    r = subprocess.run(["node", f"{ROOT}/klattsing/bin/klattsing.mjs", "-", path], input=json.dumps(specs), text=True, capture_output=True)
    if r.returncode: raise SystemExit(r.stderr)

def main():
    cfgs = json.load(open(sys.argv[1])); out = sys.argv[2] if len(sys.argv) > 2 else None
    import whisper, torch
    torch.set_num_threads(os.cpu_count())
    model = whisper.load_model(os.environ.get("WHISPER_MODEL", "/home/user/whisper/large-v3-turbo.pt"), device="cpu")
    its = items()
    report = json.load(open(out)) if out and os.path.exists(out) else {}   # resume: finished configs are kept
    for cfg in cfgs:
        if cfg["name"] in report: print(f"{cfg['name']:28s} (done earlier)", flush=True); continue
        res = []; heard_log = []
        for chunk in groups(its):
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                render(cfg, [w for _, w, _ in chunk], f.name); x, sr = sf.read(f.name)
            x = resample_poly(x, 16000, sr).astype("float32")
            text = model.transcribe(x, language="en", temperature=0, condition_on_previous_text=False, fp16=False)["text"]
            toks = re.findall(r"[a-z0-9']+", text.lower())
            for cls, w, _ in chunk:
                hit = next((t for t in toks if ok(w, t)), None)
                res.append((cls, w, hit or "?", hit is not None))
            heard_log.append(text.strip())
        by = collections.defaultdict(list)
        for cls, w, h, good in res: by[cls].append(good)
        total = np.mean([g for *_, g in res])
        report[cfg["name"]] = {"total": round(float(total), 3), "classes": {c: round(float(np.mean(v)), 2) for c, v in by.items()},
                               "missed": [w for _, w, h, g in res if not g], "heard": heard_log,
                               "results": [[w, bool(g)] for _, w, h, g in res]}       # per word, for stats.py
        print(f"{cfg['name']:28s} {total:5.0%}  " + "  ".join(f"{c[:8]} {np.mean(v):.0%}" for c, v in by.items()), flush=True)
        print("   missed: " + " ".join(report[cfg['name']]["missed"]), flush=True)
        if out: json.dump(report, open(out, "w"), indent=1)

if __name__ == "__main__":
    main()
