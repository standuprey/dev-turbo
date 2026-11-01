#!/usr/bin/env node
// dt.mjs - the one script behind the /dt-* prompts. Zero dependencies; Node 18+.
//
//   dt.mjs -h | <command> -h                            show help (also --help)
//   dt.mjs info [--json]                                   repo key, modality, main branch, lanes, features dir, checks
//   dt.mjs config set checks "<cmd>"                        remember the checks command for this repo
//   dt.mjs status <slug> [--no-fetch] [--no-gh]             kanban + DAG + unsafe pairs in the terminal; rewrites overview.md
//   dt.mjs next <slug> [--ticket ID] [--dry-run]            pick a ready ticket; branch in place (monorepo) or worktree (standalone)
//   dt.mjs gate <slug> <0-4> approve|change [--note "..."] [--card FILE] [--ticket ID] [--tier T2 --type service] [--dry-run]
//   dt.mjs pr <slug> <ID> | pr quick --title "..." --body-file FILE   [--dry-run]
//   dt.mjs comment --body-file FILE [--branch B] [--dry-run]
//   dt.mjs selftest
//
// Status is derived, never hand-edited:
//   todo        no origin/ticket/<slug>-<id> branch
//   in_progress branch exists
//   review      handoff/<id>.md exists (shared dir, or on the branch)
//   done        "G3 approve ticket <id>" recorded in gates.md (or frontmatter status: done as a manual override)
//
// env: DT_DIR (default ~/.pi/agent/dt)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const DT_DIR = process.env.DT_DIR || path.join(HOME, ".pi", "agent", "dt");
const CONFIG_PATH = path.join(DT_DIR, "config.json");
const MAX_IN_FLIGHT = 2;
const DRIFT_EVERY = 2;
const STATUSES = ["todo", "in_progress", "review", "done"];

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };
const flag = (name) => process.argv.includes(name);
const opt = (name, def) => { const i = process.argv.indexOf(name); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def; };
const expand = (p) => path.resolve(p.replace(/^~(?=$|\/)/, HOME));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
let DRY = false;

// ---------- shell ----------
function sh(cmd, args, o = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: o.cwd, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (o.soft) return null;
    const err = (e.stderr || e.message || "").toString().trim().split("\n").slice(-2).join(" ");
    throw new Fail(`${cmd} ${args.join(" ")}: ${err}`);
  }
}
const git = (args, o) => sh("git", args, o);
function run(cmd, args, o = {}) {
  if (DRY) { console.log(`  (dry-run) ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`); return ""; }
  return sh(cmd, args, o);
}

// ---------- config and repo context ----------
export function repoKeyFromUrl(url) {
  const u = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  let m = u.match(/^[\w.+-]+@[^:/]+:(.+)$/);        // git@host-alias:org/repo
  if (m) return m[1];
  m = u.match(/^[a-z+]+:\/\/[^/]+\/(.+)$/i);        // ssh://git@host/org/repo, https://host/org/repo
  if (m) return m[1];
  return u.split("/").filter(Boolean).slice(-2).join("/");   // local path or unknown form: last two segments
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { repos: {}, defaults: { modality: "standalone" } };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { fail(`cannot parse ${CONFIG_PATH}: ${e.message}`); }
}
function saveConfig(c) { fs.mkdirSync(DT_DIR, { recursive: true }); fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2) + "\n"); }

function mainBranch(root) {
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root, soft: true });
  if (head) return head.replace(/^origin\//, "");
  for (const b of ["main", "master"]) if (git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${b}`], { cwd: root, soft: true }) !== null) return b;
  fail("cannot determine the main branch: run `git remote set-head origin -a`");
}

export function resolveRepo(cwd = process.cwd(), config = loadConfig()) {
  const root = git(["rev-parse", "--show-toplevel"], { cwd, soft: true });
  if (!root) fail("not inside a git repository");
  const url = git(["remote", "get-url", "origin"], { cwd: root, soft: true }) || root;
  const key = repoKeyFromUrl(url);
  const entry = config.repos?.[key] || {};
  const defaults = config.defaults || {};
  const modality = entry.modality || defaults.modality || "standalone";
  const lanes = (entry.lanes || []).map(expand);
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const laneIndex = lanes.findIndex((p) => real(p) === real(root));
  const gitDir = path.resolve(root, git(["rev-parse", "--git-dir"], { cwd: root }));
  const common = path.resolve(root, git(["rev-parse", "--git-common-dir"], { cwd: root }));
  const isWorktree = gitDir !== common;
  const mainRoot = isWorktree ? path.dirname(common) : root;
  return {
    key, root, mainRoot, modality, lanes, laneIndex, isWorktree,
    main: mainBranch(root),
    branch: git(["branch", "--show-current"], { cwd: root, soft: true }) || "",
    checks: entry.checks || defaults.checks || "",
    featuresInRepo: modality !== "monorepo",
    featuresBase: modality === "monorepo" ? path.join(DT_DIR, "features", key) : path.join(root, "docs", "features"),
  };
}

const P = (ctx, slug) => {
  const dir = path.join(ctx.featuresBase, slug);
  return { dir, spec: path.join(dir, "spec.md"), tickets: path.join(dir, "tickets"), handoff: path.join(dir, "handoff"),
    gates: path.join(dir, "gates.md"), overview: path.join(dir, "overview.md"), feature: path.join(dir, "feature.json") };
};
const readJson = (f, def = {}) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : def);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");

// ---------- frontmatter (the YAML block between --- lines; flat keys, scalars and [a, b] lists) ----------
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
function parseScalar(v) {
  if (v.startsWith("[")) return v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
  return unquote(v);
}
export function parseFrontmatter(text) {
  const m = text.match(FM_RE);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#\s.*$/, "");     // strip "  # comment" but keep "#12"
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = parseScalar(kv[2].trim());
  }
  return { data, body: text.slice(m[0].length) };
}
export function setFrontmatter(text, key, value) {
  const v = Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
  const m = text.match(FM_RE);
  if (!m) return `---\n${key}: ${v}\n---\n${text}`;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) lines[i] = `${key}: ${v}`; else lines.push(`${key}: ${v}`);
  return `---\n${lines.join("\n")}\n---${text.slice(m[0].length)}`;
}

// ---------- tickets, gates, git state ----------
const pad = (x) => String(x).padStart(2, "0");
function loadTickets(ctx, slug) {
  const p = P(ctx, slug);
  if (!fs.existsSync(p.tickets)) fail(`no tickets in ${p.tickets} (run /dt-slice first)`);
  return fs.readdirSync(p.tickets).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const file = path.join(p.tickets, f);
    const { data } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    const list = (k) => (Array.isArray(data[k]) ? data[k] : data[k] ? [data[k]] : []);
    return { id: pad(data.id || f.slice(0, 2)), file, title: data.title || f.replace(/\.md$/, ""), kind: data.kind || "AFK",
      blocked_by: list("blocked_by").map(pad), touches: list("touches"), unsafe_with: list("unsafe_with").map(pad),
      verify: data.verify || "", fm_status: data.status || "", issue: data.issue || "" };
  });
}

export function parseGates(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^## G(\d) (approve|change)(?: ticket (\d+))? — (.+)$/);
    if (m) out.push({ gate: +m[1], decision: m[2], ticket: m[3] ? pad(m[3]) : null, date: m[4].trim() });
  }
  return out;
}
const readGates = (p) => (fs.existsSync(p.gates) ? parseGates(fs.readFileSync(p.gates, "utf8")) : []);

function gitState(ctx, slug, { fetch = true } = {}) {
  if (fetch) git(["fetch", "--prune", "--quiet", "origin"], { cwd: ctx.root, soft: true });
  const prefix = `ticket/${slug}-`;
  const refs = git(["for-each-ref", "--format=%(refname:short)", `refs/remotes/origin/${prefix}*`], { cwd: ctx.root, soft: true }) || "";
  const branches = {};
  for (const r of refs.split("\n").filter(Boolean)) {
    const id = r.slice(`origin/${prefix}`.length);
    if (/^\d+$/.test(id)) branches[pad(id)] = r.slice("origin/".length);
  }
  const laneOf = {};
  const tag = (b, label) => { if (!b || !b.startsWith(prefix)) return; const id = b.slice(prefix.length); if (/^\d+$/.test(id)) laneOf[pad(id)] = label; };
  if (ctx.modality === "monorepo") ctx.lanes.forEach((p, i) => tag(git(["branch", "--show-current"], { cwd: p, soft: true }), `lane ${i + 1}`));
  else {
    let dir = "";
    for (const line of (git(["worktree", "list", "--porcelain"], { cwd: ctx.root, soft: true }) || "").split("\n")) {
      if (line.startsWith("worktree ")) dir = line.slice(9);
      else if (line.startsWith("branch refs/heads/")) tag(line.slice("branch refs/heads/".length), path.basename(dir));
    }
  }
  return { branches, laneOf };
}

function handoffChecker(ctx, slug, p) {
  return (id) => {
    const file = path.join(p.handoff, `${id}.md`);
    if (fs.existsSync(file)) return true;
    if (!ctx.featuresInRepo) return false;
    const rel = path.relative(ctx.root, file);
    return git(["cat-file", "-e", `origin/ticket/${slug}-${id}:${rel}`], { cwd: ctx.root, soft: true }) !== null;
  };
}

// ---------- pure logic ----------
export function deriveStatuses(tickets, { branches, hasHandoff, gates, prMerged = () => false }) {
  const done = new Set(gates.filter((g) => g.gate === 3 && g.decision === "approve" && g.ticket).map((g) => g.ticket));
  const st = {};
  for (const t of tickets) {
    let status = "todo", note = "";
    if (done.has(t.id) || t.fm_status === "done") status = "done";
    else if (branches[t.id]) {
      status = hasHandoff(t.id) ? "review" : "in_progress";
      if (status === "review" && prMerged(t.id)) note = "PR merged: record G3";
    }
    st[t.id] = { status, note, blocked: false };
  }
  for (const t of tickets) st[t.id].blocked = st[t.id].status === "todo" && !t.blocked_by.every((b) => st[b]?.status === "done");
  return st;
}

export function pickReady(tickets, st, wanted) {
  const inFlight = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status));
  if (inFlight.length >= MAX_IN_FLIGHT) fail(`${MAX_IN_FLIGHT} tickets already in flight (${inFlight.map((t) => t.id).join(", ")}): merge one first (Gate 3)`);
  const busy = new Set(inFlight.flatMap((t) => t.touches));
  const candidates = wanted ? tickets.filter((t) => t.id === pad(wanted)) : tickets;
  if (wanted && !candidates.length) fail(`no ticket ${pad(wanted)}`);
  const reasons = [];
  for (const t of candidates) {
    const s = st[t.id];
    if (s.status !== "todo") { reasons.push(`${t.id}: ${s.status}`); continue; }
    const blocked = t.blocked_by.filter((b) => st[b]?.status !== "done");
    if (blocked.length) { reasons.push(`${t.id}: blocked by ${blocked.join(", ")}`); continue; }
    const clash = t.touches.filter((m) => busy.has(m));
    if (clash.length) { reasons.push(`${t.id}: touches ${clash.join(", ")}, already in flight`); continue; }
    const unsafe = inFlight.filter((f) => t.unsafe_with.includes(f.id) || f.unsafe_with.includes(t.id));
    if (unsafe.length) { reasons.push(`${t.id}: unsafe to run with ${unsafe.map((f) => f.id).join(", ")}`); continue; }
    return t;
  }
  fail(`no ready ticket:\n  ${reasons.join("\n  ")}`);
}

export function pairs(tickets) {
  const out = [];
  for (let i = 0; i < tickets.length; i++) for (let j = i + 1; j < tickets.length; j++) {
    const a = tickets[i], b = tickets[j];
    if (a.blocked_by.includes(b.id) || b.blocked_by.includes(a.id)) continue;   // never concurrent anyway
    const shared = a.touches.filter((m) => b.touches.includes(m));
    const unsafe = a.unsafe_with.includes(b.id) || b.unsafe_with.includes(a.id);
    if (shared.length || unsafe) out.push(`${a.id}+${b.id}: ${shared.length ? `share ${shared.join(", ")}` : "marked unsafe_with"}`);
  }
  return out;
}

const cell = (t, s, laneOf) => [`${t.id} ${t.title}`, s.blocked ? "🔒" : "", t.kind === "HITL" ? "HITL" : "", laneOf[t.id] || "", t.issue ? `#${t.issue}` : "", s.note].filter(Boolean).join(" · ");
export function kanbanTable(tickets, st, laneOf = {}) {
  const lists = STATUSES.map((c) => tickets.filter((t) => st[t.id].status === c).map((t) => cell(t, st[t.id], laneOf)));
  const rows = Math.max(1, ...lists.map((l) => l.length));
  const lines = [`| ${STATUSES.join(" | ")} |`, `|${STATUSES.map(() => "---").join("|")}|`];
  for (let i = 0; i < rows; i++) lines.push(`| ${lists.map((l) => l[i] || "").join(" | ")} |`);
  return lines.join("\n");
}

export function dagMermaid(tickets, st) {
  const q = (s) => s.replace(/"/g, "#quot;");
  const lines = ["flowchart LR"];
  for (const t of tickets) lines.push(`  T${t.id}["${t.id} ${q(t.title)}${t.kind === "HITL" ? " (HITL)" : ""}"]:::${st[t.id].status}`);
  for (const t of tickets) for (const b of t.blocked_by) lines.push(`  T${b} --> T${t.id}`);
  lines.push("  classDef todo fill:#f3f4f6,stroke:#9ca3af", "  classDef in_progress fill:#fef3c7,stroke:#d97706",
    "  classDef review fill:#dbeafe,stroke:#2563eb", "  classDef done fill:#dcfce7,stroke:#16a34a");
  return lines.join("\n");
}

export function gateSummary(gates) {
  return [0, 1, 2, 3, 4].map((n) => {
    const e = gates.filter((g) => g.gate === n);
    if (!e.length) return `G${n} –`;
    const last = e[e.length - 1];
    if (n === 3) return `G3 ✅×${e.filter((g) => g.decision === "approve").length} (${last.date})`;
    return `G${n} ${last.decision === "approve" ? "✅" : "🔁"} ${last.date}`;
  }).join(" · ");
}

const mermaidBlock = (text) => text.match(/```mermaid\r?\n([\s\S]*?)```/)?.[1]?.trim() || "";
function section(text, titleRe) {
  const seg = text.split(/\n(?=#{1,3} )/).find((s) => titleRe.test(s.split("\n")[0]));
  return seg ? seg.split("\n").slice(1).join("\n").trim() : "";
}
const latestArch = (dir) => fs.readdirSync(dir).filter((f) => /^arch-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().pop();

function renderOverview({ ctx, slug, feature, tickets, st, gates, laneOf, p }) {
  const inFlight = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status)).length;
  const arch = latestArch(p.dir);
  const spec = fs.existsSync(p.spec) ? fs.readFileSync(p.spec, "utf8") : "";
  const archText = arch ? fs.readFileSync(path.join(p.dir, arch), "utf8") : "";
  const moduleMap = (arch && mermaidBlock(archText)) || mermaidBlock(spec);
  const moduleSrc = arch && mermaidBlock(archText) ? `${arch} (actual)` : spec ? "spec.md (planned)" : "";
  const findings = arch ? section(archText, /findings/i) : "";
  const unsafe = pairs(tickets);
  const out = [`# ${slug} - overview`, "", `_Generated by \`dt.mjs status\` on ${stamp()}. Do not edit: change the tickets, the spec or gates.md instead._`, "",
    "| | |", "|---|---|", `| Tier | ${feature.tier || "?"} |`, `| Type | ${feature.type || "?"} |`, `| Modality | ${ctx.modality} |`];
  if (feature.issue) out.push(`| Feature issue | #${feature.issue} |`);
  out.push(`| Gates | ${gateSummary(gates)} |`, `| In flight | ${inFlight} of ${MAX_IN_FLIGHT} |`, "",
    "## Kanban", "", tickets.length ? kanbanTable(tickets, st, laneOf) : "_no tickets yet_", "",
    "## Dependency graph", "", tickets.length ? "```mermaid\n" + dagMermaid(tickets, st) + "\n```" : "_no tickets yet_", "",
    "## Pairs that must not run together", "", unsafe.length ? unsafe.map((s) => `- ${s}`).join("\n") : "_none_", "",
    "## Module map", "", moduleMap ? "```mermaid\n" + moduleMap + "\n```\n\n_Source: " + moduleSrc + "_" : "_no module diagram yet (spec.md section 4)_", "",
    "## Open drift findings", "", findings ? `_From ${arch}_\n\n${findings}` : "_no drift review yet_", "",
    "## Files", "", `- [spec.md](spec.md) · [gates.md](gates.md) · [tickets/](tickets/) · [handoff/](handoff/)${arch ? ` · [${arch}](${arch})` : ""}`, "");
  return out.join("\n");
}

// ---------- commands ----------
function cmdInfo(ctx) {
  if (flag("--json")) return console.log(JSON.stringify(ctx, null, 2));
  const lines = [`repo: ${ctx.key}`, `modality: ${ctx.modality}`, `root: ${ctx.root}${ctx.isWorktree ? " (worktree)" : ""}`, `main: ${ctx.main}`, `branch: ${ctx.branch || "(detached)"}`];
  if (ctx.modality === "monorepo") lines.push(`lane: ${ctx.laneIndex >= 0 ? `${ctx.laneIndex + 1} of ${ctx.lanes.length}` : "NOT a configured lane"}`, `lanes: ${ctx.lanes.join(" | ") || "(none configured)"}`);
  lines.push(`features: ${ctx.featuresBase}${ctx.featuresInRepo ? " (in repo, committed)" : " (outside the repo, shared by the lanes)"}`,
    `checks: ${ctx.checks || "(unset: ask once, then `dt.mjs config set checks \"<cmd>\"`)"}`);
  console.log(lines.join("\n"));
}

function cmdConfig(ctx, args) {
  const [verb, key, value] = args;
  if (verb !== "set" || key !== "checks" || value === undefined) fail('usage: dt.mjs config set checks "<cmd>"');
  const c = loadConfig();
  c.repos = c.repos || {};
  c.repos[ctx.key] = { ...(c.repos[ctx.key] || {}), checks: value };
  saveConfig(c);
  console.log(`saved checks for ${ctx.key} in ${CONFIG_PATH}`);
}

function collect(ctx, slug, { fetch = true, gh = true } = {}) {
  const p = P(ctx, slug);
  if (!fs.existsSync(p.dir)) fail(`no feature folder ${p.dir} (run the grill and \`dt.mjs gate ${slug} 0 approve --tier T2 --type <type>\` first)`);
  const tickets = fs.existsSync(p.tickets) ? loadTickets(ctx, slug) : [];
  const gs = gitState(ctx, slug, { fetch });
  const gates = readGates(p);
  const prMerged = gh ? (id) => { const r = sh("gh", ["pr", "list", "--head", `ticket/${slug}-${id}`, "--state", "merged", "--json", "number", "--jq", "length"], { cwd: ctx.root, soft: true }); return !!r && +r > 0; } : () => false;
  const st = deriveStatuses(tickets, { branches: gs.branches, hasHandoff: handoffChecker(ctx, slug, p), gates, prMerged });
  return { p, tickets, gs, gates, st, feature: readJson(p.feature) };
}

function cmdStatus(ctx, slug) {
  const d = collect(ctx, slug, { fetch: !flag("--no-fetch"), gh: !flag("--no-gh") });
  fs.writeFileSync(d.p.overview, renderOverview({ ctx, slug, laneOf: d.gs.laneOf, ...d }));
  const unsafe = pairs(d.tickets);
  console.log([`${slug}: ${gateSummary(d.gates)}`, "", kanbanTable(d.tickets, d.st, d.gs.laneOf), "",
    "```mermaid", dagMermaid(d.tickets, d.st), "```", "",
    `pairs that must not run together: ${unsafe.length ? "\n  " + unsafe.join("\n  ") : "none"}`, "",
    `overview: ${d.p.overview}`].join("\n"));
}

function describe(ctx, t, where) {
  return [`ticket ${t.id} "${t.title}" (${t.kind}) ${where}`, `  ticket: ${t.file}`, `  touches: ${t.touches.join(", ") || "(none listed)"}`,
    `  overlay: ${path.join(DT_DIR, "overlays", `${t.verify || "service"}.md`)}`, `  checks: ${ctx.checks || "(unset)"}`].join("\n");
}

function cmdNext(ctx, slug) {
  const p = P(ctx, slug);
  const wanted = opt("--ticket");
  const cur = ctx.branch.match(new RegExp(`^ticket/${esc(slug)}-(\\d+)$`));
  if (cur) {
    const id = pad(cur[1]);
    const t = loadTickets(ctx, slug).find((x) => x.id === id) || fail(`no ticket ${id}`);
    const done = collect(ctx, slug, { gh: false }).st[id]?.status === "done";
    if (!done) {
      if (wanted && pad(wanted) !== id) fail(`this checkout is on ticket ${id}'s branch; finish it or use another lane`);
      return console.log(`resume: already on ${ctx.branch}\n` + describe(ctx, t, ""));
    }
    if (git(["status", "--porcelain"], { cwd: ctx.root })) fail(`ticket ${id} is done but the tree is dirty: commit or stash first`);
    run("git", ["switch", ctx.main], { cwd: ctx.root });
    console.log(`ticket ${id} is done: switched back to ${ctx.main}`);
  }
  if (ctx.modality === "monorepo" && ctx.laneIndex < 0) fail(`run this inside one of the configured lanes:\n  ${ctx.lanes.join("\n  ") || "(none: add lanes to " + CONFIG_PATH + ")"}`);
  if (ctx.modality === "standalone" && ctx.isWorktree) fail("run this from the main checkout, not from a lane worktree");
  const d = collect(ctx, slug, { gh: false });
  const t = pickReady(d.tickets, d.st, wanted);
  const branch = `ticket/${slug}-${t.id}`;
  if (ctx.modality === "monorepo") {
    if (git(["status", "--porcelain"], { cwd: ctx.root })) fail("working tree is not clean");
    run("git", ["switch", "-c", branch, `origin/${ctx.main}`], { cwd: ctx.root });
    run("git", ["push", "-u", "origin", branch], { cwd: ctx.root });
    console.log(describe(ctx, t, `on ${branch} (lane ${ctx.laneIndex + 1})`));
  } else {
    const rel = path.relative(ctx.root, p.tickets);
    if (git(["cat-file", "-e", `origin/${ctx.main}:${rel}`], { cwd: ctx.root, soft: true }) === null) fail(`tickets are not on origin/${ctx.main} yet: commit and push ${rel} first`);
    const wt = path.join(path.dirname(ctx.mainRoot), `${path.basename(ctx.mainRoot)}.lane-${t.id}`);
    if (fs.existsSync(wt)) fail(`${wt} already exists`);
    run("git", ["worktree", "add", "-b", branch, wt, `origin/${ctx.main}`], { cwd: ctx.root });
    run("git", ["push", "-u", "origin", branch], { cwd: DRY ? ctx.root : wt });
    console.log(describe(ctx, t, `in worktree ${wt}`) + `\n\nopen pi in ${wt} and run: /dt-lane ${slug} ${t.id}`);
  }
}

function commitFeaturesRepo(ctx, msg) {
  if (ctx.featuresInRepo || DRY) return;
  const base = path.join(DT_DIR, "features");
  if (!fs.existsSync(path.join(base, ".git"))) git(["init", "-q"], { cwd: base });
  git(["add", "-A"], { cwd: base, soft: true });
  git(["commit", "-qm", msg], { cwd: base, soft: true });
}

function issueNumber(url) { return +(url.match(/\/(\d+)\s*$/)?.[1] || 0); }

function createFeatureIssue(ctx, slug, p) {
  const f = readJson(p.feature);
  if (f.issue) return console.log(`feature issue already exists: #${f.issue}`);
  if (!fs.existsSync(p.spec)) fail(`no ${p.spec}`);
  const url = run("gh", ["issue", "create", "--title", `Feature: ${slug}`, "--body-file", p.spec], { cwd: ctx.root });
  if (DRY) return;
  f.issue = issueNumber(url); writeJson(p.feature, f);
  console.log(`feature issue: ${url}`);
}

function createTicketIssues(ctx, slug, p) {
  const f = readJson(p.feature);
  const tickets = loadTickets(ctx, slug);
  let created = 0;
  for (const t of tickets) {
    if (t.issue) continue;
    const url = run("gh", ["issue", "create", "--title", `${slug} ${t.id}: ${t.title}`, "--body-file", t.file], { cwd: ctx.root });
    if (DRY) continue;
    t.issue = issueNumber(url);
    fs.writeFileSync(t.file, setFrontmatter(fs.readFileSync(t.file, "utf8"), "issue", t.issue));
    created++;
  }
  if (f.issue && !DRY) {
    const tmp = path.join(os.tmpdir(), `dt-${slug}-feature.md`);
    fs.writeFileSync(tmp, fs.readFileSync(p.spec, "utf8") + "\n\n## Tickets\n\n" + tickets.map((t) => `- [ ] #${t.issue} ${t.id} ${t.title}`).join("\n") + "\n");
    run("gh", ["issue", "edit", String(f.issue), "--body-file", tmp], { cwd: ctx.root });
  }
  console.log(`ticket issues: ${created} created${f.issue ? `, task list updated on #${f.issue}` : ""}${ctx.featuresInRepo && created ? "\ncommit the updated tickets (issue numbers were written to their frontmatter)" : ""}`);
}

function afterMerge(ctx, slug, id) {
  if (ctx.modality !== "standalone") return;
  const wt = path.join(path.dirname(ctx.mainRoot), `${path.basename(ctx.mainRoot)}.lane-${id}`);
  if (fs.existsSync(wt)) {
    const r = DRY ? "" : git(["worktree", "remove", wt], { cwd: ctx.mainRoot, soft: true });
    console.log(r === null ? `could not remove ${wt} (uncommitted changes?): remove it yourself with git worktree remove --force` : `removed worktree ${wt}`);
  }
  if (!DRY) git(["branch", "-D", `ticket/${slug}-${id}`], { cwd: ctx.mainRoot, soft: true });
}

function cmdGate(ctx, slug, n, decision) {
  n = +n;
  if (!(n >= 0 && n <= 4)) fail("gate number must be 0-4");
  if (!["approve", "change"].includes(decision)) fail("decision must be approve or change");
  const p = P(ctx, slug);
  const note = opt("--note", ""), card = opt("--card"), ticket = opt("--ticket");
  if (n === 0) {
    const tier = opt("--tier"), type = opt("--type");
    if (!/^T[012]$/.test(tier || "") || !["web", "device", "service", "mixed"].includes(type || "")) fail("gate 0 needs --tier T0|T1|T2 and --type web|device|service|mixed");
    if (decision !== "approve") return console.log(`G0 change: ${note || "(no note)"}; rerun the grill round`);
    if (tier !== "T2") return console.log(`G0 approve: ${tier} ${type} "${slug}" - no feature folder for ${tier}.\nnext: /dt-quick ${type} as aligned`);
    fs.mkdirSync(p.dir, { recursive: true });
    writeJson(p.feature, { slug, tier, type, modality: ctx.modality, created: stamp(), ...(readJson(p.feature)) });
  }
  if (!fs.existsSync(p.dir)) fail(`no feature folder ${p.dir} (run \`dt.mjs gate ${slug} 0 approve --tier T2 --type <type>\` first)`);
  if (n === 3 && !ticket) fail("gate 3 needs --ticket ID (the merged ticket)");
  let entry = `\n## G${n} ${decision}${ticket ? ` ticket ${pad(ticket)}` : ""} — ${stamp()}\n`;
  if (note) entry += `\n${note}\n`;
  if (card) entry += `\n${fs.readFileSync(card, "utf8").trim()}\n`;
  if (!DRY) fs.appendFileSync(p.gates, (fs.existsSync(p.gates) ? "" : `# Gates - ${slug}\n`) + entry);
  console.log(`${DRY ? "(dry-run) would record " : ""}G${n} ${decision}${ticket ? ` ticket ${pad(ticket)}` : ""}${DRY ? "" : ` recorded in ${p.gates}`}`);
  if (decision === "approve") {
    if (n === 1 && ctx.modality === "standalone") createFeatureIssue(ctx, slug, p);
    if (n === 2 && ctx.modality === "standalone") createTicketIssues(ctx, slug, p);
    if (n === 3) afterMerge(ctx, slug, pad(ticket));
  }
  if (n >= 2 && fs.existsSync(p.tickets) && !DRY) {
    const d = collect(ctx, slug, { fetch: false, gh: false });
    fs.writeFileSync(d.p.overview, renderOverview({ ctx, slug, laneOf: d.gs.laneOf, ...d }));
  }
  if (n === 3 && decision === "approve") {
    const gates = readGates(p);
    const lastDrift = gates.map((g, i) => (g.gate === 4 ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const merges = gates.filter((g, i) => i > lastDrift && g.gate === 3 && g.decision === "approve").length;
    if (merges >= DRIFT_EVERY) console.log(`${merges} merges since the last drift review -> run /dt-drift ${slug}`);
  }
  commitFeaturesRepo(ctx, `dt: G${n} ${decision} ${slug}${ticket ? ` ticket ${pad(ticket)}` : ""}`);
  const next = { 0: `/dt-spec ${slug} ${readJson(p.feature).type || "<type>"}`, 1: `/dt-slice ${slug}`, 2: `/dt-lane ${slug} 00`, 3: `/dt-lane ${slug} next`, 4: `/dt-lane ${slug} next` };
  if (decision === "approve") console.log(`next: ${next[n]}`);
}

function cmdPr(ctx, slug, id) {
  const bodyFile = opt("--body-file");
  let title, body, head = ctx.branch;
  if (!head) fail("detached HEAD: switch to the branch to open a PR for");
  if (slug === "quick") {
    title = opt("--title") || fail('pr quick needs --title "..."');
    if (!head.startsWith("quick/")) fail(`not on a quick/* branch (on ${head})`);
    body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : fail("pr quick needs --body-file FILE (the 5-bullet summary)");
  } else {
    if (!id) fail("usage: dt.mjs pr <slug> <ID>");
    const p = P(ctx, slug);
    const t = loadTickets(ctx, slug).find((x) => x.id === pad(id)) || fail(`no ticket ${pad(id)}`);
    const want = `ticket/${slug}-${t.id}`;
    if (head !== want) fail(`on ${head}, expected ${want}`);
    const h = bodyFile || path.join(p.handoff, `${t.id}.md`);
    if (!fs.existsSync(h)) fail(`no handoff note ${h}: write it first`);
    title = `${slug} ${t.id}: ${t.title}`;
    body = fs.readFileSync(h, "utf8") + (t.issue ? `\n\nCloses #${t.issue}\n` : "");
  }
  const existing = sh("gh", ["pr", "view", head, "--json", "url", "--jq", ".url"], { cwd: ctx.root, soft: true });
  if (existing) return console.log(`PR already open: ${existing}`);
  run("git", ["push", "-u", "origin", head], { cwd: ctx.root });
  const tmp = path.join(os.tmpdir(), `dt-pr-${head.replace(/[^\w]+/g, "-")}.md`);
  fs.writeFileSync(tmp, body);
  const args = ["pr", "create", "--base", ctx.main, "--head", head, "--title", title, "--body-file", tmp];
  if (ctx.modality === "monorepo") args.push("--draft");
  const url = run("gh", args, { cwd: ctx.root });
  console.log(`${ctx.modality === "monorepo" ? "draft " : ""}PR: ${url || "(dry-run)"}`);
}

function cmdComment(ctx) {
  const bodyFile = opt("--body-file") || fail("comment needs --body-file FILE");
  const branch = opt("--branch", ctx.branch);
  if (!sh("gh", ["pr", "view", branch, "--json", "number", "--jq", ".number"], { cwd: ctx.root, soft: true })) return console.log(`no PR for ${branch}: findings stay in chat`);
  run("gh", ["pr", "comment", branch, "--body-file", bodyFile], { cwd: ctx.root });
  console.log(`posted review comment on the PR for ${branch}`);
}

// ---------- selftest (pure logic only; no git, no network) ----------
function selftest() {
  let bad = 0;
  const t = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) bad++; };
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  t("repo key ssh alias", repoKeyFromUrl("git@github-work:csscompany-enterprise/monorepo.git") === "csscompany-enterprise/monorepo");
  t("repo key https", repoKeyFromUrl("https://github.com/Witney-AI/app.git") === "Witney-AI/app");
  t("repo key ssh url", repoKeyFromUrl("ssh://git@github.com/org/repo") === "org/repo");
  t("repo key local path", repoKeyFromUrl("/tmp/x/y/origin.git") === "y/origin");
  const fm = parseFrontmatter('---\nid: "03"\ntitle: Add thing #12\nkind: AFK   # agent\nblocked_by: ["00", "02"]\ntouches: [a, b]\nunsafe_with: []\n---\nbody');
  t("frontmatter scalars", fm.data.id === "03" && fm.data.title === "Add thing #12" && fm.data.kind === "AFK");
  t("frontmatter lists", fm.data.blocked_by.join() === "00,02" && fm.data.touches.join() === "a,b" && fm.data.unsafe_with.length === 0 && fm.body === "\nbody");
  t("frontmatter set adds and replaces", /\nissue: 7\n---/.test(setFrontmatter('---\nid: "03"\n---\nx', "issue", 7)) && /^---\nissue: 8\n---/.test(setFrontmatter("---\nissue: 7\n---\nx", "issue", 8)));
  const tk = (id, blocked_by, touches, extra = {}) => ({ id, title: `t${id}`, kind: "AFK", blocked_by, touches, unsafe_with: [], issue: "", fm_status: "", verify: "service", file: "", ...extra });
  const tickets = [tk("00", [], ["core"]), tk("01", ["00"], ["api"]), tk("02", ["00"], ["api", "db"]), tk("03", ["00"], ["ui"], { unsafe_with: ["01"] }), tk("04", ["00"], ["ui"])];
  const gates = parseGates("# Gates\n\n## G0 approve — 2025-10-31 09:00\n\n## G3 approve ticket 00 — 2025-10-31 10:00\nok\n");
  t("gates parse", gates.length === 2 && gates[1].gate === 3 && gates[1].ticket === "00" && gates[1].date === "2025-10-31 10:00");
  t("gate summary", /G0 ✅ 2025-10-31 09:00 · G1 – · G2 – · G3 ✅×1/.test(gateSummary(gates)));
  const st = deriveStatuses(tickets, { branches: { "01": "ticket/x-01", "02": "ticket/x-02" }, hasHandoff: (id) => id === "02", gates, prMerged: (id) => id === "02" });
  t("status done via G3", st["00"].status === "done");
  t("status in_progress via branch", st["01"].status === "in_progress");
  t("status review via handoff (+ merged note)", st["02"].status === "review" && st["02"].note.startsWith("PR merged"));
  t("status todo, unblocked", st["03"].status === "todo" && !st["03"].blocked);
  const st0 = deriveStatuses(tickets, { branches: {}, hasHandoff: () => false, gates: [] });
  t("blocked marker", st0["01"].blocked === true && st0["00"].blocked === false);
  t("pick lowest ready", pickReady(tickets, st0).id === "00");
  t("refuses when 2 in flight", throws(() => pickReady(tickets, st), /in flight/));
  const st1 = deriveStatuses(tickets, { branches: { "01": "b" }, hasHandoff: () => false, gates });
  t("skips module clash and unsafe pair", pickReady(tickets, st1).id === "04");
  t("explicit ticket with clash refused", throws(() => pickReady(tickets, st1, "2"), /touches api/));
  t("explicit ticket blocked refused", throws(() => pickReady(tickets, st0, "01"), /blocked by 00/));
  t("kanban header and cells", kanbanTable(tickets, st, { "01": "lane 1" }).split("\n")[0] === "| todo | in_progress | review | done |" && kanbanTable(tickets, st, { "01": "lane 1" }).includes("01 t01 · lane 1"));
  t("dag edges and classes", dagMermaid(tickets, st).includes("T00 --> T01") && dagMermaid(tickets, st).includes(':::done'));
  t("unsafe pairs (blocked pairs skipped)", pairs(tickets).join("\n") === "01+02: share api\n01+03: marked unsafe_with\n03+04: share ui" && pairs([tk("00", [], ["x"]), tk("01", ["00"], ["x"])]).length === 0);
  console.log(bad ? `${bad} failing` : "all good");
  process.exit(bad ? 1 : 0);
}

// ---------- CLI ----------
const HELP = {
  "": {
    usage: "dt.mjs <command> [options]",
    description: "Dev-turbo workflow tools. Node 18+, zero dependencies.",
    commands: [
      ["info", "Show repository configuration and context"],
      ["config", "Update repository configuration"],
      ["status", "Show the feature board and regenerate overview.md"],
      ["next", "Start a ready ticket in a branch or worktree"],
      ["gate", "Record a gate decision and its follow-up actions"],
      ["pr", "Open a ticket or quick-task pull request"],
      ["comment", "Post review findings on a pull request"],
      ["selftest", "Test pure workflow logic without Git or network access"],
    ],
    notes: "Run dt.mjs <command> -h for command-specific help.\nEnvironment: DT_DIR (default: ~/.pi/agent/dt).\nWorkflow commands require a Git repository; GitHub actions require gh.",
  },
  info: {
    usage: "dt.mjs info [--json]",
    description: "Show repo key, modality, root, main branch, lanes, features directory and checks.",
    options: [["--json", "Print the repository context as JSON"]],
  },
  config: {
    usage: 'dt.mjs config set checks "<cmd>"',
    description: "Remember the checks command for the current repository in DT_DIR/config.json.",
    commands: [["set", "Set a repository configuration value"]],
  },
  "config set": {
    usage: 'dt.mjs config set checks "<cmd>"',
    description: "Set a repository configuration value. Currently only checks is supported.",
    commands: [["checks <cmd>", "Save the checks command (quote commands containing spaces)"]],
  },
  "config set checks": {
    usage: 'dt.mjs config set checks "<cmd>"',
    description: "Save the checks command for the current repository. Use an empty string to clear it.",
  },
  status: {
    usage: "dt.mjs status <slug> [--no-fetch] [--no-gh]",
    description: "Print kanban, dependencies and unsafe pairs; rewrite the feature's overview.md.",
    options: [["--no-fetch", "Skip fetching origin"], ["--no-gh", "Skip checking GitHub for merged PRs"]],
  },
  next: {
    usage: "dt.mjs next <slug> [--ticket ID] [--dry-run]",
    description: "Pick a ready ticket, enforcing dependencies, unsafe pairs and at most two in flight.\nMonorepo: branch in the current lane. Standalone: create a worktree from the main checkout.",
    options: [["--ticket ID", "Select a specific ticket instead of the first ready ticket"], ["--dry-run", "Print Git commands instead of running them"]],
  },
  gate: {
    usage: "dt.mjs gate <slug> <0-4> <approve|change> [options]",
    description: "Record a gate decision: G0 tier, G1 spec, G2 slices, G3 merge, G4 drift.\nApproval may create GitHub issues, clean up a worktree or prompt a drift review.",
    options: [
      ["--note TEXT", "Include a note in the gate record"],
      ["--card FILE", "Include the contents of a gate card file"],
      ["--ticket ID", "Ticket being reviewed (required for G3)"],
      ["--tier T0|T1|T2", "Task tier (required for G0)"],
      ["--type web|device|service|mixed", "Task type (required for G0)"],
      ["--dry-run", "Skip recording the gate and executing Git/GitHub commands"],
    ],
    notes: "G0 with tier T2 initializes the feature folder; T0/T1 use the quick-task flow.\nDry-run is not fully read-only: G0 T2 still initializes the feature folder.",
  },
  pr: {
    usage: "dt.mjs pr <slug> <ID> [--body-file FILE] [--dry-run]\n       dt.mjs pr quick --title TEXT --body-file FILE [--dry-run]",
    description: "Push the current branch and open a PR (draft in monorepo, ready in standalone).\nTicket PRs require the matching ticket/<slug>-<ID> branch and default to handoff/<ID>.md.",
    commands: [["quick", "Open a PR for the current quick/* branch"]],
    options: [["--body-file FILE", "Override the ticket handoff note used as the PR body"], ["--dry-run", "Print push/PR creation commands instead of running them"]],
  },
  "pr quick": {
    usage: "dt.mjs pr quick --title TEXT --body-file FILE [--dry-run]",
    description: "Open a PR for the current quick/* branch using a five-bullet summary.",
    options: [["--title TEXT", "PR title (required)"], ["--body-file FILE", "File containing the PR summary (required)"], ["--dry-run", "Print push/PR creation commands instead of running them"]],
  },
  comment: {
    usage: "dt.mjs comment --body-file FILE [--branch B] [--dry-run]",
    description: "Post review findings on a branch's PR. If no PR exists, findings stay in chat.",
    options: [["--body-file FILE", "File containing the review findings (required)"], ["--branch B", "PR branch (default: current branch)"], ["--dry-run", "Print the comment command instead of posting it"]],
  },
  selftest: {
    usage: "dt.mjs selftest",
    description: "Run pure-logic tests. No Git repository or network access required.",
  },
};

function showHelp(args) {
  const [cmd, sub, key] = args.filter((arg) => arg !== "-h" && arg !== "--help");
  let topic = cmd || "";
  if (cmd === "config" && sub === "set") topic += key === "checks" ? " set checks" : " set";
  if (cmd === "pr" && sub === "quick") topic += " quick";
  const help = Object.hasOwn(HELP, topic) ? HELP[topic] : null;
  if (!help) { console.error(`dt: unknown command ${JSON.stringify(cmd)}. Run dt.mjs -h for help.`); process.exitCode = 2; return; }
  const lines = [`Usage: ${help.usage}`, "", help.description];
  if (help.commands) lines.push("", "Commands:", ...help.commands.map(([name, description]) => `  ${name.padEnd(20)} ${description}`));
  lines.push("", "Options:", ...(help.options || []).concat([["-h, --help", "Show this help and exit"]]).map(([name, description]) => `  ${name.padEnd(30)} ${description}`));
  if (help.notes) lines.push("", help.notes);
  console.log(lines.join("\n"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  DRY = flag("--dry-run");
  try {
    if (!cmd || flag("-h") || flag("--help")) showHelp(process.argv.slice(2));
    else if (!Object.hasOwn(HELP, cmd) || cmd.includes(" ")) { console.error(`dt: unknown command ${JSON.stringify(cmd)}. Run dt.mjs -h for help.`); process.exitCode = 2; }
    else if (cmd === "selftest") selftest();
    else {
      const ctx = resolveRepo();
      if (cmd === "info") cmdInfo(ctx);
      else if (cmd === "config") cmdConfig(ctx, rest);
      else if (cmd === "status") cmdStatus(ctx, rest[0] || fail("usage: dt.mjs status <slug>"));
      else if (cmd === "next") cmdNext(ctx, rest[0] || fail("usage: dt.mjs next <slug> [--ticket ID]"));
      else if (cmd === "gate") cmdGate(ctx, rest[0] || fail("usage: dt.mjs gate <slug> <0-4> approve|change"), rest[1], rest[2]);
      else if (cmd === "pr") cmdPr(ctx, rest[0] || fail("usage: dt.mjs pr <slug> <ID> | pr quick --title ..."), rest[1]);
      else if (cmd === "comment") cmdComment(ctx);
    }
  } catch (e) {
    if (e instanceof Fail) { console.error(`dt: ${e.message}`); process.exit(1); }
    throw e;
  }
}
