import { sessionCommand } from "../dt-session/state.mjs";
import { NAMES, namedText, nextCommands, needsSliceReview, quickGate, ticketPending, ticketMerged } from "../dt-session/gates.mjs";

const text = (v) => namedText(v).replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();
const cell = (v) => text(v).replace(/\|/g, "\\|").replace(/`/g, "'");
const ids = (tickets) => tickets.map((t) => t.id).join(", ") || "none";
const gates = ["scope", "architecture", "slices", "drift"];
const finish = (lines, view, logic) => lines.concat("", "## Next commands", nextCommands(view, logic).map((c) => `- \`${c}\``)).flat().join("\n");

export function renderStatus(project, snapshot, logic, context = {}) {
	const view = { project, snapshot, branch: [], ...context };
	if (view.scope) return finish(["# Scope awaiting approval", `${view.scope.slug} · ${view.scope.tier} ${view.scope.type}`, text(view.scope.note)], view, logic);
	if (!snapshot) {
		const lines = [`# ${project.slug} · ${project.tier} ${project.type}`, "Scope is approved. This quick task has no feature-folder ticket board."];
		for (const gate of ["slices", "review", "ticket"]) {
			const saved = quickGate(view.branch, project, gate);
			if (saved) lines.push(`- ${gate === "review" ? "Review" : NAMES[gate].label}: ${saved.state} — ${text(saved.note)}`);
		}
		return finish(lines, view, logic);
	}
	const { tickets, prog, st } = snapshot;
	const done = tickets.filter((t) => st[t.id].status === "done");
	const active = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status));
	const remaining = tickets.filter((t) => st[t.id].status !== "done");
	const note = (v) => sessionCommand(text(v), project.slug);
	const lines = [
		`# ${project.slug} · ${snapshot.feature.tier} ${snapshot.feature.type}`,
		`**${snapshot.phase === "done" ? "all tickets accepted" : text(snapshot.phase)}** · ${done.length}/${tickets.length} accepted · ${active.length} in flight · ${remaining.length} left`,
		`Saved checkpoint: ${text(prog.updated) || "unknown"}. Local files only; PR states are saved observations.`,
	];
	if (prog.next || prog.todo.length || prog.blockers.length) {
		lines.push("", "## Saved context / prerequisites");
		if (prog.next) lines.push(`- ${note(prog.next)}`);
		for (const item of prog.todo) lines.push(`- Todo: ${note(item)}`);
		for (const item of prog.blockers) lines.push(`- **Blocker:** ${text(item)}`);
	}
	if (needsSliceReview(snapshot)) lines.push("- **Slices must be reviewed again:** the approved drift decisions amended the spec after the last slice approval.");
	const ready = [], reasons = {};
	for (const t of remaining) {
		if (st[t.id].status !== "todo") continue;
		const unmet = t.blocked_by.filter((id) => st[id]?.status !== "done");
		if (unmet.length) reasons[t.id] = `blocked by ${unmet.join(", ")}`;
		else if (st[t.id].note) reasons[t.id] = "ticket acceptance pending";
		else if (prog.blockers.length) reasons[t.id] = "project blockers apply";
		else if (needsSliceReview(snapshot)) reasons[t.id] = "slice review required";
		else if (prog.gates.G1?.state !== "approved" || prog.gates.G2?.state !== "approved") reasons[t.id] = "waiting for Architecture / Slices approval";
		else if (["pending", "changes"].includes(prog.gates.G4?.state)) reasons[t.id] = "waiting for Architecture drift decisions";
		else if (prog.drift.merges_since >= 2) reasons[t.id] = "architecture drift review due";
		else if (prog.tickets[t.id]?.blockers?.length) reasons[t.id] = "saved blockers: " + prog.tickets[t.id].blockers.map(text).join(" · ");
		else {
			try { logic.pickReady(tickets, st, t.id); ready.push(t); reasons[t.id] = "ready"; }
			catch (e) { reasons[t.id] = text(e.message).replace(/^no ready ticket:\s*/, "").replace(new RegExp(`^${t.id}:\\s*`), ""); }
		}
	}
	lines.push("", `## Accepted (${done.length})`);
	if (!done.length) lines.push("No tickets are recorded complete yet. Work performed or merged PRs do not count as ticket acceptance.");
	else {
		lines.push("| ID | Ticket / slice | Saved verification |", "|---|---|---|");
		for (const t of done) lines.push(`| ${t.id} | ${cell(t.title)} | ${cell(prog.tickets[t.id]?.verification) || "not recorded"} |`);
	}
	if (active.length) {
		lines.push("", "## Work in flight");
		for (const t of active) {
			const saved = prog.tickets[t.id];
			lines.push(`- **${t.id} ${text(t.title)}** — ${ticketMerged(saved) ? "PRs merged; recorded acceptance pending" : ticketPending(saved) ? "acceptance pending" : st[t.id].status}${saved.lane ? " · " + text(saved.lane) : ""}`);
			if (saved.claim) lines.push(`  - **Claim:** ${text(saved.claim.owner)} · ${text(saved.claim.checkout)} · acquired ${text(saved.claim.acquired)}`);
			if (saved.verification) lines.push(`  - Saved verification: ${text(saved.verification)}`);
			if (saved.next && !(ticketMerged(saved) && /^\/dt-(lane|review)\b/.test(note(saved.next)))) lines.push(`  - Saved handover: ${note(saved.next)}`);
			for (const item of saved.todo) lines.push(`  - Todo: ${note(item)}`);
			for (const item of saved.blockers) lines.push(`  - **Blocker:** ${text(item)}`);
			if (saved.prs.length) lines.push(`  - Saved PRs: ${saved.prs.map((pr) => `${pr.number ? "#" + pr.number : text(pr.url || "PR")} ${text(pr.state || "unknown")} (checked ${text(pr.checked) || "unknown"})`).join(" · ")}`);
			if (st[t.id].note) lines.push(`  - **Merged but not accepted. Use \`/dt-approve ${t.id}\` to check live merge states and record completion. No repeat code review or rebuild.**`);
		}
	}
	lines.push("", `## Tickets / slices left (${remaining.length})`);
	if (!tickets.length) lines.push("No ticket files yet.");
	else if (!remaining.length) lines.push("None. Check feature acceptance and rollout before calling the feature complete.");
	else {
		lines.push("| ID | Ticket / slice | State |", "|---|---|---|");
		for (const t of remaining) lines.push(`| ${t.id} | ${cell(t.title)}${t.kind === "HITL" ? " (HITL)" : ""} | ${cell(reasons[t.id] || (ticketMerged(prog.tickets[t.id]) ? "PRs merged; recorded acceptance pending" : ticketPending(prog.tickets[t.id]) ? "acceptance pending" : st[t.id].status))} |`);
	}
	const orphans = Object.keys(prog.tickets).filter((id) => !tickets.some((t) => t.id === id));
	if (orphans.length) lines.push(`\n**State gap:** progress has ticket IDs without ticket files: ${orphans.join(", ")}. They are not counted.`);
	lines.push("", "## Approvals", ...gates.map((name) => {
		const gate = prog.gates[`G${NAMES[name].id}`];
		const state = name === "slices" && needsSliceReview(snapshot) ? "review required (previous plan approved)" : name === "drift" && gate?.state === "approved" && prog.todo.some((n) => /^drift\s+\d+:/i.test(n)) ? "approved; application pending" : text(gate?.state) || "not recorded";
		return `- ${NAMES[name].label}: ${state}${gate?.note ? " — " + text(gate.note) : ""}`;
	}));
	lines.push(`- Ticket acceptance: ${ids(done)} accepted; ${ids(tickets.filter((t) => ticketPending(prog.tickets[t.id])))} pending. The walking skeleton is ticket 00's acceptance, not a separate gate.`);
	lines.push(`- Drift: ${prog.drift.merges_since} merges since review; saved review ${text(prog.drift.last) || "not recorded"}. Repeat every 2–3 merges and at the end.`);
	lines.push(`- Ready by saved gate/dependency/resource checks: ${ids(ready)}. Saved prerequisites still apply.`);
	return finish(lines, view, logic);
}
