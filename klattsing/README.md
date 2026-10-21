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
`breathLevel`, `breathVoicing`, `pauseMs`, `accentDelta`, `phoneDur`, `glottal`).

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
| `glottal` | `true`, or `{rd: 1, rdEffort: 6, tilt: 0, jitter: 0.5, shimmer: 5, aspMod: 1, flutter: 0, aspTilt: 0, noiseTilt: 15}` (fields over these; `null` keeps one) (off) | an LF voice source instead of klattsch's Rosenberg pulse, with Klatt's low-passed noise (a klattsch patch, below): `[GS=1] [RD=..] [RDE=..] [TL=..] [JIT=..] [SHIM=..] [AM=..] [FL=..] [AT=..] [NT=..]` after the bank and `TR`, before the voice |

### The LF voice source (`glottal`)

klattsch's Rosenberg pulse closes abruptly, so its spectrum falls only ~6 dB/oct and the voice is buzzy and too
bright; its noise is white, so fricatives, bursts and HH are brighter still. On the Kokoro corpus (long-term
spectra of aligned phones, each class levelled at 200-1000 Hz) the base voice's vowels are 12.5 dB over Kokoro at
2-4 kHz and 14.4 dB at 4-8 kHz, and against the vowels its fricatives are 15-19 dB too strong at 2-8 kHz, its stops up to 19.
`glottal` switches the engine to a Liljencrants-Fant flow derivative (Fant, Liljencrants & Lin 1985) whose
exponential return phase rolls the source off above Fa = F0 / (2 pi Ra): ~-12 dB/oct over 1-4 kHz at Rd >= 0.7, and
low-passes the frication noise as Klatt's synthesizers do. Fields (directive; engine default when absent):

- `rd` (`RD`; 1): Fant's (1995) shape parameter at effort 0.5, which sets Ra, Rk, Rg (0.3 pressed .. 1 modal ..
  2.7 lax/breathy). Lower is brighter: relative to 200-1000 Hz, Rd 0.5 is ~8 dB brighter at 2-4 kHz than Rd 1 (and
  the Rosenberg pulse 12 dB). Above ~1.3 the pulse gets weaker against the breath noise, so the voice does not get
  darker in practice.
- `rdEffort` (`RDE`; 6): octaves Rd falls per unit of klattsch effort (`g`) above 0.5. The speak voice is g0.5 and
  accents add g0.1, so stressed vowels get Rd 0.66: a flatter tilt on stress (spectral balance as a stress cue,
  Sluijter & van Heuven 1996); shout (g0.8) is pressed, whisper (g0.25) lax. 0 decouples it.
- `tilt` (`TL`; 0): extra tilt of the voiced source in dB at 3 kHz, a one-pole low-pass (KLSYN88's TL, Klatt &
  Klatt 1990).
- `jitter`, `shimmer` (`JIT`, `SHIM`; 0): local cycle-to-cycle perturbation of period and amplitude in % (per-
  period normal draws with sd = value / 1.128, so the mean absolute difference of neighbours is the value). The
  period is drawn at each glottal closure, so the closure-to-closure periods (what Praat measures) carry it:
  Praat's local jitter / shimmer of a steady AA (h0.05) is 0.45 / 5.5 % at the defaults 0.5 / 5 (0.6 / 4.6 % at 0.7 / 4;
  without them 0.11 / 1.9 %). Inside the corpus vowels (Praat, middle 80%) Kokoro measures 1.27 / 8.1 %, klattsch
  1.74 / 4.2 % with none (its in-vowel F0 glides) and 1.76 / 6.2 % at 0.7 / 4, hence a low jitter and a shimmer at
  the top of the usual 3-5 %.
- `aspMod` (`AM`; 0): pitch-synchronous noise: while voiced, the noise (the `h` aspiration, and the frication of a
  voiced fricative) is scaled by (1 - a) + a u, u the glottal flow over its peak and a = `aspMod` x voicing, at the
  same mean power (Klatt 1980 and KLSYN88 halve the noise in the second half of each voiced period; turbulence follows
  the flow). Voiceless noise (HH, S, bursts) stays steady.
- `flutter` (`FL`; 0): KLSYN88's slow F0 wander, (FL/50)(F0/100)(sum of 12.7, 7.1, 4.7 Hz sines) Hz.
- `noiseTilt` (`NT`; 0): the frication noise (klattsch's `(1 - voicing)` noise: fricatives, bursts, HH) through a
  one-pole low-pass, dB down at 3 kHz (unity at DC). Klatt's noise generator "tilts down the noise spectrum by a
  soft low-pass filter" (y = x + 0.75 y1 at 10 kHz, ~15 dB down at 3 kHz; Klatt 1980, KLSYN88); klattsch's is white.
- `aspTilt` (`AT`; 0): the same for the aspiration (`h`) noise; left at 0 (tilting it made vowels less Kokoro-like).

The pulse is scaled to the Rosenberg pulse's peak flow, so low frequencies (loudness) stay where they were and only
the highs move; timing and the string's phonemes are unchanged. On the 100-sentence Kokoro corpus (`fidelity.py
--audio`, durations preset + `mitalk-bursts`): score 0.367 -> 1.039 (spec -0.26 -> +1.65), MCD 4.79 -> 3.98 dB,
mcd_cmn 3.73 -> 3.66, mcd_static 2.95 -> 1.50; vowels at 2-4 / 4-8 kHz +3.5 / +4.9 dB over Kokoro instead of +12.5 /
+14.4. Of that, the LF pulse alone (`noiseTilt: 0`) gives 0.575 (MCD 4.37, but mcd_cmn 3.88: darker vowels next to
klattsch's bright noise widen the vowel-consonant contrast); the noise tilt brings the consonants along. F and SH,
already dark in the banks, get worse (per-phone MCD +0.6 / +1.1 dB); S, T, K, P, HH, DH, V improve. Whisper minimal
pairs (`tools/voicelab/pairs.py`, 139 words): 46.8% -> 46.0%, McNemar p = 1 (10 vs 9 discordant; fricatives 15% ->
15% with none discordant); an earlier LF-only version also tied (46.8% both).

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
