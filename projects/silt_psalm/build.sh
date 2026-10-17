#!/usr/bin/env bash
# Silt Psalm: render each Sonic Pi stem, then build drums/guitar/organ in Python and mix.
#   projects/silt_psalm/build.sh            -> all stems, then out/silt_psalm.{wav,mp3}
#   projects/silt_psalm/build.sh vox gtrL   -> re-render just those stems, then remix
#   projects/silt_psalm/build.sh mix        -> remix from the stems already rendered
#   projects/silt_psalm/build.sh video      -> remix, then draw out/silt_psalm.mp4
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/projects/silt_psalm"; W="$ROOT/work/silt_psalm"
SONG="$ROOT/songs/silt_psalm.rb"
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
"$PY" "$HERE/mix.py" "$ROOT/out/silt_psalm.wav" --parts "$W/parts"
ffmpeg -y -loglevel error -i "$ROOT/out/silt_psalm.wav" -b:a 320k "$ROOT/out/silt_psalm.mp3"
echo "$ROOT/out/silt_psalm.mp3"
if [ "${want[0]}" = video ] || [ "${VIDEO:-}" = 1 ]; then
  # the on-screen words come from the same LYRICS data the voices are rendered from
  ruby "$HERE/lyrics.rb" "$SONG" > "$W/lyrics.json"
  "$PY" "$HERE/draw.py" "$ROOT/out/silt_psalm.mp4"
fi
