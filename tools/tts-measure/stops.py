# Word-initial stops from Kokoro: voice onset time (burst -> voicing) and the burst's spectral centroid / peak.
import json, numpy as np, parselmouth
from scipy.signal import butter, sosfilt, welch
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
VOICES = ["am_onyx", "am_echo", "am_adam", "am_michael"]
W = {"P": "pat pit putt pick", "T": "tap tip tough tick", "K": "cap kit cut kick",
     "B": "bat bit but buck", "D": "dad dip duck dab", "G": "gap give gut gift"}
out = {}
for ph, words in W.items():
    vot, cen, pk, lead = [], [], [], []
    for v in VOICES:
        for w in words.split():
            x, sr = k.create(w.capitalize() + ".", voice=v, speed=1.0, lang="en-us")
            hop = int(sr * 0.001)
            hb = sosfilt(butter(4, 1500, "high", fs=sr, output="sos"), x)
            e = np.sqrt(np.convolve(hb ** 2, np.ones(hop * 3) / (hop * 3), "same"))[::hop]
            burst = int(np.argmax(e > e.max() * 0.15))                      # first high-band energy: the release
            p = parselmouth.Sound(x, sr).to_pitch(time_step=0.002, pitch_floor=50, pitch_ceiling=300)
            vt = p.xs()[p.selected_array["frequency"] > 0]
            if not len(vt): continue
            vo = vt[np.argmax(vt > burst / 1000 - 0.03)] * 1000              # first voicing near/after it
            vot.append(vo - burst)
            seg = x[burst * hop: burst * hop + int(sr * 0.012)]
            if len(seg) < 64: continue
            f, P = welch(seg * np.hanning(len(seg)), sr, nperseg=len(seg)); m = f > 300
            cen.append(float((f[m] * P[m]).sum() / P[m].sum())); pk.append(float(f[m][np.argmax(P[m])]))
            lead.append(float(e[burst:burst + 15].max() / (e[burst + 40: burst + 90].max() + 1e-9)))
    out[ph] = {"vot_ms": float(np.median(vot)), "vot_sd": float(np.std(vot)), "centroid": float(np.median(cen)), "peak": float(np.median(pk))}
    print(ph, {k_: round(v_) for k_, v_ in out[ph].items()}, flush=True)
json.dump(out, open("stops.json", "w"), indent=1)
