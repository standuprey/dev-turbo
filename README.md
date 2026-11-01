# dev-turbo for pi (v0.2)

Prompt templates + one zero-dependency script. Files are the memory; you hold the gates.

## Principles
1. Every task starts with a grill; the tier (T0 / T1 / T2) is decided at its end from facts and a fixed rule table, and you confirm it (Gate 0).
2. You own the architecture: a gate on modules and contracts before any parallel work, and a drift review every 2-3 merges.
3. Deep modules, one responsibility, one-way dependencies; contracts written as code; one Mermaid notation for every module diagram.
4. Vertical, testable slices; BDD outer loop (Gherkin per ticket), TDD inner loop.
5. Fresh context for review; two lanes, never more than 2 tickets in flight; status derived from git, never hand-edited.

## Flow
See [workflow.md](workflow.md) for the map, the gates and the two modalities.

| Tier | When | Flow |
|---|---|---|
| T0 | tiny, local, nothing left to decide | `/dt-quick` → PR → you merge |
| T1 | ≤ 2 modules, no contract change, reversible | `/dt-quick` (light gate: scenarios + owner) → PR → `/dt-review` if a boundary was touched or diff > ~150 lines → you merge |
| T2 | new module or contract, 3+ slices, irreversible, or scale shapes the design | `/dt-spec` → G1 → `/dt-slice` → G2 → ticket 00 → `/dt-lane` ×2 → `/dt-review` → G3 → `/dt-drift` → G4 |

Commands: `/dt-grill` · `/dt-spec` · `/dt-slice` · `/dt-lane` · `/dt-quick` · `/dt-review` · `/dt-drift`. Overlays (`web`, `device`, `service`) change how slices are verified, not the flow.

## Examples

Every example starts with `/dt-grill`; the tier below is illustrative, and you confirm it at Gate 0 based on the actual scope.

- **Fix a typo in an existing button label (T0)** — local change, no design decisions or contract changes.
  - Path: `/dt-grill` → G0: confirm T0 + `web` → `/dt-quick web as aligned` → verify → PR → you merge.
- **Fix pagination in an existing service (T1)** — reversible change within the owning module, preserving the API contract and with scale not shaping the design.
  - Path: `/dt-grill` → G0: confirm T1 + `service` → `/dt-quick service as aligned` → approve scenario titles + owner → TDD + verify → PR → `/dt-review quick` if a boundary was touched or the diff exceeds ~150 lines → you merge.
- **Add a background export service (T2)** — a new module and job contract, with queue size and retry behavior shaping the design.
  - Path: `/dt-grill` → G0: confirm T2 + `service` → `/dt-spec <slug> service` → G1: approve architecture → `/dt-slice <slug>` → G2: approve slices → ticket 00: walking skeleton → G2b: review + merge skeleton → `/dt-lane <slug> next` in up to two lanes → `/dt-review <slug> <id>` → G3: approve each merge → `/dt-drift <slug>` every 2–3 merges and at the end → G4: resolve findings.

## The script
`dt.mjs` (Node 18+, no dependencies) is what the prompts call; everything it does, you can run yourself:

```
dt.mjs -h                                list commands and global help
dt.mjs <command> -h                      show usage and options for any command
dt.mjs info                               repo, modality, main branch, lanes, features dir, checks
dt.mjs config set checks "<cmd>"          remember the affected-targets command for this repo
dt.mjs status <slug>                      kanban + DAG + unsafe pairs; rewrites overview.md
dt.mjs next <slug> [--ticket ID]          pick a ready ticket: branch in a clone, or a new worktree
dt.mjs gate <slug> <0-4> approve|change   record a gate (+ issues, worktree cleanup, drift nudge)
dt.mjs pr <slug> <ID> | pr quick          open the PR (draft in monorepo, ready in standalone)
dt.mjs comment --body-file F              post review findings on the PR
dt.mjs selftest                           test the pure logic
```
`-h` and `--help` work at every command level, including `config set`, `config set checks`, and `pr quick`, without requiring a Git repository or running workflow actions. Running `dt.mjs` without arguments shows the top-level help. Run `node --test dt.test.mjs` for CLI help tests.

`--dry-run` prints the git/gh commands instead of running them. Rules it enforces: max 2 tickets in flight, `blocked_by` done, no shared `touches`, no `unsafe_with` pair, monorepo lanes only in the configured clones, standalone lanes only from the main checkout.

## Install
```
./install.sh                 prompts → ~/.pi/agent/prompts, dt.mjs + overlays → ~/.pi/agent/dt, config.json if missing, selftest
./uninstall.sh               removes prompts, dt.mjs, overlays; keeps config.json and features/
./uninstall.sh --purge       also removes config.json and features/ (asks first)
```
Then `/reload` in pi. Edit `~/.pi/agent/dt/config.json`: lanes are the two monorepo clone paths; `checks` is asked once per repo by the grill if left empty. Needs `gh` logged in for issues and PRs.

## Day to day
- Monorepo: open pi in clone 1 or clone 2 and run `/dt-lane <slug> next`. Feature docs live in `~/.pi/agent/dt/features/<org>/<repo>/<slug>/`, shared by both clones (a small git repo keeps the history of gate decisions).
- Standalone: run `/dt-lane <slug> next` from the main checkout; it creates `../<repo>.lane-<id>` and tells you to open pi there. `gates.md` and `overview.md` are written in the main checkout: commit them when convenient (they are records, not code).
- `dt.mjs status <slug>` any time for the board; open `overview.md` in anything that renders Mermaid (GitHub, VS Code, Obsidian) for the diagrams.

## Where to iterate first
- Tune the module-map table in `/dt-spec` to the monorepo's real conventions, and set `checks` to the exact affected-targets command.
- If a gate card keeps missing what you need, change the card list in that prompt; the shape is the same in all of them.
- If you want blocking gates or a TUI board, that is the moment to turn `dt.mjs` into a pi extension; the logic is already separated from the CLI.
