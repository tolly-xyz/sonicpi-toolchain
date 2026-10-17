# The song's lyrics as on-screen lines, from the same LYRICS data the voices are rendered from.
# usage: ruby lyrics.rb SONG.rb > lyrics.json
# Each line: section, bar, style, and its words, timed in sixteenths of that bar (grid lines)
# or in milliseconds after the bar starts (free-timed lines).
require "json"
src = File.read(ARGV[0], encoding: "utf-8"); SP_ROOT = Dir.pwd
eval(src[/^# ---- klattsch voices\n(.*?)^# ---- end klattsch voices/m, 1])
PAUSE = { "," => 100, ";" => 200, "." => 300 }
out = []
LYRICS.each do |name, l|
  sec, k = l[:at]
  base = { name: name, sec: sec, k: k, style: l[:style], show: l[:show], delay_beats: l[:delay_beats] }.compact
  if l[:syls]
    line, word, at = [], nil, 0
    l[:syls].each do |txt, n, *|
      word ||= ["", at]; word[0] += txt.sub(/\n\z/, "")
      if txt.end_with?(" ", "\n") || txt == l[:syls].last[0]
        line << [word[0].strip, word[1]]; word = nil
      end
      at += n
      if txt.end_with?("\n") || txt == l[:syls].last[0]
        out << base.merge(steps: line, end_steps: at); line = []
      end
    end
  else
    at = 0
    words = l[:words].map { |w, ps| [w.strip, at].tap { at += ps.sum { |ms, ph| PAUSE[ph] || ms } } }
    out << base.merge(ms: words, end_ms: at)
  end
end
puts JSON.pretty_generate(out)
