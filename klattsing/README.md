# klattsing

A singing and speech front end for [klattsch](../vendor/klattsch): plain text (and notes) in, a
klattsch phoneme string out. It replaces hand-written ARPABET with:

- **pronunciation**: CMUdict (134k words), overridden by `dict/lexicon.json` (`{"word": "L OW1 ER0"}`)
- **syllables and stress**: maximal-onset syllabification ("bucket" -> buh-ket), CMUdict stress
- **durations**: Klatt's segmental duration model as published in MITalk (Allen, Hunnicutt & Klatt
  1987, ch. 9, rules 2-11; checked against Festival's implementation): every factor is in
  `src/durations.js` `RULES` and can be overridden per call (`"rules": {...}`)
- **speech** (`"mode": "speak"`): rule durations, a pitch rise on stressed syllables, a fall at phrase ends
- **singing** (`"mode": "sing"`): one note per syllable; consonants keep their rule durations and sit on
  the beat, vowels fill the notes; `gate` (ms a vowel is held before silence), `hold` (share of a long
  note held anyway), `to` (glide to a note), accents on stressed syllables; `"notes": "auto"` makes a
  melody from the stress pattern

```sh
echo '{"mode":"speak","text":"Lower the bucket."}' | klattsing/bin/klattsing.mjs - out.wav
echo '{"mode":"sing","text":"Lower the bucket","bpm":168,"gate":190,
       "notes":[["E2",3],["G2",3],["F2",3],["A2",3],["G2",4]]}' | klattsing/bin/klattsing.mjs - --print
```

Spec fields: `mode`, `text`, `pitch` (speak), `rate` (speak), `notes` ([note, sixteenths, {gate, to}]
per syllable, or `"auto"`), `bpm`, `melody` (auto: `scale`, `long`, `short`, `last`), `voice`
(`speak`/`sing`/`shout`/`whisper` or klattsch directives), `bank` (`banks/*.json`), `transition`
(formant glide ms, a klattsch patch), `aspiration` (breath after P/T/K, default on), `accent`,
`dynamics` (loudness by stress, a klattsch patch; off by default), `durations` (`"v0"` for the first
reconstruction), `rules`; and the opt-in options below (`bankPatch`, `functionWords`, `intonation`,
`breathLevel`, `breathVoicing`, `pauseMs`, `accentDelta`, `phoneDur`, `coarticulation`).

## Options for optimizers (all opt-in; leaving them out gives exactly the strings from before)

| option | values (default) | effect |
| --- | --- | --- |
| `bank` | name, or an inline bank `{schemaVersion: 1, name, extends, phonemes}` | an inline bank is registered (`registerBank`) under its name (letters, digits, `_ . -` only, as `[bank=...]` requires) and selected with `[bank=name]`; it replaces any bank of that name for the rest of the process (`--serve` included) |
| `bankPatch` | `{CODE: {field: value}}` | fields changed on top of `bank` (default `klatt1980-en`) through a generated bank `<base>--<sha1 12 hex>` that extends it; the name is a hash of the patched entries, so the same patch always gives the same name. A field set to `null` is removed; an object value (`glideTo`) merges one level. A phoneme the base lacks needs a complete entry (`voicing`, `F1`-`F3`, `BW1`-`BW3`, `A1`-`A3`), else it throws |
| `functionWords` | `true` or a list of words (off) | one-syllable function words (`src/function_words.js`, 109 articles, prepositions, pronouns, auxiliaries, conjunctions, contractions) get stress 0 before the duration rules, accents and dynamics |
| `intonation` | `{accent: 2, finalFall: 3, declination: 0, questionRise: 0}` | speak: semitones up on primary stress; semitones down on a phrase's last vowel; semitones per second the base pitch drifts down (a `b` directive per syllable, reset after `.`/`!`/`?`); semitones up instead of the fall on the last vowel of a phrase ending in `?` (0 = fall as usual) |
| `aspiration` | `true` (HH), `false`, `"breath"` | `"breath"`: no HH segment; instead `h<breathLevel>` over the first `rules.aspirationMs` of the vowel after P/T/K, then the voice's own `h` again. The breath part uses `BR<vowel>`, the vowel's bank entry without its `glideTo` (a generated bank `<base>--br<hash>`), so it holds the vowel's onset formants. Same timing as HH |
| `breathLevel` | `1` | klattsch aspiration (0..1) during the breath |
| `breathVoicing` | (the vowel's) | voicing of the `BR` entries (0 = pure noise, as real aspiration) |
| `pauseMs` | `250`, or `{",": ms, ".": ms, ..., default: 250}` | speak: silence after a phrase's punctuation (times `rate`) |
| `accentDelta` | speak `{g: 0.1, t: 0}`, sing `{g: 0.15, t: 0.15}` | effort (`g`) and tilt (`t`) added over a stressed vowel (with `accent`) |
| `phoneDur` | `{PHONE: [inherent, minimum]}` ms (`src/phones.js` `DUR`) | the duration table per call, merged over `DUR` (either `durations` version, speak and sing); `tools/voicelab/climb.py durations` fits it with `rules` |
| `coarticulation` | `true` or `{degree: 2, codaDegree: (degree), curve: "out", formantCurve: (curve), cv: 60, vc: 50, burst: true, hh: true, sonorants: true, loci: {PHONE: {F1/F2/F3: [k, c]}}}` (off) | context-dependent formant trajectories (klattsch's `[CO=x]` patch, `src/coarticulation.js`): a vowel starts at each neighbouring consonant's locus-equation value `F + degree (k F + c - F)` (loci per place fitted to Kokoro; Sussman et al. 1991) and moves to its target over `cv` ms, and moves toward the next consonant's value over its last `vc` ms (`codaDegree`); HH takes the next vowel's formants (`hh`), velar bursts front before front vowels (`burst`), liquids and glides glide (`sonorants`); every transition eased out (`curve`: `out`, `cos`, `linear`). A generated bank `<base>--co<hash>` carries the loci. Timings and the string's phonemes are unchanged. The curve without the loci: klattsch's `[TC=2]` in `voice` (e.g. `"[TC=2] g0.5 t0 h0.05"`) |

Presets fitted against Kokoro by `tools/voicelab/climb.py` are spec fragments in `presets/` (merge one into a spec:
`{"mode": "speak", "text": ..., ...preset}`): `kokoro-durations.json` (`rules`, `phoneDur`, `functionWords`) and
`kokoro-voice.json` (that plus voice, prosody and `bankPatch` from the voice search).

Generated and inline banks exist only in the process that compiled the spec: `klattsing.mjs` renders and times
them itself, and a JS caller can `compileString` in the same process. A `--print` string that names one renders
elsewhere only after registering `banksFor(spec)` (`src/banks.js`) there.

### Durations, timelines, a worker

```sh
klattsing/bin/klattsing.mjs specs.json --durations          # rule durations, no rendering (fast)
klattsing/bin/klattsing.mjs specs.json --timeline [out.wav]  # klattsch phoneme times (and the WAV)
klattsing/bin/klattsing.mjs --serve --durations              # worker: one request per stdin line, one reply line
```

Both print one JSON object per spec, one per line (`[json.loads(l) for l in out.splitlines()]`):

- `--durations` / `durationsOf(spec)` (`src/compile.js`; an array of specs gives an array):
  `{"text", "words": ["the", ...], "totalMs", "phones": [{"p", "ms", "word", "syl", "stress", "asp"?}]}`:
  every phoneme of the lexicon, in order, with the duration klattsing gives it before klattsch (rate included,
  unrounded in JS, 0.001 ms in the CLI; the string rounds to 0.1 ms). `word` indexes `words`, `syl` the word's
  syllables, `stress` is the syllable's (after `functionWords`). `asp` on a vowel: the aspiration before it.
  `{"p": "pau", "ms"}`: a silence (speak: after punctuation; sing: rests, gated note ends).
  `totalMs` = sum of `ms` + `asp` = the rendered length less klattsch's 150 ms trail.
  Lookups and syllables are cached per text: 100 Harvard-sentence specs take ~3 ms per call warm (~14 ms cold),
  the CLI ~260 ms per run (mostly loading CMUdict), the `--serve` worker ~7 ms per 100-spec request.
- `--timeline` / `timelineOf(spec)` (`src/timeline.js`): `{"text", "totalMs", "offsetMs" (CLI only), "phones": [{"p", "start",
  "end", "word", "syl", "asp"?}]}` in ms, from klattsch's own schedule (`compileString`, voice 0, phoneme phrases),
  so the times the audio has. `totalMs` includes the 150 ms trail; the last phoneme ends where the fade starts.
  `asp`: the HH after P/T/K, or with `"breath"` the breath part of the vowel (named by its vowel). In a sung
  diphthong split (AY -> AA IY) each part is listed. `offsetMs`: where the line starts in the WAV (lines 0.6 s apart).
- `--serve` (with `--durations`, `--timeline` or `--print`): each stdin line is a spec or an array of specs; each
  reply is one stdout line of the same shape, or `{"error": "..."}`.

  ```python
  p = subprocess.Popen(["node", "klattsing/bin/klattsing.mjs", "--serve", "--durations"], stdin=PIPE, stdout=PIPE, text=True)
  p.stdin.write(json.dumps(specs) + "\n"); p.stdin.flush(); results = json.loads(p.stdout.readline())
  ```

**In a song**: a `KLATT` entry can be a spec Hash instead of a klattsch string; `bin/sp-klatt`
compiles them all through klattsing before rendering:

```ruby
KLATT[:line1] = { mode: "sing", text: "Lower the bucket, lower the bell", bpm: 168, gate: 190, voice: "shout",
                  notes: [["E2", 3], ["G2", 3], ["F2", 3], ["A2", 3], ["G2", 4], ["F2", 3], ["E2", 3], ["D2", 6], ["E2", 4]] }
```

**Measuring** (`tools/voicelab/`): `pairs.py` (139 words in minimal-pair sets after Kent et al. 1989,
per contrast class) and `sentences.py` (Harvard sentences, word error rate), both scored by Whisper
large-v3-turbo with Kokoro TTS as the ceiling. Change a rule or the engine, run both, keep what helps.
