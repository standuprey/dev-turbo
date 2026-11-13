import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ticketPrTitle } from "../dt.mjs";

const ticket = { id: "01", title: "Keep v1 validation on the shared reader" };

test("T2 PR titles name the feature and ticket; T0/T1 titles stand alone", () => {
  assert.equal(ticketPrTitle("reader", ticket), "reader 01: Keep v1 validation on the shared reader");
  assert.equal(ticketPrTitle("reader", ticket, "T2"), "reader 01: Keep v1 validation on the shared reader");
  for (const tier of ["T0", "T1"]) assert.equal(ticketPrTitle("reader", ticket, tier), "Keep v1 validation on the shared reader");
});

test("lane instructions keep published PRs and the user's descriptions", () => {
  const prompt = readFileSync(new URL("../prompts/dt-lane.md", import.meta.url), "utf8");
  assert.match(prompt, /Preserve any description the user has edited/);
  assert.match(prompt, /Do not edit or recreate existing published PRs/);
  assert.match(prompt, /ready for review \(`Closes #issue` when there is one\)/);
});
