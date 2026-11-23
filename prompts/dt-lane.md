---
description: Run one ticket in this lane (its worktree, or the current checkout for T0) - claim, branch, scenarios red, TDD green, verify, PR
argument-hint: "[ticket id [force|override]] [-- context]"
---
Work ticket $2 of feature "$1". Start option: $3.

## Context for this start
${@:4}

Use this context together with saved progress to decide where to resume; an explicit current request takes precedence over a stale saved `next`. If I say the ticket is deployed and ask for staging tests, follow `/dt-staging-test` for this ticket after setup and any unresolved requirements, rather than restarting implementation. A deployment report is not proof that tests passed, requirement confirmation or permission to skip claims, start warnings or approval rules.

- No numeric ticket ID: STOP and ask me to run `/dt-lane`; never pick a ticket yourself.
- The extension confirms the ticket with me before this prompt (for a new T0 project, `/dt-approve plan` counts). If it did not and $3 is not "override", show the ticket ID, title and one-line outcome, then STOP until I confirm.
- Use the session's lane claim owner for every `--owner`.

## Setup
1. Unless $3 is "override": if the ticket is already accepted, say so and stop; if all its saved PRs are merged, hand over to `/dt-check-merged` instead of rebuilding.
2. Before touching ticket code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket $2 --owner <session-owner>`, adding `--force` only if $3 is exactly "force" and `--override` only if it is exactly "override". Then:
   - **resume**: check the Requirements interview below, then continue from the saved `next` unless the current context gives a newer direction; do not redo finished steps.
   - **open pi in <path>**: tell me the path and STOP.
   - a refusal: report the warnings and continue only if I explicitly override. Invalid data or failed Git/API operations need repair, not override.
   T0 features are one ticket (`00`) built in the current checkout. T0 stays on the current branch: never create or switch branches, commit, push or open a PR unless I explicitly ask.
3. Read only `spec.md` (T2; T1 tickets name their modules directly), the ticket, the overlay and the code of its `touches` modules plus the tests and fixtures they need. Resolve `touches` keys through the spec's Module map; backfill a missing entry from known facts, ask about ambiguous ones. Build ticket 00's interfaces from that map and the ticket's Scope; later tickets use the merged interfaces.
4. Before UI implementation, read the ticket's UI reference section and open its linked screenshots and manifest. Follow its authority and agreed differences, not new behavior on the live prototype. Planning screenshots in `references/ui/` are required inputs: if they are missing and not explicitly waived, save a blocker, release the claim and ask me for screenshots or a waiver.

## Dependency in review
At startup or whenever work becomes blocked, inspect the ticket's unmet dependencies and saved PRs. For T1/T2, when exactly one unmet dependency is in review, suggest stacking this PR: branch off that ticket's review branch and target its PR branch instead of the main branch, so this PR shows only its own changes. Name the dependency and PR, explain that it must merge first and later branch updates may require conflict resolution, and offer waiting for its merge as the alternative. STOP and ask before changing any branch or PR base; accepting start warnings or using "override" is not consent to stack. A `dt-stack-decision` message for this start records my explicit stack choice from the dialog: it also confirms starting this ticket and accepts the dependency and shared-code warnings for that review ticket, so do not ask those questions again. Verify the dependency and follow the stack setup below; unrelated start risks and the requirements interview still apply.

After explicit consent, verify the dependency's PR is open and its actual head branch is available; a merged PR needs `/dt-check-merged`, not a stack. Keep this ticket's own branch and worktree, saved branches and published PR URLs; never move the dependency's branch or discard local changes. Start a new ticket branch from the fetched review head; for an existing branch, inspect its commits and agree on how to move only its own changes before doing so. Keep other blockers and unresolved spike decisions intact, and obtain separate consent only for start warnings not already accepted by the stack choice.

The normal `dt.mjs next` creates new branches from main and `dt.mjs pr` targets main: do not use those defaults to create a stack. Set up the agreed branch/worktree, save them through `dt.mjs progress`, then acquire the claim with `next` before touching ticket code. Create a stacked PR with `gh pr create --base <dependency-head>` or, with explicit permission, change the existing PR's base without recreating it; follow the normal title, issue-link and body conventions, add `**Sequencing:** Merge after #<dependency-pr>.`, and save its URL and review status through `dt.mjs progress`. Save the agreed base and merge order in the ticket's todo/next so later runs preserve the stack. After the dependency merges, retarget to main and remove inherited commits from the diff before continuing review; ask before any ambiguous rebase conflict decision.

## Requirements interview
After Setup and before scenarios, implementation or spike experiments, run a short interview with me to settle the ticket's requirements. Ticket-start confirmation selects the ticket; it does not replace this interview, and "override" does not skip it.
1. Read the ticket's saved requirement confirmation and progress first. Skip the interview only when it was already completed, the confirmed requirements still match the current ticket and spec, and there are no unresolved questions; then resume the current context or saved `next`. A resume or existing code alone is not proof of confirmation.
2. Briefly summarize the Outcome, Scope, Out of scope and Done when (or the investigation question and effort limit). Ask only unresolved questions that affect the ticket's behavior, constraints or acceptance and neither the code nor the plan answers, in small numbered batches with your recommendation and names I recognize. Follow settled decisions instead of asking them again; if the code contradicts one, describe the mismatch. Keep the claim and wait for my answers; do not start ticket work while requirements remain unsettled.
3. Once questions are settled, state the agreed requirements and ask me to confirm before continuing, even if the first interview had no questions. On a later run with changed requirements or new questions, revisit only the affected points and confirm those changes.
4. After my confirmation, update editable planning files with the settled decisions and add or update a short **Requirement confirmation** section in the ticket recording what I confirmed, including scope and acceptance. Save the next concrete step through `dt.mjs progress`, preserving existing verification, todos and blockers; clear only blockers resolved by this interview. This record must survive later progress saves so another session can skip an unchanged, completed interview. Never mark the interview complete before I confirm.

## Questions
During work, ask only newly discovered questions that block the next step and neither the code nor the plan answers: numbered, with your recommendation, in names I recognize. Keep the claim while waiting. Follow settled plan decisions; if the code contradicts one, describe the mismatch. Revisit the affected requirement confirmation when an answer changes requirements.

## Planning files
Update `spec.md` and editable ticket files directly during normal work to reflect facts and settled decisions. Do not require a `/dt-revise` invocation. Keep done and merged tickets unchanged; extra work becomes a new ticket. Coordinate before changing another active ticket's scope. Never hand-edit progress.json.

## Saving state
The next session knows only the feature folder. Save with `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> ...`; each save replaces the current state.
- When: after scenarios fail for the right reason, after they pass, after verification, and whenever you stop, get blocked or hand over. Add `--release-claim` to the final save.
- One line each: `--next`; `--todo` (repeatable, or `--no-todo`); `--blocker` (or `--no-blockers`); `--verification` what passed at which commit and what is unverified; `--pr <url>` / `--issue <ref>` for ones created outside `dt.mjs pr`.
- Save verification results, useful links, gaps and follow-ups as one-liners in progress.json. Do not create a per-feature `evidence/` folder or separate verification logs by default. Save separate artifacts only when genuinely useful and link them in `--verification`. Preserve existing artifacts and their references.

## Rules
- Any ticket line limit counts net growth: `added lines - removed lines`, summed across all files in the full ticket diff against the merge base with its PR base branch. Never use `added lines + removed lines`, an absolute value or per-commit churn; replacements cancel and negative counts stay negative.
- Code, comments, test names, commit messages and PR titles/bodies must stand on their own. Never reference the dev-turbo plan, spec, tickets, slices or gates. Describe current behavior and technical reasons.
- Keep production code inside the `touches` modules; use other modules through their public interface. Necessary tests, shared fixtures and test-only build wiring may be updated outside `touches` without `/dt-revise`; record those paths and run their checks. Never weaken assertions, relax validation or change public contracts to make tests pass.
- Public interfaces may change when the code needs it. If only this ticket and unstarted tickets depend on it, change it, save `--todo "interface change: <one line>"` and mention it in the PR. If merged code outside `touches` or another in-flight ticket depends on it, STOP, save `--blocker "NEEDS INTERFACE CHANGE: <exact change>"`, ask me and coordinate affected work.
- Ports for anything slow or physical (network, hardware, clock); fakes live next to the port.
- Testing: a small essential regression suite, not 100% test coverage or a coverage percentage target. Test only changed behavior, fixed bugs and concrete high-risk failures at the most useful boundary; do not duplicate the same assertion across unit, integration and end-to-end layers. Preserve existing assertions, safety-critical cases and required repository checks.

## Loop
1. Reuse or add the smallest set of essential regression scenarios for the changed Outcome and Done when, in the repo's native location; they must fail for the right reason first. Save state.
2. TDD inside the module until green. Save state.
3. Verify per overlay; save the result with `--verification`.
4. Run the `checks` command for the touched modules.
5. T1/T2: small commits; push. T0: leave the changes uncommitted in the current checkout; do not commit, push or open a PR unless I explicitly ask.

## Spikes
For a ticket with an **Investigation** section, replace the implementation loop's scenario-first and TDD steps: run the agreed experiments and stop at the stated time or effort limit. Write the findings document at the ticket's path (question, evidence, alternatives, trade-offs, recommendation, remaining uncertainty); keep only agreed experiment code. A negative or inconclusive result is fine when it meets Done when. For T1/T2, commit the findings so normal PR review and merge closure apply. For T0, leave the findings and any agreed experiment code uncommitted in the current checkout. Do not decide unresolved product questions or implement dependent work: dependent tickets remain blocked until the spike is closed and their unresolved approach is settled.

## Finish
For T0, stop after implementation and verification: leave the code uncommitted in the current checkout, save verification against the working tree (not a new commit), save any follow-ups and release the claim. Report the local changes and checks; do not require a commit, push, PR or `/dt-check-merged`, and do not record merge-based closure. Only continue with the PR steps below if I explicitly ask.

For T1/T2:
1. Write the PR body to a temp file following `~/.pi/agent/dt/AGENTS.md`. Preserve any description the user has edited. Do not edit or recreate existing published PRs. For T2 ticket 00, add a small sequence diagram of the skeleton path to the PR description.
2. For an explicitly agreed stack, use the PR steps in Dependency in review instead. Otherwise run `node ~/.pi/agent/dt/dt.mjs pr $1 <id> --owner <session-owner> --body-file <file>`: it opens the PR ready for review (`Closes #issue` when there is one) and moves the ticket to review.
3. Final save with `--release-claim`, `--verification` and `--todo` (follow-ups, pending checks) or `--no-todo`.
4. Reply in at most 5 bullets: what was built, verification, deviations (including interface changes), the one thing to look at, and the PR URL with `/dt-review <id>`.
