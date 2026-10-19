"""Shared mixing helpers for project mix scripts: sample-accurate placement, Hydrogen drumkits,
FluidSynth parts from note events, Sonic Pi stems aligned on their sync click, levels and a master
chain that keeps its headroom (see silt_psalm: a hard-limited sum flattens every section)."""
import os, subprocess, tempfile, xml.etree.ElementTree as ET
import numpy as np, soundfile as sf, mido, pyloudnorm
from pedalboard import Pedalboard, Compressor, HighpassFilter, LowShelfFilter, PeakFilter, HighShelfFilter, Limiter

SR = 48000
KITS = "/usr/share/hydrogen/data/drumkits"
SF2 = "/usr/share/sounds/sf2/MuseScore_General_Full.sf2"

def db(g): return 10 ** (g / 20)

def load(path, sr=SR):
    x, r = sf.read(path, dtype="float32", always_2d=True)
    if r != sr:
        from scipy.signal import resample_poly
        g = np.gcd(r, sr); x = resample_poly(x, sr // g, r // g, axis=0).astype("float32")
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    return x[:, :2]

def silence(n): return np.zeros((n, 2), dtype="float32")

def place(buf, x, t, gain=1.0, pan=0.0):
    """Mix x into buf at t seconds, equal-power panned."""
    i = int(round(t * SR))
    if i >= len(buf) or i + len(x) <= 0: return
    j0 = max(0, -i); i = max(0, i); n = min(len(x) - j0, len(buf) - i)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += x[j0:j0 + n, 0] * gain * l * 1.414
    buf[i:i + n, 1] += x[j0:j0 + n, 1] * gain * r * 1.414

class Kit:
    """A Hydrogen drumkit: instrument name -> velocity layers."""
    def __init__(self, name):
        self.dir = f"{KITS}/{name}"; self.inst = {}; self.cache = {}
        for ins in ET.parse(f"{self.dir}/drumkit.xml").getroot().iter():
            if ins.tag.split("}")[-1] != "instrument": continue
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

def fluid(events, program, length, gain=0.8, channel=0, bank=0):
    """Render [{t, dur, note, vel}] (seconds, MIDI note, 0-1 velocity) with a General MIDI program."""
    mid = mido.MidiFile(ticks_per_beat=960); tr = mido.MidiTrack(); mid.tracks.append(tr)
    tempo = mido.bpm2tempo(120); tr.append(mido.MetaMessage("set_tempo", tempo=tempo))
    ch = 9 if program == "drums" else channel
    if program != "drums":
        if bank: tr.append(mido.Message("control_change", channel=ch, control=0, value=bank))
        tr.append(mido.Message("program_change", channel=ch, program=program))
    ev = []
    for e in events:
        v = max(1, min(127, int(e["vel"] * 127)))
        ev += [(e["t"], 1, e["note"], v), (e["t"] + e["dur"], 0, e["note"], 0)]
    ev.sort(key=lambda x: (x[0], x[1]))
    now = 0.0
    for t, on, n, v in ev:
        dt = int(round(mido.second2tick(max(0.0, t - now), 960, tempo))); now += mido.tick2second(dt, 960, tempo)
        tr.append(mido.Message("note_on" if on else "note_off", channel=ch, note=n, velocity=v, time=dt))
    with tempfile.TemporaryDirectory() as d:
        mid.save(f"{d}/p.mid")
        subprocess.run(["fluidsynth", "-ni", "-q", "-r", str(SR), "-g", str(gain), "-F", f"{d}/p.wav", SF2, f"{d}/p.mid"], check=True)
        x = load(f"{d}/p.wav")
    return np.pad(x, ((0, max(0, length - len(x))), (0, 0)))[:length]

def onset_lag(x, times, gap=0.15, frac=0.2):
    """ms by which x sounds after its note times, from the notes that start out of silence (no note in
    the previous `gap` s): where the envelope first crosses `frac` of the note's peak, median over them.
    (Cross-correlating onset strength with all notes was fooled by a bass whose upper band swells
    after the attack.)"""
    m = np.abs(x.mean(1) if x.ndim > 1 else x)
    offs = []
    for prev, t in zip([-1.0] + list(times[:-1]), times):
        if t - prev < gap: continue
        a, b = int((t - 0.05) * SR), int((t + 0.15) * SR)
        if a < 0 or b > len(m): continue
        seg = m[a:b]
        if seg.max() <= 1e-4 or seg[:int(0.04 * SR)].max() > seg.max() * frac / 2: continue   # still ringing
        offs.append((np.argmax(seg > seg.max() * frac) / SR - 0.05) * 1000)
    return int(round(np.median(offs))) if offs else 0

def stem(path, preroll_s, length, early_ms=0.0, times=None, target_ms=2):
    """A Sonic Pi stem aligned so index 0 is the song's first beat (sync click removed).
    Some synths sound late against their schedule (projects/funk: the prophet lead ~20 ms, the tb303
    bass ~1 ms), so with the part's note `times` the stem is shifted until notes that start from
    silence begin target_ms after their time; early_ms is a fixed alternative."""
    x = load(path); on = int(np.argmax(np.abs(x).max(axis=1) > 0.05))
    def cut(ms):
        y = x[on + int(round((preroll_s + ms / 1000) * SR)):][:length]
        return np.pad(y, ((0, length - len(y)), (0, 0)))
    y = cut(early_ms)
    if times:
        early_ms += onset_lag(y, times) - target_ms
        y = cut(early_ms)
        print(f"  {os.path.basename(path)}: shifted {early_ms:+.0f} ms to sit on the score")
    return y

def fx(x, *plugins): return Pedalboard(list(plugins))(x, SR)

def active_rms_db(x):
    """Loudness while the part is playing (ignores its silences)."""
    f = 2400; n = len(x) // f
    e = np.sqrt((x[:n * f] ** 2).reshape(n, f, 2).mean(axis=(1, 2)))
    on = e[e > db(-50)]
    return 20 * np.log10(np.sqrt(np.mean(on ** 2))) if len(on) else -120.0

def level(x, target): return x * db(target - active_rms_db(x))

def mono_lows(x, hz=120):
    m, s = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
    s = fx(np.stack([s, s], 1), HighpassFilter(hz), HighpassFilter(hz))[:, 0]
    return np.stack([m + s, m - s], 1).astype("float32")

def master(x, lufs=-10.5, eq=None):
    """Headroom, gentle glue, make up to `lufs`, a limiter that only catches peaks."""
    eq = eq if eq is not None else [HighpassFilter(30)]
    y = fx(x * db(-10), *eq, Compressor(threshold_db=-20, ratio=2, attack_ms=30, release_ms=200))
    y *= db(lufs - pyloudnorm.Meter(SR).integrated_loudness(y))
    y = fx(y, Limiter(threshold_db=-1.0, release_ms=120))
    peak = np.abs(y).max()
    return y * (db(-0.3) / peak if peak > db(-0.3) else 1.0)

def klattsing(spec, cache_dir):
    """Render a klattsing spec (klattsing/bin/klattsing.mjs) to stereo audio, cached by its content."""
    import hashlib, json
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    banks = "".join(open(os.path.join(root, "banks", f)).read() for f in sorted(os.listdir(os.path.join(root, "banks"))))
    key = hashlib.sha1((json.dumps(spec, sort_keys=True) + banks).encode()).hexdigest()[:16]
    os.makedirs(cache_dir, exist_ok=True); path = os.path.join(cache_dir, f"{key}.wav")
    if not os.path.exists(path):
        subprocess.run(["node", os.path.join(root, "klattsing", "bin", "klattsing.mjs"), "-", path],
                       input=json.dumps(spec), text=True, check=True)
    x = load(path)
    return x[: max(1, len(x) - int(0.6 * SR))]                  # the CLI pads 0.6 s after each line
