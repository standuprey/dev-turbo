import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { screenshotReferences, readTicketScreenshots, exportTicketScreenshots, createTicketRenderer } from "./extensions/dt-session/ticket-screenshots.mjs";
import { displayTicket } from "./extensions/dt-session/ticket-preview.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==", "base64");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dt-screenshots-"));
  const feature = join(dir, "feature");
  await mkdir(join(feature, "tickets"), { recursive: true });
  await mkdir(join(feature, "references/ui"), { recursive: true });
  const file = join(feature, "tickets/15-workspace.md");
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, feature, file };
}

test("screenshot references support inline images, titles, spaces and reference-style images, but not code examples", () => {
  const content = '![Workspace](../references/ui/workspace.png)\n![Narrow](<../references/ui/narrow screen.png> "Title")\n![Reuse][workspace]\n![Collapsed][]\n\n[workspace]: ../references/ui/workspace.png\n[Collapsed]: ../references/ui/collapsed.png\n\n`![inline code](secret.png)`\n```md\n![fenced code](secret.png)\n```\n[ordinary link](manifest.md)';
  assert.deepEqual(screenshotReferences(content), [
    { label: "Workspace", target: "../references/ui/workspace.png" },
    { label: "Narrow", target: "../references/ui/narrow screen.png" },
    { label: "Reuse", target: "../references/ui/workspace.png" },
    { label: "Collapsed", target: "../references/ui/collapsed.png" },
  ]);
  assert.deepEqual(screenshotReferences("## Outcome\nNo screenshots."), []);
});

test("screenshots resolve from the ticket, are read once in reference order, and stay outside model-facing content", async (t) => {
  const { feature, file } = await fixture(t);
  const first = join(feature, "references/ui/first.png"), second = join(feature, "references/ui/second screen.png");
  await writeFile(first, png); await writeFile(second, png);
  const content = '## UI reference\n![First](../references/ui/first.png)\n![Second](../references/ui/second%20screen.png)\n![Duplicate](../references/ui/./first.png)\n## Done when\nExisting check.';
  const ticket = { id: "15", file, content };
  const screenshots = await readTicketScreenshots(ticket, feature);
  assert.equal(screenshots.length, 2);
  assert.deepEqual(screenshots.map(s => [s.label, s.file, s.mimeType, s.data]), [
    ["First", first, "image/png", png.toString("base64")],
    ["Second", second, "image/png", png.toString("base64")],
  ]);
  const messages = [];
  const screenshotExport = { url: "file:///tmp/dt-ticket-15-images-example/" };
  displayTicket({ sendMessage: m => messages.push(m) }, { slug: "demo" }, ticket, "TODO", "## Saved ticket progress\nNo progress.", screenshots, screenshotExport);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, `Status: TODO\n\n${content}\n\n## Saved ticket progress\nNo progress.`);
  assert.deepEqual(messages[0].details.screenshots, screenshots);
  assert.deepEqual(messages[0].details.screenshotExport, screenshotExport);
  assert.ok(!messages[0].content.includes(png.toString("base64")));
});

test("missing, non-image, oversized, remote and escaped paths show gaps without leaking file contents", async (t) => {
  const { dir, feature, file } = await fixture(t);
  await writeFile(join(dir, "outside.png"), png);
  await symlink(join(dir, "outside.png"), join(feature, "references/ui/escape.png"));
  await writeFile(join(feature, "references/ui/not-image.png"), "private text");
  await writeFile(join(feature, "references/ui/large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
  const ticket = { file, content: [
    '![Missing](../references/ui/missing.png)',
    '![Text](../references/ui/not-image.png)',
    '![Large](../references/ui/large.png)',
    '![Remote](https://example.invalid/screenshot.png)',
    '![Traversal](../../outside.png)',
    '![Symlink](../references/ui/escape.png)',
  ].join("\n") };
  const screenshots = await readTicketScreenshots(ticket, feature);
  assert.equal(screenshots.length, 6);
  assert.ok(screenshots.every(s => s.error && !s.data));
  assert.match(screenshots[0].error, /missing|read/i);
  assert.match(screenshots[1].error, /image/i);
  assert.match(screenshots[2].error, /10 MiB/i);
  assert.match(screenshots[3].error, /remote|local/i);
  assert.match(screenshots[4].error, /feature directory/i);
  assert.match(screenshots[5].error, /feature directory/i);
  assert.ok(!JSON.stringify(screenshots).includes("private text"));
});

test("screenshot export creates a private /tmp folder with validated snapshots in reference order", async (t) => {
  const { feature, file } = await fixture(t);
  await mkdir(join(feature, "references/other"));
  await writeFile(join(feature, "references/ui/screen.png"), png);
  await writeFile(join(feature, "references/other/screen.png"), png);
  const screenshots = await readTicketScreenshots({ file, content: [
    "![First](../references/ui/screen.png)",
    "![Duplicate](../references/ui/screen.png)",
    "![Second](../references/other/screen.png)",
    "![Missing](../references/ui/missing.png)",
  ].join("\n") }, feature);
  // Export the captured bytes, not a new read of mutable source files.
  await writeFile(join(feature, "references/ui/screen.png"), "changed");
  const exported = await exportTicketScreenshots("15", screenshots);
  assert.match(exported.url, /^file:\/\/\/tmp\/dt-ticket-15-images-[^/]+\/$/);
  const folder = fileURLToPath(exported.url);
  t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(folder), ["01-screen.png", "02-screen.png"]);
  for (const name of await readdir(folder)) {
    assert.deepEqual(await readFile(join(folder, name)), png);
    assert.equal((await stat(join(folder, name))).mode & 0o777, 0o600);
  }
  assert.equal(await exportTicketScreenshots("15", []), undefined);
  assert.equal(await exportTicketScreenshots("15", [{ error: "Missing" }]), undefined);
  const failed = await exportTicketScreenshots("15", screenshots, join(feature, "missing-parent"));
  assert.match(failed.error, /Unable to create ticket images folder/);
});

test("ticket renderer shows only the folder link after the complete ticket and saved progress", () => {
  class Component { constructor(...args) { this.args = args; this.children = []; } addChild(child) { this.children.push(child); } }
  class Box extends Component {} class Markdown extends Component {} class Text extends Component {}
  const renderer = createTicketRenderer({ Box, Markdown, Text, getMarkdownTheme: () => "markdown-theme" });
  const theme = { bg: (_, t) => t, fg: (_, t) => t };
  const folder = "file:///tmp/dt-ticket-20-images-SvDEbn/";
  const message = { content: "Full ticket\n\nSaved progress", details: {
    screenshots: [{ label: "First", file: "/feature/first.png", mimeType: "image/png", data: png.toString("base64") }],
    screenshotExport: { url: folder },
  } };
  const component = renderer(message, { outputPad: 1, expanded: false }, theme);
  assert.equal(component.children.length, 2);
  assert.ok(component.children[0] instanceof Markdown);
  assert.equal(component.children[0].args[0], message.content);
  assert.ok(component.children[1] instanceof Text);
  assert.equal(component.children[1].args[0], `\nReference screenshots: ${folder}`);
  assert.equal(renderer({ content: "No images" }, { outputPad: 0 }, theme).children.length, 1);
  const failed = renderer({ content: "Ticket", details: { screenshotExport: { error: "Export failed" } } }, { outputPad: 0 }, theme);
  assert.equal(failed.children.at(-1).args[0], "Export failed");
});
