#!/usr/bin/env python3
"""Sentence intelligibility: Harvard sentences (IEEE 1969, lists 1-2), spoken or sung (auto melody),
one per Whisper call; word error rate against the text.

usage: sentences.py CONFIGS.json [OUT.json]     (configs as for pairs.py; "mode": "speak"|"sing"|"kokoro")
"""
import json, os, re, subprocess, sys, tempfile, difflib
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pairs as P

HARVARD = [
    "The birch canoe slid on the smooth planks.", "Glue the sheet to the dark blue background.",
    "It's easy to tell the depth of a well.", "These days a chicken leg is a rare dish.",
    "Rice is often served in round bowls.", "The juice of lemons makes fine punch.",
    "The box was thrown beside the parked truck.", "The hogs were fed chopped corn and garbage.",
    "Four hours of steady work faced us.", "A large size in stockings is hard to sell.",
    "The boy was there when the sun rose.", "A rod is used to catch pink salmon.",
    "The source of the huge river is the clear spring.", "Kick the ball straight and follow through.",
    "Help the woman get back to her feet.", "A pot of tea helps to pass the evening.",
    "Smoky fires lack flame and heat.", "The soft cushion broke the man's fall.",
    "The salt breeze came across from the sea.", "The girl at the booth sold fifty bonds.",
]
norm = lambda s: re.findall(r"[a-z']+", s.lower().replace("’", "'"))

def render(cfg, text, path):
    if cfg.get("mode") == "kokoro":
        from kokoro_onnx import Kokoro
        d = os.environ.get("KOKORO_DIR", "/home/user/tts")
        P.KOKORO = P.KOKORO or Kokoro(f"{d}/kokoro-v1.0.onnx", f"{d}/voices-v1.0.bin")
        x, sr = P.KOKORO.create(text, voice=cfg.get("voice", "am_onyx"), speed=1.0, lang="en-us"); sf.write(path, x, sr); return
    keep = ("bank", "transition", "aspiration", "voice", "rules", "accent", "gate", "hold", "durations", "dynamics", "melody", "bpm", "rate")
    spec = {k: v for k, v in cfg.items() if k in keep}
    spec.update(mode=cfg.get("mode", "speak"), text=text)
    if spec["mode"] == "speak": spec["pitch"] = cfg.get("pitch", "A2")
    else: spec["notes"] = "auto"
    r = subprocess.run(["node", f"{P.ROOT}/klattsing/bin/klattsing.mjs", "-", path], input=json.dumps(spec), text=True, capture_output=True)
    if r.returncode: raise SystemExit(r.stderr)

def main():
    cfgs = json.load(open(sys.argv[1])); out = sys.argv[2] if len(sys.argv) > 2 else None
    import whisper, torch
    torch.set_num_threads(os.cpu_count())
    model = whisper.load_model(os.environ.get("WHISPER_MODEL", "/home/user/whisper/large-v3-turbo.pt"), device="cpu")
    report = {}
    for cfg in cfgs:
        errs = words = 0; rows = []
        for text in HARVARD:
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                render(cfg, text, f.name); x, sr = sf.read(f.name)
            heard = model.transcribe(resample_poly(x, 16000, sr).astype("float32"), language="en", temperature=0,
                                     condition_on_previous_text=False, fp16=False)["text"].strip()
            R, H = norm(text), norm(heard)
            sm = difflib.SequenceMatcher(None, R, H, autojunk=False)
            e = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal")
            errs += e; words += len(R); rows.append(f"{e}/{len(R)}  {heard}")
        report[cfg["name"]] = {"wer": round(errs / words, 3), "heard": rows}
        print(f"{cfg['name']:28s} WER {errs / words:5.1%}", flush=True)
        for r in rows[:6]: print("   " + r, flush=True)
    if out: json.dump(report, open(out, "w"), indent=1)

if __name__ == "__main__":
    main()
