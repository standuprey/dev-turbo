---
description: Run one ticket in this lane (clone or worktree) - pick, branch, BDD red, TDD green, verify, PR; saves its state as it goes
argument-hint: "[ticket id [force]]"
---
Work one ticket of feature "$1" in this lane. Ticket: $2. Takeover option: $3.
The extension opens a picker for bare `/dt-lane` and supplies the chosen ID as $2. If no numeric ID was supplied, STOP and ask the user to run `/dt-lane`; do not automatically choose a ticket.
Use the lane claim owner from the injected session context for every `--owner` below. Do not invent or reuse another agent's owner.

## Ticket confirmation
The extension displays a short ticket summary and asks the user to confirm before this prompt reaches the agent, including explicit IDs, resumes and force takeovers. Confirmation chooses the ticket only; it does not approve a gate or bypass safety checks. If the extension did not show the summary and obtain confirmation, display only the ticket ID, title and a short outcome summary, then STOP to ask whether this is the ticket the user wants to start; do not claim, create Jira issues, branch or implement until they confirm. `/dt-show <id>` displays a ticket without starting work.

## Setup
Before picking an explicitly named ticket, read its saved progress. If its PRs are all merged, do not resume/rebuild its branch: use `/dt-approve <id>` to check live merge states and close it internally. If already accepted, report that and stop; do not suggest a status command.

For exactly `csscompany-enterprise/monorepo` and `csscompany-enterprise/ottercam`, follow the **Jira setup** below before the normal branching step. For other repos, keep the existing flow.

1. Before touching any ticket code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket $2 --owner <session-owner>` (add `--force` ONLY if $3 is exactly "force"). A claim is reserved atomically in progress.json before branching. Another owner is a refusal, even on the same branch. Force takes over only in the saved checkout, never bypasses checkout/module/dependency safety, and does not stop the old agent. Claims do not expire automatically; check the previous agent is gone before forcing. Read its output:
   - **resume**: this checkout is already on the ticket's branch. It prints the ticket's saved state (verified, todo, blockers, PRs, next): continue from `next`; do not redo finished steps.
   - **open pi in <path>**: a worktree was created for the ticket; tell me the path and STOP. I will open pi there and rerun this command.
   - An explicit different-ticket request in a monorepo checkout may switch tickets automatically: `next` releases the old checkout claim atomically only when Git is clean and local process inspection finds no other active Pi session or concurrent `next` command. The requesting session is excluded; an idle peer still blocks. The old ticket's progress and review status remain unchanged. Do not delete claims yourself.
   - a refusal (active peer session, unavailable process inspection, claimed target ticket, blocked dependency, module clash, unsafe pair, dirty tree, wrong directory): report the reason in one line and STOP.
   It prints the ticket file, the modules it touches, the overlay to read and the `checks` command.
2. Read ONLY: `spec.md` (module map and contracts), the ticket, the overlay, and the code of the modules in `touches`.

## Jira setup (the two CSS repos only)

Before touching implementation code or creating a Jira ticket:
1. Run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket $2 --owner <session-owner> --claim-only` (add `--force` ONLY if $3 is exactly "force"). If refused, STOP. This claims the ticket without creating or pushing a branch.
2. Read the feature's `feature.json`, the chosen ticket and its saved progress. The `epic` key is required. If absent, ask for an existing epic, verify it is an Epic through Jira, and save it with `dt.mjs epic $1 --key <KEY>`; never guess or approve anything.
3. Use available Jira tools (discover their schemas first). Reuse `jira.key` or an existing saved Jira issue when resuming; verify its parent epic. Otherwise create one Jira ticket with the local ticket title and a short **3 to 5 bullet-point description** of its scope and acceptance checks, linked under `feature.json.epic`. Determine the Jira project and supported parent/Epic Link field from the epic and Jira metadata; do not hard-code OV or a custom field. Include a stable feature/local-ticket reference in a bullet so retries can find it. Search for that reference before creating; if a create times out, reconcile in Jira before retrying. Do not create GitHub issues instead.
4. Verify the returned key, browse URL and epic link. Save the verified Jira browse URL with `dt.mjs progress $1 --ticket $2 --owner <session-owner> --issue <KEY>=<URL>`. Save the exact bullet description to a temp file, then run `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket $2 --owner <session-owner> --jira-key <KEY> --jira-description-file <file>`. This saves key, epic, title and description in `progress.json`, and adds the issue reference. Save immediately so another session reuses it.
5. For newly created Jira tickets in **monorepo modality**, also assign the ticket to the user, add it to the current active sprint and transition it to **In Progress** before branching:
   - Resolve the user's Jira account ID through the authenticated-user/profile tools. Do not use the lane claim owner as a Jira identity. If the connection belongs to a service account or the user cannot be identified uniquely, ask for their Jira account before changing the assignee.
   - Discover the Scrum board that covers the issue's project and the board's active sprint through Jira metadata. Use the sprint ID, not its name; do not hard-code a board, sprint or custom field. If multiple boards or active sprints are plausible, ask which one to use. If there is no active sprint, report it and ask how to proceed; never start a sprint or silently choose a future sprint or backlog.
   - Assign using the resolved account ID, add the issue to that active sprint using the supported Agile operation or discovered Sprint field, then query the issue's available transitions and use the transition to In Progress. Do not hard-code a transition ID or write the status field directly. If no matching transition is available, stop and ask for help.
   - Re-read the issue and verify the assignee account ID, active sprint ID and In Progress status. Save the verified values with `progress --verification`. A failed or uncertain update blocks branching: keep the saved Jira key, save a blocker and release your claim, then STOP. On retry, re-read Jira and apply only missing setup changes; never create a replacement issue. Do not reassign, move to a newer sprint or reset the status of an already established ticket when resuming; if it is unclear whether setup was completed, ask before changing it. Standalone modality retains its existing Jira behavior.
6. Run the normal `next` command **without `--claim-only`**. It creates the branch from the Jira key followed by the title slug, all lowercase snake_case: `OV-777` + `Update schema` → `ov_777_update_schema`. The saved branch is used for resume, PRs, lane display and cleanup. In standalone ottercam, commit/push planning metadata to the main branch as required by the existing worktree flow before branching; then stop when told to open pi in the worktree.

Do not implement until the Jira ticket and branch are ready. If Jira is unavailable, the parent is wrong or creation is uncertain, save a blocker and release your claim, then STOP. Never invent a Jira key. Preserve existing published PR URLs and saved legacy branches; do not rename/recreate them for cosmetics. New branches use the Jira snake_case rule.

## Saving state
The next session knows only what the feature folder holds, so save the ticket's state with `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> ...`. Each save replaces the previous one: it is the current state, not a log. Never edit progress.json by hand.
- When: after the scenarios fail for the right reason, after they pass, after verification, and whenever you stop, get blocked or hand over to me. Add `--release-claim` to the final save when handing work back or stopping. Normal session shutdown also releases this session's claims. Release does not mark the ticket done or make it available to `next`; resume that ticket explicitly in its saved checkout.
- What, one line each: `--next` the next concrete step; `--todo` what is left (repeat the flag, `--no-todo` when nothing is); `--blocker` what stops you (`--no-blockers` once cleared); `--verification` what passed, at which commit (`git rev-parse --short HEAD`), and what is not verified yet.
- PRs and issues created outside `dt.mjs pr` (an extra PR, a Jira key): `--pr <url>` and `--issue <KEY or URL>`.
Code explains implementation details; keep the PR short. Save verification gaps and follow-ups as one-liners in progress.json.

## Rules
Code, comments, test names, commit messages and PR titles/bodies must stand on their own. Never reference the dev-turbo plan, spec, tickets, slices or gates, or assume readers know the workflow. Describe current behavior and technical reasons, not which workflow step introduced something or will finish it. The same rule applies to documentation shipped with the change. Workflow references belong only in dev-turbo planning artifacts, saved progress and command/gate handovers; required issue links and concrete PR sequencing remain allowed.

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
1. Read `~/.pi/agent/dt/AGENTS.md` for the PR format. Write a short body to a temp file: `## Description` with a few plain bullets about what changed, then `## Testing` starting with exactly `unit tests + staging tests` and one suggested staging check. Add a simple bullet for a curl/browser check only if it was actually run. No test implementation, command dumps, test counts or unfinished work in the body; save pending checks in progress.json. Add a sequencing line only for specific PRs that must merge first. Preserve any description the user has edited. In `monorepo` modality, every new ticket PR title is `<UPPERCASE-TICKET-ID>: <ticket-title>` (use the saved Jira key when available, e.g. `OV-731: Keep v1 validation on the shared reader`), without a feature slug or local ID prefix. Put the verified Jira browse URL immediately below `## Description`, followed by a blank line and the change bullets; `dt.mjs pr` adds the link if absent. Apply this to extra PRs created outside `dt.mjs pr` too. Do not edit or recreate existing published PRs for formatting.
2. Run `node ~/.pi/agent/dt/dt.mjs pr $1 <id> --owner <session-owner> --body-file <file>`: it opens the PR (draft in monorepo modality, ready in standalone; `Closes #issue` when there is one), records it and moves the ticket to review with next `/dt-review <id>`.
3. Save the final state with `--owner <session-owner> --release-claim`: `--verification` and `--todo` (follow-ups and pending checks) or `--no-todo`.
4. Reply with at most 5 bullets: what was built, evidence, deviations, the one thing to look at, PR URL and whether it is ready for `/dt-review <id>`.
