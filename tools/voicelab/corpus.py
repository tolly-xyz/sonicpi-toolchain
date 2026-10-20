#!/usr/bin/env python3
"""Kokoro reference corpus: how a good neural TTS speaks the Harvard sentences, phone by phone.

The 100 Harvard sentences of lists 1-10 (IEEE 1969; every word is in CMUdict) spoken by Kokoro (the -dur.onnx
export, which also reports its predicted frames per token, speed 1.0) in the voices am_onyx and am_michael.
Per utterance: the 24 kHz mono wav, every phoneme in ARPABET with start/end in seconds, its word and stress,
the pauses at punctuation, and F0 every 10 ms (Praat via parselmouth, floor 50 Hz, ceiling 300 Hz).

  work/voicelab/corpus/index.json   [{"id": "h01_onyx", "text", "voice", "wav", "sr", "f0_median", "f0": [[t, hz|0], ...],
                                      "words": [...], "phones": [{"p", "start", "end", "word", "stress"}, ...],
                                      "pauses", "duration", "list", "ipa", "cmu", "unmapped", "json", "speed"}, ...]
  work/voicelab/corpus/<id>.wav     the audio;  <id>.json  the same record plus Kokoro's raw token timings ("tokens")
  work/voicelab/corpus/README.md    the format in full, and the numbers of the last build

Kokoro's tokens -> phones (the IPA table and diphthong/length merging of tools/worddict/build.py):
  - a stress mark (ˈ primary -> 1, ˌ secondary -> 2) belongs to the phone after it, its time too; vowels without
    one get stress 0, consonants null
  - length and syllabic marks (ː, ̩) extend the phone before them
  - a space between words is split halfway between the phones either side, so phones are contiguous
  - punctuation (with the spaces next to it) is a pause, listed in "pauses" and given to no phone. The phone before
    a pause is phrase-final and holds Kokoro's own pause: a sentence-final [s] lasts ~0.6 s, mostly fading
  - the pauses are the model's own: kokoro-onnx's pause padding is off (sentence_pause = clause_pause = 0)
  - all phone and pause times are moved KOKORO_LEAD (50 ms, 2 frames) earlier than Kokoro's token times: kokoro-
    onnx spreads the predicted frames linearly over the audio (exactly 600 samples a frame), but the decoder's audio
    leads them by ~2 frames (sibilant/vowel edges: median -55 ms am_onyx, -50 ms am_michael, at the start of a
    sentence as at its end; Kokoro's own pipeline subtracts 3 frames). "tokens" stay Kokoro's raw times.
Words are the text split as klattsing's lexicon splits it; each phone gets its word by aligning Kokoro's phones
to CMUdict's (espeak runs words together: "on the" -> ɔnðə, so Kokoro's spaces alone can't say).

usage: corpus.py [--force] [--voices am_onyx,am_michael] [--limit N] [--check] [--threads 2]
  builds whatever is missing (idempotent; --force redoes the audio and F0 too; phones are always re-derived from
  the stored tokens), rewrites index.json and README.md, prints the sanity check. --check: only the check.
  from python:  sys.path.insert(0, "tools/voicelab"); import corpus; corpus.load() -> the index entries
"""
import argparse, collections, json, os, subprocess, sys, time
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "worddict"))
import build as WD

REL = "work/voicelab/corpus"
OUT = f"{ROOT}/{REL}"
KOKORO_DIR = os.environ.get("KOKORO_DIR", "/home/user/tts")
VOICES = ["am_onyx", "am_michael"]
SPEED = 1.0
F0_STEP, F0_FLOOR, F0_CEIL = 0.01, 50, 300
KOKORO_LEAD = 0.05     # s: Kokoro's audio leads its frame timings by ~2 frames (see the module doc)

HARVARD = [
    # list 1
    "The birch canoe slid on the smooth planks.", "Glue the sheet to the dark blue background.",
    "It's easy to tell the depth of a well.", "These days a chicken leg is a rare dish.",
    "Rice is often served in round bowls.", "The juice of lemons makes fine punch.",
    "The box was thrown beside the parked truck.", "The hogs were fed chopped corn and garbage.",
    "Four hours of steady work faced us.", "A large size in stockings is hard to sell.",
    # list 2
    "The boy was there when the sun rose.", "A rod is used to catch pink salmon.",
    "The source of the huge river is the clear spring.", "Kick the ball straight and follow through.",
    "Help the woman get back to her feet.", "A pot of tea helps to pass the evening.",
    "Smoky fires lack flame and heat.", "The soft cushion broke the man's fall.",
    "The salt breeze came across from the sea.", "The girl at the booth sold fifty bonds.",
    # list 3
    "The small pup gnawed a hole in the sock.", "The fish twisted and turned on the bent hook.",
    "Press the pants and sew a button on the vest.", "The swan dive was far short of perfect.",
    "The beauty of the view stunned the young boy.", "Two blue fish swam in the tank.",
    "Her purse was full of useless trash.", "The colt reared and threw the tall rider.",
    "It snowed, rained, and hailed the same morning.", "Read verse out loud for pleasure.",
    # list 4
    "Hoist the load to your left shoulder.", "Take the winding path to reach the lake.",
    "Note closely the size of the gas tank.", "Wipe the grease off his dirty face.",
    "Mend the coat before you go out.", "The wrist was badly strained and hung limp.",
    "The stray cat gave birth to kittens.", "The young girl gave no clear response.",
    "The meal was cooked before the bell rang.", "What joy there is in living.",
    # list 5
    "A king ruled the state in the early days.", "The ship was torn apart on the sharp reef.",
    "Sickness kept him home the third week.", "The wide road shimmered in the hot sun.",
    "The lazy cow lay in the cool grass.", "Lift the square stone over the fence.",
    "The rope will bind the seven books at once.", "Hop over the fence and plunge in.",
    "The friendly gang left the drug store.", "Mesh wire keeps chicks inside.",
    # list 6
    "The frosty air passed through the coat.", "The crooked maze failed to fool the mouse.",
    "Adding fast leads to wrong sums.", "The show was a flop from the very start.",
    "A saw is a tool used for making boards.", "The wagon moved on well oiled wheels.",
    "March the soldiers past the next hill.", "A cup of sugar makes sweet fudge.",
    "Place a rosebush near the porch steps.", "Both lost their lives in the raging storm.",
    # list 7
    "We talked of the side show in the circus.", "Use a pencil to write the first draft.",
    "He ran half way to the hardware store.", "The clock struck to mark the third period.",
    "A small creek cut across the field.", "Cars and busses stalled in snow drifts.",
    "The set of china hit the floor with a crash.", "This is a grand season for hikes on the road.",
    "The dune rose from the edge of the water.", "Those words were the cue for the actor to leave.",
    # list 8
    "A yacht slid around the point into the bay.", "The two met while playing on the sand.",
    "The ink stain dried on the finished page.", "The walled town was seized without a fight.",
    "The lease ran out in sixteen weeks.", "A tame squirrel makes a nice pet.",
    "The horn of the car woke the sleeping cop.", "The heart beat strongly and with firm strokes.",
    "The pearl was worn in a thin silver ring.", "The fruit peel was cut in thick slices.",
    # list 9
    "The Navy attacked the big task force.", "See the cat glaring at the scared mouse.",
    "There are more than two factors here.", "The hat brim was wide and too droopy.",
    "The lawyer tried to lose his case.", "The grass curled around the fence post.",
    "Cut the pie into large parts.", "Men strive but seldom get rich.",
    "Always close the barn door tight.", "He lay prone and hardly moved a limb.",
    # list 10
    "The slush lay deep along the street.", "A wisp of cloud hung in the blue air.",
    "A pound of sugar costs more than eggs.", "The fin was sharp and cut the clear water.",
    "The play seems dull and quite stupid.", "Bail the boat to stop it from sinking.",
    "The term ended in late June that year.", "A tusk is used to make costly gifts.",
    "Ten pins were set in order.", "The bill was paid every third week.",
]
ARPABET = ("AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG OW OY P R S SH T TH UH UW V W Y Z ZH").split()

# ---- Kokoro tokens -> phones ----------------------------------------------------------------------------
STRESS = {"ˈ": 1, "ˌ": 2}
FOLD = {c for c in WD.SKIP if c not in STRESS and not c.isspace()}       # ː and the syllabic mark
BOUND = set(" ,.;:!?—-…\"'()")                                             # word gaps and punctuation

def phones_of(tokens):
    """Kokoro timings [(ipa_char, start, end), ...] -> (phones, pauses, unmapped).
    phones: [{"p", "start", "end", "stress", "group"}] (group = Kokoro's space-separated run), contiguous except
    at pauses; pauses: [{"mark", "start", "end", "after"}] ("after" = index of the phone before, -1 if none)."""
    ph, gaps, unk = [], [], []
    group, stress, carry, i = 0, None, None, 0
    while i < len(tokens):
        c, s, e = tokens[i]
        if c in BOUND:
            j = i
            while j < len(tokens) and tokens[j][0] in BOUND: j += 1
            gaps.append((len(ph) - 1, s, tokens[j - 1][2], "".join(t[0] for t in tokens[i:j]).strip()))
            if ph and ph[-1]["group"] == group: group += 1
            stress = carry = None; i = j; continue
        if c in STRESS:
            stress = STRESS[c]; carry = s if carry is None else carry; i += 1; continue
        if c in FOLD or not (c in WD.IPA or (i + 1 < len(tokens) and c + tokens[i + 1][0] in WD.IPA)):
            if c not in FOLD: unk.append(c)
            if ph: ph[-1]["end"] = e                                       # its time stays with the phone before
            i += 1; continue
        two = c + tokens[i + 1][0] if i + 1 < len(tokens) else None
        if two in WD.IPA: code, e, i = WD.IPA[two], tokens[i + 1][2], i + 2
        else: code, i = WD.IPA[c], i + 1
        vowel = code in WD.VOWELS
        ph.append({"p": code, "start": s if carry is None else carry, "end": e,
                   "stress": (stress or 0) if vowel else None, "group": group})
        carry = None
        if vowel: stress = None
    pauses = []
    for after, s, e, mark in gaps:
        if mark: pauses.append({"mark": mark, "start": round(s, 4), "end": round(e, 4), "after": after})
        elif 0 <= after < len(ph) - 1:                                     # a plain word gap: halfway
            ph[after]["end"] = ph[after + 1]["start"] = (s + e) / 2
    for x in ph: x["start"], x["end"] = round(x["start"], 4), round(x["end"], 4)
    return ph, pauses, unk

def lead_corrected(tokens, lead=KOKORO_LEAD):
    """Kokoro's token times moved `lead` s earlier (clipped at 0), so they match the audio."""
    return [[c, round(max(0.0, s - lead), 4), round(max(0.0, e - lead), 4)] for c, s, e in tokens]

# ---- words: align Kokoro's phones to CMUdict's -------------------------------------------------------------
def _sub(x, y):
    if x == y: return 0.0
    if "|" in (x, y): return 1e9
    return 0.8 if (x in WD.VOWELS) == (y in WD.VOWELS) else 1.2
_indel = lambda x: 0.4 if x == "|" else 1.0

def align(a, b):
    """Weighted edit-distance alignment -> [(i | None, j | None), ...] in order; '|' (word gap) only meets '|'."""
    n, m, inf = len(a), len(b), float("inf")
    D = [[inf] * (m + 1) for _ in range(n + 1)]; B = [[0] * (m + 1) for _ in range(n + 1)]; D[0][0] = 0.0
    for i in range(n + 1):
        Di, Bi = D[i], B[i]
        for j in range(m + 1):
            if i and j:
                c = D[i - 1][j - 1] + _sub(a[i - 1], b[j - 1])
                if c < Di[j]: Di[j], Bi[j] = c, 0
            if i:
                c = D[i - 1][j] + _indel(a[i - 1])
                if c < Di[j]: Di[j], Bi[j] = c, 1
            if j:
                c = Di[j - 1] + _indel(b[j - 1])
                if c < Di[j]: Di[j], Bi[j] = c, 2
    out, i, j = [], n, m
    while i or j:
        k = B[i][j]
        if k == 0: out.append((i - 1, j - 1)); i -= 1; j -= 1
        elif k == 1: out.append((i - 1, None)); i -= 1
        else: out.append((None, j - 1)); j -= 1
    return out[::-1]

def assign_words(ph, cmu):
    """Word index for each phone, plus alignment stats vs CMUdict (stress digits dropped):
    {"n": CMUdict phones, "match", "sub", "ins", "del", "subs": [(cmu, kokoro), ...]}."""
    a, ai = [], []
    for k, x in enumerate(ph):
        if k and x["group"] != ph[k - 1]["group"]: a.append("|"); ai.append(None)
        a.append(x["p"]); ai.append(k)
    b, bw = [], []
    for w, pron in enumerate(cmu):
        if w: b.append("|"); bw.append(None)
        for p in pron.split(): b.append(p.rstrip("012")); bw.append(w)
    word = [None] * len(ph)
    st = {"n": sum(1 for x in b if x != "|"), "match": 0, "sub": 0, "ins": 0, "del": 0, "subs": []}
    for i, j in align(a, b):
        x, y = (a[i] if i is not None else None), (b[j] if j is not None else None)
        if "|" in (x, y): continue
        if x and y:
            word[ai[i]] = bw[j]
            if x == y: st["match"] += 1
            else: st["sub"] += 1; st["subs"].append((y, x))
        elif x: st["ins"] += 1
        else: st["del"] += 1
    for k in range(len(ph)):                                               # inserted phones: nearest neighbour,
        if word[k] is None:                                                # preferring their own Kokoro run
            cand = [m for m in range(len(ph)) if word[m] is not None]
            if cand:
                m = min(cand, key=lambda m: (ph[m]["group"] != ph[k]["group"], abs(m - k), m > k)); word[k] = word[m]
            else: word[k] = 0
    for k in range(1, len(word)): word[k] = max(word[k], word[k - 1])
    return word, st

def cmu_lookup(texts):
    """klattsing's own lexicon (CMUdict + dict/lexicon.json): per text [[word, "DH AH0"], ...]."""
    js = ("import { lookup, addLexicon } from %s; import { readFileSync } from 'node:fs'; addLexicon(%s);"
          "const out = JSON.parse(readFileSync(0, 'utf8')).map((t) => lookup(t).map((w) =>"
          " [w.word, w.phones.map((x) => x.p + (x.stress ?? '')).join(' ')]));"
          "process.stdout.write(JSON.stringify(out));") % (json.dumps(f"{ROOT}/klattsing/src/lexicon.js"),
                                                          json.dumps(f"{ROOT}/dict/lexicon.json"))
    r = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(texts), text=True, capture_output=True)
    if r.returncode: raise SystemExit(f"lexicon lookup failed: {r.stderr.strip()}")
    return json.loads(r.stdout)

# ---- synthesis and measurement -------------------------------------------------------------------------------
class Lazy:
    """Kokoro, loaded on first use (~20 s), on a limited number of CPU threads."""
    def __init__(self, threads): self.threads, self.k = threads, None
    def __call__(self):
        if self.k is None:
            import onnxruntime as rt
            from kokoro_onnx import Kokoro
            so = rt.SessionOptions(); so.intra_op_num_threads = self.threads; so.inter_op_num_threads = 1; so.log_severity_level = 3
            sess = rt.InferenceSession(f"{KOKORO_DIR}/kokoro-v1.0-dur.onnx", so, providers=["CPUExecutionProvider"])
            self.k = Kokoro.from_session(sess, f"{KOKORO_DIR}/voices-v1.0.bin")
        return self.k

def f0_track(x, sr):
    import parselmouth
    p = parselmouth.Sound(np.asarray(x, np.float64), sampling_frequency=sr).to_pitch(
        time_step=F0_STEP, pitch_floor=F0_FLOOR, pitch_ceiling=F0_CEIL)
    return [[round(float(t), 3), round(float(h), 1)] for t, h in zip(p.xs(), p.selected_array["frequency"])]

def utt_id(i, voice): return f"h{i:02d}_{voice.split('_', 1)[-1]}"

def _dump(obj, path, **kw):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, **kw)
    os.replace(tmp, path)

def entry(i, text, voice, cmu, k=None, force=False):
    """The record for sentence i (1-based) in this voice: synthesized (k = Lazy Kokoro) unless the wav and json
    exist (and force is off), or None when missing and k is None. Phones are always re-derived from the tokens."""
    import soundfile as sf
    vid = utt_id(i, voice); wav, js = f"{OUT}/{vid}.wav", f"{OUT}/{vid}.json"
    old = None
    if not force and os.path.exists(wav) and os.path.exists(js):
        old = json.load(open(js, encoding="utf-8"))
        if old.get("text") != text or old.get("voice") != voice or old.get("speed") != SPEED: old = None
    if old is None:
        if k is None: return None
        x, sr, tim = k().create_timed(text, voice=voice, speed=SPEED, lang="en-us", sentence_pause=0.0, clause_pause=0.0)
        sf.write(wav, x, sr, subtype="PCM_16")
        x, sr = sf.read(wav)                                               # measure what was saved
        tokens = [[t.phoneme, round(t.start, 4), round(t.end, 4)] for t in tim]
        f0, dur = f0_track(x, sr), round(len(x) / sr, 4)
    else:
        tokens, f0, sr, dur = old["tokens"], old["f0"], old["sr"], old["duration"]
    ph, pauses, unk = phones_of(lead_corrected(tokens))
    word, _ = assign_words(ph, [p for _, p in cmu])
    voiced = [h for _, h in f0 if h > 0]
    e = {"id": vid, "text": text, "voice": voice, "wav": f"{REL}/{vid}.wav", "sr": sr,
         "f0_median": round(float(np.median(voiced)), 1) if voiced else None, "f0": f0, "words": [w for w, _ in cmu],
         "phones": [{"p": x["p"], "start": x["start"], "end": x["end"], "word": w, "stress": x["stress"]} for x, w in zip(ph, word)],
         "pauses": pauses, "duration": dur, "list": (i - 1) // 10 + 1, "ipa": "".join(t[0] for t in tokens),
         "cmu": [p for _, p in cmu], "unmapped": unk, "json": f"{REL}/{vid}.json", "speed": SPEED,
         "lead_s": KOKORO_LEAD, "tokens": tokens}
    if e != old: _dump(e, js)
    return e

def load(path=None):
    """The corpus index: a list of records (see the module doc / README.md)."""
    return json.load(open(path or f"{OUT}/index.json", encoding="utf-8"))

# ---- sanity check --------------------------------------------------------------------------------------------
def check(entries, detail=("h01_onyx", "h29_michael", "h100_onyx")):
    """Print counts, durations, inventory and CMUdict agreement; returns the numbers for README.md."""
    S = {"utterances": len(entries), "sentences": len({e["text"] for e in entries}),
         "voices": sorted({e["voice"] for e in entries})}
    if not entries: print("corpus is empty"); return S
    S["hours"] = sum(e["duration"] for e in entries) / 3600
    S["seconds"] = {v: round(sum(e["duration"] for e in entries if e["voice"] == v), 1) for v in S["voices"]}
    S["phones"] = sum(len(e["phones"]) for e in entries)
    S["f0_median"] = {v: round(float(np.median([e["f0_median"] for e in entries if e["voice"] == v and e["f0_median"]] or [0])), 1)
                      for v in S["voices"]}
    print(f"{S['utterances']} utterances, {S['sentences']} sentences, voices {', '.join(S['voices'])}")
    print(f"audio {sum(S['seconds'].values()):.1f} s total (" + ", ".join(f"{v} {s} s" for v, s in S["seconds"].items())
          + f"), {S['phones']} phones, F0 median " + ", ".join(f"{v} {f} Hz" for v, f in S["f0_median"].items()))
    inv = collections.Counter(p["p"] for e in entries for p in e["phones"])
    want = collections.Counter(p.rstrip("012") for e in entries for w in e["cmu"] for p in w.split())
    S["missing"] = [p for p in ARPABET if not inv[p]]
    S["inventory"] = dict(sorted(inv.items(), key=lambda kv: -kv[1]))
    S["not_in_text"] = [p for p in S["missing"] if not want[p]]
    print(f"inventory: {len(ARPABET) - len(S['missing'])}/{len(ARPABET)} ARPABET phones"
          + (f", never produced: {' '.join(S['missing'])}" if S["missing"] else "")
          + (f" (not in CMUdict's transcription of the text either: {' '.join(S['not_in_text'])})" if S["not_in_text"] else ""))
    print("  " + " ".join(f"{p}:{n}" for p, n in S["inventory"].items()))
    unk = collections.Counter(c for e in entries for c in e["unmapped"])
    if unk: print(f"unmapped IPA (time given to the phone before): {dict(unk)}")
    # durations: phones are contiguous, so their sum should be the audio less the lead-in, pauses and tail
    ratios, closed = [], []
    for e in entries:
        tot = sum(p["end"] - p["start"] for p in e["phones"]); ps = sum(q["end"] - q["start"] for q in e["pauses"])
        ratios.append(tot / e["duration"]); closed.append((tot + ps) / e["duration"])
        if e["id"] in detail:
            print(f"{e['id']}: audio {e['duration']:.3f} s; phones sum {tot:.3f} s = {tot / e['duration']:.1%} of it "
                  f"({'within' if abs(tot / e['duration'] - 1) <= 0.10 else 'NOT within'} 10%), + pauses {ps:.3f} s = "
                  f"{(tot + ps) / e['duration']:.1%}; lead-in {e['phones'][0]['start']:.3f} s, tail {e['duration'] - e['phones'][-1]['end']:.3f} s")
    r, c = np.array(ratios), np.array(closed)
    S["dur_ratio"] = {"min": round(float(r.min()), 3), "median": round(float(np.median(r)), 3), "max": round(float(r.max()), 3),
                      "within10": int((abs(r - 1) <= 0.10).sum()), "with_pauses_within10": int((abs(c - 1) <= 0.10).sum())}
    print(f"phones sum / audio, all {len(r)}: min {r.min():.3f} median {np.median(r):.3f} max {r.max():.3f}, within 10%: "
          f"{S['dur_ratio']['within10']}/{len(r)}; phones + pauses: min {c.min():.3f} median {np.median(c):.3f}, "
          f"within 10%: {S['dur_ratio']['with_pauses_within10']}/{len(c)}")
    # CMUdict agreement (stress digits dropped)
    tot = collections.Counter(); subs = collections.Counter(); wok = wn = 0
    for e in entries:
        ph, _, _ = phones_of([(c, 0.0, 0.0) for c in e["ipa"]])           # Kokoro's runs, from its IPA
        _, st = assign_words(ph, e["cmu"])
        tot.update({k: st[k] for k in ("n", "match", "sub", "ins", "del")}); subs.update(st["subs"])
        for w, pron in enumerate(e["cmu"]):
            wn += 1; wok += [p["p"] for p in e["phones"] if p["word"] == w] == [p.rstrip("012") for p in pron.split()]
        if e["id"] in detail:
            print(f"  {e['text']}\n    kokoro  {' | '.join(' '.join(p['p'] for p in e['phones'] if p['word'] == w) for w in range(len(e['words'])))}"
                  f"\n    cmudict {' | '.join(' '.join(x.rstrip('012') for x in pron.split()) for pron in e['cmu'])}"
                  f"\n    agreement {st['match'] / st['n']:.1%} ({st['match']}/{st['n']}; sub {st['sub']} ins {st['ins']} del {st['del']})")
    S["agreement"] = round(tot["match"] / tot["n"], 4); S["per"] = round((tot["sub"] + tot["ins"] + tot["del"]) / tot["n"], 4)
    S["word_exact"] = round(wok / wn, 4); S["top_subs"] = [f"{a}->{b}:{n}" for (a, b), n in subs.most_common(12)]
    print(f"CMUdict agreement: {S['agreement']:.1%} of {tot['n']} CMUdict phones matched (sub {tot['sub']}, ins {tot['ins']}, "
          f"del {tot['del']}: PER {S['per']:.1%}); words spelled exactly as CMUdict: {S['word_exact']:.1%} of {wn}")
    print(f"  commonest substitutions (cmudict->kokoro): {' '.join(S['top_subs'])}")
    return S

README = """# Kokoro reference corpus

Built by `tools/voicelab/corpus.py` (`/home/user/tts/venv/bin/python tools/voicelab/corpus.py`; idempotent,
`--force` redoes everything, `--check` only prints the sanity check). Don't edit by hand: it is rebuilt.

What: the Harvard sentences, lists 1-10 (IEEE 1969, 100 sentences; ids `h01`..`h100`, `h01`-`h20` are the lists 1-2
of `tools/voicelab/sentences.py`), spoken by Kokoro v1.0 (`kokoro-v1.0-dur.onnx`, speed 1.0, lang en-us, the model's
own pauses: kokoro-onnx's `sentence_pause`/`clause_pause` padding off) in the voices {voices}.

## Files
- `<id>.wav`: 24 kHz mono 16-bit, `<id>` = `h<NN>_<voice without am_>` e.g. `h01_onyx`, `h100_michael`
- `<id>.json`: the record below plus `tokens` = Kokoro's raw timings `[[ipa_char, start, end], ...]`
- `index.json`: a list of all records (without `tokens`), sentence by sentence, voices in the order above

## Record
```
{{"id": "h01_onyx", "text": "The birch canoe slid on the smooth planks.", "voice": "am_onyx",
  "wav": "work/voicelab/corpus/h01_onyx.wav", "sr": 24000, "f0_median": 92.1,
  "f0": [[t_sec, hz_or_0], ...],                       # Praat to_pitch: every 10 ms, floor 50, ceiling 300; 0 = unvoiced
  "words": ["the", "birch", ...],                      # the text as klattsing's lexicon splits it (lower case)
  "phones": [{{"p": "DH", "start": 0.037, "end": 0.062, "word": 0, "stress": null}}, ...],
  "pauses": [{{"mark": ".", "start": 2.887, "end": 2.958, "after": 26}}],   # after = index of the phone before
  "duration": 3.008, "list": 1, "ipa": "ðə bˈɜːtʃ ...", "cmu": ["DH AH0", "B ER1 CH", ...],
  "unmapped": [], "json": "work/voicelab/corpus/h01_onyx.json", "speed": 1.0, "lead_s": 0.05}}
```
- times in seconds from the start of the wav; `p` is ARPABET without stress digits (the 39 CMUdict phones)
- `lead_s`: phone and pause times are Kokoro's token times less this (2 frames): kokoro-onnx spreads the predicted
  frames linearly over the audio, but the audio leads them by ~50 ms (measured on sibilant/vowel edges in both
  voices, constant through the sentence). `tokens` in `<id>.json` are the raw, uncorrected times
- `stress`: vowels 1 (Kokoro's ˈ), 2 (ˌ, secondary), 0 (no mark); consonants null
- `word`: index into `words`
- `cmu`: klattsing's lexicon entry for each word (CMUdict with stress digits), for comparison

## How tokens become phones
IPA -> ARPABET with the table of `tools/worddict/build.py` (diphthongs and affricates merged, ɾ -> D, ʔ -> T).
A stress mark belongs to the phone after it (time included); length and syllabic marks extend the phone before;
an IPA character outside the table gives its time to the phone before (listed in `unmapped`).
A space between words is split halfway between its neighbours, so phones are contiguous; punctuation (and the
spaces beside it) is a pause, in `pauses`, given to no phone. The phone before a pause is phrase-final and holds
Kokoro's own pause: a sentence-final phone often lasts 0.5-0.6 s, mostly a fade (`tools/worddict/build.py` sets
such durations to None; here they are kept as Kokoro predicted them, so cap them when fitting duration rules).
Kokoro predicts durations in 25 ms frames, so boundaries are on a 25 ms grid (halfway splits make 12.5 ms).
Words: espeak runs words together ("on the" -> ɔnðə), so phones get their word by aligning Kokoro's phones (with
its spaces) to CMUdict's (with word gaps), a weighted edit distance where a gap only meets a gap.

## Last build
{stats}
"""

def write_readme(S):
    lines = [f"- {S['utterances']} utterances ({S['sentences']} sentences x {len(S['voices'])} voices), "
             f"{S.get('hours', 0) * 60:.1f} min of audio ({', '.join(f'{v} {s} s' for v, s in S.get('seconds', {}).items())}), "
             f"{S.get('phones', 0)} phones"]
    if "f0_median" in S: lines.append("- F0 median: " + ", ".join(f"{v} {f} Hz" for v, f in S["f0_median"].items()))
    if "inventory" in S:
        lines.append(f"- phone inventory: {len(ARPABET) - len(S['missing'])}/{len(ARPABET)}"
                     + (f" (never produced: {' '.join(S['missing'])}; not in CMUdict's transcription of the text either: "
                        f"{' '.join(S['not_in_text']) or '-'})" if S["missing"] else ""))
        lines.append("  " + " ".join(f"{p}:{n}" for p, n in S["inventory"].items()))
    if "dur_ratio" in S:
        d = S["dur_ratio"]
        lines.append(f"- sum of phone durations / audio length: min {d['min']}, median {d['median']}, max {d['max']} "
                     f"({d['within10']}/{S['utterances']} within 10%; with the pauses {d.get('with_pauses_within10')}/{S['utterances']}; "
                     f"the rest is lead-in and tail)")
    if "agreement" in S:
        lines.append(f"- vs CMUdict: {S['agreement']:.1%} of CMUdict's phones matched, phone error rate {S['per']:.1%}, "
                     f"{S['word_exact']:.1%} of words exactly as CMUdict; commonest substitutions (cmudict->kokoro): "
                     + " ".join(S["top_subs"]))
    with open(f"{OUT}/README.md", "w", encoding="utf-8") as f:
        f.write(README.format(voices=", ".join(S["voices"]) or ", ".join(VOICES), stats="\n".join(lines)))

def selftest():
    """Token -> phone conversion and word alignment on hand-made timings (no Kokoro, no files)."""
    def toks(ipa, step=0.05, t0=0.1):
        return [(c, round(t0 + n * step, 4), round(t0 + (n + 1) * step, 4)) for n, c in enumerate(ipa)]
    ph, pauses, unk = phones_of(toks("ðə bˈɜːtʃ."))                     # ð ə _ b ˈ ɜ ː t ʃ .
    assert [p["p"] for p in ph] == ["DH", "AH", "B", "ER", "CH"], ph
    assert [p["stress"] for p in ph] == [None, 0, None, 1, None], ph
    assert ph[3]["start"] == 0.3 and ph[3]["end"] == 0.45, ph[3]        # ˈ and ː are the vowel's time
    assert ph[1]["end"] == ph[2]["start"] == 0.225, ph                  # the word gap split halfway
    assert all(a["end"] == b["start"] for a, b in zip(ph, ph[1:]))      # contiguous
    assert pauses == [{"mark": ".", "start": 0.55, "end": 0.6, "after": 4}] and not unk, pauses
    ph, pauses, _ = phones_of(toks("snˈoʊd, ɹˈeɪnd"))
    assert [p["p"] for p in ph] == ["S", "N", "OW", "D", "R", "EY", "N", "D"], ph
    assert pauses == [{"mark": ",", "start": 0.4, "end": 0.5, "after": 3}], pauses
    assert ph[3]["end"] == 0.4 and ph[4]["start"] == 0.5                # no phone holds the pause
    ph, _, _ = phones_of(toks("ˌæ"))
    assert ph[0]["stress"] == 2
    ph, _, unk = phones_of(toks("bʘɪ"))                                 # unknown IPA: time to the phone before
    assert [p["p"] for p in ph] == ["B", "IH"] and unk == ["ʘ"] and ph[0]["end"] == 0.2, ph
    ph, _, _ = phones_of(toks("ɔnðə smˈuːð"))                           # espeak ran "on the" together
    word, st = assign_words(ph, ["AA1 N", "DH AH0", "S M UW1 DH"])
    assert word == [0, 0, 1, 1, 2, 2, 2, 2], word
    assert (st["n"], st["match"], st["sub"], st["subs"]) == (8, 7, 1, [("AA", "AO")]), st
    assert lead_corrected([["b", 0.03, 0.0867], ["ɪ", 0.0867, 0.2]]) == [["b", 0.0, 0.0367], ["ɪ", 0.0367, 0.15]]
    word, st = assign_words(phones_of(toks("ðə kæt"))[0], ["DH AH0", "B IH1 G", "K AE1 T"])   # a word Kokoro skipped
    assert word == [0, 0, 2, 2, 2] and st["del"] == 3, (word, st)
    print("selftest ok")

def main():
    ap = argparse.ArgumentParser(description="Kokoro reference corpus of the Harvard sentences (see the module doc)")
    ap.add_argument("--selftest", action="store_true", help="test the token conversion and word alignment, then exit")
    ap.add_argument("--force", action="store_true", help="re-synthesize and re-measure everything")
    ap.add_argument("--voices", default=",".join(VOICES), help="voices to build now (others are indexed if present)")
    ap.add_argument("--limit", type=int, default=len(HARVARD), help="build only the first N sentences")
    ap.add_argument("--check", action="store_true", help="only print the sanity check of index.json")
    ap.add_argument("--threads", type=int, default=2, help="onnxruntime threads (default 2)")
    a = ap.parse_args()
    if a.selftest: selftest(); return
    if a.check: check(load()); return
    os.makedirs(OUT, exist_ok=True)
    build_voices = [v for v in a.voices.split(",") if v]
    voices = VOICES + [v for v in build_voices if v not in VOICES]
    cmu = cmu_lookup(HARVARD)
    k, entries, made, t0 = Lazy(a.threads), [], 0, time.time()
    for i, text in enumerate(HARVARD, 1):
        for v in voices:
            build = v in build_voices and i <= a.limit
            had = os.path.exists(f"{OUT}/{utt_id(i, v)}.json") and not a.force
            e = entry(i, text, v, cmu[i - 1], k if build else None, force=a.force and build)
            if e is None: continue
            entries.append(e)
            if build and not had:
                made += 1; print(f"{e['id']:13s} {e['duration']:5.2f} s  F0 {e['f0_median']} Hz  {len(e['phones'])} phones  {text}", flush=True)
    _dump([{x: y for x, y in e.items() if x != "tokens"} for e in entries], f"{OUT}/index.json", indent=None, separators=(",", ":"))
    print(f"{made} synthesized in {time.time() - t0:.0f} s, {len(entries)} in {REL}/index.json\n")
    write_readme(check(entries))

if __name__ == "__main__":
    main()
