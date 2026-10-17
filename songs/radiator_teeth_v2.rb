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
# Every phrase is a klattsch phoneme string, timed in milliseconds from the song's own tempo.
# `sp-klatt` (run automatically by sp-render) renders KLATT to KDIR before playback.
# ---- klattsch voices
KDIR = "#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/radiator_teeth_v2/kvox"
S16 = 15000.0 / 168                              # one sixteenth in ms
def hz(m) = (440 * 2 ** ((m - 69) / 12.0)).round(1)
def st(n) = (n * S16).round(1)
# Rough natural consonant lengths (ms). klattsch renders a stop as closure silence plus a
# 25 ms burst, so stops stay short or they open holes in the word.
CONS_MS = Hash.new(60).merge(
  "P" => 55, "B" => 45, "T" => 55, "D" => 40, "K" => 60, "G" => 45, "CH" => 90, "JH" => 75,
  "S" => 95, "Z" => 75, "SH" => 100, "F" => 85, "V" => 55, "TH" => 85, "DH" => 40, "HH" => 60,
  "M" => 65, "N" => 50, "NG" => 70, "L" => 55, "R" => 50, "W" => 55, "Y" => 45)
# A held diphthong is sung on its first vowel and glides at the very end.
DIPH = { "AY" => %w[AA IY], "EY" => %w[EH IY], "OW" => %w[AO UW], "AW" => %w[AA UW], "OY" => %w[AO IY] }
# Every pitch is a named note, and every glide ends on one, so the voice stays in E phrygian
# (E F G A B C D, plus the tritone Bb). klattsch pitch moves are in Hz, so `d` converts.
E1, F1, G1, A1, BB1, B1, C2, D2, E2, F2, G2, A2, BB2, B2, C3 = 28, 29, 31, 33, 34, 35, 36, 38, 40, 41, 43, 45, 46, 47, 48
def d(from, to) = format("%+.1f", hz(to) - hz(from))   # Hz glide from one note to another
# One syllable lasting exactly `ms`: consonants at natural length, the vowel takes the rest.
#   note: pitch   to: the note the vowel slides to   scoop: start this many semitones flat
#   vib: true for a vibrato (about +-0.4 semitone) that blooms after the first third of a long vowel
def syl_ms(ms, pre, vowel, post = [], note: nil, to: nil, scoop: 0, vib: false)
  cons = (pre + post).map { |p| CONS_MS[p] }
  v = ms - cons.sum
  if v < 45                                      # crowded syllable: squeeze consonants, not the vowel
    k = [(ms - 45) / cons.sum.to_f, 0.5].max; cons = cons.map { |c| (c * k).round(1) }; v = ms - cons.sum
  end
  out = +"v0 "
  out << "b#{hz(note - scoop)} " if note
  pre.each_with_index { |p, i| out << "r#{cons[i]} #{p} " }
  parts = (DIPH[vowel] && v > 200) ? [[DIPH[vowel][0], v * 0.8], [DIPH[vowel][1], v * 0.2]] : [[vowel, v]]
  parts.each_with_index do |(ph, len), j|
    first, last = j == 0, j == parts.size - 1
    rise = first && scoop > 0 ? d(note - scoop, note) : ""
    fall = last && to ? d(note, to) : ""
    if vib && len > 250                          # plain onset, then the vibrato blooms
      on = (len * 0.35).round(1)
      out << "r#{on} #{ph}#{rise} v#{(hz(note) * 0.025).round(1)} w5.5 r#{(len - on).round(1)} #{ph}#{fall} "
    elsif rise != "" && fall != ""
      out << "r#{(len * 0.3).round(1)} #{ph}#{rise} r#{(len * 0.7).round(1)} #{ph}#{fall} "
    else
      out << "r#{len.round(1)} #{ph}#{rise}#{fall} "
    end
  end
  post.each_with_index { |p, i| out << "r#{cons[pre.size + i]} #{p} " }
  out
end
def syl(n, steps, pre, vowel, post = [], **o) = syl_ms(st(steps), pre, vowel, post, note: n, **o)

# "TEETH! in the RADIATOR!" on the grid (3+1+1+2+1+1+3 sixteenths): G F E, G F E, then a
# tritone dive on "-tor". `t` transposes (the low double runs a fifth under, diving to A, not Eb).
SHOUT = ->(t, dive = BB1) {
  syl(G2 + t, 3, %w[T], "IY", %w[TH], to: F2 + t) + syl(F2 + t, 1, [], "IH", %w[N]) + syl(E2 + t, 1, %w[DH], "AH") +
  syl(G2 + t, 2, %w[R], "EY", to: F2 + t) + syl(F2 + t, 1, %w[D], "IY") + syl(E2 + t, 1, [], "EY") +
  syl(E2 + t, 3, %w[T], "ER", to: dive)
}
# "BITE the HEAT!" (3+1+4): down the phrygian steps G F E
BITE = ->(t) { syl(G2 + t, 3, %w[B], "AY", %w[T], to: F2 + t) + syl(E2 + t, 1, %w[DH], "AH") + syl(F2 + t, 4, %w[HH], "IY", %w[T], to: E2 + t) }
# "the pipes are singing": scooped onsets, vibrato on long notes, the second "pipes" sagging to D,
# the last "-ing" bending up a semitone to F (the phrygian rub) instead of up to a major third
PIPES = ->(t, sag = D2) {
  syl(E2 + t, 2, %w[DH], "AH") + syl(F2 + t, 14, %w[P], "AY", %w[P S], scoop: 0.6, vib: true) +
  syl(F2 + t, 4, [], "AA", %w[R]) + syl(E2 + t, 6, %w[S], "IH", %w[NG], scoop: 0.4, vib: true) + syl(BB1 + t, 6, [], "IH", %w[NG], vib: true) +
  syl(BB1 + t, 2, %w[DH], "AH") + syl(E2 + t, 14, %w[P], "AY", %w[P S], scoop: 0.6, vib: true, to: sag) +
  syl(E2 + t, 4, [], "AA", %w[R]) + syl(F2 + t, 6, %w[S], "IH", %w[NG], scoop: 0.4, vib: true) + syl(E2 + t, 6, [], "IH", %w[NG], vib: true, to: F2 + t)
}
SHOUTER = "g0.8 t0.35 h0.12 s0.97"               # tense and bright, little breath
UNDER   = "g0.7 t0.1 h0.2 s0.9"                  # a bigger, darker throat underneath
# free-timed speech: each phoneme its own length (stressed vowels simply held longer, since a
# stress mark's +8 Hz lift would knock these low notes off the scale)
def say(n, *pairs) = "b#{hz(n)} " + pairs.each_slice(2).map { |ms, ph| ph == "," ? "," : "r#{ms} #{ph}" }.join(" ")
KLATT = {
  shout:    "#{SHOUTER} #{SHOUT.(0)}",
  shout_lo: "#{UNDER} #{SHOUT.(-7, A1)}",
  bite:     "#{SHOUTER} #{BITE.(0)}",
  bite_lo:  "#{UNDER} #{BITE.(-7)}",
  # stuck on the word: up the scale F G A B, then C falling all the way back to E
  stuck:    "g0.75 t0.3 h0.1 " + [F2, G2, A2, B2].map { |n| syl(n, 3, %w[B], "AY") }.join + syl(C3, 3, %w[B], "AY", to: E2),
  pipes:    "g0.55 t0.1 h0.06 #{PIPES.(0)} #{PIPES.(0)} [voice=1] p#{st 64} g0.4 h0.3 s1.15 #{PIPES.(6, A2)}",
  # breathy but still voiced; sinking from G to E
  warm:     "g0.25 h0.55 t-0.2 " + say(G1, 70, "IH", 50, "T", 90, "S", 55, "W", 270, "AO#{d(G1, F1)}", 60, "R", 75, "M",
                                       55, "IH", 55, "N", 70, "HH", 330, "IY#{d(F1, E1)}", 140, "R"),
  warm2:    "g0.2 h0.6 t-0.25 " + say(F1, 70, "IH", 50, "T", 110, "S", 0, ",", 100, "S", 300, "OW", 60, "W",
                                      300, "AO", 60, "R", 80, "M", 55, "IH", 55, "N", 80, "HH", 390, "IY#{d(F1, E1)}", 160, "R"),
  hot:      "g0.85 t0.45 h0.1 b#{hz BB2} r60 HH r150 AA#{d(BB2, G2)} r55 T",
  # said plainly, close: from G down to the root
  teeth:    "g0.45 t-0.1 h0.08 b#{hz G2} r55 T r300 IY#{d(G2, E2)} r130 TH",
}
# ---- end klattsch voices
def klatt(name) = "#{KDIR}/#{name}.wav"

with_fx :lpf, cutoff: 118 do
  with_fx :hpf, cutoff: 55 do
    with_fx :distortion, distort: 0.55, mix: 0.45 do
      layer(:vox) do |bar, i|
        k = bar[:k]
        case bar[:sec]
        when :a, :a3
          if (bar[:sec] == :a ? (k.odd? && k < 7) : k.even?)
            sample klatt(:shout), amp: 1.4
            sample klatt(:shout_lo), amp: 0.55
          end
        when :a2
          if bar[:steps] == 15 then sample klatt(:stuck), amp: 1.3
          elsif k.even?
            sample klatt(:bite), amp: 1.4
            sample klatt(:bite_lo), amp: 0.55
          end
        end
      end
    end
  end
end

# sung on the exact notes (no autotune needed: klattsch takes the pitch and length directly)
with_fx :reverb, room: 0.7, mix: 0.3 do
  with_fx :distortion, distort: 0.4, mix: 0.4 do
    layer(:vox) do |bar, i|
      sample klatt(:pipes), amp: 1.4 if bar[:sec] == :b && bar[:k] == 0
    end
  end
end

# whispered in the breakdown, from either side of your head
with_fx :echo, phase: 0.375, decay: 3, mix: 0.3 do
  with_fx :reverb, room: 0.95, mix: 0.5 do
    layer(:vox) do |bar, i|
      next unless bar[:sec] == :down && [1, 4].include?(bar[:k])
      sample klatt(bar[:k] == 1 ? :warm : :warm2), amp: 1.5, pan: (bar[:k] == 1 ? -0.7 : 0.7)
    end
  end
end

# one word, faster and higher every bar of the blast
with_fx :bitcrusher, bits: 8, sample_rate: 11000, mix: 0.5 do
  layer(:vox) do |bar, i|
    next unless bar[:sec] == :blast
    (bar[:steps] / 4).times do |b|
      sample klatt(:hot), amp: 1.1, rpitch: [0, 1, 3, 5, 7, 8, 10, 12][bar[:k] % 8], pan: (b.even? ? -0.4 : 0.4)
      sleep 1
    end
  end
end

# after everything stops: said plainly, right next to you
layer(:vox) do |bar, i|
  next unless bar[:sec] == :tail
  sleep 2
  sample klatt(:teeth), amp: 1.2
end
