#!/usr/bin/env bash
# Radiator Teeth v2: render each Sonic Pi stem, then build drums/guitar/organ in Python and mix.
#   projects/radiator_teeth_v2/build.sh            -> all stems, then out/radiator_teeth_v2.{wav,mp3}
#   projects/radiator_teeth_v2/build.sh vox gtrL   -> re-render just those stems, then remix
#   projects/radiator_teeth_v2/build.sh mix        -> remix from the stems already rendered
#   projects/radiator_teeth_v2/build.sh video      -> remix, then draw out/radiator_teeth_v2.mp4
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/projects/radiator_teeth_v2"; W="$ROOT/work/radiator_teeth_v2"
SONG="$ROOT/songs/radiator_teeth_v2.rb"
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3
declare -A STEM=([gtrL]="SOLO = [:gtr]; TAKE = 1" [gtrR]="SOLO = [:gtr]; TAKE = 2" [bass]="SOLO = [:bass]; TAKE = 1"
                 [lead]="SOLO = [:lead]; TAKE = 1" [fx]="SOLO = [:fx]; TAKE = 1" [vox]="SOLO = [:vox]; TAKE = 1")
mkdir -p "$W/stems" "$ROOT/out"
ruby "$HERE/timeline.rb" "$SONG" > "$W/timeline.json"
want=("$@"); [ ${#want[@]} -eq 0 ] && want=(gtrL gtrR bass lead fx vox)
if [ "${want[0]}" != mix ] && [ "${want[0]}" != video ]; then
  "$ROOT/bin/sp-start"
  for s in "${want[@]}"; do
    [ -n "${STEM[$s]:-}" ] || { echo "unknown stem: $s (have: ${!STEM[*]})"; exit 1; }
    "$ROOT/bin/sp-render" "$SONG" "$W/stems/$s.wav" -d 77 -t 5 -p "${STEM[$s]}"
  done
fi
"$PY" "$HERE/mix.py" "$ROOT/out/radiator_teeth_v2.wav" --parts "$W/parts"
ffmpeg -y -loglevel error -i "$ROOT/out/radiator_teeth_v2.wav" -b:a 320k "$ROOT/out/radiator_teeth_v2.mp3"
echo "$ROOT/out/radiator_teeth_v2.mp3"
if [ "${want[0]}" = video ] || [ "${VIDEO:-}" = 1 ]; then
  # word timings for the lyrics come straight from klattsch's compiler
  ruby "$ROOT/tools/vox-inspect/dump_klatt.rb" "$SONG" > "$W/klatt_table.json"
  node "$ROOT/tools/vox-inspect/timing.mjs" < "$W/klatt_table.json" > "$W/klatt_timing.json"
  "$PY" "$HERE/draw.py" "$ROOT/out/radiator_teeth_v2.mp4"
fi
