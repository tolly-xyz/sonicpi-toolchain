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
    if sec in ("b1", "b2"):
        for s, ln in ((0, 2), (6, 1), (10, 1), (14, 2)):
            for n in vo[1:]: note("horns", bar, s, n + 12, ln, 0.9)
    if sec == "a3":
        line = [(0, 71, 2), (3, 74, 1), (4, 76, 2), (7, 74, 1), (8, 71, 1), (10, 69, 1), (11, 67, 1), (12, 64, 4)] if k % 2 == 0 \
            else [(12, 74, 1), (14, 76, 2)]
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

score = {"bpm": BPM, "swing": SWING, "total": round(TOTAL, 4), "bars": bars,
         "parts": {k: sorted(v, key=lambda e: e["t"]) for k, v in parts.items()}}
out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "work", "funk")
os.makedirs(out, exist_ok=True)
json.dump(score, open(f"{out}/score.json", "w"))
print(f"{len(bars)} bars, {TOTAL:.1f} s; " + ", ".join(f"{k} {len(v)}" for k, v in score["parts"].items()))
