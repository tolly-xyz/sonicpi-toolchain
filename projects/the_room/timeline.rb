# Evaluate the song's score (not its sound) and dump bar/note times as JSON.
require "json"
PC = { "c"=>0, "d"=>2, "e"=>4, "f"=>5, "g"=>7, "a"=>9, "b"=>11 }
def note(n)
  return n if n.is_a?(Numeric)
  s = n.to_s; m = s.match(/\A([a-g])(s|#|b)?(-?\d+)\z/) or raise "bad note #{n}"
  12 * (m[3].to_i + 1) + PC[m[1]] + { "s"=>1, "#"=>1, "b"=>-1 }.fetch(m[2], 0)
end
def use_debug(*); end
def use_random_seed(*); end
src = File.read(ARGV[0]).split("# Rehearsal controls").first
eval(src)
t = 0.0; bars = []
PLAN.each_with_index do |bar, i|
  e = 60.0 / bar[:bpm]
  notes = []; o = 0
  (bar[:mel] || []).each { |n, d| notes << { t: t + o * e, dur: d * e, midi: note(n) } unless n == :r; o += d }
  bass, voicing = CH[bar[:ch]]
  bars << { i: i, t: t, eighth: e, sec: bar[:sec], ch: bar[:ch], bass: note(bass), voicing: voicing.map { |n| note(n) }, notes: notes }
  t += 7 * e
end
puts JSON.pretty_generate({ total: t, bars: bars })
