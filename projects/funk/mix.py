#!/usr/bin/env python3
"""Funk: render the sampled parts from work/funk/score.json, add the Sonic Pi stems, mix and master.
usage: mix.py OUT.wav [--parts DIR]"""
import json, os, sys
import numpy as np, soundfile as sf
from pedalboard import (Compressor, Distortion, Gain, HighpassFilter, LowpassFilter, PeakFilter, LowShelfFilter,
                        HighShelfFilter, Reverb, Delay, Chorus, LadderFilter)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/lib")
from mixkit import SR, Kit, place, silence, fluid, stem, fx, level, active_rms_db, mono_lows, master, db, klattsing, duck

W = f"{ROOT}/work/funk"
SC = json.load(open(f"{W}/score.json"))
BPM, TOTAL = SC["bpm"], SC["total"]
LEN = int((TOTAL + 4) * SR)
P = SC["parts"]

# ---------- drums and hand percussion ----------
KITS = {"vb": Kit("VariBreaks"), "pearl": Kit("The Black Pearl 1.0"), "hand": Kit("Gimme A Hand 1.0")}
DRUM = {"kick": ("vb", "VariBreaks Kick 1", 0), "snare": ("vb", "VariBreaks Snare 1", 0), "ghost": ("vb", "VariBreaks Snare 1", 0.05),
        "hat": ("vb", "VariBreaks Hat 1 Cl", 0.3), "hat_open": ("vb", "VariBreaks Hat 1 Op", 0.3),
        "crash": ("pearl", "Sabian Crash", -0.4), "tamb": ("hand", "Tambourine", -0.45), "clap": ("hand", "Hand Clap", 0.0),
        "bongo_hi": ("hand", "Bongo Hi", 0.35), "bongo_lo": ("hand", "Bongo Lo", 0.2), "cowbell": ("hand", "Cowbell", 0.5)}
def kit_part(events, names):
    out = {n: silence(LEN) for n in names}
    for e in events:
        kit, inst, pan = DRUM[e["inst"]]
        place(out[e["inst"]], KITS[kit].hit(inst, e["vel"]), e["t"], 0.5 + 0.5 * e["vel"], pan)
    return out

# ---------- filters that move ----------
def moving_bpf(x, cutoff, q=0.55, block=256):
    """A band-pass whose centre follows cutoff(i, block) block by block (a wah)."""
    f = LadderFilter(mode=LadderFilter.Mode.BPF12, cutoff_hz=800, resonance=q, drive=1.0)
    y = np.zeros_like(x)
    for i in range(0, len(x), block):
        f.cutoff_hz = float(cutoff(i, x[i:i + block]))
        y[i:i + block] = f.process(x[i:i + block], SR, reset=False)
    return y
def autowah(x, lo=350, hi=2800, q=0.6, release=0.92):
    env = [0.0]
    def c(i, blk):
        e = float(np.sqrt(np.mean(blk ** 2)) * 25)
        env[0] = max(e, env[0] * release)
        return lo + (hi - lo) * min(1.0, env[0])
    return moving_bpf(x, c, q)
def beat_wah(x, lo=450, hi=2200, q=0.6):
    return moving_bpf(x, lambda i, blk: lo + (hi - lo) * (0.5 - 0.5 * np.cos(2 * np.pi * (i / SR) * BPM / 60)), q)

def main(out, parts_dir=None):
    d = kit_part(P["drums"], ["kick", "snare", "ghost", "hat", "hat_open", "crash"])
    kick = fx(d["kick"], HighpassFilter(35), PeakFilter(60, 3, 1.0), PeakFilter(400, -5, 1.2), PeakFilter(3500, 3, 1.0))
    snare = fx(d["snare"] + d["ghost"], HighpassFilter(90), PeakFilter(200, 2, 1.0), PeakFilter(5000, 2, 0.8))
    hats = fx(d["hat"] + d["hat_open"], HighpassFilter(400))
    drums = kick + snare * db(-1) + hats * db(-7) + d["crash"] * db(-9)
    room = fx(drums, Reverb(room_size=0.25, wet_level=1.0, dry_level=0.0, damping=0.6)) * db(-16)
    smash = fx(drums, Compressor(threshold_db=-28, ratio=8, attack_ms=2, release_ms=70), Distortion(drive_db=10), LowpassFilter(9000)) * db(-12)
    drums = drums + room + smash
    pc = kit_part(P["perc"], ["tamb", "clap", "bongo_hi", "bongo_lo", "cowbell"])
    perc = fx(sum(pc.values()), HighpassFilter(150), Reverb(room_size=0.4, wet_level=0.15, dry_level=0.9))

    clav = fx(fluid(P["clav"], 7, LEN, gain=0.9), HighpassFilter(150))
    clav = fx(autowah(clav), Distortion(drive_db=6), Compressor(threshold_db=-18, ratio=3, attack_ms=3, release_ms=60))
    gtr = fx(fluid(P["gtr"], 28, LEN, gain=0.9), HighpassFilter(200))
    gtr = fx(beat_wah(gtr), Compressor(threshold_db=-20, ratio=3, attack_ms=2, release_ms=50))
    organ = fx(fluid(P["organ"], 16, LEN, gain=0.8), HighpassFilter(120), Distortion(drive_db=4),
               Chorus(rate_hz=5.5, depth=0.35, mix=0.5), PeakFilter(400, -3, 1.0))
    def pan(x, p):
        m = x.mean(1, keepdims=True); y = np.repeat(m, 2, 1)
        y[:, 0] *= np.cos((p + 1) * np.pi / 4) * 1.414; y[:, 1] *= np.sin((p + 1) * np.pi / 4) * 1.414; return y
    horns = pan(fluid(P["horns"], 61, LEN, gain=0.8), -0.4) + pan(fluid(P["horns"], 66, LEN, gain=0.7), 0.4)   # brass left, tenor right
    horns = fx(horns, HighpassFilter(140), Compressor(threshold_db=-18, ratio=3, attack_ms=8, release_ms=100),
               PeakFilter(2500, 2, 1.0), Reverb(room_size=0.5, wet_level=0.2, dry_level=0.85))
    pre = 4 * 60 / BPM
    moog = fx(stem(f"{W}/stems/moog.wav", pre, LEN, times=[e["t"] for e in P["moog"]]), HighpassFilter(28), Compressor(threshold_db=-16, ratio=4, attack_ms=5, release_ms=80),
              Distortion(drive_db=5), LowpassFilter(3500))
    lead = fx(stem(f"{W}/stems/lead.wav", pre, LEN, times=[e["t"] for e in P["lead"]]), HighpassFilter(250), Distortion(drive_db=8),
              Delay(delay_seconds=0.75 * 60 / BPM, feedback=0.3, mix=0.25), Reverb(room_size=0.6, wet_level=0.25, dry_level=0.8))
    # the bass ducks a little under the kick
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    env = uniform_filter1d(maximum_filter1d(np.abs(kick).max(1), int(0.08 * SR)), int(0.01 * SR)); env /= env.max() + 1e-9
    moog = moog * db(-3 * env)[:, None]

    # vocals: each take rendered by klattsing, placed at its time, processed by role
    vbus = {k: silence(LEN) for k in ("lead", "gang", "mc")}
    for e in P["vox"]:
        place(vbus[e["style"]], klattsing(e["spec"], f"{W}/vox"), e["t"], e.get("gain", 1.0), e["pan"])
    lead_v = fx(vbus["lead"], HighpassFilter(90), Compressor(threshold_db=-20, ratio=4, attack_ms=6, release_ms=90),
                Distortion(drive_db=4), PeakFilter(2500, 3, 1.0), Reverb(room_size=0.35, wet_level=0.12, dry_level=0.9))
    gang = fx(vbus["gang"], HighpassFilter(110), Compressor(threshold_db=-20, ratio=4, attack_ms=5, release_ms=90),
              Distortion(drive_db=6), PeakFilter(2200, 3, 1.0), Reverb(room_size=0.6, wet_level=0.25, dry_level=0.85))
    # the MC: a touch of telephone, but the words first (the heavy radio version lost them)
    mc = fx(vbus["mc"], HighpassFilter(150), LowpassFilter(7000), Distortion(drive_db=3), PeakFilter(1800, 3, 1.0),
            Delay(delay_seconds=0.75 * 60 / BPM, feedback=0.25, mix=0.15))
    # the band clears the voices' band while anyone sings or talks
    voices = lead_v + gang + mc
    clav, gtr, horns, organ = (duck(p_, voices, 5, band=(1400, 4000)) for p_ in (clav, gtr, horns, organ))
    parts = {"drums": (drums, -15.5), "perc": (perc, -25), "moog": (moog, -16.5), "clav": (pan(clav, -0.65), -22),
             "gtr": (pan(gtr, 0.7), -24), "organ": (organ, -27), "horns": (horns, -21), "lead": (pan(lead, 0.15), -22),
             "vox": (lead_v, -15), "gang": (gang, -16), "mc": (mc, -15.5)}
    mixd = mono_lows(sum(level(x, t) for x, t in parts.values()))
    if parts_dir:
        os.makedirs(parts_dir, exist_ok=True)
        for n, (x, t) in parts.items(): sf.write(f"{parts_dir}/{n}.wav", level(x, t), SR, subtype="PCM_24")
    y = master(mixd, lufs=-10.0, eq=[HighpassFilter(30), LowShelfFilter(80, -1), PeakFilter(300, -2, 0.8), HighShelfFilter(8000, 2)])
    end = int((TOTAL + 3) * SR); y = y[:end]; f = int(0.5 * SR); y[-f:] *= np.linspace(1, 0, f)[:, None]
    sf.write(out, y, SR, subtype="PCM_24")
    for n, (x, t) in parts.items(): print(f"{n:6s} raw {active_rms_db(x):6.1f} dB -> {t}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--parts" else None)
