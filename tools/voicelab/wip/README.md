# Unfinished feature work

Patches from the feature tournament (agents in isolated worktrees) that were cut off by a usage limit before
they could finish, measure and commit. Apply on top of commit e0351f1 with `git apply`. Not merged: unverified.

- coarticulation.patch: smooth formant transitions + locus-equation consonant-vowel coarticulation (engine + klattsing)
- glottal-source.patch: LF-style voice source with spectral tilt, jitter/shimmer, pitch-synchronous aspiration (engine);
  Whisper pairs: base 46.8%, feature 46.8% (no significant change in any class); fidelity not measured
