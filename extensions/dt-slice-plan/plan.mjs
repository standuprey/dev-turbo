import { planApproved, ticketMerged } from "../dt-session/gates.mjs";

// Shared touches do not split the display plan; explicit unsafe pairs still do.
const conflict = (a, b) => a.unsafe_with.includes(b.id) || b.unsafe_with.includes(a.id);

// A deterministic, maximal batch plan, not a minimum-duration schedule or a lane reservation.
export function slicePlan(snapshot, { all = false, pickReady } = {}) {
  const { tickets, prog, st } = snapshot;
  const ids = new Set();
  for (const ticket of tickets) {
    if (ids.has(ticket.id)) throw new Error(`Duplicate ticket ID: ${ticket.id}`);
    ids.add(ticket.id);
  }
  const closed = new Set(tickets.filter((t) => {
    const saved = prog.tickets[t.id];
    return saved?.status === "done" || ticketMerged(saved);
  }).map((t) => t.id));
  const complete = all ? new Set() : new Set(closed);
  let remaining = tickets.filter((t) => all || !closed.has(t.id))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const branches = Object.fromEntries(remaining.filter((t) => prog.tickets[t.id]?.branch)
    .map((t) => [t.id, prog.tickets[t.id].branch]));
  const slices = [];
  while (remaining.length) {
    const batch = [];
    for (const ticket of remaining) {
      // Only earlier batches satisfy dependencies, never another ticket in this batch.
      if (ticket.blocked_by.every((id) => complete.has(id)) && !batch.some((other) => conflict(ticket, other))) batch.push(ticket);
    }
    if (!batch.length) break;
    const batchIds = batch.map((t) => t.id);
    slices.push(batchIds);
    batchIds.forEach((id) => complete.add(id));
    remaining = remaining.filter((t) => !complete.has(t.id));
  }
  const blocked = remaining.map((t) => ({ id: t.id, blocked_by: t.blocked_by.filter((id) => !complete.has(id)) }));
  if (!all) return { slices, blocked, branches };
  // Current saved states label batches; simulated completion only builds the order.
  const active = (id) => {
    if (closed.has(id)) return false;
    const saved = prog.tickets[id];
    if (["in_progress", "review"].includes(saved?.status)) return true;
    if (prog.blockers?.length || saved?.blockers?.length || !planApproved(snapshot)) return false;
    const ticket = tickets.find((t) => t.id === id);
    if (st ? st[id]?.blocked : !ticket.blocked_by.every((dep) => closed.has(dep))) return false;
    if (pickReady) {
      try { pickReady(tickets, st, id); }
      catch { return false; }
    }
    return true;
  };
  const statuses = slices.map((ids) => ids.every((id) => closed.has(id)) ? "closed"
    : ids.some(active) ? "in-flight" : "blocked");
  return { slices, blocked, branches, statuses, all: true };
}

export function renderSlicePlan(plan) {
  const label = (id) => !plan.all && plan.branches?.[id] ? `${id} (${plan.branches[id]})` : id;
  const lines = plan.slices.map((ids, index) => `Slice ${index + 1}${plan.statuses ? ` [${plan.statuses[index]}]` : ""}: ${ids.map(label).join(", ")}`);
  if (plan.blocked.length) {
    lines.push("Cannot schedule (missing dependencies or dependency cycle):",
      ...plan.blocked.map((t) => `Ticket ${label(t.id)}: blocked by ${t.blocked_by.join(", ")}`));
  }
  return lines.join("\n") || (plan.all ? "No slices." : "No remaining slices.");
}
