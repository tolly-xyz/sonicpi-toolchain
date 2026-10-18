# median speaking pitch of each male Kokoro voice
import numpy as np, soundfile as sf, parselmouth
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
male = [v for v in k.get_voices() if v[1] == "m" and v[0] in "ab"]
for v in male:
    x, sr = k.create("Lower the bucket, lower the bell, down where the hour is drowned.", voice=v, speed=1.0, lang="en-us" if v[0] == "a" else "en-gb")
    sf.write(f"out/{v}.wav", x, sr)
    f0 = parselmouth.Sound(x, sr).to_pitch(pitch_floor=50, pitch_ceiling=300).selected_array["frequency"]
    print(f"{v:14s} median F0 {np.median(f0[f0 > 0]):6.1f} Hz  sr {sr}")
