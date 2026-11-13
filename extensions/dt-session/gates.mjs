import { validSlug, TYPES, sessionCommand } from "./state.mjs";

// The proposal entry keeps its historical name so saved sessions restore pending plans.
export const SCOPE = "dt-scope-proposal";
export const NAMES = { plan: { id: 2, label: "Plan" } };
export const CHECK_MERGED = "/dt-check-merged";
const ALIASES = { scope: "plan", slices: "plan", architecture: "plan" };
const LEGACY_LABELS = ["Plan", "Plan", "Plan", "Ticket closure", "Drift review"];

export function scopeProposal(branch, repo) {
	let value = null;
	for (const e of branch) if (e.type === "custom" && e.customType === SCOPE) value = e.data;
	return value && validSlug(value.slug) && /^T[012]$/.test(value.tier) && TYPES.includes(value.type) && typeof value.note === "string" && value.note.length <= 400 && value.key === repo?.key && value.base === repo?.featuresBase ? value : null;
}
export function ticketMerged(ticket) {
	return Boolean(ticket?.prs?.length) && ticket.prs.every((pr) => pr.state === "merged");
}
export function ticketPending(ticket) {
	return ticket?.status !== "done" && (ticket?.acceptance?.state === "pending" || (!ticket?.acceptance && ticket?.status === "review" && /(?:Gate\s*3|G3)\s*:\s*(?:merge decision|waiting)|^\s*(?:Gate\s*3|G3)\s+merge decision\b/i.test(ticket.next || "")));
}
export const planApproved = (snapshot) => snapshot?.prog.gates.G2?.state === "approved";
// Tickets /dt-check-merged inspects: not closed yet, with at least one saved PR.
export const closable = (snapshot) => snapshot.tickets.filter((t) => snapshot.prog.tickets[t.id]?.status !== "done" && snapshot.prog.tickets[t.id]?.prs?.length);

export function pendingGates(view) {
	if (view.scope) return ["plan"];
	if (!view.project || !view.snapshot) return [];
	return view.snapshot.prog.gates.G2?.state === "pending" ? ["plan"] : [];
}
export function approvalPlan(view, name, args) {
	name = ALIASES[name] || name;
	if (name === "ticket" || /^\d{1,2}$/.test(name || "")) throw new Error("Tickets close with /dt-check-merged after you merge their PRs.");
	if (!Object.hasOwn(NAMES, name)) throw new Error("Usage: /dt-approve plan.");
	if (name === "plan") {
		if (!pendingGates(view).includes("plan")) throw new Error("No plan is awaiting approval.");
		if (args.length) throw new Error("Usage: /dt-approve plan. Change the plan in discussion first.");
		if (view.scope) {
			if (/^--?[\w-]+$/.test(view.scope.note.trim())) throw new Error("Use a descriptive task summary, not a standalone command-line flag.");
			if (view.existingScope) throw new Error("That project already exists. Use /dt-resume to select it, or discuss a new name before approving the plan.");
			return { name, revision: view.revision, slug: view.scope.slug, id: 0, note: view.scope.note, tier: view.scope.tier, type: view.scope.type };
		}
		return { name, revision: view.revision, slug: view.project.slug, id: 2, note: "Plan approved through /dt-approve" };
	}
	throw new Error("Usage: /dt-approve plan.");
}
export function approvalCompletions(view, prefix) {
	const planItem = pendingGates(view).includes("plan") ? [{ value: "plan", label: "plan", description: "Approve the plan" }] : [];
	return planItem.filter((item) => item.value.startsWith(prefix));
}
export function namedText(value) {
	return String(value || "").replace(/Gate\s*2b|G2b/g, "ticket 00 acceptance").replace(/Gate\s*([0-4])|\bG([0-4])\b/g, (_, a, b) => LEGACY_LABELS[Number(a ?? b)]);
}
export function nextCommandText(commands) {
	return commands.length ? commands.map((c) => `- \`${c}\``).join("\n") : "No next command.";
}
export function nextCommands(view, logic) {
	if (view.scope) return ["/dt-approve plan"];
	if (!view.project) return ["/dt-resume", "/dt-start <task>"];
	const s = view.snapshot;
	if (!s) return ["/dt-resume"];
	const g = s.prog.gates.G2?.state;
	if (g === "pending") return ["/dt-approve plan"];
	if (g !== "approved" || !s.tickets.length) return ["/dt-revise"];
	// Merged facts override stale review/build handovers.
	const merged = s.tickets.filter((t) => s.st[t.id].status !== "done" && ticketMerged(s.prog.tickets[t.id]));
	if (merged.length) return [CHECK_MERGED];
	const saved = sessionCommand((s.prog.next || "").trim(), view.project.slug);
	if (saved === "/dt-revise") return [saved];
	const work = saved.match(/^\/dt-(lane|review) (\d{1,2}|next)(?: (autofix))?$/);
	if (work) {
		const id = work[2].padStart(2, "0");
		if (work[2] === "next" && work[1] === "lane") { try { logic.pickReady(s.tickets, s.st); return [saved]; } catch {} }
		else if (work[1] === "review" && s.st[id] && s.st[id].status !== "done") return [saved];
	}
	const awaiting = s.tickets.filter((t) => ticketPending(s.prog.tickets[t.id]));
	if (awaiting.length) return [CHECK_MERGED];
	// The picker checks claims/checkout before selection; never name another agent's build.
	try { logic.pickReady(s.tickets, s.st); return ["/dt-lane"]; } catch { /* no runnable tickets */ }
	const review = s.tickets.filter((t) => s.st[t.id].status === "review");
	if (review.length) return review.map((t) => `/dt-review ${t.id}`);
	if (s.tickets.some((t) => s.st[t.id].status === "in_progress")) return ["/dt-lane"];
	if (s.tickets.every((t) => s.st[t.id].status === "done")) return [];
	return ["/dt-revise"];
}
