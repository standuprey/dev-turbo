import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteFeature } from "../dt.mjs";

test("feature deletion removes only its folder and refuses claimed, unreadable or linked features", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dt-delete-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = { featuresBase: base };
  const create = async (slug, progress = {}) => {
    await mkdir(join(base, slug, "tickets"), { recursive: true });
    await writeFile(join(base, slug, "feature.json"), JSON.stringify({ slug }));
    await writeFile(join(base, slug, "progress.json"), JSON.stringify(progress));
    await writeFile(join(base, slug, "tickets", "00.md"), "Keep this ticket");
  };
  await create("demo");
  await create("other");
  deleteFeature(repo, "demo");
  await assert.rejects(access(join(base, "demo")), { code: "ENOENT" });
  assert.equal(await readFile(join(base, "other", "tickets", "00.md"), "utf8"), "Keep this ticket");
  await create("claimed", { tickets: { "00": { claim: { owner: "another-session" } } } });
  assert.throws(() => deleteFeature(repo, "claimed"), /claimed tickets/);
  await access(join(base, "claimed", "feature.json"));
  await create("broken");
  await writeFile(join(base, "broken", "progress.json"), "invalid JSON");
  assert.throws(() => deleteFeature(repo, "broken"), /cannot parse/);
  await access(join(base, "broken", "feature.json"));
  await symlink(join(base, "other"), join(base, "linked"));
  assert.throws(() => deleteFeature(repo, "linked"), /real directory/);
  assert.throws(() => deleteFeature(repo, "../other"), /invalid feature slug/);
  await access(join(base, "other", "feature.json"));
});
