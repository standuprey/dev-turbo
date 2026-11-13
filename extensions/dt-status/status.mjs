import { sessionCommand } from "../dt-session/state.mjs";
import { namedText, nextCommands, nextCommandText, planApproved, ticketPending, ticketMerged } from "../dt-session/gates.mjs";

const text = (v) => namedText(v).replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();
const cell = (v) => text(v).replace(/\|/g, "\\|").replace(/`/g, "'");
const finish = (lines, view, logic) => lines.concat("", "## Next commands", nextCommandText(nextCommands(view, logic))).flat().join("\n");

const progressLabels = { next: "Saved handover", todo: "Todo", prs: "PRs", issues: "Issues", jira: "Jira", url: "URL", updated: "Last updated", checked: "Last checked", acquired: "Acquired", worktree: "Worktree" };
const progressLabel = (key) => progressLabels[key] || key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const progressText = (value) => text(String(value)).replace(/[\\`*\[\]<>]/g, "\\$&");

function progressField(label, value, depth = 0) {
	if (value == null || value === "") return [];
	const prefix = `${"  ".repeat(depth)}- `;
	if (typeof value === "object") {
		const children = Array.isArray(value)
			? value.flatMap((item, index) => typeof item === "object" && item !== null
				? progressField(`Entry ${index + 1}`, item, depth + 1)
				: progressField("", item, depth + 1))
			: Object.entries(value).flatMap(([key, item]) => progressField(progressLabel(key), item, depth + 1));
		return children.length ? [`${prefix}**${label}:**`, ...children] : [];
	}
	const display = typeof value === "boolean" ? (value ? "Yes" : "No") : progressText(value);
	return [`${prefix}${label ? `**${label}:** ` : ""}${display}`];
}

export function renderTicketProgress(snapshot, id) {
	const saved = snapshot.prog.tickets[id];
	const lines = ["## Saved ticket progress", `Source: progress.json · checkpoint: ${text(snapshot.prog.updated) || "unknown"}. Local files only; PR states are saved observations.`];
	if (snapshot.st[id]?.note) lines.push(text(snapshot.st[id].note));
	if (!saved) lines.push("No saved progress for this ticket.");
	else {
		lines.push("");
		// Include unfamiliar fields too, without exposing raw JSON or empty defaults.
		for (const [key, value] of Object.entries(saved)) {
			lines.push(...progressField(progressLabel(key), key === "status" ? text(value).replaceAll("_", " ") : value));
		}
	}
	return lines.join("\n");
}

export function renderStatus(project, snapshot, logic, context = {}) {
	const view = { project, snapshot, branch: [], ...context };
	if (view.scope) return finish(["# Plan awaiting approval", `${view.scope.slug} · ${view.scope.tier} ${view.scope.type}`, text(view.scope.note)], view, logic);
	const { tickets, prog, st } = snapshot;
	const done = tickets.filter((t) => st[t.id].status === "done");
	const active = tickets.filter((t) => ["in_progress", "review"].includes(st[t.id].status));
	const remaining = tickets.filter((t) => st[t.id].status !== "done");
	const note = (v) => sessionCommand(text(v), project.slug);
	const plan = prog.gates.G2?.state;
	const lines = [
		`# ${project.slug} · ${snapshot.feature.tier} ${snapshot.feature.type}`,
		`**${snapshot.phase === "done" ? "all tickets accepted" : text(snapshot.phase)}** · ${done.length}/${tickets.length} accepted · ${active.length} in flight · ${remaining.length} left`,
		`Plan: ${plan === "approved" ? "approved" : plan === "pending" ? "revision awaiting /dt-approve plan" : text(plan) || "not recorded"}${prog.gates.G2?.note ? " — " + text(prog.gates.G2.note) : ""}`,
		`Saved checkpoint: ${text(prog.updated) || "unknown"}. Local files only; PR states are saved observations.`,
	];
	if (prog.next || prog.todo.length || prog.blockers.length) {
		lines.push("", "## Saved context / prerequisites");
		if (prog.next && !/^\/dt-status\b/.test(note(prog.next))) lines.push(`- ${note(prog.next)}`);
		for (const item of prog.todo) lines.push(`- Todo: ${note(item)}`);
		for (const item of prog.blockers) lines.push(`- **Blocker:** ${text(item)}`);
	}
	const reasons = {};
	for (const t of remaining) {
		if (st[t.id].status !== "todo") continue;
		const unmet = t.blocked_by.filter((id) => st[id]?.status !== "done");
		if (unmet.length) reasons[t.id] = `blocked by ${unmet.join(", ")}`;
		else if (st[t.id].note) reasons[t.id] = "ticket closure pending";
		else if (prog.blockers.length) reasons[t.id] = "project blockers apply";
		else if (!planApproved(snapshot)) reasons[t.id] = "waiting for plan approval";
		else if (prog.tickets[t.id]?.blockers?.length) reasons[t.id] = "saved blockers: " + prog.tickets[t.id].blockers.map(text).join(" · ");
		else {
			try { logic.pickReady(tickets, st, t.id); reasons[t.id] = "ready"; }
			catch (e) { reasons[t.id] = text(e.message).replace(/^no ready ticket:\s*/, "").replace(new RegExp(`^${t.id}:\\s*`), ""); }
		}
	}
	lines.push("", `## Accepted (${done.length})`);
	if (!done.length) lines.push("No tickets are closed yet.");
	else {
		lines.push("| ID | Ticket | Saved verification |", "|---|---|---|");
		for (const t of done) lines.push(`| ${t.id} | ${cell(t.title)} | ${cell(prog.tickets[t.id]?.verification) || "not recorded"} |`);
	}
	if (active.length) {
		lines.push("", "## Work in flight");
		for (const t of active) {
			const saved = prog.tickets[t.id];
			lines.push(`- **${t.id} ${text(t.title)}** — ${ticketMerged(saved) ? "PRs merged; closure pending" : ticketPending(saved) ? "closure pending" : st[t.id].status}${saved.worktree ? " · " + text(saved.worktree) : ""}`);
			if (saved.claim) lines.push(`  - **Claim:** ${text(saved.claim.owner)} · ${text(saved.claim.checkout)} · acquired ${text(saved.claim.acquired)}`);
			if (saved.verification) lines.push(`  - Saved verification: ${text(saved.verification)}`);
			if (saved.next && !/^\/dt-status\b/.test(note(saved.next)) && !(ticketMerged(saved) && /^\/dt-(lane|review)\b/.test(note(saved.next)))) lines.push(`  - Saved handover: ${note(saved.next)}`);
			for (const item of saved.todo) lines.push(`  - Todo: ${note(item)}`);
			for (const item of saved.blockers) lines.push(`  - **Blocker:** ${text(item)}`);
			if (saved.prs.length) lines.push(`  - Saved PRs: ${saved.prs.map((pr) => `${pr.number ? "#" + pr.number : text(pr.url || "PR")} ${text(pr.state || "unknown")} (checked ${text(pr.checked) || "unknown"})`).join(" · ")}`);
			if (st[t.id].note) lines.push("  - **Merged: use `/dt-check-merged` to confirm on GitHub and close it.**");
		}
	}
	lines.push("", `## Tickets left (${remaining.length})`);
	if (!tickets.length) lines.push("No ticket files yet.");
	else if (!remaining.length) lines.push("None.");
	else {
		lines.push("| ID | Ticket | State |", "|---|---|---|");
		for (const t of remaining) lines.push(`| ${t.id} | ${cell(t.title)}${t.kind === "HITL" ? " (HITL)" : ""} | ${cell(reasons[t.id] || (ticketMerged(prog.tickets[t.id]) ? "PRs merged; closure pending" : ticketPending(prog.tickets[t.id]) ? "closure pending" : st[t.id].status))} |`);
	}
	const orphans = Object.keys(prog.tickets).filter((id) => !tickets.some((t) => t.id === id));
	if (orphans.length) lines.push(`\n**State gap:** progress has ticket IDs without ticket files: ${orphans.join(", ")}. They are not counted.`);
	return finish(lines, view, logic);
}
