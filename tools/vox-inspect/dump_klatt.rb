# Print a song's KLATT table as JSON (same evaluation as sp-klatt).
require "json"
src = File.read(ARGV[0], encoding: "utf-8"); SP_ROOT = Dir.pwd
eval(src[/^# ---- klattsch voices\n(.*?)^# ---- end klattsch voices/m, 1])
puts JSON.generate(KLATT)
