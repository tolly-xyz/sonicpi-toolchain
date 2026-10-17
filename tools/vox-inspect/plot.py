# Waveform + spectrogram per klattsch phrase, with the phoneme boundaries klattsch reports.
# usage: plot.py TIMING.json KVOX_DIR OUT.png [names...]
import json, sys, numpy as np, soundfile as sf, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
timing = json.load(open(sys.argv[1])); kdir = sys.argv[2]; out = sys.argv[3]
names = sys.argv[4:] or list(timing)
fig, axes = plt.subplots(len(names), 2, figsize=(18, 2.3 * len(names)), gridspec_kw={"width_ratios": [1, 1.4]})
for row, name in zip(np.atleast_2d(axes), names):
    x, sr = sf.read(f"{kdir}/{name}.wav"); x = x if x.ndim == 1 else x.mean(1); t = np.arange(len(x)) / sr * 1000
    row[0].plot(t, x, lw=0.4, color="#222"); row[0].set_xlim(0, t[-1]); row[0].set_ylim(-1, 1)
    row[0].set_ylabel(name, rotation=0, ha="right", fontsize=12, fontweight="bold"); row[0].set_yticks([])
    row[1].specgram(x, NFFT=1024, Fs=sr, noverlap=896, cmap="magma", vmin=-120)
    row[1].set_ylim(0, 6000); row[1].set_xlim(0, t[-1] / 1000); row[1].set_yticks([1000, 3000, 5000])
    for p, s, e in timing[name]["voices"][0]:
        row[0].axvline(s, color="#c33", lw=0.6, alpha=0.6)
        row[0].text((s + e) / 2, 0.82, p, ha="center", fontsize=8, color="#c33")
        row[1].axvline(s / 1000, color="w", lw=0.5, alpha=0.5)
        row[1].text((s + e) / 2000, 5500, p, ha="center", fontsize=7, color="w")
axes.flat[-2].set_xlabel("ms"); axes.flat[-1].set_xlabel("s")
plt.tight_layout(); plt.savefig(out, dpi=72)
