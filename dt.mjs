#!/usr/bin/env node
// dt.mjs - the one script behind the /dt-* prompts. Zero dependencies; Node 18+.
//
//   dt.mjs -h | <command> -h                            show help (also --help)
//   dt.mjs info [--json]                                   repo key, modality, main branch, lanes, features dir, checks
//   dt.mjs config set checks "<cmd>"                        remember the checks command for this repo
//   dt.mjs resume [<slug>] [--json] [--prompt] [--no-gh]    list features, or a short brief of one (refreshes PRs/issues)
//   dt.mjs progress <slug> [--ticket ID] [updates]          show or update progress.json (current state only)
//   dt.mjs status <slug> [--no-gh]                          kanban + DAG + unsafe pairs
//   dt.mjs next <slug> --owner ID [--ticket ID] [--force] [--dry-run]            pick a ready ticket; branch in place (monorepo) or worktree (standalone)
//   dt.mjs gate <slug> <0|2|3> approve|change|pending [--note "..."] [--ticket ID] [--tier T2 --type service] [--dry-run]
//   dt.mjs pr <slug> <ID> --body-file FILE [--dry-run]
//   dt.mjs comment --body-file FILE [--branch B] [--dry-run]
//   dt.mjs selftest
//
// The feature folder is the only memory between sessions:
//   feature.json   identity: tier, type, modality
//   spec.md        T2 brief: intended behavior, goals and constraints, kept current
//   tickets/       outcome, scope and dependencies (frontmatter); the monorepo's replacement for issues
//   progress.json  current state only, written by this script: gates, next step, blockers, and per ticket
//                  status, todo, verification, PRs and issues. Old states live in git history, not in the file.
//
// env: DT_DIR (default ~/.pi/agent/dt)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { otherCheckoutSessions } from "./checkout-sessions.mjs";

const HOME = os.homedir();
const DT_DIR = process.env.DT_DIR || path.join(HOME, ".pi", "agent", "dt");
const CONFIG_PATH = path.join(DT_DIR, "config.json");
const STATUSES = ["todo", "in_progress", "review", "done"];
const MAX_TEXT = 400;   // per progress string: details belong in the PR, the spec or the ticket
const MAX_ITEMS = 12;   // per progress list

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };
const flag = (name) => process.argv.includes(name);
const opt = (name, def) => { const i = process.argv.indexOf(name); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def; };
const opts = (name) => { const a = process.argv, out = []; for (let i = 0; i < a.length - 1; i++) if (a[i] === name) out.push(a[i + 1]); return out; };
const expand = (p) => path.resolve(p.replace(/^~(?=$|\/)/, HOME));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const now = () => new Date().toISOString().slice(0, 16) + "Z";
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

export const requiresJira = (key) => ["csscompany-enterprise/monorepo", "csscompany-enterprise/ottercam"].includes(key.toLowerCase());
export function jiraKey(value) {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(key)) fail("use a Jira key such as OV-777");
  return key;
}
export function requireEpic(ctx, slug, tier) {
  const feature = readJson(P(ctx, slug).feature);
  if ((tier || feature.tier || "T2") !== "T2") return null;
  const epic = feature.epic;
  if (requiresJira(ctx.key) && !epic) fail("Ask for the feature's Jira epic, then save it with dt.mjs epic <slug> --key KEY before proposing scope");
  return epic ? jiraKey(epic) : null;
}
export function jiraBranch(key, title) {
  const slug = String(title).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) fail("ticket title needs a branch slug");
  return `${jiraKey(key).toLowerCase().replace(/-/g, "_")}_${slug}`;
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
    jiraRequired: requiresJira(key),
    featuresInRepo: modality !== "monorepo",
    // standalone: always the main checkout's copy, so every lane worktree shares one progress.json
    featuresBase: modality === "monorepo" ? path.join(DT_DIR, "features", key) : path.join(mainRoot, "docs", "features"),
  };
}

const P = (ctx, slug) => {
  if (!/^[\w][\w.-]*$/.test(slug || "") || slug.includes("..")) fail(`invalid feature slug ${JSON.stringify(slug)}`);
  const dir = path.join(ctx.featuresBase, slug);
  return { dir, spec: path.join(dir, "spec.md"), tickets: path.join(dir, "tickets"), feature: path.join(dir, "feature.json"),
    progress: path.join(dir, "progress.json") };
};
function mustFeature(ctx, slug) {
  const p = P(ctx, slug);
  if (!fs.existsSync(p.feature)) fail(`no feature ${slug} in ${ctx.featuresBase} (run /dt-start, then /dt-approve plan)`);
  return p;
}
function readJson(f, def = {}) {
  if (!fs.existsSync(f)) return def;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail(`cannot parse ${f}: ${e.message}`); }
}
function writeJson(f, v) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n");
  fs.renameSync(tmp, f);
}

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

// ---------- tickets ----------
const pad = (x) => String(x).padStart(2, "0");
function loadTickets(ctx, slug) {
  const p = P(ctx, slug);
  if (!fs.existsSync(p.tickets)) return [];
  return fs.readdirSync(p.tickets).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const file = path.join(p.tickets, f);
    const { data } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    const list = (k) => (Array.isArray(data[k]) ? data[k] : data[k] ? [data[k]] : []);
    return { id: pad(data.id || f.slice(0, 2)), file, title: data.title || f.replace(/\.md$/, ""), kind: data.kind || "AFK",
      blocked_by: list("blocked_by").map(pad), touches: list("touches"), unsafe_with: list("unsafe_with").map(pad),
      verify: data.verify || "" };
  });
}
const findTicket = (tickets, id) => tickets.find((t) => t.id === pad(id)) || fail(`no ticket ${pad(id)}`);

// ---------- progress.json: current state only ----------
const ticketDefaults = () => ({ claim: null, status: "todo", next: "", blockers: [], todo: [], verification: "", branch: "", prs: [], issues: [], updated: "" });
export function emptyProgress() {
  return { version: 1, updated: "", next: "", blockers: [], todo: [], gates: {}, issues: [], tickets: {} };
}
export function migrateTicketLocations(raw = {}) {
  return { ...raw, tickets: Object.fromEntries(Object.entries(raw.tickets || {}).map(([id, t]) => {
    const { lane, ...saved } = t;
    if (!saved.worktree && typeof lane === "string" && path.isAbsolute(lane)) saved.worktree = lane;
    return [id, saved];
  })) };
}
export function normalizeProgress(raw = {}) {
  raw = migrateTicketLocations(raw);
  const { drift, ...rest } = raw;   // the retired drift counter is dropped on the next save
  const prog = { ...emptyProgress(), ...rest, gates: { ...(raw.gates || {}) } };
  for (const k of ["blockers", "todo", "issues"]) if (!Array.isArray(prog[k])) prog[k] = [];
  prog.tickets = Object.fromEntries(Object.entries(raw.tickets || {}).map(([id, t]) => [pad(id), { ...ticketDefaults(), ...t }]));
  return prog;
}
const isEmpty = (v) => v === "" || v == null || (Array.isArray(v) && !v.length);
export function compactProgress(prog) {
  const tickets = {};
  for (const id of Object.keys(prog.tickets).sort()) {
    const t = Object.fromEntries(Object.entries(prog.tickets[id]).filter(([, v]) => !isEmpty(v)));
    if (Object.keys(t).some((k) => k !== "updated" && !(k === "status" && t.status === "todo"))) tickets[id] = t;
  }
  const out = { version: 1, updated: prog.updated, next: prog.next, blockers: prog.blockers, todo: prog.todo, gates: prog.gates, issues: prog.issues, tickets };
  return Object.fromEntries(Object.entries(out).filter(([k, v]) => ["version", "updated", "gates", "tickets"].includes(k) || !isEmpty(v)));
}
export const ticketOf = (prog, id) => (prog.tickets[pad(id)] ||= ticketDefaults());

const loadProgress = (ctx, slug) => normalizeProgress(readJson(P(ctx, slug).progress));

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withLock(file, fn) {
  const lock = `${file}.lock`;   // a directory: atomic to create, and never committed by git
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > deadline) fail(`${lock} is held by another dt.mjs; remove it if none is running`);
      sleep(50);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

// the only writer of progress.json: read, change, write atomically under a lock (two lanes share the file)
function updateProgress(ctx, slug, mutate, { touch = true } = {}) {
  const p = mustFeature(ctx, slug);
  if (DRY) { const prog = loadProgress(ctx, slug); mutate(prog); return prog; }
  return withLock(p.progress, () => {
    const prog = loadProgress(ctx, slug);
    if (mutate(prog) === false) return prog;
    if (touch) prog.updated = now();
    writeJson(p.progress, compactProgress(prog));
    return prog;
  });
}

function commitFeaturesRepo(ctx, slug, msg) {
  if (ctx.featuresInRepo || DRY) return;
  const base = path.join(DT_DIR, "features");
  if (!fs.existsSync(path.join(base, ".git"))) git(["init", "-q"], { cwd: base });
  const rel = path.relative(base, P(ctx, slug).dir);
  const paths = ["feature.json", "spec.md", "tickets", "progress.json"].map((f) => path.join(rel, f)).filter((f) => fs.existsSync(path.join(base, f)));
  if (!paths.length) return;
  git(["add", "-A", "--", ...paths], { cwd: base, soft: true });
  git(["commit", "-qm", msg, "--", ...paths], { cwd: base, soft: true });
}

function cmdMigrateProgress(ctx, slug) {
  const p = mustFeature(ctx, slug);
  withLock(p.progress, () => {
    const raw = readJson(p.progress);
    const migrated = migrateTicketLocations(raw);
    if (JSON.stringify(raw) === JSON.stringify(migrated)) { console.log(`already migrated: ${p.progress}`); return; }
    if (!DRY) writeJson(p.progress, migrated);
    console.log(`${DRY ? "would migrate" : "migrated"}: ${p.progress}`);
  });
}

// ---------- refs: PRs and issues ----------
export function parsePrRef(s) {
  const m = String(s).trim().match(/^(?:#?(\d+)|https?:\/\/\S+\/pull\/(\d+)\/?)$/);
  if (!m) fail(`not a PR number or URL: ${s}`);
  return { number: +(m[1] || m[2]), ...(m[2] ? { url: String(s).trim().replace(/\/$/, "") } : {}) };
}
export function parseIssue(s) {
  s = String(s).trim();
  const kv = s.match(/^([^=\s]+)=(https?:\/\/\S+)$/);
  if (kv) return { ref: kv[1], url: kv[2] };
  if (/^https?:\/\//.test(s)) {
    const gh = s.match(/\/issues\/(\d+)\/?$/);
    return { ref: gh ? `#${gh[1]}` : s.replace(/\/+$/, "").split("/").pop(), url: s };
  }
  return { ref: /^\d+$/.test(s) ? `#${s}` : s };
}
const isGithubIssue = (i) => /^#\d+$/.test(i.ref) || /github\.com\/.+\/issues\/\d+/.test(i.url || "");
function upsert(list, item, key) {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
}

function ghJson(ctx, args) {
  const out = sh("gh", args, { cwd: ctx.root, soft: true });
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}
function ghPr(ctx, ref) {
  const j = ghJson(ctx, ["pr", "view", String(ref), "--json", "number,url,state,isDraft,headRefName,baseRefName"]);
  if (!j) return null;
  const state = j.state === "MERGED" ? "merged" : j.state === "CLOSED" ? "closed" : j.isDraft ? "draft" : "open";
  return { number: j.number, url: j.url, branch: j.headRefName, base: j.baseRefName, state, checked: now() };
}
function ghIssue(ctx, issue) {
  const j = ghJson(ctx, ["issue", "view", issue.url || issue.ref.replace(/^#/, ""), "--json", "state,url"]);
  return j ? { ref: issue.ref, url: j.url, state: String(j.state).toLowerCase(), checked: now() } : null;
}

// network outside the lock; results are merged into a fresh read
function observe(ctx, prog) {
  const prs = new Map(), issues = new Map();
  const seeIssue = (i) => { if (isGithubIssue(i) && i.state !== "closed" && !issues.has(i.ref)) issues.set(i.ref, ghIssue(ctx, i)); };
  for (const t of Object.values(prog.tickets)) {
    if (t.status === "done") continue;
    for (const pr of t.prs) if (!prs.has(pr.number) && !(["merged", "closed"].includes(pr.state) && pr.checked)) prs.set(pr.number, ghPr(ctx, pr.url || pr.number));
    t.issues.forEach(seeIssue);
  }
  prog.issues.forEach(seeIssue);
  return { prs, issues };
}
function applyObserved(prog, { prs, issues }) {
  let changed = false;
  const pr = (x) => { const o = prs.get(x.number); if (!o) return x; changed = true; return { ...x, ...o }; };
  const is = (x) => { const o = issues.get(x.ref); if (!o) return x; changed = true; return { ...x, ...o }; };
  for (const t of Object.values(prog.tickets)) { t.prs = t.prs.map(pr); t.issues = t.issues.map(is); }
  prog.issues = prog.issues.map(is);
  return changed;
}

// ---------- pure logic ----------
export function deriveStatuses(tickets, prog) {
  const st = {};
  for (const t of tickets) {
    const e = prog.tickets[t.id];
    const status = STATUSES.includes(e?.status) ? e.status : "todo";
    const prs = e?.prs || [];
    const note = status !== "done" && prs.length && prs.every((x) => x.state === "merged") ? "PRs merged: run /dt-check-merged" : "";
    st[t.id] = { status, note, blocked: false };
  }
  for (const t of tickets) st[t.id].blocked = st[t.id].status === "todo" && !t.blocked_by.every((b) => st[b]?.status === "done");
  return st;
}

export function pickReady(tickets, st, wanted) {
  const inFlight = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status));
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

const cell = (t, s, laneOf) => [`${t.id} ${t.title}`, s.blocked ? "🔒" : "", t.kind === "HITL" ? "HITL" : "", laneOf[t.id] || "", s.note].filter(Boolean).join(" · ");
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

// G0 records that the project exists; G2 is the plan (brief + tickets). G1 and G4 are retired.
const GATE_ICON = { approved: "✅", pending: "⏳", changes: "🔁" };
export function gateLine(prog) {
  return `Plan ${GATE_ICON[prog.gates.G2?.state] || "–"}`;
}

export function phaseOf(prog, { tickets, st }) {
  const g = prog.gates.G2?.state;
  if (g !== "approved") return `planning${g === "pending" ? ": plan approval pending" : g === "changes" ? ": plan changes requested" : ""}`;
  if (tickets.length && tickets.every((t) => st[t.id].status === "done")) return "done";
  return "build";
}

// what the state implies, used when nobody recorded a next step
export function suggestNext({ slug, prog, tickets, st }) {
  const g = prog.gates.G2?.state;
  if (g === "pending") return "/dt-approve plan";
  if (g !== "approved" || !tickets.length) return `/dt-revise ${slug}`;
  const merged = tickets.find((t) => st[t.id].note);
  if (merged) return "/dt-check-merged";
  try { pickReady(tickets, st); return `/dt-lane ${slug}`; } catch { /* no spare runnable work */ }
  const review = tickets.find((t) => st[t.id].status === "review");
  if (review) return `/dt-review ${slug} ${review.id}`;
  const allDone = tickets.length && tickets.every((t) => st[t.id].status === "done");
  return allDone ? "feature complete" : `/dt-lane ${slug}`;
}

export function ago(s, nowMs = Date.now()) {
  if (!s) return "never";
  const t = Date.parse(/T/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return s;
  const m = Math.round((nowMs - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
const statusOnly = (value) => /^\s*\/dt-status(?:\s|$)/.test(value || "");
// Retired drift handovers in old progress files never route a session.
const advisoryDrift = (value) => /^\s*(?:\/dt-drift(?:\s|$)|\/dt-approve\s+drift(?:\s|$)|(?:Gate\s*4|G4|Architecture drift)\b)/i.test(value || "");
const prLabel = (x) => `#${x.number}${x.state ? ` ${x.state}` : ""}`;
const issueLabel = (x) => `${x.ref}${x.state ? ` ${x.state}` : ""}`;
function checkedLabel(prs, nowMs) {
  const times = prs.map((x) => x.checked);
  if (times.some((x) => !x)) return " (not checked)";
  return ` (checked ${ago(times.sort()[0], nowMs)})`;
}

export function renderBrief({ slug, feature, prog, tickets, st, phase, lanes = [], next, suggested, refreshFailed = 0, nowMs = Date.now() }) {
  const lines = [`**${slug}** · ${[feature.tier, feature.type].filter(Boolean).join(" ")} · ${phase} · saved ${ago(prog.updated, nowMs)}`,
    `- Gates: ${gateLine(prog)}`];
  const inFlight = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status));
  if (tickets.length) {
    const done = tickets.filter((t) => st[t.id].status === "done").length;
    const ready = tickets.filter((t) => st[t.id].status === "todo" && !st[t.id].blocked).map((t) => t.id);
    lines.push(`- Board: ${done}/${tickets.length} done · in flight ${inFlight.length}${inFlight.length ? ` (${inFlight.map((t) => `${t.id} ${st[t.id].status}`).join(", ")})` : ""} · ready: ${ready.slice(0, 6).join(", ") || "none"}`);
  }
  if (lanes.length) lines.push(`- Lanes: ${lanes.join(" · ")}`);
  for (const t of inFlight) {
    const e = prog.tickets[t.id] || ticketDefaults();
    lines.push(`- **${t.id}** ${t.title} · ${[st[t.id].status, e.worktree, st[t.id].note].filter(Boolean).join(" · ")}`);
    if (e.claim) lines.push(`  - Claim: ${e.claim.owner} · ${e.claim.checkout} · acquired ${e.claim.acquired}`);
    if (e.prs.length) lines.push(`  - PRs: ${e.prs.map(prLabel).join(" · ")}${checkedLabel(e.prs, nowMs)}`);
    if (e.issues.length) lines.push(`  - Issues: ${e.issues.map(issueLabel).join(" · ")}`);
    if (e.verification) lines.push(`  - Verified: ${e.verification}`);
    if (e.blockers.length) lines.push(`  - Blockers: ${e.blockers.join(" · ")}`);
    if (e.todo.length) lines.push(`  - Todo: ${e.todo.join(" · ")}`);
    if (e.next && !statusOnly(e.next) && !next.endsWith(e.next)) lines.push(`  - Next: ${e.next}`);
  }
  if (prog.issues.length) lines.push(`- Issues: ${prog.issues.map(issueLabel).join(" · ")}`);
  if (prog.blockers.length) lines.push(`- Blockers: ${prog.blockers.join(" · ")}`);
  if (prog.todo.length) lines.push(`- Todo: ${prog.todo.join(" · ")}`);
  if (refreshFailed) lines.push(`- ⚠ ${refreshFailed} PR/issue refresh${refreshFailed === 1 ? "" : "es"} failed (gh): showing the last saved state`);
  lines.push(`- **Next:** ${next}`);
  if (suggested && suggested !== next) lines.push(`- Suggested from state: ${suggested.startsWith("/") ? `\`${suggested}\`` : suggested}`);
  return lines.join("\n");
}

export function resumeInstructions({ slug, dir, next, modality }) {
  const where = modality === "monorepo"
    ? "Ticket work runs in one of the configured lane clones (`node ~/.pi/agent/dt/dt.mjs info` says whether this checkout is one)."
    : "T2 ticket work runs in the ticket's worktree (`../<repo>.lane-<id>`); T0/T1 tickets, planning and reviews run from the main checkout.";
  return [`Resume the dev-turbo feature "${slug}" from the brief above. This session has no other memory of it: the feature folder is the source of truth (${dir}: feature.json, spec.md, tickets/, progress.json).`,
    "",
    `1. Next step: ${next}`,
    `2. ${where} If this is the wrong checkout, tell me where to open pi and stop.`,
    "3. If the step belongs to a workflow command (/dt-lane, /dt-review, /dt-revise), read its template in ~/.pi/agent/prompts/ first and follow its rules. Read only what the step needs: the ticket, the spec sections it names, the code it touches; never every ticket.",
    `4. Before you stop, hand over, or ask me to approve anything, save the current state with \`node ~/.pi/agent/dt/dt.mjs progress ${slug} [--ticket ID] ...\` (it replaces the old state; never edit progress.json by hand).`].join("\n");
}

// ---------- reading a feature ----------
function laneInfo(ctx, slug) {
  const prefix = `ticket/${slug}-`, laneOf = {}, labels = [];
  const saved = loadProgress(ctx, slug).tickets;
  const tag = (b, label) => {
    if (!b) return;
    const id = Object.entries(saved).find(([, t]) => t.branch === b)?.[0] || (b.startsWith(prefix) ? b.slice(prefix.length) : "");
    if (/^\d+$/.test(id)) laneOf[pad(id)] = label;
  };
  if (ctx.modality === "monorepo") ctx.lanes.forEach((dir, i) => {
    const b = git(["branch", "--show-current"], { cwd: dir, soft: true });
    tag(b, `lane ${i + 1}`);
    labels.push(`lane ${i + 1}${i === ctx.laneIndex ? " (here)" : ""}: ${b || "?"}`);
  });
  else {
    let dir = "";
    for (const line of (git(["worktree", "list", "--porcelain"], { cwd: ctx.mainRoot, soft: true }) || "").split("\n")) {
      if (line.startsWith("worktree ")) dir = line.slice(9);
      else if (line.startsWith("branch refs/heads/")) tag(line.slice("branch refs/heads/".length), path.basename(dir));
    }
  }
  return { laneOf, labels };
}

// T0/T1 projects approved before the plan gate existed only recorded G0: that approval covered their single ticket.
export function legacyQuickPlan(feature, prog) {
  if ((feature.tier || "T2") !== "T2" && prog.gates.G0?.state === "approved" && !prog.gates.G2) prog.gates.G2 = prog.gates.G0;
  return prog;
}

function collect(ctx, slug, { gh = true } = {}) {
  const p = mustFeature(ctx, slug);
  const feature = readJson(p.feature);
  const tickets = loadTickets(ctx, slug);
  let prog = loadProgress(ctx, slug);
  let refreshFailed = 0;
  if (gh && !DRY) {
    const obs = observe(ctx, prog);
    refreshFailed = [...obs.prs.values(), ...obs.issues.values()].filter((v) => !v).length;
    // observed facts do not count as a saved step: "updated" stays the time of the last checkpoint
    if (obs.prs.size || obs.issues.size) prog = updateProgress(ctx, slug, (fresh) => applyObserved(fresh, obs), { touch: false });
  }
  legacyQuickPlan(feature, prog);
  const st = deriveStatuses(tickets, prog);
  const hasSpec = fs.existsSync(p.spec);
  return { p, feature, tickets, prog, st, refreshFailed, hasSpec, phase: phaseOf(prog, { tickets, st }) };
}

function nextOf(slug, d) {
  const suggested = suggestNext({ slug, ...d });
  const inFlight = d.tickets.filter((t) => ["in_progress", "review"].includes(d.st[t.id].status));
  const ticketNext = inFlight.map((t) => {
    const n = d.prog.tickets[t.id]?.next;
    return n && !statusOnly(n) && !advisoryDrift(n) && (n.startsWith("/") ? n : `${t.id}: ${n}`);
  }).find(Boolean);
  return { next: (!statusOnly(d.prog.next) && !advisoryDrift(d.prog.next) && d.prog.next) || ticketNext || suggested, suggested };
}

// Read-only snapshot for the /dt-status extension. No observers, writers or lane actions.
export function readFeatureStatus(ctx, slug) {
  const p = mustFeature(ctx, slug);
  if (!fs.existsSync(p.progress)) fail(`missing ${p.progress}: cannot report saved ticket completion`);
  const d = collect(ctx, slug, { gh: false });
  return { ...d, ...nextOf(slug, d) };
}

function listFeatures(ctx) {
  if (!fs.existsSync(ctx.featuresBase)) return [];
  return fs.readdirSync(ctx.featuresBase).filter((s) => fs.existsSync(path.join(ctx.featuresBase, s, "feature.json"))).map((slug) => {
    try {
      const d = collect(ctx, slug, { gh: false });
      const { next } = nextOf(slug, d);
      const done = d.tickets.filter((t) => d.st[t.id].status === "done").length;
      const board = d.tickets.length ? ` · ${done}/${d.tickets.length} done` : "";
      return { slug, tier: d.feature.tier || "", type: d.feature.type || "", phase: d.phase, next, updated: d.prog.updated,
        label: `${slug} · ${d.phase}${board} · ${ago(d.prog.updated)} · next: ${next}` };
    } catch (e) {
      return { slug, error: e.message, updated: "", label: `${slug} · unreadable: ${e.message}` };
    }
  }).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// ---------- commands ----------
function cmdInfo(ctx) {
  if (flag("--json")) return console.log(JSON.stringify(ctx, null, 2));
  const lines = [`repo: ${ctx.key}`, `modality: ${ctx.modality}`, `root: ${ctx.root}${ctx.isWorktree ? " (worktree)" : ""}`, `main: ${ctx.main}`, `branch: ${ctx.branch || "(detached)"}`];
  if (ctx.modality === "monorepo") lines.push(`lane: ${ctx.laneIndex >= 0 ? `${ctx.laneIndex + 1} of ${ctx.lanes.length}` : "NOT a configured lane"}`, `lanes: ${ctx.lanes.join(" | ") || "(none configured)"}`);
  lines.push(`features: ${ctx.featuresBase}${ctx.featuresInRepo ? " (main checkout, committed)" : " (outside the repo, shared by the lanes)"}`,
    `checks: ${ctx.checks || "(unset: ask once, then `dt.mjs config set checks \"<cmd>\"`)"}`);
  console.log(lines.join("\n"));
}

function cmdEpic(ctx, slug) {
  const p = P(ctx, slug), key = jiraKey(opt("--key"));
  fs.mkdirSync(p.dir, { recursive: true });
  withLock(p.feature, () => {
    const feature = readJson(p.feature);
    if (feature.epic && feature.epic !== key && Object.values(loadProgress(ctx, slug).tickets).some((t) => t.jira)) fail("cannot change epic after Jira tickets are linked");
    if (!DRY) writeJson(p.feature, { slug, ...feature, epic: key });
  });
  commitFeaturesRepo(ctx, slug, `dt: epic ${slug} ${key}`);
  console.log(`${DRY ? "would save" : "saved"} epic ${key} in ${p.feature}; no approval recorded`);
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

function cmdResume(ctx, slug) {
  if (!slug) {
    const list = listFeatures(ctx);
    if (flag("--json")) return console.log(JSON.stringify(list, null, 2));
    if (!list.length) return console.log(`no features in ${ctx.featuresBase}`);
    return console.log(`${list.map((f) => f.label).join("\n")}\n\nbrief: dt.mjs resume <slug>`);
  }
  const d = collect(ctx, slug, { gh: !flag("--no-gh") });
  const { next, suggested } = nextOf(slug, d);
  const brief = renderBrief({ slug, ...d, lanes: laneInfo(ctx, slug).labels, next, suggested });
  const instructions = resumeInstructions({ slug, dir: d.p.dir, next, modality: ctx.modality });
  if (flag("--json")) console.log(JSON.stringify({ slug, dir: d.p.dir, phase: d.phase, next, suggested, brief, instructions }, null, 2));
  else if (flag("--prompt")) console.log(`${brief}\n\n${instructions}`);
  else console.log(brief);
}

const PROGRESS_UPDATES = ["--release-claim", "--next", "--blocker", "--no-blockers", "--todo", "--no-todo", "--verification", "--status", "--branch", "--worktree", "--pr", "--remove-pr", "--issue", "--remove-issue", "--jira-key", "--jira-description-file"];
function checkText(name, v) {
  v = String(v ?? "").trim();
  if (v.length > MAX_TEXT) fail(`${name} is ${v.length} characters; keep it under ${MAX_TEXT} (details belong in the PR, the spec or the ticket)`);
  return v;
}
function checkList(name, values) {
  if (values.length > MAX_ITEMS) fail(`${values.length} ${name} items; keep at most ${MAX_ITEMS}`);
  return values.map((v) => checkText(name, v)).filter(Boolean);
}

function cmdProgress(ctx, slug) {
  mustFeature(ctx, slug);
  const id = opt("--ticket") ? pad(opt("--ticket")) : null;
  if (id) findTicket(loadTickets(ctx, slug), id);
  if (flag("--lane")) fail("--lane was removed; use --worktree PATH only for standalone worktrees");
  if (!PROGRESS_UPDATES.some(flag)) {
    const prog = compactProgress(loadProgress(ctx, slug));
    return console.log(JSON.stringify(id ? { ticket: id, ...(prog.tickets[id] || { status: "todo" }) } : prog, null, 2));
  }
  if (!id && ["--verification", "--status", "--branch", "--worktree", "--pr", "--remove-pr"].some(flag)) fail("--verification, --status, --branch, --worktree and --pr need --ticket ID");
  const status = opt("--status");
  if (status && !STATUSES.includes(status)) fail(`--status must be one of ${STATUSES.join(", ")}`);
  const next = flag("--next") ? checkText("next", opt("--next", "")) : null;
  const blockers = flag("--no-blockers") ? [] : opts("--blocker").length ? checkList("blocker", opts("--blocker")) : null;
  const todo = flag("--no-todo") ? [] : opts("--todo").length ? checkList("todo", opts("--todo")) : null;
  const verification = flag("--verification") ? checkText("verification", opt("--verification", "")) : null;
  const useGh = !flag("--no-gh") && !DRY;
  const prs = opts("--pr").map((ref) => { const parsed = parsePrRef(ref); return (useGh && ghPr(ctx, parsed.url || parsed.number)) || parsed; });
  const issues = opts("--issue").map(parseIssue);
  let jira = null;
  if (flag("--jira-key") || flag("--jira-description-file")) {
    if (!id) fail("Jira metadata needs --ticket ID");
    const epic = requireEpic(ctx, slug) || fail("save the feature epic first");
    const title = findTicket(loadTickets(ctx, slug), id).title;
    const description = fs.readFileSync(opt("--jira-description-file") || fail("--jira-key needs --jira-description-file"), "utf8").trim();
    const lines = description.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 3 || lines.length > 5 || lines.some((line) => !/^[-*] \S/.test(line) || line.length > MAX_TEXT)) fail("Jira description must be 3 to 5 short bullet points");
    jira = { key: jiraKey(opt("--jira-key")), epic, title, description };
  }
  const prog = updateProgress(ctx, slug, (prog) => {
    const e = id ? ticketOf(prog, id) : prog;
    if (id) assertClaim(e, opt("--owner"));
    if (jira) {
      if (!e.claim || e.claim.owner !== opt("--owner")) fail("claim the ticket with next --claim-only before saving Jira metadata");
      if (e.jira && e.jira.key !== jira.key) fail("a Jira ticket is already saved; reuse it instead of creating a duplicate");
      e.jira = jira;
      upsert(e.issues, { ref: jira.key }, "ref");
    }
    if (flag("--release-claim")) {
      if (!opt("--owner")) fail("--release-claim needs --owner");
      if (id) e.claim = null;
      else for (const saved of Object.values(prog.tickets)) if (saved.claim?.owner === opt("--owner")) saved.claim = null;
    }
    if (next !== null) e.next = next;
    if (blockers) e.blockers = blockers;
    if (todo) e.todo = todo;
    for (const i of issues) upsert(e.issues, i, "ref");
    for (const ref of opts("--remove-issue")) e.issues = e.issues.filter((x) => x.ref !== parseIssue(ref).ref);
    if (id) {
      if (verification !== null) e.verification = verification;
      if (status) e.status = status;
      if (flag("--branch")) e.branch = checkText("branch", opt("--branch", ""));
      if (flag("--worktree")) {
        if (ctx.modality !== "standalone") fail("--worktree is only for standalone repos");
        const worktree = checkText("worktree", opt("--worktree", ""));
        if (worktree && !path.isAbsolute(worktree)) fail("--worktree needs an absolute path");
        if (worktree) e.worktree = worktree;
        else delete e.worktree;
      }
      for (const x of prs) upsert(e.prs, x, "number");
      for (const ref of opts("--remove-pr")) e.prs = e.prs.filter((x) => x.number !== parsePrRef(ref).number);
      if (e.prs.length > MAX_ITEMS || e.issues.length > MAX_ITEMS) fail(`keep at most ${MAX_ITEMS} PRs and issues per ticket`);
      e.updated = now();
    }
  });
  commitFeaturesRepo(ctx, slug, `dt: progress ${slug}${id ? ` ticket ${id}` : ""}`);
  const shown = compactProgress(prog);
  console.log(`${DRY ? "(dry-run) would save" : "saved"} ${id ? `ticket ${id}` : "feature"} progress for ${slug}:\n${JSON.stringify(id ? shown.tickets[id] || { status: "todo" } : { next: shown.next, blockers: shown.blockers, todo: shown.todo, issues: shown.issues }, null, 2)}`);
}

function cmdStatus(ctx, slug) {
  const d = collect(ctx, slug, { gh: !flag("--no-gh") });
  const { laneOf } = laneInfo(ctx, slug);
  const unsafe = pairs(d.tickets);
  console.log([`${slug}: ${d.phase} · ${gateLine(d.prog)}`, "", d.tickets.length ? kanbanTable(d.tickets, d.st, laneOf) : "no tickets yet", "",
    ...(d.tickets.length ? ["```mermaid", dagMermaid(d.tickets, d.st), "```", ""] : []),
    `pairs that must not run together: ${unsafe.length ? "\n  " + unsafe.join("\n  ") : "none"}`].join("\n"));
}

function ticketState(e) {
  if (!e) return "";
  const lines = [];
  if (e.claim) lines.push(`  claim: ${e.claim.owner} in ${e.claim.checkout}`);
  if (e.verification) lines.push(`  verified: ${e.verification}`);
  if (e.blockers?.length) lines.push(`  blockers: ${e.blockers.join(" · ")}`);
  if (e.todo?.length) lines.push(`  todo: ${e.todo.join(" · ")}`);
  if (e.prs?.length) lines.push(`  PRs: ${e.prs.map(prLabel).join(" · ")}`);
  if (e.next) lines.push(`  next: ${e.next}`);
  return lines.length ? `\nsaved state (${ago(e.updated)}):\n${lines.join("\n")}` : "";
}
function describe(ctx, slug, t, where) {
  return [`ticket ${t.id} "${t.title}" (${t.kind}) ${where}`, `  ticket: ${t.file}`, `  touches: ${t.touches.join(", ") || "(none listed)"}`,
    `  overlay: ${path.join(DT_DIR, "overlays", `${t.verify || "service"}.md`)}`, `  checks: ${ctx.checks || "(unset)"}`,
    `  progress: dt.mjs progress ${slug} --ticket ${t.id} ...`].join("\n");
}

// Feature docs kept in the repo are workflow state, not code: they never block branching.
function dirty(ctx) {
  const rel = ctx.featuresInRepo ? path.relative(ctx.root, ctx.featuresBase) : "";
  const exclude = rel && !rel.startsWith("..") ? [`:(exclude)${rel}`] : [];
  return git(["status", "--porcelain", "--", ".", ...exclude], { cwd: ctx.root });
}

function assertClaim(saved, owner) {
  if (saved?.claim && saved.claim.owner !== owner) fail(`ticket claimed by ${saved.claim.owner} in ${saved.claim.checkout}; use /dt-lane <id> force there only after checking the previous agent is gone`);
}

function cmdNext(ctx, slug) {
  mustFeature(ctx, slug);
  const wanted = opt("--ticket"), owner = opt("--owner");
  if (!owner && !DRY) fail("next needs --owner <session ID>; /dt-lane supplies it");
  if (flag("--force") && !wanted) fail("--force needs an explicit --ticket ID");
  const cur = ctx.branch.match(new RegExp(`^ticket/${esc(slug)}-(\\d+)$`));
  const lane = ctx.modality === "monorepo" && ctx.laneIndex >= 0 ? `lane ${ctx.laneIndex + 1}` : "";
  const d = collect(ctx, slug, { gh: false });
  if (!d.tickets.length) fail(`no tickets for ${slug} (run /dt-revise first)`);
  // T0/T1 is one ticket built in the current checkout, without a worktree or Jira ticket.
  const quick = (d.feature.tier || "T2") !== "T2";
  const jira = requiresJira(ctx.key) && !quick;
  const current = Object.entries(d.prog.tickets).find(([, t]) => t.branch && t.branch === ctx.branch)?.[0] || (cur && pad(cur[1]));
  const switching = current && d.st[current]?.status !== "done" && wanted && pad(wanted) !== current;
  if (switching && ctx.modality !== "monorepo") fail(`this checkout is on ticket ${current}'s branch; finish it or use another lane`);
  const savedWanted = wanted && d.prog.tickets[pad(wanted)];
  const resume = !switching && current && d.st[current]?.status !== "done" ? current : savedWanted?.branch && ["in_progress", "review"].includes(d.st[pad(wanted)]?.status) ? pad(wanted) : null;
  if (ctx.modality === "monorepo" && ctx.laneIndex < 0 && !quick) fail(`run this inside one of the configured lanes:\n  ${ctx.lanes.join("\n  ")}`);
  if (ctx.modality === "standalone" && ctx.isWorktree && !resume) fail("run this from the main checkout, not from a lane worktree");
  if ((!resume || switching || flag("--force")) && dirty(ctx)) fail("working tree is not clean");
  let t, previous, branch, where;
  const released = [];
  // Pick and reserve under the same lock, BEFORE any Git side effects.
  const reserved = updateProgress(ctx, slug, (prog) => {
    const st = deriveStatuses(d.tickets, prog);
    const pending = wanted && prog.tickets[pad(wanted)];
    t = resume ? findTicket(d.tickets, resume) : pending?.status === "in_progress" && !pending.branch ? findTicket(d.tickets, wanted) : pickReady(d.tickets, st, wanted);
    const e = ticketOf(prog, t.id);
    const real = (p) => fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
    const occupied = Object.entries(prog.tickets).filter(([id, saved]) => id !== t.id && saved.claim?.checkout && real(saved.claim.checkout) === real(ctx.root));
    if (occupied.length || switching) {
      if (!wanted || ctx.modality !== "monorepo") fail(`this checkout is claimed for ticket ${occupied[0]?.[0] || current}; finish it or use another lane`);
      if (dirty(ctx)) fail("working tree is not clean");
      let peers;
      try { peers = otherCheckoutSessions(ctx.root); }
      catch (error) { fail(`cannot verify no active session for this checkout: ${error.message}`); }
      if (peers.length) fail(`this checkout has another active session (PID ${peers.join(", ")}); stop it before switching tickets`);
      // Keep status, branch, evidence and handover intact; only move checkout ownership.
      for (const [id, saved] of occupied) {
        released.push([id, saved.claim]);
        saved.claim = null;
      }
    }
    previous = { ...e };
    if (e.prs?.length && e.prs.every((pr) => pr.state === "merged")) fail(`ticket ${t.id} PRs are merged: use /dt-check-merged, not /dt-lane`);
    const checkout = e.claim?.checkout || (ctx.modality === "standalone" ? e.worktree : "");
    if (checkout && (fs.existsSync(checkout) ? fs.realpathSync(checkout) : path.resolve(checkout)) !== fs.realpathSync(ctx.root)) fail(`ticket ${t.id} belongs to checkout ${checkout}; open pi there, or use /dt-lane here`);
    if (!flag("--force")) assertClaim(e, owner);
    // Legacy branch-only state still has to pass the dependency and conflict checks.
    if (e.status === "todo" || (!resume && e.status === "in_progress" && !e.branch)) pickReady(d.tickets, { ...st, [t.id]: { ...st[t.id], status: "todo" } }, t.id);
    if (jira) {
      const epic = !flag("--claim-only") || e.jira ? requireEpic(ctx, slug) : null;
      if (!flag("--claim-only") && !e.jira && !e.branch) fail("claim with next --claim-only, create/reuse a Jira ticket under the epic, then save --jira-key and --jira-description-file before branching");
      if (e.jira && e.jira.epic !== epic) fail("saved Jira ticket belongs to another epic");
    }
    branch = e.branch || (e.jira ? jiraBranch(e.jira.key, e.jira.title) : flag("--claim-only") ? "" : quick ? `quick/${slug}` : `ticket/${slug}-${t.id}`);
    where = ctx.modality === "standalone" && !quick ? e.worktree || (flag("--claim-only") || resume ? ctx.root : path.join(path.dirname(ctx.mainRoot), `${path.basename(ctx.mainRoot)}.lane-${t.id}`)) : ctx.root;
    if (ctx.modality === "standalone" && !quick && (ctx.isWorktree || (!resume && !flag("--claim-only")))) e.worktree = where;
    Object.assign(e, { status: e.status === "review" ? "review" : "in_progress", branch, claim: { owner: owner || "dry-run", checkout: ctx.root, acquired: now() }, updated: now() });
    if (!resume) e.next = flag("--claim-only") ? "create/reuse Jira ticket under the epic, save its metadata, then run next without --claim-only" : "write scenarios for the ticket's outcome and see them fail";
    if (flag("--claim-only") && !previous.branch) e.branch = "";
  });
  if (flag("--claim-only")) {
    commitFeaturesRepo(ctx, slug, `dt: claim ${slug} ticket ${t.id}`);
    console.log(`claimed (no branch created):\n${describe(ctx, slug, t, "")}\n${ticketState(reserved.tickets[t.id])}`);
    return;
  }
  try {
    if (resume) {
      if (ctx.branch !== branch) {
        if (dirty(ctx)) fail("working tree is not clean");
        run("git", ["switch", branch], { cwd: ctx.root });
      }
      console.log(`resume: already on ${branch}\n` + describe(ctx, slug, t, "") + ticketState(reserved.tickets[t.id]));
    } else {
      if (!flag("--no-fetch")) git(["fetch", "--quiet", "origin", ctx.main], { cwd: ctx.root, soft: true });
      if (ctx.modality === "monorepo" || quick) {
        run("git", ["switch", "-c", branch, `origin/${ctx.main}`], { cwd: ctx.root });
        run("git", ["push", "-u", "origin", branch], { cwd: ctx.root });
        console.log(describe(ctx, slug, t, `on ${branch}${lane ? ` (${lane})` : ""}`));
      } else {
        const rel = path.relative(ctx.root, P(ctx, slug).tickets);
        if (git(["cat-file", "-e", `origin/${ctx.main}:${rel}`], { cwd: ctx.root, soft: true }) === null) fail(`tickets are not on origin/${ctx.main} yet: commit and push ${rel} first`);
        if (fs.existsSync(where)) fail(`${where} already exists`);
        run("git", ["worktree", "add", "-b", branch, where, `origin/${ctx.main}`], { cwd: ctx.root });
        run("git", ["push", "-u", "origin", branch], { cwd: DRY ? ctx.root : where });
        // No agent works in the new worktree yet. Its /dt-lane call will claim it.
        updateProgress(ctx, slug, (prog) => { assertClaim(ticketOf(prog, t.id), owner); ticketOf(prog, t.id).claim = null; });
        console.log(describe(ctx, slug, t, `in worktree ${where}`) + `\n\nopen pi in ${where} and run: /dt-lane ${slug} ${t.id}`);
      }
    }
  } catch (error) {
    updateProgress(ctx, slug, (prog) => {
      const e = ticketOf(prog, t.id);
      assertClaim(e, owner);
      const created = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: ctx.root, soft: true }) !== null;
      if (!created || resume) {
        prog.tickets[t.id] = previous;
        for (const [id, claim] of released) ticketOf(prog, id).claim = claim;
      }
      else e.next = `setup interrupted: ${String(error.message).slice(0, 300)}; resume /dt-lane ${t.id}`;
    });
    throw error;
  }
  commitFeaturesRepo(ctx, slug, `dt: start ${slug} ticket ${t.id}`);
}

function issueNumber(url) { return +(url.match(/\/(\d+)\s*$/)?.[1] || 0); }

function createFeatureIssue(ctx, slug, p, prog) {
  const existing = prog.issues.find(isGithubIssue);
  if (existing) { console.log(`feature issue already exists: ${existing.ref}`); return null; }
  if (!fs.existsSync(p.spec)) fail(`no ${p.spec}`);
  const url = run("gh", ["issue", "create", "--title", `Feature: ${slug}`, "--body-file", p.spec], { cwd: ctx.root });
  if (DRY) return null;
  console.log(`feature issue: ${url}`);
  return { ref: `#${issueNumber(url)}`, url, state: "open" };
}

function createTicketIssues(ctx, slug, p, prog) {
  const tickets = loadTickets(ctx, slug);
  const created = {};
  const refOf = (t) => (created[t.id] || prog.tickets[t.id]?.issues.find(isGithubIssue))?.ref;
  for (const t of tickets) {
    if (refOf(t)) continue;
    const url = run("gh", ["issue", "create", "--title", `${slug} ${t.id}: ${t.title}`, "--body-file", t.file], { cwd: ctx.root });
    if (!DRY) created[t.id] = { ref: `#${issueNumber(url)}`, url, state: "open" };
  }
  const feature = prog.issues.find(isGithubIssue);
  if (feature && !DRY) {
    const tmp = path.join(os.tmpdir(), `dt-${slug}-feature.md`);
    fs.writeFileSync(tmp, fs.readFileSync(p.spec, "utf8") + "\n\n## Tickets\n\n" + tickets.map((t) => `- [ ] ${refOf(t) || ""} ${t.id} ${t.title}`).join("\n") + "\n");
    run("gh", ["issue", "edit", feature.ref.replace(/^#/, ""), "--body-file", tmp], { cwd: ctx.root });
  }
  console.log(`ticket issues: ${Object.keys(created).length} created${feature ? `, task list updated on ${feature.ref}` : ""}`);
  return created;
}

function afterMerge(ctx, slug, id) {
  if (ctx.modality !== "standalone") return;
  const saved = loadProgress(ctx, slug).tickets[pad(id)];
  const wt = saved?.worktree || path.join(path.dirname(ctx.mainRoot), `${path.basename(ctx.mainRoot)}.lane-${id}`);
  if (fs.existsSync(wt)) {
    const r = DRY ? "" : git(["worktree", "remove", wt], { cwd: ctx.mainRoot, soft: true });
    console.log(r === null ? `could not remove ${wt} (uncommitted changes?): remove it yourself with git worktree remove --force` : `removed worktree ${wt}`);
  }
  const branch = saved?.branch || `ticket/${slug}-${id}`;
  if (!DRY) git(["branch", "-D", branch], { cwd: ctx.mainRoot, soft: true });
}

const GATE_STATE = { approve: "approved", change: "changes", pending: "pending" };
// G0 creates the project and approves its first plan; G2 re-approves a revised plan; G3 closes a ticket.
function cmdGate(ctx, slug, n, decision) {
  n = +n;
  if (![0, 2, 3].includes(n)) fail("gate number must be 0 (project + plan), 2 (plan) or 3 (ticket); 1 and 4 are retired");
  if (!GATE_STATE[decision]) fail("decision must be approve, change or pending");
  const p = P(ctx, slug);
  const note = checkText("note", opt("--note", "")), ticket = opt("--ticket") ? pad(opt("--ticket")) : null;
  const requirePlan = (tier) => {
    if (!loadTickets(ctx, slug).length) fail(`no tickets in ${p.tickets}: write the plan before approving it`);
    if (tier === "T2" && !fs.existsSync(p.spec)) fail(`no ${p.spec}: T2 plans need a brief`);
  };
  if (n === 0) {
    const tier = opt("--tier"), type = opt("--type");
    if (!/^T[012]$/.test(tier || "") || !["web", "device", "service", "cli", "mixed"].includes(type || "")) fail("gate 0 needs --tier T0|T1|T2 and --type web|device|service|cli|mixed");
    if (decision !== "approve") return console.log(`G0 ${decision}: ${note || "(no note)"}; revise the plan in the grill`);
    requireEpic(ctx, slug, tier);
    requirePlan(tier);
    fs.mkdirSync(p.dir, { recursive: true });
    writeJson(p.feature, { created: now(), ...readJson(p.feature), slug, tier, type, modality: ctx.modality });
  }
  mustFeature(ctx, slug);
  const tier = readJson(p.feature).tier || "T2";
  if (n === 2 && decision === "approve") requirePlan(tier);
  if (n === 3) {
    if (!ticket) fail("gate 3 needs --ticket ID (the ticket being merged)");
    findTicket(loadTickets(ctx, slug), ticket);
  }
  // GitHub side effects first, outside the lock
  let featureIssue = null, ticketIssues = {};
  if (decision === "approve" && n !== 3 && tier === "T2" && ctx.modality === "standalone" && !requiresJira(ctx.key)) {
    featureIssue = createFeatureIssue(ctx, slug, p, loadProgress(ctx, slug));
    ticketIssues = createTicketIssues(ctx, slug, p, { ...loadProgress(ctx, slug), issues: featureIssue ? [featureIssue] : loadProgress(ctx, slug).issues });
  }
  const prog = updateProgress(ctx, slug, (prog) => {
    if (n === 3) {
      const e = ticketOf(prog, ticket);
      e.acceptance = { state: GATE_STATE[decision], at: now(), ...(note ? { note } : {}) };
      if (decision === "approve") Object.assign(e, { status: "done", claim: null, next: "", todo: [], blockers: [], updated: now() });
      else e.next = decision === "pending" ? `Gate 3: waiting for the merge decision${note ? ` (${note})` : ""}` : `Gate 3 changes requested: ${note || "see the review on the PR"}`;
    } else {
      const state = { state: GATE_STATE[decision], at: now(), ...(note ? { note } : {}) };
      if (n === 0) prog.gates.G0 = state;
      prog.gates.G2 = state;
    }
    if (featureIssue) upsert(prog.issues, featureIssue, "ref");
    for (const [id, issue] of Object.entries(ticketIssues)) upsert(ticketOf(prog, id).issues, issue, "ref");
    // approvals clear the feature's next step: the brief then derives it from the state
    prog.next = decision === "approve" ? "" : decision === "pending" ? (n === 3 ? `Gate 3: waiting for my decision${note ? ` (${note})` : ""}` : "/dt-approve plan") : `${n === 3 ? "Gate 3" : "Plan"} changes requested: ${note || "(no note)"}`;
  });
  const label = `G${n} ${decision}${ticket ? ` ticket ${ticket}` : ""}`;
  console.log(`${DRY ? "(dry-run) would record " : ""}${label}${DRY ? "" : ` recorded in ${p.progress}`}`);
  if (n === 3 && decision === "approve") afterMerge(ctx, slug, ticket);
  commitFeaturesRepo(ctx, slug, `dt: ${label} ${slug}`);
  if (decision === "approve") {
    const tickets = loadTickets(ctx, slug), st = deriveStatuses(tickets, prog);
    console.log(`next: ${suggestNext({ slug, feature: readJson(p.feature), prog, tickets, st })}`);
  }
}

export function ticketPrContent(ctx, slug, t, saved, body, tier = "T2") {
  // A T0/T1 task is a single ticket: its title stands alone unless a Jira key was saved.
  if (tier !== "T2" && !saved?.jira?.key) return { title: t.title, body };
  if (ctx.modality !== "monorepo") return { title: `${slug} ${t.id}: ${t.title}`, body };
  const issue = (saved?.issues || []).find((i) => /^[A-Z][A-Z0-9]*-[1-9]\d*$/i.test(i.ref)
    && (!saved?.jira?.key || i.ref.toUpperCase() === saved.jira.key.toUpperCase()));
  const key = String(saved?.jira?.key || issue?.ref || t.id).toUpperCase();
  const title = `${key}: ${t.title}`;
  const jiraUrl = saved?.jira?.url || issue?.url || (requiresJira(ctx.key) && key.includes("-") ? `https://csscompany.atlassian.net/browse/${key}` : null);
  if (key.includes("-") && !jiraUrl) fail("save the Jira ticket URL with progress --issue KEY=URL before opening the PR");
  if (jiraUrl && !body.includes(jiraUrl)) {
    if (!/^## Description\r?$/m.test(body)) fail("PR body needs ## Description for the Jira ticket URL");
    body = body.replace(/^(## Description)\r?\n?/m, `$1\n${jiraUrl}\n\n`);
  }
  return { title, body };
}

function cmdPr(ctx, slug, id) {
  const bodyFile = opt("--body-file");
  let title, body, head = ctx.branch, t = null;
  if (!head) fail("detached HEAD: switch to the branch to open a PR for");
  {
    if (!id) fail("usage: dt.mjs pr <slug> <ID> --body-file FILE");
    const p = mustFeature(ctx, slug);
    t = findTicket(loadTickets(ctx, slug), id);
    assertClaim(loadProgress(ctx, slug).tickets[t.id], opt("--owner"));
    const want = loadProgress(ctx, slug).tickets[t.id]?.branch || `ticket/${slug}-${t.id}`;
    if (head !== want) fail(`on ${head}, expected ${want}`);
    if (!bodyFile) fail("pr needs --body-file FILE: a short ## Description and ## Testing with unit tests + staging tests");
    const saved = loadProgress(ctx, slug).tickets[t.id];
    ({ title, body } = ticketPrContent(ctx, slug, t, saved, fs.readFileSync(bodyFile, "utf8"), readJson(p.feature).tier || "T2"));
    const closes = (saved?.issues || []).filter(isGithubIssue).map((i) => `Closes ${i.ref}`);
    body += closes.length ? `\n\n${closes.join("\n")}\n` : "";
  }
  const record = (url) => {
    if (!t || !url) return;
    const pr = ghPr(ctx, url) || { ...parsePrRef(url), branch: head, base: ctx.main, state: ctx.modality === "monorepo" ? "draft" : "open", checked: now() };
    updateProgress(ctx, slug, (prog) => {
      const e = ticketOf(prog, t.id);
      assertClaim(e, opt("--owner"));
      upsert(e.prs, pr, "number");
      Object.assign(e, { status: e.status === "done" ? "done" : "review", next: `/dt-review ${slug} ${t.id}`, updated: now() });
    });
    commitFeaturesRepo(ctx, slug, `dt: PR for ${slug} ticket ${t.id}`);
  };
  const existing = sh("gh", ["pr", "view", head, "--json", "url", "--jq", ".url"], { cwd: ctx.root, soft: true });
  if (existing) { record(existing); return console.log(`PR already open: ${existing}`); }
  run("git", ["push", "-u", "origin", head], { cwd: ctx.root });
  const tmp = path.join(os.tmpdir(), `dt-pr-${head.replace(/[^\w]+/g, "-")}.md`);
  fs.writeFileSync(tmp, body);
  const args = ["pr", "create", "--base", ctx.main, "--head", head, "--title", title, "--body-file", tmp];
  if (ctx.modality === "monorepo") args.push("--draft");
  const url = run("gh", args, { cwd: ctx.root });
  record(url);
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
  const tk = (id, blocked_by, touches, extra = {}) => ({ id, title: `t${id}`, kind: "AFK", blocked_by, touches, unsafe_with: [], verify: "service", file: "", ...extra });
  const tickets = [tk("00", [], ["core"]), tk("01", ["00"], ["api"]), tk("02", ["00"], ["api", "db"]), tk("03", ["00"], ["ui"], { unsafe_with: ["01"] }), tk("04", ["00"], ["ui"])];
  const prog = normalizeProgress({ gates: { G0: { state: "approved" }, G2: { state: "approved" } }, tickets: {
    0: { status: "done" }, "01": { status: "in_progress", next: "make it green" }, "02": { status: "review", prs: [{ number: 5, state: "merged", checked: "2025-10-31T10:00Z" }] } } });
  t("progress normalizes ids and defaults", prog.tickets["00"].status === "done" && Array.isArray(prog.tickets["01"].todo) && prog.blockers.length === 0);
  const compact = compactProgress({ ...prog, tickets: { ...prog.tickets, "04": { ...prog.tickets["01"], status: "todo", next: "", updated: "x" } } });
  t("progress compacts empty fields and idle tickets", !("04" in compact.tickets) && !("todo" in compact.tickets["01"]) && !("next" in compact) && compact.version === 1);
  const st = deriveStatuses(tickets, prog);
  t("status from progress", st["00"].status === "done" && st["01"].status === "in_progress" && st["02"].status === "review");
  t("merged PRs note", st["02"].note.startsWith("PRs merged"));
  t("status todo, unblocked", st["03"].status === "todo" && !st["03"].blocked);
  const st0 = deriveStatuses(tickets, normalizeProgress());
  t("blocked marker", st0["01"].blocked === true && st0["00"].blocked === false);
  t("pick lowest ready", pickReady(tickets, st0).id === "00");
  t("independent work stays ready with 2 in flight", pickReady(tickets, st).id === "04");
  const st1 = deriveStatuses(tickets, normalizeProgress({ tickets: { "00": { status: "done" }, "01": { status: "in_progress" } } }));
  t("skips module clash and unsafe pair", pickReady(tickets, st1).id === "04");
  t("explicit ticket with clash refused", throws(() => pickReady(tickets, st1, "2"), /touches api/));
  t("explicit ticket blocked refused", throws(() => pickReady(tickets, st0, "01"), /blocked by 00/));
  t("kanban header and cells", kanbanTable(tickets, st, { "01": "lane 1" }).split("\n")[0] === "| todo | in_progress | review | done |" && kanbanTable(tickets, st, { "01": "lane 1" }).includes("01 t01 · lane 1"));
  t("dag edges and classes", dagMermaid(tickets, st).includes("T00 --> T01") && dagMermaid(tickets, st).includes(":::done"));
  t("unsafe pairs (blocked pairs skipped)", pairs(tickets).join("\n") === "01+02: share api\n01+03: marked unsafe_with\n03+04: share ui" && pairs([tk("00", [], ["x"]), tk("01", ["00"], ["x"])]).length === 0);
  t("pr refs", parsePrRef("#12").number === 12 && parsePrRef("https://github.com/o/r/pull/34").url === "https://github.com/o/r/pull/34" && throws(() => parsePrRef("x"), /not a PR/));
  t("issue refs", parseIssue("OV-713").ref === "OV-713" && parseIssue("12").ref === "#12" && parseIssue("https://github.com/o/r/issues/5").ref === "#5"
    && parseIssue("OV-1=https://x.atlassian.net/browse/OV-1").url.endsWith("OV-1") && parseIssue("https://x.atlassian.net/browse/OV-2").ref === "OV-2");
  const base = { slug: "f", feature: { type: "web" }, tickets };
  t("phase follows the plan gate", phaseOf(normalizeProgress(), { tickets: [], st: {} }) === "planning"
    && phaseOf(normalizeProgress({ gates: { G2: { state: "pending" } } }), { tickets: [], st: {} }) === "planning: plan approval pending"
    && phaseOf(prog, { tickets, st }) === "build");
  t("suggest revise, plan approval, merge and lane", suggestNext({ ...base, prog: normalizeProgress(), st: st0 }) === "/dt-revise f"
    && suggestNext({ ...base, prog: normalizeProgress({ gates: { G2: { state: "pending" } } }), st: st0 }) === "/dt-approve plan"
    && suggestNext({ ...base, prog: normalizeProgress({ gates: { G1: { state: "approved" } } }), st: st0 }) === "/dt-revise f"
    && suggestNext({ ...base, prog, st }) === "/dt-check-merged"
    && suggestNext({ ...base, prog: normalizeProgress({ ...prog, tickets: { "00": { status: "done" } } }), st: st0 }) === "/dt-lane f"
    && !("drift" in compactProgress(normalizeProgress({ ...prog, drift: { merges_since: 2 } }))));
  t("ago", ago("2025-10-31T10:00Z", Date.parse("2025-10-31T12:00Z")) === "2h ago" && ago("2025-10-31 11:30", Date.parse("2025-10-31T12:00Z")) === "30m ago" && ago("") === "never");
  const brief = renderBrief({ ...base, prog, st, phase: "build", next: "01: make it green", suggested: "/dt-lane f 01", nowMs: Date.parse("2025-10-31T12:00Z") });
  t("brief shows board, in-flight tickets and next", brief.includes("1/5 done · in flight 2 (01 in_progress, 02 review)") && brief.includes("PRs: #5 merged (checked 2h ago)")
    && brief.includes("- **Next:** 01: make it green") && brief.includes("`/dt-lane f 01`") && brief.split("\n").length <= 12);
  console.log(bad ? `${bad} failing` : "all good");
  process.exit(bad ? 1 : 0);
}

// ---------- CLI ----------
const HELP = {
  "": {
    usage: "dt.mjs <command> [options]",
    description: "Dev-turbo workflow tools. Node 18+, zero dependencies.\nThe feature folder (feature.json, spec.md, tickets/, progress.json) is the only memory between sessions.",
    commands: [
      ["info", "Show repository configuration and context"],
      ["config", "Update repository configuration"],
      ["epic", "Save the feature's Jira epic without approving scope"],
      ["resume", "List features, or show a short brief of one"],
      ["progress", "Show or update a feature's current state"],
      ["migrate-progress", "Replace legacy ticket lanes with optional worktree paths"],
      ["status", "Show the feature board"],
      ["next", "Start a ready ticket in a branch or worktree"],
      ["gate", "Record a gate decision and its follow-up actions"],
      ["pr", "Open a ticket pull request"],
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
  epic: {
    usage: "dt.mjs epic <slug> --key KEY",
    description: "Save a confirmed Jira epic key in feature.json during the grill. Creates draft metadata, never records approval.",
    options: [["--key KEY", "Jira epic key, such as OV-777"]],
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
  resume: {
    usage: "dt.mjs resume [<slug>] [--json] [--prompt] [--no-gh]",
    description: "Without a slug: list this repository's features with their phase and next step.\nWith a slug: refresh PR and GitHub issue states, save them, and print a short brief.",
    options: [["--json", "Print machine-readable output (used by /dt-resume)"], ["--prompt", "Print the brief plus instructions for a fresh session"], ["--no-gh", "Skip refreshing PRs and issues from GitHub"]],
  },
  progress: {
    usage: "dt.mjs progress <slug> [--ticket ID] [updates]",
    description: `Show (no updates) or update progress.json. Updates replace the old values: it holds the current state, not history.\nLists are replaced by repeating the flag; texts stay under ${MAX_TEXT} characters, lists under ${MAX_ITEMS} items.`,
    options: [
      ["--ticket ID", "Update this ticket instead of the feature"],
      ["--owner ID", "Session owner; required to update a claimed ticket"],
      ["--release-claim", "Release your claim after saving a handover (without --ticket: all your claims)"],
      ["--next TEXT", "The next concrete step"],
      ["--blocker TEXT", "A blocker (repeat; replaces the list)"],
      ["--no-blockers", "Clear the blockers"],
      ["--todo TEXT", "Remaining work (repeat; replaces the list)"],
      ["--no-todo", "Clear the todo list"],
      ["--verification TEXT", "Ticket: what was verified, and at which commit"],
      ["--status todo|in_progress|review|done", "Ticket: correct the status"],
      ["--branch NAME / --worktree PATH", "Ticket branch / optional standalone worktree path"],
      ["--pr NUMBER|URL", "Ticket: add or refresh a PR (repeatable)"],
      ["--remove-pr NUMBER|URL", "Ticket: forget a PR"],
      ["--issue REF[=URL]", "Add an issue: OV-713, #12, or a URL (repeatable)"],
      ["--jira-key KEY --jira-description-file FILE", "Claimed ticket: save Jira key, epic, title and 3–5 description bullets"],
      ["--remove-issue REF", "Forget an issue"],
      ["--no-gh", "Do not look PRs up on GitHub"],
      ["--dry-run", "Print the result without saving"],
    ],
  },
  status: {
    usage: "dt.mjs status <slug> [--no-gh]",
    description: "Print phase, gates, kanban, dependencies and unsafe pairs. Refreshes PR states unless --no-gh.",
    options: [["--no-gh", "Skip refreshing PRs and issues from GitHub"]],
  },
  next: {
    usage: "dt.mjs next <slug> --owner ID [--ticket ID] [--force] [--dry-run]",
    description: "Pick a ready ticket, enforcing dependencies, shared touches and unsafe pairs, without an in-flight count limit.\nT2 monorepo: branch in the current lane. T2 standalone: create a worktree from the main checkout.\nT0/T1: branch quick/<slug> in the current checkout, without Jira setup.\nOn the ticket's branch already: print its saved state to resume from.",
    options: [["--ticket ID", "Select a specific ticket instead of the first ready ticket"], ["--owner ID", "Session ID claiming this ticket atomically before branching"], ["--force", "Explicit ticket only: take over a claim in its saved checkout; does not stop the old agent"], ["--claim-only", "Claim without Git side effects; create/save Jira metadata before branching"], ["--no-fetch", "Do not fetch the main branch first"], ["--dry-run", "Print Git commands instead of running them"]],
  },
  gate: {
    usage: "dt.mjs gate <slug> <0|2|3> <approve|change|pending> [options]",
    description: "Record a gate decision in progress.json: G0 creates the project and approves its plan, G2 re-approves a revised plan, G3 closes a ticket.\nRecord pending before asking for a decision, so a new session knows a gate is waiting.\nApproval may create GitHub issues (standalone T2) or clean up a worktree.",
    options: [
      ["--note TEXT", "A short note kept with the gate"],
      ["--ticket ID", "Ticket being merged (required for G3)"],
      ["--tier T0|T1|T2", "Task tier (required for G0)"],
      ["--type web|device|service|cli|mixed", "Task type (required for G0)"],
      ["--dry-run", "Skip recording the gate and executing Git/GitHub commands"],
    ],
    notes: "G0 and G2 approval need ticket files (and spec.md for T2).\nDry-run is not fully read-only: G0 still initializes feature.json.",
  },
  pr: {
    usage: "dt.mjs pr <slug> <ID> --body-file FILE [--dry-run]",
    description: "Push the current branch and open a PR (draft in monorepo, ready in standalone).\nTicket PRs require the saved branch (Jira snake_case for T2 in the two CSS repos; quick/<slug> for T0/T1; ticket/<slug>-<ID> elsewhere) and are recorded in progress.json.",
    options: [["--body-file FILE", "Short ## Description and ## Testing: unit tests + staging tests (required)"], ["--dry-run", "Print push/PR creation commands instead of running them"]],
  },
  comment: {
    usage: "dt.mjs comment --body-file FILE [--branch B] [--dry-run]",
    description: "Post review findings on a branch's PR. If no PR exists, findings stay in chat.",
    options: [["--body-file FILE", "File containing the review findings (required)"], ["--branch B", "PR branch (default: current branch)"], ["--dry-run", "Print the comment command instead of posting it"]],
  },
  "migrate-progress": {
    usage: "dt.mjs migrate-progress <slug> [--dry-run]",
    description: "Remove legacy ticket lane fields, retaining absolute worktree paths as worktree. Preserve claims, gates and all other saved state under the progress lock.",
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
  const help = Object.hasOwn(HELP, topic) ? HELP[topic] : null;
  if (!help) { console.error(`dt: unknown command ${JSON.stringify(cmd)}. Run dt.mjs -h for help.`); process.exitCode = 2; return; }
  const lines = [`Usage: ${help.usage}`, "", help.description];
  if (help.commands) lines.push("", "Commands:", ...help.commands.map(([name, description]) => `  ${name.padEnd(20)} ${description}`));
  lines.push("", "Options:", ...(help.options || []).concat([["-h, --help", "Show this help and exit"]]).map(([name, description]) => `  ${name.padEnd(38)} ${description}`));
  if (help.notes) lines.push("", help.notes);
  console.log(lines.join("\n"));
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const isMain = process.argv[1] && realpath(fileURLToPath(import.meta.url)) === realpath(process.argv[1]);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  DRY = flag("--dry-run");
  try {
    if (!cmd || flag("-h") || flag("--help")) showHelp(process.argv.slice(2));
    else if (!Object.hasOwn(HELP, cmd) || cmd.includes(" ")) { console.error(`dt: unknown command ${JSON.stringify(cmd)}. Run dt.mjs -h for help.`); process.exitCode = 2; }
    else if (cmd === "selftest") selftest();
    else {
      const ctx = resolveRepo();
      const slug = rest[0] && !rest[0].startsWith("--") ? rest[0] : "";
      if (cmd === "info") cmdInfo(ctx);
      else if (cmd === "config") cmdConfig(ctx, rest);
      else if (cmd === "epic") cmdEpic(ctx, slug);
      else if (cmd === "resume") cmdResume(ctx, slug);
      else if (cmd === "migrate-progress") cmdMigrateProgress(ctx, slug || fail("usage: dt.mjs migrate-progress <slug>"));
      else if (cmd === "progress") cmdProgress(ctx, slug || fail("usage: dt.mjs progress <slug> [--ticket ID] [updates]"));
      else if (cmd === "status") cmdStatus(ctx, slug || fail("usage: dt.mjs status <slug>"));
      else if (cmd === "next") cmdNext(ctx, slug || fail("usage: dt.mjs next <slug> [--ticket ID]"));
      else if (cmd === "gate") cmdGate(ctx, slug || fail("usage: dt.mjs gate <slug> <0|2|3> approve|change|pending"), rest[1], rest[2]);
      else if (cmd === "pr") cmdPr(ctx, slug || fail("usage: dt.mjs pr <slug> <ID> --body-file FILE"), rest[1]);
      else if (cmd === "comment") cmdComment(ctx);
    }
  } catch (e) {
    if (e instanceof Fail) { console.error(`dt: ${e.message}`); process.exit(1); }
    throw e;
  }
}
