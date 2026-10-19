#!/usr/bin/env python3
"""How late a rendered part sounds against its score, from its notes that start out of silence.
usage: onset_lag.py PART.wav SCORE.json PART"""
import json, os, sys
import soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
from mixkit import onset_lag, load
ev = json.load(open(sys.argv[2]))["parts"][sys.argv[3]]
times = [e["t"] for e in ev]
print(f"{sys.argv[3]}: sounds {onset_lag(load(sys.argv[1]), times):+d} ms against the score")
