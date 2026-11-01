---
description: T2 - architecture drift review, actual module graph vs the spec, findings decided at Gate 4 (every 2-3 merges and at the end)
argument-hint: <slug>
---
Review architecture drift for feature "$1".

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, features dir) and `git fetch origin`. Read `<features dir>/$1/spec.md` (module map, contracts, scale targets) and the latest `arch-*.md` if there is one. Then look at the code as it is on `origin/<main>` now: derive the real modules and dependencies from imports and build files, not from the spec.

Write `<features dir>/$1/arch-<yyyy-mm-dd>.md` with:
1. **Actual module diagram** - Mermaid `flowchart LR`, one node per module labelled `name - public interface in one line`, `A --> B` = A depends on B's public API; edges present in the code but not in the spec in red (`stroke:#dc2626`); modules or edges planned in the spec but absent from the code dashed (`stroke-dasharray: 5 5`); a one-line legend.
2. **Scores** - each module 1-5 with one line of evidence: single responsibility, depth (small interface, substantial hidden behavior), contract clarity, dependency direction (acyclic, toward stable modules), testable at its boundary, scale fit (against the spec's targets: unbounded growth, hot spots, single points of failure, behavior under overload).
3. **Findings** - numbered, ordered by how much they will hurt later (the cost of changing it once more code depends on it). Each: what differs or smells, where (file or interface), and your proposed resolution: `code` (change the code), `spec` (change the spec) or `accept`.
4. **Look yourself** - up to 5 files or interfaces I should read, with why.

Do not edit code. Be direct; do not soften findings.

## Gate 4 (stop here)
In chat, post the gate card: the diagram, a summary in at most 10 lines, the numbered findings with proposed resolutions, and ask me to decide each (`1:code 2:spec 3:accept`). On my answer run `node ~/.pi/agent/dt/dt.mjs gate $1 4 approve --note "<my decisions>"`. For every `spec` decision, append a dated **Amendments** entry to spec.md (do not rewrite history) and update its module diagram. For every `code` decision, say whether it fits an existing ticket or needs a new one; I decide, you do not create tickets here. Then run `node ~/.pi/agent/dt/dt.mjs status $1` so the overview shows the new findings. Reply with at most 5 bullets.
