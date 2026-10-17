# Report moments when two seated inhabitants overlap.
# usage: checkfolk.py TIMELINE.json
import sys, math, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
path = sys.argv[1]; sys.argv = ["draw.py"]; import draw
draw.TOTAL, draw.BARS, draw.SECS = draw.load(path); draw.STARTS.extend(b["t"] for b in draw.BARS)
bad = {}
m = 0.0
while m < draw.TOTAL:
    st = [draw.folk_state(i, m) for i in range(3)]
    for i in range(3):
        for j in range(i + 1, 3):
            ri, rj = draw.FOLK[i][0], draw.FOLK[j][0]
            d = math.hypot(st[i][0] - st[j][0], (st[i][1] - ri) - (st[j][1] - rj))
            if d < (ri + rj) * 0.9: bad.setdefault((i, j), []).append(m)
    m += 0.05
for (i, j), ts in bad.items():
    runs = []; 
    for t in ts:
        if runs and t - runs[-1][1] < 0.11: runs[-1][1] = t
        else: runs.append([t, t])
    long_runs = [(round(a, 1), round(b - a, 2)) for a, b in runs if b - a > 0.3]
    print(i, j, "overlaps >0.3s:", long_runs)
print("done")
