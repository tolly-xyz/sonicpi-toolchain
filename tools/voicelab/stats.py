#!/usr/bin/env python3
"""Is config B really more intelligible than config A? Per-word Whisper results of pairs.py or mrt.py.

  - accuracy with a bootstrap 95% CI (percentile; resampling words, or whole sets with --by-set)
  - paired comparison on the words both configs were scored on: McNemar's exact test (two-sided binomial test
    on the discordant words: b = A right & B wrong, c = A wrong & B right) and a paired-bootstrap 95% CI of B - A,
    overall and per set type (mrt: initial/final/vowel; pairs: contrast class)

usage: stats.py OUT.json                            every config in OUT.json with its CI
       stats.py OUT.json "config A" "config B"      the two, and the paired test
  options: --boot N (10000)  --seed S (0)  --by-set (cluster bootstrap over rhyme/minimal sets)  --json
       stats.py --selftest
  a config may live in another file: "other.json:config B" (it must have been scored on the same word list).
Reads "results": [[word, correct], ...] (mrt.py, and pairs.py from now on); older pairs.py reports only have
"missed": then the per-word results are rebuilt from pairs.py's call order (exact totals, but which occurrence of
a repeated word was missed is a guess).
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

def pairs_order():
    import pairs as P
    return [(cls, w, sid) for g in P.groups(P.items()) for cls, w, sid in g]

def per_word(entry):
    """[(key, correct, set_id, type)] where key = (word, its n-th occurrence) and set_id/type may be None."""
    note = None
    if "detail" in entry:                                        # mrt.py
        kinds = {"I": "initial", "F": "final", "V": "vowel"}
        rows = [(w, bool(c), sid, kinds.get(sid.split(":")[0], sid)) for sid, w, _, c in entry["detail"]]
    else:                                                        # pairs.py
        order = pairs_order()
        if "results" in entry:
            res = [(w, bool(c)) for w, c in entry["results"]]
            if [w for w, _ in res] == [w for _, w, _ in order]:
                rows = [(w, c, sid, cls) for (w, c), (cls, _, sid) in zip(res, order)]
            else: rows = [(w, c, None, None) for w, c in res]; note = "results don't follow pairs.py's current order: no sets"
        elif "missed" in entry:                                  # call order, or (one word per call) list order
            import pairs as P
            missed = [m.split("->")[0] for m in entry["missed"]]
            for order in (order, P.items()):
                i, rows = 0, []
                for cls, w, sid in order:
                    miss = i < len(missed) and missed[i] == w
                    rows.append((w, not miss, sid, cls)); i += miss
                if i == len(missed): break
            else: raise ValueError("can't rebuild per-word results: 'missed' follows neither pairs.py's call nor list order")
            note = "per-word results rebuilt from 'missed'"
        else: raise ValueError("no per-word results in this entry")
    seen, out = {}, []
    for w, c, sid, kind in rows:
        n = seen.get(w, 0); seen[w] = n + 1
        out.append(((w, n), c, sid, kind))
    return out, note

def mcnemar(b, c):
    """Two-sided exact McNemar p: P(X <= min(b,c)) * 2 for X ~ Binomial(b + c, 1/2), capped at 1."""
    n = b + c
    if n == 0: return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n)

def draws(rows, boot, seed, by_set):
    """Bootstrap index sets: (boot x m) indices into clusters, and the clusters (lists of row indices)."""
    if by_set and all(r[2] for r in rows):
        sets = {}
        for i, r in enumerate(rows): sets.setdefault(r[2], []).append(i)
        clusters = list(sets.values())
    else: clusters = [[i] for i in range(len(rows))]
    rng = np.random.default_rng(seed)
    return rng.integers(0, len(clusters), (boot, len(clusters))), clusters

def boot_acc(vals_list, rows, boot, seed, by_set):
    """Percentile 95% CIs of the mean of each value array in vals_list (same resamples for all: paired)."""
    idx, clusters = draws(rows, boot, seed, by_set)
    size = np.array([len(c) for c in clusters], float)
    out = []
    for vals in vals_list:
        s = np.array([vals[c].sum() for c in clusters], float)
        means = s[idx].sum(1) / size[idx].sum(1)
        out.append([float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))])
    return out

def load(default, ref):
    path, name = default, ref
    if ":" in ref:
        p, n = ref.split(":", 1)
        if p.endswith(".json") and os.path.exists(p): path, name = p, n
    rep = json.load(open(path))
    if name not in rep: raise SystemExit(f"{name!r} not in {path} (has: {', '.join(rep)})")
    return name, rep[name]

def single(name, entry, boot, seed, by_set):
    rows, note = per_word(entry)
    v = np.array([r[1] for r in rows], float)
    lo, hi = boot_acc([v], rows, boot, seed, by_set)[0]
    return {"name": name, "acc": float(v.mean()), "ci95": [lo, hi], "n": len(rows), "note": note,
            "complete": entry.get("complete", True)}

def compare(a, b, boot, seed, by_set):
    try: ra, na = per_word(a[1]); rb, nb = per_word(b[1])
    except ValueError as err: raise SystemExit(str(err))
    A = {r[0]: r for r in ra}; B = {r[0]: r for r in rb}
    keys = [k for k in A if k in B]
    rows = [A[k] for k in keys]
    va = np.array([A[k][1] for k in keys], float); vb = np.array([B[k][1] for k in keys], float)
    out = {"a": a[0], "b": b[0], "n_paired": len(keys), "unpaired": [len(A) - len(keys), len(B) - len(keys)],
           "notes": [x for x in (na, nb) if x]}
    def block(sel):
        ka, kb = va[sel], vb[sel]
        bb, cc = int(((ka == 1) & (kb == 0)).sum()), int(((ka == 0) & (kb == 1)).sum())
        return {"n": int(sel.sum()), "acc_a": float(ka.mean()), "acc_b": float(kb.mean()), "diff": float(kb.mean() - ka.mean()),
                "a_only": bb, "b_only": cc, "p_mcnemar": mcnemar(bb, cc)}
    allsel = np.ones(len(keys), bool)
    out["all"] = block(allsel)
    ci = boot_acc([va, vb, vb - va], rows, boot, seed, by_set)
    out["all"].update(ci_a=ci[0], ci_b=ci[1], ci_diff=ci[2])
    kinds = [r[3] for r in rows]
    out["types"] = {k: block(np.array([x == k for x in kinds])) for k in dict.fromkeys(kinds) if k}
    return out

def selftest():
    assert mcnemar(0, 0) == 1 and mcnemar(5, 5) == 1 and abs(mcnemar(0, 6) - 0.03125) < 1e-12
    assert abs(mcnemar(3, 20) - 2 * (1 + 23 + 253 + 1771) / 2 ** 23) < 1e-15
    a = {"results": [["x", True], ["y", False], ["x", False]] + [[f"w{i}", i % 2 == 0] for i in range(40)]}
    b = {"results": [["x", True], ["y", True], ["x", True]] + [[f"w{i}", True] for i in range(40)]}
    r = compare(("a", a), ("b", b), 2000, 0, False)
    assert r["n_paired"] == 43 and r["all"]["a_only"] == 0 and r["all"]["b_only"] == 22
    lo, hi = r["all"]["ci_diff"]
    assert lo > 0.3 and hi < 0.7 and r["all"]["p_mcnemar"] < 1e-5, r["all"]
    print("ok")

def main(argv):
    if "--selftest" in argv: selftest(); return
    opts = {"--boot": 10000, "--seed": 0}
    args, flags, i = [], set(), 0
    while i < len(argv):
        if argv[i] in opts: opts[argv[i]] = int(argv[i + 1]); i += 2; continue
        if argv[i].startswith("--"): flags.add(argv[i])
        else: args.append(argv[i])
        i += 1
    boot, seed, by_set, as_json = opts["--boot"], opts["--seed"], "--by-set" in flags, "--json" in flags
    if len(args) not in (1, 3): raise SystemExit(__doc__)
    unit = "sets" if by_set else "words"
    if len(args) == 1:
        rep = json.load(open(args[0]))
        res = []
        for n, e in rep.items():
            try: res.append(single(n, e, boot, seed, by_set))
            except ValueError as err: print(f"{n:32s} skipped: {err}", file=sys.stderr)
        if as_json: print(json.dumps(res, indent=1)); return
        for r in res:
            print(f"{r['name']:32s} {r['acc']:6.1%}  [{r['ci95'][0]:.1%}, {r['ci95'][1]:.1%}]  n={r['n']}"
                  + ("" if r["complete"] else "  (partial)") + (f"  ({r['note']})" if r["note"] else ""))
        print(f"(95% percentile bootstrap over {unit}, {boot} resamples)")
        return
    a, b = load(args[0], args[1]), load(args[0], args[2])
    r = compare(a, b, boot, seed, by_set)
    if as_json: print(json.dumps(r, indent=1)); return
    x = r["all"]
    print(f"A {r['a']:32s} {x['acc_a']:6.1%}  [{x['ci_a'][0]:.1%}, {x['ci_a'][1]:.1%}]")
    print(f"B {r['b']:32s} {x['acc_b']:6.1%}  [{x['ci_b'][0]:.1%}, {x['ci_b'][1]:.1%}]")
    print(f"B - A  {x['diff'] * 100:+.1f} pts  [{x['ci_diff'][0] * 100:+.1f}, {x['ci_diff'][1] * 100:+.1f}]  (paired bootstrap over {unit})")
    print(f"McNemar exact: n={x['n']}, only A right {x['a_only']}, only B right {x['b_only']}, p = {x['p_mcnemar']:.4g}")
    if r["unpaired"] != [0, 0]: print(f"  (unpaired words left out: A {r['unpaired'][0]}, B {r['unpaired'][1]})")
    for n in r["notes"]: print(f"  ({n})")
    if len(r["types"]) > 1:
        for k, t in r["types"].items():
            print(f"  {k:18s} {t['acc_a']:5.0%} -> {t['acc_b']:5.0%}  ({t['diff'] * 100:+5.1f})  n={t['n']:3d}  "
                  f"A-only {t['a_only']:2d}  B-only {t['b_only']:2d}  p={t['p_mcnemar']:.3g}")

if __name__ == "__main__":
    main(sys.argv[1:])
