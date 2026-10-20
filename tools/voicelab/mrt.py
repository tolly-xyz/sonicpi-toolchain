#!/usr/bin/env python3
"""Rhyme-test intelligibility for klattsing/klattsch voices, scored by Whisper (harness v2).

In the spirit of the Modified Rhyme Test (House, Williams, Hecker & Kryter 1965), open response: sets of six
common monosyllables that differ only in the initial consonant (same vowel + coda: "bat cat fat hat mat sat") or
only in the final consonant (same onset + vowel: "pat pad pan pass pack path"), plus a vowel block of frames with
many vowels (b_t: "beat bit bait bet bat bot boat but bite bout ..."). The list, mrt_words.json, is generated
from CMUdict (as klattsing reads it) + wordfreq (--build-words) and is deterministic.

Rendering, carriers and grouping are pairs.py's: six words per Whisper (large-v3-turbo) call in numbered
carriers ("One: bat. Two: pin. ..."), never two words of one set in a call. A word counts as heard if a token
anywhere in its call's transcript is the word or a homophone (CMUdict, any variant, stress ignored: "be" for
"bee", "B" for "bee", "9" for "nine"). For the confusion tables the transcript is cut at its carrier numerals
("one"/"1"/"won", "two"/"2"/"to"/"too", ...) into one answer per word, and the answer token closest in phones to
the target is taken as what was heard; its onset (initial sets), coda (final sets) or vowel (vowel sets) comes
from CMUdict. Labels: "-" no consonant, "?" not a dictionary word, "_" nothing heard in the slot.

usage: mrt.py CONFIGS.json OUT.json [--limit N] [--rescore]
         CONFIGS as for pairs.py: [{"name": "...", "mode": "speak"|"sing"|"kokoro", "bank": ..., ...}, ...]
         --limit N   only the first N calls of each config (smoke tests; the entry stays "complete": false)
         --rescore   re-score the stored transcripts (no Whisper, no rendering)
       mrt.py --build-words            rewrite mrt_words.json (needs wordfreq and english-words in the venv)
       mrt.py --confusion OUT.json NAME  print that config's confusion matrices (rows target, columns heard)
       mrt.py --selftest               check the word list, grouping and scoring (no Whisper)
Resumable: every call's transcript is saved to OUT.json as it finishes; a rerun skips finished configs and
finished calls of unfinished ones.

OUT.json: {"<config name>": {
  "total": word accuracy, "n": words scored, "slot_total": accuracy counting only hits in the word's own slot,
  "types": {"initial"|"final"|"vowel": {"word": accuracy, "phoneme": accuracy of the tested onset/coda/vowel, "n"}},
  "by_phoneme": {"initial": {"P": [accuracy, n], ...}, "final": {...}, "vowel": {...}},   (word accuracy per target)
  "confusion": {"initial": {"P": {"P": 5, "B": 2, "?": 1}, ...}, "final": {...}, "vowel": {...}},  (target -> heard)
  "results": [[word, correct], ...],     per word, in call order (what stats.py pairs on)
  "detail": [[set_id, word, heard, correct], ...], "missed": ["word->heard", ...],
  "calls": [{"words": [...], "text": transcript, "render_s", "whisper_s"}, ...],
  "complete": bool, "whisper_s_per_call": mean, "render_s_per_call": mean, "config": {...}}}
"""
import collections, difflib, json, os, re, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pairs as P

WORDS = f"{HERE}/mrt_words.json"
VOWELS = set("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split())
NUMBERS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
          "seventeen eighteen nineteen twenty".split()
NUMERAL = {w: i for i, w in enumerate(NUMBERS[1:10], 1)} | {str(i): i for i in range(1, 10)} | \
          {"won": 1, "to": 2, "too": 2, "for": 4, "fore": 4, "ate": 8}   # transcript token -> the number it says

# ---------------------------------------------------------------- CMUdict, as klattsing reads it
_CMU = None
def cmu():
    """(primary, variants): primary[word] = [phones with stress] (what klattsing renders: dict/lexicon.json
    overrides, else CMUdict's first entry); variants[word] = {stressless phone tuples} of every entry."""
    global _CMU
    if _CMU: return _CMU
    src = open(f"{P.ROOT}/klattsing/node_modules/cmu-pronouncing-dictionary/index.js", encoding="utf-8").read()
    d = json.loads(src[src.index("= {") + 2:])
    lex = f"{P.ROOT}/dict/lexicon.json"
    extra = json.load(open(lex)) if os.path.exists(lex) else {}
    primary, variants = {}, collections.defaultdict(set)
    for k, v in d.items():
        w = re.sub(r"\(\d+\)$", "", k)
        if w == k: primary[w] = v.split()
        variants[w].add(bare(v.split()))
    for w, v in extra.items():
        primary[w.lower()] = v.split(); variants[w.lower()].add(bare(v.split()))
    _CMU = primary, dict(variants)
    return _CMU

def bare(phones): return tuple(re.sub(r"\d", "", p) for p in phones)

def prons(token):
    """Stressless pronunciations of a transcript token (digits read as number words)."""
    t = token.strip("'")
    if t.isdigit() and int(t) < len(NUMBERS): t = NUMBERS[int(t)]
    v = cmu()[1]
    return v.get(t) or v.get(t.replace("'", "")) or set()

def parts(phones):
    """(onset, nucleus, coda) of a stressless phone tuple: consonants before the first vowel, from the first to
    the last vowel, after the last vowel."""
    vs = [i for i, p in enumerate(phones) if p in VOWELS]
    if not vs: return phones, (), ()
    return phones[:vs[0]], phones[vs[0]:vs[-1] + 1], phones[vs[-1] + 1:]

def label(seq): return " ".join(seq) if seq else "-"

# ---------------------------------------------------------------- the word list
EXCLUDE = set("""
matt nat dat dan jan chan lan yan san wang yang lang chang zhang dang kang ben gen ken den sen chen jin lynn finn
min kin din rick mick nick vic jacques bach sam cam nam bam pam jim kim tim sim jill gill lil mel del ned ted med
jess wes ness des kate nate tate jane wayne kane shane dale yale hayes joe joan mo ho bo po lou fu mu roy choi doug
todd tom dom rom john ron juan han bon con mitch chad zach mac rex tex lex mets knicks hicks cox knox kent bart mart
mal hal val cal sid kerr der burke bert kurt kirk paul saul neil kyle nile mao dow thor jones beck raj ross russ
ruth seth beth jeff abe mike dave bob rand hank mon non sean von zeus weiss bing ming ling wong jong hong kong
pete jake chuck jack bill pat gene dean rob ray gus bud jay sue mark jean jim lee
fuck shit bitch dick dicks cock whore porn piss pissed tits shits fart damn sex gay gays jew jews rape nude poo
ass butt cum hoe hoes slut cunt fag dyke homo boob boobs
lol ms mr dr im ing ish ole nah yeah yo ya whoa ugh um un uh ha la ma pa sa ka ta da cha shah tae fe re vi chi fi
thy thee thou dos das cas cos sec nov sep dis sis ok og op os oz co yea wa ga na ye tis del
luke khan reg rev dev cass tyre weir coup mum phi kay mar pos pas sup dell rad bum hah huh kai
live lives read lead wind tear bass dove bow wound sow
""".split())                                     # names, abbreviations, offensive, heteronyms (klattsing says one)
SHORT_OK = set("be he me we go no so do by my hi".split())

def candidates():
    """Common monosyllables with primary stress: {word: (onset, vowel, coda, zipf)}, one spelling per
    pronunciation (the most frequent), none sounding like a carrier numeral."""
    from wordfreq import zipf_frequency
    from english_words import get_english_words_set
    web2 = {w for w in get_english_words_set(["web2"], lower=False, alpha=True) if w.islower()}
    def real(w):                                                 # Webster's 2nd lowercase, or an inflection of one
        return w in web2 or any(w.endswith(s) and w[:-len(s)] + a in web2
                                for s, a in [("s", ""), ("es", ""), ("ed", ""), ("d", ""), ("ies", "y")])
    primary, variants = cmu()
    carrier = set().union(*(variants[n] for n in NUMBERS[1:P.PER + 1] + ["won", "to", "too", "for", "fore"]))
    out = {}
    pool = []
    for w, ph in primary.items():
        if not re.fullmatch(r"[a-z]+", w) or w in EXCLUDE or (len(w) < 3 and w not in SHORT_OK): continue
        vs = [p for p in ph if p[:2] in VOWELS]
        if len(vs) != 1 or not vs[0].endswith("1"): continue
        z = zipf_frequency(w, "en")
        if z < 3.5 or not real(w): continue
        if variants[w] & carrier: continue
        pool.append((-z, w))
    claimed = set()
    for nz, w in sorted(pool):                                   # most frequent spelling claims its sounds
        if variants[w] & claimed: continue
        claimed |= variants[w]
        o, v, c = parts(bare(primary[w]))
        out[w] = (o, v[0], c, -nz)
    return out

def build_words(n_initial=25, n_final=25, n_vowel_frames=5, per=6):
    cand = candidates()
    used = set()
    # vowel block first (it needs the plain CVC words): frames C_C with the most vowels, spread over the vowels
    frames = collections.defaultdict(dict)
    for w, (o, v, c, z) in cand.items():
        if len(o) == 1 and len(c) <= 1 and (v not in frames[(o, c)] or frames[(o, c)][v][1] < z):
            frames[(o, c)][v] = (w, z)
    vuse, sets = collections.Counter(), []
    for _ in range(n_vowel_frames):
        key = max((k for k in frames if len(frames[k]) >= 8),
                  key=lambda k: (sum(1 / (1 + vuse[v]) for v in frames[k]), sum(z for _, z in frames[k].values()), k))
        g = frames.pop(key)
        words = sorted(((w, v) for v, (w, z) in g.items() if w not in used), key=lambda x: x[1])
        sets.append({"id": f"V:{''.join(key[0])}_{''.join(key[1])}", "type": "vowel",
                     "frame": f"{label(key[0])} _ {label(key[1])}", "words": [w for w, _ in words]})
        for w, v in words: vuse[v] += 1; used.add(w)
    # consonant sets: singleton contrast, shared part anything (final sets need an onset: no vowel-initial words)
    def groups(kind):
        g = collections.defaultdict(dict)
        for w, (o, v, c, z) in cand.items():
            if w in used: continue
            if kind == "initial" and len(o) == 1: key, k = (v, c), o[0]
            elif kind == "final" and len(c) == 1 and o: key, k = (o, v), c[0]
            else: continue
            if k not in g[key] or g[key][k][1] < z: g[key][k] = (w, z)
        return g
    for kind, n in (("initial", n_initial), ("final", n_final)):
        g, cuse, vu = groups(kind), collections.Counter(), collections.Counter()
        def pick(members):
            ms = [(k, w, z) for k, (w, z) in members.items() if w not in used]
            return sorted(ms, key=lambda m: (cuse[m[0]], -m[2], m[0]))[:per]
        for _ in range(n):
            def score(key):
                p = pick(g[key])
                if len(p) < per: return None
                vowel = key[0] if kind == "initial" else key[1]
                return (sum(1 / (1 + cuse[k]) for k, _, _ in p) - 0.6 * vu[vowel] + sum(z for *_, z in p) / 60, key)
            scored = [s for s in (score(k) for k in g) if s]
            if not scored: break
            _, key = max(scored)
            p = pick(g.pop(key))
            vowel = key[0] if kind == "initial" else key[1]
            vu[vowel] += 1
            for k, w, _ in p: cuse[k] += 1; used.add(w)
            frame = f"_ {key[0]}{' ' + label(key[1]) if key[1] else ''}" if kind == "initial" else f"{label(key[0])} {key[1]} _"
            sets.append({"id": f"{kind[0].upper()}:{frame.replace(' ', '')}", "type": kind,
                         "frame": frame, "words": [w for _, w, _ in sorted(p, key=lambda m: m[0])]})
    primary = cmu()[0]
    words = []
    for s in sets:
        for w in s["words"]:
            o, v, c = parts(bare(primary[w]))
            tested = {"initial": label(o), "final": label(c), "vowel": v[0]}[s["type"]]
            words.append({"word": w, "set": s["id"], "type": s["type"], "arpabet": " ".join(primary[w]),
                          "target": tested, "zipf": round(cand[w][3], 2)})
    doc = {"about": "Rhyme-test words for tools/voicelab/mrt.py (generated by mrt.py --build-words: CMUdict as "
                    "klattsing reads it, wordfreq Zipf >= 3.5, Webster's 2nd lowercase, hand exclusions). 'target' is "
                    "the tested onset (initial sets), coda (final sets) or vowel (vowel sets).",
           "sets": sets, "words": words}
    with open(WORDS, "w") as f:                                  # one set / word per line
        f.write('{"about": ' + json.dumps(doc["about"]) + ',\n "sets": [\n  ' + ",\n  ".join(json.dumps(s) for s in sets) +
                '],\n "words": [\n  ' + ",\n  ".join(json.dumps(w) for w in words) + ']}\n')
    cu = collections.Counter((x["type"], x["target"]) for x in words)
    print(f"{len(sets)} sets, {len(words)} words -> {WORDS}")
    for t in ("initial", "final", "vowel"):
        print(f"  {t:8s} " + " ".join(f"{k}:{n}" for (tt, k), n in sorted(cu.items()) if tt == t))
    return doc

def load_words():
    return json.load(open(WORDS))

def items():
    """(type, word, set id, target phoneme) in list order; P.groups() keys on item[2]."""
    return [(x["type"], x["word"], x["set"], x["target"]) for x in load_words()["words"]]

def groups(its):
    """pairs.py's grouping (PER words per call, never two of one set), with leftover single-set words
    (a big vowel set at the end of the pool) spread back into earlier calls that have no word of their set."""
    gs = P.groups(its)
    while len(gs) > 1 and len(gs[-1]) < P.PER // 2:
        it = gs[-1].pop()
        dest = next((g for g in gs[:-1] if len(g) < P.PER + 1 and it[2] not in {x[2] for x in g}), None)
        if dest is None: gs[-1].append(it); break
        dest.append(it)
        if not gs[-1]: gs.pop()
    return gs

# ---------------------------------------------------------------- scoring
def tokens(text): return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))

def same(word, tok):
    """Does transcript token tok say the target word (spelling, or any pronunciation = klattsing's)?"""
    t = tok.strip("'")
    if t == word or P.ok(word, t): return True
    target = bare(cmu()[0][word])
    return target in prons(t)

def slots(toks, n):
    """Cut a transcript at its carrier numerals: ({position: [answer tokens]}, [tokens before the first carrier]).
    The numerals found are aligned to 1..n (edit distance: Whisper drops one, hears "four" as "5", or an answer
    is "to"), so a misheard carrier still starts its slot; a carrier that is missing has no slot (its answer is
    in the previous one's)."""
    obs = [(i, NUMERAL[t]) for i, t in enumerate(toks) if t in NUMERAL]
    m = len(obs)
    INF = float("inf")
    d = [[INF] * (n + 1) for _ in range(m + 1)]
    d[0] = list(range(n + 1))
    for a in range(1, m + 1):
        d[a][0] = a
        for b in range(1, n + 1):
            d[a][b] = min(d[a - 1][b - 1] + (obs[a - 1][1] != b), d[a - 1][b] + 1, d[a][b - 1] + 1)
    at, a, b = {}, m, n
    while a and b:                                   # back-trace, preferring match/substitution
        if d[a][b] == d[a - 1][b - 1] + (obs[a - 1][1] != b): at[b] = obs[a - 1][0]; a -= 1; b -= 1
        elif d[a][b] == d[a - 1][b] + 1: a -= 1
        else: b -= 1
    out, ks = {}, sorted(at)
    for k, nxt in zip(ks, ks[1:] + [None]):
        out[k] = toks[at[k] + 1: at[nxt] if nxt else len(toks)]
    return out, toks[:at[ks[0]]] if ks else toks

def closeness(word, tok):
    target = bare(cmu()[0][word])
    ps = prons(tok)
    if ps: return max(difflib.SequenceMatcher(None, target, p).ratio() for p in ps) + 1
    return difflib.SequenceMatcher(None, word, tok).ratio() * 0.5

def heard_part(kind, tok):
    """The onset/coda/vowel the heard token has ('?' if it is not a dictionary word, '_' if nothing was heard)."""
    if tok is None: return "_"
    ps = prons(tok)
    if not ps: return "?"
    o, v, c = parts(_first(tok, ps))
    return {"initial": label(o), "final": label(c), "vowel": v[0] if v else "-"}[kind]

def _first(tok, ps):
    """The pronunciation klattsing would use for the token if it is a word it knows, else any of them."""
    t = tok.strip("'")
    if t.isdigit() and int(t) < len(NUMBERS): t = NUMBERS[int(t)]
    pr = cmu()[0].get(t)
    return bare(pr) if pr else sorted(ps)[0]

def score_call(chunk, text):
    """[(type, word, set, target, heard_token_or_None, correct, correct_in_own_slot, heard_part)] for one call."""
    toks = tokens(text)
    sl, head = slots(toks, len(chunk))
    hits = {t for t in toks if any(same(w, t) for _, w, *_ in chunk)}       # tokens that are some word of the call
    out = []
    for pos, (kind, w, sid, target) in enumerate(chunk, 1):
        own = sl.get(pos)
        mine = next((t for t in own or [] if same(w, t)), None)
        heard = mine or next((t for t in toks if same(w, t)), None)        # heard anywhere (pairs.py's rule)
        hit, in_slot = heard is not None, mine is not None
        if not hit:
            if own is not None: cands = own
            else:                                    # its carrier is missing: look where its answer must be
                prev = max((k for k in sl if k < pos), default=None)
                cands = [t for t in (sl[prev] if prev else head) if t not in hits]
            heard = max(cands, key=lambda t: closeness(w, t)) if cands else None
        part = target if hit else heard_part(kind, heard)
        out.append((kind, w, sid, target, heard, hit, in_slot, part))
    return out

def summarize(cfg, calls, gs):
    import numpy as np
    rows = []
    for g, c in zip(gs, calls): rows += score_call(g, c["text"])
    acc = lambda xs: round(float(np.mean(xs)), 3) if xs else None
    types, byp, conf = {}, {}, {}
    for kind in ("initial", "final", "vowel"):
        r = [x for x in rows if x[0] == kind]
        if not r: continue
        types[kind] = {"word": acc([x[5] for x in r]), "phoneme": acc([x[7] == x[3] for x in r]), "n": len(r)}
        per = collections.defaultdict(list); cm = collections.defaultdict(collections.Counter)
        for x in r: per[x[3]].append(x[5]); cm[x[3]][x[7]] += 1
        byp[kind] = {k: [acc(v), len(v)] for k, v in sorted(per.items())}
        conf[kind] = {k: dict(v.most_common()) for k, v in sorted(cm.items())}
    rs, ws = [x[5] for x in rows], [x[6] for x in rows]
    wt, rd = [c["whisper_s"] for c in calls if "whisper_s" in c], [c["render_s"] for c in calls if "render_s" in c]
    return {"total": acc(rs), "n": len(rows), "slot_total": acc(ws), "types": types, "by_phoneme": byp, "confusion": conf,
            "results": [[x[1], bool(x[5])] for x in rows],
            "detail": [[x[2], x[1], x[4] if x[4] is not None else "_", bool(x[5])] for x in rows],
            "missed": [f"{x[1]}->{x[4] if x[4] is not None else '_'}" for x in rows if not x[5]],
            "whisper_s_per_call": round(float(np.mean(wt)), 2) if wt else None,
            "render_s_per_call": round(float(np.mean(rd)), 2) if rd else None}

def show(name, e):
    t = e["types"]
    print(f"{name:28s} {e['total']:5.0%} (n={e['n']}, own slot {e['slot_total']:.0%})  " +
          "  ".join(f"{k} {v['word']:.0%} [{('onset' if k == 'initial' else 'coda' if k == 'final' else 'vowel')} {v['phoneme']:.0%}]"
                    for k, v in t.items()) + ("" if e.get("complete") else "  (partial)"), flush=True)
    off = collections.Counter()
    for kind, cm in e["confusion"].items():
        for a, row in cm.items():
            for b, n in row.items():
                if b != a: off[(kind[0], a, b)] += n
    if off: print("   confusions: " + "  ".join(f"{k}:{a}->{b} {n}" for (k, a, b), n in off.most_common(14)), flush=True)
    weak = sorted((v[0], -v[1], kind[0], k) for kind, d in e["by_phoneme"].items() for k, v in d.items() if v[1] >= 3)
    if weak: print("   weakest targets: " + "  ".join(f"{t}:{k} {a:.0%}/{-n}" for a, n, t, k in weak[:12]), flush=True)
    if e.get("whisper_s_per_call"): print(f"   {e['whisper_s_per_call']} s per Whisper call, {e['render_s_per_call']} s per render", flush=True)

# ---------------------------------------------------------------- main
MODEL = None
def model():
    """Whisper, loaded on first use (WHISPER_MODEL, WHISPER_THREADS: default all cores, as pairs.py)."""
    global MODEL
    if MODEL is None:
        import whisper, torch
        torch.set_num_threads(int(os.environ.get("WHISPER_THREADS", os.cpu_count())))
        MODEL = whisper.load_model(os.environ.get("WHISPER_MODEL", "/home/user/whisper/large-v3-turbo.pt"), device="cpu")
    return MODEL

def transcribe(x):
    """pairs.py's decoding: English, greedy, no conditioning on previous text."""
    return model().transcribe(x, language="en", temperature=0, condition_on_previous_text=False, fp16=False)["text"]

def save(report, out):
    tmp = out + ".tmp"
    with open(tmp, "w") as f: json.dump(report, f, indent=1, ensure_ascii=False)
    os.replace(tmp, out)

def selftest():
    """Checks of the word list, the grouping and the scoring (no Whisper)."""
    primary, variants = cmu()
    doc, its = load_words(), items()
    carrier = set().union(*(variants[n] for n in NUMBERS[1:P.PER + 1]))
    seen = set()
    for x in doc["words"]:
        w, ph = x["word"], bare(primary[x["word"]])
        assert " ".join(primary[w]) == x["arpabet"], w
        assert sum(p in VOWELS for p in ph) == 1 and not variants[w] & carrier and ph not in seen, w
        seen.add(ph)
    for st in doc["sets"]:
        assert len(st["words"]) == 6 or st["type"] == "vowel", st["id"]
        tgt = [x["target"] for x in doc["words"] if x["set"] == st["id"]]
        assert len(set(tgt)) == len(tgt), st["id"]                # one word per tested phoneme
    gs = groups(its)
    assert sorted(x for g in gs for x in g) == sorted(its)
    assert all(len({x[2] for x in g}) == len(g) <= P.PER + 1 for g in gs)
    sl, _ = slots(tokens("1, hum. 2, same. 3, bad. 5, mid. 5, mad. 6, glam."), 6)
    assert sl == {1: ["hum"], 2: ["same"], 3: ["bad"], 4: ["mid"], 5: ["mad"], 6: ["glam"]}, sl
    sl, head = slots(tokens("Rage, case. Three: been, four ring. Five: ten. Six: wet."), 6)
    assert head == ["rage", "case"] and sorted(sl) == [3, 4, 5, 6]
    assert same("where", "wear") and same("bee", "b") and same("ten", "10") and not same("dumb", "done")
    by = {x[1]: x for x in its}
    chunk = [by[w] for w in "hull sane than rip wrath where".split()]
    r = score_call(chunk, "One hoe. Two sane. Three then. Four rip, Five, rap. 6 wear.")
    assert [x[5] for x in r] == [False, True, False, True, False, True], r
    assert [x[7] for x in r] == ["-", "N", "DH", "P", "P", "R"], r
    assert [x[4] for x in r] == ["hoe", "sane", "then", "rip", "rap", "wear"], r
    print(f"ok: {len(doc['words'])} words in {len(doc['sets'])} sets, {len(gs)} calls")

def confusion(out, name):
    """Print a config's confusion matrices (rows: target, columns: heard)."""
    e = json.load(open(out))[name]
    for kind, cm in e["confusion"].items():
        cols = sorted({b for row in cm.values() for b in row}, key=lambda b: (b in "-?_", b))
        w = max(4, *(len(c) + 1 for c in cols))
        print(f"\n{kind} ({'onset' if kind == 'initial' else 'coda' if kind == 'final' else 'vowel'}; word accuracy "
              f"{e['types'][kind]['word']:.0%}, phoneme {e['types'][kind]['phoneme']:.0%})")
        print(" " * 6 + "".join(f"{c:>{w}}" for c in cols) + "   acc")
        for a, row in cm.items():
            n = sum(row.values())
            print(f"{a:>5} " + "".join(f"{row.get(c, '') or '.':>{w}}" for c in cols) + f"  {row.get(a, 0) / n:4.0%}")

def main(argv):
    if "--build-words" in argv: build_words(); return
    if "--selftest" in argv: selftest(); return
    if "--confusion" in argv:
        a = [x for x in argv if x != "--confusion"]; confusion(a[0], a[1]); return
    args, limit, rescore, i = [], None, False, 0
    while i < len(argv):
        if argv[i] == "--limit": limit = int(argv[i + 1]); i += 1
        elif argv[i] == "--rescore": rescore = True
        else: args.append(argv[i])
        i += 1
    if len(args) != 2: raise SystemExit(__doc__)
    cfgs, out = json.load(open(args[0])), args[1]
    import soundfile as sf
    from scipy.signal import resample_poly
    gs = groups(items())
    key = lambda g: tuple(w for _, w, *_ in g)
    todo = gs[:limit] if limit else gs
    report = json.load(open(out)) if os.path.exists(out) else {}
    for cfg in cfgs:
        name = cfg["name"]
        old = report.get(name, {})
        if old.get("complete") and not rescore: print(f"{name:28s} (done earlier)", flush=True); continue
        done = {tuple(c["words"]): c for c in old.get("calls", [])}
        calls = []                                   # (group, call) in list order
        for g in todo:
            if key(g) in done: calls.append((g, done[key(g)])); continue
            if rescore: continue
            model(); t0 = time.time()                    # (loading Whisper is not part of a call's time)
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                P.render(cfg, list(key(g)), f.name); x, sr = sf.read(f.name)
            x = resample_poly(x, 16000, sr).astype("float32")
            t1 = time.time(); text = transcribe(x).strip(); t2 = time.time()
            calls.append((g, {"words": list(key(g)), "text": text, "render_s": round(t1 - t0, 2), "whisper_s": round(t2 - t1, 2)}))
            print(f"  [{len(calls)}/{len(todo)}] {t2 - t1:4.1f}s  {' '.join(key(g)):44s} | {text}", flush=True)
            mine = {key(g) for g, _ in calls}
            report[name] = {**old, "config": cfg, "complete": False,
                            "calls": [c for _, c in calls] + [c for k, c in done.items() if k not in mine]}
            save(report, out)                        # resumable after every call
        if not calls: continue
        e = summarize(cfg, [c for _, c in calls], [g for g, _ in calls])
        report[name] = {**e, "config": cfg, "complete": len(calls) == len(gs), "calls": [c for _, c in calls]}
        save(report, out)
        show(name, report[name])

if __name__ == "__main__":
    main(sys.argv[1:])
