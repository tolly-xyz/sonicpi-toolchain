#!/usr/bin/env bash
# Funk: score -> Sonic Pi stems (moog, lead) -> sampled parts + mix -> out/funk.{wav,mp3}
#   projects/funk/build.sh            all of it
#   projects/funk/build.sh mix        remix from the stems already rendered
#   projects/funk/build.sh video      remix, then draw out/aint_no_floor.mp4
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/projects/funk"; W="$ROOT/work/funk"
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3
mkdir -p "$W/stems" "$ROOT/out"
python3 "$HERE/score.py"
DUR=$(python3 -c "import json; print(round(json.load(open('$W/score.json'))['total'] + 4, 1))")
if [ "${1:-}" != mix ] && [ "${1:-}" != video ]; then
  "$ROOT/bin/sp-start"
  for s in moog lead; do "$ROOT/bin/sp-render" "$ROOT/songs/funk.rb" "$W/stems/$s.wav" -d "$DUR" -t 3 -p "SOLO = [:$s]"; done
fi
"$PY" "$HERE/mix.py" "$ROOT/out/funk.wav" --parts "$W/parts"
ffmpeg -y -loglevel error -i "$ROOT/out/funk.wav" -b:a 320k "$ROOT/out/funk.mp3"
echo "$ROOT/out/funk.mp3"
if [ "${1:-}" = video ] || [ "${VIDEO:-}" = 1 ]; then "$PY" "$HERE/draw.py" "$ROOT/out/aint_no_floor.mp4"; fi
