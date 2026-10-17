# Radiator Teeth
# E phrygian with a tritone stuck in its throat. Bars keep losing a sixteenth.

use_debug false
set_sched_ahead_time! 2   # dense FX chains; give the server room so nothing lands late
use_random_seed 666

# Riffs as 16th-note steps: semitones above the root, nil = rest.
RIFF_A = [0, 0, nil, 0,  1, nil, 0, 6,  nil, 0, 3, 0,  1, nil, 7, 6]
# B groups its hits 3+3+3+3+4 across the bar, so it never lands where you expect
RIFF_B = [0, nil, nil, 0, nil, nil, 1, nil, nil, 0, nil, nil, 6, nil, 5, 3]
# breakdown: two slow, sinking chugs per bar
RIFF_D = [0, nil, nil, nil, nil, nil, nil, nil, -1, nil, nil, nil, nil, nil, -6, nil]

E = :e1
PLAN = []
def bars(sec, n, riff, opts = {})
  n.times do |k|
    steps = opts[:short] && (k % 4 == 3) ? 15 : 16      # every fourth bar trips
    steps = 14 if opts[:shorter] && k.odd?
    PLAN << { sec: sec, riff: riff, steps: steps, bpm: opts[:bpm] || 168, root: note(E) + (opts[:up] || 0),
              k: k, n: n, stutter: opts[:stutter] && k == n - 1 }
  end
end

bars :intro,  4, nil
bars :a,      8, RIFF_A, stutter: true
bars :a2,     8, RIFF_A, short: true
bars :b,      8, RIFF_B, stutter: true
bars :down,   6, RIFF_D, bpm: 168
bars :blast,  8, RIFF_A, bpm: 184, up: 6, shorter: true
bars :a3,     6, RIFF_A, bpm: 176, short: true
bars :end,    2, RIFF_A, bpm: 176
PLAN << { sec: :tail, riff: nil, steps: 16, bpm: 176, root: note(E), k: 0, n: 1 }

def layer(&blk)
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

# ---------- intro: something screaming inside the pipes ----------
with_fx :ring_mod, freq: 31, mix: 0.6 do
  with_fx :distortion, distort: 0.8, mix: 0.7 do
    layer do |bar, i|
      next unless bar[:sec] == :intro
      s = play note(:e4) + i * 3, synth: :zawa, attack: 0.5, sustain: 3, release: 0.5, amp: 0.1 + i * 0.05,
                cutoff: 90 + i * 8, res: 0.9, phase: 0.25, note_slide: 3.5, wave: 1
      control s, note: note(:bb4) + i * 3
    end
  end
end
with_fx :bitcrusher, bits: 6, sample_rate: 6000 do
  layer do |bar, i|
    next unless bar[:sec] == :intro
    # kicks arrive in the wrong places, more of them each bar
    hits = (0..15).to_a.shuffle.take(2 + i * 2)
    each_step(bar) do |s|
      sample :drum_heavy_kick, amp: 0.8, rate: 0.9 + rand(0.2) if hits.include?(s)
      sample :elec_hi_snare, amp: 0.5, rate: 0.7 if i == 3 && s >= 12
    end
  end
end

# ---------- guitars: detuned saws through too much ----------
with_fx :level, amp: 1.8 do
with_fx :krush, gain: 6, cutoff: 110, res: 0.3, mix: 0.6 do
  with_fx :distortion, distort: 0.96 do
    with_fx :lpf, cutoff: 112 do
      layer do |bar, i|
        next unless bar[:riff] && bar[:sec] != :down
        next if bar[:sec] == :end && bar[:k] == 1
        each_step(bar) do |s|
          off = bar[:riff][s % 16]
          if bar[:stutter] && s >= 12
            # the last beat jams: the same stab, faster and higher
            r0 = (s - 12) * 4
            in_thread { 4.times { |r| play bar[:root] + 12 + r0 + r, synth: :dsaw, detune: 0.3, amp: 0.35, release: 0.04, cutoff: 100 + r * 5; sleep 0.0625 } }
            next
          end
          next if off.nil?
          n = bar[:root] + 12 + off
          play [n, n + 7, n + 12], synth: :dsaw, detune: 0.25, amp: 0.32, attack: 0, sustain: 0.12, release: 0.06, cutoff: 105
          play n - 12, synth: :tb303, amp: 0.45, release: 0.2, cutoff: 70 + (off == 0 ? 0 : 25), res: 0.6, wave: 1
        end
      end
    end
  end
end
end

# ---------- breakdown: chugs that sink as they ring ----------
with_fx :whammy, mix: 0.25 do
  with_fx :distortion, distort: 0.97 do
    layer do |bar, i|
      next unless bar[:sec] == :down
      each_step(bar) do |s|
        off = bar[:riff][s]
        next if off.nil?
        n = bar[:root] + 12 + off
        [0, 6, 12].each do |iv|                                  # it sags like something melting
          c = play n + iv, synth: :dsaw, detune: 0.4, amp: 0.22, sustain: 1.4, release: 0.6, cutoff: 95, note_slide: 1.6
          control c, note: n + iv - 2
        end
        g = play n - 12, synth: :growl, amp: 0.7, sustain: 1.6, release: 0.5, note_slide: 1.8, cutoff: 90
        control g, note: n - 14
      end
    end
  end
end

# ---------- lead: a howl that never quite agrees with the riff ----------
with_fx :ring_mod, freq: 55, mix: 0.35 do
  with_fx :distortion, distort: 0.9 do
    layer do |bar, i|
      next unless [:b, :blast].include?(bar[:sec])
      howl = bar[:sec] == :b ? [:e5, :f5, :bb4, :e5] : [:bb5, :b5, :e5, :f5]
      n = note(howl[bar[:k] % 4])
      s = play n, synth: :hoover, amp: 0.3, attack: 0.05, sustain: bar[:steps] * 0.25 - 0.3, release: 0.25,
               note_slide: bar[:steps] * 0.25 * 0.8, cutoff: 110
      control s, note: n + (bar[:k].even? ? 1 : -6)
    end
  end
end

# ---------- drums ----------
with_fx :distortion, distort: 0.5, mix: 0.5 do
  with_fx :compressor, threshold: 0.3, slope_above: 0.4 do
    layer do |bar, i|
      next if bar[:sec] == :intro || bar[:sec] == :tail
      next if bar[:sec] == :end && bar[:k] == 1
      sample :drum_cymbal_hard, amp: 0.55 if bar[:k] == 0
      each_step(bar) do |s|
        off = bar[:riff] && bar[:riff][s % 16]
        case bar[:sec]
        when :down
          sample :drum_heavy_kick, amp: 1.6 if s == 0 || s == 8 || s == 14
          sample :drum_snare_hard, amp: 1.0, rate: 0.85 if s == 8
          sample :drum_cymbal_open, amp: 0.25, rate: 0.9, finish: 0.5 if s % 4 == 0
        when :blast
          # blast beat: kick and crash on the beat, snare between
          if s.even?
            sample :drum_heavy_kick, amp: 1.2
            sample :drum_cymbal_closed, amp: 0.5, rate: 0.9
          else
            sample :drum_snare_hard, amp: 0.65, rate: 1.05
          end
          sample :drum_splash_hard, amp: 0.25 if s % 8 == 0
        else
          if bar[:stutter] && s >= 12
            sample :drum_snare_hard, amp: 0.4 + (s - 12) * 0.15, rate: 1 + (s - 12) * 0.1
            sample :drum_snare_hard, amp: 0.3, rate: 1.2, start: 0.0, finish: 0.3 if s.even?
            next
          end
          sample :drum_heavy_kick, amp: 1.3 if off == 0
          sample :drum_snare_hard, amp: 0.9 if s == 4 || s == 12
          sample :drum_cymbal_closed, amp: (s % 4 == 2 ? 0.45 : 0.25), rate: 1.1
          sample :elec_hi_snare, amp: 0.35, rate: 0.8 if bar[:sec] == :b && s == 15
        end
      end
    end
  end
end

# ---------- the ending: the riff seizes up, then the pipes scream once more ----------
with_fx :bitcrusher, bits: 7, sample_rate: 9000 do
  layer do |bar, i|
    next unless bar[:sec] == :end && bar[:k] == 1
    # replace the last bar with a seizing retrigger, each repeat faster
    t = 0.25; n = bar[:root]
    while t > 0.03
      play [n + 12, n + 19], synth: :dsaw, amp: 0.4, release: t * 0.5, detune: 0.3
      sample :drum_heavy_kick, amp: 1.0
      sleep t; t *= 0.82
    end
  end
end
with_fx :reverb, room: 0.9, mix: 0.6 do
  with_fx :distortion, distort: 0.9 do
    layer do |bar, i|
      next unless bar[:sec] == :tail
      s = play :e5, synth: :zawa, amp: 0.35, attack: 0.02, release: 3.5, cutoff: 110, res: 0.95, note_slide: 3
      control s, note: :bb3
      sample :drum_cymbal_hard, amp: 0.6, rate: 0.7
    end
  end
end
