---
description: Run one ticket in this lane (clone or worktree) - pick, branch, BDD red, TDD green, verify, PR; saves its state as it goes
argument-hint: "[ticket id [force]]"
---
Work one ticket of feature "$1" in this lane. Ticket: $2. Takeover option: $3.
The extension opens a picker for bare `/dt-lane` and supplies the chosen ID as $2. If no numeric ID was supplied, STOP and ask the user to run `/dt-lane`; do not automatically choose a ticket.
Use the lane claim owner from the injected session context for every `--owner` below. Do not invent or reuse another agent's owner.

## Setup
Before picking an explicitly named ticket, read its saved progress. If its PRs are all merged, do not resume/rebuild its branch: use `/dt-approve <id>` to check live merge states and close it internally, or `/dt-status` if already accepted.

1. Before touching any ticket code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket $2 --owner <session-owner>` (add `--force` ONLY if $3 is exactly "force"). A claim is reserved atomically in progress.json before branching. Another owner is a refusal, even on the same branch. Force takes over only in the saved checkout, never bypasses capacity/module/dependency safety, and does not stop the old agent. Claims do not expire automatically; check the previous agent is gone before forcing. Read its output:
   - **resume**: this checkout is already on the ticket's branch. It prints the ticket's saved state (verified, todo, blockers, PRs, next): continue from `next`; do not redo finished steps.
   - **open pi in <path>**: a worktree was created for the ticket; tell me the path and STOP. I will open pi there and rerun this command.
   - a refusal (two in flight, blocked, module clash, unsafe pair, dirty tree, wrong directory): report the reason in one line and STOP.
   It prints the ticket file, the modules it touches, the overlay to read and the `checks` command.
2. Read ONLY: `spec.md` (module map and contracts), the ticket, the overlay, and the code of the modules in `touches`.

## Saving state
The next session knows only what the feature folder holds, so save the ticket's state with `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> ...`. Each save replaces the previous one: it is the current state, not a log. Never edit progress.json by hand.
- When: after the scenarios fail for the right reason, after they pass, after verification, and whenever you stop, get blocked or hand over to me. Add `--release-claim` to the final save when handing work back or stopping. Normal session shutdown also releases this session's claims. Release does not mark the ticket done or make it available to `next`; resume that ticket explicitly in its saved checkout.
- What, one line each: `--next` the next concrete step; `--todo` what is left (repeat the flag, `--no-todo` when nothing is); `--blocker` what stops you (`--no-blockers` once cleared); `--verification` what passed, at which commit (`git rev-parse --short HEAD`), and what is not verified yet.
- PRs and issues created outside `dt.mjs pr` (an extra PR, a Jira key): `--pr <url>` and `--issue <KEY or URL>`.
Code explains implementation details; keep the PR short. Save verification gaps and follow-ups as one-liners in progress.json.

## Rules
- Contracts from ticket 00 are frozen. If you need to change one: STOP, save `--blocker "NEEDS CONTRACT CHANGE: <exact change>"`, and report. Do not work around it.
- Stay inside the `touches` modules. Use other modules through their public interface only.
- Ports for anything slow or physical (network, hardware, clock); fakes live next to the port.
- Never edit other tickets, the spec, or progress.json by hand: `dt.mjs` keeps the state.

## Loop
1. Turn the ticket's Gherkin into executable scenarios in the repo's native location. Run them: they must fail for the right reason. Save state.
2. TDD inside the module until the scenarios are green. Save state.
3. Verify per overlay (browser, device or build target) and keep the evidence. Save state.
4. Run the `checks` command for the touched modules only.
5. Small commits; push the branch.

## Finish
1. Read `~/.pi/agent/dt/AGENTS.md` for the PR format. Write a short body to a temp file: `## Description` with a few plain bullets about what changed, then `## Testing` starting with exactly `unit tests + staging tests` and one suggested staging check. Add a simple bullet for a curl/browser check only if it was actually run. No test implementation, command dumps, test counts or unfinished work in the body; save pending checks in progress.json. Add a sequencing line only for specific PRs that must merge first. Preserve any description the user has edited.
2. Run `node ~/.pi/agent/dt/dt.mjs pr $1 <id> --owner <session-owner> --body-file <file>`: it opens the PR (draft in monorepo modality, ready in standalone; `Closes #issue` when there is one), records it and moves the ticket to review with next `/dt-review <id>`.
3. Save the final state with `--owner <session-owner> --release-claim`: `--verification` and `--todo` (follow-ups and pending checks) or `--no-todo`.
4. Reply with at most 5 bullets: what was built, evidence, deviations, the one thing to look at, PR URL and whether it is ready for `/dt-review <id>`.
