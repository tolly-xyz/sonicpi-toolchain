#!/usr/bin/env python3
"""Ain't No Floor: the video. A lit disco floor in perspective over a plasma void, driven by the score.

    intro   the floor wakes up tile by tile as the clav comes in
    a1      the floor chases with the kicks and the clav
    b       every "Ain't no floor!" drops a cluster of tiles into the void; horn stabs burst
    a2      the floor is full of holes; tiles keep slipping
    brk     no floor at all: the camera falls through a star tunnel
    b2      the last tiles go
    a3      "fall up, fall down": the tiles drift back as a ceiling, upside down
    end     "Floor!": everything snaps back into place, one flash, out
The lead draws a neon squiggle along its pitch; the plasma breathes with the bass.
usage: draw.py OUT.mp4 [--still T ...]
"""
import json, math, os, subprocess, sys, time
import numpy as np, cairo, soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W_ = f"{ROOT}/work/funk"
SC = json.load(open(f"{W_}/score.json")); BARS = SC["bars"]; BPM = SC["bpm"]; TOTAL = SC["total"]
W, H, FPS = 1920, 1080, 30
BAR = 4 * 60 / BPM
for b in BARS: b["end"] = b["t"] + BAR
def bar_at(t):
    for b in BARS:
        if b["t"] <= t < b["end"]: return b
    return BARS[-1] if t >= BARS[-1]["t"] else BARS[0]
def sec_t(name):
    bs = [b for b in BARS if b["sec"] == name]; return bs[0]["t"], bs[-1]["end"]

P = SC["parts"]
KICK = np.array(sorted(e["t"] for e in P["drums"] if e["inst"] == "kick"))
SNARE = np.array(sorted(e["t"] for e in P["drums"] if e["inst"] == "snare"))
CLAV = np.array(sorted({round(e["t"], 3) for e in P["clav"]}))
HORN = np.array(sorted({round(e["t"], 2) for e in P["horns"]}))
LEAD = sorted(P["lead"], key=lambda e: e["t"])
CALLS = sorted({round(e["t"], 3) for e in P["vox"] if "floor" in e["text"].lower()})
def since(arr, t):
    i = np.searchsorted(arr, t, side="right") - 1
    return t - arr[i] if i >= 0 else 1e9

def envelope(name):
    x, sr = sf.read(f"{W_}/parts/{name}.wav", dtype="float32"); x = np.abs(x).mean(1); hop = sr // FPS
    n = len(x) // hop; e = np.sqrt((x[:n * hop] ** 2).reshape(n, hop).mean(1)); return e / (np.percentile(e, 98) + 1e-9)
ENV = {k: envelope(k) for k in ("moog", "vox", "gang", "mc")}
def env(k, t):
    i = int(t * FPS); e = ENV[k]; return float(e[i]) if 0 <= i < len(e) else 0.0

PAL = np.array([(1.0, 0.18, 0.62), (1.0, 0.55, 0.05), (0.62, 1.0, 0.12), (0.55, 0.2, 1.0), (0.1, 0.85, 1.0)])   # magenta orange lime violet cyan

# ---------- the plasma void ----------
PW, PH = 320, 180
PY, PX = np.mgrid[0:PH, 0:PW] / PH
def plasma(t, energy, hue):
    """A deep violet void with bright neon contour bands that drift and breathe."""
    v = (np.sin(PX * 6.0 + t * 0.9) + np.sin(PY * 7.0 - t * 1.3) + np.sin((PX + PY) * 5.0 + t * 0.7)
         + np.sin(np.hypot(PX - 0.9 - 0.3 * np.sin(t * 0.3), PY - 0.5) * 9.0 - t * 2.0)) / 4
    bands = np.abs(np.sin(v * 9.0 + t * 0.8)) ** 10                       # thin bright contours
    k = (v * 0.5 + 0.5 + hue) % 1.0 * len(PAL)
    i = k.astype(int) % len(PAL); f = (k - np.floor(k))[..., None]
    neon = PAL[i] * (1 - f) + PAL[(i + 1) % len(PAL)] * f
    void = np.array([0.05, 0.01, 0.10])
    rgb = void + neon * (bands[..., None] * (0.35 + 0.65 * energy) + 0.06)
    a = np.dstack([rgb[..., 2], rgb[..., 1], rgb[..., 0], np.ones_like(v)])
    return (np.clip(a, 0, 1) * 255).astype(np.uint8)

# ---------- the floor ----------
ROWS, COLS = 9, 14
rng = np.random.default_rng(11)
ORDER = rng.permutation(ROWS * COLS)                 # the order tiles fall in
b1, _ = sec_t("b1"); b2s, b2e = sec_t("b2"); brk0, brk1 = sec_t("brk"); a3s, a3e = sec_t("a3"); ends, _ = sec_t("end")
CALLS_A = [c for c in CALLS if c < b2s]; CALLS_B = [c for c in CALLS if c >= b2s]
def fallen(t):
    """For each tile, seconds since it fell (or -1 if it hasn't). Each "floor" call in b1 drops 7%,
    a2 lets two slip every half bar (holes, not a void), and the rest go just before the break."""
    fell = np.full(ROWS * COLS, -1.0)
    n = ROWS * COLS; idx = 0
    events = [(c, int(n * 0.07)) for c in CALLS_A] + [(b1 + BAR * 4 + i * BAR / 2, 2) for i in range(16)] \
           + [(brk0 - BAR * 0.5, n)]
    for at_, k in sorted(events):
        if t < at_: break
        for j in ORDER[idx: idx + k]: fell[j] = t - at_
        idx = min(n, idx + k)
    return fell

def project(x, z, horizon, f=1100.0, cam_y=1.0):
    return W / 2 + x / z * f, horizon + cam_y / z * f

def tile_quad(r, c, horizon, cam_y, drop=0.0):
    x0 = (c - COLS / 2) * 0.5; z0 = 0.8 + r * 0.5
    pts = [(x0, z0), (x0 + 0.5, z0), (x0 + 0.5, z0 + 0.55), (x0, z0 + 0.55)]
    return [project(x, z, horizon, cam_y=cam_y - drop) for x, z in pts]

def frame(c, t):
    b = bar_at(t); sec = b["sec"]
    beat = (t / (60 / BPM)) % 1
    kick = math.exp(-since(KICK, t) / 0.12); snare = math.exp(-since(SNARE, t) / 0.1)
    bass = env("moog", t); voice = max(env("vox", t), env("gang", t), env("mc", t))
    hue = (t / 40 + {"b1": 0.25, "b2": 0.25, "brk": 0.5, "a3": 0.75}.get(sec, 0)) % 1
    # plasma, scaled up
    pl = plasma(t, min(1.0, 0.4 + 0.6 * bass + 0.4 * kick), hue)
    s = cairo.ImageSurface.create_for_data(memoryview(pl.copy()), cairo.FORMAT_ARGB32, PW, PH)
    c.save(); c.scale(W / PW, H / PH); c.set_source_surface(s); c.get_source().set_filter(cairo.FILTER_BILINEAR); c.paint(); c.restore()
    horizon = H * 0.36
    # the break: a star tunnel, the camera falling
    if brk0 <= t < brk1 + 0.3:
        u = (t - brk0)
        sr = np.random.default_rng(3)
        for k in range(700):
            ang = sr.uniform(0, 2 * np.pi); sp = sr.uniform(0.2, 1.0); ph = sr.uniform(0, 1)
            d = ((ph + u * 0.35 * sp) % 1.0) ** 2
            r0, r1 = d * W * 0.9, (d + 0.08 * sp + 0.05 * kick) * W * 0.9
            col = PAL[k % len(PAL)]
            c.set_source_rgba(*col, min(1.0, 0.3 + d * 3))
            c.set_line_width(1.5 + 5 * d)
            c.move_to(W / 2 + math.cos(ang) * r0, H / 2 + math.sin(ang) * r0)
            c.line_to(W / 2 + math.cos(ang) * r1, H / 2 + math.sin(ang) * r1); c.stroke()
    # the floor (below the horizon), or in the last groove a ceiling (mirrored, drifting back)
    fell = fallen(t)
    ceiling = a3s <= t < ends
    back = min(1.0, (t - a3s) / (a3e - a3s)) if ceiling else 0.0
    snap = ends <= t
    chase = int((t - b["t"]) / (BAR / 16))
    for r in range(ROWS):
        for col in range(COLS):
            j = r * COLS + col
            if snap: drop, alpha = 0.0, 1.0
            elif ceiling:
                if (j * 37) % 100 / 100 > back: continue
                drop, alpha = 0.0, 0.9
            elif fell[j] >= 0:
                drop = 0.5 * 9.8 * fell[j] ** 2 * 0.5; alpha = max(0.0, 1 - fell[j] / 1.6)
                if alpha <= 0: continue
            else: drop, alpha = 0.0, 1.0
            cam = -1.0 if ceiling else 1.0
            q = tile_quad(r, col, H * 0.64 if ceiling else horizon, cam, drop)
            base = PAL[(r + col + int(t / BAR)) % len(PAL)]
            lit = 0.38 + 0.62 * kick * (1 if (r + col) % 2 == 0 else 0.4)
            if (r * COLS + col) % 16 == chase % 16: lit = max(lit, 0.9)
            if sec == "intro":
                k = (t - BARS[0]["t"]) / (4 * BAR)
                if ORDER.tolist().index(j) / (ROWS * COLS) > k: lit *= 0.15
            if snap: lit = 1.0 - 0.6 * min(1, (t - ends) / 1.5)
            c.move_to(*q[0]); [c.line_to(*p) for p in q[1:]]; c.close_path()
            c.set_source_rgba(*(base * lit), alpha); c.fill_preserve()
            c.set_source_rgba(0, 0, 0, alpha * 0.8); c.set_line_width(2); c.stroke()
    # horn stabs: starbursts
    hs = since(HORN, t)
    if hs < 0.35:
        k = 1 - hs / 0.35; rr = np.random.default_rng(int(np.searchsorted(HORN, t)))
        cx, cy = rr.uniform(W * 0.2, W * 0.8), rr.uniform(H * 0.12, H * 0.38)
        for a in range(16):
            ang = a / 16 * 2 * np.pi; l0, l1 = 20 + 200 * (1 - k), 40 + 320 * (1 - k)
            c.set_source_rgba(1, 0.95, 0.6, k); c.set_line_width(3)
            c.move_to(cx + math.cos(ang) * l0, cy + math.sin(ang) * l0); c.line_to(cx + math.cos(ang) * l1, cy + math.sin(ang) * l1); c.stroke()
    # the lead: a neon squiggle following its pitch, trailing 1.5 s
    recent = [e for e in LEAD if t - 1.5 <= e["t"] <= t]
    if recent:
        c.set_line_cap(cairo.LINE_CAP_ROUND); c.set_line_join(cairo.LINE_JOIN_ROUND)
        ts = np.linspace(recent[0]["t"], t, 90)
        notes = [max((e for e in LEAD if e["t"] <= tt), key=lambda e: e["t"])["note"] for tt in ts]
        pts = [(W * (0.1 + 0.8 * (1 - (t - tt) / 1.5)), H * (0.3 - (n - 70) / 12 * 0.2) + 22 * math.sin(tt * 31) * math.sin(tt * 7))
               for tt, n in zip(ts, notes)]
        for width, a in ((22, 0.12), (9, 0.35), (3, 1.0)):
            c.set_source_rgba(0.6, 1.0, 0.95, a); c.set_line_width(width)
            c.move_to(*pts[0]); [c.line_to(*p) for p in pts[1:]]; c.stroke()
    # 7. voices send neon rings out from the middle (strongest where the floor is gone)
    gone = 1.0 if brk0 <= t < a3s else 0.35
    if voice > 0.08:
        for k in range(3):
            ph = ((t * 0.9 + k / 3) % 1.0)
            c.set_source_rgba(*PAL[(k + int(t)) % len(PAL)], min(1.0, 1.6 * gone * voice * (1 - ph)))
            c.set_line_width(6 + 16 * (1 - ph)); c.arc(W / 2, H * 0.55, 60 + ph * W * 0.5, 0, 2 * np.pi); c.stroke()
    # a voice brightens everything a little; the end fades out
    if voice > 0.05:
        c.set_source_rgba(1, 1, 1, 0.06 * min(1, voice)); c.paint()
    fade = min(1.0, t / 1.0) * min(1.0, max(0.0, (TOTAL + 2.6 - t) / 1.2))
    if fade < 1: c.set_source_rgba(0, 0, 0, 1 - fade); c.paint()

def main():
    out = sys.argv[1]; stills = [float(x) for x in sys.argv[3:]] if len(sys.argv) > 2 and sys.argv[2] == "--still" else None
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H); c = cairo.Context(surf)
    if stills:
        for t in stills:
            c.set_source_rgb(0, 0, 0); c.paint(); frame(c, t); surf.write_to_png(f"{out}_{t:06.2f}.png")
        return
    audio = f"{ROOT}/out/funk.wav"; n = int((TOTAL + 3) * FPS); t0 = time.time()
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "10M",
                           "-bufsize", "20M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", out],
                          stdin=subprocess.PIPE)
    for k in range(n):
        c.set_source_rgb(0, 0, 0); c.paint(); frame(c, k / FPS); surf.flush(); ff.stdin.write(bytes(surf.get_data()))
        if k % (FPS * 10) == 0: print(f"{k / FPS:6.1f}s ({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
    ff.stdin.close(); ff.wait(); print(out)

if __name__ == "__main__":
    main()
