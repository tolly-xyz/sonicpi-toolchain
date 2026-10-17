#!/usr/bin/env python3
"""Draw "The Room With The Crooked Clock" from the song's timeline.

usage: draw.py timeline.json audio.mp3 out.mp4 [--from S] [--to S] [--offset S] [--still S ...]
The audio should start with the music (build.sh trims the render's leading silence).
Frames are drawn with cairo and piped straight into ffmpeg with the audio.
"""
import argparse, bisect, json, math, random, subprocess, sys
import cairo

W, H, FPS = 1920, 1080, 30
AUDIO_OFFSET = 0.0           # music time 0 sits this far into the audio (--offset)

PAPER = (0.953, 0.918, 0.851)
DUSK = (0.86, 0.83, 0.90)    # the other room's light
INK = (0.20, 0.17, 0.18)
AMBER = (0.90, 0.58, 0.22)
PLUM = (0.58, 0.34, 0.62)
BB = 70                      # the odd note

# ---------- small helpers ----------
def lerp(a, b, u): return a + (b - a) * u
def mix(c1, c2, u): return tuple(lerp(x, y, u) for x, y in zip(c1, c2))
def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def smooth(u): u = clamp(u); return u * u * (3 - 2 * u)
def ramp(t, t0, t1): return smooth((t - t0) / (t1 - t0)) if t1 > t0 else float(t >= t0)

# ---------- timeline ----------
def load(path):
    d = json.load(open(path))
    bars = d["bars"]
    for b in bars:
        b["end"] = b["t"] + 7 * b["eighth"]
    secs = {}
    for b in bars:
        s = secs.setdefault(b["sec"], [b["t"], b["end"], []])
        s[1] = b["end"]; s[2].append(b)
    return d["total"], bars, secs

TOTAL, BARS, SECS = None, None, None
STARTS = []

def bar_at(m):
    k = bisect.bisect_right(STARTS, m) - 1
    return BARS[clamp(k, 0, len(BARS) - 1) if k >= 0 else 0], k

def sec_start(name): return SECS[name][0]
def sec_end(name): return SECS[name][1]
def in_sec(m, name): return sec_start(name) <= m < sec_end(name)

# ---------- hand-drawn lines ----------
def wobble(pts, seed, amp=1.3, step=26, closed=False):
    rnd = random.Random(seed)
    if closed: pts = pts + [pts[0]]
    out = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / step))
        nx, ny = (-(y1 - y0) / (L or 1), (x1 - x0) / (L or 1))
        for k in range(1, n + 1):
            u = k / n; j = rnd.uniform(-amp, amp) if k < n else 0
            out.append((lerp(x0, x1, u) + nx * j, lerp(y0, y1, u) + ny * j))
    return out

def partial(pts, frac):
    if frac >= 1: return pts
    if frac <= 0: return pts[:1]
    seg = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    goal = sum(seg) * frac; out = [pts[0]]; acc = 0
    for (a, b), L in zip(zip(pts, pts[1:]), seg):
        if acc + L >= goal:
            u = (goal - acc) / (L or 1); out.append((lerp(a[0], b[0], u), lerp(a[1], b[1], u))); break
        out.append(b); acc += L
    return out

class Pen:
    def __init__(self, ctx, boil):
        self.c, self.boil = ctx, boil
    def line(self, pts, key, width=2.4, color=INK, alpha=1.0, frac=1.0, closed=False, fill=None, fill_alpha=1.0):
        p = wobble(pts, hash((key, self.boil)) & 0xffffffff, closed=closed)
        c = self.c
        if fill is not None and frac >= 1:
            c.move_to(*p[0]); [c.line_to(*q) for q in p[1:]]; c.close_path()
            c.set_source_rgba(*fill, fill_alpha * alpha); c.fill()
        p = partial(p, frac)
        if len(p) < 2: return
        c.move_to(*p[0]); [c.line_to(*q) for q in p[1:]]
        c.set_line_width(width); c.set_line_cap(cairo.LINE_CAP_ROUND); c.set_line_join(cairo.LINE_JOIN_ROUND)
        c.set_source_rgba(*color, alpha); c.stroke()
    def circle(self, x, y, r, key, **kw):
        n = max(10, int(r * 0.9))
        self.line([(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n)) for k in range(n)], key, closed=True, **kw)

def glow(ctx, x, y, r, color, a):
    if a <= 0.003: return
    g = cairo.RadialGradient(x, y, 0, x, y, r)
    g.add_color_stop_rgba(0, *color, a); g.add_color_stop_rgba(0.35, *color, a * 0.45); g.add_color_stop_rgba(1, *color, 0)
    ctx.set_source(g); ctx.arc(x, y, r, 0, 2 * math.pi); ctx.fill()

# ---------- the room ----------
BX0, BY0, BX1, BY1 = 600, 230, 1320, 760      # back wall
def rwall(u, v):                               # point on the right wall
    top = (lerp(BX1, W + 40, u), lerp(BY0, -30, u)); bot = (lerp(BX1, W + 40, u), lerp(BY1, H + 30, u))
    return (lerp(top[0], bot[0], v), lerp(top[1], bot[1], v))

def draw_room(pen, door, spill):
    pen.line([(BX0, BY0), (BX1, BY0), (BX1, BY1), (BX0, BY1)], "back", closed=True, width=2.6)
    for a, b, k in [((BX0, BY0), (-40, -30), "c1"), ((BX1, BY0), (W + 40, -30), "c2"),
                    ((BX0, BY1), (-40, H + 30), "c3"), ((BX1, BY1), (W + 40, H + 30), "c4")]:
        pen.line([a, b], k, width=2.6)
    vx, vy = 960, 495                             # floorboards
    for k, x in enumerate([780, 960, 1140]):
        ex = vx + (x - vx) * ((H + 30 - vy) / (BY1 - vy))
        pen.line([(x, BY1), (ex, H + 30)], f"fb{k}", width=1.4, alpha=0.45)
    pen.line([(BX0 - 90, 830), (BX1 + 90, 830)], "fbx", width=1.2, alpha=0.25)
    # the door has been in the right wall all along
    d0, d1, v0 = 0.22, 0.47, 0.26
    frame = [rwall(d0, 1), rwall(d0, v0), rwall(d1, v0), rwall(d1, 1)]
    if door > 0.01:
        c = pen.c
        c.move_to(*frame[0]); [c.line_to(*q) for q in frame[1:]]; c.close_path()
        c.set_source_rgba(*PLUM, 0.55 * door); c.fill()
        # light spilling across the floor
        a, b = rwall(d0, 1), rwall(d1, 1)
        c.move_to(*a); c.line_to(*b); c.line_to(b[0] - 900 * spill, b[1] + 60); c.line_to(a[0] - 520 * spill, a[1] - 25); c.close_path()
        g = cairo.LinearGradient(b[0], b[1], b[0] - 900, b[1])
        g.add_color_stop_rgba(0, *PLUM, 0.30 * spill); g.add_color_stop_rgba(1, *PLUM, 0)
        c.set_source(g); c.fill()
    pen.line(frame, "doorframe", width=2.2)
    # door panel swings into the room from its left hinge
    ang = door * 1.25
    def swing(v):
        h = rwall(d0, v); f = rwall(d1, v); L = f[0] - h[0]
        return (h[0] + L * math.cos(ang) - L * 0.9 * math.sin(ang), f[1] + (h[1] - f[1]) * (1 - math.cos(ang)) * 0.5 + 18 * math.sin(ang))
    panel = [rwall(d0, 1), rwall(d0, v0), swing(v0), swing(1)]
    pen.line(panel, "door", width=2.2, closed=True, fill=PAPER, fill_alpha=0.92)
    kx, ky = lerp(panel[2][0], panel[3][0], 0.62), lerp(panel[2][1], panel[3][1], 0.62)
    pen.circle(kx - 10 * (1 - door), ky, 5, "knob", width=2)

# ---------- the crooked clock: seven marks, a 2+2+3 pendulum ----------
CLK = (800, 412, 60, math.radians(-9))
def draw_clock(pen, m, bar):
    cx, cy, r, tilt = CLK; c = pen.c
    c.save(); c.translate(cx, cy); c.rotate(tilt)
    # pendulum: one swing per group, so the long group swings slow
    e = bar["eighth"]; ph = clamp((m - bar["t"]) / e, 0, 7)
    groups = [(0, 2), (2, 2), (4, 3)]
    gi = 0 if ph < 2 else 1 if ph < 4 else 2
    g0, gl = groups[gi]; u = (ph - g0) / gl
    side = 1 if (bar["i"] * 3 + gi) % 2 == 0 else -1
    th = side * 0.38 * math.cos(math.pi * u)
    if m < 0: th = 0.38
    L = 140; bx, by = L * math.sin(th), r + L * math.cos(th)
    pen.line([(0, r - 4), (bx, by)], "rod", width=2)
    pen.circle(bx, by, 15, "bob", width=2.2, fill=AMBER, fill_alpha=0.85)
    pen.circle(0, 0, r, "face", width=2.8, fill=PAPER)
    for k in range(7):
        a = 2 * math.pi * k / 7 - math.pi / 2
        pen.line([(math.cos(a) * r * 0.78, math.sin(a) * r * 0.78), (math.cos(a) * r * 0.92, math.sin(a) * r * 0.92)], f"tick{k}", width=2.2)
    # one hand steps through the seven eighths of each bar
    a = 2 * math.pi * math.floor(ph) / 7 - math.pi / 2
    pen.line([(0, 0), (math.cos(a) * r * 0.7, math.sin(a) * r * 0.7)], "hand", width=2.6)
    a2 = 2 * math.pi * (max(m, 0) / TOTAL) - math.pi / 2
    pen.line([(0, 0), (math.cos(a2) * r * 0.45, math.sin(a2) * r * 0.45)], "hand2", width=3.4)
    c.restore()

# ---------- lamps: one per pitch the melody ever sings ----------
PITCHES = []
LAMPS = {}
NOTES_BY = {}
def build_lamps():
    ps = sorted({n["midi"] for b in BARS for n in b["notes"]})
    PITCHES.extend(ps)
    rnd = random.Random(7)
    for k, p in enumerate(ps):
        x = lerp(640, 1280, k / (len(ps) - 1))
        drop = 50 - (p - ps[0]) * 1.0 + rnd.uniform(-14, 14)
        LAMPS[p] = (x, BY0 + drop)
        NOTES_BY[p] = [(n["t"], n["dur"]) for b in BARS for n in b["notes"] if n["midi"] == p]

def warmth(m):
    """The room remembers its light: a resting glow that grows, then leaves in the coda."""
    w = 0.0
    if m >= sec_start("bare"): w = 0.06
    if m >= sec_start("room"): w = lerp(0.06, 0.18, ramp(m, sec_start("room"), sec_end("room")))
    if m >= sec_start("home"): w = 0.24
    return w

def lamp_out_time(p):
    # in the coda the lamps go out one by one, high to low; the odd note goes last
    c0 = sec_start("coda") + 8.0; c1 = TOTAL - 3.0
    order = sorted(PITCHES, key=lambda q: (q == BB, -q))
    return lerp(c0, c1, order.index(p) / (len(order) - 1))

def draw_lamps(pen, m, dusk):
    c = pen.c
    for p, (x, y) in LAMPS.items():
        lit = 0.0
        for t0, d in NOTES_BY[p]:
            if t0 <= m: lit = max(lit, math.exp(-(m - t0) / (d * 0.9 + 0.35)))
        if t0 > m + 1e9: pass
        out = 1 - ramp(m, lamp_out_time(p), lamp_out_time(p) + 1.4)
        if p == BB and m > TOTAL - 3: out = lerp(0.55, 0, ramp(m, TOTAL + 0.5, TOTAL + 2.5))
        base = warmth(m) * out
        a = clamp(max(lit, base) if m < sec_start("coda") else max(lit * out, base))
        col = PLUM if p == BB else mix(AMBER, PLUM, dusk * 0.55)
        glow(c, x, y + 10, 80 + 110 * a, col, 0.8 * a)
        pen.line([(x, BY0), (x, y - 14)], f"cord{p}", width=1.4, alpha=0.8)
        pen.line([(x - 15, y + 2), (x - 8, y - 14), (x + 8, y - 14), (x + 15, y + 2)], f"shade{p}", width=2.2, closed=True,
                 fill=mix(PAPER, col, 0.15 + 0.85 * a), fill_alpha=1)
        pen.circle(x, y + 8, 5.5, f"bulb{p}", width=1.6, fill=mix(PAPER, col, a), fill_alpha=1)

# ---------- furniture, drawn in during the room section ----------
def sh(pts, dx): return [(x + dx, y) for x, y in pts]

def furniture():
    return {
        "window": [([(1060, 315), (1250, 315), (1250, 520), (1060, 520)], True),
                   ([(1155, 315), (1155, 520)], False), ([(1060, 418), (1250, 418)], False),
                   ([(1045, 528), (1265, 528)], False)],
        "rug": [([(960 + 400 * math.cos(a), 905 + 70 * math.sin(a)) for a in [2 * math.pi * k / 40 for k in range(40)]], True),
                ([(960 + 340 * math.cos(a), 905 + 52 * math.sin(a)) for a in [2 * math.pi * k / 40 for k in range(40)]], True)],
        "chair": [(sh(pts, 70), cl) for pts, cl in [
                  ([(380, 700), (440, 690), (450, 790), (600, 790), (590, 860), (370, 860)], "occlude"),
                  ([(380, 700), (370, 860), (590, 860)], False), ([(380, 700), (440, 690), (450, 790)], False),
                  ([(450, 790), (600, 790), (590, 860)], False), ([(390, 860), (395, 940)], False), ([(575, 860), (570, 940)], False),
                  ([(372, 760), (350, 772), (360, 860)], False)]],
        "table": [([(700, 770), (930, 770), (950, 790), (680, 790)], True), ([(705, 790), (712, 900)], False),
                  ([(925, 790), (918, 900)], False), ([(800, 790), (805, 862)], False)],
        "shelf": [([(630, 470), (735, 470), (735, 760), (630, 760)], True), ([(630, 565), (735, 565)], False),
                  ([(630, 660), (735, 660)], False), ([(645, 565), (645, 505), (660, 505), (660, 565)], False),
                  ([(665, 565), (672, 512), (686, 514), (680, 565)], False), ([(700, 660), (700, 605), (722, 605), (722, 660)], False)],
        "plant": [([(1195, 800), (1275, 800), (1262, 880), (1208, 880)], True), ([(1235, 800), (1205, 720), (1180, 690)], False),
                  ([(1235, 800), (1250, 700), (1265, 650)], False), ([(1235, 800), (1290, 730), (1320, 718)], False)],
    }
FURN = None
FURN_ORDER = ["window", "rug", "chair", "table", "shelf", "plant"]
HOP = {"chair": (0, 4), "table": (2,), "shelf": (6,), "plant": (5,), "rug": (), "window": ()}

def furn_frac(name, m):
    rb = SECS["room"][2]; k = FURN_ORDER.index(name)
    b = rb[k]; return ramp(m, b["t"], b["t"] + 7 * b["eighth"] * 1.4)

def hop_offset(name, m, bar):
    if bar["sec"] not in ("climb", "home") or bar["ch"] == "ebmaj7": return 0
    ph = (m - bar["t"]) / bar["eighth"]; y = 0
    for h in HOP[name]:
        u = (ph - h) / 0.9
        if 0 <= u <= 1: y = max(y, math.sin(math.pi * u) * (16 if bar["sec"] == "climb" else 22))
    return y

def draw_furniture(pen, m, bar):
    c = pen.c
    for name in FURN_ORDER:
        f = furn_frac(name, m)
        if f <= 0: continue
        dy = hop_offset(name, m, bar)
        c.save(); c.translate(0, -dy)
        for k, (pts, closed) in enumerate(FURN[name]):
            if closed == "occlude":
                if f >= 1:
                    c.move_to(*pts[0]); [c.line_to(*q) for q in pts[1:]]; c.close_path(); c.set_source_rgba(*PAPER, 1); c.fill()
                continue
            fill = PAPER if (closed and name not in ("window",)) else None
            pen.line(pts, f"{name}{k}", width=2.3, frac=f, closed=closed, fill=fill, fill_alpha=0.95)
        c.restore()

# ---------- everybody: three small inhabitants ----------
PERCH = {"table": (815, 770), "chair_seat": (590, 790), "chair_back": (480, 692), "shelf": (682, 470),
         "rug_l": (850, 905), "rug_r": (1080, 912), "sill": (1155, 528), "plant": (1236, 800)}
FOLK = [  # radius, fill, home perch, climb route, appears at room bar
    (30, AMBER, "rug_l", ["table", "chair_back", "shelf", "rug_l", "chair_seat", "table"], 5),
    (22, PAPER, "sill", ["plant", "rug_r", "table", "sill", "chair_seat", "rug_r"], 6),
    (36, mix(PAPER, PLUM, 0.35), "chair_seat", ["rug_r", "shelf", "table", "rug_l", "plant", "chair_seat"], 7),
]
HOP_GROUPS = [(0, 2), (2, 2), (4, 3)]
CROUCH, LAND = 0.14, 0.2   # seconds of squish before takeoff / after landing
TURN_PERCH = ["shelf", "sill", "rug_r"]

_HOPS = None
def plan_hops():
    """Everyone's hops in time order; nobody lands where someone else is or is going."""
    global _HOPS
    if _HOPS is not None: return _HOPS
    ev = []
    for b in SECS["climb"][2] + SECS["home"][2]:
        for idx in range(3):
            if b["ch"] == "ebmaj7":
                g = idx; fixed = TURN_PERCH[idx]
                groups = [g]
            else:
                fixed = None
                groups = [idx] if b["sec"] == "climb" else [idx, (idx + 1) % 3]
            for g in sorted(groups):
                g0, gl = HOP_GROUPS[g]
                ev.append((b["t"] + g0 * b["eighth"], gl * b["eighth"] * 0.92, idx, fixed))
    ev.sort()
    where = [FOLK[i][2] for i in range(3)]; ri = [0, 0, 0]; out = {0: [], 1: [], 2: []}
    for t0, d, idx, fixed in ev:
        if fixed: target = fixed
        else:
            route = FOLK[idx][3]
            for _ in range(len(route)):
                target = route[ri[idx] % len(route)]; ri[idx] += 1
                if target != where[idx] and target not in [where[j] for j in range(3) if j != idx]: break
        where[idx] = target; out[idx].append((t0, d, target))
    _HOPS = out; return out

def folk_state(idx, m):
    """Where creature idx is: (x, y, squash, eye_dx, eyes_open)."""
    r, _, home, route, appear = FOLK[idx]
    pos = PERCH[home]; eye = 0.0; open_ = 1.0
    climb_bars = SECS["climb"][2] + SECS["home"][2]
    # the hop sequence: creature idx hops on group idx of every climbing bar
    jumps = plan_hops()[idx]
    seq = [home] + [j[2] for j in jumps]
    k = bisect.bisect_right([j[0] for j in jumps], m) - 1
    if k >= 0:
        t0, d, _ = jumps[k]; a, b = PERCH[seq[k]], PERCH[seq[k + 1]]
        u = (m - t0) / d
        if u < 1:
            x = lerp(a[0], b[0], smooth(u)); y = lerp(a[1], b[1], u) - math.sin(math.pi * u) * (130 + 40 * (d > 0.8))
            return x, y, 1.0, (b[0] - a[0]) / 400, 1.0
        pos = b
    squash = 1.0
    if k >= 0:                                    # settling after a landing
        u = (m - (jumps[k][0] + jumps[k][1])) / LAND
        if 0 <= u < 1: squash = min(squash, 1 - 0.2 * math.sin(math.pi * u))
    if k + 1 < len(jumps):                        # gathering before the next takeoff
        u = (m - (jumps[k + 1][0] - CROUCH)) / CROUCH
        if 0 <= u < 1: squash = min(squash, 1 - 0.22 * math.sin(math.pi * u))
    # after the climbing, everyone settles home for the coda
    if m >= sec_start("coda"):
        u = ramp(m, sec_start("coda"), sec_start("coda") + 2.5)
        pos = (lerp(pos[0], PERCH[home][0], u), lerp(pos[1], PERCH[home][1], u) - math.sin(math.pi * u) * 60)
        open_ = 1 - ramp(m, sec_start("coda") + 6 + idx * 2.5, sec_start("coda") + 8 + idx * 2.5)
    # during the turn they look toward the door
    eye = lerp(eye, 0.9, ramp(m, sec_start("turn") - 1, sec_start("turn") + 1.5) * (1 - ramp(m, sec_end("turn") - 3, sec_end("turn"))))
    return pos[0], pos[1], squash, eye, open_

def draw_folk(pen, m):
    c = pen.c
    for idx, (r, fill, *_rest) in enumerate(FOLK):
        appear = FOLK[idx][4]; rb = SECS["room"][2][appear]
        a = ramp(m, rb["t"], rb["t"] + 1.2)
        if a <= 0: continue
        x, y, sq, eye, op = folk_state(idx, m)
        c.save(); c.translate(x, y); c.scale(1 / sq ** 0.5, sq)
        pen.circle(0, -r, r, f"folk{idx}", width=2.4, alpha=a, fill=fill, fill_alpha=1)
        # blink now and then
        blink = (m * 0.37 + idx * 0.61) % 1 < 0.03
        ex = clamp(eye, -1, 1) * r * 0.25
        for s in (-1, 1):
            ex0 = ex + s * r * 0.32; ey0 = -r * 1.1
            if op < 0.5 or blink:
                pen.line([(ex0 - 4, ey0), (ex0 + 4, ey0 + 1)], f"lid{idx}{s}", width=2, alpha=a)
            else:
                c.set_source_rgba(*INK, a); c.arc(ex0, ey0, 3.2, 0, 2 * math.pi); c.fill()
        c.restore()

# ---------- one frame ----------
def turn_amount(m):
    climb_last = SECS["climb"][2][-1]
    up = ramp(m, climb_last["t"], sec_start("turn") + 2.0)
    down = ramp(m, sec_end("turn") - 2 * 7 * SECS["turn"][2][-1]["eighth"], sec_end("turn"))
    return up * (1 - down)

def frame(ctx, t):
    m = t - AUDIO_OFFSET
    bar, _ = bar_at(m)
    pen = Pen(ctx, int(t * 8))                   # lines "boil" eight times a second
    dusk = turn_amount(m)
    door = max(dusk, 0.12 * ramp(m, sec_end("turn") - 1, sec_end("turn") + 2) * (1 - ramp(m, TOTAL - 6, TOTAL - 1)))
    ctx.set_source_rgb(*mix(PAPER, DUSK, dusk * 0.8)); ctx.paint()
    ctx.save()
    # a little weight on the kicks while everyone climbs
    shake = 0
    if bar["sec"] in ("climb", "home") and bar["ch"] != "ebmaj7":
        ph = (m - bar["t"]) / bar["eighth"]
        for k in (0, 4):
            if 0 <= ph - k < 0.5: shake = 4 * (1 - (ph - k) / 0.5)
    ctx.translate(W / 2, H / 2 + shake); ctx.rotate(math.radians(-3.5) * dusk); ctx.translate(-W / 2, -H / 2)
    draw_room(pen, door, dusk)
    draw_lamps(pen, m, dusk)
    draw_clock(pen, m, bar)
    draw_furniture(pen, m, bar)
    draw_folk(pen, m)
    ctx.restore()
    # title, then nothing but the room
    ta = ramp(t, 0.6, 2.2) * (1 - ramp(t, 6.5, 8.5))
    if ta > 0:
        ctx.select_font_face("DejaVu Serif", cairo.FONT_SLANT_ITALIC, cairo.FONT_WEIGHT_NORMAL)
        ctx.set_font_size(34); ctx.set_source_rgba(*INK, ta * 0.85)
        ctx.move_to(90, H - 80); ctx.show_text("The Room With The Crooked Clock")
    # open from paper, close to paper
    veil = 1 - ramp(t, 0, 1.2) + ramp(t, TOTAL + AUDIO_OFFSET + 0.5, TOTAL + AUDIO_OFFSET + 1.8)
    if veil > 0:
        ctx.set_source_rgba(*PAPER, clamp(veil)); ctx.paint()

def main():
    global TOTAL, BARS, SECS, FURN, AUDIO_OFFSET
    ap = argparse.ArgumentParser()
    ap.add_argument("timeline"); ap.add_argument("audio"); ap.add_argument("out")
    ap.add_argument("--from", dest="t0", type=float, default=0); ap.add_argument("--to", dest="t1", type=float)
    ap.add_argument("--offset", type=float, default=0.0, help="seconds of lead-in before the music")
    ap.add_argument("--still", nargs="*", type=float, help="write PNG stills at these times instead of a video")
    a = ap.parse_args()
    AUDIO_OFFSET = a.offset
    TOTAL, BARS, SECS = load(a.timeline); STARTS.extend(b["t"] for b in BARS); build_lamps(); FURN = furniture()
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H); ctx = cairo.Context(surf)
    if a.still:
        for s in a.still:
            frame(ctx, s); surf.write_to_png(f"{a.out}_{s:06.1f}.png")
        return
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.audio],
                               capture_output=True, text=True).stdout)
    t1 = min(a.t1 or dur, dur); n = int((t1 - a.t0) * FPS)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-ss", str(a.t0), "-t", str(t1 - a.t0), "-i", a.audio,
                           "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", a.out], stdin=subprocess.PIPE)
    for k in range(n):
        frame(ctx, a.t0 + k / FPS); surf.flush(); ff.stdin.write(bytes(surf.get_data()))
        if k % (FPS * 10) == 0: print(f"{a.t0 + k / FPS:6.1f}s", file=sys.stderr, flush=True)
    ff.stdin.close(); ff.wait()
    print(a.out)

if __name__ == "__main__":
    main()
