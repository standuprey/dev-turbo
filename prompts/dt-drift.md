---
description: T2 - architecture drift review, actual module graph vs the spec, findings decided at Architecture drift (every 2-3 merges and at the end)
argument-hint: "[apply]"
---
Review architecture drift for feature "$1". Mode: "$2".

If mode is `apply`, read the saved approved drift decisions from `progress.json` (G4 note) and the numbered `drift N:` todos. STOP if drift is not approved. Apply only approved `spec` amendments; for `code` decisions, record needed ticket/scope changes without implementing code. Replace remaining `drift N:` todos with `architecture follow-up N:` todos so application is not repeated. When spec or ticket scopes changed, invalidate the old Slices approval with `node ~/.pi/agent/dt/dt.mjs gate $1 2 change --note "Approved drift decisions changed the spec; review slice scopes"`, then save next `/dt-slice`. This is not an approval. Otherwise save `/dt-lane` (or `/dt-status` when all tickets are accepted). End with those dt-command(s) and STOP; do not run a new review.

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, features dir) and `git fetch origin`. Read `<features dir>/$1/spec.md` (module map, contracts, scale targets) and the feature's saved state (`node ~/.pi/agent/dt/dt.mjs progress $1`). Then look at the code as it is on `origin/<main>` now: derive the real modules and dependencies from imports and build files, not from the spec.

Prepare, for the gate card (in chat; no report file):
1. **Actual module diagram** - Mermaid `flowchart LR`, one node per module labelled `name - public interface in one line`, `A --> B` = A depends on B's public API; edges present in the code but not in the spec in red (`stroke:#dc2626`); modules or edges planned in the spec but absent from the code dashed (`stroke-dasharray: 5 5`); a one-line legend. Show it rendered (with the `mermaid-render` skill when available).
2. **Scores** - each module 1-5 with one line of evidence: single responsibility, depth (small interface, substantial hidden behavior), contract clarity, dependency direction (acyclic, toward stable modules), testable at its boundary, scale fit (against the spec's targets: unbounded growth, hot spots, single points of failure, behavior under overload).
3. **Findings** - numbered, ordered by how much they will hurt later (the cost of changing it once more code depends on it). Each: what differs or smells, where (file or interface), and your proposed resolution: `code` (change the code), `spec` (change the spec) or `accept`.
4. **Look yourself** - up to 5 files or interfaces I should read, with why.

Do not edit code. Be direct; do not soften findings.

## Architecture drift approval (stop here)
First save the findings, so a new session can still decide them: `node ~/.pi/agent/dt/dt.mjs gate $1 4 pending --note "<n> findings"` and `node ~/.pi/agent/dt/dt.mjs progress $1 --todo "drift 1: <finding> -> <proposed resolution>"` (one `--todo` per finding, one line each; use `--no-todo` when there are zero findings). Then, in chat, post the gate card: the diagram, a summary in at most 10 lines, the numbered findings with proposed resolutions, and end with `/dt-approve drift 1:code 2:spec 3:accept` using the actual finding IDs. I choose each decision; never fill in approval choices for me. For zero findings the command is `/dt-approve drift`.

Only `/dt-approve drift <decisions>` records approval. Discussion can revise findings and proposals; save them as pending again, never approve from a chat answer. After approval, the next command is `/dt-drift apply`, which applies the saved decisions. Do not apply amendments during approval discussion.
