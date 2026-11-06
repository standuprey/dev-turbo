# dev-turbo for pi (v0.3)

Prompt templates, one zero-dependency script and extensions for help, read-only status, resume, a selected session project and local argument autocomplete. Files are the memory; you hold the gates.

## Principles
1. Every task starts with a grill; the tier (T0 / T1 / T2) is decided at its end from facts and a fixed rule table, and you approve it through `/dt-approve scope`.
2. You own the architecture: a gate on modules and contracts before any parallel work, and a drift review every 2-3 merges.
3. Deep modules, one responsibility, one-way dependencies; contracts written as code; one Mermaid notation for every module diagram.
4. Vertical, testable slices; BDD outer loop (Gherkin per ticket), TDD inner loop.
5. Fresh context for review; two lanes, never more than 2 tickets in flight; state kept by `dt.mjs`, never hand-edited.
6. Sessions are disposable: after `/dt-spec`, every step starts from the feature folder and saves its outcome there, so `/dt-resume` can pick up any feature in a new session with a small context.

## Flow

**Move forward with a dt-command.** Discussion is for questions and adjustments; a chat “yes” never records approval. Every gate card ends with the exact next command.

Start with `/dt-grill <task>`. It saves a Scope proposal. `/dt-approve scope` confirms the project name, records approval and selects it. Following commands omit the slug. In a new session, `/dt-resume [slug]` selects an existing project; the footer shows its name.

### Full feature flow (T2)

| Command | What happens |
|---|---|
| `/dt-grill <task>` | Discuss scope, risks and decisions. |
| `/dt-approve scope` | Approve task, tier, type and project name. |
| `/dt-spec` | Propose modules, contracts and architecture. |
| `/dt-approve architecture` | Approve the design. |
| `/dt-slice` | Propose a new plan, or show only affected-ticket changes when a plan already exists. |
| `/dt-approve slices` | Approve the slice plan. |
| `/dt-lane 00` | Build the walking skeleton first. |
| `/dt-review 00` | Review before merge; discuss and fix findings. |
| `/dt-final-check 00` | After merge, verify the final checks and report any gaps; no repeat code review. |
| `/dt-approve ticket 00` | After you merge and verify acceptance, record completion. |
| `/dt-lane next` | Build a ready ticket; at most two in flight. |
| `/dt-review <id>` → merge → `/dt-final-check <id>` → `/dt-approve ticket <id>` | Repeat pre-merge review and post-merge acceptance for each ticket. |
| `/dt-drift` | Review architecture drift every 2–3 merges and at the end. |
| `/dt-approve drift` | Choose code / spec / accept for each finding. |
| `/dt-drift apply` | Apply those decisions; spec changes lead back to `/dt-slice`. |

### Amend a selected T2 project

Use `/dt-amend <description>` to discuss a deliberate change without starting a new project or clearing the selection. It asks a short alignment round about the outcome, preserved behavior, affected tickets, risks and verification. It saves the proposal in `amendment.md`, not in the approved spec or tickets. This is not an approval gate.

| Alignment result | Next steps |
|---|---|
| Approved behavior/design/contracts/data/scale/rollout need to change | `/dt-spec` proposes targeted amendments → `/dt-approve architecture` → `/dt-slice` → `/dt-approve slices`. |
| The spec remains valid; only ticket scopes, follow-ups or priorities/dependencies change | `/dt-slice` shows affected-ticket changes → `/dt-approve slices`. |

The command records a non-approval gate change only after questions are settled, preventing approval of the superseded plan. It then stops at the chosen `/dt-spec` or `/dt-slice` handoff; no implementation starts. Downstream commands read the saved proposal in a fresh session. Done and merged work stays intact; additional scope becomes follow-up tickets. Deliberate amendments are separate from `/dt-drift`, which compares landed code with the approved architecture.

Example: `/dt-amend prioritize isolating v1 code while keeping flag-off behavior and the rollout unchanged`.

### T2 implementation loop

After ticket 00 is accepted, repeat this loop. **Repeat for each ready ticket**, with at most two tickets in flight and no shared touches/unsafe pairs.

```text
┌──────┐    ┌───────────────┐    ┌─────────────────┐    ┌──────────────┐
│      │    │               │    │                 │    │              │
│Build ├───►│Review and fix ├───►│Merge and verify ├───►│Accept ticket │
│      │    │               │    │                 │    │              │
└──────┘    └───────────────┘    └─────────────────┘    └───────┬──────┘
    ▲                                                           │
    ╰───────────────────────────────────────────────────────────╯
```

| Step | What to do |
|---|---|
| Build | `/dt-lane next` picks a ready ticket and builds/tests it. |
| Review and fix | `/dt-review <id>`; discuss findings, fix them and repeat review until resolved. |
| Merge and verify | You merge the PR(s), then `/dt-final-check <id>` completes or records missing acceptance evidence without repeating code review. Merged is not yet recorded done. |
| Accept | `/dt-approve ticket <id>` records completion; then return to `/dt-lane next`. |

**Drift detour:** every 2–3 merges and at the end, run `/dt-drift` → `/dt-approve drift` (choose each finding) → `/dt-drift apply`, then follow the matching branch:

| Result | Return path |
|---|---|
| No spec/scope changes | Return to `/dt-lane next`; complete any recorded code follow-ups before affected ticket acceptance. |
| Spec or ticket scopes changed | `/dt-slice` shows the alignment delta → `/dt-approve slices` → `/dt-lane next`. Preserve done and merged work; do not rebuild an already merged 00. |
| All tickets accepted and final drift resolved | `/dt-status` confirms completion; there is no next implementation ticket. |

If drift happens while 00 is merged but unaccepted, align any changed scopes, use `/dt-final-check 00` for outstanding acceptance checks, then `/dt-approve ticket 00` before starting other tickets. Approval never merges a PR or starts the next loop automatically.

### Named approvals

`/dt-approve ` autocompletes **only pending** gates: `scope`, `architecture`, `slices`, `ticket`, `drift`. After `ticket`, it suggests pending ticket IDs. After `drift`, it suggests explicit decisions for undecided findings, e.g. `/dt-approve drift 1:code 2:spec 3:accept`. Without arguments, the command asks for each decision in a picker. Each approval has a confirmation dialog. Approval confirms a saved proposal; it never merges a PR or starts implementation. Ticket acceptance requires merged PRs, saved verification and resolved blockers. If `/dt-final-check <id>` reports all checks passed, read the results and run `/dt-approve ticket <id>`; no extra step is required. If checks are missing or failed, resolve those gaps and rerun `/dt-final-check <id>` first.

The walking skeleton is ticket 00’s acceptance, not an extra gate. Drift approval is recurring, not proof that rollout or feature acceptance is complete. Spec amendments require a fresh slice review before more ticket acceptance.

When tickets already exist, `/dt-slice` shows a change-review card: current spec path and amendment summary, preserved work, affected tickets with current status and reasons, and dependency/acceptance changes. It does not repeat the full plan, DAG or scenario inventory. Merged work awaiting recorded Ticket acceptance is labelled explicitly; re-slicing does not mean rebuilding it. The router sends merged tickets to `/dt-final-check <id>` for evidence, or directly to `/dt-approve ticket <id>` when a valid acceptance proposal is pending. Saved review/build handovers do not override merged PR facts. The spec is normally already updated by `/dt-drift apply`; `/dt-slice` aligns the tickets with it.

### Small tasks (T0 / T1)

- T0: `/dt-grill` → `/dt-approve scope` → `/dt-quick` → `/dt-review` if needed → `/dt-approve ticket`.
- T1 adds a scenario-plan checkpoint: `/dt-quick` → `/dt-approve slices` → `/dt-quick` to build.
- You merge the quick PR before `/dt-approve ticket`.

### Any time

- `/dt-status`: read-only completion, remaining tickets and blockers; **the next dt-command(s) are shown last**. No model call or remote refresh.
- `/dt-amend <description>`: mini alignment for a change to the selected T2 project; hands off to `/dt-spec` or `/dt-slice`.
- `/dt-help`: this guide, without a model call.
- `/dt-resume [slug]`: select/switch projects; remote refresh failures keep the local selection. It can put the next command in the editor, but does not run it.

Selection survives reloads, reopening and forks of the Pi session. A brand-new session needs resume or a new grill. Starting a new grill clears the old selection. The underlying `dt.mjs` CLI keeps numeric IDs and explicit slugs; those are implementation details, not the user approval flow. See [workflow.md](workflow.md) for the detailed map.

## Examples

- Button typo (T0): grill → Scope approval → quick build → merge → Ticket acceptance.
- Pagination fix (T1): Scope approval → quick scenario plan → Slices approval → quick build → review → merge → Ticket acceptance.
- Export service (T2): follow the full flow above; approve the skeleton before running other tickets in parallel.

## The script
`dt.mjs` (Node 18+, no dependencies) is what the prompts call; everything it does, you can run yourself:

```
dt.mjs -h                                list commands and global help
dt.mjs <command> -h                      show usage and options for any command
dt.mjs info                               repo, modality, main branch, lanes, features dir, checks
dt.mjs config set checks "<cmd>"          remember the affected-targets command for this repo
dt.mjs resume [<slug>]                    list features, or a short brief of one (refreshes PRs/issues)
dt.mjs progress <slug> [--ticket ID] ...  show or update the current state in progress.json
dt.mjs status <slug>                      kanban + DAG + unsafe pairs
dt.mjs next <slug> [--ticket ID]          pick a ready ticket: branch in a clone, or a new worktree
dt.mjs gate <slug> <0-4> approve|change|pending   record a gate (+ issues, worktree cleanup, drift nudge)
dt.mjs pr <slug> <ID> --body-file F | pr quick    open and record the PR (draft in monorepo, ready in standalone)
dt.mjs comment --body-file F              post review findings on the PR
dt.mjs selftest                           test the pure logic
```
`-h` and `--help` work at every command level, including `config set`, `config set checks`, and `pr quick`, without requiring a Git repository or running workflow actions. Running `dt.mjs` without arguments shows the top-level help. Run `node --test *.test.mjs` for the CLI, session-state, footer and autocomplete tests. To include the optional Pi-runtime integration test, set `PI_PACKAGE_DIR` to the installed `@earendil-works/pi-coding-agent` package directory.

`--dry-run` prints the git/gh commands instead of running them. Rules it enforces: max 2 tickets in flight, `blocked_by` done, no shared `touches`, no `unsafe_with` pair, monorepo lanes only in the configured clones, standalone lanes only from the main checkout.

## Install
```
./install.sh                 prompts → ~/.pi/agent/prompts, dt.mjs + AGENTS.md + README.md + overlays → ~/.pi/agent/dt, help + status + approve + resume + session + autocomplete → ~/.pi/agent/extensions, config.json if missing, selftest
./uninstall.sh               removes prompts, dt.mjs, installed docs, overlays, the extensions; keeps config.json and features/
./uninstall.sh --purge       also removes config.json and features/ (asks first)
```
The extensions use the Node Pi package's existing jiti runtime so `/reload` also refreshes helper modules; no extra dependency install is needed.

Then `/reload` in pi. Edit `~/.pi/agent/dt/config.json`: lanes are the two monorepo clone paths; `checks` is asked once per repo by the grill if left empty. Needs `gh` logged in for issues and PRs.

## Monorepo PR conventions

Prefer lowercase `ov-<jira-number>-<slug>` PR head names, e.g. `ov-715-verify-v2-rest`, and target `master` by default. Split PRs should each contain only their own scope; do not introduce a stack without asking. Preserve published PR URLs instead of recreating drafts for cosmetic naming changes. See [AGENTS.md](AGENTS.md) for the complete preference and the current canonical `ticket/<feature>-<id>` tooling limitation.

Keep PRs short: a few plain change bullets under `## Description`, then `## Testing` starting with `unit tests + staging tests` and one suggested staging check. Mention only real merge prerequisites. Leave test implementation, unfinished work and long verification records out of the body. See [AGENTS.md](AGENTS.md) for the format; `dt.mjs pr` takes a short `--body-file`.

## Day to day
- `/dt-help` displays the workflow guide directly, without a model call, repository lookup or state changes.
- `/dt-resume ` autocompletes feature slugs. After selection, `/dt-lane ` suggests `next` and that project's ticket IDs; `/dt-review ` suggests its ticket IDs and `autofix` after a target; `/dt-final-check ` suggests ticket IDs for post-merge acceptance; `/dt-spec ` suggests task types. Suggestions use local files only, with a two-second feature-list cache; no GitHub refresh or state writes.
- New session: open pi in the repository (or a lane) and run `/dt-resume`. Pick a feature; it posts a short brief (phase, gates, board, in-flight tickets with PRs, verification, todo, next step) and offers to continue.
- Monorepo: open pi in clone 1 or clone 2 and run `/dt-lane next`. Feature docs live in `~/.pi/agent/dt/features/<org>/<repo>/<slug>/`, shared by both clones; a small local git repo commits every saved state.
- Standalone: run `/dt-lane next` from the main checkout; it creates `../<repo>.lane-<id>` and tells you to open pi there. Feature docs, `progress.json` included, live in the main checkout's `docs/features/<slug>/`: commit `progress.json` when convenient (it is state, not code).
- `/dt-status` displays a saved-state board directly: completed tickets and verification, tickets/slices left, in-flight work, blockers, gates and next steps. It does not call the model, start work, refresh remote facts or write project state. It requires a selected project; it never guesses from a branch or the only feature. Use `/dt-resume` to select or switch projects.
- `dt.mjs status <slug>` any time for the full board and DAG; `dt.mjs progress <slug> [--ticket ID]` for the raw saved state.

## Where to iterate first
- Tune the module-map table in `/dt-spec` to the monorepo's real conventions, and set `checks` to the exact affected-targets command.
- If a gate card keeps missing what you need, change the card list in that prompt; the shape is the same in all of them.
- If you want blocking gates or a TUI board, grow `extensions/dt-resume.ts`; keep the state logic in `dt.mjs`.
