#!/usr/bin/env python3
"""Radiator Teeth: a photocopied-zine video, cut to the score.

usage: draw.py OUT.mp4 [--from S] [--to S] [--still S ...]
Reads work/radiator_teeth_v2/{timeline.json, parts/*.wav} (build.sh makes them; parts come
from `mix.py OUT --parts DIR`) and muxes out/radiator_teeth_v2.wav as the soundtrack.
Structure (bars, kicks, snares, the seizure, every sung word) comes from the score; the
part tracks add texture (guitar static, bass rattle, the howl bending the pipes).
"""
import argparse, json, math, os, random, subprocess, sys
import numpy as np, soundfile as sf, cairo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = f"{ROOT}/work/radiator_teeth_v2"
W, H, FPS = 1920, 1080, 30
BONE, INK, RED = (0.93, 0.90, 0.84), (0.07, 0.06, 0.06), (0.84, 0.15, 0.12)
VOX_EARLY = 0.020                    # mix.py places the vocals this much ahead of the grid

def lerp(a, b, u): return a + (b - a) * u
def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def smooth(u): u = clamp(u); return u * u * (3 - 2 * u)

# ---------- the score ----------
TL = json.load(open(f"{WORK}/timeline.json")); BARS = TL["bars"]; TOTAL = TL["total"]
for b in BARS: b["end"] = b["t"] + b["steps"] * b["step"]
SEC = {}
for b in BARS: SEC.setdefault(b["sec"], []).append(b)
def sec_t(name): return SEC[name][0]["t"], SEC[name][-1]["end"]
def bar_at(t):
    for b in BARS:
        if b["t"] <= t < b["end"]: return b
    return BARS[-1] if t >= TOTAL else BARS[0]

def events():
    """Kick, snare and retrigger times, the same rules mix.py plays the kit by."""
    kick, snare, crash, seize = [], [], [], []
    for b in BARS:
        sec, st, t0 = b["sec"], b["step"], b["t"]
        if sec in ("intro", "tail"): continue
        if sec == "end" and b["k"] == 1:
            t, d = t0, 0.25 * 60 / b["bpm"]
            while d > 0.03 * 60 / b["bpm"]: seize.append(t); kick.append(t); t += d; d *= 0.82
            continue
        if b["k"] == 0: crash.append(t0)
        for s in range(b["steps"]):
            t = t0 + s * st; off = b["riff"][s % 16] if b["riff"] else None
            if sec == "down":
                if s in (0, 8, 14): kick.append(t)
                if s == 8: snare.append(t)
            elif sec == "blast":
                (kick if s % 2 == 0 else snare).append(t)
            else:
                if b["stutter"] and s >= 12: snare.append(t); continue
                if off == 0: kick.append(t)
                if s in (4, 12): snare.append(t)
    return [np.array(sorted(x)) for x in (kick, snare, crash, seize)]
KICK, SNARE, CRASH, SEIZE = events()
def since(times, t):
    i = np.searchsorted(times, t, side="right") - 1
    return t - times[i] if i >= 0 else 1e9
def until(times, t):
    i = np.searchsorted(times, t, side="right")
    return times[i] - t if i < len(times) else 1e9

def lyrics():
    """Lines of words, each word timed from the vocal score: (start, end, style, [(t, text), ...])."""
    out = []
    def bar(sec, k): return next(b for b in BARS if b["sec"] == sec and b["k"] == k)
    def line(b, steps, texts, style, hold=0.3):
        t = b["t"] - VOX_EARLY; st = b["step"]; ws = []
        for n, txt in zip(steps, texts): ws.append((t, txt)); t += n * st
        out.append((ws[0][0], t + hold, style, ws))
    shout = ([3, 1, 1, 2, 1, 1, 3], ["TEETH ", "in ", "the ", "RA", "DI", "A", "TOR!"])
    for k in (1, 3, 5): line(bar("a", k), *shout, "shout")
    for k in (0, 2, 4): line(bar("a3", k), *shout, "shout")
    for k in (0, 2, 4, 6): line(bar("a2", k), [3, 1, 4], ["BITE ", "the ", "HEAT!"], "shout")
    for k in (3, 7): line(bar("a2", k), [3] * 5, ["BI- "] * 4 + ["BITE"], "stuck", hold=0.1)
    sung = ["the ", "pipes ", "are ", "sing", "ing"]
    for k in (0, 2, 4, 6): line(bar("b", k), [2, 14, 4, 6, 6], sung, "sung", hold=0)
    tm = json.load(open(f"{WORK}/klatt_timing.json"))
    for k, name, splits, txt in [(1, "warm", [0, 3, 7, 9], "it's warm in here."), (4, "warm2", [0, 3, 5, 9, 11], "it's so warm in here.")]:
        ph = tm[name]["voices"][0]; t0 = bar("down", k)["t"] - VOX_EARLY
        ws = [(t0 + ph[i][1] / 1000, w + " ") for i, w in zip(splits, txt.split())]
        out.append((ws[0][0], t0 + ph[-1][2] / 1000 + 2.5, "whisper-L" if k == 1 else "whisper-R", ws))
    for b in SEC["blast"]:
        for q in range(b["steps"] // 4):
            t = b["t"] + q * 4 * b["step"] - VOX_EARLY; out.append((t, t + 3 * b["step"], "hot", [(t, "HOT")]))
    tail = SEC["tail"][0]; t = tail["t"] + 2 * 60 / tail["bpm"]
    out.append((t, TOTAL + 10, "last", [(t, "teeth.")]))
    return out
LYR = lyrics()

# ---------- part envelopes (texture only) ----------
def envelope(name, fps=FPS):
    x, sr = sf.read(f"{WORK}/parts/{name}.wav", dtype="float32"); x = np.abs(x).mean(1)
    n = len(x) // (sr // fps); e = np.sqrt((x[:n * (sr // fps)] ** 2).reshape(n, -1).mean(1))
    return e / (np.percentile(e, 98) + 1e-9)
ENV = {k: envelope(k) for k in ("gtrL", "bass", "lead", "vox", "fx", "organ")}
def env(name, t):
    i = int(t * FPS); e = ENV[name]; return float(e[i]) if 0 <= i < len(e) else 0.0

# ---------- paper ----------
rng = np.random.default_rng(7)
def grain_surface(seed):
    r = np.random.default_rng(seed); w, h = W // 2, H // 2
    a = np.zeros((h, w, 4), np.uint8)
    speck = r.random((h, w)); a[..., 3] = np.where(speck > 0.985, 200, np.where(speck > 0.94, 60, 0))
    for _ in range(r.integers(2, 6)):                       # copier streaks
        y = r.integers(0, h - 3); n = r.integers(1, 3); a[y:y + n, :, 3] = np.maximum(a[y:y + n, :, 3], r.integers(20, 70))
    s = cairo.ImageSurface.create_for_data(memoryview(a.copy()), cairo.FORMAT_ARGB32, w, h); return s, a
GRAIN = [grain_surface(s) for s in range(8)]
def halftone(dot, gap, color):
    s = cairo.ImageSurface(cairo.FORMAT_ARGB32, gap, gap); c = cairo.Context(s)
    c.set_source_rgb(*color); c.arc(gap / 2, gap / 2, dot, 0, 2 * math.pi); c.fill()
    p = cairo.SurfacePattern(s); p.set_extend(cairo.EXTEND_REPEAT); return p
HT = {"ink": halftone(3.2, 9, INK), "ink_light": halftone(1.8, 9, INK), "bone": halftone(2.6, 9, BONE), "red": halftone(3.0, 10, RED)}

# ---------- ransom-note lettering ----------
FONTS = [("DejaVu Sans", 1, 0), ("DejaVu Serif", 1, 0), ("Liberation Serif", 0, 1), ("Liberation Sans", 1, 0),
         ("FreeMono", 1, 0), ("FreeSerif", 1, 1), ("Liberation Mono", 0, 0), ("DejaVu Sans Mono", 1, 1)]
def ransom(c, text, cx, cy, size, seed, alpha=1.0, palette=("bone", "ink", "red"), reveal=1.0, chars=None, hot=None):
    r = random.Random(seed); glyphs = []
    for ch in text:
        fam, bold, ital = r.choice(FONTS); sz = size * r.uniform(0.85, 1.25)
        c.select_font_face(fam, cairo.FONT_SLANT_ITALIC if ital else cairo.FONT_SLANT_NORMAL,
                           cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
        c.set_font_size(sz); ext = c.text_extents(ch if ch != " " else "n")
        glyphs.append((ch, fam, bold, ital, sz, ext, r.uniform(-0.14, 0.14), r.uniform(-0.12, 0.12) * size, r.choice(palette)))
    width = sum(g[5].x_advance + size * 0.22 for g in glyphs)
    if width > W - 180 and not getattr(ransom, "fitting", False):   # too wide: redo it smaller
        ransom.fitting = True
        try: return ransom(c, text, cx, cy, size * (W - 180) / width, seed, alpha, palette, reveal, chars, hot)
        finally: ransom.fitting = False
    x = cx - width / 2
    shown = chars if chars is not None else int(math.ceil(len(glyphs) * clamp(reveal)))
    for gi, (ch, fam, bold, ital, sz, ext, rot, dy, box) in enumerate(glyphs[:shown]):
        adv = ext.x_advance + size * 0.22
        if hot and hot[0] <= gi < hot[1]: box = "red"          # the word being sung
        if ch != " ":
            c.save(); c.translate(x + adv / 2, cy + dy); c.rotate(rot)
            bw, bh = ext.width + sz * 0.3, sz * 1.15
            bg = {"bone": BONE, "ink": INK, "red": RED}[box]; fg = INK if box == "bone" else BONE
            c.rectangle(-bw / 2, -bh / 2, bw, bh); c.set_source_rgba(*bg, alpha); c.fill()
            c.select_font_face(fam, cairo.FONT_SLANT_ITALIC if ital else cairo.FONT_SLANT_NORMAL,
                               cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
            c.set_font_size(sz); c.set_source_rgba(*fg, alpha)
            c.move_to(-ext.width / 2 - ext.x_bearing, -ext.height / 2 - ext.y_bearing); c.show_text(ch)
            c.restore()
        x += adv

def typewriter(c, text, x, y, size, color, alpha=1.0, chars=None, align="left"):
    c.select_font_face("FreeMono", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD); c.set_font_size(size)
    s = text if chars is None else text[:chars]
    if align == "center": x -= c.text_extents(text).x_advance / 2
    c.set_source_rgba(*color, alpha); c.move_to(x, y); c.show_text(s)

# ---------- the radiator ----------
NFIN = 9
TEETH_N = 15
_tr = random.Random(5)
CROOK = [(_tr.uniform(0.75, 1.3), _tr.uniform(-0.25, 0.25)) for _ in range(2 * TEETH_N)]   # every tooth a little wrong
def radiator(c, t, b, ink, paper, jaw, rattle, melt, bend):
    cx, cy, fw, gap, h = 960, 650, 80, 14, 540
    width = NFIN * fw + (NFIN - 1) * gap; x0 = cx - width / 2; top, bot = cy - h / 2, cy + h / 2
    open_ = 8 + 170 * jaw; up, lo = cy - open_ / 2, cy + open_ / 2
    # pipes: in from the left floor, out of the top right, bending with the howl
    for (px, py, qx, qy, ph) in [(x0 - 10, bot - 60, -40, bot - 60, 0.0), (x0 + width + 10, top + 50, W + 40, top - 260, 1.7)]:
        steps = 28; pts = []
        for k in range(steps + 1):
            u = k / steps; x = lerp(px, qx, u); y = lerp(py, qy, u * u if qx > W else u)
            y += math.sin(u * math.pi * 3 + t * 9 + ph) * 34 * bend * math.sin(u * math.pi)
            pts.append((x, y))
        for wdt, col in ((52, ink), (38, paper)):
            c.move_to(*pts[0]); [c.line_to(*q) for q in pts[1:]]
            c.set_line_width(wdt); c.set_line_cap(cairo.LINE_CAP_BUTT); c.set_source_rgb(*col); c.stroke()
        c.move_to(*pts[0]); [c.line_to(*q) for q in pts[1:]]; c.set_line_width(30); c.set_source(HT["ink_light"]); c.stroke()
    # the throat
    c.rectangle(x0 + 6, up, width - 12, open_); c.set_source_rgb(*RED); c.fill()
    g = cairo.LinearGradient(0, up, 0, lo); g.add_color_stop_rgba(0, *INK, 0.0); g.add_color_stop_rgba(0.5, *INK, 0.75); g.add_color_stop_rgba(1, *INK, 0.0)
    c.rectangle(x0 + 6, up, width - 12, open_); c.set_source(g); c.fill()
    # manifolds and feet
    c.set_source_rgb(*ink)
    c.rectangle(x0 - 16, top - 22, width + 32, 26); c.fill()
    c.rectangle(x0 - 16, bot - 4 + melt * 60, width + 32, 26); c.fill()
    for fx in (x0 + 24, x0 + width - 60): c.rectangle(fx, bot + 22 + melt * 60, 36, 46); c.fill()
    def body(path):
        path(); c.set_source_rgb(*paper); c.fill()
        path(); c.set_source(HT["ink"]); c.fill()
        path(); c.set_source_rgb(*ink); c.set_line_width(6); c.stroke()
    for i in range(NFIN):
        fx = x0 + i * (fw + gap) + rattle * math.sin(t * 61 + i * 2.1) * 7
        drip = melt * (40 + 160 * ((i * 7919) % 11) / 11)       # the breakdown sags each fin differently
        def upper(fx=fx):
            c.new_path(); c.move_to(fx, up); c.line_to(fx, top + 18); c.curve_to(fx, top - 6, fx + fw, top - 6, fx + fw, top + 18)
            c.line_to(fx + fw, up); c.close_path()
        def lower(fx=fx, drip=drip):
            c.new_path(); c.move_to(fx, lo); c.line_to(fx + fw, lo); c.line_to(fx + fw, bot + drip * 0.6)
            c.curve_to(fx + fw, bot + drip, fx + fw * 0.6, bot + drip * 1.25, fx + fw * 0.5, bot + drip * 1.2)
            c.curve_to(fx + fw * 0.4, bot + drip * 1.25, fx, bot + drip, fx, bot + drip * 0.6); c.close_path()
        body(upper); body(lower)
        c.set_source_rgb(*ink); c.set_line_width(4)
        for yy in (top + 60, top + 110):
            if yy < up - 10: c.move_to(fx + 12, yy); c.line_to(fx + fw - 12, yy); c.stroke()
        for yy in (bot - 60, bot - 110):
            if yy > lo + 10: c.move_to(fx + 12, yy); c.line_to(fx + fw - 12, yy); c.stroke()
    # teeth: bone white, crooked, the full width of the mouth
    tw = (width - 12) / TEETH_N
    for row, (edge, sign) in enumerate(((up, 1), (lo, -1))):
        for k in range(TEETH_N):
            L, lean = CROOK[row * TEETH_N + k]; x = x0 + 6 + k * tw + (tw / 2 if row else 0) * 0
            tip = edge + sign * 50 * L
            c.new_path(); c.move_to(x + 2, edge); c.line_to(x + tw / 2 + lean * tw, tip); c.line_to(x + tw - 2, edge); c.close_path()
            c.set_source_rgb(*BONE); c.fill_preserve(); c.set_source_rgb(*INK); c.set_line_width(4); c.stroke()

def cathedral(c, a):
    if a <= 0: return
    c.save(); c.set_source_rgba(*RED, 0.55 * a); c.set_line_width(10)
    for k, s in enumerate((1.0, 0.8, 0.6)):
        w, h = 760 * s, 980 * s; x = 960 - w / 2; y = 1080 - h
        c.move_to(x, 1080); c.line_to(x, y + w / 2); c.curve_to(x, y, 960, y - 80 * s, 960, y - 120 * s)
        c.curve_to(960, y - 80 * s, x + w, y, x + w, y + w / 2); c.line_to(x + w, 1080); c.stroke()
    c.restore()

# ---------- a frame ----------
def frame(c, surf, t):
    b = bar_at(t); sec = b["sec"]; r = random.Random(int(t * FPS))
    dark = sec == "down" or sec == "tail" or (sec == "end" and t >= SEIZE[-1] + 0.05)
    blast = sec == "blast"
    ink, paper = (BONE, INK) if dark else (INK, BONE)
    # paper: in the blast it strobes red on the eighth notes
    bg = paper
    if blast: bg = RED if int((t - b["t"]) / (2 * b["step"])) % 2 == 0 else BONE
    c.set_source_rgb(*bg); c.paint()

    # camera: kicks shove it, the blast shakes it
    sk = since(KICK, t); shove = math.exp(-sk / 0.06) * (14 if not blast else 22)
    c.save(); c.translate(r.uniform(-1, 1) * shove, r.uniform(-1, 1) * shove)
    # the end: each retrigger cuts closer to the teeth
    zoom = 1.0
    if sec == "end" and b["k"] == 1 and t < SEIZE[-1] + 0.05:
        n = np.searchsorted(SEIZE, t, side="right"); zoom = 1 + 0.12 * n
    if zoom != 1: c.translate(960, 620); c.scale(zoom, zoom); c.translate(-960, -620)

    if sec == "intro":
        i0, i1 = sec_t("intro"); u = (t - i0) / (i1 - i0)
        # the pipes scream: a red streak climbs each bar
        for k in range(b["k"] + 1):
            bb = SEC["intro"][k]; v = clamp((t - bb["t"]) / (bb["end"] - bb["t"]))
            y = lerp(900, 150, v) - k * 40; c.set_source_rgba(*RED, 0.85); c.rectangle(0, y, W * (0.4 + 0.15 * k), 8 + 4 * k); c.fill()
        f = env("fx", t)
        if f > 0.55:                                            # bitcrushed kicks flash the radiator in negative
            c.save(); c.rectangle(0, 0, W, H); c.set_source_rgb(*INK); c.fill()
            radiator(c, t, b, BONE, INK, 0.3, 0.6, 0, 0); c.restore()
        ransom(c, "RADIATOR TEETH", 960, 230, 92, 3, reveal=smooth(u * 1.3))
    elif sec != "tail" and not (sec == "end" and t >= SEIZE[-1] + 0.05):
        jaw = 0.25
        if sec in ("a", "a2", "a3", "b", "blast", "end"):
            jaw = clamp(sk / 0.22) * 0.9 + 0.1                      # slams shut on every kick, then gapes
        if sec == "down": jaw = 0.25 + 0.2 * math.sin(t * 1.3)
        if sec == "end" and b["k"] == 1: jaw = clamp(since(SEIZE, t) / max(0.02, until(SEIZE, t) + since(SEIZE, t)))
        d0, d1 = sec_t("down"); melt = smooth((t - d0) / (d1 - d0)) if sec == "down" else 0
        cathedral(c, (env("organ", t)) if sec == "down" else 0)
        radiator(c, t, b, ink, paper if not blast else BONE, jaw, env("bass", t) * (1.5 if blast else 1), melt,
                 env("lead", t) if sec in ("b", "blast") else 0)
    c.restore()

    # guitar static: white scratches that come and go with the riff
    g = env("gtrL", t)
    if sec not in ("intro", "tail", "down"):
        for _ in range(int(g * 14)):
            y = r.uniform(0, H); x = r.uniform(-200, W); c.set_source_rgba(*(BONE if not dark else INK), r.uniform(0.4, 0.9))
            c.rectangle(x, y, r.uniform(80, 600), r.uniform(1, 4)); c.fill()

    # lyrics: each line builds up word by word; the word being sung is cut from red
    for (s0, e0, style, ws) in LYR:
        if not (s0 <= t < e0): continue
        text = "".join(w for _, w in ws); seed = int(s0 * 1000)
        upto = [x for x in ws if x[0] <= t]; n = sum(len(w) for _, w in upto)
        w = upto[-1][1] if upto else ""; cur = (n - len(w), n - len(w) + len(w.rstrip()))
        if style in ("shout", "stuck"):
            ransom(c, text, 960 + r.uniform(-3, 3), 150, 100 if style == "shout" else 112, seed, palette=("bone", "ink"), chars=n, hot=cur)
        elif style == "sung":
            ransom(c, text, 960, 150, 96, seed, palette=("bone", "ink"), chars=n, hot=cur)
        elif style.startswith("whisper"):
            fade = clamp((e0 - t) / 2.5); left = style.endswith("L")
            c.select_font_face("FreeMono", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD); c.set_font_size(52)
            x = 110 if left else W - 110 - c.text_extents(text.rstrip()).x_advance
            typewriter(c, text, x, 150 if left else 270, 52, BONE, fade, chars=n)
        elif style == "hot":
            q = random.Random(seed); hx, hy = q.uniform(360, 1560), q.uniform(200, 880); age = t - s0
            c.save(); c.translate(hx, hy); c.rotate(q.uniform(-0.3, 0.3)); k = 1.7 - 0.6 * clamp(age / 0.1)
            c.scale(k, k); ransom(c, "HOT", 0, 0, 130, seed, palette=("ink", "bone")); c.restore()
        elif style == "last":
            typewriter(c, text, 960, 560, 40, BONE, 1.0, chars=int(clamp((t - s0) / 0.6) * len(text) + 0.999), align="center")

    # the tail: one scream sinking through the dark
    if sec == "tail":
        a0 = SEC["tail"][0]["t"]; u = clamp((t - a0) / 3.5)
        y = lerp(300, 980, u * u); c.set_source_rgba(*BONE, 1 - u); c.rectangle(0, y, W, 3 + 10 * (1 - u)); c.fill()

    # the photocopier: grain, a red plate slightly out of register, and slips on stutters
    gs, _ = GRAIN[int(t * FPS / 2) % len(GRAIN)]
    c.save(); c.scale(2, 2); c.set_source_surface(gs, 0, 0); c.paint_with_alpha(0.9 if not dark else 0.5); c.restore()
    slip = (b.get("stutter") and (t - b["t"]) / b["step"] >= 12) or (b["steps"] < 16 and (t - b["t"]) / b["step"] >= b["steps"] - 2)
    if slip or since(SNARE, t) < 0.03 and sec in ("a", "a2", "a3"):
        surf.flush(); snap = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H); sc = cairo.Context(snap)
        sc.set_source_surface(surf); sc.paint()
        for _ in range(6 if slip else 2):
            y = r.uniform(0, H - 120); hgt = r.uniform(20, 160); dx = r.uniform(-140, 140)
            c.save(); c.rectangle(0, y, W, hgt); c.clip(); c.set_source_surface(snap, dx, 0); c.paint(); c.restore()
    # crash: a full-frame flash of ink
    if since(CRASH, t) < 0.05: c.set_source_rgba(*INK, 0.85); c.paint()
    if sec == "end" and b["k"] == 1 and since(SEIZE, t) < 0.025: c.set_source_rgba(*BONE, 0.8); c.paint()
    # fade at the very end
    if t > TOTAL + 3.3: c.set_source_rgba(*INK, clamp((t - TOTAL - 3.3) / 1.0)); c.paint()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("out")
    ap.add_argument("--from", dest="t0", type=float, default=0); ap.add_argument("--to", dest="t1", type=float)
    ap.add_argument("--still", nargs="*", type=float)
    a = ap.parse_args()
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H); c = cairo.Context(surf)
    if a.still:
        for s in a.still: frame(c, surf, s); surf.write_to_png(f"{a.out}_{s:06.2f}.png")
        return
    audio = f"{ROOT}/out/radiator_teeth_v2.wav"
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio],
                               capture_output=True, text=True).stdout)
    t1 = min(a.t1 or dur, dur); n = int((t1 - a.t0) * FPS)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-ss", str(a.t0), "-t", str(t1 - a.t0), "-i", audio, "-map", "0:v", "-map", "1:a",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", a.out], stdin=subprocess.PIPE)
    for k in range(n):
        frame(c, surf, a.t0 + k / FPS); surf.flush(); ff.stdin.write(bytes(surf.get_data()))
        if k % (FPS * 10) == 0: print(f"{a.t0 + k / FPS:6.1f}s", file=sys.stderr, flush=True)
    ff.stdin.close(); ff.wait(); print(a.out)

if __name__ == "__main__":
    main()
