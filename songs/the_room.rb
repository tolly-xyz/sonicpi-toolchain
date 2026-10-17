# The Room With The Crooked Clock
# 7/8 (2+2+3), D major. The odd note is B-flat, borrowed from G minor.
# It keeps turning up in the melody until, near the end, it becomes the floor.

use_debug false
use_random_seed 1729
EIGHTH_BPM = 196

# ---------- harmony: [bass, voicing] ----------
CH = {
  d:      [:d2,  [:fs3, :a3, :d4, :e4]],
  fsm7:   [:fs2, [:e3, :a3, :cs4, :e4]],
  gmaj7:  [:g2,  [:b3, :d4, :fs4]],
  gm6:    [:g2,  [:bb3, :d4, :e4]],
  d_fs:   [:fs2, [:a3, :d4, :fs4]],
  bm7:    [:b1,  [:a3, :d4, :fs4]],
  em7:    [:e2,  [:g3, :b3, :d4]],
  em9:    [:e2,  [:g3, :d4, :fs4]],
  a7sus:  [:a1,  [:g3, :d4, :e4]],
  a7:     [:a1,  [:g3, :cs4, :e4]],
  ebmaj7: [:eb2, [:g3, :bb3, :d4]],
  bb:     [:bb1, [:f3, :bb3, :d4]],
  dm7:    [:d2,  [:f3, :a3, :c4]],
  ebm6:   [:eb2, [:gb3, :bb3, :c4]],
  bb_d:   [:d2,  [:f3, :bb3, :d4]],
  gm7:    [:g1,  [:f3, :bb3, :d4]],
}

# ---------- melody, in eighths (each bar = 7) ----------
A1 = [
  [:d,     [[:a4,2],[:fs4,1],[:a4,1],[:d5,3]]],
  [:fsm7,  [[:cs5,2],[:a4,2],[:e5,2],[:cs5,1]]],
  [:gmaj7, [[:b4,2],[:d5,1],[:fs5,1],[:e5,2],[:d5,1]]],
  [:gm6,   [[:d5,2],[:bb4,2],[:a4,3]]],
  [:d_fs,  [[:fs4,1],[:a4,1],[:d5,2],[:e5,2],[:fs5,1]]],
  [:bm7,   [[:fs5,2],[:e5,1],[:d5,1],[:b4,3]]],
  [:em7,   [[:g4,2],[:b4,2],[:e5,2],[:d5,1]]],
  [:a7sus, [[:e5,4],[:r,3]]],
]
A2 = A1[0..3] + [
  [:d_fs,  [[:fs4,1],[:a4,1],[:d5,2],[:fs5,2],[:a5,1]]],
  [:em7,   [[:g5,2],[:fs5,1],[:e5,1],[:d5,2],[:b4,1]]],
  [:a7,    [[:cs5,2],[:e5,2],[:g5,2],[:cs5,1]]],
  [:d,     [[:d5,5],[:r,2]]],
]
B = [
  [:bm7,   [[:fs5,3],[:e5,2],[:d5,2]]],
  [:gmaj7, [[:d5,3],[:b4,2],[:a4,2]]],
  [:d_fs,  [[:a4,2],[:d5,2],[:fs5,3]]],
  [:gm6,   [[:e5,2],[:d5,2],[:bb4,3]]],
  [:bm7,   [[:b4,2],[:d5,2],[:fs5,2],[:a5,1]]],
  [:em9,   [[:g5,3],[:fs5,2],[:e5,2]]],
  [:gm6,   [[:d5,2],[:bb4,2],[:g4,3]]],
  [:a7,    [[:a4,2],[:cs5,2],[:e5,2],[:g5,1]]],
]
# Into the other room: G minor stops being a color and becomes a door.
CLIMB = A1 + A2[0..5] + [
  [:gm6,    [[:d5,2],[:bb4,2],[:g4,3]]],
  [:ebmaj7, [[:bb4,5],[:r,2]]],
]
down4 = lambda { |m| m.map { |n, d| [n == :r ? :r : note(n) - 4, d] } }
TURN = [
  [:bb,     down4.(A1[0][1])],
  [:dm7,    down4.(A1[1][1])],
  [:ebmaj7, down4.(A1[2][1])],
  [:ebm6,   down4.(A1[3][1])],
  [:bb_d,   down4.(A1[4][1])],
  [:gm7,    down4.(A1[5][1])],
  [:gm6,    [[:d5,2],[:bb4,2],[:a4,3]]],   # the old phrase, and the way home
  [:a7,     [[:e5,2],[:cs5,2],[:a4,3]]],
]
CODA = A1[0..3] + [
  [:d, [[:fs5,3],[:e5,2],[:d5,2]]],
  [:d, [[:d5,7]]],
  [:d, [[:r,7]]],
]
INTRO = [[:d, nil], [:d, nil], [:gm6, nil], [:d, nil]]

PLAN = []
add = lambda { |sec, bars, bpm = EIGHTH_BPM| bars.each { |c, m| PLAN << { sec: sec, ch: c, mel: m, bpm: bpm } } }
add.(:intro, INTRO)
add.(:bare,  A1 + A2)
add.(:room,  B)
add.(:climb, CLIMB)
add.(:turn,  TURN)
add.(:home,  A2)
CODA.each_with_index { |(c, m), i| PLAN << { sec: :coda, ch: c, mel: m, bpm: EIGHTH_BPM - i * 9 } }

# Rehearsal controls: prepend e.g. `FROM_BAR = 20; TO_BAR = 28; SOLO = [:piano]`.
FROM = defined?(FROM_BAR) ? FROM_BAR : 0
TO = defined?(TO_BAR) ? TO_BAR : PLAN.length - 1
ONLY = defined?(SOLO) ? SOLO : nil

def layer(name = :misc, &blk)
  return if ONLY && !ONLY.include?(name)
  in_thread do
    PLAN.each_with_index do |bar, i|
      next if i < FROM
      break if i > TO
      use_bpm bar[:bpm]
      in_thread { blk.call(bar, i) }   # each bar starts on the conductor's beat
      sleep 7
    end
  end
end

# A little human unsteadiness in the hands.
def hum; rrand(-0.03, 0.03); end
# How present the piano is in each room.
PG = { bare: 0.55, room: 0.75, climb: 1.0, turn: 0.7, home: 1.0, coda: 0.6 }
ACC = [1.0, 0.6, 0.85, 0.55, 0.95, 0.5, 0.65]   # 2+2+3 accents

# ---------- room tone ----------
layer(:hiss) do |bar, i|
  sample :vinyl_hiss, amp: 0.12, rate: 0.85 if i % 6 == 0 && bar[:sec] != :coda
end

# ---------- the crooked clock (music box ostinato) ----------
with_fx :reverb, room: 0.7, mix: 0.45 do
  with_fx :echo, phase: 0.75, decay: 4, mix: 0.18 do
    layer(:clock) do |bar, i|
      next unless [:intro, :bare, :home, :coda].include?(bar[:sec])
      bass, v = CH[bar[:ch]]
      v = v.map { |n| note(n) + 24 }
      fig = [v[-1], v[0], v[-2] + 0, v[0], v[-1] + 2, v[-2], v[1]]
      fig[4] = v[-1] if bar[:ch] != :d    # stay inside the chord off home
      amp = { intro: 0.32, bare: 0.12, home: 0.16, coda: 0.22 }[bar[:sec]]
      next if bar[:sec] == :bare && i < 8   # piano alone first, then the clock creeps back
      next if bar[:sec] == :coda && i == PLAN.length - 1
      7.times do |k|
        play fig[k] + rrand(-0.12, 0.12), amp: amp * ACC[k], synth: :pretty_bell,
          release: 0.6, pan: (k.even? ? -0.35 : 0.35)
        sleep 1
      end
    end
  end
end

# clock ticks & small peculiar things in the intro
layer(:clock) do |bar, i|
  next unless bar[:sec] == :intro
  7.times do |k|
    sample (k == 0 ? :elec_wood : :elec_tick), amp: (k == 0 ? 0.5 : 0.25) * ACC[k], rate: 1.0 + i * 0.03, pan: -0.2
    sample :tabla_ke1, amp: 0.3, rate: 1.4 if k == 5 && i.odd?
    sleep 1
  end
end
layer(:clock) do |bar, i|
  next unless bar[:sec] == :intro && i == 0
  sample :ambi_glass_hum, amp: 0.25, rate: 0.75, attack: 3, release: 6
end

# ---------- piano: melody + left hand ----------
with_fx :reverb, room: 0.55, mix: 0.3 do
  layer(:piano) do |bar, i|
    next unless bar[:mel]
    vel = { bare: 0.5, room: 0.45, climb: 0.62, turn: 0.4, home: 0.6, coda: 0.38 }[bar[:sec]] || 0.5
    bar[:mel].each do |n, d|
      unless n == :r
        time_warp hum do
          play n, synth: :piano, vel: vel, hard: 0.3, amp: 0.55 * PG[bar[:sec]], sustain: d * 0.6, release: d * 0.6 + 0.4
        end
      end
      sleep d
    end
  end
  layer(:piano) do |bar, i|
    next if [:intro].include?(bar[:sec])
    bass, v = CH[bar[:ch]]
    soft = { bare: 0.35, room: 0.25, climb: 0.25, turn: 0.2, home: 0.3, coda: 0.28 }[bar[:sec]]
    if bar[:sec] == :coda && i == PLAN.length - 2
      play bass, synth: :piano, vel: soft, amp: 0.5 * PG[bar[:sec]], release: 7
      sleep 0.15
      v.each { |n| play n, synth: :piano, vel: soft, amp: 0.4 * PG[bar[:sec]], release: 7; sleep 0.12 }
      next
    end
    next if bar[:sec] == :coda && i == PLAN.length - 1
    play bass, synth: :piano, vel: soft + 0.05, amp: 0.45 * PG[bar[:sec]], release: 3
    time_warp(0.04) { play v, synth: :piano, vel: soft, amp: 0.28 * PG[bar[:sec]], release: 2 }
    sleep 4
    time_warp(hum) { play v, synth: :piano, vel: soft * 0.8, amp: 0.22 * PG[bar[:sec]], release: 1.5 }
  end
end

# ---------- the room: warm pad and strings ----------
with_fx :reverb, room: 0.85, mix: 0.5 do
  with_fx :lpf, cutoff: 95 do
    layer(:pad) do |bar, i|
      next unless [:room, :climb, :turn, :home].include?(bar[:sec])
      _, v = CH[bar[:ch]]
      amp = { room: 0.32, climb: 0.22, turn: 0.28, home: 0.3 }[bar[:sec]]
      play v, synth: :hollow, attack: 1.2, sustain: 4, release: 3, amp: amp * 1.4, cutoff: 90
      play v.map { |n| note(n) - 12 }, synth: :dark_ambience, attack: 1, release: 6, amp: amp * 0.25 if bar[:sec] == :turn
    end
  end
  # in the other room the melody is sung by a bowed voice an octave below
  layer(:strings) do |bar, i|
    next unless [:turn, :home].include?(bar[:sec]) && bar[:mel]
    bar[:mel].each do |n, d|
      play note(n) - (bar[:sec] == :turn ? 0 : 12), synth: :blade, amp: (bar[:sec] == :turn ? 0.4 : 0.32),
        attack: 0.15, sustain: d * 0.7, release: d * 0.5, vibrato_rate: 5.5, vibrato_depth: 0.12, cutoff: 95 unless n == :r
      sleep d
    end
  end
end

# ---------- bass ----------
with_fx :lpf, cutoff: 78 do
  layer(:bass) do |bar, i|
    bass, _ = CH[bar[:ch]]
    case bar[:sec]
    when :room, :turn
      play bass, synth: :sine, amp: 0.55, attack: 0.05, sustain: 4, release: 2.5
    when :climb, :home
      if bar[:ch] == :ebmaj7 && bar[:sec] == :climb
        play bass, synth: :fm, divisor: 1, depth: 0.8, amp: 0.6, sustain: 5, release: 2
        next
      end
      [[0, 1.5, 0], [2, 0.8, 12], [4, 0.9, 0], [5, 0.6, 7], [6, 0.7, 12]].each do |t, d, off|
        time_warp t do
          play note(bass) + off, synth: :fm, divisor: 1, depth: 0.7, amp: 0.7 * ACC[t] + 0.2, attack: 0.01, sustain: d * 0.5, release: d * 0.5
        end
      end
    end
  end
end

# ---------- drums: everybody's climbing the furniture ----------
with_fx :reverb, room: 0.35, mix: 0.18 do
  layer(:drums) do |bar, i|
    sec = bar[:sec]
    pos = PLAN[0..i].count { |b| b[:sec] == sec } - 1
    case sec
    when :room
      # brushes on a tabletop
      7.times { |k| sample :drum_cymbal_pedal, amp: 0.12 * ACC[k], rate: 1.2, pan: 0.3; sleep 1 }
    when :climb, :home
      last_climb = (sec == :climb && bar[:ch] == :ebmaj7)
      if last_climb
        sample :drum_splash_soft, amp: 0.4
        sample :drum_bass_soft, amp: 0.9
        next
      end
      7.times do |k|
        sample :drum_bass_soft, amp: 1.5 if k == 0 || k == 4
        sample :drum_bass_soft, amp: 0.65 if k == 6 && pos.odd?
        sample :drum_snare_soft, amp: (k == 2 ? 0.85 : 0.4) if k == 2 || k == 6
        sample :drum_cymbal_closed, amp: 0.3 * ACC[k], rate: 1.1, pan: 0.25
        sample :elec_wood, amp: 0.5, rate: 1.3, pan: -0.4 if k == 5
        sample :perc_snap, amp: 0.25, pan: 0.5 if k == 3 && pos % 4 == 3
        sample :tabla_na, amp: 0.3, rate: 1.1, pan: -0.3 if (k == 1 || k == 5) && sec == :home
        sleep 1
      end
    when :turn
      if pos < 7
        sample :drum_bass_soft, amp: 0.55
        sleep 4
        sample :drum_bass_soft, amp: 0.35
      else
        # a fill that walks back up the stairs
        sample :drum_bass_soft, amp: 0.7
        sleep 2
        [0.25, 0.32, 0.4, 0.5, 0.6].each_with_index do |a, k|
          sample [:drum_tom_lo_soft, :drum_tom_mid_soft, :drum_tom_hi_soft, :drum_snare_soft, :drum_snare_soft][k], amp: a + 0.15
          sleep 1
        end
      end
    end
  end
end

# a cymbal breath at the doors between rooms
layer(:drums) do |bar, i|
  prev = i > 0 ? PLAN[i - 1][:sec] : nil
  if prev && prev != bar[:sec] && [:room, :climb, :home].include?(bar[:sec])
    sample :drum_cymbal_soft, amp: 0.3
  end
end

# the last thing you hear: the clock's highest note, and then the hiss stops
layer(:clock) do |bar, i|
  next unless i == PLAN.length - 2
  sleep 3
  play :a6, synth: :pretty_bell, amp: 0.18, release: 4
end
