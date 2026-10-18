# Vowel targets from Kokoro: h_d words, formants (Burg) over the vowel's middle (and its
# ends for diphthongs), median across several deep male voices.
import json, sys, numpy as np, soundfile as sf, parselmouth
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
VOICES = ["am_onyx", "am_echo", "am_adam", "am_michael"]
WORDS = {"IY": "heed beat keep seed", "IH": "hid bit kick sit", "EY": "hayed bait cape say", "EH": "head bet deck set",
         "AE": "had bat cap sad", "AA": "hod pot cop sod", "AO": "hawed bought caught sawed", "OW": "hoed boat coat sewed",
         "UH": "hood book could put", "UW": "who'd boot coop sued", "AH": "hud but cup shut", "ER": "heard bird curt hurt",
         "AY": "hide bite kite side", "AW": "how'd bout pout loud", "OY": "boy coin soil void"}
DIPH = {"AY", "AW", "OY", "EY", "OW"}
def measure(x, sr):
    s = parselmouth.Sound(x, sr)
    pitch = s.to_pitch(pitch_floor=50, pitch_ceiling=300); f = s.to_formant_burg(max_number_of_formants=5, maximum_formant=5000)
    ts = pitch.xs(); voiced = pitch.selected_array["frequency"] > 0
    # the longest voiced run is the vowel (the final d's voicing is short)
    runs, start = [], None
    for i, on in enumerate(list(voiced) + [False]):
        if on and start is None: start = i
        if not on and start is not None: runs.append((start, i)); start = None
    a, b = max(runs, key=lambda r: r[1] - r[0]); t0, t1 = ts[a], ts[b - 1]
    def at(frac_lo, frac_hi):
        tt = np.linspace(t0 + (t1 - t0) * frac_lo, t0 + (t1 - t0) * frac_hi, 9)
        return [float(np.nanmedian([f.get_value_at_time(n, t) for t in tt])) for n in (1, 2, 3)] + \
               [float(np.nanmedian([f.get_bandwidth_at_time(n, t) for t in tt])) for n in (1, 2, 3)]
    return at(0.35, 0.65), at(0.1, 0.25), at(0.75, 0.9), (t1 - t0) * 1000
res = {}
for ph, w in WORDS.items():
    per = []
    for v in VOICES:
        for word in w.split():
            x, sr = k.create(word.capitalize() + ".", voice=v, speed=1.0, lang="en-us")
            try: per.append(measure(x, sr))
            except Exception: pass
    mid = np.median([p[0] for p in per], 0); on = np.median([p[1] for p in per], 0); off = np.median([p[2] for p in per], 0)
    spread = np.std([p[0][:3] for p in per], 0)
    res[ph] = {"mid": mid.round().tolist(), "on": on.round().tolist(), "off": off.round().tolist(), "ms": float(np.median([p[3] for p in per]))}
    print(f"{ph:3s} {w.split()[0]:6s} F1-3 {mid[:3].round()}  sd {spread.round()}  BW {mid[3:].round()}  on {on[:3].round()} off {off[:3].round()}", flush=True)
json.dump(res, open("vowels.json", "w"), indent=1)
