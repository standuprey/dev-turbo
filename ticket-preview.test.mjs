import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTicketPreview, summarizeTicket, displayTicket, confirmTicket, ticketStatus } from "./extensions/dt-session/ticket-preview.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dt-ticket-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "01-scoped-styles.md");
  const content = '---\nid: "01"\ntitle: Scoped styles\n---\n## Outcome\nKeep portal styles inside their module.\n\n## Scenarios\nScenario: Portal keyboard\n';
  await writeFile(file, content);
  const snapshot = { tickets: [{ id: "01", title: "Scoped styles", file }] };
  return { file, content, snapshot };
}

test("ticket preview uses parsed IDs and retains the whole ticket including frontmatter", async (t) => {
  const { snapshot, file, content } = await fixture(t);
  assert.deepEqual(await readTicketPreview(snapshot, "1"), { id: "01", title: "Scoped styles", file, content });
  await assert.rejects(readTicketPreview(snapshot, "02"), /No ticket 02/);
  await assert.rejects(readTicketPreview(snapshot, "../01"), /numeric/);
});

test("lane shows only a summary before confirmation; decline, cancel and non-UI do not continue", async (t) => {
  const { snapshot, content } = await fixture(t);
  const events = [];
  let answer = true;
  const args = { snapshot, id: "1", project: { slug: "demo" }, pi: { sendMessage(message) { events.push(message); } }, ctx: {
    hasUI: true, ui: { notify(message) { events.push(message); }, async confirm(title, body) {
      const summary = events.at(-1).content;
      assert.match(summary, /01 · Scoped styles/);
      assert.match(summary, /Keep portal styles inside their module/);
      assert.match(summary, /\/dt-show 01/);
      assert.ok(!summary.includes(content));
      assert.doesNotMatch(summary, /Scenario:|frontmatter|title:/);
      assert.match(title, /01.*demo/);
      assert.ok(body.includes(summary), "summary display precedes confirmation");
      assert.doesNotMatch(body, /Scenario:|title:/);
      if (args.force) assert.match(body, /force takeover/);
      return answer;
    } },
  } };
  assert.equal(await confirmTicket(args), true);
  answer = false;
  assert.equal(await confirmTicket(args), false);
  answer = undefined;
  assert.equal(await confirmTicket(args), false);
  args.force = true;
  answer = true;
  assert.equal(await confirmTicket(args), true);
  args.ctx.hasUI = false;
  args.ctx.ui.confirm = () => { throw new Error("must not ask for unavailable UI"); };
  assert.equal(await confirmTicket(args), false);
  assert.match(events.at(-1), /No claim or work has started/);
});

test("dt-show still displays the complete ticket", async (t) => {
  const { snapshot, content } = await fixture(t);
  const messages = [];
  displayTicket({ sendMessage(message) { messages.push(message); } }, { slug: "demo" }, await readTicketPreview(snapshot, "01"));
  assert.equal(messages[0].content, content);
});

test("ticket status uses saved progress and full display retains the complete content", async (t) => {
  const { snapshot, content } = await fixture(t);
  const messages = [];
  for (const [status, label] of [["todo", "TODO"], ["in_progress", "IN PROGRESS"], ["review", "REVIEW"], ["done", "DONE"]]) {
    snapshot.st = { "01": { status } };
    assert.equal(ticketStatus(snapshot, "01"), label);
    displayTicket({ sendMessage(message) { messages.push(message); } }, { slug: "demo" }, await readTicketPreview(snapshot, "01"), ticketStatus(snapshot, "01"));
    assert.equal(messages.at(-1).content, `Status: ${label}\n\n${content}`);
  }
});

test("summary handles bold outcome headings, missing outcomes and long text", () => {
  const ticket = { id: "02", title: "Add export", content: "---\nid: 02\n---\n**Outcome**\nExport a report.\n\n**Changes**\nSecret implementation details." };
  assert.match(summarizeTicket(ticket), /Export a report/);
  assert.doesNotMatch(summarizeTicket(ticket), /Secret implementation/);
  assert.match(summarizeTicket({ ...ticket, content: "---\nid: 02\n---\n" }), /02 · Add export/);
  const long = summarizeTicket({ ...ticket, content: `## Outcome\n${"Long outcome. ".repeat(1000)}\n## Scenarios\nHidden scenario` });
  assert.ok(long.length < 600);
  assert.doesNotMatch(long, /Hidden scenario/);
});

test("a ticket edited while its confirmation is open must be reviewed again", async (t) => {
  const { snapshot, file } = await fixture(t);
  await assert.rejects(confirmTicket({ snapshot, id: "01", project: { slug: "demo" }, pi: { sendMessage() {} }, ctx: {
    hasUI: true, ui: { async confirm() { await writeFile(file, "new scope"); return true; } },
  } }), /changed during confirmation/);
});
