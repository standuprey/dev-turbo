# Monorepo PR conventions

User preference for `csscompany-enterprise/monorepo`:

- Prefer lowercase PR head names `ov-<jira-number>-<short-kebab-case-slug>`, for example `ov-715-verify-v2-rest`. No slash prefix and no uppercase Jira key.
- Target `master` by default. When work is split into multiple PRs, isolate each PR's own commits onto `master`; do not silently turn them into a stack to satisfy build dependencies or CI tooling.
- Ask before choosing a non-`master` base or introducing a stack. Record prerequisite/landing order separately from PR ancestry.
- Preserve published PR URLs. Do not close/recreate an existing PR solely to make its head name prettier without asking; apply this naming preference before creating new PRs.
- Repository pushes update at most two refs per request. Keep branch names lowercase; never bypass the branch-name hook.
- `dt.mjs` currently recognizes canonical `ticket/<feature>-<id>` branches. This note records the preference, not a runtime branch-mapping implementation. If that fixed schema conflicts with a requested PR head, surface it before creation and adapt the mapping explicitly rather than inventing an undocumented exception.

Keep this guidance aligned between `~/code/dev-turbo/AGENTS.md` and `~/.pi/agent/dt/AGENTS.md`.

## PR description format

- Use only `## Description` and `## Testing`.
- Write a few short bullets about what this PR changes. No fixed bullet count and no filler.
- Use simple words and short sentences. Say the main point first; readers can get details from the code. Use the same plain style in workflow replies.
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
