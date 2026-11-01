---
description: T0/T1 build loop in the current checkout - scenarios, TDD, verify, PR (no spec)
argument-hint: "<type: web|device|service> <what to build, or 'as aligned'>"
---
Build this as a T0/T1 task. Type: $1. Task: ${@:2}

Alignment: use the grill session and its Gate 0 block from this conversation. If there is none, stop and tell me to run `/dt-grill` first. Scale: restate the scale line from the facts block; if it says "matters", add a test or measurement for the target; if "does not matter", still keep the change from introducing unbounded growth (unlimited queries, in-memory accumulation, retries without backoff).

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, `checks`) and read `~/.pi/agent/dt/overlays/$1.md`.

## Protocol
1. Name the module that owns this change in one sentence. If it needs a new module or alters a public contract, STOP and tell me to escalate to T2 (`/dt-spec`). Do not decide contracts on your own.
2. **T1 light gate (always)**: list 2-5 declarative scenario titles (Given/When/Then one-liners, behavior not clicks) and the owning module, then wait for my OK before writing code. T0: skip this step.
3. `git fetch origin` and `git switch -c quick/<short-name> origin/<main>` in this checkout. Never commit on the main branch.
4. Write the failing test(s) first at the module boundary; run them and show they fail for the right reason.
5. Implement until green. Refactor inside the module only. Keep the diff small.
6. Verify per the overlay and capture evidence.
7. Run the `checks` command for the touched module only.
8. Small commits; push. Write the finish summary below to a temp file and run `node ~/.pi/agent/dt/dt.mjs pr quick --title "<title>" --body-file <file>` (draft PR in monorepo modality, ready PR in standalone).

## Finish
At most 5 bullets: what changed, evidence it works, a design decision I should look at, what was left out, the PR URL. Add "suggest `/dt-review quick`" when the diff is over ~150 lines or touched a module boundary. Merging is mine (Gate 3).
