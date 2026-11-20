import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencyStackCandidate, chooseDependencyStack, stackConsentMessage } from "../extensions/dt-session/dependency-stack.mjs";

function fixture() {
  return { project: { tier: "T2", slug: "demo" }, id: "19", snapshot: {
    tickets: [{ id: "19", blocked_by: ["16", "00"] }, { id: "16", title: "Rename formats", blocked_by: [] }],
    st: { "19": { status: "todo" }, "16": { status: "review" }, "00": { status: "done" } },
    prog: { tickets: { "16": { branch: "ov_123_rename_formats", prs: [{ number: 123, url: "https://github.com/org/repo/pull/123", branch: "ov_123_rename_formats", state: "draft" }] } } },
  } };
}

test("stacking is a separate explicit choice; waiting and cancellation stop without writes", async () => {
  const args = fixture(), before = JSON.stringify(args);
  let choice = 0;
  args.ctx = { hasUI: true, ui: { select: async (title, labels) => {
    assert.match(title, /Ticket 19 is blocked by 16.*in review/);
    assert.match(title, /pull\/123/);
    assert.match(title, /Start warnings still require separate confirmation/);
    assert.match(labels[0], /Stack PR on ticket 16 \(ov_123_rename_formats\)/);
    return labels[choice];
  } } };
  const decision = await chooseDependencyStack(args);
  assert.equal(decision.action, "stack");
  assert.match(stackConsentMessage("demo", decision.candidate).content, /User explicitly chose.*ticket 19 on ticket 16/);
  for (const [selected, action] of [[1, "stop"], [2, "continue"], [99, "stop"]]) {
    choice = selected;
    assert.equal((await chooseDependencyStack(args)).action, action);
  }
  delete args.ctx;
  assert.equal(JSON.stringify(args), before);
});

test("multiple unmet dependencies, completed work and already stacked PRs do not offer a new stack", () => {
  for (const change of [
    (a) => { a.project.tier = "T0"; },
    (a) => { a.snapshot.st["19"].status = "done"; },
    (a) => { a.snapshot.st["00"].status = "todo"; },
    (a) => { a.snapshot.st["16"].status = "in_progress"; },
    (a) => { a.snapshot.prog.tickets["16"].prs[0].state = "merged"; },
    (a) => { a.snapshot.prog.tickets["19"] = { prs: [{ state: "open", base: "ov_123_rename_formats" }] }; },
  ]) {
    const args = fixture(); change(args);
    assert.equal(dependencyStackCandidate(args.project, args.snapshot, args.id), null);
  }
});

test("non-interactive overrides never invent stack consent", async () => {
  const args = fixture(), notices = [];
  args.ctx = { hasUI: false, ui: { notify: (message) => notices.push(message), select: () => { throw new Error("no UI"); } } };
  assert.equal((await chooseDependencyStack(args)).action, "continue");
  assert.match(notices[0], /override alone does not approve a stack/);
});
