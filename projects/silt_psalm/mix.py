#!/usr/bin/env python3
"""Silt Psalm: build the sampled parts from the score's timeline and mix everything.

Sonic Pi stems (work/silt_psalm/stems/*.wav) each start with a sync click; the song begins 4 beats at
168 bpm after it. Drums, real guitar strums, organ and choir are built here, sample-accurate.
usage: mix.py OUT.wav [--parts DIR]   (--parts also writes each processed, leveled part)
"""
import json, random, subprocess, sys, os, xml.etree.ElementTree as ET
import numpy as np, soundfile as sf, mido
from pedalboard import (Pedalboard, Compressor, Distortion, Gain, HighpassFilter, LowpassFilter,
                        PeakFilter, LowShelfFilter, HighShelfFilter, Reverb, Limiter, Delay, Chorus)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = f"{ROOT}/work/silt_psalm"     # stems, timeline and scratch renders
SR = 48000
PREROLL = 4 * 60 / 168
KITS = "/usr/share/hydrogen/data/drumkits"
rnd = random.Random(13)

TL = json.load(open(f"{HERE}/timeline.json"))
BARS = TL["bars"]
LEN = int((TL["total"] + 6) * SR)

def secs(name): return [b for b in BARS if b["sec"] == name]

# ---------- loading ----------
def load(path, sr=SR):
    x, r = sf.read(path, dtype="float32", always_2d=True)
    if r != sr:
        from scipy.signal import resample_poly
        g = np.gcd(r, sr); x = resample_poly(x, sr // g, r // g, axis=0).astype("float32")
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    return x[:, :2]

def stem(name, early_ms=0.0):
    """A Sonic Pi stem, aligned so index 0 is the song's first beat, click removed."""
    x = load(f"{HERE}/stems/{name}.wav")
    on = int(np.argmax(np.abs(x).max(axis=1) > 0.05))
    start = on + int(round((PREROLL + early_ms / 1000) * SR))
    y = x[start:start + LEN]
    return np.pad(y, ((0, LEN - len(y)), (0, 0)))

class Kit:
    """A Hydrogen drumkit: instrument name -> velocity layers."""
    def __init__(self, name):
        self.dir = f"{KITS}/{name}"; self.inst = {}; self.cache = {}
        root = ET.parse(f"{self.dir}/drumkit.xml").getroot()
        for ins in root.iter():
            if not ins.tag.endswith("}instrument") and ins.tag != "instrument": continue
            nm = next((c.text for c in ins if c.tag.split("}")[-1] == "name"), None)
            layers = []
            for lay in ins.iter():
                if lay.tag.split("}")[-1] != "layer": continue
                d = {c.tag.split("}")[-1]: c.text for c in lay}
                if d.get("filename"): layers.append((float(d.get("min", 0)), float(d.get("max", 1)), d["filename"]))
            if nm and layers: self.inst[nm] = sorted(layers)
    def hit(self, name, vel):
        layers = self.inst[name]
        f = next((fn for lo, hi, fn in layers if lo <= vel <= hi), layers[-1][2])
        if f not in self.cache: self.cache[f] = load(f"{self.dir}/{f}")
        return self.cache[f]

def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(x) <= 0: return
    j0 = max(0, -i); i = max(0, i); n = min(len(x) - j0, len(buf) - i)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += x[j0:j0 + n, 0] * gain * l * 1.414
    buf[i:i + n, 1] += x[j0:j0 + n, 1] * gain * r * 1.414

def silence(): return np.zeros((LEN, 2), dtype="float32")

# ---------- drums: The Black Pearl, played to the riff ----------
def drums():
    kit = Kit("The Black Pearl 1.0")
    kick, snare, rim, hat, crash, splash = (silence() for _ in range(6))
    def H(buf, name, t, vel, pan=0.0, gain=1.0):
        vel = min(1.0, max(0.05, vel + rnd.uniform(-0.06, 0.06)))
        place(buf, kit.hit(name, vel), t + rnd.uniform(-0.002, 0.002), gain * (0.55 + 0.45 * vel), pan)
    for b in BARS:
        sec, st, t0 = b["sec"], b["step"], b["t"]
        if sec in ("intro", "tail"): continue
        if sec == "end" and b["k"] == 1:
            # the seizure: a kick on every retrigger, each one sooner
            t, d = t0, 0.25 * 60 / b["bpm"]
            while d > 0.03 * 60 / b["bpm"]:
                H(kick, "Pearl Kick", t, 0.95); t += d; d *= 0.82
            continue
        if b["k"] == 0: H(crash, "Sabian Crash", t0, 1.0, pan=-0.5)
        for s in range(b["steps"]):
            t = t0 + s * st
            off = b["riff"][s % 16] if b["riff"] else None
            if sec == "down":
                if s in (0, 8, 14): H(kick, "Pearl Kick", t, 1.0)
                if s == 8: H(snare, "Pearl Snare Rimshot", t, 1.0)
                if s % 4 == 0: H(hat, "Sabian Hat Semi-Open", t, 0.6, pan=0.35)
            elif sec == "blast":
                if s % 2 == 0:
                    H(kick, "Pearl Kick", t, 0.9); H(hat, "Sabian Hat Closed", t, 0.75, pan=0.35)
                else:
                    H(snare, "Pearl Snare", t, 0.8)
                if s % 8 == 0: H(splash, "Zildjian Splash", t, 0.9, pan=0.5)
            else:
                if b["stutter"] and s >= 12:
                    for h in range(2):          # a roll that climbs into the next bar
                        H(snare, "Pearl Snare", t + h * st / 2, 0.45 + (s - 12) * 0.15 + h * 0.05)
                    continue
                if off == 0: H(kick, "Pearl Kick", t, 0.95)
                if s in (4, 12): H(snare, "Pearl Snare Rimshot", t, 0.95)
                H(hat, "Sabian Hat Closed", t, 0.7 if s % 4 == 2 else 0.4, pan=0.35)
                if sec == "b" and s == 15: H(snare, "Pearl Snare", t, 0.5)
    return kick, snare + rim, hat, crash + splash

# ---------- real guitar: recorded strums, run through an amp that's too loud ----------
def strums():
    d = f"{KITS}/belofilms_GuitarStrums"
    pick = lambda base, k: load(f"{d}/{base}_DOWN_0{k}.flac")
    chord = {"E": "Eminor", "F": "Fmajor", "Bb": "Bflat major"}
    L, R = silence(), silence()
    for b in BARS:
        sec, st, t0 = b["sec"], b["step"], b["t"]
        hits = []
        if sec == "b": hits = [(0, ["E", "F", "Bb", "E"][b["k"] % 4], 1.0)]
        elif sec == "down": hits = [(0, "E", 1.0), (14, "Bb", 0.8)]
        elif sec in ("a", "a2", "a3"): hits = [(0, "E", 0.55)]
        for s, c, g in hits:
            place(L, pick(chord[c], 3), t0 + s * st, g, pan=-0.9)
            place(R, pick(chord[c], 2), t0 + s * st + 0.011, g, pan=0.9)
    amp = Pedalboard([HighpassFilter(110), Distortion(drive_db=38), PeakFilter(450, -6, 1.0),
                      PeakFilter(2400, 4, 0.8), LowpassFilter(5200), LowpassFilter(6500)])
    return amp(L + R, SR)

# ---------- organ in the breakdown, a choir under the last scream (MuseScore General) ----------
def organ_choir():
    mid = mido.MidiFile(ticks_per_beat=480); tr = mido.MidiTrack(); mid.tracks.append(tr)
    tempo = mido.bpm2tempo(120); tr.append(mido.MetaMessage("set_tempo", tempo=tempo))
    tr.append(mido.Message("program_change", channel=0, program=19))   # church organ
    tr.append(mido.Message("program_change", channel=1, program=52))   # choir aahs
    ev = []
    down = secs("down"); t0, t1 = down[0]["t"], down[-1]["t"] + down[-1]["steps"] * down[-1]["step"]
    for n in (40, 46, 52, 53): ev += [(t0, "on", 0, n, 92), (t1, "off", 0, n, 0)]   # E, Bb, E, F: no comfort
    tail = secs("tail")[0]["t"]
    for n in (64, 70, 76): ev += [(tail, "on", 1, n, 100), (tail + 3.6, "off", 1, n, 0)]
    ev.sort(key=lambda e: e[0]); now = 0
    for t, kind, ch, n, v in ev:
        dt = int(mido.second2tick(t - now, 480, tempo)); now += mido.tick2second(dt, 480, tempo)
        tr.append(mido.Message("note_on" if kind == "on" else "note_off", channel=ch, note=n, velocity=v, time=dt))
    p = f"{HERE}/organ.mid"; w = f"{HERE}/organ.wav"; mid.save(p)
    subprocess.run(["fluidsynth", "-ni", "-q", "-r", str(SR), "-g", "0.8", "-F", w,
                    "/usr/share/sounds/sf2/MuseScore_General_Full.sf2", p], check=True)
    x = load(w); x = np.pad(x, ((0, max(0, LEN - len(x))), (0, 0)))[:LEN]
    return Pedalboard([Distortion(drive_db=14), LowpassFilter(4200), Reverb(room_size=0.9, wet_level=0.45, dry_level=0.7)])(x, SR)

# ---------- mix ----------
def fx(x, *plugins): return Pedalboard(list(plugins))(x, SR)
def pan_take(x, p):
    m = x.mean(axis=1, keepdims=True); y = np.repeat(m, 2, axis=1)
    y[:, 0] *= np.cos((p + 1) * np.pi / 4) * 1.414; y[:, 1] *= np.sin((p + 1) * np.pi / 4) * 1.414
    return y
def db(g): return 10 ** (g / 20)
def active_rms_db(x):
    """Loudness while the part is actually playing (ignores its silences)."""
    f = 2400; n = len(x) // f
    e = np.sqrt((x[:n * f] ** 2).reshape(n, f, 2).mean(axis=(1, 2)))
    on = e[e > db(-50)]
    return 20 * np.log10(np.sqrt(np.mean(on ** 2))) if len(on) else -120.0
def level(x, target):
    return x * db(target - active_rms_db(x))

def main(out, parts_dir=None):
    cab = lambda: [HighpassFilter(100), PeakFilter(420, -5, 1.2),
                   PeakFilter(3000, 5, 0.9), PeakFilter(5500, 3, 1.2), LowpassFilter(8500), LowpassFilter(10000)]
    gL = fx(pan_take(stem("gtrL"), -0.85), *cab())
    gR = fx(pan_take(stem("gtrR"), 0.85), *cab())
    bass = fx(pan_take(stem("bass"), 0), HighpassFilter(32), LowShelfFilter(90, 3), LowpassFilter(2600),
              Compressor(threshold_db=-18, ratio=4, attack_ms=5, release_ms=80))
    lead = fx(stem("lead"), HighpassFilter(200), PeakFilter(3000, -3, 1.0), Delay(delay_seconds=0.268, feedback=0.25, mix=0.18),
              Reverb(room_size=0.6, wet_level=0.2, dry_level=0.85))
    sfx = fx(stem("fx"), HighpassFilter(40))
    # consonants go just ahead of the beat, as a singer would place them
    vox = fx(stem("vox", early_ms=20), HighpassFilter(120), Compressor(threshold_db=-20, ratio=5, attack_ms=3, release_ms=120),
             PeakFilter(1800, 3, 1.0), Delay(delay_seconds=0.178, feedback=0.15, mix=0.12))
    kick, snare, hat, cym = drums()
    kick = fx(kick, HighpassFilter(40), PeakFilter(70, 2, 1.2), PeakFilter(350, -6, 1.5), PeakFilter(4000, 5, 1.0))
    snare = fx(snare, HighpassFilter(90), PeakFilter(220, 3, 1.0), PeakFilter(6000, 2, 1.0), Reverb(room_size=0.35, wet_level=0.18, dry_level=0.9))
    kit = kick * db(1) + snare * db(-1) + hat * db(-9) + cym * db(-8)
    # parallel smash: a crushed copy of the kit under the clean one
    kit = kit + fx(kit, Compressor(threshold_db=-30, ratio=10, attack_ms=1, release_ms=60), Distortion(drive_db=18), LowpassFilter(9000)) * db(-10)
    real = strums()
    org = organ_choir()

    # balance: each part's loudness while it plays (dB RMS)
    parts = {"gtrL": (gL, -20), "gtrR": (gR, -20), "bass": (bass, -21), "kit": (kit, -17.5), "vox": (vox, -20),
             "lead": (lead, -25), "fx": (sfx, -23), "real": (real, -27), "organ": (org, -26)}
    mixd = sum(level(x, t) for x, t in parts.values())
    if parts_dir:                              # each part as it sits in the mix, for inspection
        os.makedirs(parts_dir, exist_ok=True)
        for name, (x, t) in parts.items():
            sf.write(f"{parts_dir}/{name}.wav", level(x, t)[:int((TL["total"] + 4.5) * SR)], SR, subtype="PCM_24")
    # tonal balance: the raw mix tilted ~19 dB from sub to air; pull the floor up out of the mud
    master = fx(mixd, HighpassFilter(38), LowShelfFilter(90, -4), PeakFilter(280, -3, 0.8),
                PeakFilter(3500, 3, 0.7), HighShelfFilter(6500, 5),
                Compressor(threshold_db=-14, ratio=2.5, attack_ms=15, release_ms=150),
                Gain(4), Limiter(threshold_db=-1.0, release_ms=80))
    peak = np.abs(master).max(); master *= db(-0.3) / max(peak, 1e-9) if peak > db(-0.3) else 1
    # trim to the song plus the last scream's tail
    end = int((TL["total"] + 4.5) * SR); master = master[:end]
    fade = int(0.8 * SR); master[-fade:] *= np.linspace(1, 0, fade)[:, None]
    sf.write(out, master, SR, subtype="PCM_24")
    for name, (x, t) in parts.items():
        print(f"{name:6s} raw {active_rms_db(x):6.1f} dB -> {t} dB")
    print(out)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--parts" else None)
