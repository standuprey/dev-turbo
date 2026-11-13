import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = process.env.PI_PACKAGE_DIR;
for (const [key, branch, claimOnly] of [["org/repo", "", false], ["csscompany-enterprise/monorepo", "", true], ["csscompany-enterprise/monorepo", "ov_745_schema", false]]) {
  test(`Pi preflight chooses the actual startup stage: ${key}, branch ${branch || "not created"}`, { skip: !pkg }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "dt-preflight-runtime-"));
    const previous = process.env.DT_DIR; process.env.DT_DIR = dir;
    t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
    const repo = { key, featuresBase: join(dir, "features"), root: "/repo", branch: "main", lanes: ["/repo"], modality: "monorepo" };
    const project = { slug: "demo", key, base: repo.featuresBase, tier: "T2", type: "service" };
    const feature = join(repo.featuresBase, "demo");
    await mkdir(join(feature, "tickets"), { recursive: true });
    await writeFile(join(feature, "feature.json"), JSON.stringify({ ...project, epic: "OV-681" }));
    const progress = JSON.stringify({ gates: { G2: { state: "approved" } }, tickets: branch ? { "00": { status: "in_progress", branch } } : {} });
    await writeFile(join(feature, "progress.json"), progress);
    await writeFile(join(feature, "tickets/00.md"), '---\nid: "00"\ntitle: Skeleton\nblocked_by: []\ntouches: []\nunsafe_with: []\n---\n## Outcome\nRead brands.\n');
    await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady, requireEpic, requiresJira } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
    const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
    const jiti = createJiti(join(pkg, "package.json"), { alias: {
      "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"),
      "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"),
      "@earendil-works/pi-ai": join(pkg, "dist/core/extensions/pi-ai-extension-view.js"),
    } });
    const session = await jiti.import(join(import.meta.dirname, "../extensions/dt-session/index.ts"), { default: true });
    const handlers = new Map(), calls = [], notices = [], statuses = [];
    let activeStatus;
    let checkedResult = { code: 0, stdout: JSON.stringify({ warnings: [] }) };
    let confirmations = 0;
    await session({ on: (name, fn) => handlers.set(name, fn), events: { on() {} }, registerMessageRenderer() {}, registerTool() {},
      sendMessage() {}, exec: async (_cmd, args) => {
        calls.push(args);
        if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
        assert.equal(args[1], "next"); assert.ok(args.includes("--check-only"));
        if (ctx.hasUI) {
          assert.match(activeStatus, /Checking ticket 00/);
          assert.match(notices.at(-1), /Checking ticket 00/);
          await Promise.resolve();
          assert.match(activeStatus, /Checking ticket 00/, "feedback stays visible while awaiting the check");
        }
        assert.equal(args.includes("--claim-only"), claimOnly, "not-yet-created Jira metadata is not itself a start warning");
        return checkedResult;
      },
    });
    const ctx = { mode: "print", hasUI: true, cwd: "/repo", sessionManager: { getBranch: () => [{ type: "custom", customType: "dt-project", data: project }], getSessionId: () => "here" }, ui: { setStatus(key, value) { if (key === "dt-lane-check") { statuses.push(value); activeStatus = value; } }, setFooter() {}, notify: (m) => notices.push(m), confirm: async () => { assert.equal(activeStatus, undefined, "clear feedback before confirmation"); confirmations++; return true; } } };
    await handlers.get("session_start")({}, ctx);
    const result = await handlers.get("input")({ text: "/dt-lane 00", source: "interactive" }, ctx);
    assert.equal(result.text, "/dt-lane demo 00", notices.join("\n"));
    assert.equal(calls.filter((args) => args[1] === "next").length, 1);
    for (const [response, warning] of [
      [{ code: 0, killed: true, stdout: "" }, /interrupted or timed out/],
      [{ code: 0, stdout: "" }, /returned no JSON/],
      [{ code: 0, stdout: '{"warnings":' }, /invalid or incomplete JSON/],
      [{ code: 0, truncated: true, stdout: '{"warnings":[]}' }, /truncated/],
      [{ code: 0, stdout: 'null' }, /Invalid ticket start warnings/],
    ]) {
      checkedResult = response;
      const before = confirmations;
      assert.deepEqual(await handlers.get("input")({ text: "/dt-lane 00", source: "interactive" }, ctx), { action: "handled" });
      assert.match(notices.at(-1), warning);
      assert.equal(confirmations, before, "failed preflight must not reach start confirmation");
      assert.equal(activeStatus, undefined, "clear feedback even after failed checks");
    }
    ctx.hasUI = false;
    checkedResult = { code: 0, stdout: JSON.stringify({ warnings: [] }) };
    const statusCount = statuses.length;
    await handlers.get("input")({ text: "/dt-lane 00", source: "interactive" }, ctx);
    assert.equal(statuses.length, statusCount, "non-UI sessions do not set progress feedback");
    assert.equal(await readFile(join(feature, "progress.json"), "utf8"), progress);
  });
}
