use_bpm 110
live_loop :drums do
  sample :bd_haus, amp: 1.5
  sleep 0.5
  sample :sn_dolf, amp: 0.8 if (spread 1, 2).look
  sleep 0.5
  tick
end
live_loop :bass do
  use_synth :tb303
  play (ring :e1, :e1, :g1, :a1).tick, release: 0.3, cutoff: rrand(60, 110), res: 0.8
  sleep 0.5
end
live_loop :chords do
  with_fx :reverb, room: 0.8 do
    use_synth :prophet
    play (chord (ring :e3, :c3, :g3, :d3).tick, :minor7), release: 4, amp: 0.4
  end
  sleep 4
end
