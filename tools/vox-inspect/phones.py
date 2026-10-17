# Phoneme-level intelligibility: what phonemes does pocketsphinx hear, vs. the ones written?
# usage: phones.py DIR name="PH ON EMES" ...   -> phoneme accuracy per phrase (1 - edit distance / length)
import sys, os, numpy as np, soundfile as sf
from scipy.signal import resample_poly
from pocketsphinx import Decoder, get_model_path
M = get_model_path("en-us")
dec = Decoder(hmm=f"{M}/en-us", allphone=f"{M}/en-us-phone.lm.bin", lw=2.0, beam=1e-20, pbeam=1e-20,
              samprate=16000, logfn="/dev/null")
def heard(path):
    x, sr = sf.read(path); x = x if x.ndim == 1 else x.mean(1)
    x = resample_poly(x, 16000, sr); x = x / (np.abs(x).max() + 1e-9) * 0.7
    x = np.concatenate([np.zeros(4000), x, np.zeros(4000)])
    dec.start_utt(); dec.process_raw((x * 32767).astype(np.int16).tobytes(), full_utt=True); dec.end_utt()
    return [s.word for s in dec.seg() if s.word not in ("SIL", "+NSN+", "+SPN+", "<s>", "</s>")]
def edit(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]
scores = []
for arg in sys.argv[2:]:
    name, want = arg.split("="); want = want.split(); got = heard(f"{sys.argv[1]}/{name}.wav")
    acc = max(0.0, 1 - edit(want, got) / len(want)); scores.append(acc)
    print(f"{name:7s} {acc:5.0%}  want {' '.join(want):34s} heard {' '.join(got)}")
print(f"mean phoneme accuracy {np.mean(scores):.0%}")
