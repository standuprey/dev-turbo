# dev-turbo for pi (v0.4)

Prompt templates, one zero-dependency script and extensions for help, read-only status, resume, a selected session project and local argument autocomplete. Files are the memory; you hold the approvals.

## Principles
1. Every task starts with a grill. The agent gives a short summary and asks you to choose T0 / T1 / T2 without guessing or recommending a tier, then writes the plan from what you settled: a short brief and outcome-level tickets. You approve it once with `/dt-approve plan`.
2. Plan the big building blocks, not the details. Interfaces are written as code in ticket 00 and reviewed in its PR; each lane writes its own scenarios from the ticket's outcome.
3. Deep modules, one responsibility, one-way dependencies; one Mermaid notation for module diagrams.
4. Vertical, demoable tickets; TDD inner loop; fresh context for review; state kept by `dt.mjs`, never hand-edited.
5. The plan changes when reality does. `/dt-revise` edits the brief and unstarted tickets directly and asks for approval only when the plan's shape changes.

## Flow

**Move forward with a dt-command.** Discussion is for questions and adjustments; a chat "yes" never records approval.

Start with `/dt-start <task>`. After the grill, it asks you to choose a tier and writes the plan: T0/T1 get one ticket; T2 gets a brief (`spec.md`) and a handful of tickets. The spec says what and why: behavior, goals, constraints and acceptance criteria. Tickets say how: slices, module ownership, dependencies, implementation approach and landing order. The shared building-block table and diagram live in ticket 00, not the spec. It saves a plan proposal only after your explicit choice. `/dt-approve plan` confirms the project name, records approval and selects the project. Following commands omit the slug. In a new session, `/dt-resume [slug]` selects an existing project; the footer shows its name.

### Commands

| Command | What it does |
|---|---|
| `/dt-start <task>` | Grill, choose the tier, then write the brief and tickets. Clears the current selection. |
| `/dt-approve plan` | Approve a new plan (creates and selects the project) or a revised one. |
| `/dt-lane [id [force]]` | Open the ticket picker, or start/resume one ticket: scenarios red, TDD green, verify, PR. T0/T1 build ticket 00 in the current checkout on `quick/<slug>`. `force` takes over a claim in its saved checkout. |
| `/dt-review [id \| branch] [autofix]` | Review in chat before merge; offer to fix selected findings. Re-review is optional. |
| `/dt-check-merged` | After you merge, check every open ticket's PRs on GitHub, report their states and close each ticket whose PRs are all merged. |
| `/dt-revise [change]` | Change the plan, or without a description check it against the landed code. |
| `/dt-status [id]` | Show the saved board, or one full ticket and its saved progress. No model call. |
| `/dt-resume [slug]` | Select or switch projects and show where one stands. |
| `/dt-help` | Show this command flow. No model call. |

### T2 implementation loop

When an implementation approach needs investigation, create a bounded spike with a question, experiment, effort limit and reviewed findings. Dependent tickets wait for it; findings settle the approach through `/dt-revise`, without rewriting the spec unless requirements change. A spike needed to design the skeleton can run before 00.

Ticket 00 is the walking skeleton: the building blocks' interfaces as compiling code, fakes and one trivial path through every layer. Every later implementation ticket waits for it; prerequisite spikes do not. After 00 is closed, **repeat for each ready ticket**; tickets with shared `touches` or `unsafe_with` pairs never run together, and there is no in-flight limit.

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

`/dt-revise <change>` asks a few questions, then edits only the affected files. Implementation-only changes leave the spec untouched; behavior or constraint changes update the spec and affected tickets. `/dt-revise` without a description compares landed behavior with the spec and implementation with tickets, asks you to confirm differences, then updates the appropriate files or turns needed code fixes into new tickets.

| Change | Approval |
|---|---|
| Wording, scope inside a module, a new ticket that depends only on existing ones, confirmed requirement clarifications | None. Continue with `/dt-lane`. |
| A building block is added, removed or changes owner; in-flight work must change; a ready ticket's dependencies change | `/dt-approve plan`. New starts wait; work in flight continues. |

Done and merged tickets are never reopened; extra work becomes a new ticket. A T0/T1 task stays one ticket; bigger changes become a new T2 project.

### Ticket picker and lane ownership

Run **`/dt-lane`** to choose a ticket. Resume/status recommend this command when ready work fits alongside existing tickets. The picker reads saved local state; it does not refresh GitHub or change progress. Available tickets appear first, and accepted tickets are omitted.

| Picker label | Meaning / action |
|---|---|
| **READY** | Available to start in this checkout. Select it to build. |
| **RESUME** | In-progress work available to resume here. Select it to continue. |
| **LOCKED** | Owned by another session or assigned to another checkout. The row shows its owner/lane. Selecting it explains the lock; it does not start work or take over. |
| **BLOCKED** | Cannot start yet. The row shows the dependency, plan approval, saved blocker or resource limit. |
| **REVIEW** | Use `/dt-review <id>`. |
| **MERGED** | Use `/dt-check-merged` to confirm on GitHub and close it. |

**Canceling changes nothing.** After selection, the extension displays a short summary with the ticket ID, title and outcome, then asks whether it is the ticket you want to work on. This also applies to explicit IDs, resumes and force takeovers. Declining or canceling leaves claims, Jira and Git unchanged. Use `/dt-status <id>` to read the full ticket and its saved progress. After confirmation, the agent rechecks safety and claims the ticket atomically before Git operations. If another agent claimed it while the picker was open, starting work is refused.

- `/dt-lane <id>` skips the picker, not ticket confirmation or safety checks. Starting requires an interactive or RPC confirmation dialog; non-interactive sessions can inspect tickets with `/dt-status <id>` but cannot start a lane.
- `/dt-lane <id> force` explicitly takes over a claim **in its saved checkout**, after you check the previous agent is gone. It does not stop that agent or cancel running commands. Dirty-tree, dependency and module-conflict checks still apply.

Claims in `progress.json` record the Pi session owner, checkout and acquisition time. Another session cannot resume a claim or save ticket progress/PRs with the old owner. In-progress work in another lane is context, not an invitation to join that agent.

Claims do not expire on a timer. A final save with `--release-claim`, or normal session shutdown, releases only that session's claims. In a monorepo checkout, explicitly selecting a different ticket can atomically release the checkout's old claim and acquire the new one when Git has no uncommitted changes and no other local Pi session is using the checkout. Process inspection fails closed if unavailable. This is local CLI detection, not a lock on arbitrary editors or remote agents. Release preserves the old ticket's branch, progress, existing artifacts and review state.

The session context supplies `--owner <session-ID>` for `dt.mjs next`, ticket progress updates and `pr`. CLI users must supply their own stable owner ID. Reload existing sessions when idle; do not interrupt an agent mid-command.

### UI references

For UI work in any tier, including mixed UI/backend tickets, `/dt-start` inspects supplied prototypes during the grill and settles whether their appearance and behavior are authoritative or illustrative. It saves relevant screenshots under `<feature>/references/ui/` with `references/ui/manifest.md` recording source URLs, screen/states, viewports, capture dates, reproduction steps and agreed differences. Each UI ticket embeds relative screenshot links and names its source and relevant states. `/dt-status <id>` ends the complete ticket and saved progress with only `Reference screenshots: file:///tmp/dt-ticket-<id>-images-…/`; it does not append inline images, individual image URLs or screenshot labels. The private temporary folder contains copies of all readable, supported references, numbered in reference order with duplicate files exported once. Inline and reference-style image links resolve relative to the ticket and must stay inside the feature directory (including symlink targets); no remote image is fetched. Missing or rejected images produce warning notifications without hiding the ticket. PNG, JPEG, GIF and WebP captures are supported, up to 10 MiB per image and 32 MiB per ticket. Each invocation exports validated image bytes into a fresh folder; folders remain until manually removed or cleared by the system, and project state is unchanged. Lane confirmation stays summary-only. If capture is blocked or no reference is supplied, the user must provide screenshots or explicitly waive the missing coverage; the agent cannot silently skip it.

`/dt-revise` applies the same rules to added or updated UI tickets and can backfill references in existing plans without changing settled scope. Done and merged tickets stay unchanged. `/dt-lane` reads the captures before implementation, and browser verification compares the result against them; visual acceptance remains human-owned. These durable planning inputs are separate from optional verification artifacts and must be preserved. This is prompt-guided behavior, not an automatic CLI screenshot validator.

### Verification records

Save short verification results, useful links and remaining checks in `progress.json` through `dt.mjs progress --verification`, `--todo` and `--blocker`; never edit it by hand. There is no required per-feature `evidence/` folder. Keep separate artifacts only when genuinely useful, such as a screenshot for visual review, and link them in the saved verification result. Existing artifacts and references are preserved.

### Approval and closure

`/dt-approve plan` approves a new plan (creating and selecting the project) or a revised one. It asks for confirmation, and fails if the plan files changed while its dialog was open.

Merging a ticket's PRs is your decision; `/dt-check-merged` only records it. It checks every saved PR of each open ticket live on GitHub, reports the states in one table, and closes each ticket whose PRs are all merged. Tickets with an open, closed-unmerged or unreadable PR stay open. It needs no confirmation, and closure is not proof that staging or production checks passed.

Neither command merges a PR or starts implementation.

### Any time

- `/dt-status [id]`: read-only board (completion, remaining tickets, blockers, plan state, **next dt-command(s) last**) or one full ticket with its saved progress. No model call or remote refresh.
- `/dt-help`: this command flow, picker labels and ownership rules, without a model call.
- `/dt-resume [slug]`: select/switch projects; remote refresh failures keep the local selection. It shows next commands in the transcript.

Selection survives reloads, reopening and forks of the Pi session. A brand-new session needs resume or a new grill. Starting a new grill clears the old selection. The removed commands `/dt-spec`, `/dt-slice`, `/dt-amend`, `/dt-drift` and `/dt-quick` print their replacement. See [workflow.md](workflow.md) for the detailed map.

## Examples

- Button typo (T0): `/dt-start` → `/dt-approve plan` → `/dt-lane` → merge → `/dt-check-merged`.
- Pagination fix (T1): same as T0; the single ticket lists 2-5 scenario titles, and `/dt-review` before merge.
- Export service (T2): `/dt-start` writes a one-page brief and five tickets → `/dt-approve plan` → skeleton 00 → parallel lanes → `/dt-revise` when reality differs.

## The script
`dt.mjs` (Node 18+, no dependencies) is what the prompts call; everything it does, you can run yourself:

```
dt.mjs -h                                list commands and global help
dt.mjs <command> -h                      show usage and options for any command
dt.mjs info                               repo, modality, main branch, lanes, features dir, checks
dt.mjs config set checks "<cmd>"          remember the affected-targets command for this repo
dt.mjs resume [<slug>]                    list features, or a short brief of one (refreshes PRs/issues)
dt.mjs progress <slug> [--ticket ID] ...  show or update the current state in progress.json
dt.mjs migrate-progress <slug>            migrate legacy ticket lanes to optional worktree paths
dt.mjs status <slug>                      kanban + DAG + unsafe pairs
dt.mjs next <slug> --owner ID [--ticket ID] [--force]   claim a ready ticket, then branch or create a worktree
dt.mjs gate <slug> <0|2|3> approve|change|pending   record plan approval (0 new, 2 revised) or ticket closure (3)
dt.mjs pr <slug> <ID> --body-file F       open and record the PR (draft in monorepo, ready in standalone)
dt.mjs comment --body-file F              manually post a PR comment (not used by /dt-review)
dt.mjs selftest                           test the pure logic
```
`-h` and `--help` work at every command level, including `config set` and `config set checks`, without requiring a Git repository or running workflow actions. Running `dt.mjs` without arguments shows the top-level help. Run `node --test *.test.mjs` for the CLI, session-state, footer and autocomplete tests. To include the optional Pi-runtime integration test, set `PI_PACKAGE_DIR` to the installed `@earendil-works/pi-coding-agent` package directory.

`--dry-run` prints the git/gh commands instead of running them, without claiming a ticket. Rules it enforces: checkout ownership, `blocked_by` done, no shared `touches`, no `unsafe_with` pair, T2 monorepo lanes only in the configured clones, T2 standalone lanes only from the main checkout; T0/T1 tickets branch `quick/<slug>` in the current checkout. Feature docs inside the repo never count as uncommitted changes.

Tickets no longer save a `lane` field. Active ownership lives in `claim.checkout`; monorepo lane labels come from the current branches in configured clones, not historical assignments. Standalone tickets optionally save an absolute `worktree` path for resume and cleanup after a claim is released (`progress --ticket ID --worktree PATH`). Legacy lane numbers are discarded on read; legacy absolute paths migrate to `worktree`. Run `dt.mjs migrate-progress <slug>` to persist that migration under the progress lock without changing claims, approvals, timestamps or other saved state.

## Install
```
./install.sh                 prompts → ~/.pi/agent/prompts, dt.mjs + AGENTS.md + README.md + overlays → ~/.pi/agent/dt, help + status + approve + resume + session + autocomplete → ~/.pi/agent/extensions, config.json if missing, selftest
./uninstall.sh               removes prompts, dt.mjs, installed docs, overlays, the extensions; keeps config.json and features/
./uninstall.sh --purge       also removes config.json and features/ (asks first)
```
The extensions use the Node Pi package's existing jiti runtime so `/reload` also refreshes helper modules; no extra dependency install is needed.

Then `/reload` in pi. Edit `~/.pi/agent/dt/config.json`: lanes are the two monorepo clone paths; `checks` is asked once per repo by the grill if left empty. Needs `gh` logged in for issues and PRs.

## Monorepo PR conventions

For `csscompany-enterprise/monorepo` and `csscompany-enterprise/ottercam`, `/dt-start` asks for an existing Jira epic and saves its key as `feature.json.epic` only for T2 projects. T0/T1 assume all work fits inside one ticket and do not require an epic. For T2 tickets, after ticket display and confirmation, `/dt-lane` claims first with `next --claim-only`, creates/reuses a Jira ticket under that epic with a title and 3–5 short description bullets, and saves it with `progress --jira-key KEY --jira-description-file FILE`. In monorepo modality, newly created Jira tickets are also assigned to the user, added to the current active sprint and transitioned to In Progress before branching. The agent discovers the user's Jira account, the active sprint (JQL `sprint in openSprints()`, no board lookup) and available transition rather than hard-coding IDs, and verifies all three updates. Set assignee and sprint with an issue edit, then apply the transition in a separate call that carries no fields. Ambiguous choices or no active sprint require user input; failed updates keep the saved key for retries and block implementation. Established tickets are not reassigned, moved to a newer sprint or reset on resume; standalone behavior is unchanged. Jira access and parent verification use the agent's available Jira tools; failure blocks implementation. New branches use lowercase snake_case, e.g. `ov_777_update_schema`. Resume, lane display, PRs and cleanup use the saved branch; other repos keep `ticket/<feature>-<id>`, and T0/T1 tickets use `quick/<slug>` without a Jira ticket. Existing saved branches and published PR URLs are preserved.

In monorepo, target `master` by default. Split PRs should each contain only their own scope; do not introduce a stack without asking. See [AGENTS.md](AGENTS.md).

Keep PRs short: a few plain change bullets under `## Description`, then `## Testing` starting with `unit tests + staging tests` and one suggested staging check. Mention only real merge prerequisites. Leave test implementation, unfinished work and long verification records out of the body. In monorepo modality, new ticket PR titles use `<UPPERCASE-TICKET-ID>: <ticket-title>` (the saved Jira key when available), and the Jira browse URL goes immediately below `## Description`, before the change bullets. `dt.mjs pr` adds a missing link without rewriting the supplied description; extra PRs use the same format. Existing published PRs are preserved. See [AGENTS.md](AGENTS.md) for the format; `dt.mjs pr` takes a short `--body-file`.

## Day to day
- `/dt-help` displays the workflow guide directly, without a model call, repository lookup or state changes.
- `/dt-resume ` autocompletes feature slugs. After selection, `/dt-lane ` and `/dt-status ` suggest that project's ticket IDs; `/dt-review ` suggests its ticket IDs and `autofix` after a target; `/dt-approve ` suggests `plan` when one is pending. Suggestions use local files only, with a two-second feature-list cache; no GitHub refresh or state writes.
- New session: open pi in the repository (or a lane) and run `/dt-resume`. Pick a feature; it posts a short brief (phase, gates, board, in-flight tickets with PRs, verification, todo, next step) and lists next commands without a follow-up picker.
- Monorepo: open pi in clone 1 or clone 2 and run `/dt-lane`, then choose a ready ticket. Locked rows identify work in another session/checkout. Feature docs live in `~/.pi/agent/dt/features/<org>/<repo>/<slug>/`, shared by both clones; a small local git repo commits every saved state.
- Standalone: commit and push T2 ticket files to the main branch, then run `/dt-lane` from the main checkout and choose a ready ticket. After selection, it creates `../<repo>.lane-<id>` and tells you to open pi there; run `/dt-lane <id>` there to resume. Feature docs, `progress.json` included, live in the main checkout's `docs/features/<slug>/`: commit `progress.json` when convenient (it is state, not code).
- `/dt-status` displays a saved-state board directly: completed tickets and verification, tickets left, in-flight work, blockers, plan state and next steps. `/dt-status <id>` shows one full ticket, followed by readable saved progress from `progress.json`, including claims, branch, verification, todos, blockers, PRs, Jira metadata and acceptance. Empty fields are omitted. It explicitly reports when no progress is saved for that ticket. It does not call the model, start work, refresh remote facts or write project state. It requires a selected project; it never guesses from a branch or the only feature. Use `/dt-resume` to select or switch projects.
- `dt.mjs status <slug>` any time for the full board and DAG; `dt.mjs progress <slug> [--ticket ID]` for the raw saved state.

## Where to iterate first
- Tune the brief sections and ticket format in `/dt-start` to the repo's real conventions, and set `checks` to the exact affected-targets command.
- If revisions keep needing approval, adjust the "Approval only for big changes" rule in `/dt-revise`.
- If you want blocking gates or a TUI board, grow `extensions/dt-resume.ts`; keep the state logic in `dt.mjs`.
