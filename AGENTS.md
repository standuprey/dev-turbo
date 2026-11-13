# dev-turbo PR conventions

## Branches and PRs

- T2 tickets branch `ticket/<feature>-<id>` in their own worktree; T0/T1 tasks use `quick/<slug>` in the current checkout.
- `dt.mjs` uses the branch saved in ticket progress for resume, lane display, PR creation and cleanup. Preserve saved branches and published PR URLs; do not close/recreate an existing PR solely to rename its head without asking.
- Target the repository's main branch by default. When work is split into multiple PRs, isolate each PR's own commits onto it; ask before choosing another base or introducing a stack.

Keep this guidance aligned between `~/code/dev-turbo/AGENTS.md` and `~/.pi/agent/dt/AGENTS.md`.

## Supporting tests and fixtures

Necessary tests, shared fixtures and test-only build wiring may be read and updated outside `touches` when required to verify the ticket outcome or keep mirrored fixtures synchronized. Do not block or request `/dt-revise` solely because these supporting files are outside `touches`. Do not weaken assertions, relax validation or change public contracts to make tests pass. Actual concurrent ownership conflicts still require coordination; this exception does not bypass lane claims or authorize unrelated production changes. Record the supporting paths and run their affected checks.

## Standalone implementation wording

Code, comments, test names, commit messages and PR titles/bodies must stand on their own. Never reference the dev-turbo plan, spec, tickets, slices or gates, or assume readers know the workflow. Describe current behavior and technical reasons, not which workflow step introduced something or will finish it. The same rule applies to documentation shipped with the change. Workflow references belong only in dev-turbo planning artifacts, saved progress and command/gate handovers; required issue links and concrete PR sequencing remain allowed.

For example, write `/** Reads stored v1 brand configurations. */`, not a comment promising v2 decoding in the next slice.

## PR description format

- Use only `## Description` and `## Testing`.
- `dt.mjs pr` titles T2 ticket PRs `<feature> <ID>: <ticket-title>` and T0/T1 PRs with the ticket title alone; it adds `Closes #<issue>` for the ticket's GitHub issue.
- Write a few short bullets about what this PR changes. No fixed bullet count and no filler.
- Use plain, natural language and short sentences. Assume readers know the subject; skip jargon, unsolicited definitions and tutorials.
- Describe concrete changes and outcomes, not abstract labels. Use everyday words without losing technical accuracy. Say the main point first; readers can get details from the code.
- These PR formatting rules take precedence over general response limits and formatting rules. Keep workflow replies direct, with no preamble or recap.
- Do not describe test implementation in Description. Writing tests is part of the work.
- Never mention what is not done in the PR body: no pending work, unverified checks, exclusions or missing features. Keep those facts in `progress.json`, not the description.
- Add `**Sequencing:** Merge after #123.` only when specific PRs really must merge first. Otherwise omit sequencing. No generic rollout, deployment or gate instructions.
- Start Testing with exactly `unit tests + staging tests`. This states the testing plan, not a claim that both have run.
- Add one short staging test suggestion: what to do and what to check.
- If curl, browser or another specific check was actually run, mention it in one simple bullet. No command dumps, test counts, implementation details or long verification records.
- Do not add CLI warnings, release-safety sections or hidden release-safety JSON.
- `dt.mjs pr` requires a short `--body-file <file>`. Preserve user-edited descriptions unless asked to change them.

Example:

```markdown
## Description
- Show item counts in the Brands list.

## Testing
unit tests + staging tests
- Suggested staging test: Open Brands and check the count for a known brand.
```
