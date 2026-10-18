# Headless Sonic Pi toolchain

Write music as Sonic Pi code, render it to mp3/wav without a GUI or sound card,
add sung/spoken parts with [klattsch](https://github.com/tgies/klattsch), mix with
real drum and guitar samples, and draw a video in time with the score.

## Setup (Ubuntu 24.04)

```sh
./install.sh          # apt packages + a .venv with the Python mixing/drawing deps
bin/sp-start          # boots JACK (dummy driver, no sound card) and the Sonic Pi server
bin/sp-render songs/demo.rb out/demo.mp3 -d 12
```

`sp-start` is safe to rerun; `bin/sp-stop` shuts everything down. The headless server
uses Sonic Pi's usual ports (4557/4558), so close the Sonic Pi GUI first. On a desktop
running PipeWire/PulseAudio, the dummy JACK server may need `pw-jack` or stopping
PipeWire's JACK shim; on a server or container it just works.

## Tools (`bin/`)

| Tool | What it does |
|------|--------------|
| `sp-start`, `sp-stop` | Start/stop JACK + the Sonic Pi 3.2 server, headless. |
| `sp-render SONG.rb OUT.mp3 -d SECS [-t TAIL] [-p CODE]` | Run the song for `-d` seconds (real time), let reverb ring for `-t`, save mp3 or wav. Prints Sonic Pi errors and exits non-zero on errors or a silent take (Sonic Pi 3.2 reports error lines one lower than the file's). `-p` prepends Ruby, e.g. `-p "SOLO = [:gtr]"`. |
| `sp-klatt SONG.rb` | Renders a song's klattsch voices (see below). `sp-render` runs it for you. |

Songs can read `SP_ROOT` (this folder) to find files, e.g. `sample "#{SP_ROOT}/work/..."`.

Rendering is real time. Pieces made of `live_loop`s never end on their own, so `-d`
decides the length; songs written as a fixed plan (like the ones here) stop by themselves.

## Vocals with klattsch

Put a table of klattsch phoneme strings between these markers in a song and play them
with `sample klatt(:name)`:

```ruby
# ---- klattsch voices
KDIR = "#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/my_song/kvox"
KLATT = {
  hello: "bE3 r200 ( HH AH ) ( L OW )",      # two sung syllables on E3, 200 ms each
}
# ---- end klattsch voices
def klatt(name) = "#{KDIR}/#{name}.wav"
```

`sp-klatt` evaluates just that block (plain Ruby, so you can compute `r` from your tempo,
see `songs/silt_psalm.rb`), renders each changed entry with the bundled klattsch,
and caches the WAVs. Rendering happens before playback so Sonic Pi's timing is untouched.
klattsch syntax: `b` pitch (Hz or note name), `r` ms per phoneme or per `( group )`,
`v`/`w` vibrato depth/rate, `h` breathiness, `g` effort, `t` tilt, `s` vocal-tract scale,
`AY+20` / `AY(+20)` pitch glides, `[voice=N]` harmony. Full details: `vendor/klattsch/`.

## Songs and projects

| Song | Build |
|------|-------|
| `songs/demo.rb` | `bin/sp-render songs/demo.rb out/demo.mp3 -d 12` |
| `songs/the_room.rb`: *The Room With The Crooked Clock* (7/8, D major) | `projects/the_room/build.sh` makes `out/the_room.mp3` and the video `out/the_room.mp4` |
| `songs/radiator_teeth.rb`: *Radiator Teeth*, the instrumental, pure Sonic Pi | `bin/sp-render songs/radiator_teeth.rb out/radiator_teeth.mp3 -d 74 -t 5` |
| `songs/silt_psalm.rb`: *Silt Psalm*, the same music with words: stems + mix + klattsch vocals | `projects/silt_psalm/build.sh` (all stems, ~9 min), `build.sh vox` (one stem), `build.sh mix` (remix only), `build.sh video` (remix + the video, ~20 min), or `VIDEO=1 build.sh` for everything |

**The Room** — `draw.py` reads the bar/note timeline exported from the song
(`timeline.rb`) and draws every frame with cairo, piping them into ffmpeg with the
audio. `--still 25 60` writes PNGs instead of a video for quick looks;
`checkfolk.py work/the_room/timeline.json` checks the inhabitants never share a perch.
Songs written as a `PLAN` of bars support rehearsal: prepend
`FROM_BAR = 20; TO_BAR = 28; SOLO = [:piano]` with `sp-render -p`.

**Silt Psalm** — Sonic Pi renders synth stems (two guitar takes for left/right,
bass, lead, fx, vocals), each starting with a sync click that `mix.py` aligns on.
`mix.py` then builds sample-accurate parts from the same timeline: drums from the
Hydrogen *Black Pearl* kit with velocity layers, recorded guitar strums from
*belofilms_GuitarStrums* through an amp chain, organ and choir via FluidSynth and the
MuseScore soundfont, and mixes/masters everything with Spotify's `pedalboard`. Each part
is leveled to a target loudness (`parts` in `mix.py`), so balance changes are one number.
Parts duck each other where they collide: the bass under the kick, the guitars' and kit's
presence band under the voice. Sections are ridden in level (`ride`), lows under 120 Hz are kept
mono, and the master leaves headroom, glues lightly, then makes up to `LUFS` into a limiter
that only catches hits (the sum of the parts runs ~4 dB over full scale, so limiting it hard
flattens every section to the same loudness).

**Video** — `projects/silt_psalm/draw.py`: one body of water for the whole song, simulated
(a 2D stable-fluids solver carrying ~110k grains of silt) and driven by the score. Kicks stir
vortices and snares shear; the voice lights the water; the stammering bars freeze it; the
chorus lets everything settle onto a hidden arch; the breakdown dissolves it; the blast pulls
the camera back a step per bar; the last verse turns gravity around; after the seizure one
grain is left. The section-by-section plan is in the file's docstring. `--still 37 52` writes
PNGs (it simulates from the start, so late stills take a couple of minutes). The previous
zine-style renderer is in git history (commit 5105a00).

## Inspecting vocals (`tools/vox-inspect/`)

```sh
ruby tools/vox-inspect/dump_klatt.rb SONG.rb > work/table.json          # the song's KLATT table
node tools/vox-inspect/timing.mjs < work/table.json > work/timing.json  # every phoneme's start/end (ms)
node tools/vox-inspect/pitches.mjs "E F G A Bb B C D" < work/table.json  # the notes each phrase sings; flags off-scale ones
.venv/bin/python tools/vox-inspect/plot.py work/timing.json KVOX_DIR out.png [names]   # waveform + spectrogram + phonemes
.venv/bin/pip install pocketsphinx                                       # once, for:
.venv/bin/python tools/vox-inspect/phones.py KVOX_DIR 'shout=T IY TH IH N'   # what a recognizer hears
```

`mix.py OUT --parts DIR` also writes each processed part (e.g. `vox.wav`) as it sits in the mix.
Lessons from tuning these vocals: avoid `( groups )` for speech (they split time evenly, so
consonants eat the vowels); give each phoneme its own `r`; keep stops (P B T D K G) short,
since klattsch renders them as closure silence plus a 25 ms burst; keep `h` (breath) low enough
for formants to show; use stress marks, falling pitch deltas, scoops and late-blooming vibrato
for life. `songs/silt_psalm.rb` has a `syl_ms` helper that does this on a beat grid,
with every pitch and glide named as a note (klattsch moves are in Hz; `d(from, to)` converts),
so the melody can't drift off the key. Scale vibrato and scoops with the note, too: fixed-Hz
values get proportionally wider an octave down.
Put the vowel, not the consonant, on the beat: `sing` borrows each syllable's onset consonants
from the end of the previous slot and records the line's lead in `LEAD`, and the song starts each
sample that much early (`voice_in`, a negative `time_warp`). Accents are relative `g+`/`t+`
around a vowel (the `!` stress adds a fixed +8 Hz, which is nearly two semitones on E2). For a
double-track, render the line again with a slightly different voice and a few cents off
(`DETUNE`), and play it 15 ms late, panned.

## Gotchas handled by sp-render

- Sonic Pi keeps Ruby constants between runs (a `SOLO` would leak into the next song):
  every render clears the constants the previous one defined.
- Sonic Pi caches samples by path for the server's lifetime (a re-rendered klattsch phrase
  would play its old take): every render flushes the sample cache.
- A silent take (code that never ran) fails the render instead of producing an empty file.

## Layout

```
bin/        the tools
songs/      Sonic Pi scores
projects/   per-song build scripts, mixers, video drawing
vendor/     klattsch (MIT, Tony Gies), vendored unmodified
tools/      vocal inspection helpers
work/       renders, stems, caches (safe to delete)
out/        finished audio/video
```

Versions this was built and tested with: Sonic Pi 3.2.2 (Ubuntu's package),
SuperCollider 3.13, Node 18+ for klattsch, Python 3.12+.
