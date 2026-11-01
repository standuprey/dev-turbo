import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./dt.mjs", import.meta.url));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dt-cli-test-"));
process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));
const run = (args) => spawnSync(process.execPath, [script, ...args], {
  cwd: sandbox,
  encoding: "utf8",
  // Missing Git/gh and invalid config prove help doesn't invoke workflow operations.
  env: { ...process.env, PATH: "", DT_DIR: sandbox },
});
fs.writeFileSync(path.join(sandbox, "config.json"), "invalid JSON");

const topics = [
  [], ["info"], ["config"], ["config", "set"], ["config", "set", "checks"],
  ["status"], ["next"], ["gate"], ["pr"], ["pr", "quick"], ["comment"], ["selftest"],
];
for (const topic of topics) {
  for (const flag of ["-h", "--help"]) {
    test(`${topic.join(" ") || "top-level"} ${flag}`, () => {
      const result = run([...topic, flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.startsWith(`Usage: dt.mjs${topic.length ? ` ${topic.join(" ")}` : " <command>"}`));
      assert.match(result.stdout, /-h, --help/);
      if (!topic.length) for (const command of topics.filter((t) => t.length === 1)) assert.ok(result.stdout.includes(command[0]));
    });
  }
}

test("no arguments shows top-level help", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: dt.mjs <command>/);
});

test("help works before the command and after complete workflow arguments", () => {
  for (const args of [["-h", "info"], ["gate", "example", "0", "approve", "--tier", "T2", "--type", "service", "-h"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: dt.mjs (info|gate)/);
  }
  assert.deepEqual(fs.readdirSync(sandbox), ["config.json"]);
});

test("unknown commands fail before repository resolution", () => {
  for (const args of [["unknown"], ["unknown", "-h"], ["__proto__", "-h"]]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown command/);
    assert.equal(result.stdout, "");
  }
});

test("existing pure-logic selftest still works", () => {
  const result = run(["selftest"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all good/);
});
