#!/usr/bin/env bash
# The Room With The Crooked Clock: render the song, then draw the video to out/.
#   projects/the_room/build.sh           -> out/the_room.mp3 and out/the_room.mp4
#   projects/the_room/build.sh audio     -> just the mp3
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/projects/the_room"; W="$ROOT/work/the_room"
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3
mkdir -p "$W" "$ROOT/out"
"$ROOT/bin/sp-start"
"$ROOT/bin/sp-render" "$ROOT/songs/the_room.rb" "$W/raw.wav" -d 150 -t 8
# drop the server's start-up silence so the music starts at 0, then fade the tail
ffmpeg -y -loglevel error -i "$W/raw.wav" \
  -af "silenceremove=start_periods=1:start_threshold=-60dB,afade=t=out:st=146.5:d=1.5" -t 148 -b:a 256k "$ROOT/out/the_room.mp3"
[ "${1:-}" = audio ] && exit 0
ruby "$HERE/timeline.rb" "$ROOT/songs/the_room.rb" > "$W/timeline.json"
"$PY" "$HERE/draw.py" "$W/timeline.json" "$ROOT/out/the_room.mp3" "$ROOT/out/the_room.mp4"
