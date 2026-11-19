import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ticketMerged } from "./gates.mjs";

const clean = (value) => String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
const real = (value) => { try { return realpathSync(value); } catch { return resolve(value); } };

// Read-only snapshot. dt.mjs next revalidates and claims atomically after selection.
export function laneOptions(snapshot, repo, owner, logic) {
  const { tickets, prog, st } = snapshot;
  // A revised plan awaiting approval blocks new starts, not work already in flight.
  const gateReason = prog.gates.G2?.state !== "approved" ? "plan approval required (/dt-approve plan)" : "";
  const legacy = repo.branch?.match(/^ticket\/(.+)-(\d+)$/);
  const current = Object.entries(prog.tickets).find(([, t]) => t.branch && t.branch === repo.branch)?.[0] || legacy?.[2]?.padStart(2, "0");
  return tickets.filter((t) => st[t.id].status !== "done").map((t) => {
    const saved = prog.tickets[t.id] || {};
    let state = "blocked", reason = "", selectable = false;
    const checkout = saved.claim?.checkout || saved.worktree || "";
    if (saved.claim && saved.claim.owner !== owner) {
      state = "locked"; reason = `owner ${saved.claim.owner} · ${checkout}`;
    } else if (checkout && real(checkout) !== real(repo.root)) {
      state = "locked"; reason = `${checkout} · another checkout`;
    } else if (ticketMerged(saved)) {
      state = "merged"; reason = "use /dt-check-merged";
    } else if (st[t.id].status === "review") {
      state = "review"; reason = `use /dt-review ${t.id}`;
    } else if (saved.blockers?.length || prog.blockers.length) {
      reason = (saved.blockers?.length ? saved.blockers : prog.blockers).join(" · ");
    } else if (current && current !== t.id && st[current]?.status !== "done") {
      reason = `this checkout is on ticket ${current}; use another lane`;
    } else if (st[t.id].status === "in_progress") {
      state = "resume"; selectable = true;
    } else if (gateReason) reason = gateReason;
    else {
      try { logic.pickReady(tickets, st, t.id); state = "ready"; selectable = true; }
      catch (e) { reason = clean(e.message).replace(/^no ready ticket:\s*/, "").replace(new RegExp(`^${t.id}:\\s*`), ""); }
    }
    const warning = !selectable;
    const branch = clean(saved.branch);
    const label = `${t.id} · ${clean(t.title)}${branch ? ` (${branch})` : ""} · ${warning ? `WARNING (${state.toUpperCase()})` : state.toUpperCase()}${reason ? " — " + clean(reason) : ""}`;
    return { id: t.id, state, reason, warning, selectable: true, label };
  }).sort((a, b) => Number(a.warning) - Number(b.warning) || a.id.localeCompare(b.id));
}

export async function chooseLane({ project, ctx, loadSnapshot, logic }) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/dt-lane needs a ticket picker. In non-interactive mode use /dt-lane <id>.", "warning");
    return null;
  }
  const { snapshot, repo } = await loadSnapshot();
  const options = laneOptions(snapshot, repo, ctx.sessionManager.getSessionId(), logic);
  if (!options.length) { ctx.ui.notify("No remaining tickets.", "info"); return null; }
  const selected = await ctx.ui.select(`Choose a ticket · ${project.slug}`, options.map((o) => o.label));
  if (!selected) return null;
  const option = options.find((o) => o.label === selected);
  if (!option) return null;
  // Selection is not an override: the existing ticket confirmation shows the warnings next.
  return option.id;
}
