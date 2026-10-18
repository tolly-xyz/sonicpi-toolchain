# Silt Psalm (the music of Radiator Teeth, with words; synth stems for an outside mix)
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
#   I    They paved the valley with the sky / and taught the river how to stand.
#        The steeple wears a crown of gulls. / I keep the hour in my hand.
#   II   Fish go walking through the font. / The pews are full. (Sun- Sun- Sunday?)
#        Your kettle drinks us every morning / and never tastes the bells. (a- a- amen.)
#   ch.  Lower the bucket, lower the bell, / down where the hour is drowned.
#        Every Sunday under the water / rings without a sound.
#   br.  keep your voice down. they're still praying. / don't drink from the tap after dark.
#   bl.  by the mark three, by the deep four ... by the deep nine, no bottom! (soundings)
#   III  Some dry summer the lake gives way / and we come walking up the lane /
#        in our Sunday clothes, still wet.
#   end  still Sunday.
# ---- klattsch voices
eval(File.read("#{SP_ROOT}/lib/worddict.rb"))
KDIR = "#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/silt_psalm/kvox"
def hz(m) = (440 * 2 ** ((m - 69) / 12.0)).round(1)
def st(n, bpm = 168) = (n * 15000.0 / bpm).round(1)        # sixteenths -> ms
# Rough natural consonant lengths (ms). klattsch renders a stop as closure silence plus a
# 25 ms burst, so stops stay short or they open holes in the word.
CONS_MS = Hash.new(60).merge(
  "P" => 55, "B" => 45, "T" => 55, "D" => 40, "K" => 60, "G" => 45, "CH" => 90, "JH" => 75,
  "S" => 95, "Z" => 75, "SH" => 100, "F" => 85, "V" => 55, "TH" => 85, "DH" => 40, "HH" => 60,
  "M" => 65, "N" => 50, "NG" => 70, "L" => 55, "R" => 50, "W" => 55, "Y" => 45)
# A held diphthong is sung on its first vowel and glides at the very end.
BANK = "[bank=silt-stops]"
ASP_MS = 35
DIPH = { "AY" => %w[AA IY], "EY" => %w[EH IY], "OW" => %w[AO UW], "AW" => %w[AA UW], "OY" => %w[AO IY] }
# Every pitch is a named note and every glide ends on one, so the voice stays in E phrygian
# (E F G A B C D, plus the tritone Bb); the blast climbs Bb phrygian. klattsch pitch moves are
# in Hz, so `d` converts.
E1, F1, G1, A1, BB1, B1, C2, DB2, D2, EB2, E2, F2, GB2, G2, AB2, A2, BB2, B2, C3 =
  28, 29, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48
def d(from, to) = format("%+.1f", hz(to) - hz(from))         # Hz glide from one note to another
# One syllable in a slot of `ms`. The vowel lands on the slot's start: the onset consonants
# (pre_ms long) sound just before it, borrowed from the previous slot, and the slot's own tail
# lends `next_ms` to the next syllable's onset. An accent leans harder on the vowel only.
#   pitch: the note   to: the note the vowel slides to   scoop: start this many semitones flat
#   vib: a vibrato (about +-0.4 semitone) that blooms after the first third of a long vowel
#   gate: cut the vowel off after this many ms and rest for the rest of the slot (short, barked)
def syl_ms(ms, pre, vowel, post = [], pitch: nil, to: nil, scoop: 0, vib: false, gate: nil, pre_ms: nil, next_ms: 0, accent: false, post_x: [])
  pre_ms ||= pre.map { |p| CONS_MS[p] }
  coda = post.each_with_index.map { |p, j| CONS_MS[p] * (post_x[j] || 1) }
  avail = ms - next_ms
  v = avail - coda.sum
  if v < 45                                                  # crowded: squeeze consonants, not the vowel
    k = [(avail - 45) / coda.sum.to_f, 0.5].max; coda = coda.map { |c| (c * k).round(1) }; v = avail - coda.sum
  end
  asp = %w[P T K].include?(pre.last) ? ASP_MS : 0          # a breath after P T K before the vowel, as spoken
  v -= asp
  rest = 0
  if gate && v > gate then rest = v - gate; v = gate end
  out = +"v0 "
  out << "b#{hz(pitch - scoop)} " if pitch
  pre.each_with_index { |p, i| out << "r#{pre_ms[i].round(1)} #{p} " }
  out << "r#{asp} HH " if asp > 0
  out << "g+0.15 t+0.15 " if accent
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
  out << "g-0.15 t-0.15 " if accent
  coda.each_with_index { |c, i| out << "r#{c} #{post[i]} " }
  out << "p#{rest.round(1)} " if rest > 0
  out
end
# A line on the beat grid is a list of syllables:
#   [shown text, sixteenths, note, onset consonants, vowel, coda consonants, options]
# Text ending in a space ends a word; "\n" ends a line on screen. `map` transposes the notes.
# Syllables on a peak (A2 and up, before the map) are accented unless accent_from is nil.
# The rendered line starts lead(syls) ms before its first vowel, which sits on the downbeat.
def onsets(syls, bpm)
  slots = syls.map { |s| st(s[1], bpm) }
  pre = syls.map { |s| s[3].map { |p| CONS_MS[p] } }
  (1...syls.size).each do |i|                                # no more than 40% of the slot before
    budget = slots[i - 1] * 0.4; sum = pre[i].sum
    pre[i] = pre[i].map { |c| c * budget / sum } if sum > budget
  end
  [slots, pre]
end
def lead(syls) = syls[0][3].sum { |p| CONS_MS[p] }
# ON_BEAT puts vowels on the beat (onsets borrowed from the slot before). Whisper heard no
# gain from it in the verses and lost the chorus ("Mel over the" for "Lower the"), so it's off.
ON_BEAT = false
HOLD = 0.55
# Each word's consonants, scaled by how a real voice times that word (lib/worddict.rb):
# per syllable, [onset factors, coda factors]. WORD_TIMING = false uses CONS_MS as is.
WORD_TIMING = true
WORD_LO = 1.0                                # lengthen where a voice lingers; never clip below the singing table
def word_shape(syls)
  out = []; word = []
  flush = lambda do
    txt = word.map { |s| s[0] }.join; phones = word.flat_map { |s| s[3] + [s[4]] + (s[5] || []) }
    f = WORD_TIMING ? word_factors(txt.strip, phones, lo: WORD_LO) : phones.map { nil }
    word.each { |s| a = s[3].size; b = (s[5] || []).size; out << [f.shift(a), (f.shift; f.shift(b))] }
    word = []
  end
  syls.each { |s| word << s; flush.() if s[0] =~ /[\s]\z/ }
  flush.() unless word.empty?
  out
end
def sing(syls, bpm = 168, map = ->(m) { m }, gate: nil, accent_from: A2, on_beat: ON_BEAT)
  slots, pre = onsets(syls, bpm)
  shape = word_shape(syls)
  syls.each_with_index.map do |(txt, n, nt, ons, vowel, post, o), i|
    o = { gate: gate }.merge(o || {}); o[:to] = map.(o[:to]) if o[:to]
    o[:gate] = [o[:gate], slots[i] * HOLD].max if o[:gate] && n >= 6
    lx = o.delete(:onset_x) || 1                              # a held onset, so a line's first word reads
    acc = o.key?(:accent) ? o.delete(:accent) : !accent_from.nil? && nt >= accent_from
    nxt = (pre[i + 1] || []).sum
    nxt, pre[i] = 0, ons.each_with_index.map { |p, j| CONS_MS[p] * lx * (shape[i][0][j] || 1) } unless on_beat   # consonant on the beat
    syl_ms(on_beat ? slots[i] : slots[i] - pre[i].sum, ons, vowel, post || [], pitch: map.(nt), pre_ms: pre[i], next_ms: nxt,
           accent: acc, post_x: shape[i][1], **o)
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
BY = ->(n) { [["by ", 2, n, %w[B], "AY"], ["the ", 2, n, %w[DH], "AH"]] }
STUTTER = ->(txt, nt, pre, vowel, post = []) { ["#{txt} ", 3, nt, pre, vowel, post] }
LYRICS = {
  # I: declaimed over most of two bars, around G F E, up to A on the weight,
  # lines falling to D or diving to the tritone
  v1a: { at: [:a, 0], style: :shout, syls: [
    ["They ", 2, E2, %w[DH], "EY"], ["paved ", 4, G2, %w[P], "EY", %w[V D], { to: F2 }], ["the ", 2, F2, %w[DH], "AH"],
    ["val", 3, A2, %w[V], "AE"], ["ley ", 2, G2, %w[L], "IY"], ["with ", 2, F2, %w[W], "IH", %w[DH]], ["the ", 2, F2, %w[DH], "AH"],
    ["sky", 7, E2, %w[S K], "AY", [], { to: D2 }]] },
  v1b: { at: [:a, 2], style: :shout, syls: [
    ["and ", 2, F2, [], "AH", %w[N]], ["taught ", 4, G2, %w[T], "AO", %w[T], { to: F2 }], ["the ", 2, F2, %w[DH], "AH"],
    ["riv", 3, A2, %w[R], "IH", %w[V]], ["er ", 2, G2, [], "ER"], ["how ", 3, F2, %w[HH], "AW"], ["to ", 2, F2, %w[T], "AH"],
    ["stand.", 7, E2, %w[S T], "AE", %w[N D], { to: BB1 }]] },
  v1c: { at: [:a, 4], style: :shout, syls: [
    ["The ", 2, E2, %w[DH], "AH"], ["stee", 4, G2, %w[S T], "IY", [], { to: F2 }], ["ple ", 2, F2, %w[P], "AH", %w[L]],
    ["wears ", 3, G2, %w[W], "EH", %w[R Z]], ["a ", 2, F2, [], "AH"], ["crown ", 4, A2, %w[K R], "AW", %w[N], { to: G2 }],
    ["of ", 2, F2, [], "AH", %w[V]], ["gulls.", 7, E2, %w[G], "AH", %w[L Z], { to: D2 }]] },
  v1d: { at: [:a, 6], style: :shout, syls: [
    ["I ", 2, F2, [], "AY"], ["keep ", 4, G2, %w[K], "IY", %w[P]], ["the ", 2, F2, %w[DH], "AH"],
    ["hour ", 5, A2, [], "AW", %w[R], { to: G2 }], ["in ", 2, F2, [], "IH", %w[N]], ["my ", 3, F2, %w[M], "AY"],
    ["hand.", 7, E2, %w[HH], "AE", %w[N D], { to: BB1 }]] },
  # II: the short bars stammer up the scale toward a word they can't finish
  v2a: { at: [:a2, 0], style: :shout, syls: [
    ["Fish ", 3, G2, %w[F], "IH", %w[SH]], ["go ", 2, F2, %w[G], "OW"], ["walk", 3, A2, %w[W], "AO", %w[K], { to: G2 }],
    ["ing ", 2, F2, [], "IH", %w[NG]], ["through ", 3, G2, %w[TH R], "UW"], ["the ", 2, F2, %w[DH], "AH"],
    ["font.", 7, E2, %w[F], "AA", %w[N T], { to: D2 }]] },
  v2b: { at: [:a2, 2], style: :shout, syls: [
    ["The ", 2, F2, %w[DH], "AH"], ["pews ", 5, A2, %w[P Y], "UW", %w[Z], { to: G2 }], ["are ", 2, F2, [], "AA", %w[R]],
    ["full.", 7, E2, %w[F], "UH", %w[L], { to: D2 }]] },
  v2s1: { at: [:a2, 3], style: :stuck, syls: [
    STUTTER.("Sun-", F2, %w[S], "AH", %w[N]), STUTTER.("Sun-", G2, %w[S], "AH", %w[N]), STUTTER.("Sun-", A2, %w[S], "AH", %w[N]),
    STUTTER.("Sun-", B2, %w[S], "AH", %w[N]), ["Sun", 1, C3, %w[S], "AH", %w[N]], ["day?", 2, C3, %w[D], "EY", [], { to: E2 }]] },
  v2c: { at: [:a2, 4], style: :shout, syls: [
    ["Your ", 2, F2, %w[Y], "ER"], ["ket", 3, G2, %w[K], "EH", %w[T]], ["tle ", 2, F2, [], "AH", %w[L]],
    ["drinks ", 5, A2, %w[D R], "IH", %w[NG K S], { to: G2 }], ["us ", 2, F2, [], "AH", %w[S]], ["ev", 2, G2, [], "EH", %w[V]],
    ["ery ", 2, F2, %w[R], "IY"], ["morn", 3, G2, %w[M], "AO", %w[R N]], ["ing", 5, E2, [], "IH", %w[NG], { to: D2 }]] },
  v2d: { at: [:a2, 6], style: :shout, syls: [
    ["and ", 1, F2, [], "AH", %w[N]], ["nev", 2, G2, %w[N], "EH", %w[V]], ["er ", 2, F2, [], "ER"],
    ["tastes ", 4, A2, %w[T], "EY", %w[S T S], { to: G2 }], ["the ", 2, F2, %w[DH], "AH"], ["bells.", 5, E2, %w[B], "EH", %w[L Z], { to: BB1 }]] },
  v2s2: { at: [:a2, 7], style: :stuck, syls: [
    STUTTER.("a-", F2, [], "AA"), STUTTER.("a-", G2, [], "AA"), STUTTER.("a-", A2, [], "AA"), STUTTER.("a-", B2, [], "AA"),
    ["a", 1, C3, [], "AA"], ["men.", 2, C3, %w[M], "EH", %w[N], { to: E2 }]] },
  # chorus: clipped syllables locked to the guitar's 3+3+3+3+4 hits (sixteenths 0 3 6 9 12 of
  # each bar), the stresses on the group starts; a ghost a diatonic third above for the second half
  chorus: { at: [:b, 0], style: :sung, ghost_from: 64, syls: [
    ["Low", 3, E2, %w[L], "OW", [], { onset_x: 1.8, accent: true }], ["er ", 3, G2, [], "ER"], ["the ", 3, F2, %w[DH], "AH"], ["buck", 3, A2, %w[B], "AH"],
    ["et, ", 4, G2, %w[K], "IH", %w[T]], ["low", 3, F2, %w[L], "OW", [], { onset_x: 1.8, accent: true }], ["er ", 3, E2, [], "ER"], ["the ", 6, D2, %w[DH], "AH"],
    ["bell,\n", 4, E2, %w[B], "EH", %w[L], { to: F2, onset_x: 1.5, accent: true }],
    ["down ", 3, B2, %w[D], "AW", %w[N]], ["where ", 3, A2, %w[W], "EH", %w[R]], ["the ", 3, G2, %w[DH], "AH"],
    ["hour ", 3, F2, [], "AW", %w[R]], ["is ", 4, E2, [], "IH", %w[Z]], ["drowned.\n", 16, E2, %w[D R], "AW", %w[N D], { to: D2 }],
    ["Ev", 3, E2, [], "EH", %w[V]], ["ery ", 3, F2, %w[R], "IY"], ["Sun", 3, A2, %w[S], "AH", %w[N]], ["day ", 3, G2, %w[D], "EY"],
    ["un", 4, F2, [], "AH", %w[N]], ["der ", 3, E2, %w[D], "ER"], ["the ", 3, F2, %w[DH], "AH"], ["wa", 3, G2, %w[W], "AO"],
    ["ter\n", 7, F2, %w[T], "ER", [], { to: E2 }],
    ["rings ", 3, B2, %w[R], "IH", %w[NG Z]], ["with", 3, A2, %w[W], "IH", %w[DH]], ["out ", 3, G2, [], "AW", %w[T]],
    ["a ", 3, F2, [], "AH"], ["sound.", 20, E2, %w[S], "AW", %w[N D], { to: BB1 }]] },
  # breakdown: breathy, free-timed, sinking G -> F -> E
  w1: { at: [:down, 1], style: :whisper, pitch: G1, words: [
    ["keep ", [[60, "K"], [180, "IY"], [50, "P"]]], ["your ", [[45, "Y"], [120, "ER"]]], ["voice ", [[55, "V"], [260, "OY#{d(G1, F1)}"], [90, "S"]]],
    ["down. ", [[40, "D"], [240, "AW#{d(F1, E1)}"], [90, "N"], [0, "."]]], ["they're ", [[40, "DH"], [140, "EH"], [60, "R"]]],
    ["still ", [[90, "S"], [50, "T"], [160, "IH"], [80, "L"]]], ["praying.", [[55, "P"], [50, "R"], [200, "EY"], [80, "IH"], [220, "NG"]]]] },
  w2: { at: [:down, 4], style: :whisper, pitch: F1, words: [
    ["don't ", [[40, "D"], [220, "OW"], [60, "N"], [50, "T"]]], ["drink ", [[40, "D"], [50, "R"], [150, "IH"], [70, "NG"], [60, "K"]]],
    ["from ", [[80, "F"], [50, "R"], [90, "AH"], [60, "M"]]], ["the ", [[40, "DH"], [70, "AH"]]], ["tap ", [[55, "T"], [220, "AE"], [60, "P"]]],
    ["after ", [[180, "AE"], [80, "F"], [50, "T"], [120, "ER"]]], ["dark.", [[40, "D"], [380, "AA#{d(F1, E1)}"], [70, "R"], [60, "K"]]]] },
  # blast: a leadsman's soundings, one call per bar, deeper each time, climbing Bb phrygian
  s3: { at: [:blast, 0], style: :number, show: "MARK 3", syls: ->(n, nx) { BY.(n) + [["mark ", 3, n, %w[M], "AA", %w[R K]], ["three", 3, n, %w[TH R], "IY"]] } },
  s4: { at: [:blast, 1], style: :number, show: "DEEP 4", syls: ->(n, nx) { BY.(n) + [["deep ", 2, n, %w[D], "IY", %w[P]], ["four", 4, n, %w[F], "AO", %w[R], { to: nx }]] } },
  s5: { at: [:blast, 2], style: :number, show: "MARK 5", syls: ->(n, nx) { BY.(n) + [["mark ", 3, n, %w[M], "AA", %w[R K]], ["five", 3, n, %w[F], "AY", %w[V], { to: nx }]] } },
  s6: { at: [:blast, 3], style: :number, show: "DEEP 6", syls: ->(n, nx) { BY.(n) + [["deep ", 2, n, %w[D], "IY", %w[P]], ["six", 4, n, %w[S], "IH", %w[K S], { to: nx }]] } },
  s7: { at: [:blast, 4], style: :number, show: "MARK 7", syls: ->(n, nx) { BY.(n) + [["mark ", 3, n, %w[M], "AA", %w[R K]], ["sev", 2, n, %w[S], "EH", %w[V]], ["en", 2, n, [], "AH", %w[N], { to: nx }]] } },
  s8: { at: [:blast, 5], style: :number, show: "DEEP 8", syls: ->(n, nx) { BY.(n) + [["deep ", 2, n, %w[D], "IY", %w[P]], ["eight", 4, n, [], "EY", %w[T], { to: nx }]] } },
  s9: { at: [:blast, 6], style: :number, show: "DEEP 9", syls: ->(n, nx) { BY.(n) + [["deep ", 2, n, %w[D], "IY", %w[P]], ["nine", 4, n, %w[N], "AY", %w[N], { to: nx }]] } },
  s0: { at: [:blast, 7], style: :number, show: "NO BOTTOM", syls: ->(n, nx) { [["no ", 2, n, %w[N], "OW"], ["bot", 2, n, %w[B], "AA"], ["tom!", 4, n, %w[T], "AH", %w[M], { to: nx }]] } },
  # III
  v3a: { at: [:a3, 0], style: :shout, syls: [
    ["Some ", 3, F2, %w[S], "AH", %w[M]], ["dry ", 3, G2, %w[D R], "AY"], ["sum", 3, A2, %w[S], "AH", %w[M]], ["mer ", 2, G2, [], "ER"],
    ["the ", 2, F2, %w[DH], "AH"], ["lake ", 4, A2, %w[L], "EY", %w[K], { to: G2 }], ["gives ", 3, F2, %w[G], "IH", %w[V Z]],
    ["way", 7, E2, %w[W], "EY", [], { to: D2 }]] },
  v3b: { at: [:a3, 2], style: :shout, syls: [
    ["and ", 2, F2, [], "AH", %w[N]], ["we ", 2, F2, %w[W], "IY"], ["come ", 3, G2, %w[K], "AH", %w[M]], ["walk", 3, A2, %w[W], "AO", %w[K], { to: G2 }],
    ["ing ", 2, F2, [], "IH", %w[NG]], ["up ", 2, G2, [], "AH", %w[P]], ["the ", 2, F2, %w[DH], "AH"], ["lane", 8, E2, %w[L], "EY", %w[N], { to: D2 }]] },
  v3c: { at: [:a3, 4], style: :shout, syls: [
    ["in ", 2, E2, [], "IH", %w[N]], ["our ", 3, G2, [], "AW", %w[R]], ["Sun", 3, A2, %w[S], "AH", %w[N]], ["day ", 3, G2, %w[D], "EY"],
    ["clothes, ", 5, F2, %w[K L], "OW", %w[DH Z]], ["still ", 4, G2, %w[S T], "IH", %w[L]], ["wet.", 8, E2, %w[W], "EH", %w[T], { to: BB1 }]] },
  # after the seizure: plain, close, from G down to the root
  last: { at: [:tail, 0], style: :last, delay_beats: 2, pitch: G2, words: [
    ["still ", [[90, "S"], [50, "T"], [200, "IH"], [90, "L"]]],
    ["Sunday.", [[90, "S"], [200, "AH"], [60, "N"], [40, "D"], [360, "EY#{d(G2, E2)}"]]]] },
}
# the blast readings are written against their bar's note
LYRICS.each_value.select { |l| l[:style] == :number }.each do |l|
  k = l[:at][1]; l[:bpm] = 184; l[:syls] = l[:syls].(BLAST[k], BLAST[[k - 1, 0].max])
end
VOICE = { shout: "g0.8 t0.35 h0.12 s0.97", under: "g0.7 t0.1 h0.2 s0.9", stuck: "g0.75 t0.3 h0.1",
          sung: "g0.55 t0.1 h0.06", ghost: "g0.4 h0.3 s1.15", whisper: "g0.25 h0.55 t-0.2", last: "g0.45 t-0.1 h0.08",
          shout2: "g0.74 t0.28 h0.16 s1.01" }
# Every grid-timed syllable is clipped short (vowel in ms), the rest of its slot left silent;
# a long note (6+ sixteenths) holds for HOLD of its slot instead, so line ends ring.
GATE = { shout: 150, number: 130, sung: 190 }
# the second takes: another throat (VOICE *2), a few cents off, played a little late and to the side
DETUNE = ->(c) { ->(m) { m + c / 100.0 } }
KLATT = {}
LEAD = Hash.new(0)                                           # ms each line starts before its first vowel
LYRICS.each do |name, l|
  case l[:style]
  when :shout
    KLATT[name] = "#{VOICE[:shout]} #{sing(l[:syls], gate: GATE[:shout])}"
    KLATT[:"#{name}_dbl"] = "#{VOICE[:shout2]} #{sing(l[:syls], 168, DETUNE.(8), gate: GATE[:shout])}"
    KLATT[:"#{name}_lo"] = "#{VOICE[:under]} #{sing(l[:syls], 168, UNDER5, gate: GATE[:shout], accent_from: nil)}"
  when :stuck then KLATT[name] = "#{VOICE[:stuck]} #{sing(l[:syls], gate: GATE[:shout])}"
  when :number
    KLATT[name] = "#{VOICE[:shout]} #{sing(l[:syls], 184, gate: GATE[:number], accent_from: nil)}"
    KLATT[:"#{name}_lo"] = "#{VOICE[:under]} #{sing(l[:syls], 184, ->(m) { m - 12 }, gate: GATE[:number], accent_from: nil)}"   # an octave under
  when :sung
    at = 0; later = l[:syls].select { |s| (at += s[1]) > l[:ghost_from] }
    ghost_in = st(l[:ghost_from]) + (ON_BEAT ? lead(l[:syls]) - lead(later) : 0)
    KLATT[name] = "#{VOICE[:sung]} #{sing(l[:syls], gate: GATE[:sung])} [voice=1] p#{ghost_in.round(1)} #{VOICE[:ghost]} #{sing(later, 168, method(:third_up), gate: GATE[:sung], accent_from: nil)}"
  when :whisper, :last then KLATT[name] = "#{VOICE[l[:style]]} #{speak(l[:pitch], l[:words])}"
  end
  LEAD[name] = lead(l[:syls]) if ON_BEAT && l[:syls]
end
# every line through the stop bank (banks/silt-stops.json): burst frequencies measured from a TTS voice
KLATT.transform_values! { |s| "#{BANK} #{s.gsub("[voice=1]", "[voice=1] #{BANK}")}" }
# ---- end klattsch voices
def klatt(name) = "#{KDIR}/#{name}.wav"
def lines_at(bar, *styles) = LYRICS.select { |_, l| styles.include?(l[:style]) && l[:at] == [bar[:sec], bar[:k]] }
# a line's first vowel lands on the beat, so its consonants start early; a second take sits `late` s behind
def voice_in(name, late = 0, &blk) = time_warp(rt(late - LEAD[name] / 1000.0), &blk)

# shouted through a blown megaphone: a second take on the right, the low double a fifth under on the left
with_fx :lpf, cutoff: 118 do
  with_fx :hpf, cutoff: 55 do
    with_fx :distortion, distort: 0.55, mix: 0.45 do
      layer(:vox) do |bar, i|
        lines_at(bar, :shout, :stuck).each do |name, l|
          voice_in(name) { sample klatt(name), amp: 1.3 }
          next unless l[:style] == :shout
          voice_in(name, 0.017) { sample klatt(:"#{name}_dbl"), amp: 0.6, pan: 0.55 }
          voice_in(name, 0.006) { sample klatt(:"#{name}_lo"), amp: 0.5, pan: -0.45 }
        end
      end
    end
  end
end

# sung on the exact notes (klattsch takes the pitch and length directly)
with_fx :reverb, room: 0.7, mix: 0.3 do
  with_fx :distortion, distort: 0.4, mix: 0.4 do
    layer(:vox) do |bar, i|
      # one take: a double here smeared the words (Whisper heard "Mel over the" for "Lower the")
      lines_at(bar, :sung).each_key { |name| voice_in(name) { sample klatt(name), amp: 1.4 } }
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
        voice_in(name) { sample klatt(name), amp: 1.3 }
        voice_in(name) { sample klatt(:"#{name}_lo"), amp: 0.5 }
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
