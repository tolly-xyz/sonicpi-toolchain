#!/usr/bin/env python3
"""Kokoro vs klattsch, same words: waveforms + spectrograms with phoneme boundaries, and a distance.

klattsch says the line with dict/words.json's timing at Kokoro's own median pitch, so what's left to
compare is the voice: formants, bursts, noise, transitions. Distance: log-mel spectra (MFCC-like,
pitch-insensitive) aligned with DTW, mean cost per frame (lower = closer to Kokoro).

usage: compare.py MODEL_DIR OUT.png "a lyric line" [bank[|settings] ...]
  bank 'default' = klatt1980-en; '+asp' adds a breath after P/T/K; settings are klattsch directives
  put before the line, e.g. 'silt-stops|[TR=90] t-0.3 g0.4'.   OUT.png '-' skips the plot.
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np, soundfile as sf, parselmouth
from scipy.signal import resample_poly, stft
from scipy.fft import dct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worddict"))
import build as WD

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SR = 16000
VOWELS = WD.VOWELS

def logmel(x, n_mels=40):
    f, t, Z = stft(x, SR, nperseg=400, noverlap=240); P = np.abs(Z) ** 2
    mel = lambda h: 2595 * np.log10(1 + h / 700); imel = lambda m: 700 * (10 ** (m / 2595) - 1)
    edges = imel(np.linspace(mel(80), mel(7000), n_mels + 2)); fb = np.zeros((n_mels, len(f)))
    for i in range(n_mels):
        l, c, r = edges[i:i + 3]; fb[i] = np.clip(np.minimum((f - l) / (c - l), (r - f) / (r - c)), 0, None)
    return dct(np.log(fb @ P + 1e-8), axis=0, norm="ortho")[1:13].T, t      # drop c0: loudness

def dtw(a, b):
    d = np.linalg.norm(a[:, None] - b[None], axis=2); D = np.full((len(a) + 1, len(b) + 1), np.inf); D[0, 0] = 0
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1): D[i, j] = d[i - 1, j - 1] + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return D[-1, -1] / (len(a) + len(b))

def main():
    model_dir, out, line, banks = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:] or ["default"]
    from kokoro_onnx import Kokoro
    k = Kokoro(WD.export_durations(model_dir), f"{model_dir}/voices-v1.0.bin")
    x, sr, tim = k.create_timed(line, voice="am_onyx", speed=1.0, lang="en-us")
    x = resample_poly(x, SR, sr).astype("float32")
    f0 = parselmouth.Sound(x, SR).to_pitch(pitch_floor=50, pitch_ceiling=300).selected_array["frequency"]; f0 = float(np.median(f0[f0 > 0]))
    d = json.load(open(f"{ROOT}/dict/words.json")); mean = {}
    for e in d.values():
        for p, ms in zip(e["phones"], e["ms"]):
            if ms: mean.setdefault(p, []).append(ms)
    mean = {p: float(np.median(v)) for p, v in mean.items()}
    phones = []
    for w in re.findall(r"[A-Za-z']+", line):
        e = d[w.lower().strip("'")]
        phones += [(p, ms or mean.get(p, 80)) for p, ms in zip(e["phones"], e["ms"])]
    rows = [("Kokoro am_onyx", x, [(t.phoneme, t.start, t.end) for t in tim if t.phoneme.strip()])]
    ref, _ = logmel(x); scores = {}
    for bank in banks:
        b, _, pre = bank.partition("|"); asp = b.endswith("+asp"); b = b.removesuffix("+asp")
        s = f"{'' if b == 'default' else f'[bank={b}] '}{pre} b{f0:.0f} "
        marks, t0 = [], 0.0
        for i, (p, ms) in enumerate(phones):
            s += f"r{ms:.0f} {p} "; marks.append((p, t0 / 1000, (t0 + ms) / 1000)); t0 += ms
            if asp and p in ("P", "T", "K") and i + 1 < len(phones) and phones[i + 1][0] in VOWELS: s += "r35 HH "; t0 += 35
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            subprocess.run(["node", f"{ROOT}/bin/klatt-render.mjs", s, f.name], check=True)
            y, ysr = sf.read(f.name)
        y = resample_poly(y, SR, ysr).astype("float32")
        scores[bank] = dtw(ref, logmel(y)[0]); rows.append((f"klattsch {bank}  (distance {scores[bank]:.2f})", y, marks))
    print(json.dumps({k_: round(v, 3) for k_, v in scores.items()}))
    if out == "-": return
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2 * len(rows), 1, figsize=(14, 3.2 * len(rows)), gridspec_kw={"height_ratios": [1, 3] * len(rows)})
    tmax = max(len(r[1]) for r in rows) / SR
    for i, (name, y, marks) in enumerate(rows):
        a, b = ax[2 * i], ax[2 * i + 1]
        a.plot(np.arange(len(y)) / SR, y / (np.abs(y).max() + 1e-9), lw=0.4, color="0.2"); a.set_xlim(0, tmax); a.set_title(name, loc="left", fontsize=10); a.axis("off")
        b.specgram(y, NFFT=512, Fs=SR, noverlap=448, cmap="magma", vmin=-120); b.set_ylim(0, 6000); b.set_xlim(0, tmax); b.set_ylabel("Hz")
        for p, s0, s1 in marks:
            b.axvline(s0, color="w", lw=0.4, alpha=0.5); b.text((s0 + s1) / 2, 5600, p, color="w", ha="center", fontsize=7)
    plt.tight_layout(); plt.savefig(out, dpi=110)

if __name__ == "__main__":
    main()
