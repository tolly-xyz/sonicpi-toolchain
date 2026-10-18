# Measuring klattsch phoneme targets from a TTS voice

Kokoro v1.0 (via `kokoro-onnx`) speaks test words; Praat (`praat-parselmouth`) measures them.
The results feed phoneme banks in `banks/`, which `bin/klatt-render.mjs` loads (`[bank=NAME]`).

```sh
python3 -m venv venv && venv/bin/pip install kokoro-onnx praat-parselmouth soundfile scipy
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
venv/bin/python pick.py         # speaking pitch of each male voice (am_onyx is the deepest, ~85 Hz)
venv/bin/python vowels.py       # vowel formants, 4 words x 4 voices -> vowels.json
venv/bin/python consonants.py   # sonorant formants, fricative noise peaks and durations -> consonants.json
venv/bin/python stops.py        # stop voice-onset time and burst spectra -> stops.json
```

Run them in the directory holding the two model files. What held up: vowel formants (the method
recovers klattsch's own targets within ~50-150 Hz) and stop burst centroids. Sonorant formants and
fricative peaks other than S/Z were too scattered to use.
