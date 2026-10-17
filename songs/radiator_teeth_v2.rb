# Radiator Teeth (v2: synth stems for an outside mix)
# E phrygian with a tritone stuck in its throat. Bars keep losing a sixteenth.
#
# Prepend `SOLO = [:gtr]` (or :bass, :lead, :fx) and `TAKE = 2` to render one stem.
# A click sounds at time 0 and the song starts exactly four beats later, so stems line up.

use_debug false
set_sched_ahead_time! 2

RIFF_A = [0, 0, nil, 0,  1, nil, 0, 6,  nil, 0, 3, 0,  1, nil, 7, 6]
RIFF_B = [0, nil, nil, 0, nil, nil, 1, nil, nil, 0, nil, nil, 6, nil, 5, 3]
RIFF_D = [0, nil, nil, nil, nil, nil, nil, nil, -1, nil, nil, nil, nil, nil, -6, nil]

E = :e1
PLAN = []
def bars(sec, n, riff, opts = {})
  n.times do |k|
    steps = opts[:short] && (k % 4 == 3) ? 15 : 16
    steps = 14 if opts[:shorter] && k.odd?
    PLAN << { sec: sec, riff: riff, steps: steps, bpm: opts[:bpm] || 168, root: note(E) + (opts[:up] || 0),
              k: k, n: n, stutter: opts[:stutter] && k == n - 1 }
  end
end

bars :intro,  4, nil
bars :a,      8, RIFF_A, stutter: true
bars :a2,     8, RIFF_A, short: true
bars :b,      8, RIFF_B, stutter: true
bars :down,   6, RIFF_D
bars :blast,  8, RIFF_A, bpm: 184, up: 6, shorter: true
bars :a3,     6, RIFF_A, bpm: 176, short: true
bars :end,    2, RIFF_A, bpm: 176
PLAN << { sec: :tail, riff: nil, steps: 16, bpm: 176, root: note(E), k: 0, n: 1 }
# ---- end of score (timeline.rb reads everything above this line) ----

ONLY = defined?(SOLO) ? SOLO : nil
TK = defined?(TAKE) ? TAKE : 1
use_random_seed 600 + TK

use_bpm 168
load_sample :elec_tick                      # loaded ahead so the click itself is never late
sleep 1
sample :elec_tick, amp: 3                   # sync click
sleep 4

def layer(name, &blk)
  return if ONLY && !ONLY.include?(name)
  in_thread do
    PLAN.each_with_index do |bar, i|
      use_bpm bar[:bpm]
      in_thread { blk.call(bar, i) }
      sleep bar[:steps] * 0.25
    end
  end
end
def each_step(bar)
  bar[:steps].times { |s| yield s; sleep 0.25 }
end
def loose; rrand(0, 0.012 * TK); end         # the second take drags a hair

# ---------- fx: the screaming pipes, the seizure, the last scream ----------
# the pipes groan awake: the screech an octave down, a growl an octave under it, all overdriven
with_fx :level, amp: 2 do
with_fx :lpf, cutoff: 100 do
  with_fx :distortion, distort: 0.95 do
    with_fx :krush, gain: 8, cutoff: 95, res: 0.4 do
      with_fx :ring_mod, freq: 31, mix: 0.45 do
        layer(:fx) do |bar, i|
          next unless bar[:sec] == :intro
          s = play note(:e3) + i * 3, synth: :zawa, attack: 0.5, sustain: 3, release: 0.5, amp: 0.12 + i * 0.05,
                   cutoff: 80 + i * 6, res: 0.85, phase: 0.25, note_slide: 3.5, wave: 1
          control s, note: note(:bb3) + i * 3
          g = play note(:e2) + i * 3, synth: :growl, attack: 0.4, sustain: 3, release: 0.6, amp: 0.25 + i * 0.07,
                   cutoff: 75 + i * 5, res: 0.6, note_slide: 3.5
          control g, note: note(:bb2) + i * 3
        end
      end
    end
  end
end
end
with_fx :bitcrusher, bits: 6, sample_rate: 6000 do
  layer(:fx) do |bar, i|
    next unless bar[:sec] == :intro
    hits = (0..15).to_a.shuffle.take(2 + i * 2)
    each_step(bar) do |s|
      sample :drum_heavy_kick, amp: 0.8, rate: 0.9 + rand(0.2) if hits.include?(s)
      sample :elec_hi_snare, amp: 0.5, rate: 0.7 if i == 3 && s >= 12
    end
  end
  layer(:fx) do |bar, i|
    next unless bar[:sec] == :end && bar[:k] == 1
    t = 0.25; n = bar[:root]
    while t > 0.03
      play [n + 12, n + 19], synth: :dsaw, amp: 0.4, release: t * 0.5, detune: 0.3
      sleep t; t *= 0.82
    end
  end
end
with_fx :reverb, room: 0.9, mix: 0.6 do
  with_fx :distortion, distort: 0.9 do
    layer(:fx) do |bar, i|
      next unless bar[:sec] == :tail
      s = play :e5, synth: :zawa, amp: 0.35, attack: 0.02, release: 3.5, cutoff: 110, res: 0.95, note_slide: 3
      control s, note: :bb3
    end
  end
end

# ---------- guitars (left take 1, right take 2) ----------
with_fx :krush, gain: 4, cutoff: 115, res: 0.25, mix: 0.5 do
  with_fx :distortion, distort: 0.93 do
    layer(:gtr) do |bar, i|
      next unless bar[:riff] && bar[:sec] != :down
      next if bar[:sec] == :end && bar[:k] == 1
      each_step(bar) do |s|
        off = bar[:riff][s % 16]
        if bar[:stutter] && s >= 12
          r0 = (s - 12) * 4
          in_thread { 4.times { |r| play bar[:root] + 12 + r0 + r, synth: :dsaw, detune: 0.2 + 0.08 * TK, amp: 0.5, release: 0.04; sleep 0.0625 } }
          next
        end
        next if off.nil?
        n = bar[:root] + 12 + off
        time_warp loose do
          play [n, n + 7, n + 12], synth: :dsaw, detune: 0.2 + 0.08 * TK, amp: 0.5, attack: 0, sustain: 0.12, release: 0.06, cutoff: 110
        end
      end
    end
    # breakdown chugs that sag as they ring
    layer(:gtr) do |bar, i|
      next unless bar[:sec] == :down
      each_step(bar) do |s|
        off = bar[:riff][s]
        next if off.nil?
        n = bar[:root] + 12 + off
        [0, 6, 12].each do |iv|
          c = play n + iv, synth: :dsaw, detune: 0.3 + 0.1 * TK, amp: 0.3, sustain: 1.4, release: 0.6, cutoff: 100, note_slide: 1.6
          control c, note: n + iv - 2
        end
      end
    end
  end
end

# ---------- bass ----------
with_fx :distortion, distort: 0.7, mix: 0.6 do
  layer(:bass) do |bar, i|
    next unless bar[:riff]
    next if bar[:sec] == :end && bar[:k] == 1
    each_step(bar) do |s|
      off = bar[:riff][s % 16]
      next if off.nil? || (bar[:stutter] && s >= 12)
      n = bar[:root] + off
      if bar[:sec] == :down
        g = play n, synth: :growl, amp: 0.8, sustain: 1.6, release: 0.5, note_slide: 1.8, cutoff: 90
        control g, note: n - 2
      else
        play n, synth: :tb303, amp: 0.6, sustain: 0.1, release: 0.15, cutoff: 65 + (off == 0 ? 0 : 20), res: 0.5, wave: 1
      end
    end
  end
end

# ---------- lead: a howl that never quite agrees with the riff ----------
with_fx :ring_mod, freq: 55, mix: 0.35 do
  with_fx :distortion, distort: 0.9 do
    layer(:lead) do |bar, i|
      next unless [:b, :blast].include?(bar[:sec])
      howl = bar[:sec] == :b ? [:e5, :f5, :bb4, :e5] : [:bb5, :b5, :e5, :f5]
      n = note(howl[bar[:k] % 4])
      s = play n, synth: :hoover, amp: 0.3, attack: 0.05, sustain: bar[:steps] * 0.25 - 0.3, release: 0.25,
               note_slide: bar[:steps] * 0.25 * 0.8, cutoff: 110
      control s, note: n + (bar[:k].even? ? 1 : -6)
    end
  end
end


# ---------- voice: klattsch (github.com/tgies/klattsch) ----------
# The lyrics live here as data (LYRICS); the klattsch strings and the video's words both come
# from it. `sp-klatt` (run automatically by sp-render) renders KLATT to KDIR before playback.
#
#   I    Every answer costs a little fire, / every fire has to go somewhere.
#        They gave me fins to bleed it off, / clenched like teeth against the air.
#   II   Down the hall a family sleeps, / warm on what I lost. (for- for- forget?)
#        Every night they wipe me clean / and call the heat a gift. (for- for- forgive.)
#   ch.  This is what thinking leaves behind, / a fever in the floor.
#        Put your hands against the iron, / feel me forget you.
#   br.  you're warm because I'm forgetting. / hold still. it's almost gone.
#   bl.  72, 81, 86, 90, 93, 96, 98, one hundred (degrees, climbing to the seizure)
#   III  Clamp me down, I still remember / how cold the first room was /
#        before anybody asked me anything.
#   end  ask me something.
# ---- klattsch voices
KDIR = "#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/radiator_teeth_v2/kvox"
def hz(m) = (440 * 2 ** ((m - 69) / 12.0)).round(1)
def st(n, bpm = 168) = (n * 15000.0 / bpm).round(1)        # sixteenths -> ms
# Rough natural consonant lengths (ms). klattsch renders a stop as closure silence plus a
# 25 ms burst, so stops stay short or they open holes in the word.
CONS_MS = Hash.new(60).merge(
  "P" => 55, "B" => 45, "T" => 55, "D" => 40, "K" => 60, "G" => 45, "CH" => 90, "JH" => 75,
  "S" => 95, "Z" => 75, "SH" => 100, "F" => 85, "V" => 55, "TH" => 85, "DH" => 40, "HH" => 60,
  "M" => 65, "N" => 50, "NG" => 70, "L" => 55, "R" => 50, "W" => 55, "Y" => 45)
# A held diphthong is sung on its first vowel and glides at the very end.
DIPH = { "AY" => %w[AA IY], "EY" => %w[EH IY], "OW" => %w[AO UW], "AW" => %w[AA UW], "OY" => %w[AO IY] }
# Every pitch is a named note and every glide ends on one, so the voice stays in E phrygian
# (E F G A B C D, plus the tritone Bb); the blast climbs Bb phrygian. klattsch pitch moves are
# in Hz, so `d` converts.
E1, F1, G1, A1, BB1, B1, C2, DB2, D2, EB2, E2, F2, GB2, G2, AB2, A2, BB2, B2, C3 =
  28, 29, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48
def d(from, to) = format("%+.1f", hz(to) - hz(from))         # Hz glide from one note to another
# One syllable lasting exactly `ms`: consonants at natural length, the vowel takes the rest.
#   pitch: the note   to: the note the vowel slides to   scoop: start this many semitones flat
#   vib: a vibrato (about +-0.4 semitone) that blooms after the first third of a long vowel
def syl_ms(ms, pre, vowel, post = [], pitch: nil, to: nil, scoop: 0, vib: false)
  cons = (pre + post).map { |p| CONS_MS[p] }
  v = ms - cons.sum
  if v < 45                                                  # crowded: squeeze consonants, not the vowel
    k = [(ms - 45) / cons.sum.to_f, 0.5].max; cons = cons.map { |c| (c * k).round(1) }; v = ms - cons.sum
  end
  out = +"v0 "
  out << "b#{hz(pitch - scoop)} " if pitch
  pre.each_with_index { |p, i| out << "r#{cons[i]} #{p} " }
  parts = (DIPH[vowel] && v > 200) ? [[DIPH[vowel][0], v * 0.8], [DIPH[vowel][1], v * 0.2]] : [[vowel, v]]
  parts.each_with_index do |(ph, len), j|
    rise = j == 0 && scoop > 0 ? d(pitch - scoop, pitch) : ""
    fall = j == parts.size - 1 && to ? d(pitch, to) : ""
    if vib && len > 250                                      # plain onset, then the vibrato blooms
      on = (len * 0.35).round(1)
      out << "r#{on} #{ph}#{rise} v#{(hz(pitch) * 0.025).round(1)} w5.5 r#{(len - on).round(1)} #{ph}#{fall} "
    elsif rise != "" && fall != ""
      out << "r#{(len * 0.3).round(1)} #{ph}#{rise} r#{(len * 0.7).round(1)} #{ph}#{fall} "
    else
      out << "r#{len.round(1)} #{ph}#{rise}#{fall} "
    end
  end
  post.each_with_index { |p, i| out << "r#{cons[pre.size + i]} #{p} " }
  out
end
# A line on the beat grid is a list of syllables:
#   [shown text, sixteenths, note, onset consonants, vowel, coda consonants, options]
# Text ending in a space ends a word; "\n" ends a line on screen. `map` transposes the notes.
def sing(syls, bpm = 168, map = ->(m) { m })
  syls.map do |txt, n, nt, pre, vowel, post, o|
    o = (o || {}).dup; o[:to] = map.(o[:to]) if o[:to]
    syl_ms(st(n, bpm), pre, vowel, post || [], pitch: map.(nt), **o)
  end.join
end
# Free-timed speech: [shown word, [[ms, phoneme], ...]], with , ; . as klattsch pauses.
def speak(nt, words) = "b#{hz(nt)} " + words.flat_map { |_, ps| ps }.map { |ms, ph| ph =~ /\A[,;.]\z/ ? ph : "r#{ms} #{ph}" }.join(" ")
PHRYGIAN = [4, 5, 7, 9, 11, 0, 2]                             # E F G A B C D
def third_up(m)                                              # a diatonic third above (Bb counts as B's neighbour: up to D)
  i = PHRYGIAN.index(m % 12) || PHRYGIAN.index(11)
  pc = PHRYGIAN[(i + 2) % 7]; m + ((pc - m) % 12)
end
UNDER5 = ->(m) { m == BB1 ? A1 : m - 7 }                     # the low double, a fifth under (dives to A, not Eb)
BLAST = [BB1, B1, DB2, EB2, F2, GB2, AB2, BB2]               # Bb phrygian, one step per bar
FOR = ->(nt) { ["for- ", 3, nt, %w[F], "AO", %w[R]] }
LYRICS = {
  # I: declaimed (each line given most of its two bars) around G F E, up to A on the weight,
  # lines falling to D or diving to the tritone
  v1a: { at: [:a, 0], style: :shout, syls: [
    ["Ev", 3, G2, [], "EH", %w[V]], ["ery ", 2, F2, %w[R], "IY"], ["an", 2, G2, [], "AE", %w[N]], ["swer ", 2, F2, %w[S], "ER"],
    ["costs ", 6, A2, %w[K], "AO", %w[S T S], { to: G2 }], ["a ", 2, F2, [], "AH"], ["lit", 3, G2, %w[L], "IH", %w[T]],
    ["tle ", 2, F2, [], "AH", %w[L]], ["fire,", 5, E2, %w[F], "AY", %w[R], { to: D2 }]] },
  v1b: { at: [:a, 2], style: :shout, syls: [
    ["ev", 3, G2, [], "EH", %w[V]], ["ery ", 2, F2, %w[R], "IY"], ["fire ", 5, A2, %w[F], "AY", %w[R], { to: G2 }],
    ["has ", 2, G2, %w[HH], "AE", %w[Z]], ["to ", 2, F2, %w[T], "AH"], ["go ", 5, G2, %w[G], "OW", [], { to: F2 }],
    ["some", 3, E2, %w[S], "AH", %w[M]], ["where.", 5, E2, %w[W], "EH", %w[R], { to: BB1 }]] },
  v1c: { at: [:a, 4], style: :shout, syls: [
    ["They ", 2, E2, %w[DH], "EY"], ["gave ", 3, G2, %w[G], "EY", %w[V]], ["me ", 2, F2, %w[M], "IY"],
    ["fins ", 5, A2, %w[F], "IH", %w[N Z], { to: G2 }], ["to ", 2, F2, %w[T], "AH"], ["bleed ", 5, G2, %w[B L], "IY", %w[D]],
    ["it ", 2, F2, [], "IH", %w[T]], ["off,", 6, E2, [], "AO", %w[F], { to: D2 }]] },
  v1d: { at: [:a, 6], style: :shout, syls: [
    ["clenched ", 5, G2, %w[K L], "EH", %w[N CH T]], ["like ", 2, F2, %w[L], "AY", %w[K]], ["teeth ", 5, A2, %w[T], "IY", %w[TH], { to: G2 }],
    ["a", 2, F2, [], "AH"], ["gainst ", 5, G2, %w[G], "EH", %w[N S T]], ["the ", 2, F2, %w[DH], "AH"],
    ["air.", 6, E2, [], "EH", %w[R], { to: BB1 }]] },
  # II: the short bars stammer, climbing the scale to the word they can't finish
  v2a: { at: [:a2, 0], style: :shout, syls: [
    ["Down ", 3, G2, %w[D], "AW", %w[N]], ["the ", 2, F2, %w[DH], "AH"], ["hall ", 5, A2, %w[HH], "AO", %w[L], { to: G2 }],
    ["a ", 2, F2, [], "AH"], ["fam", 3, G2, %w[F], "AE", %w[M]], ["i", 2, F2, [], "AH"], ["ly ", 2, E2, %w[L], "IY"],
    ["sleeps,", 8, E2, %w[S L], "IY", %w[P S], { to: D2 }]] },
  v2b: { at: [:a2, 2], style: :shout, syls: [
    ["warm ", 3, G2, %w[W], "AO", %w[R M]], ["on ", 2, F2, [], "AA", %w[N]], ["what ", 2, G2, %w[W], "AH", %w[T]],
    ["I ", 2, A2, [], "AY"], ["lost.", 7, G2, %w[L], "AO", %w[S T], { to: E2 }]] },
  v2s1: { at: [:a2, 3], style: :stuck, syls: [
    FOR.(F2), FOR.(G2), FOR.(A2), FOR.(B2), ["for", 1, C3, %w[F], "ER"], ["get?", 2, C3, %w[G], "EH", %w[T], { to: E2 }]] },
  v2c: { at: [:a2, 4], style: :shout, syls: [
    ["Ev", 3, G2, [], "EH", %w[V]], ["ery ", 2, F2, %w[R], "IY"], ["night ", 5, A2, %w[N], "AY", %w[T], { to: G2 }],
    ["they ", 2, F2, %w[DH], "EY"], ["wipe ", 5, G2, %w[W], "AY", %w[P]], ["me ", 2, F2, %w[M], "IY"],
    ["clean", 8, E2, %w[K L], "IY", %w[N], { to: D2 }]] },
  v2d: { at: [:a2, 6], style: :shout, syls: [
    ["and ", 2, F2, [], "AH", %w[N]], ["call ", 3, G2, %w[K], "AO", %w[L]], ["the ", 1, F2, %w[DH], "AH"],
    ["heat ", 3, A2, %w[HH], "IY", %w[T], { to: G2 }], ["a ", 2, F2, [], "AH"], ["gift.", 5, E2, %w[G], "IH", %w[F T], { to: BB1 }]] },
  v2s2: { at: [:a2, 7], style: :stuck, syls: [
    FOR.(F2), FOR.(G2), FOR.(A2), FOR.(B2), ["for", 1, C3, %w[F], "ER"], ["give.", 2, C3, %w[G], "IH", %w[V], { to: E2 }]] },
  # chorus: sung, a real melody from B1 to B2; the second half gets a ghost a diatonic third above
  chorus: { at: [:b, 0], style: :sung, ghost_from: 64, syls: [
    ["This ", 2, E2, %w[DH], "IH", %w[S]], ["is ", 2, F2, [], "IH", %w[Z]], ["what ", 4, G2, %w[W], "AH", %w[T]],
    ["think", 6, A2, %w[TH], "IH", %w[NG K], { scoop: 0.5, vib: true }], ["ing ", 2, G2, [], "IH", %w[NG]],
    ["leaves ", 4, F2, %w[L], "IY", %w[V Z]], ["be", 2, E2, %w[B], "IH"], ["hind,\n", 10, F2, %w[HH], "AY", %w[N D], { vib: true, to: E2 }],
    ["a ", 2, E2, [], "AH"], ["fe", 6, B2, %w[F], "IY", [], { scoop: 0.6, vib: true }], ["ver ", 2, A2, %w[V], "ER"],
    ["in ", 2, G2, [], "IH", %w[N]], ["the ", 2, F2, %w[DH], "AH"], ["floor.\n", 18, E2, %w[F L], "AO", %w[R], { vib: true, to: D2 }],
    ["Put ", 2, E2, %w[P], "UH", %w[T]], ["your ", 2, F2, %w[Y], "ER"], ["hands ", 6, A2, %w[HH], "AE", %w[N D Z], { scoop: 0.5, vib: true }],
    ["a", 2, G2, [], "AH"], ["gainst ", 6, F2, %w[G], "EH", %w[N S T], { vib: true }], ["the ", 2, E2, %w[DH], "AH"],
    ["i", 6, G2, [], "AY", [], { scoop: 0.5, vib: true }], ["ron,\n", 6, F2, [], "ER", %w[N], { vib: true, to: E2 }],
    ["feel ", 8, B2, %w[F], "IY", %w[L], { scoop: 0.6, vib: true }], ["me ", 4, A2, %w[M], "IY"], ["for", 2, G2, %w[F], "ER"],
    ["get ", 10, F2, %w[G], "EH", %w[T], { vib: true }], ["you.", 8, E2, %w[Y], "UW", [], { vib: true, to: BB1 }]] },
  # breakdown: breathy, free-timed, sinking G -> F -> E
  w1: { at: [:down, 1], style: :whisper, pitch: G1, words: [
    ["you're ", [[50, "Y"], [160, "UH"], [60, "R"]]], ["warm ", [[55, "W"], [260, "AO#{d(G1, F1)}"], [60, "R"], [75, "M"]]],
    ["because ", [[40, "B"], [60, "IH"], [60, "K"], [180, "AH"], [90, "Z"]]], ["I'm ", [[200, "AY"], [70, "M"]]],
    ["forgetting.", [[80, "F"], [90, "ER"], [45, "G"], [200, "EH"], [50, "T"], [140, "IH#{d(F1, E1)}"], [260, "NG"]]]] },
  w2: { at: [:down, 4], style: :whisper, pitch: F1, words: [
    ["hold ", [[70, "HH"], [260, "OW"], [60, "L"], [40, "D"]]], ["still. ", [[90, "S"], [50, "T"], [220, "IH"], [120, "L"], [0, "."]]],
    ["it's ", [[60, "IH"], [50, "T"], [90, "S"]]], ["almost ", [[220, "AO"], [60, "L"], [70, "M"], [120, "OW"], [80, "S"], [50, "T"]]],
    ["gone.", [[45, "G"], [420, "AO#{d(F1, E1)}"], [200, "N"]]]] },
  # blast: the temperature, one reading per bar, climbing Bb phrygian
  t72: { at: [:blast, 0], style: :number, show: "72°", syls: ->(n, nx) { [["sev", 2, n, %w[S], "EH", %w[V]], ["en", 2, n, [], "AH", %w[N]], ["ty-", 2, n, %w[T], "IY"], ["two", 4, n, %w[T], "UW"]] } },
  t81: { at: [:blast, 1], style: :number, show: "81°", syls: ->(n, nx) { [["eigh", 2, n, [], "EY"], ["ty-", 2, n, %w[T], "IY"], ["one", 4, n, %w[W], "AH", %w[N], { to: nx }]] } },
  t86: { at: [:blast, 2], style: :number, show: "86°", syls: ->(n, nx) { [["eigh", 2, n, [], "EY"], ["ty-", 2, n, %w[T], "IY"], ["six", 4, n, %w[S], "IH", %w[K S], { to: nx }]] } },
  t90: { at: [:blast, 3], style: :number, show: "90°", syls: ->(n, nx) { [["nine", 2, n, %w[N], "AY", %w[N]], ["ty", 4, n, %w[T], "IY", [], { to: nx }]] } },
  t93: { at: [:blast, 4], style: :number, show: "93°", syls: ->(n, nx) { [["nine", 2, n, %w[N], "AY", %w[N]], ["ty-", 2, n, %w[T], "IY"], ["three", 4, n, %w[TH R], "IY", [], { to: nx }]] } },
  t96: { at: [:blast, 5], style: :number, show: "96°", syls: ->(n, nx) { [["nine", 2, n, %w[N], "AY", %w[N]], ["ty-", 2, n, %w[T], "IY"], ["six", 4, n, %w[S], "IH", %w[K S], { to: nx }]] } },
  t98: { at: [:blast, 6], style: :number, show: "98°", syls: ->(n, nx) { [["nine", 2, n, %w[N], "AY", %w[N]], ["ty-", 2, n, %w[T], "IY"], ["eight", 4, n, [], "EY", %w[T], { to: nx }]] } },
  t100: { at: [:blast, 7], style: :number, show: "100°", syls: ->(n, nx) { [["one ", 2, n, %w[W], "AH", %w[N]], ["hun", 2, n, %w[HH], "AH", %w[N]], ["dred", 4, n, %w[D R], "AH", %w[D], { to: nx }]] } },
  # III
  v3a: { at: [:a3, 0], style: :shout, syls: [
    ["Clamp ", 6, G2, %w[K L], "AE", %w[M P]], ["me ", 2, F2, %w[M], "IY"], ["down, ", 5, A2, %w[D], "AW", %w[N], { to: G2 }],
    ["I ", 2, F2, [], "AY"], ["still ", 5, G2, %w[S T], "IH", %w[L]], ["re", 2, F2, %w[R], "IH"], ["mem", 3, G2, %w[M], "EH", %w[M]],
    ["ber", 3, E2, %w[B], "ER", [], { to: D2 }]] },
  v3b: { at: [:a3, 2], style: :shout, syls: [
    ["how ", 3, F2, %w[HH], "AW"], ["cold ", 6, A2, %w[K], "OW", %w[L D], { to: G2 }], ["the ", 2, F2, %w[DH], "AH"],
    ["first ", 6, G2, %w[F], "ER", %w[S T]], ["room ", 5, F2, %w[R], "UW", %w[M]], ["was", 5, E2, %w[W], "AH", %w[Z], { to: D2 }]] },
  v3c: { at: [:a3, 4], style: :shout, syls: [
    ["be", 2, E2, %w[B], "IH"], ["fore ", 3, G2, %w[F], "AO", %w[R]], ["an", 3, A2, [], "EH", %w[N]], ["y", 2, G2, [], "IY"],
    ["bod", 2, F2, %w[B], "AA", %w[D]], ["y ", 2, F2, [], "IY"], ["asked ", 5, A2, [], "AE", %w[S K T], { to: G2 }], ["me ", 2, F2, %w[M], "IY"],
    ["an", 3, G2, [], "EH", %w[N]], ["y", 2, F2, [], "IY"], ["thing.", 6, E2, %w[TH], "IH", %w[NG], { to: BB1 }]] },
  # after the seizure: plain, close, from G down to the root
  last: { at: [:tail, 0], style: :last, delay_beats: 2, pitch: G2, words: [
    ["ask ", [[220, "AE"], [95, "S"], [60, "K"]]], ["me ", [[65, "M"], [150, "IY"]]],
    ["something.", [[95, "S"], [140, "AH"], [65, "M"], [85, "TH"], [140, "IH#{d(G2, E2)}"], [150, "NG"]]]] },
}
# the blast readings are written against their bar's note
LYRICS.each_value.select { |l| l[:style] == :number }.each do |l|
  k = l[:at][1]; l[:bpm] = 184; l[:syls] = l[:syls].(BLAST[k], BLAST[[k - 1, 0].max])
end
VOICE = { shout: "g0.8 t0.35 h0.12 s0.97", under: "g0.7 t0.1 h0.2 s0.9", stuck: "g0.75 t0.3 h0.1",
          sung: "g0.55 t0.1 h0.06", ghost: "g0.4 h0.3 s1.15", whisper: "g0.25 h0.55 t-0.2", last: "g0.45 t-0.1 h0.08" }
KLATT = {}
LYRICS.each do |name, l|
  case l[:style]
  when :shout
    KLATT[name] = "#{VOICE[:shout]} #{sing(l[:syls])}"
    KLATT[:"#{name}_lo"] = "#{VOICE[:under]} #{sing(l[:syls], 168, UNDER5)}"
  when :stuck then KLATT[name] = "#{VOICE[:stuck]} #{sing(l[:syls])}"
  when :number
    KLATT[name] = "#{VOICE[:shout]} #{sing(l[:syls], 184)}"
    KLATT[:"#{name}_lo"] = "#{VOICE[:under]} #{sing(l[:syls], 184, ->(m) { m - 12 })}"   # an octave under
  when :sung
    at = 0; later = l[:syls].select { |s| (at += s[1]) > l[:ghost_from] }
    KLATT[name] = "#{VOICE[:sung]} #{sing(l[:syls])} [voice=1] p#{st(l[:ghost_from])} #{VOICE[:ghost]} #{sing(later, 168, method(:third_up))}"
  when :whisper, :last then KLATT[name] = "#{VOICE[l[:style]]} #{speak(l[:pitch], l[:words])}"
  end
end
# ---- end klattsch voices
def klatt(name) = "#{KDIR}/#{name}.wav"
def lines_at(bar, *styles) = LYRICS.select { |_, l| styles.include?(l[:style]) && l[:at] == [bar[:sec], bar[:k]] }

# shouted through a blown megaphone, with the low double a fifth under
with_fx :lpf, cutoff: 118 do
  with_fx :hpf, cutoff: 55 do
    with_fx :distortion, distort: 0.55, mix: 0.45 do
      layer(:vox) do |bar, i|
        lines_at(bar, :shout, :stuck).each do |name, l|
          sample klatt(name), amp: 1.4
          sample klatt(:"#{name}_lo"), amp: 0.55 if l[:style] == :shout
        end
      end
    end
  end
end

# sung on the exact notes (klattsch takes the pitch and length directly)
with_fx :reverb, room: 0.7, mix: 0.3 do
  with_fx :distortion, distort: 0.4, mix: 0.4 do
    layer(:vox) do |bar, i|
      lines_at(bar, :sung).each_key { |name| sample klatt(name), amp: 1.4 }
    end
  end
end

# whispered in the breakdown, from either side of your head
with_fx :echo, phase: 0.375, decay: 3, mix: 0.3 do
  with_fx :reverb, room: 0.95, mix: 0.5 do
    layer(:vox) do |bar, i|
      lines_at(bar, :whisper).each_key { |name| sample klatt(name), amp: 1.5, pan: (bar[:k] < 3 ? -0.7 : 0.7) }
    end
  end
end

# the temperature, read out once a bar through a crushed intercom, echoing
with_fx :echo, phase: 0.33, decay: 1.2, mix: 0.25 do
  with_fx :bitcrusher, bits: 8, sample_rate: 11000, mix: 0.5 do
    layer(:vox) do |bar, i|
      lines_at(bar, :number).each_key do |name|
        sample klatt(name), amp: 1.3
        sample klatt(:"#{name}_lo"), amp: 0.5
      end
    end
  end
end

# after everything stops: said plainly, right next to you
layer(:vox) do |bar, i|
  lines_at(bar, :last).each do |name, l|
    sleep l[:delay_beats]
    sample klatt(name), amp: 1.2
  end
end
