#!/usr/bin/env python3
"""Minimal-pair intelligibility for klattsing/klattsch voices, scored by Whisper.

Monosyllabic words in contrast sets (after Kent, Weismer, Kent & Rosenbek 1989), each in the carrier
"Say, ___, again." (pauses keep Whisper from fusing carrier and word), spoken or sung, one per Whisper (large-v3-turbo) call: packed together, Whisper
collapses the repetitions ("Say that again." for eight of them).
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
        for st in sets.split("|"):
            for w in st.split(): out.append((cls, w))
    return out

KOKORO = None
def render(cfg, words, path):
    global KOKORO
    if cfg.get("mode") == "kokoro":                      # the ceiling: a neural voice saying the same carriers
        from kokoro_onnx import Kokoro
        d = os.environ.get("KOKORO_DIR", "/home/user/tts")
        KOKORO = KOKORO or Kokoro(f"{d}/kokoro-v1.0.onnx", f"{d}/voices-v1.0.bin")
        parts = []
        for w in words:
            x, sr = KOKORO.create(f"Say, {w}, again.", voice=cfg.get("voice", "am_onyx"), speed=1.0, lang="en-us")
            parts += [x, np.zeros(int(sr * 0.6), "float32")]
        sf.write(path, np.concatenate(parts), sr); return
    specs = []
    for w in words:
        base = {k: v for k, v in cfg.items() if k in ("bank", "transition", "aspiration", "voice", "rules", "accent", "gate", "hold", "durations", "dynamics")}
        if cfg.get("mode", "speak") == "sing":
            notes = cfg.get("notes", ["E2", "r", "G2", "r", "F2", "E2"]); ln = cfg.get("len", [3, 2, 6, 2, 2, 6])
            specs.append({**base, "mode": "sing", "text": f"Say {w} again", "bpm": cfg.get("bpm", 120), "notes": [[n, l] for n, l in zip(notes, ln)]})
        else:
            specs.append({**base, "mode": "speak", "text": f"Say, {w}, again.", "pitch": cfg.get("pitch", "A2"), "rate": cfg.get("rate", 1)})
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
        res = []
        for i in range(0, len(its), 1):                  # one carrier per call: Whisper collapses repeated phrases
            chunk = its[i:i + 1]
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                render(cfg, [w for _, w in chunk], f.name); x, sr = sf.read(f.name)
            x = resample_poly(x, 16000, sr).astype("float32")
            text = model.transcribe(x, language="en", temperature=0, condition_on_previous_text=False, fp16=False)["text"]
            # Whisper runs carrier and word together ("Sivan again", "Save us again"), so a word counts
            # as heard if it appears anywhere; what was heard instead is the transcript minus the carrier
            toks = re.findall(r"[a-z0-9']+", text.lower())
            got = {}
            for k, (cls, w) in enumerate(chunk):
                hit = next((t for t in toks if ok(w, t)), None)
                got[k] = hit or " ".join(t for t in toks if t not in ("say", "again")) or "?"
            for k, (cls, w) in enumerate(chunk):
                h = got.get(k, "")
                res.append((cls, w, h, ok(w, h)))   # h is the matching token when heard
        by = collections.defaultdict(list)
        for cls, w, h, good in res: by[cls].append(good)
        total = np.mean([g for *_, g in res])
        report[cfg["name"]] = {"total": round(float(total), 3), "classes": {c: round(float(np.mean(v)), 2) for c, v in by.items()},
                               "missed": [f"{w}->{h or '?'}" for _, w, h, g in res if not g]}
        print(f"{cfg['name']:28s} {total:5.0%}  " + "  ".join(f"{c[:8]} {np.mean(v):.0%}" for c, v in by.items()), flush=True)
        print("   missed: " + ", ".join(report[cfg['name']]["missed"]), flush=True)
        if out: json.dump(report, open(out, "w"), indent=1)

if __name__ == "__main__":
    main()
