import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const clean = (value) => String(value || "").replace(/[\x00-\x1f\x7f]/g, " ");
const referenceKey = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();

// Read Markdown image references, not example code or ordinary document links.
export function screenshotReferences(content) {
  let fence;
  const lines = [];
  for (const line of content.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker && !fence) fence = marker[1];
    else if (marker && marker[1][0] === fence?.[0] && marker[1].length >= fence.length) fence = undefined;
    else if (!fence) lines.push(line);
  }
  const body = lines.join("\n").replace(/(`+)[\s\S]*?\1/g, "");
  const definitions = new Map();
  for (const match of body.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    definitions.set(referenceKey(match[1]), match[2] || match[3]);
  }
  const matches = [];
  for (const match of body.matchAll(/!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\\\s()]|\([^()\n]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?\s*\)/g)) {
    matches.push({ index: match.index, label: match[1], target: match[2] || match[3] });
  }
  for (const match of body.matchAll(/!\[([^\]\n]*)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
    const target = definitions.get(referenceKey(match[2] || match[1]));
    if (target) matches.push({ index: match.index, label: match[1], target });
  }
  return matches.sort((a, b) => a.index - b.index).map(({ label, target }) => ({ label, target }));
}

const within = (root, file) => {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
};
const imageType = (data) => {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(data.toString("ascii", 0, 6))) return "image/gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
};

// Local files only. Store bytes in renderer details, not model-facing message content,
// so a displayed ticket survives session replay without rereading mutable files.
export async function readTicketScreenshots(ticket, featureDir) {
  const references = screenshotReferences(ticket.content);
  if (!references.length) return [];
  const root = resolve(featureDir), canonicalRoot = await realpath(featureDir);
  const seen = new Set(), screenshots = [];
  let totalBytes = 0;
  for (const reference of references) {
    const screenshot = { label: clean(reference.label), target: clean(reference.target) };
    try {
      const target = decodeURIComponent(reference.target.replace(/\\([\\() ])/g, "$1"));
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) throw new Error("Only local screenshot files are displayed; remote URLs are not fetched.");
      const file = resolve(dirname(ticket.file), target);
      if (!within(root, file)) throw new Error("Screenshot must be inside the feature directory.");
      const canonical = await realpath(file);
      if (!within(canonicalRoot, canonical)) throw new Error("Screenshot must be inside the feature directory.");
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      screenshot.file = file;
      const handle = await open(canonical, "r");
      let data;
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("Screenshot is not a regular image file.");
        if (stat.size > MAX_IMAGE_BYTES) throw new Error("Screenshot exceeds the 10 MiB display limit.");
        if (totalBytes + stat.size > MAX_TOTAL_BYTES) throw new Error("Screenshots exceed the 32 MiB per-ticket display limit.");
        // A bounded read also handles a file growing after stat without allocating its new size.
        const buffer = Buffer.alloc(stat.size);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        data = buffer.subarray(0, length);
      } finally { await handle.close(); }
      const mimeType = imageType(data);
      if (!mimeType) throw new Error("Screenshot is not a supported PNG, JPEG, GIF or WebP image.");
      totalBytes += data.length;
      Object.assign(screenshot, { mimeType, data: data.toString("base64") });
    } catch (error) {
      screenshot.error = error.code ? "Screenshot file is missing or unreadable." : clean(error.message);
    }
    screenshots.push(screenshot);
  }
  return screenshots;
}

// Export only already validated image bytes; never copy arbitrary ticket paths.
export async function exportTicketScreenshots(id, screenshots, temporaryRoot = "/tmp") {
  const images = screenshots.filter(screenshot => !screenshot.error && screenshot.data && screenshot.file);
  if (!images.length) return undefined;
  let folder;
  try {
    const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, "-");
    folder = await mkdtemp(resolve(temporaryRoot, `dt-ticket-${safeId}-images-`));
    for (const [index, screenshot] of images.entries()) {
      const name = `${String(index + 1).padStart(2, "0")}-${basename(screenshot.file)}`;
      await writeFile(resolve(folder, name), Buffer.from(screenshot.data, "base64"), { mode: 0o600, flag: "wx" });
    }
    return { url: pathToFileURL(folder + sep).href };
  } catch {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
    return { error: "Unable to create ticket images folder; individual references remain available." };
  }
}

export function createTicketRenderer({ Box, Markdown, Text, getMarkdownTheme }) {
  return (message, { outputPad }, theme) => {
    const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Markdown(String(message.content), 0, 0, getMarkdownTheme()));
    const exported = message.details?.screenshotExport;
    if (exported?.url) box.addChild(new Text(`\nReference screenshots: ${exported.url}`, 0, 0));
    else if (exported?.error) box.addChild(new Text(theme.fg("warning", clean(exported.error)), 0, 0));
    return box;
  };
}
