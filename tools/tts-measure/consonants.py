# Consonants from Kokoro, between two vowels: sonorants' formants at their intensity dip; fricatives'
# noise peak (smoothed spectrum of the unvoiced/fricated span) and duration. Median over 4 words x 4 voices.
import json, numpy as np, parselmouth
from scipy.signal import welch, savgol_filter
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
VOICES = ["am_onyx", "am_echo", "am_adam", "am_michael"]
SON = {"L": "holly jelly valley follow", "R": "sorry very carry borrow", "W": "away aware awoke Hawaii",
       "Y": "beyond kayak bayou layer", "M": "hammer summer coming lemon", "N": "honey funny many dinner",
       "NG": "singer hanging ringing singing"}
FRIC = {"S": "messy kissing bossy lesson", "SH": "bushy washing fishing cushion", "F": "coffee waffle office taffy",
        "TH": "nothing ether author method", "Z": "busy lazy easy cousin", "V": "ever oven river seven",
        "DH": "mother other father either"}
VOICED = {"Z", "V", "DH"}
out = {}
def sound(word, v):
    x, sr = k.create(word.capitalize() + ".", voice=v, speed=1.0, lang="en-us"); return x, sr, parselmouth.Sound(x, sr)
for ph, words in SON.items():
    meas = []
    for v in VOICES:
        for w in words.split():
            x, sr, s = sound(w, v)
            it = s.to_intensity(minimum_pitch=60); f = s.to_formant_burg(max_number_of_formants=5, maximum_formant=5000)
            p = s.to_pitch(pitch_floor=50, pitch_ceiling=300); vt = p.xs()[p.selected_array["frequency"] > 0]
            if len(vt) < 5: continue
            t0, t1 = vt[0] + 0.25 * (vt[-1] - vt[0]), vt[0] + 0.75 * (vt[-1] - vt[0])
            ts = np.arange(t0, t1, 0.005); dip = ts[np.argmin([it.get_value(t) for t in ts])]
            tt = np.linspace(dip - 0.012, dip + 0.012, 5)
            meas.append([np.nanmedian([f.get_value_at_time(n, t) for t in tt]) for n in (1, 2, 3)])
    out[ph] = {"F": np.nanmedian(meas, 0).round().tolist(), "sd": np.nanstd(meas, 0).round().tolist()}
    print(ph, out[ph], flush=True)
for ph, words in FRIC.items():
    peaks, durs = [], []
    for v in VOICES:
        for w in words.split():
            x, sr, s = sound(w, v)
            # fricated span: high-band (>2.5 kHz for S/SH/Z, >1 kHz otherwise) energy over a third of its max, inside the word
            hop = int(sr * 0.005); lo = 2500 if ph in ("S", "SH", "Z") else 1000
            from scipy.signal import butter, sosfilt
            hb = sosfilt(butter(4, lo, "high", fs=sr, output="sos"), x); lb = sosfilt(butter(4, 800, "low", fs=sr, output="sos"), x)
            eh = np.sqrt(np.convolve(hb ** 2, np.ones(hop) / hop, "same"))[::hop]; el = np.sqrt(np.convolve(lb ** 2, np.ones(hop) / hop, "same"))[::hop]
            r = eh / (el + 1e-6); on = r > np.percentile(r, 85) * 0.5
            on &= eh > eh.max() * 0.08
            # the longest run of fricated frames
            best, cur, b0 = (0, 0), 0, 0
            for i, o in enumerate(list(on) + [False]):
                if o: cur += 1
                else:
                    if cur > best[1] - best[0]: best = (i - cur, i)
                    cur = 0
            a, b = best
            if b - a < 6: continue
            durs.append((b - a) * 5)
            seg = x[a * hop + (b - a) * hop // 4: b * hop - (b - a) * hop // 4]
            fq, P = welch(seg, sr, nperseg=256); Pd = savgol_filter(10 * np.log10(P + 1e-12), 9, 2)
            band = fq > (1500 if ph in ("S", "Z", "SH") else 500); peaks.append(float(fq[band][np.argmax(Pd[band])]))
    out[ph] = {"peak": float(np.median(peaks)), "peak_sd": float(np.std(peaks)), "ms": float(np.median(durs)), "ms_sd": float(np.std(durs))}
    print(ph, out[ph], flush=True)
json.dump(out, open("consonants.json", "w"), indent=1)
