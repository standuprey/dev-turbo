---
description: T0/T1 build loop in the current checkout - scenarios, TDD, verify, PR (no spec)
argument-hint: "[what to build, or 'as aligned']"
---
Build this as a T0/T1 task. Type: $1. Task: ${@:2}

Alignment: use the grill session and its Scope block from this conversation. If there is none, stop and tell me to run `/dt-grill` first. Scale: restate the scale line from the facts block; if it says "matters", add a test or measurement for the target; if "does not matter", still keep the change from introducing unbounded growth (unlimited queries, in-memory accumulation, retries without backoff).

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, `checks`) and read `~/.pi/agent/dt/overlays/$1.md` (for mixed, read every relevant overlay rather than looking for mixed.md).

## Protocol
1. Name the module that owns this change in one sentence. If it needs a new module or alters a public contract, STOP and end with `/dt-grill <expanded task>` to revise Scope as T2 before a spec can start. Do not decide contracts on your own.
2. **T1 Slices approval**: unless the session already has an approved quick `slices` gate, list 2-5 scenario titles and the owning module, call `dt_propose_quick_gate` with gate `slices` and the plan note, then STOP with `/dt-approve slices`. After that approval the user runs `/dt-quick` again to start coding. A chat yes does not approve. T0 skips this plan gate.
3. `git fetch origin` and `git switch -c quick/<short-name> origin/<main>` in this checkout. Never commit on the main branch.
4. Write the failing test(s) first at the module boundary; run them and show they fail for the right reason.
5. Implement until green. Refactor inside the module only. Keep the diff small.
6. Verify per the overlay and capture evidence.
7. Run the `checks` command for the touched module only.
8. Small commits; push. Write a PR body using the format below to a temp file and run `node ~/.pi/agent/dt/dt.mjs pr quick --title "<title>" --body-file <file>` (draft PR in monorepo modality, ready PR in standalone).

## PR body
Read `~/.pi/agent/dt/AGENTS.md` before writing the body. Use only `## Description` and `## Testing`:
- Description: a few short bullets about what changed, in simple words. No fixed bullet count, test implementation or unfinished work.
- Sequencing: only name specific PRs that must merge first; otherwise omit it.
- Testing: start with exactly `unit tests + staging tests`, then suggest one staging check. This is the testing plan, not a claim that both ran.
- An actual curl/browser check may be one simple bullet. Keep command dumps, test counts and verification gaps out of the body. Report essential gaps separately.
- Preserve descriptions the user has edited.

## Finish
At most 5 short bullets: what changed, verification, what to inspect and the PR URL. If review is required (boundary touched or diff >150 lines), call `dt_propose_quick_gate` with gate `review`, the PR branch and verification note, then end with `/dt-review`. Otherwise propose gate `ticket` and end with `/dt-approve ticket`. The review command proposes ticket acceptance only after its verdict is merge. The user merges the PR before ticket acceptance. Discussion does not approve or start the next step.
