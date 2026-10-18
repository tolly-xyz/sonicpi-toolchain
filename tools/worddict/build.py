#!/usr/bin/env python3
"""Word dictionary for klattsch singing: how a real voice times each word.

Kokoro (TTS) speaks each lyric line in several deep male voices; its duration predictor (exposed
as an extra ONNX output, see export_durations) says how long each phoneme lasts. Phonemes are
mapped from Kokoro's IPA to klattsch's ARPABET and the medians per word are merged into
dict/words.json:  {"lower": {"phones": ["L","OW","ER"], "ms": [62, 150, 75], "stress": [0,1,0], "n": 8}}

usage: build.py MODEL_DIR LYRICS.txt [...]      (one line per sung/spoken line; '#' comments)
"""
import json, os, re, sys, collections
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DICT = f"{ROOT}/dict/words.json"
VOICES = ["am_onyx", "am_echo", "am_adam", "am_michael"]
SPEED = 0.5                          # durations come in 25 ms frames: speak at half speed, halve them

# Kokoro (espeak-ng) IPA -> ARPABET; longest match first
IPA = {"tʃ": "CH", "dʒ": "JH", "eɪ": "EY", "aɪ": "AY", "aʊ": "AW", "ɔɪ": "OY", "oʊ": "OW", "əʊ": "OW",
       "ɜː": "ER", "ɜ": "ER", "ɚ": "ER", "ɝ": "ER", "iː": "IY", "i": "IY", "ɪ": "IH", "ᵻ": "IH", "ɛ": "EH", "e": "EH",
       "æ": "AE", "a": "AA", "ɑː": "AA", "ɑ": "AA", "ɒ": "AA", "ɔː": "AO", "ɔ": "AO", "o": "OW", "ʊ": "UH",
       "uː": "UW", "u": "UW", "ʌ": "AH", "ə": "AH", "ɐ": "AH",
       "p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "ɡ": "G", "g": "G", "f": "F", "v": "V", "θ": "TH", "ð": "DH",
       "s": "S", "z": "Z", "ʃ": "SH", "ʒ": "ZH", "h": "HH", "m": "M", "n": "N", "ŋ": "NG", "l": "L", "ɹ": "R", "r": "R",
       "w": "W", "j": "Y", "ɾ": "D", "ʔ": "T"}
SKIP = set("ˌː̩ ̩")              # length and syllabic marks fold into their phoneme

def export_durations(model_dir):
    """kokoro-v1.0.onnx with its predicted per-token durations as an output named 'duration'."""
    out = f"{model_dir}/kokoro-v1.0-dur.onnx"
    if not os.path.exists(out):
        import onnx
        from onnx import helper, TensorProto
        m = onnx.load(f"{model_dir}/kokoro-v1.0.onnx")
        m.graph.node.append(helper.make_node("Cast", ["/encoder/Clip_output_0"], ["duration"], name="duration_out", to=TensorProto.INT64))
        m.graph.output.append(helper.make_tensor_value_info("duration", TensorProto.INT64, ["n"]))
        onnx.save(m, out)
    return out

def words_of(timings):
    """Kokoro timings -> [[ (ARPABET, ms, stressed), ... ] per word]."""
    words, cur, stress, carry = [], [], False, 0.0
    toks = [(t.phoneme, (t.end - t.start) * 1000 * SPEED) for t in timings]
    i = 0
    while i < len(toks):
        ph, ms = toks[i]
        if ph in " ,.;:!?—-…\"'":
            if cur:
                if ph != " " and cur: cur[-1] = (cur[-1][0], None, cur[-1][2])   # phrase-final: holds the pause
                words.append(cur); cur = []
            i += 1; carry = 0.0; continue
        if ph == "ˈ": stress = True; carry += ms; i += 1; continue
        if ph in SKIP:
            if cur and cur[-1][1] is not None: cur[-1] = (cur[-1][0], cur[-1][1] + ms, cur[-1][2])
            i += 1; continue
        two = ph + toks[i + 1][0] if i + 1 < len(toks) else None
        if two in IPA: code, ms, i = IPA[two], ms + toks[i + 1][1], i + 2
        elif ph in IPA: code, i = IPA[ph], i + 1
        else: print(f"  ? unmapped {ph!r}", file=sys.stderr); i += 1; continue
        vowel = code in VOWELS
        cur.append((code, ms + carry, stress and vowel)); carry = 0.0
        if vowel: stress = False
    if cur: cur[-1] = (cur[-1][0], None, cur[-1][2]); words.append(cur)
    return words

def split_runs(k, words, names):
    """espeak runs some words together ("with the" -> wɪððə): split by each word's own phonemes."""
    if len(words) == len(names): return words
    own = []
    for n in names:
        _, _, tim = k.create_timed(n, voice=VOICES[0], speed=1.0, lang="en-us")
        own.append([p for w in words_of(tim) for p, _, _ in w])
    flat = [x for w in words for x in w]
    if [p for p, _, _ in flat] != [p for o in own for p in o]: return None
    out, i = [], 0
    for o in own: out.append(flat[i:i + len(o)]); i += len(o)
    return out
VOWELS = set("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split())

def main():
    model_dir, files = sys.argv[1], sys.argv[2:]
    from kokoro_onnx import Kokoro
    k = Kokoro(export_durations(model_dir), f"{model_dir}/voices-v1.0.bin")
    seen = collections.defaultdict(list)                  # word -> [(phones, ms, stress)]
    for f in files:
        for line in open(f, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if not line: continue
            names = [w.lower().strip("'") for w in re.findall(r"[A-Za-z']+", line)]
            for v in VOICES:
                _, _, tim = k.create_timed(line, voice=v, speed=SPEED, lang="en-us")
                ws = split_runs(k, words_of(tim), names)
                if ws is None:
                    print(f"  skip ({v}): can't split {line!r} into words", file=sys.stderr); continue
                for name, w in zip(names, ws):
                    seen[name].append(([p for p, _, _ in w], [m for _, m, _ in w], [int(s) for _, _, s in w]))
    d = json.load(open(DICT)) if os.path.exists(DICT) else {}
    for name, takes in seen.items():
        phones = collections.Counter(tuple(t[0]) for t in takes).most_common(1)[0][0]     # the usual pronunciation
        same = [t for t in takes if tuple(t[0]) == phones]
        ms = np.array([[np.nan if x is None else x for x in t[1]] for t in same], float)
        with np.errstate(all="ignore"): med = np.nanmedian(ms, 0)
        d[name] = {"phones": list(phones), "ms": [None if np.isnan(x) else round(float(x)) for x in med],
                   "stress": [int(round(x)) for x in np.median([t[2] for t in same], 0)], "n": len(same)}
    json.dump(dict(sorted(d.items())), open(DICT, "w"), indent=0)
    print(f"{len(seen)} words -> {DICT} ({len(d)} total)")

if __name__ == "__main__":
    main()
