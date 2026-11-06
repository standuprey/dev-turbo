import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { needsSliceReview, ticketMerged } from "./gates.mjs";

const clean = (value) => String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
const real = (value) => { try { return realpathSync(value); } catch { return resolve(value); } };

// Read-only snapshot. dt.mjs next revalidates and claims atomically after selection.
export function laneOptions(snapshot, repo, owner, logic) {
  const { tickets, prog, st } = snapshot;
  const gateReason = prog.gates.G1?.state !== "approved" ? "Architecture approval required"
    : prog.gates.G2?.state !== "approved" || needsSliceReview(snapshot) ? "Slices approval required"
    : ["pending", "changes"].includes(prog.gates.G4?.state) || prog.drift.merges_since >= 2
      || prog.todo.some((n) => /^drift\s+\d+:/i.test(n)) ? "Architecture drift review/application required" : "";
  const current = repo.branch?.match(/^ticket\/(.+)-(\d+)$/);
  return tickets.filter((t) => st[t.id].status !== "done").map((t) => {
    const saved = prog.tickets[t.id] || {};
    let state = "blocked", reason = "", selectable = false;
    const checkout = saved.claim?.checkout || (/^lane \d+$/.test(saved.lane || "") ? repo.lanes?.[Number(saved.lane.slice(5)) - 1] : saved.lane?.startsWith("/") ? saved.lane : "");
    if (saved.claim && saved.claim.owner !== owner) {
      state = "locked"; reason = `owner ${saved.claim.owner} · ${saved.lane || checkout}`;
    } else if (checkout && real(checkout) !== real(repo.root)) {
      state = "locked"; reason = `${saved.lane || checkout} · another checkout`;
    } else if (ticketMerged(saved)) {
      state = "merged"; reason = `use /dt-approve ${t.id}`;
    } else if (st[t.id].status === "review") {
      state = "review"; reason = `use /dt-review ${t.id}`;
    } else if (saved.blockers?.length || prog.blockers.length) {
      reason = (saved.blockers?.length ? saved.blockers : prog.blockers).join(" · ");
    } else if (gateReason) reason = gateReason;
    else if (current && current[2].padStart(2, "0") !== t.id && st[current[2].padStart(2, "0")]?.status !== "done") {
      reason = `this checkout is on ticket ${current[2]}; use another lane`;
    } else if (st[t.id].status === "in_progress") {
      state = "resume"; selectable = true;
    } else {
      try { logic.pickReady(tickets, st, t.id); state = "ready"; selectable = true; }
      catch (e) { reason = clean(e.message).replace(/^no ready ticket:\s*/, "").replace(new RegExp(`^${t.id}:\\s*`), ""); }
    }
    const label = `${t.id} · ${clean(t.title)} · ${state.toUpperCase()}${reason ? " — " + clean(reason) : ""}`;
    return { id: t.id, state, reason, selectable, label };
  }).sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.id.localeCompare(b.id));
}

export async function chooseLane({ project, ctx, loadSnapshot, logic }) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/dt-lane needs a ticket picker. In non-interactive mode use /dt-lane <id>.", "warning");
    return null;
  }
  const { snapshot, repo } = await loadSnapshot();
  const options = laneOptions(snapshot, repo, ctx.sessionManager.getSessionId(), logic);
  if (!options.length) { ctx.ui.notify("No remaining tickets. Use /dt-status.", "info"); return null; }
  const selected = await ctx.ui.select(`Choose a ticket · ${project.slug}`, options.map((o) => o.label));
  if (!selected) return null;
  const option = options.find((o) => o.label === selected);
  if (!option?.selectable) {
    ctx.ui.notify(option?.state === "locked"
      ? `Ticket ${option.id} is LOCKED: ${clean(option.reason)}. Open its saved checkout; use /dt-lane ${option.id} force only after checking the previous agent is gone.`
      : `Ticket ${option?.id || ""} is unavailable: ${clean(option?.reason)}.`, "warning");
    return null;
  }
  return option.id;
}
