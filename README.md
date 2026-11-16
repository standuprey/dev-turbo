# dev-turbo for pi (v0.4)

This version works in any GitHub repository: T2 tickets run in their own worktrees, get GitHub issues and open ready PRs. The Atoms version, with fixed lane clones and Jira, lives in `~/code/dev-turbo-atoms`; install only one of them in a Pi instance.

Prompt templates, one zero-dependency script and extensions for help, read-only status, resume, a selected session project and local argument autocomplete. Files are the memory; you hold the approvals.

## Principles
1. Every task starts with a grill. The agent gives a short summary and asks you to choose T0 / T1 / T2 without guessing or recommending a tier, then writes the plan from what you settled: a short brief and outcome-level tickets. You approve it once with `/dt-approve plan`.
2. Plan the big building blocks, not the details. Interfaces are written as code in ticket 00 and reviewed in its PR; each lane writes its own scenarios from the ticket's outcome.
3. Deep modules, one responsibility, one-way dependencies; one Mermaid notation for module diagrams.
4. Vertical, demoable tickets; TDD inner loop; fresh context for review; state kept by `dt.mjs`, never hand-edited.
5. The plan changes when reality does. Agents maintain the spec and editable tickets directly, asking about unsettled decisions in chat; `/dt-revise` is an optional coverage audit, not an editing or approval prerequisite.

## Flow

**Move forward with a dt-command.** Discussion is for questions and adjustments; a chat "yes" never records approval.

Start with `/dt-start <task>`. After the grill, it asks you to choose a tier and writes the plan: T0/T1 get one ticket; T2 gets a brief (`spec.md`) and a handful of tickets. The spec says what and why: behavior, goals, constraints and acceptance criteria. The shared module map lives in `spec.md`: exact `touches` keys, code/artifact paths, responsibilities and module dependencies. Tickets say how: slices, ticket/lane ownership, ticket dependencies, implementation approach and landing order. Ticket 00 builds the mapped modules' interfaces as compiling code; it does not own a duplicate module map. It saves a plan proposal only after your explicit choice. `/dt-approve plan` confirms the project name, records approval and selects the project. For T0/T1, that confirmation also starts ticket 00 in the current checkout; safety checks still run, and warnings require a separate decision. T2 continues with `/dt-lane`. Following commands omit the slug. In a new session, `/dt-resume [slug]` selects an existing project; the footer shows its name.

### Commands

| Command | What it does |
|---|---|
| `/dt-start <task>` | Grill, choose the tier, then write the brief and tickets. Clears the current selection. |
| `/dt-approve plan` | Approve a new plan (creates and selects the project), and start ticket 00 for T0/T1 with the same confirmation. Also honors legacy pending plan gates without starting work. |
| `/dt-lane [id [force\|override]]` | Open the ticket picker, or start/resume one ticket: scenarios red, TDD green, verify, PR. T0/T1 build ticket 00 in the current checkout on `quick/<slug>`. `force` takes over a claim in its saved checkout; `override` accepts all start-policy warnings. |
| `/dt-review [id \| branch] [autofix]` | Review in chat before merge; offer to fix selected findings. Re-review is optional. |
| `/dt-check-merged` | After you merge, check every open ticket's PRs on GitHub, report their states and close each ticket whose PRs are all merged. |
| `/dt-staging-test [id]` | Generate a staging test script and runbook for a ticket PR, wait for your review, run it, then record passed checks in the PR. |
| `/dt-revise [change]` | Optionally request a plan edit, or without arguments audit spec/ticket coverage in both directions. |
| `/dt-status [id]` | Show the saved board, or one full ticket and its saved progress. No model call. |
| `/dt-slice-plan` | Show remaining parallel batches and their ticket IDs. No model call. |
| `/dt-resume [slug]` | Select or switch projects and show where one stands. |
| `/dt-help` | Show this command flow. No model call. |

### T2 implementation loop

When an implementation approach needs investigation, create a bounded spike with a question, experiment, effort limit and reviewed findings. Dependent tickets wait for it; after findings are reviewed, agents update the affected editable tickets directly, updating the spec only when requirements or the shared module map change. A spike needed to design the skeleton can run before 00.

Ticket 00 is the walking skeleton: the building blocks' interfaces as compiling code, fakes and one trivial path through every layer. Every later implementation ticket waits for it; prerequisite spikes do not. After 00 is closed, **repeat for each ready ticket**; shared `touches` and `unsafe_with` pairs warn before concurrent work and require an explicit override, and there is no in-flight limit.

```text
┌──────┐    ┌───────────────┐    ┌────────────┐    ┌────────────┐    ┌─────┐
│      │    │               │    │            │    │            │    │     │
│Build ├───►│Review and fix ├───►│Human merge ├───►│Check merged├───►│Done │
│      │    │               │    │            │    │            │    │     │
└──────┘    └───────────────┘    └────────────┘    └────────────┘    └─────┘
```

| Step | What to do |
|---|---|
| Build | `/dt-lane` opens the ticket picker. Choose a ready ticket. Interfaces may change when only this ticket and unstarted tickets depend on them; the PR says so. |
| Review and fix | `/dt-review <id>` suggests fixes in chat and offers to apply selected items. No PR or ticket comments. Re-review after fixes is optional. |
| Human merge | You merge every ticket PR. |
| Close | `/dt-check-merged` closes every ticket whose PRs are all merged; then return to `/dt-lane`. |

### Changing the plan

Agents may update the spec and editable tickets directly during implementation or review. No `/dt-revise` invocation is required. `/dt-revise <change>` remains an optional way to request a focused edit, with questions only for unresolved decisions. Implementation-only changes that do not affect the module map leave the spec untouched; behavior, constraint or module-map changes update the spec and affected tickets. Missing module definitions are backfilled in the spec, not in completed tickets. `/dt-revise` without arguments audits coverage between the spec and tickets in both directions: missing requirements, unplanned outcomes, contradictions, module-map definitions and dependency gaps. Clear documentation mismatches can be fixed directly; unresolved scope/design choices are asked in chat. Code is consulted only for factual ambiguity or an explicitly requested code-alignment audit.

No renewed plan approval is required after `/dt-revise`, even when building blocks, scope or ticket dependencies change. The agent asks about unsettled decisions in chat before editing; a clear requested change does not need another confirmation. Once those decisions are settled, edits take effect under the original plan approval and work continues with `/dt-lane`. In-flight scope-change handovers and lane claims still apply.

By default, done and merged tickets stay closed and extra work becomes a new ticket; explicit ticket-start override can reopen them while preserving old PR facts. A T0/T1 task stays one ticket; bigger changes become a new T2 project.

### Ticket picker and lane ownership

Run **`/dt-lane`** to choose a ticket. Resume/status recommend this command when ready work fits alongside existing tickets. The picker reads saved local state; it does not refresh GitHub or change progress. Tickets without warnings appear first, and accepted tickets are omitted from the picker; an explicit ID with override can reopen completed work.

| Picker label | Meaning / action |
|---|---|
| **READY** | Available to start in this checkout. Select it to build. |
| **RESUME** | In-progress work available to resume here. Select it to continue. |
| **WARNING (LOCKED)** | Another owner or checkout. Select to inspect the warning, then choose Start anyway to override; the old agent is not stopped. |
| **WARNING (BLOCKED)** | Unmet dependency, plan gate, saved blocker, shared module or unsafe pair. Select to inspect all warnings and explicitly override them. |
| **WARNING (REVIEW)** | Normally use `/dt-review <id>`; direct work can be resumed after confirmation. |
| **WARNING (MERGED)** | Normally use `/dt-check-merged`; overriding reopens work and requires a fresh PR before closure. |

**Canceling changes nothing.** After selection, the extension displays a short summary with the ticket ID, title and outcome, then asks whether it is the ticket you want to work on. This also applies to explicit IDs, resumes and force takeovers. Declining or canceling leaves claims and Git unchanged. Use `/dt-status <id>` to read the full ticket and its saved progress. After confirmation, the agent rechecks safety and claims the ticket atomically before Git operations. All current policy warnings are rechecked when claiming. Override consent is explicit, recorded with the claim and never inferred merely from opening the picker.

For a new T0/T1 project, the `/dt-approve plan` confirmation also confirms starting ticket 00, so a clean start skips the picker and second confirmation. Warnings still show the Start anyway dialog; declining or a failed check leaves the plan approved without claiming or changing Git. Use `/dt-lane 00` to retry or resume, with normal ticket confirmation. T2 and legacy revision approvals do not start work.

- `/dt-lane <id>` skips the picker, not ticket confirmation or safety checks. Normal starts require an interactive or RPC confirmation dialog. Non-interactive starts require an explicit `/dt-lane <id> override`; otherwise use `/dt-status <id>` to inspect.
- `/dt-lane <id> force` explicitly takes over a claim **in its saved checkout**, after you check the previous agent is gone. It does not stop that agent or cancel running commands. Without override, dirty-tree, dependency and module-conflict checks still apply.

Claims in `progress.json` record the Pi session owner, checkout and acquisition time. Another session needs explicit force/override to take a claim; it cannot save ticket progress/PRs with the displaced owner. In-progress work in another lane is context, not an invitation to join that agent.

`/dt-lane <id> override` or CLI `next --ticket ID --override` accepts every ticket-start policy warning: shared modules, unsafe pairs, dependencies, saved blockers, pending plans, owners, checkout/dirty-tree checks and completed work. The existing ticket dialog shows Start anyway, not another approval step. Overrides do not approve a plan, stop other processes, discard files or bypass invalid data/the progress lock; native Git/API errors may still need repair. A takeover fences the old owner’s progress writes. Other active ticket claims in a shared checkout are retained, not silently released. Reopened merged work retains its PR facts but cannot close until a fresh PR is recorded. `next --check-only --json` inspects warnings without claims, state writes or Git changes.

Claims do not expire on a timer. A final save with `--release-claim`, or normal session shutdown, releases only that session's claims. Release preserves the ticket's branch, progress, existing artifacts and review state.

The session context supplies `--owner <session-ID>` for `dt.mjs next`, ticket progress updates and `pr`. CLI users must supply their own stable owner ID. Reload existing sessions when idle; do not interrupt an agent mid-command.

### Remaining slices

`/dt-slice-plan` shows `Slice 1: 07 (ticket/demo-07), 42` followed by each later batch for the selected project. Ticket branches appear in parentheses when saved in progress; tickets without a saved branch show only their ID. It reads saved tickets and progress only: no model call, remote refresh, claims or project-file changes. Tickets recorded done or with all saved PRs merged are excluded, except reopened work still needs new merges. In-progress and review tickets remain in the plan.

Each batch uses `blocked_by` and symmetric `unsafe_with` conflicts; shared `touches` do not split the display plan. Dependencies must finish in earlier batches. Tickets are considered in numeric ID order, greedily filling each batch; this is deterministic, not necessarily the shortest possible schedule. Batch size is not limited by available lanes. Shared-module start guards, saved blockers, approval gates and claims still apply when actually starting work. Missing dependencies or cycles are reported with the unscheduled ticket IDs, not silently ignored. Old written slice assignments may differ when ticket fields or merge states change.

### UI references

For UI work in any tier, including mixed UI/backend tickets, `/dt-start` inspects supplied prototypes during the grill and settles whether their appearance and behavior are authoritative or illustrative. It saves relevant screenshots under `<feature>/references/ui/` with `references/ui/manifest.md` recording source URLs, screen/states, viewports, capture dates, reproduction steps and agreed differences. Each UI ticket embeds relative screenshot links and names its source and relevant states. `/dt-status <id>` ends the complete ticket and saved progress with only `Reference screenshots: file:///tmp/dt-ticket-<id>-images-…/`; it does not append inline images, individual image URLs or screenshot labels. The private temporary folder contains copies of all readable, supported references, numbered in reference order with duplicate files exported once. Inline and reference-style image links resolve relative to the ticket and must stay inside the feature directory (including symlink targets); no remote image is fetched. Missing or rejected images produce warning notifications without hiding the ticket. PNG, JPEG, GIF and WebP captures are supported, up to 10 MiB per image and 32 MiB per ticket. Each invocation exports validated image bytes into a fresh folder; folders remain until manually removed or cleared by the system, and project state is unchanged. Lane confirmation stays summary-only. If capture is blocked or no reference is supplied, the user must provide screenshots or explicitly waive the missing coverage; the agent cannot silently skip it.

Direct planning edits and optional `/dt-revise` apply the same rules to added or updated UI tickets and can backfill references in existing plans without changing settled scope. Done and merged tickets stay unchanged. `/dt-lane` reads the captures before implementation, and browser verification compares the result against them; visual acceptance remains human-owned. These durable planning inputs are separate from optional verification artifacts and must be preserved. This is prompt-guided behavior, not an automatic CLI screenshot validator.

### Testing scope

Aim for a small essential regression suite, not 100% test coverage or a coverage percentage target. Reuse existing tests; add protection for changed behavior, fixed bugs and concrete high-risk failures at the most useful boundary. Avoid exhaustive edge-case matrices and duplicate coverage across layers. Keep red/green development focused on these tests and run affected checks; broader suites are for shared changes or concrete regression risks. Preserve existing assertions, safety-critical tests and required repository checks.

### Staging tests

`/dt-staging-test [id]` writes `staging-test.sh` and a short runbook under `<feature>/staging-tests/<id>/`, from the ticket and read-only staging inspection. It shows the target, the data it will create and the exact command, then waits for you to confirm that script version. After a confirmed run passes, it replaces the PR's `## Testing` bullets with the staging checks that passed. A failure leaves the PR unchanged: test defects are fixed and reviewed again, product defects are fixed on the ticket branch with your agreement, and missing prerequisites stop the loop. It prefers an isolated preview or sandbox environment when the project offers one. It never runs DDL, deploys shared environments, touches production or deletes data.

### Verification records

Save short verification results, useful links and remaining checks in `progress.json` through `dt.mjs progress --verification`, `--todo` and `--blocker`; never edit it by hand. There is no required per-feature `evidence/` folder. Keep separate artifacts only when genuinely useful, such as a screenshot for visual review, and link them in the saved verification result. Existing artifacts and references are preserved.

### Approval and closure

`/dt-approve plan` approves a new plan (creating and selecting the project), and starts ticket 00 for T0/T1 after safety checks. It asks for one approve-and-start confirmation for T0/T1, and fails if the plan files changed while its dialog was open. `/dt-revise` keeps that approval intact rather than requesting another one. Legacy pending plan gates still use their saved approval path; no existing pending gate is silently cleared.

Merging a ticket's PRs is your decision; `/dt-check-merged` only records it. It checks every saved PR of each open ticket live on GitHub, reports the states in one table, and closes each ticket whose PRs are all merged. Tickets with an open, closed-unmerged or unreadable PR stay open. It needs no confirmation, and closure is not proof that staging or production checks passed.

Neither command merges a PR or starts implementation.

### Any time

- `/dt-status [id]`: read-only board (completion, remaining tickets, blockers, plan state, **next dt-command(s) last**) or one full ticket with its saved progress. Pending reviews recommend `/dt-review <id>` before starting more work with `/dt-lane`; merged work still goes to `/dt-check-merged`. No model call or remote refresh.
- `/dt-help`: this command flow, picker labels and ownership rules, without a model call.
- `/dt-resume [slug]`: select/switch projects; remote refresh failures keep the local selection. It shows next commands in the transcript.

Selection survives reloads, reopening and forks of the Pi session. A brand-new session needs resume or a new grill. Starting a new grill clears the old selection. The removed commands `/dt-spec`, `/dt-slice`, `/dt-amend`, `/dt-drift` and `/dt-quick` print their replacement. See [workflow.md](workflow.md) for the detailed map.

## Examples

- Button typo (T0): `/dt-start` → `/dt-approve plan` (approves and starts ticket 00) → merge → `/dt-check-merged`.
- Pagination fix (T1): same as T0; the single ticket lists 2-5 scenario titles, and `/dt-review` before merge.
- Export service (T2): `/dt-start` writes a one-page brief and five tickets → `/dt-approve plan` → skeleton 00 → parallel lanes → `/dt-revise` when reality differs.

## The script
`dt.mjs` (Node 18+, no dependencies) is what the prompts call; everything it does, you can run yourself:

```
dt.mjs -h                                list commands and global help
dt.mjs <command> -h                      show usage and options for any command
dt.mjs info                               repo, main branch, features dir, checks
dt.mjs config set checks "<cmd>"          remember the affected-targets command for this repo
dt.mjs resume [<slug>]                    list features, or a short brief of one (refreshes PRs/issues)
dt.mjs progress <slug> [--ticket ID] ...  show or update the current state in progress.json
dt.mjs migrate-progress <slug>            migrate legacy ticket lanes to optional worktree paths
dt.mjs status <slug>                      kanban + DAG + unsafe pairs
dt.mjs next <slug> --owner ID [--ticket ID] [--force]   claim a ready ticket, then branch or create a worktree
dt.mjs gate <slug> <0|2|3> approve|change|pending   record plan approval (0 new, 2 revised) or ticket closure (3)
dt.mjs pr <slug> <ID> --body-file F       open and record the PR, ready for review
dt.mjs comment --body-file F              manually post a PR comment (not used by /dt-review)
dt.mjs selftest                           test the pure logic
```
`-h` and `--help` work at every command level, including `config set` and `config set checks`, without requiring a Git repository or running workflow actions. Running `dt.mjs` without arguments shows the top-level help. Run `node --test tests/*.test.mjs` for the CLI, session-state, footer and autocomplete tests. To include the optional Pi-runtime integration test, set `PI_PACKAGE_DIR` to the installed `@earendil-works/pi-coding-agent` package directory.

`--dry-run` prints the git/gh commands instead of running them, without claiming a ticket. Rules it enforces: checkout ownership, `blocked_by` done, no shared `touches`, no `unsafe_with` pair, T2 lanes only from the main checkout; T0/T1 tickets branch `quick/<slug>` in the current checkout. Feature docs inside the repo never count as uncommitted changes.

Tickets no longer save a `lane` field. Active ownership lives in `claim.checkout`; lane labels come from the current branches in ticket worktrees, not historical assignments. Tickets optionally save an absolute `worktree` path for resume and cleanup after a claim is released (`progress --ticket ID --worktree PATH`). Legacy lane numbers are discarded on read; legacy absolute paths migrate to `worktree`. Run `dt.mjs migrate-progress <slug>` to persist that migration under the progress lock without changing claims, approvals, timestamps or other saved state.

## Install
```
./install.sh                 prompts → ~/.pi/agent/prompts, dt.mjs + AGENTS.md + README.md + overlays → ~/.pi/agent/dt, help + status + approve + resume + session + autocomplete → ~/.pi/agent/extensions, config.json if missing, selftest
./uninstall.sh               removes prompts, dt.mjs, installed docs, overlays, the extensions; keeps config.json and features/
./uninstall.sh --purge       also removes config.json and features/ (asks first)
```
The extensions use the Node Pi package's existing jiti runtime so `/reload` also refreshes helper modules; no extra dependency install is needed.

Then `/reload` in pi. `~/.pi/agent/dt/config.json` holds each repository's `checks` command; the grill asks for it once per repo if left empty. Needs `gh` logged in for issues and PRs.

## PR conventions

T2 tickets branch `ticket/<feature>-<id>`; T0/T1 tickets use `quick/<slug>`. Resume, lane display, PRs and cleanup use the saved branch. Target the main branch by default. Split PRs should each contain only their own scope; do not introduce a stack without asking. See [AGENTS.md](AGENTS.md).

Keep PRs short: a few plain change bullets under `## Description`, then `## Testing` starting with `unit tests + staging tests` and one suggested staging check. Mention only real merge prerequisites. Leave test implementation, unfinished work and long verification records out of the body. `dt.mjs pr` titles T2 ticket PRs `<feature> <ID>: <ticket-title>` and T0/T1 PRs with the ticket title alone, and adds `Closes #<issue>` for the ticket's GitHub issue without rewriting the supplied description. Existing published PRs are preserved. See [AGENTS.md](AGENTS.md) for the format; `dt.mjs pr` takes a short `--body-file`.

## Day to day
- `/dt-help` displays the workflow guide directly, without a model call, repository lookup or state changes.
- `/dt-resume` opens a feature picker. In the terminal, Ctrl+D deletes the highlighted feature after a confirmation dialog. Deletion removes its saved folder, including tickets and progress, but leaves branches, worktrees, PRs and issues untouched. Features with claimed tickets cannot be deleted; deleting the selected feature clears the session selection.
- `/dt-resume ` autocompletes feature slugs. After selection, `/dt-lane ` and `/dt-status ` suggest that project's ticket IDs; `/dt-review ` suggests its ticket IDs and `autofix` after a target; `/dt-approve ` suggests `plan` when one is pending. Suggestions use local files only, with a two-second feature-list cache; no GitHub refresh or state writes.
- New session: open pi in the repository (or a lane) and run `/dt-resume`. Pick a feature; it posts a short brief (phase, gates, board, in-flight tickets with PRs, verification, todo, next step) and lists next commands without a follow-up picker.
- Commit and push T2 ticket files to the main branch, then run `/dt-lane` from the main checkout and choose a ready ticket. After selection, it creates `../<repo>.lane-<id>` and tells you to open pi there; run `/dt-lane <id>` there to resume. Feature docs, `progress.json` included, live in the main checkout's `docs/features/<slug>/`: commit `progress.json` when convenient (it is state, not code).
- `/dt-status` displays a saved-state board directly: completed tickets and verification, tickets left, in-flight work, blockers, plan state and next steps. `/dt-status <id>` shows one full ticket, followed by readable saved progress from `progress.json`, including claims, branch, verification, todos, blockers, PRs, issues and acceptance. Empty fields are omitted. It explicitly reports when no progress is saved for that ticket. It does not call the model, start work, refresh remote facts or write project state. It requires a selected project; it never guesses from a branch or the only feature. Use `/dt-resume` to select or switch projects.
- `dt.mjs status <slug>` any time for the full board and DAG; `dt.mjs progress <slug> [--ticket ID]` for the raw saved state.

## Where to iterate first
- Tune the brief sections and ticket format in `/dt-start` to the repo's real conventions, and set `checks` to the exact affected-targets command.
- Agents settle uncertain choices in chat and save planning edits directly; optional `/dt-revise` audits coverage without renewing plan approval; do not recreate a G2 pending gate for ordinary revisions.
- If you want blocking gates or a TUI board, grow `extensions/dt-resume.ts`; keep the state logic in `dt.mjs`.
