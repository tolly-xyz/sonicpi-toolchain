# Funk (working title): the synth parts of a score shared with projects/funk/mix.py.
# projects/funk/score.py writes work/funk/score.json (times in seconds from the first beat, swing
# included); this plays the Minimoog-style bass and the lead from it. Render a stem by prepending
# `SOLO = [:moog]` or `SOLO = [:lead]`; projects/funk/build.sh does all of it.
require "json"
use_debug false
set_sched_ahead_time! 2
SC = JSON.parse(File.read("#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/funk/score.json"))
ONLY = defined?(SOLO) ? SOLO : [:moog, :lead]
use_bpm 60                                     # the score is in seconds

load_sample :elec_tick
sleep 1
sample :elec_tick, amp: 3                      # sync click; the song starts four beats later
sleep 4 * 60.0 / SC["bpm"]

# bass: a pulse through a plucky low-pass, a sine on the same note for weight (an octave down was 20 Hz)
if ONLY.include?(:moog)
  ev = SC["parts"]["moog"]
  at ev.map { |e| e["t"] }, ev do |e|
    v = e["vel"]; d = [e["dur"], 0.05].max
    use_synth :tb303
    s = play e["note"], wave: 1, pulse_width: 0.4, cutoff: 70 + 30 * v, cutoff_min: 52, cutoff_attack: 0,
             cutoff_decay: 0.09 + 0.06 * v, cutoff_sustain: 0, cutoff_release: d, res: 0.18,
             attack: 0.004, sustain: d * 0.8, release: 0.04, amp: 0.55 * v
    if e["slide_to"]
      control s, note: e["slide_to"], note_slide: d * 0.9
    end
    use_synth :sine
    play e["note"], attack: 0.004, sustain: d * 0.8, release: 0.05, amp: 0.5 * v
  end
end

# lead: a squiggly Prophet line that slides into some notes
if ONLY.include?(:lead)
  ev = SC["parts"]["lead"]
  prev = [nil]
  at ev.map { |e| e["t"] }, ev do |e|
    d = [e["dur"], 0.05].max
    use_synth :prophet
    from = e["slide"] && prev[0] ? prev[0] : e["note"]
    s = play from, cutoff: 105, res: 0.25, attack: 0.008, sustain: d, release: 0.12, amp: 0.45 * e["vel"], note_slide: 0.07
    control s, note: e["note"] if from != e["note"]
    prev[0] = e["note"]
  end
end
sleep SC["total"] + 3
