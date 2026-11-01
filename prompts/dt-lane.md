---
description: Run one ticket in this lane (clone or worktree) - pick, branch, BDD red, TDD green, verify, handoff, PR
argument-hint: <slug> <ticket id | next>
---
Work one ticket of feature "$1" in this lane. Ticket: $2.

## Setup
1. Run `node ~/.pi/agent/dt/dt.mjs next $1` (add `--ticket $2` unless $2 is "next"). Read its output:
   - **resume**: this checkout is already on the ticket's branch; continue.
   - **open pi in <path>**: a worktree was created for the ticket; tell me the path and STOP. I will open pi there and rerun this command.
   - a refusal (two in flight, blocked, module clash, unsafe pair, dirty tree, wrong directory): report the reason in one line and STOP.
   It prints the ticket file, the modules it touches, the overlay to read and the `checks` command.
2. Read ONLY: `spec.md` (module map and contracts), the ticket, the overlay, and the code of the modules in `touches`.

## Rules
- Contracts from ticket 00 are frozen. If you need to change one: STOP, write `<features dir>/$1/handoff/<id>.md` titled `NEEDS CONTRACT CHANGE` with the exact change, and report. Do not work around it.
- Stay inside the `touches` modules. Use other modules through their public interface only.
- Ports for anything slow or physical (network, hardware, clock); fakes live next to the port.
- Never edit other tickets, any status, or the overview: `dt.mjs` derives them.

## Loop
1. Turn the ticket's Gherkin into executable scenarios in the repo's native location. Run them: they must fail for the right reason.
2. TDD inside the module until the scenarios are green.
3. Verify per overlay (browser, device or build target) and keep the evidence.
4. Run the `checks` command for the touched modules only.
5. Small commits; push the branch.

## Finish
1. Write `<features dir>/$1/handoff/<id>.md`: what was built, evidence, deviations from the ticket, design decisions worth my eyes, follow-ups. If the features dir is inside the repo, commit and push it on this branch.
2. Run `node ~/.pi/agent/dt/dt.mjs pr $1 <id>`: it opens the PR (draft in monorepo modality, ready in standalone; body = the handoff note, `Closes #issue` when there is one).
3. Reply with at most 5 bullets: what was built, evidence, deviations, the one thing to look at, PR URL and whether it is ready for `/dt-review $1 <id>`.
