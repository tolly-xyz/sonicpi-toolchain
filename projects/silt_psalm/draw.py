#!/usr/bin/env python3
"""Silt Psalm: one body of water, start to finish. Suspended silt in a 2D fluid (stable fluids
plus ~110k particles), driven by the score.

usage: draw.py OUT.mp4 [--still S ...]     (stills: PNGs at those times, named OUT_<t>.png)
Reads work/silt_psalm/{timeline.json, parts/*.wav} (build.sh makes them) and muxes
out/silt_psalm.wav as the soundtrack.

    intro    still and dark; each growl lifts a plume off the floor
    I, II    kicks stir vortices, snares shear; the voice lights the water
             the short stammering bars stutter the picture itself
    chorus   everything lets go and settles; an arch appears where silt lands on it
    break    darker; the arch dissolves; each whisper brings light from its side
    blast    the camera pulls back a step per bar, more and more water above; strobing
    III      gravity turns: the silt rises toward a brightening surface
    seizure  jolts on every retrigger; then clear water, one grain left, sinking
"""
import json, math, os, subprocess, sys, time
import numpy as np, soundfile as sf
from scipy.ndimage import map_coordinates, gaussian_filter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = f"{ROOT}/work/silt_psalm"
W, H, FPS = 1920, 1080, 30
GW, GH = 320, 180                    # the whole tank (fluid grid)
VIEW_W = 192                         # the camera's usual width in grid cells; the blast pulls back to GW

# ---------- the score ----------
TL = json.load(open(f"{WORK}/timeline.json")); BARS = TL["bars"]; TOTAL = TL["total"]
for b in BARS: b["end"] = b["t"] + b["steps"] * b["step"]
SEC = {}
for b in BARS: SEC.setdefault(b["sec"], []).append(b)
def sec_t(name): return SEC[name][0]["t"], SEC[name][-1]["end"]
def bar_at(t):
    for b in BARS:
        if b["t"] <= t < b["end"]: return b
    return BARS[-1]

def events():
    """Kicks, snares and the seizure's retriggers, by the same rules mix.py plays them."""
    kick, snare, seize = [], [], []
    for b in BARS:
        sec, st, t0 = b["sec"], b["step"], b["t"]
        if sec in ("intro", "tail"): continue
        if sec == "end" and b["k"] == 1:
            t, d = t0, 0.25 * 60 / b["bpm"]
            while d > 0.03 * 60 / b["bpm"]: seize.append(t); t += d; d *= 0.82
            continue
        for s in range(b["steps"]):
            t = t0 + s * st; off = b["riff"][s % 16] if b["riff"] else None
            if sec == "down":
                if s in (0, 8, 14): kick.append(t)
                if s == 8: snare.append(t)
            elif sec == "blast": (kick if s % 2 == 0 else snare).append(t)
            else:
                if b["stutter"] and s >= 12: snare.append(t); continue
                if off == 0: kick.append(t)
                if s in (4, 12): snare.append(t)
    return [np.array(x) for x in (kick, snare, seize)]
KICK, SNARE, SEIZE = events()
def fired(times, t, dt):
    """Index of an event that fell inside (t - dt, t], or None."""
    i = np.searchsorted(times, t, side="right") - 1
    return i if i >= 0 and t - times[i] < dt else None
def since(times, t):
    i = np.searchsorted(times, t, side="right") - 1
    return t - times[i] if i >= 0 else 1e9

def envelope(name):
    x, sr = sf.read(f"{WORK}/parts/{name}.wav", dtype="float32"); x = np.abs(x).mean(1); hop = sr // FPS
    n = len(x) // hop; e = np.sqrt((x[:n * hop] ** 2).reshape(n, hop).mean(1)); return e / (np.percentile(e, 98) + 1e-9)
ENV = {k: envelope(k) for k in ("vox", "bass", "fx", "gtrL")}
def env(name, t):
    i = int(t * FPS); e = ENV[name]; return float(e[i]) if 0 <= i < len(e) else 0.0

# ---------- the water ----------
rng = np.random.default_rng(3)
Y, X = np.mgrid[0:GH, 0:GW].astype(float)
u = np.zeros((GH, GW)); v = np.zeros((GH, GW))
# the arch, standing on the floor in the middle: hollow, a doorway; silt can't pass through its walls
cx, base, half, tall = GW * 0.5, GH - 1, 22, 62
_r2 = (X - cx) ** 2 + (Y - (base - tall + half)) ** 2
ARCH = (((np.abs(X - cx) < half) & (Y > base - tall + half) & (Y < base)) | (_r2 < half ** 2)) & \
       ~(((np.abs(X - cx) < half - 6) & (Y > base - tall + half)) | (_r2 < (half - 6) ** 2))
solid = np.zeros_like(ARCH)

N = 110000
px = rng.uniform(1, GW - 1, N)
py = np.where(rng.random(N) < 0.5, GH - 1 - rng.exponential(5, N).clip(0, 60),   # half asleep on the floor,
              rng.uniform(GH * 0.35, GH - 2, N))                                        # half already hanging
size = rng.uniform(0.4, 1.0, N)
stuck = np.zeros(N, bool)
ONE = N // 2                         # the grain that stays at the end

def project(u, v, iters=150):
    u[:, 0] = u[:, -1] = 0; v[0, :] = v[-1, :] = 0
    div = np.zeros_like(u)
    div[1:-1, 1:-1] = -0.5 * (u[1:-1, 2:] - u[1:-1, :-2] + v[2:, 1:-1] - v[:-2, 1:-1])
    p = np.zeros_like(u)
    for _ in range(iters):
        p[1:-1, 1:-1] = (div[1:-1, 1:-1] + p[1:-1, 2:] + p[1:-1, :-2] + p[2:, 1:-1] + p[:-2, 1:-1]) / 4
        p[0, :], p[-1, :], p[:, 0], p[:, -1] = p[1, :], p[-2, :], p[:, 1], p[:, -2]
    u[1:-1, 1:-1] -= 0.5 * (p[1:-1, 2:] - p[1:-1, :-2]); v[1:-1, 1:-1] -= 0.5 * (p[2:, 1:-1] - p[:-2, 1:-1])
    u[solid] = 0; v[solid] = 0
    return u, v

def advect(f, dt):
    return map_coordinates(f, [Y - dt * v, X - dt * u], order=1, mode="nearest")

def vortex(r, strength, spread=300.0, lo=0.15, hi=0.85):
    global u, v
    kx, ky = r.uniform(GW * 0.15, GW * 0.85), r.uniform(GH * lo, GH * hi)
    dx, dy = X - kx, Y - ky; g = np.exp(-(dx ** 2 + dy ** 2) / spread)
    s = r.choice([-1, 1]) * strength; u += s * -dy * g * 0.25; v += s * dx * g * 0.25

FROZEN = {"until": -1.0}
def step(t, dt):
    """Advance the water to time t."""
    global u, v, px, py, stuck, solid
    b = bar_at(t); sec = b["sec"]
    # the stammering bars: the water stops dead for their last few sixteenths
    if sec == "a2" and b["steps"] == 15 and (t - b["t"]) / b["step"] >= 6: return
    seized = sec == "end" and b["k"] == 1 and t < SEIZE[-1] + 0.05
    after = (sec == "end" and b["k"] == 1 and not seized) or sec == "tail"
    calm = sec == "b"
    # forces
    k = fired(KICK, t, dt)
    if k is not None and sec in ("a", "a2", "blast", "a3", "end", "down"):
        strength = {"a": 2.0, "a2": 2.6, "blast": 3.2, "a3": 1.6, "end": 2.6, "down": 0.9}[sec]
        vortex(np.random.default_rng(k), strength, hi=0.95)          # low enough to churn the floor
    if fired(SNARE, t, dt) is not None and sec in ("a", "a2", "blast", "a3", "end"):
        u += 1.4 * np.sin(Y / GH * np.pi * 3 + t) * np.exp(-((Y - GH * 0.45) / 40) ** 2)
    if sec == "intro":                                       # each growl lifts a plume off the floor
        lift = 0.06 * (1 + b["k"]) * env("fx", t)
        v += -lift * np.exp(-((X - GW / 2) / 30) ** 2) * np.exp(-((Y - GH * 0.8) / 30) ** 2)
    if seized:
        s = fired(SEIZE, t, dt)
        if s is not None:
            for j in range(3): vortex(np.random.default_rng(1000 + s * 3 + j), 4.0, spread=900)
    damp = 0.93 if calm else 0.97 if sec in ("down", "tail") else 0.985
    if after:
        damp = 0.8
        if not FROZEN.get('placed'):
            x0, y0, vw, vh = view(t); px[ONE], py[ONE] = GW / 2, y0 + vh * 0.42; FROZEN['placed'] = True
    u *= damp; v *= damp
    u, v = advect(u, dt * 30), advect(v, dt * 30)
    # the arch stands only from the chorus through the first bars of the breakdown
    d0, _ = sec_t("down")
    solid = ARCH if (calm or (sec == "down" and t < d0 + 2.0)) else np.zeros_like(ARCH)
    u, v = project(u, v)
    # the grains: ride the flow, sink (or rise, in the last verse), settle in the chorus
    pu = map_coordinates(u, [py, px], order=1, mode="nearest"); pv = map_coordinates(v, [py, px], order=1, mode="nearest")
    grav = {"intro": 0.03, "b": 0.55, "down": 0.25, "a3": -0.18, "tail": 0.0}.get(sec, 0.08)
    if sec == "end" and b["k"] == 1: grav = 0.0
    m = ~stuck
    if after: m[ONE] = False; py[ONE] += 0.04 * dt * 30           # the one grain, sinking very slowly
    jitter = 0.05 if not after else 0.0
    px[m] += (pu[m] + rng.normal(0, jitter, m.sum())) * dt * 30
    py[m] += (pv[m] + grav * size[m] + rng.normal(0, jitter, m.sum())) * dt * 30
    for q, lim in ((px, GW - 1.01), (py, GH - 1.01)):
        lo = q < 1; q[lo] = 2 - q[lo]; hi = q > lim; q[hi] = 2 * lim - q[hi]
    np.clip(px, 1, GW - 1.01, out=px); np.clip(py, 1, GH - 1.01, out=py)
    rest = py > GH - 2.5; px[rest] += rng.normal(0, 0.35, rest.sum())   # resting grains drift, rather than pile
    np.clip(px, 1, GW - 1.01, out=px)
    ix, iy = px.astype(int), py.astype(int)
    on_arch = solid[iy, ix]
    if calm: stuck |= on_arch | (py >= GH - 1.5)              # settled grains stay where they land
    else: stuck[:] = False
    py[on_arch & ~stuck] -= 1.5

# ---------- the camera and the light ----------
def view(t):
    """Grid rectangle the camera sees: (x0, y0, w, h). Anchored on the floor; the blast pulls back."""
    b = bar_at(t); w = VIEW_W
    b0, b1 = sec_t("blast")
    if b0 <= t:
        steps = min(8, sum(1 for x in SEC["blast"] if x["t"] <= t))        # one step back per bar
        into = (t - bar_at(t)["t"]) / 0.35 if b["sec"] == "blast" else 1.0
        target = VIEW_W + (GW - 16 - VIEW_W) * (steps - 1 + min(1.0, into)) / 8     # stops short of the tank's walls
        back = 1 - min(1.0, max(0.0, (t - b1) / 2.0))                      # and eases back after
        w = VIEW_W + (target - VIEW_W) * back if t >= b1 else target
    h = w * 9 / 16
    return GW / 2 - w / 2, GH - h, w, h

YY, XX = np.ogrid[0:H, 0:W]
VIGNETTE = 1 - 0.55 * (((XX - W / 2) / (W / 1.6)) ** 2 + ((YY - H / 2) / (H / 1.4)) ** 2)
def render(t):
    b = bar_at(t); sec = b["sec"]
    x0, y0, vw, vh = view(t)
    seized = sec == "end" and b["k"] == 1 and t < SEIZE[-1] + 0.05
    after = (sec == "end" and b["k"] == 1 and not seized) or sec == "tail"
    vis = np.ones(N, bool)
    if after:                                                # clear water: every grain fades but one
        a0 = SEIZE[-1] + 0.05; fade = max(0.0, 1 - (t - a0) / 0.6)
        weight = size ** 2 * fade; weight[ONE] = 0.0
    else:
        weight = size ** 2
    sx = ((px - x0) / vw * W).astype(int); sy = ((py - y0) / vh * H).astype(int)
    ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H) & (weight > 0.001)
    d = np.zeros(H * W); np.add.at(d, sy[ok] * W + sx[ok], weight[ok] * (VIEW_W / vw) ** 0.5); d = d.reshape(H, W)
    np.minimum(d, 2.5, out=d)                                # a pile of grains is sediment, not a hot spot
    fine = gaussian_filter(d, 1.1); haze = gaussian_filter(d, 9)
    # light: from the surface (grid top), dimmer the deeper the camera looks; the voice brightens it
    gy = y0 + (np.arange(H) + 0.5) / H * vh
    depth = np.exp(-gy / GH * 1.6)[:, None]
    level = {"intro": 0.45, "down": 0.55, "a3": 1.0, "tail": 0.6}.get(sec, 0.8)
    if sec == "a3": level += 0.6 * (t - sec_t("a3")[0]) / (sec_t("a3")[1] - sec_t("a3")[0])   # the surface comes closer
    lit = depth * level * (1 + 0.35 * env("vox", t))
    kick = math.exp(-since(KICK, t) / 0.08) * (0.25 if sec not in ("b", "down") else 0.05)
    if sec == "blast" and int((t - b["t"]) / (2 * b["step"])) % 2 == 0: kick += 0.18      # strobe on the eighths
    if seized: kick += 1.2 * math.exp(-since(SEIZE, t) / 0.03)
    side = 0.0
    if sec == "down":                                        # each whisper brings light from its side
        k = b["k"]; sgn = -1 if k < 3 else 1; amt = env("vox", t)
        side_light = np.clip((XX / W - 0.5) * sgn * 2, 0, 1) ** 2 * amt * 0.8
    else:
        side_light = 0.0
    light = lit + kick + side_light
    a = 1 - np.exp(-(fine * 1.7 + haze * 3.5) * light)
    water = np.array([0.020, 0.032, 0.030]); silt = np.array([0.82, 0.79, 0.66])
    img = water + (silt - water) * a[..., None]
    img += (0.04 * (lit + kick * 0.6))[..., None] * np.array([0.25, 0.45, 0.42])
    if after:                                                # the one grain left, a small glow
        gx = (px[ONE] - x0) / vw * W; gy_ = (py[ONE] - y0) / vh * H
        glow = np.exp(-((XX - gx) ** 2 + (YY - gy_) ** 2) / (2 * 5.0 ** 2)) + 0.25 * np.exp(-((XX - gx) ** 2 + (YY - gy_) ** 2) / (2 * 30.0 ** 2))
        img += glow[..., None] * np.array([0.85, 0.80, 0.66]) * min(1.0, (t - SEIZE[-1]) / 1.0)
    img *= VIGNETTE[..., None]
    img += rng.normal(0, 0.012, (H, W, 1))                    # film grain
    # fade in from black, out to black
    fade = min(1.0, t / 1.5) * min(1.0, max(0.0, (TOTAL + 4.2 - t) / 1.2))
    return (np.clip(img * fade, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)

def main():
    out = sys.argv[1]; stills = [float(x) for x in sys.argv[3:]] if len(sys.argv) > 2 and sys.argv[2] == "--still" else None
    audio = f"{ROOT}/out/silt_psalm.wav"
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio],
                               capture_output=True, text=True).stdout)
    n = int((max(stills) + 0.05 if stills else dur) * FPS); dt = 1 / FPS; t0 = time.time()
    ff = None if stills else subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", out], stdin=subprocess.PIPE)
    want = sorted(round(s * FPS) for s in stills) if stills else None
    for k in range(n):
        t = k / FPS; step(t, dt)
        if ff: ff.stdin.write(render(t).tobytes())
        elif k in want:
            import cairo  # noqa: only for writing the PNG
            img = render(t); a = np.dstack([img[..., 2], img[..., 1], img[..., 0], np.full(img.shape[:2], 255, np.uint8)]).copy()
            cairo.ImageSurface.create_for_data(memoryview(a), cairo.FORMAT_ARGB32, W, H).write_to_png(f"{out}_{t:06.2f}.png")
        if k % (FPS * 10) == 0: print(f"{t:6.1f}s  ({time.time() - t0:.0f} s elapsed)", file=sys.stderr, flush=True)
    if ff: ff.stdin.close(); ff.wait(); print(out)

if __name__ == "__main__":
    main()
