#!/usr/bin/env python3
"""Per-line intelligibility of a song's vocals: cut each line (a score's "vox" part: t, text) out of
one or more renders, transcribe with Whisper, count the line's words heard.
usage: song_lines.py SCORE.json WAV [WAV ...]"""
import json, os, re, sys, difflib
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
SC = json.load(open(sys.argv[1]))
lines, seen = [], set()
for e in SC["parts"]["vox"]:
    if (e["t"] // 0.1, e["text"]) in seen or any(abs(e["t"] - l[0]) < 0.1 and e["text"] == l[1] for l in lines): continue
    lines.append((e["t"], e["text"])); seen.add((e["t"] // 0.1, e["text"]))
lines.sort()
import whisper, torch
torch.set_num_threads(os.cpu_count())
m = whisper.load_model(os.environ.get("WHISPER_MODEL", "/home/user/whisper/large-v3-turbo.pt"), device="cpu")
norm = lambda s: re.findall(r"[a-z']+", s.lower().replace("’", "'"))
for wav in sys.argv[2:]:
    x, sr = sf.read(wav); x = x.mean(1) if x.ndim > 1 else x
    hit = tot = 0; rows = []
    for i, (t, text) in enumerate(lines):
        end = min(lines[i + 1][0] if i + 1 < len(lines) else t + 5, t + 6)
        seg = resample_poly(x[int(max(0, t - 0.1) * sr):int((end + 0.3) * sr)], 16000, sr).astype("float32")
        r = m.transcribe(seg, language="en", temperature=0, condition_on_previous_text=False, fp16=False)["text"].strip()
        R, H = norm(text), norm(r)
        h = sum(b.size for b in difflib.SequenceMatcher(None, R, H, autojunk=False).get_matching_blocks())
        hit += h; tot += len(R); print(f"  {h:2d}/{len(R):2d}  {text:52s} -> {r[:70]}", flush=True)
    print(f"{os.path.basename(wav)}: {hit}/{tot} words = {hit / tot:.0%}", flush=True)
