# Monorepo PR conventions

User preference for `csscompany-enterprise/monorepo`:

- For `csscompany-enterprise/monorepo` and `csscompany-enterprise/ottercam`, every feature must have a confirmed Jira epic saved as `feature.json.epic` during `/dt-start`, including T0/T1.
- In `/dt-lane`, claim first, then create/reuse a Jira ticket under that epic with a title and 3–5 short description bullets. Save its metadata in ticket progress before branching or implementing. In monorepo modality, newly created Jira tickets must also be assigned to the user, added to the current active sprint and transitioned to In Progress, with all three verified before branching. Resolve the user, board, sprint and transition through Jira; ask when ambiguous or no active sprint exists. Save the Jira key before these updates so failures can retry without duplicates. Do not change the assignee, sprint or status of established tickets on resume; standalone behavior is unchanged.
- New branches in those two repos use the Jira key followed by a title slug, all lowercase snake_case: `OV-777` + `Update schema` → `ov_777_update_schema`. No slash prefix, uppercase letters or hyphens.
- Target `master` by default. When work is split into multiple PRs, isolate each PR's own commits onto `master`; do not silently turn them into a stack to satisfy build dependencies or CI tooling.
- Ask before choosing a non-`master` base or introducing a stack. Record prerequisite/landing order separately from PR ancestry.
- Preserve published PR URLs. Do not close/recreate an existing PR solely to make its head name prettier without asking; apply this naming preference before creating new PRs.
- Repository pushes update at most two refs per request. Keep branch names lowercase; never bypass the branch-name hook.
- `dt.mjs` uses the branch saved in ticket progress for resume, lane display, PR creation and cleanup. Other repos retain `ticket/<feature>-<id>`. Preserve saved legacy branches and published PRs; apply snake_case to new branches.

Keep this guidance aligned between `~/code/dev-turbo/AGENTS.md` and `~/.pi/agent/dt/AGENTS.md`.

## Standalone implementation wording

Code, comments, test names, commit messages and PR titles/bodies must stand on their own. Never reference the dev-turbo plan, spec, tickets, slices or gates, or assume readers know the workflow. Describe current behavior and technical reasons, not which workflow step introduced something or will finish it. The same rule applies to documentation shipped with the change. Workflow references belong only in dev-turbo planning artifacts, saved progress and command/gate handovers; required issue links and concrete PR sequencing remain allowed.

For example, write `/** Reads stored v1 brand configurations. */`, not a comment promising v2 decoding in the next slice.

## PR description format

- Use only `## Description` and `## Testing`.
- In `monorepo` modality, new ticket PR titles use `<UPPERCASE-TICKET-ID>: <ticket-title>`, using the saved Jira key when available (e.g. `OV-731: Keep v1 validation on the shared reader`), without a feature slug or local ID prefix. Put the Jira browse URL immediately below `## Description`, then a blank line before the change bullets. Apply this to every new PR for the ticket; preserve existing published PRs and user-edited descriptions.
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
