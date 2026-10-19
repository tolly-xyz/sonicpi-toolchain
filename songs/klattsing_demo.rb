# klattsing demo: vocal lines written as plain text + notes (no hand ARPABET). sp-klatt compiles the
# KLATT specs through klattsing/ and renders them; render with
#   bin/sp-render songs/klattsing_demo.rb out/klattsing_demo.mp3 -d 22
use_bpm 96

# ---- klattsch voices
KDIR = "#{defined?(SP_ROOT) ? SP_ROOT : Dir.pwd}/work/klattsing_demo/kvox"
KLATT = {
  carry: { mode: "sing", text: "Carry the lantern down to the water", bpm: 96, gate: 260, bank: "mitalk-bursts", transition: 70,
           notes: [["A2", 2], ["C3", 2], ["B2", 2], ["A2", 4], ["G2", 2], ["E2", 4], ["G2", 2], ["A2", 2], ["C3", 4], ["B2", 8]] },
  nobody: { mode: "speak", text: "Nobody saw it go.", pitch: "A2", bank: "mitalk-bursts", transition: 70 },
  window: { mode: "sing", text: "Every window holding a light", bpm: 96, bank: "mitalk-bursts", transition: 70,
            notes: "auto", melody: { scale: ["A2", "C3", "E3", "D3", "C3", "B2"], long: 4, short: 2, last: 8 } },
}
# ---- end klattsch voices
def klatt(name) = "#{KDIR}/#{name}.wav"

live_loop :chords do
  with_fx :reverb, room: 0.8, mix: 0.4 do
    use_synth :hollow
    play (chord (ring :a2, :f2, :c3, :e2).tick, :minor7), release: 4.2, amp: 0.7
  end
  sleep 4
end
live_loop :pulse do
  sample :bd_soft, amp: 1.2; sleep 1
  sample :elec_tick, amp: 0.6; sleep 1
end
in_thread do
  sleep 4
  with_fx :reverb, room: 0.6, mix: 0.25 do
    sample klatt(:carry), amp: 1.4; sleep 8
    sample klatt(:nobody), amp: 1.4; sleep 6
    sample klatt(:window), amp: 1.4
  end
end
