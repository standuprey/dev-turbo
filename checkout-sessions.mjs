// Local process inspection: idle sessions count as active; the caller's ancestors do not.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const exec = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 }).trim();
const isSession = (command) => /^(?:\S*\/)?pi(?:\s|$)/.test(command)
  || /^\S*node\S*\s+.*(?:pi-coding-agent|@earendil-works\/pi).*\/cli\.(?:js|mjs)(?:\s|$)/.test(command)
  || /^\S*node\S*\s+\S*dt\.mjs\s+next(?:\s|$)/.test(command);
function processes() {
  return exec("ps", ["-axo", "pid=,ppid=,args="]).split("\n").map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) throw new Error("cannot parse process list");
    return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] };
  });
}
function cwd(pid) {
  try {
    if (process.platform === "linux") return fs.readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform !== "darwin") throw new Error("session inspection supports macOS and Linux only");
    const entry = exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((s) => s.startsWith("n"));
    if (!entry) throw new Error(`cannot read cwd of process ${pid}`);
    return entry.slice(1);
  } catch (error) {
    // A peer may exit between ps and cwd lookup. Permission errors remain blockers.
    try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") return null; }
    throw error;
  }
}
export function otherCheckoutSessions(root, options = {}) {
  const realpath = options.realpath || fs.realpathSync;
  const rows = (options.processes || processes)();
  const parents = new Map(rows.map((p) => [p.pid, p.ppid]));
  const caller = options.pid ?? process.pid;
  if (!parents.has(caller)) throw new Error("requesting process missing from process list");
  const ancestors = new Set();
  for (let pid = caller; pid && !ancestors.has(pid); pid = parents.get(pid)) ancestors.add(pid);
  const checkout = realpath(root);
  return rows.filter((p) => {
    if (ancestors.has(p.pid) || !isSession(p.command)) return false;
    const dir = (options.cwd || cwd)(p.pid);
    if (!dir) return false;
    const relative = path.relative(checkout, realpath(dir));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }).map((p) => p.pid);
}
