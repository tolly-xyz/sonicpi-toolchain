# Feature tournament work in progress

Commit series from agents' worktrees (apply with `git am -3`) saved so a container restart or usage limit cannot lose them.
Merged into main so far: coarticulation, glottal source, nasals, stops.

Pending: `r3-partial/prosody.diff`: uncommitted work of a round-3 agent cut off by a usage limit (apply with
`git apply --3way`), based on main at 391c2bd. (`r3-partial/fricatives.diff` was applied and finished on the
fricatives branch.)
