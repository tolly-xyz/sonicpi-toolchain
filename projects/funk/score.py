#!/usr/bin/env python3
"""The funk song's score: one source for every part. Writes work/funk/score.json:
  {"bpm", "bars": [{"sec", "k", "t", "chord"}], "parts": {name: [{"t", "dur", "note", "vel", ...}]}}
Times are seconds from the first beat, with swing and a little human timing already applied.
The Sonic Pi song plays "moog" and "lead" from it; mix.py renders everything else.
"""
import json, os, random

BPM = 102
SWING = 0.57                                  # the second 16th of each 8th, as a share of the 8th
BEAT = 60 / BPM
rnd = random.Random(7)

E, A, C, B = 40, 45, 48, 47                   # chord roots (MIDI, octave 2)
VOICING = {"E9": [56, 62, 66, 71], "A9": [55, 61, 64, 71], "C9": [58, 64, 67, 74], "B7#9": [57, 63, 66, 74]}
ROOT = {"E9": E, "A9": A, "C9": C, "B7#9": B}

FORM = [("intro", 4, ["E9"]), ("a1", 8, ["E9"]), ("b1", 4, ["A9", "A9", "C9", "B7#9"]),
        ("a2", 8, ["E9"]), ("brk", 4, ["E9"]), ("b2", 4, ["A9", "A9", "C9", "B7#9"]),
        ("a3", 8, ["E9"]), ("end", 2, ["E9"])]

bars = []
t = 0.0
for sec, n, chords in FORM:
    for k in range(n):
        bars.append({"sec": sec, "k": k, "n": n, "t": round(t, 4), "chord": chords[k % len(chords)]})
        t += 4 * BEAT
TOTAL = t

def at(bar, step, jitter=0.004):
    """Seconds for 16th `step` of a bar, swung, with human timing."""
    beat, sub = divmod(step, 4)
    eighth, second = divmod(sub, 2)
    pos = beat + eighth * 0.5 + (SWING * 0.5 if second else 0.0)
    return bar["t"] + pos * BEAT + rnd.uniform(-jitter, jitter)
def steps(n): return n * BEAT / 4
def vel(v, spread=0.06): return max(0.05, min(1.0, v + rnd.uniform(-spread, spread)))

parts = {k: [] for k in ("moog", "lead", "clav", "gtr", "organ", "horns", "drums", "perc")}
def note(part, bar, step, n, length, v, **kw):
    parts[part].append({"t": round(at(bar, step), 4), "dur": round(steps(length) * 0.92, 4), "note": n, "vel": round(vel(v), 3), **kw})
def hit(part, bar, step, inst, v, jitter=0.004, **kw):
    parts[part].append({"t": round(at(bar, step, jitter), 4), "inst": inst, "vel": round(vel(v), 3), **kw})

# ---- bass: a Minimoog line, octave jumps and ghost notes, one bar riffs
RIFF_A = [(0, 0, 3, 1.0), (3, 0, 1, 0.45), (4, 12, 1, 0.9), (6, 10, 1, 0.75), (7, 12, 1, 0.9), (9, 7, 2, 0.9),
          (11, 10, 1, 0.7), (12, 0, 1, 1.0), (14, 3, 1, 0.8), (15, 4, 1, 0.9)]
RIFF_A2 = RIFF_A[:7] + [(12, 0, 1, 1.0), (13, 12, 1, 0.8), (14, 10, 1, 0.8), (15, 7, 1, 0.9)]
RIFF_B = [(0, 0, 2, 1.0), (3, 0, 1, 0.45), (4, 7, 1, 0.85), (6, 12, 2, 0.9), (9, 10, 1, 0.75), (10, 7, 1, 0.8),
          (12, 0, 1, 1.0), (14, 12, 1, 0.8), (15, 10, 1, 0.8)]
RIFF_BRK = [(0, 0, 4, 1.0), (6, 12, 1, 0.9), (7, 10, 1, 0.8), (8, 7, 2, 0.9), (10, 5, 1, 0.8), (11, 3, 1, 0.8), (12, 0, 4, 1.0)]

# ---- drums: VariBreaks (kick/snare/hats), Black Pearl (open hat, crash), Gimme A Hand (hand percussion)
for i, bar in enumerate(bars):
    sec, k, ch = bar["sec"], bar["k"], bar["chord"]
    root = ROOT[ch]; vo = VOICING[ch]
    first = k == 0
    if sec == "end":
        if k == 0:
            hit("drums", bar, 0, "crash", 1.0); hit("drums", bar, 0, "kick", 1.0); hit("drums", bar, 0, "snare", 1.0)
            note("moog", bar, 0, root, 12, 1.0, slide_to=root - 12)
            for n in vo: note("clav", bar, 0, n, 2, 0.9); note("horns", bar, 0, n + 12, 10, 1.0)
            note("organ", bar, 0, vo[0], 14, 0.6); note("organ", bar, 0, vo[2], 14, 0.6)
        continue
    # drums
    full = sec != "intro" or k >= 0
    kicks = [(0, 1.0), (7, 0.55), (10, 0.95)] + ([(13, 0.6)] if k % 2 else [])
    if sec == "brk": kicks = [(0, 1.0), (10, 0.9)]
    for s, v in kicks: hit("drums", bar, s, "kick", v, 0.002)
    for s in (4, 12): hit("drums", bar, s, "snare", 1.0 if sec != "intro" or k > 1 else 0.85, 0.002)
    for s, v in ((2, 0.22), (7, 0.18), (9, 0.25), (15, 0.3)): hit("drums", bar, s, "ghost", v)
    if sec != "brk":
        for s in range(16):
            if s == 14: hit("drums", bar, s, "hat_open", 0.7)
            elif s != 15: hit("drums", bar, s, "hat", 0.75 if s % 2 == 0 else 0.4)
    if first and sec not in ("intro",): hit("drums", bar, 0, "crash", 0.9)
    if k == bar["n"] - 1 and sec in ("a1", "a2", "b1"):                 # a fill into the next section
        for s, v in ((12, 0.6), (13, 0.7), (14, 0.85), (15, 0.95)): hit("drums", bar, s, "snare", v)
    # percussion
    if sec in ("a2", "a3", "b2"):
        for s in (2, 6, 10, 14): hit("perc", bar, s, "tamb", 0.55)
        for s in (4, 12): hit("perc", bar, s, "tamb", 0.85)
    if sec in ("brk", "b1", "b2", "a3"):
        for s in (4, 12): hit("perc", bar, s, "clap", 0.9)
    if sec in ("brk", "a3"):
        for s in (0, 3, 6, 8, 10, 11, 14): hit("perc", bar, s, "bongo_lo" if s in (0, 8) else "bongo_hi", 0.55 if s % 2 else 0.75)
    if sec == "a3":
        for s in (0, 3, 6, 10, 12): hit("perc", bar, s, "cowbell", 0.6)
    # bass
    if sec != "intro" or k >= 2:
        riff = RIFF_BRK if sec == "brk" else RIFF_B if sec in ("b1", "b2") else (RIFF_A2 if k % 2 else RIFF_A)
        for s, rel, ln, v in riff:
            note("moog", bar, s, root + rel - 12, ln, v, slide=(sec == "brk" and s in (6, 8)))
    # clavinet comping: syncopated stabs
    if sec != "brk" and not (sec == "intro" and k < 2):
        for s, v in ((2, 0.75), (3, 0.55), (6, 0.85), (9, 0.55), (10, 0.75), (13, 0.55), (14, 0.85)):
            for n in vo[:3]: note("clav", bar, s, n, 1, v)
    # muted guitar: 16th chicken scratch, backbeat accents
    if sec in ("a1", "a2", "a3", "b1", "b2"):
        for s in range(16):
            v = 0.9 if s in (4, 12) else 0.35 if s % 2 else 0.5
            for n in vo[1:]: note("gtr", bar, s, n + 12, 0.5, v)
    # organ: held chords, from the second groove on
    if sec in ("a2", "b1", "b2", "a3"):
        for n in vo: note("organ", bar, 0, n, 16, 0.45 if sec in ("a2", "a3") else 0.6)
    # horns: stabs in the choruses, a riff in the last groove
    if sec in ("b1", "b2"):                                     # stabs in the gaps between call and response
        hits = ((6, 1), (15, 1)) if k < 2 else ((14, 2),) if k == 3 else ()
        for s, ln in hits:
            for n in vo[1:]: note("horns", bar, s, n + 12, ln, 0.9)
    if sec == "a3":                                             # the horns answer: the voices take the even bars
        line = [(0, 71, 2), (3, 74, 1), (4, 76, 2), (7, 74, 1), (8, 71, 1), (10, 69, 1), (11, 67, 1), (12, 64, 4)] if k % 2 == 1 \
            else [(14, 76, 2)]
        for s, n, ln in line:
            note("horns", bar, s, n, ln, 0.9); note("horns", bar, s, n - 12, ln, 0.8)
    # lead: Worrell-style squiggles answering every other bar
    if sec in ("a2", "a3", "brk") and k % 2 == 1:
        scale = [64, 67, 69, 70, 71, 74, 76, 79]
        s, n = rnd.choice([4, 6, 8]), rnd.randrange(3, 7)
        while s < 15:
            n = max(0, min(len(scale) - 1, n + rnd.choice([-2, -1, 1, 1, 2])))
            ln = rnd.choice([1, 1, 2])
            note("lead", bar, s, scale[n], ln, 0.8, slide=rnd.random() < 0.4)
            s += ln

# ---- vocals: klattsing specs placed in time (mix.py renders them with klattsing/bin/klattsing.mjs)
import subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def stresses(text):
    """klattsing's syllables for a line: [stress, ...] (CMUdict stress, maximal-onset syllables)."""
    js = ("import('%s/klattsing/src/compile.js').then(m => console.log(JSON.stringify("
          "m.words(process.argv[1]).flatMap(w => w.syllables.map(s => s.stress)))))") % ROOT
    return json.loads(subprocess.run(["node", "-e", js, text], capture_output=True, text=True, check=True).stdout)
def bar_of(sec, k): return next(i for i, b in enumerate(bars) if b["sec"] == sec and b["k"] == k)
def swung_ms(bar_i, step, length):
    """ms of `length` 16ths starting at a bar's step, with the band's swing (no jitter)."""
    def pos(st):
        b, st = divmod(st, 16); beat, sub = divmod(st, 4); eighth, second = divmod(sub, 2)
        return bars[bar_i]["t"] + (b * 4 + beat + eighth * 0.5 + (SWING * 0.5 if second else 0)) * BEAT
    return (pos(step + length) - pos(step)) * 1000
VOICE = {"lead": "g0.65 t0.2 h0.08 s0.98", "gangA": "g0.75 t0.3 h0.12 s0.94", "gangB": "g0.6 t0.15 h0.15 s1.02",
         "gangC": "g0.7 t0.25 h0.1 s1.06"}       # the MC uses klattsing's plain speech voice (clearer in tests)
# klattsing features from the voicelab tournament: coarticulated formants (Whisper pairs 47% -> 69%) and the LF
# voice source (much closer to a real voice spectrally)
# klattsing features from the voicelab tournament. Sung lines leave out the glottal source: it costs low sung pitch dearly
# (pairs sing mode: base 41% / +coarticulation 52% / +nasals 57% / +stops 61%; +glottal alone 25%), and it took this song's
# lines from 57% to 43% of words heard. Spoken lines (the MC) get all four.
FEATURES = {"coarticulation": True, "nasals": True, "stops": True}
FEATURES_SPEAK = {**FEATURES, "glottal": True}
vox = []
def chant(sec, k, step, text, style="lead", span=32, end_note=40, hi=47, lo=43, rest=2, bank="silt-stops"):
    """A line chanted from a bar's step: unstressed syllables a 16th, stressed an 8th, the last held to
    fill `span` 16ths (less `rest`); stressed syllables alternate hi/lo, the last lands on end_note."""
    st = stresses(text); n = len(st)
    lens = [1 if s == 0 else 2 for s in st[:-1]]
    lens.append(max(2, span - rest - sum(lens)))
    pitches, up = [], True
    for s in st[:-1]:
        if s: pitches.append(hi if up else lo); up = not up
        else: pitches.append(lo)
    pitches.append(end_note)
    bi = bar_of(sec, k); pos = step; notes = []
    for j, (p, ln) in enumerate(zip(pitches, lens)):
        notes.append([p, {"ms": round(swung_ms(bi, pos, ln), 1)}] + ([{"gate": 420}] if j == n - 1 else [])); pos += ln
    t0 = round(at(bars[bi], step, 0), 4)
    # the gang is the lead voice up front with two quieter doubles wide behind it: three equal, offset
    # takes smeared the words (Whisper per line: gang lines 0-2 of 3 where the lead got them)
    takes = [("lead", 0.0, 0.0, 1.0)] if style == "lead" else [("lead", 0.0, 0.0, 1.0), ("gangA", -0.6, 0.015, 0.45), ("gangC", 0.6, 0.025, 0.45)]
    for v, pan, dt, gain in takes:
        vox.append({"t": round(t0 + dt, 4), "style": style, "pan": pan, "gain": gain, "text": text,
                    "spec": {"mode": "sing", "text": text, "notes": notes, "voice": VOICE[v], "bank": bank, "gate": 160, "hold": 0.6, **FEATURES}})
def say(sec, k, step, text, pitch="A2", rate=1.0):
    bi = bar_of(sec, k)
    vox.append({"t": round(at(bars[bi], step, 0), 4), "style": "mc", "pan": 0.0, "text": text,
                "spec": {"mode": "speak", "text": text, "pitch": pitch, "rate": rate, "voice": "speak", "bank": "silt-stops", **FEATURES_SPEAK}})

say("intro", 0, 2, "Ladies, gentlemen, and everybody in between:")
say("intro", 2, 4, "the floor has left the building.")
V1 = ["Somebody opened the basement door,", "and the bottom fell out of the bottom floor.",
      "Mister Landing in his rented shoes", "says come on down, you got nothing to lose."]
V2 = ["Grandma's falling in a velvet chair,", "reading the paper in the open air.",
      "The horns keep blowing at the passing ground,", "and the bass is the only one that still knows down."]
for sec, lines in (("a1", V1), ("a2", V2)):
    for i, line in enumerate(lines):
        chant(sec, 2 * i, 1, line, end_note=45 if i % 2 == 0 else 40)
for sec in ("b1", "b2"):
    for k in (0, 1):
        chant(sec, k, 0, "Ain't no floor!", span=8, rest=1, hi=47, lo=45, end_note=47)
        chant(sec, k, 8, "ain't no floor!", "gang", span=8, rest=1, hi=47, lo=45, end_note=45)
    chant(sec, 2, 0, "We ain't coming down, we ain't coming down.", "gang", span=32, hi=47, lo=43, end_note=40)
for k, (call, resp) in enumerate([("Hey, Mister Landing!", "what?"), ("Where's the ground?", "we lost it!"),
                                   ("Who's got the bottom?", "nobody!"), ("Then nobody lands!", None)]):
    say("brk", k, 0, call, pitch="G2", rate=1.0)
    if resp: chant("brk", k, 10, resp, "gang", span=6, rest=1, end_note=43)
A3 = ["Fall in, fall out, fall up, fall down,", "fall in, fall out, fall all the way round."]
for i in range(3):
    chant("a3", 2 * i, 0, A3[i % 2], "gang" if i == 2 else "lead", end_note=45 if i % 2 == 0 else 40)
chant("a3", 6, 0, "Nobody lands tonight.", "gang", span=24, end_note=40)
chant("end", 0, 0, "Floor!", "gang", span=8, end_note=40)
parts["vox"] = vox

score = {"bpm": BPM, "swing": SWING, "total": round(TOTAL, 4), "bars": bars,
         "parts": {k: sorted(v, key=lambda e: e["t"]) for k, v in parts.items()}}
out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "work", "funk")
os.makedirs(out, exist_ok=True)
json.dump(score, open(f"{out}/score.json", "w"))
print(f"{len(bars)} bars, {TOTAL:.1f} s; " + ", ".join(f"{k} {len(v)}" for k, v in score["parts"].items()))
