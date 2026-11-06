import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");

test("README's help section makes the picker the default and explains every label", () => {
  const flow = readme.split("## Flow\n")[1].split(/^## /m)[0];
  assert.match(flow, /\| `\/dt-lane` \| Open the ticket picker/);
  assert.match(flow, /### Ticket picker and lane ownership/);
  for (const label of ["READY", "RESUME", "LOCKED", "BLOCKED", "REVIEW", "MERGED"]) {
    assert.ok(flow.includes(`| **${label}** |`), `missing ${label}`);
  }
  assert.match(flow, /Canceling changes nothing/);
  assert.match(flow, /claimed it while the picker was open/);
  assert.match(flow, /force.*saved checkout/);
  assert.match(flow, /--release-claim/);
});

test("Pi runtime: dt-help displays picker/lock rules from README without workflow actions", { skip: !process.env.PI_PACKAGE_DIR }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dt-help-test-"));
  const previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(join(dir, "README.md"), readme);
  const pkg = process.env.PI_PACKAGE_DIR;
  const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
  const jiti = createJiti(join(pkg, "package.json"), { alias: {
    "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"),
    "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"),
  } });
  const { default: help, workflowGuide } = await jiti.import(join(import.meta.dirname, "extensions/dt-help.ts"));
  const messages = [], notices = [];
  let command;
  help({
    registerMessageRenderer() {},
    registerCommand(name, value) { assert.equal(name, "dt-help"); command = value; },
    sendMessage(message) { messages.push(message); },
    exec() { throw new Error("help must not execute commands"); },
    sendUserMessage() { throw new Error("help must not start the model"); },
  });
  const ctx = { ui: { notify(message) { notices.push(message); } } };
  await command.handler("", ctx);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, workflowGuide(readme));
  assert.match(messages[0].content, /Ticket picker and lane ownership/);
  assert.match(messages[0].content, /\*\*LOCKED\*\*/);
  assert.ok(!messages[0].content.includes("## The script"));
  await command.handler("unexpected", ctx);
  assert.equal(messages.length, 1);
  assert.equal(notices.at(-1), "Usage: /dt-help");
});
