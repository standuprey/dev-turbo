# dev-turbo for pi (v0.3)

Prompt templates, one zero-dependency script and extensions for help, read-only status, resume, a selected session project and local argument autocomplete. Files are the memory; you hold the gates.

## Principles
1. Every task starts with a grill; the tier (T0 / T1 / T2) is decided at its end from facts and a fixed rule table, and you approve it through `/dt-approve scope`.
2. You own the architecture: a gate on modules and contracts before any parallel work, and a drift review every 2-3 merges.
3. Deep modules, one responsibility, one-way dependencies; contracts written as code; one Mermaid notation for every module diagram.
4. Vertical, testable slices; each ticket has a `Change | Purpose` table and one Gherkin scenario per change; TDD inner loop.
5. Fresh context for review; configured lanes, no fixed limit on tickets in flight; state kept by `dt.mjs`, never hand-edited.
6. Workflow proposals and results live in the feature folder, so `/dt-resume` can pick them up in a new session. `/dt-amend` is discussion only; restate an unsaved change when switching sessions.

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
| `/dt-lane` | Open the ticket picker. On a new plan, choose 00 to build the walking skeleton first. |
| `/dt-review 00` | Review in chat before merge; offer to fix selected findings. Re-review is optional. |
| `/dt-approve 00` | Check all saved PRs are merged on GitHub, then close the ticket internally. |
| `/dt-lane` | Choose the next ready ticket in the picker; independent work stays ready while other tickets await merge. |
| `/dt-lane <id>` | Skip the picker, read a short ticket summary and confirm before starting/resuming it. |
| `/dt-show [id]` | Display the full ticket without starting work; omit the ID to choose any ticket. |
| `/dt-lane <id> force` | Take over a ticket claim in its saved checkout after checking the previous agent is gone. |
| `/dt-review <id>` → merge → `/dt-approve <id>` | Review in chat, choose fixes, then human merge and internal closure. Re-review is optional. |
| `/dt-drift` | Review architecture drift every 2–3 merges and at the end. |
| `/dt-approve drift` | Choose code / spec / accept for each finding. |
| `/dt-drift apply` | Apply those decisions; spec changes lead back to `/dt-slice`. |

### Amend a selected T2 project

Use `/dt-amend <description>` to discuss a deliberate change without starting a new project or clearing the selection. It asks a short clarification round, then explains whether and how the spec and plan/tickets/slices need amending. This is discussion only, not an approval gate: no artifacts, gate changes or progress writes.

| Alignment result | Next steps |
|---|---|
| Approved behavior/design/contracts/data/scale/rollout need to change | `/dt-spec` proposes targeted amendments → `/dt-approve architecture` → `/dt-slice` → `/dt-approve slices`. |
| The spec remains valid; only ticket scopes, follow-ups or priorities/dependencies change | `/dt-slice` shows affected-ticket changes → `/dt-approve slices`. |

The command suggests `/dt-spec` or `/dt-slice` and stops; it does not run either command or start implementation. The downstream command uses the discussion in the same session; in a fresh session, restate the intended change. Done and merged work stays intact; additional scope becomes follow-up tickets. Deliberate amendments are separate from `/dt-drift`, which compares landed code with the approved architecture.

Example: `/dt-amend prioritize isolating v1 code while keeping flag-off behavior and the rollout unchanged`.

### T2 implementation loop

After ticket 00 is accepted, repeat this loop. **Repeat for each ready ticket**, with no shared touches/unsafe pairs; the in-flight count is informational, not a blocker.

```text
┌──────┐    ┌───────────────┐    ┌────────────┐    ┌───────────┐    ┌─────┐
│      │    │               │    │            │    │           │    │     │
│Build ├───►│Review and fix ├───►│Human merge ├───►│Approve id ├───►│Done │
│      │    │               │    │            │    │           │    │     │
└──────┘    └───────────────┘    └────────────┘    └───────────┘    └─────┘
```

| Step | What to do |
|---|---|
| Build | `/dt-lane` opens the ticket picker. Choose a ready ticket to build/test. |
| Review and fix | `/dt-review <id>` suggests fixes in chat and offers to apply selected items. No PR or ticket comments. Re-review after fixes is optional, not a merge or closure prerequisite. Acceptance evidence stays in progress. |
| Human merge | You merge every ticket PR. No separate post-merge acceptance check is required. |
| Close | `/dt-approve <id>` checks live merge states and records completion; then return to `/dt-lane`. |

**Drift detour:** every 2–3 merges and at the end, run `/dt-drift` → `/dt-approve drift` (choose each finding) → `/dt-drift apply`, then follow the matching branch:

| Result | Return path |
|---|---|
| No spec/scope changes | Return to `/dt-lane`; complete any recorded code follow-ups before affected ticket acceptance. |
| Spec or ticket scopes changed | `/dt-slice` shows the alignment delta → `/dt-approve slices` → `/dt-lane`. Preserve done and merged work; do not rebuild an already merged 00. |
| All tickets accepted and final drift resolved | No next command; the implementation loop is complete. |

If drift happens while 00 is merged but unaccepted, use `/dt-approve 00` to check live merge states and close it before starting other tickets. Approval never merges a PR or starts the next loop automatically.

### Ticket picker and lane ownership

Run **`/dt-lane`** to choose a ticket. Resume/status recommend this command when ready work fits alongside existing tickets. The picker reads saved local state; it does not refresh GitHub or change progress. Available tickets appear first, and accepted tickets are omitted.

| Picker label | Meaning / action |
|---|---|
| **READY** | Available to start in this checkout. Select it to build. |
| **RESUME** | In-progress work available to resume here. Select it to continue. |
| **LOCKED** | Owned by another session or assigned to another checkout. The row shows its owner/lane. Selecting it explains the lock; it does not start work or take over. |
| **BLOCKED** | Cannot start yet. The row shows the dependency, approval, saved blocker or resource limit. |
| **REVIEW** | Use `/dt-review <id>`. |
| **MERGED** | Use `/dt-approve <id>` to check live merge states and record closure. |

**Canceling changes nothing.** After selection, the extension displays a short summary with the ticket ID, title and outcome, then asks whether it is the ticket you want to work on. This also applies to explicit IDs, resumes and force takeovers. Declining or canceling leaves claims, Jira and Git unchanged; the summary remains in the transcript. Use `/dt-show <id>` to read the full ticket. After confirmation, the agent rechecks safety and claims the ticket atomically before Git operations. If another agent claimed it while the picker was open, starting work is refused. Ticket selection confirmation does not approve a workflow gate.

`/dt-show <id>` displays the full ticket without a model call, remote refresh, claim or Git changes. Bare `/dt-show` opens a read-only picker that includes locked, blocked and accepted tickets. Each picker entry and the full ticket display show the saved ticket status (todo, in progress, review or done).

- `/dt-lane <id>` skips the picker, not ticket confirmation or safety checks. Starting requires an interactive or RPC confirmation dialog; non-interactive sessions can inspect tickets with `/dt-show <id>` but cannot start a lane.
- `/dt-lane <id> force` explicitly takes over a claim **in its saved checkout**, after you check the previous agent is gone. It does not stop that agent or cancel running commands. Dirty-tree, dependency, module-conflict and two-ticket limits still apply.
- `/dt-lane next` is a legacy alias for the picker, not an automatic choice. Prefer `/dt-lane`.

Claims in `progress.json` record the Pi session owner, checkout and acquisition time. Another session cannot resume a claim or save ticket progress/PRs with the old owner. Existing lane assignments are respected even for work started before claims were added. In-progress work in another lane is context, not an invitation to join that agent.

Claims do not expire on a timer. A final save with `--release-claim`, or normal session shutdown, releases only that session's claims. In a monorepo checkout, explicitly selecting a different ticket can atomically release the checkout's old claim and acquire the new one, even from the old ticket's branch, when Git has no uncommitted changes and no other local Pi session is using the checkout. The requesting session is excluded using process ancestry; idle peer sessions still block switching. macOS/Linux process inspection also checks concurrent `dt.mjs next` commands and fails closed if inspection is unavailable. This is local CLI detection, not a lock on arbitrary editors, SDK hosts or remote agents. Same-ticket takeovers still require explicit force. Release preserves the old ticket's branch, progress, evidence and review state; dependency, module and checkout checks still apply. Failed setup restores the old claim when no new branch was created.

The session context supplies `--owner <session-ID>` for `dt.mjs next`, ticket progress updates and `pr`. CLI users must supply their own stable owner ID. Direct source edits outside this workflow are not locked. Reload existing sessions when idle to enable claim handling; do not interrupt an agent mid-command.

### Named approvals

`/dt-approve <id>` checks every saved ticket PR live on GitHub, then marks the ticket done internally. At least one saved PR is required. Open, closed-unmerged, unknown or inaccessible PRs block closure without changing progress. It does not require a pending acceptance proposal, saved verification, cleared acceptance blockers or a separate post-merge check. `/dt-approve ticket <id>` remains an alias. Closure is not proof that staging or production checks passed.

Named planning approvals (`scope`, `architecture`, `slices`, `drift`) retain their confirmation dialogs. Ticket closure also asks for confirmation; cancellation records nothing. No approval merges a PR or starts implementation.

The walking skeleton is ticket 00’s acceptance, not an extra gate. Drift approval is recurring, not proof that rollout or feature acceptance is complete. Spec amendments require a fresh slice review before further implementation, not before closing merged tickets.

When tickets already exist, `/dt-slice` shows a change-review card: current spec path and amendment summary, preserved work, affected tickets with current status and reasons, and dependency/acceptance changes. It does not repeat the full plan, DAG or scenario inventory. Merged work awaiting recorded Ticket acceptance is labelled explicitly; re-slicing does not mean rebuilding it. The router sends merged tickets directly to `/dt-approve <id>`; old acceptance proposals and gaps do not require another gate. Saved review/build handovers do not override merged PR facts. The spec is normally already updated by `/dt-drift apply`; `/dt-slice` aligns the tickets with it.

### Small tasks (T0 / T1)

- T0: `/dt-grill` → `/dt-approve scope` → `/dt-quick` → `/dt-review` if needed → `/dt-approve ticket`.
- T1 adds a scenario-plan checkpoint: `/dt-quick` → `/dt-approve slices` → `/dt-quick` to build.
- You merge the quick PR before `/dt-approve ticket`.

### Any time

- `/dt-status`: read-only completion, remaining tickets and blockers; **the next dt-command(s) are shown last**. No model call or remote refresh. It is never a next step: in-flight work routes to the claim-aware `/dt-lane` picker; completed work shows no next command.
- `/dt-amend <description>`: mini alignment for a change to the selected T2 project; hands off to `/dt-spec` or `/dt-slice`.
- `/dt-help`: this command flow, picker labels and ownership rules, without a model call.
- `/dt-resume [slug]`: select/switch projects; remote refresh failures keep the local selection. It shows next commands in the transcript, without an action picker or editor changes.

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
dt.mjs migrate-progress <slug>            migrate legacy ticket lanes to optional worktree paths
dt.mjs status <slug>                      kanban + DAG + unsafe pairs
dt.mjs next <slug> --owner ID [--ticket ID] [--force]   claim a ready ticket, then branch or create a worktree
dt.mjs gate <slug> <0-4> approve|change|pending   record a gate (+ issues, worktree cleanup, drift nudge)
dt.mjs pr <slug> <ID> --body-file F | pr quick    open and record the PR (draft in monorepo, ready in standalone)
dt.mjs comment --body-file F              manually post a PR comment (not used by /dt-review)
dt.mjs selftest                           test the pure logic
```
`-h` and `--help` work at every command level, including `config set`, `config set checks`, and `pr quick`, without requiring a Git repository or running workflow actions. Running `dt.mjs` without arguments shows the top-level help. Run `node --test *.test.mjs` for the CLI, session-state, footer and autocomplete tests. To include the optional Pi-runtime integration test, set `PI_PACKAGE_DIR` to the installed `@earendil-works/pi-coding-agent` package directory.

`--dry-run` prints the git/gh commands instead of running them, without claiming a ticket. Rules it enforces: checkout ownership, `blocked_by` done, no shared `touches`, no `unsafe_with` pair, monorepo lanes only in the configured clones, standalone lanes only from the main checkout.

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

For `csscompany-enterprise/monorepo` and `csscompany-enterprise/ottercam`, `/dt-grill` asks for an existing Jira epic and saves its key as `feature.json.epic` (all tiers). After ticket display and confirmation, `/dt-lane` claims first with `next --claim-only`, creates/reuses a Jira ticket under that epic with a title and 3–5 short description bullets, and saves it with `progress --jira-key KEY --jira-description-file FILE`. In monorepo modality, newly created Jira tickets are also assigned to the user, added to the current active sprint and transitioned to In Progress before branching. The agent discovers the user's Jira account, board, active sprint and available transition rather than hard-coding IDs, and verifies all three updates. Ambiguous choices or no active sprint require user input; failed updates keep the saved key for retries and block implementation. Established tickets are not reassigned, moved to a newer sprint or reset on resume; standalone behavior is unchanged. Jira access and parent verification use the agent's available Jira tools; failure blocks implementation. New branches use lowercase snake_case, e.g. `ov_777_update_schema`. Resume, lane display, PRs and cleanup use the saved branch; other repos keep `ticket/<feature>-<id>`. Existing saved branches and published PR URLs are preserved.

In monorepo, target `master` by default. Split PRs should each contain only their own scope; do not introduce a stack without asking. See [AGENTS.md](AGENTS.md).

Keep PRs short: a few plain change bullets under `## Description`, then `## Testing` starting with `unit tests + staging tests` and one suggested staging check. Mention only real merge prerequisites. Leave test implementation, unfinished work and long verification records out of the body. In monorepo modality, new ticket PR titles use `<UPPERCASE-TICKET-ID>: <ticket-title>` (the saved Jira key when available), and the Jira browse URL goes immediately below `## Description`, before the change bullets. `dt.mjs pr` adds a missing link without rewriting the supplied description; extra PRs use the same format. Existing published PRs are preserved. See [AGENTS.md](AGENTS.md) for the format; `dt.mjs pr` takes a short `--body-file`.

## Day to day
- `/dt-help` displays the workflow guide directly, without a model call, repository lookup or state changes.
- `/dt-resume ` autocompletes feature slugs. After selection, `/dt-lane ` and `/dt-show ` suggest that project's ticket IDs; `/dt-review ` suggests its ticket IDs and `autofix` after a target; `/dt-approve ` suggests ticket IDs for internal closure; `/dt-spec ` suggests task types. Suggestions use local files only, with a two-second feature-list cache; no GitHub refresh or state writes.
- New session: open pi in the repository (or a lane) and run `/dt-resume`. Pick a feature; it posts a short brief (phase, gates, board, in-flight tickets with PRs, verification, todo, next step) and lists next commands without a follow-up picker.
- Monorepo: open pi in clone 1 or clone 2 and run `/dt-lane`, then choose a ready ticket. Locked rows identify work in another session/checkout. Feature docs live in `~/.pi/agent/dt/features/<org>/<repo>/<slug>/`, shared by both clones; a small local git repo commits every saved state.
- Standalone: run `/dt-lane` from the main checkout and choose a ready ticket. After selection, it creates `../<repo>.lane-<id>` and tells you to open pi there; run `/dt-lane <id>` there to resume. Feature docs, `progress.json` included, live in the main checkout's `docs/features/<slug>/`: commit `progress.json` when convenient (it is state, not code).
- `/dt-status` displays a saved-state board directly: completed tickets and verification, tickets/slices left, in-flight work, blockers, gates and next steps. It does not call the model, start work, refresh remote facts or write project state. It requires a selected project; it never guesses from a branch or the only feature. Use `/dt-resume` to select or switch projects.
- `dt.mjs status <slug>` any time for the full board and DAG; `dt.mjs progress <slug> [--ticket ID]` for the raw saved state.

## Where to iterate first
- Tune the module-map table in `/dt-spec` to the monorepo's real conventions, and set `checks` to the exact affected-targets command.
- If a gate card keeps missing what you need, change the card list in that prompt; the shape is the same in all of them.
- If you want blocking gates or a TUI board, grow `extensions/dt-resume.ts`; keep the state logic in `dt.mjs`.
