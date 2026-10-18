#!/usr/bin/env bash
# One-time setup on Ubuntu 24.04 (or Debian-likes with the same packages). Run with sudo available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  sonic-pi supercollider-server sc3-plugins-server jackd2 ruby ffmpeg nodejs \
  python3-venv python3-dev libcairo2-dev pkg-config \
  hydrogen-drumkits fluidsynth musescore-general-soundfont-lossless
# Python deps for the mix and video scripts (pycairo is built here, so any Python 3 works)
python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install --quiet pedalboard soundfile numpy scipy mido pycairo matplotlib pyloudnorm
chmod +x "$ROOT"/bin/* "$ROOT"/projects/*/build.sh "$ROOT"/projects/*/*.py
echo "done. Next: bin/sp-start, then e.g. bin/sp-render songs/demo.rb out/demo.mp3 -d 12"
