/** Reject incomplete subprocess results before parsing their JSON. */
export function parseExecJson(result, label) {
  const detail = result.stderr?.trim();
  const fail = (reason) => { throw new Error(`${label}: ${reason}${detail ? `\n${detail}` : ""}`); };
  if (result.truncated) fail("command output was truncated; no action was started.");
  // Pi can report code 0 for a signal exit, so code alone is not a success check.
  if (result.killed) fail("command was interrupted or timed out; retry the command. No action was started.");
  if (result.code !== 0) fail(`command failed (exit ${result.code}); no action was started.`);
  if (!result.stdout?.trim()) fail("command returned no JSON; run /reload and retry. No action was started.");
  try { return JSON.parse(result.stdout); }
  catch { fail("command returned invalid or incomplete JSON; run /reload and retry. No action was started."); }
}
