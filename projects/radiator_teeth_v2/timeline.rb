# Dump the v2 score's bar grid as JSON (seconds from song start).
require "json"
PC = { "c"=>0, "d"=>2, "e"=>4, "f"=>5, "g"=>7, "a"=>9, "b"=>11 }
def note(n)
  return n if n.is_a?(Numeric)
  m = n.to_s.match(/\A([a-g])(s|#|b)?(-?\d+)\z/)
  12 * (m[3].to_i + 1) + PC[m[1]] + { "s"=>1, "#"=>1, "b"=>-1 }.fetch(m[2], 0)
end
def use_debug(*); end
def set_sched_ahead_time!(*); end
eval(File.read(ARGV[0]).split("# ---- end of score").first)
t = 0.0
out = PLAN.map do |b|
  st = 0.25 * 60.0 / b[:bpm]
  h = b.merge(t: t, step: st); t += b[:steps] * st; h
end
puts JSON.generate({ total: t, bars: out })
