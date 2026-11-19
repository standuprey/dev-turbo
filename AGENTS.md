# dev-turbo PR conventions

Keep this file aligned between `~/code/dev-turbo/AGENTS.md` and `~/.pi/agent/dt/AGENTS.md`.

## Branches and PRs
- T1/T2 tickets branch `ticket/<feature>-<id>` in their own worktree; T0 tasks stay on the current branch and commit nothing.
- Keep saved branches and published PR URLs; do not close or recreate a PR just to rename its head without asking.
- Target the main branch. Split work keeps only its own commits in each PR; ask before using another base or a stack.

## Ticket size
Any ticket line limit counts net growth: `added lines - removed lines`, summed across all files in the full ticket diff against the merge base with its PR base branch. Never use `added lines + removed lines`, an absolute value or per-commit churn; replacements cancel and negative counts stay negative. For example, 900 added lines and 800 removed lines count as 100, not 1700. Scope boundaries and required checks still apply.

## Testing scope
Aim for a small essential regression suite, not 100% test coverage or a coverage percentage target. Add tests only for changed behavior, fixed bugs or concrete high-risk failures (data loss, permissions, backward compatibility), at the most useful boundary, without duplicating assertions across layers. Run affected checks; broader suites only for shared changes or concrete regression risks. Preserve existing assertions, safety-critical cases and required repository checks.

## Supporting tests and fixtures
Necessary tests, shared fixtures and test-only build wiring may be updated outside `touches` without `/dt-revise`; record those paths and run their checks. Never weaken assertions, relax validation or change public contracts to make tests pass.

## Standalone wording
Code, comments, test names, commit messages and PR titles/bodies must stand on their own, and so does shipped documentation. Never reference the dev-turbo plan, spec, tickets, slices or gates. Describe current behavior and technical reasons. Workflow references belong only in dev-turbo planning artifacts, saved progress and command/gate handovers; issue links and concrete PR sequencing are fine. Write `/** Reads stored v1 brand configurations. */`, not a comment promising v2 decoding later.

## Writing descriptions
Applies to issue and PR descriptions and replies to the user. Write for someone who knows the product, not the code.
- One short line per change, starting with what the user sees or can do: "Add brand workspace nav (left sidebar) + empty state for each screen".
- Say what stays the same in a few words when it matters: "Keep device list and management the same as v1".
- Use everyday product words. Leave out routes, file paths, type and function names, and workflow terms (session, codec, port, slice, gate) unless the reader needs them.
- Leave out acceptance checks, edge cases, test plans, verification and pending work. Those belong in the ticket's Done when and `progress.json`.
- If a line lists several things or needs "and" twice, split it or cut it.

```markdown
- Add brand workspace nav (left sidebar) + empty state for each screen
- Keep device list and management the same as v1
```

## PR description format
These rules take precedence over general response formatting rules.
- Use only `## Description` and `## Testing`.
- Description: one short line per change, following "Writing descriptions". No test implementation, pending work, unverified checks or exclusions; those stay in `progress.json`.
- Add `**Sequencing:** Merge after #123.` only when specific PRs must merge first.
- Testing starts with exactly `unit tests + staging tests`, then one short suggested staging test: what to do and what to check. After a passed `/dt-staging-test`, replace the suggestion with 3 to 6 short bullets naming the passed checks. A curl or browser check that actually ran may get one simple bullet. No commands, counts, IDs, evidence paths or release-safety sections.
- `dt.mjs pr` sets the title (`<feature> <ID>: <ticket-title>`), adds `Closes #<issue>` and needs a short `--body-file`. Preserve user-edited descriptions.

```markdown
## Description
- Add brand workspace nav (left sidebar) + empty state for each screen
- Keep device list and management the same as v1

## Testing
unit tests + staging tests
- Suggested staging test: Open a brand, switch sidebar sections, then add and remove a device.
```
