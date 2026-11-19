---
description: Generate a reviewed staging test script for a ticket PR, run it after confirmation and record the result
argument-hint: "[ticket id]"
---
Run a staging test for feature "$1", ticket "$2". Loop: 1. generate, 2. user review and confirmation, 3. run, 4. record; a failure goes back to step 1.

## Authority
Allowed: read-only discovery, writing the test files, running the exact confirmed script and replacing the PR's `## Testing` section after a pass. Creating or deleting an isolated preview or sandbox needs consent in step 2. This command never authorizes production access, schema changes or other DDL, deployments to shared staging, configuration or permission changes, merging, marking a PR ready or deleting existing data; the user does those.

## Setup
1. Ticket: "$2"; else `00` when the feature has a single ticket; else the ticket whose saved branch is checked out; else ask.
2. Run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket <id> --owner <session-owner>` before writing files. If refused or directed to another checkout, STOP.
3. Read the spec (T2), ticket, saved progress, PR body and diff (`git diff origin/<main>...<branch>`). A saved PR is required; if all saved PRs are merged, ask first.
4. Read the repo's deployment, environment and testing docs.

## 1. Generate
Test the ticket's Outcome and Done when at the boundary the user asks for; if they narrow it, say what is not covered.

Target (read-only): find the changed services, their endpoints and how to read the deployed version; ask if undocumented. Prefer an isolated preview or sandbox environment when the project offers one that runs the changed code faithfully. Otherwise use shared staging only after proving it contains the PR head (e.g. `git merge-base --is-ancestor <PR head> <deployed SHA>`); if not, ask the user to deploy and wait.

Staging data (read-only, with access the user provides): read-only transactions or credentials with timeouts; schema, counts, shapes and small non-sensitive samples only. Never print or store credentials, tokens or PII.

Write `<features dir>/$1/staging-tests/<id>/staging-test.sh` and `staging-test.md`; runs go in `staging-tests/<id>/runs/<UTC>-<random>/`. The script:
- Uses `set -euo pipefail` and `umask 077`; `--help` contacts nothing.
- Runs read-only preflight by default (environment, deployed version, data prerequisites). Mutations require `--execute`.
- Takes the target explicitly and refuses a version mismatch.
- Owns and cleans up its tunnels and port-forwards; checks ports are free.
- Uses normal authentication; credential files are owner-only and never printed. One read-only call must succeed before any write; auth or transport errors abort.
- Creates uniquely named synthetic entities per run, never modifies or deletes existing data, bounds payloads and concurrency, and leaves its test data in place.
- Checks the response and the persisted state for each step, including "nothing written" after refusals; stops at the first failure.
- Writes numbered request/response files and `PASS` or `FAIL` to the run folder, never secrets.

The runbook: short bullets on prerequisites, target and why, commands, what each part checks, data left behind and limits.

Before review, run `bash -n`, `shellcheck` if available, and test the guards offline with mocked commands, proving failed prerequisites stop before any write. Never run the script against staging during generation.

## 2. Review and confirmation
Show both file paths, the target with version proof, what will be written (entities, size), any preview or sandbox actions, the script's SHA-256 and the exact command. STOP until they explicitly confirm that version; edits, questions or unclear replies are not confirmation. Save `--next "/dt-staging-test <id>: waiting for script review"` and keep the claim.

## 3. Run
Recheck the SHA-256; if the file changed, return to step 2. Create the preview or sandbox only if confirmed. Run with a generous timeout, saving output to the run folder (or read the user's output if they ran it). Collect bounded, scrubbed service logs when available.

## 4. Record
### Success
1. Re-read the PR body. Replace only the content of `## Testing`: `unit tests + staging tests`, then 3 to 6 short bullets naming the behaviors that passed in staging. No commands, counts, IDs, paths, SHAs or evidence folders. Keep `## Description` and the user's bullets.
2. Check the body did not change since you read it, then `gh pr edit <n> --body-file <file>` (fallback: `gh api --method PATCH repos/<owner>/<repo>/pulls/<n>`). Read it back and confirm title, state, draft flag, head and base are unchanged.
3. Save `--verification "staging test passed at <short PR head> on <target>; run <run folder>"`, drop the staging item from `--todo`, set `--next` and add `--release-claim`.
4. Ask whether to keep any preview or sandbox. Reply in at most 5 bullets.

### Failure
Leave the PR description unchanged. Classify from the run folder:
- **Test defect**: fix the script and return to steps 1-2. Do not weaken assertions to make it pass.
- **Environment or prerequisite** (schema, deployment, access): save a `--blocker` and STOP. No DDL or deployments.
- **Product defect**: show the evidence and propose a fix. Once the user agrees, fix it on the ticket branch with an essential regression test (red, then green), run affected checks, push, get it redeployed, then return to steps 1-2.

Each run uses fresh entities; keep failed-run data. Save progress after every attempt.
