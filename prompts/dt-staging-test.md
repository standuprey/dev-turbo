---
description: Generate a reviewed staging test script for a ticket PR, run it after confirmation and record the result
argument-hint: "[ticket id]"
---
Run a staging test for feature "$1", ticket "$2".

The loop is: 1. generate the script and runbook, 2. wait for user review and confirmation, 3. run the confirmed script, 4. on success update the PR's Testing section; on failure fix and return to step 1.

## Authority
This command authorizes read-only discovery, writing the test files, running the exact script version the user confirms, and replacing the ticket PR's `## Testing` section after a pass. Creating or deleting an isolated preview or sandbox environment needs explicit consent in step 2.

It never authorizes production access, schema changes or other DDL, deployments to shared staging, configuration or permission changes, merging, marking a PR ready or deleting existing data. Ask the user for those; when a deployment is needed, the user performs it.

## Setup
1. Resolve the ticket: "$2" when given; ticket `00` for T0/T1; otherwise the ticket whose saved branch is checked out here. If still ambiguous, ask.
2. Run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket <id> --owner <session-owner>` before writing files or touching code. If refused or directed to another checkout, STOP.
3. Read the spec (T2), the ticket, its saved progress, the PR body and the PR diff (`git diff origin/<main>...<branch>`). The ticket needs a saved PR. If every saved PR is merged, ask before testing or editing its description.
4. Read the repository's deployment, environment and testing documentation.

## 1. Generate
Design the test from the ticket's Outcome and Done when, at the boundary the user asks for. If the user narrows the boundary, follow that and say what it does not cover.

### Find the target (read-only)
- Find how this repository deploys to staging: the services or apps changed, their endpoints, and how to read the deployed version. Ask the user when it is not documented.
- Prefer an isolated preview or sandbox environment when the project offers one and it runs the changed code faithfully. It may still share staging data. Otherwise use the shared staging deployment, only after confirming it runs a version that contains the PR head (for example `git merge-base --is-ancestor <PR head> <deployed SHA>`). If it does not, ask the user to deploy and wait.
- Never change shared configuration or deploy shared environments yourself.

### Read staging data (read-only)
Use staging data to write realistic fixtures and assertions, through access the user provides. Use read-only transactions or read-only credentials with timeouts. Read schema, counts, shapes and small non-sensitive samples only. Never print or store credentials, tokens, PII or full sensitive documents. Treat what you read as a point-in-time observation.

### Write the files
Write `<features dir>/$1/staging-tests/<id>/staging-test.sh` and `staging-test.md`. Keep runs in `<features dir>/$1/staging-tests/<id>/runs/<UTC>-<random>/`.

The script:
- Uses `set -euo pipefail` and `umask 077`; `--help` contacts nothing.
- Runs read-only preflight by default: environment identity, deployed version and data prerequisites. Mutations require `--execute`.
- Takes the target explicitly and refuses one that does not match the expected version.
- Owns any tunnels or port-forwards it opens, checks ports are free, and cleans up on exit.
- Uses normal authentication only. An optional header or credential file must be owner-only and is never printed. Before writing, it makes one read-only call and accepts only the expected answer; authentication or transport errors abort.
- Creates uniquely named synthetic entities for each run. It never modifies or deletes existing data, keeps payloads and concurrency bounded, and leaves its test data in place.
- Checks both the response and the persisted state for each step, including "nothing was written" after refusals. It stops at the first failure.
- Writes numbered request/response files, `PASS` or `FAIL`, and no secrets to the run folder. Performance sampling is optional, behind a flag.

The runbook is a short step-by-step bullet list: prerequisites, the target and why, commands in code blocks, what each part checks, the data it leaves behind and its limits.

Before review, run `bash -n`, `shellcheck` when available, compile any embedded code, and test the guards offline with mocked commands, proving that failed prerequisites stop before any write. Never run the script against staging during generation.

## 2. Review and confirmation
Show the user: the two file paths, the target and why (with version proof), what will be written in staging (entities, approximate size), any preview or sandbox actions, the script's SHA-256, and the exact command in a code block. Ask them to review and confirm. STOP until they explicitly confirm that version. Treat edits, questions or an unclear reply as not confirmed; requested changes go back to step 1.

Save progress while waiting: `--next "/dt-staging-test <id>: waiting for script review"`. Keep the claim.

## 3. Run
Recheck the SHA-256; if the file changed, return to step 2. Create the preview or sandbox only if confirmed. Run the confirmed command with a generous timeout and save its output in the run folder. If the user runs it, read their output and the run folder. Collect bounded, scrubbed service logs for the test window when available.

## 4. Record
### Success
1. Re-read the PR body. Replace only the content of `## Testing`: keep `unit tests + staging tests` as the first line, then 3 to 6 short bullets saying which behaviors were checked in staging and passed. No commands, counts, IDs, paths, SHAs or evidence folders. Keep `## Description` and any bullets the user wrote; ask before removing them.
2. Write the body with `gh pr edit <n> --body-file <file>`, or `gh api --method PATCH repos/<owner>/<repo>/pulls/<n>` if that fails. Check the body did not change since you read it, then read it back and confirm the title, state, draft flag, head and base did not change.
3. Save `--verification "staging test passed at <short PR head> on <target>; run <run folder>"`, remove the staging item from `--todo` (keep the rest), set `--next`, and add `--release-claim`.
4. Ask whether to delete or keep any preview or sandbox. Reply in at most 5 bullets.

### Failure
Leave the PR description unchanged. Use the run folder to classify the failure:
- **Test defect** (wrong script or expectation): fix the script, then return to steps 1 and 2. Do not weaken assertions to make it pass.
- **Environment or prerequisite** (missing schema, wrong deployment, access): report it, save a `--blocker`, and STOP. Do not run DDL or deployments yourself.
- **Product defect**: show the evidence and propose a fix. After the user agrees, fix it on the ticket branch with an essential regression test (red, then green) and the affected checks, and push. Then redeploy the preview (with consent) or ask the user to deploy, and return to steps 1 and 2.

Each new run uses fresh entities; keep the data from failed runs. Save progress after every attempt.
