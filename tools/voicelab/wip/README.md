# Feature tournament work in progress

Commit series from the agents' worktrees (apply onto 45d6e2e with `git am`), saved here so a container
restart can't lose them. Status when saved:
- coarticulation.mbox: done. Fidelity 0.367 -> 0.756; Whisper pairs 46.8% -> 69.1% (McNemar p = 1.6e-6). Not yet independently verified.
- glottal-source.mbox: done. Fidelity 0.367 -> 1.039 (vowel brightness excess +12.5 dB -> +3.5 dB at 2-4 kHz); pairs 46.8% -> 46.0% (p = 1). Not yet verified.
- nasals.mbox, stops.mbox: unfinished (wip commits), cut off by a usage limit.
