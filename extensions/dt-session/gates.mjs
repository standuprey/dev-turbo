import { validSlug, TYPES, sessionCommand } from "./state.mjs";

export const SCOPE = "dt-scope-proposal";
export const QUICK = "dt-quick-gate";
export const NAMES = { scope: { id: 0, label: "Scope" }, architecture: { id: 1, label: "Architecture" }, slices: { id: 2, label: "Slices" }, ticket: { id: 3, label: "Ticket acceptance" }, drift: { id: 4, label: "Architecture drift" } };

export function scopeProposal(branch, repo) {
	let value = null;
	for (const e of branch) if (e.type === "custom" && e.customType === SCOPE) value = e.data;
	return value && validSlug(value.slug) && /^T[012]$/.test(value.tier) && TYPES.includes(value.type) && typeof value.note === "string" && value.note.length <= 400 && value.key === repo?.key && value.base === repo?.featuresBase ? value : null;
}
export function quickGate(branch, project, gate) {
	let value = null;
	for (const e of branch) if (e.type === "custom" && e.customType === QUICK && e.data?.gate === gate && e.data?.slug === project?.slug && e.data?.scopeId === project?.scopeId && e.data?.key === project?.key) value = e.data;
	return value;
}
export function ticketMerged(ticket) {
	return Boolean(ticket?.prs?.length) && ticket.prs.every((pr) => pr.state === "merged");
}
function mergedNext(id, ticket) {
	return ticketPending(ticket) && ticket.verification && !ticket.blockers?.length
		? `/dt-approve ticket ${id}` : `/dt-final-check ${id}`;
}
export function ticketPending(ticket) {
	return ticket?.acceptance?.state === "pending" || (!ticket?.acceptance && ticket?.status === "review" && /(?:Gate\s*3|G3)\s*:\s*(?:merge decision|waiting)|^\s*(?:Gate\s*3|G3)\s+merge decision\b/i.test(ticket.next || ""));
}
export function findings(snapshot) {
	const found = snapshot.prog.todo.map((s) => s.match(/^drift\s+(\d+):/i)?.[1]).filter(Boolean).map(Number);
	if (found.length) return [...new Set(found)].sort((a, b) => a - b);
	const count = snapshot.prog.gates.G4?.note?.match(/^(\d+) findings\b/)?.[1];
	if (count !== undefined) return Array.from({ length: Number(count) }, (_, i) => i + 1);
	throw new Error("Drift findings are not saved as a numbered list. Run /dt-drift first.");
}
export function driftDecisions(snapshot, tokens) {
	const expected = findings(snapshot), decisions = new Map();
	for (const token of tokens) {
		const m = token.match(/^(\d+):(code|spec|accept)$/);
		if (!m || decisions.has(Number(m[1])) || !expected.includes(Number(m[1]))) throw new Error("Use one explicit decision per finding: /dt-approve drift 1:code 2:spec 3:accept.");
		decisions.set(Number(m[1]), m[2]);
	}
	if (decisions.size !== expected.length) throw new Error(`Decide every drift finding (${expected.join(", ")}): code, spec or accept.`);
	return expected.map((id) => `${id}:${decisions.get(id)}`).join(" ") || "0 findings";
}
export function needsSliceReview(snapshot) {
	const g = snapshot.prog.gates;
	if (g.G1?.state !== "approved" || g.G2?.state !== "approved") return false;
	const slices = Date.parse(g.G2.at || "1970-01-01");
	return Date.parse(g.G1.at) > slices || (g.G4?.state === "approved" && /\d+:spec\b/.test(g.G4.note || "") && Date.parse(g.G4.at) > slices);
}
export function pendingGates(view) {
	const out = [];
	if (view.scope) return ["scope"];
	if (!view.project) return out;
	if (view.project.tier !== "T2") return out.concat(["slices", "ticket"].filter((g) => quickGate(view.branch, view.project, g)?.state === "pending" && (g !== "ticket" || ((view.project.tier === "T0" || quickGate(view.branch, view.project, "slices")?.state === "approved") && quickGate(view.branch, view.project, "review")?.state !== "pending"))));
	const g = view.snapshot.prog.gates;
	if (g.G1?.state === "pending") out.push("architecture");
	if (g.G1?.state === "approved" && g.G2?.state === "pending" && !(g.G4?.state === "approved" && view.snapshot.prog.todo.some((n) => /^drift\s+\d+:/i.test(n)))) out.push("slices");
	if (g.G1?.state === "approved" && g.G2?.state === "approved") {
		if (g.G4?.state === "pending") out.push("drift");
		else if (view.snapshot.prog.drift.merges_since < 2 && g.G4?.state !== "changes" && !needsSliceReview(view.snapshot) && !view.snapshot.prog.todo.some((n) => /^drift\s+\d+:/i.test(n)) && view.snapshot.tickets.some((t) => ticketPending(view.snapshot.prog.tickets[t.id]))) out.push("ticket");
	}
	return out;
}
export function approvalPlan(view, name, args) {
	if (!Object.hasOwn(NAMES, name)) throw new Error("Usage: /dt-approve scope|architecture|slices|ticket|drift [ticket ID or decisions].");
	if (!pendingGates(view).includes(name)) throw new Error(`${NAMES[name].label} is not awaiting approval. Use /dt-status to see the next command.`);
	if (name === "scope") {
		if (/^--?[\w-]+$/.test(view.scope.note.trim())) throw new Error("Use a descriptive task summary, not a standalone command-line flag.");
		if (view.existingScope) throw new Error("That project already exists. Use /dt-resume to select it, or discuss a new name before Scope approval.");
		if (args.length) throw new Error("Usage: /dt-approve scope. Change the proposed name during the grill discussion.");
		return { name, revision: view.revision, slug: view.scope.slug, id: 0, note: view.scope.note, tier: view.scope.tier, type: view.scope.type };
	}
	if (view.project.tier !== "T2") {
		if (args.length) throw new Error(`Usage: /dt-approve ${name} (quick task has no ticket ID).`);
		return { name, revision: view.revision, quick: quickGate(view.branch, view.project, name), slug: view.project.slug };
	}
	const { snapshot } = view;
	if (name === "ticket") {
		if (args.length !== 1 || !/^\d{1,2}$/.test(args[0])) throw new Error("Usage: /dt-approve ticket <ID>.");
		const id = args[0].padStart(2, "0"), saved = snapshot.prog.tickets[id];
		if (!snapshot.tickets.some((t) => t.id === id) || !ticketPending(saved)) throw new Error(`Ticket ${id} is not awaiting acceptance. Run /dt-${ticketMerged(saved) ? "final-check" : "review"} ${id} first.`);
		if (needsSliceReview(snapshot)) throw new Error("The spec was amended after slice approval. Run /dt-slice and /dt-approve slices before accepting tickets.");
		if (!saved.prs?.length || !saved.prs.every((pr) => pr.state === "merged")) throw new Error("All ticket PRs must be saved as merged first. Merge them yourself, then /dt-resume to refresh saved PR state.");
		if (saved.blockers?.length) throw new Error(`Resolve the saved blockers first: ${saved.blockers.join("; ")}. Use /dt-final-check ${id}.`);
		if (!saved.verification) throw new Error(`No verification is saved for ticket ${id}. Use /dt-final-check ${id} to verify and save it first.`);
		return { name, revision: view.revision, slug: view.project.slug, id: 3, ticket: id, note: "Ticket acceptance confirmed through /dt-approve" };
	}
	if (name !== "drift" && args.length) throw new Error(`Usage: /dt-approve ${name}.`);
	return { name, revision: view.revision, slug: view.project.slug, id: NAMES[name].id, note: name === "drift" ? driftDecisions(snapshot, args) : `${NAMES[name].label} approved through /dt-approve` };
}
export function approvalCompletions(view, prefix) {
	const pending = pendingGates(view);
	if (!prefix.includes(" ")) return pending.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name, description: NAMES[name].label }));
	const [name, ...parts] = prefix.split(" ");
	if (!pending.includes(name)) return [];
	if (name === "ticket" && view.project?.tier === "T2") return view.snapshot.tickets.filter((t) => ticketPending(view.snapshot.prog.tickets[t.id]) && t.id.startsWith(parts.join(" "))).map((t) => ({ value: `ticket ${t.id}`, label: t.id, description: t.title }));
	if (name === "drift") {
		const query = parts.pop(), used = new Set(parts.map((s) => Number(s.split(":")[0])));
		return findings(view.snapshot).filter((id) => !used.has(id)).flatMap((id) => ["code", "spec", "accept"].map((choice) => `${id}:${choice}`)).filter((s) => s.startsWith(query)).map((s) => ({ value: [name, ...parts, s].join(" "), label: s }));
	}
	return [];
}
export function namedText(value) {
	return String(value || "").replace(/Gate\s*2b|G2b/g, "ticket 00 acceptance").replace(/Gate\s*([0-4])|\bG([0-4])\b/g, (_, a, b) => Object.values(NAMES).find((g) => g.id === Number(a ?? b)).label);
}
// Machine state, not guesses from prose. Spec-amending drift requires a new slice review.
export function nextCommands(view, logic) {
	if (view.scope) return ["/dt-approve scope"];
	if (!view.project) return ["/dt-resume", "/dt-grill <task>"];
	if (view.project.tier !== "T2") {
		const pending = pendingGates(view);
		if (pending.length) return [`/dt-approve ${pending[0]}`];
		if (quickGate(view.branch, view.project, "review")?.state === "pending") return ["/dt-review"];
		if (quickGate(view.branch, view.project, "ticket")?.state === "approved") return ["/dt-status"];
		return ["/dt-quick"];
	}
	const { snapshot: s } = view, g = s.prog.gates;
	if (g.G1?.state === "pending") return ["/dt-approve architecture"];
	if (g.G1?.state !== "approved") return ["/dt-spec"];
	if (g.G4?.state === "approved" && s.prog.todo.some((n) => /^drift\s+\d+:/i.test(n))) return ["/dt-drift apply"];
	if (g.G2?.state === "pending") return ["/dt-approve slices"];
	if (g.G2?.state !== "approved") return ["/dt-slice"];
	if (g.G4?.state === "pending") return ["/dt-approve drift"];
	if (g.G4?.state === "changes") return ["/dt-drift"];
	if (needsSliceReview(s)) return ["/dt-slice"];
	if (s.prog.drift.merges_since >= 2) return ["/dt-drift"];
	// Merged facts override stale review/build handovers, but never bypass feature gates.
	const merged = s.tickets.filter((t) => s.st[t.id].status !== "done" && ticketMerged(s.prog.tickets[t.id]));
	if (merged.length) return merged.map((t) => mergedNext(t.id, s.prog.tickets[t.id]));
	const saved = sessionCommand((s.prog.next || "").trim(), view.project.slug);
	if (/^\/dt-(?:slice|spec(?: (?:web|device|service|cli|mixed))?|drift)$/.test(saved)) return [saved];
	const work = saved.match(/^\/dt-(lane|review) (\d{1,2}|next)(?: (autofix))?$/);
	if (work) {
		const id = work[2].padStart(2, "0");
		if (work[2] === "next" && work[1] === "lane") { try { logic.pickReady(s.tickets, s.st); return [saved]; } catch {} }
		else if (s.st[id] && s.st[id].status !== "done") return [saved];
	}
	const awaiting = s.tickets.filter((t) => ticketPending(s.prog.tickets[t.id]));
	if (awaiting.length) return awaiting.map((t) => `/dt-approve ticket ${t.id}`);
	const active = s.tickets.filter((t) => ["in_progress", "review"].includes(s.st[t.id].status));
	if (active.length) return active.map((t) => {
		const handover = sessionCommand(s.prog.tickets[t.id]?.next || "", view.project.slug).trim();
		if (new RegExp(`^/dt-(?:lane ${t.id}|review ${t.id}(?: autofix)?)$`).test(handover)) return handover;
		return `/dt-${s.st[t.id].status === "review" ? "review" : "lane"} ${t.id}`;
	});
	try { const ready = logic.pickReady(s.tickets, s.st); return [`/dt-lane ${ready.id}`]; } catch { /* no runnable tickets */ }
	if (s.tickets.length && s.tickets.every((t) => s.st[t.id].status === "done")) return [s.prog.drift.merges_since > 0 ? "/dt-drift" : "/dt-status"];
	return ["/dt-slice"];
}
