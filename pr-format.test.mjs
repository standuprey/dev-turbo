import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ticketPrContent } from "./dt.mjs";

const ctx = { modality: "monorepo", key: "csscompany-enterprise/monorepo" };
const ticket = { id: "01", title: "Keep v1 validation on the shared reader" };
const body = "## Description\n- Route v1 validation through BrandConfigReader.\n\n## Testing\nunit tests + staging tests\n- Suggested staging test: Replay a known v1 receipt.\n";
const url = "https://csscompany.atlassian.net/browse/OV-731";

test("monorepo PRs use uppercase Jira titles and link before change bullets", () => {
  const result = ticketPrContent(ctx, "reader", ticket, { jira: { key: "ov-731" } }, body);
  assert.equal(result.title, "OV-731: Keep v1 validation on the shared reader");
  assert.equal(result.body, body.replace("## Description\n", `## Description\n${url}\n\n`));
});

test("monorepo PRs reuse saved issue URLs without assuming a Jira host", () => {
  const customUrl = "https://example.atlassian.net/browse/ABC-42";
  const result = ticketPrContent({ ...ctx, key: "other/repo" }, "reader", ticket, { issues: [{ ref: "abc-42", url: customUrl }] }, body);
  assert.match(result.title, /^ABC-42: /);
  assert.ok(result.body.includes(`## Description\n${customUrl}\n\n- Route`));
});

test("a user-edited description containing the Jira URL remains unchanged", () => {
  const edited = body.replace("## Description\n", `## Description\n${url}\n\nUser's wording.\n`);
  const result = ticketPrContent(ctx, "reader", ticket, { jira: { key: "OV-731" } }, edited);
  assert.equal(result.body, edited);
});

test("standalone PR formatting remains unchanged even with Jira metadata", () => {
  assert.deepEqual(ticketPrContent({ ...ctx, modality: "standalone" }, "reader", ticket, { jira: { key: "OV-731" } }, body), {
    title: "reader 01: Keep v1 validation on the shared reader", body,
  });
});

test("monorepo tickets without Jira use their local ID without a feature prefix", () => {
  assert.deepEqual(ticketPrContent({ ...ctx, key: "other/repo" }, "reader", ticket, {}, body), {
    title: "01: Keep v1 validation on the shared reader", body,
  });
});

test("unknown Jira hosts and missing Description headings block creation", () => {
  assert.throws(() => ticketPrContent({ ...ctx, key: "other/repo" }, "reader", ticket, { jira: { key: "ABC-42" } }, body), /save the Jira ticket URL/);
  assert.throws(() => ticketPrContent(ctx, "reader", ticket, { jira: { key: "OV-731" } }, "Changes"), /needs ## Description/);
});

test("lane instructions cover extra PRs and saving the verified Jira URL", () => {
  const prompt = readFileSync(new URL("./prompts/dt-lane.md", import.meta.url), "utf8");
  assert.match(prompt, /--issue <KEY>=<URL>/);
  assert.match(prompt, /<UPPERCASE-TICKET-ID>: <ticket-title>/);
  assert.match(prompt, /extra PRs created outside `dt\.mjs pr` too/);
  assert.match(prompt, /Do not edit or recreate existing published PRs/);
});
