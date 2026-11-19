import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { sessionCommand } from "../dt-session/state.mjs";
import { namedText, planApproved, ticketPending, ticketMerged } from "../dt-session/gates.mjs";

const text = (v) => namedText(v).replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();
const cell = (v) => text(v).replace(/\|/g, "\\|").replace(/`/g, "'");
const short = (value) => text(value).length > 100 ? text(value).slice(0, 99) + "…" : text(value);
const bullets = (values) => [...new Set(values.filter(Boolean))].slice(0, 3).map((value) => "• " + cell(value)).join(" · ");

const progressLabels = { next: "Saved handover", todo: "Todo", prs: "PRs", issues: "Issues", url: "URL", updated: "Last updated", checked: "Last checked", acquired: "Acquired", worktree: "Worktree" };
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

/** Resolves an exact saved branch within the selected project, including closed tickets. */
export function branchTicket(snapshot, branch) {
	const matches = snapshot.tickets.filter(({ id }) => snapshot.prog.tickets[id]?.branch === branch);
	if (!matches.length) throw new Error(`No ticket saved for branch "${branch}" in the selected project.`);
	if (matches.length > 1) throw new Error(`Multiple tickets use branch "${branch}". Use /dt-status <id>.`);
	return matches[0].id;
}

/** Finds the selected project's ticket in this checkout without choosing new work. */
export function currentLaneTicket(project, snapshot, repo) {
	const unique = (ids) => {
		if (ids.length > 1) throw new Error("Multiple tickets match this lane. Use /dt-status <id>.");
		return ids[0];
	};
	const saved = (id) => snapshot.prog.tickets[id] || {};
	const branch = repo.branch;
	const branchMatches = snapshot.tickets.filter(({ id }) => branch && (
		saved(id).branch === branch || branch === `ticket/${project.slug}-${id}` ||
		(project.tier !== "T2" && id === "00" && branch === `quick/${project.slug}`)
	)).map(({ id }) => id);
	const onBranch = unique(branchMatches);
	if (onBranch) return onBranch;
	const real = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
	const checkoutMatches = repo.root ? snapshot.tickets.filter(({ id }) => {
		const checkout = saved(id).claim?.checkout || saved(id).worktree;
		return checkout && real(checkout) === real(repo.root);
	}).map(({ id }) => id) : [];
	const inCheckout = unique(checkoutMatches);
	if (inCheckout) return inCheckout;
	// T0 works on whichever branch is checked out, so its only ticket is the lane anywhere.
	if (project.tier === "T0" && snapshot.tickets.some(({ id }) => id === "00")) return "00";
	throw new Error("No ticket found for the current lane in the selected project. Use /dt-status <id> or /dt-lane.");
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
	const lines = ["| ID | Ticket | State | Saved verification | Notes |", "|---|---|---|---|---|"];
	if (context.scope) {
		const scope = context.scope;
		lines.push(`| — | ${cell(scope.slug)} | Plan awaiting approval | | ${bullets([short(scope.note), "/dt-approve plan"])} |`);
		return lines.join("\n");
	}
	const { tickets, prog, st } = snapshot;
	const selected = tickets.filter((t) => context.all || st[t.id].status !== "done")
		.sort((a, b) => Number(a.id) - Number(b.id));
	const note = (value) => sessionCommand(text(value), project.slug);
	for (const t of selected) {
		const saved = prog.tickets[t.id] || {};
		const status = st[t.id].status;
		let state = status;
		if (status !== "done" && ticketMerged(saved)) state = "PRs merged; closure pending";
		else if (status !== "done" && ticketPending(saved)) state = "closure pending";
		else if (status === "todo") {
			const unmet = t.blocked_by.filter((id) => st[id]?.status !== "done");
			if (unmet.length) state = `blocked by ${unmet.join(", ")}`;
			else if (st[t.id].note) state = "ticket closure pending";
			else if (prog.blockers.length) state = "project blockers apply";
			else if (!planApproved(snapshot)) state = "waiting for plan approval";
			else if (saved.blockers?.length) state = "saved blockers: " + saved.blockers.map(text).join(" · ");
			else {
				try { logic.pickReady(tickets, st, t.id); state = "ready"; }
				catch (e) { state = text(e.message).replace(/^no ready ticket:\s*/, "").replace(new RegExp(`^${t.id}:\\s*`), ""); }
			}
		}
		const notes = [];
		if (saved.branch) notes.push("Branch: " + text(saved.branch));
		if (status !== "done") {
			const blockers = [...prog.blockers, ...(saved.blockers || [])];
			if (blockers.length) notes.push(short("Blocker: " + blockers.map(text).join("; ")));
			if (ticketMerged(saved) || st[t.id].note) notes.push("Merged: use /dt-check-merged");
			if (!planApproved(snapshot)) notes.push(short("Plan: " + (prog.gates.G2?.note || prog.gates.G2?.state || "not recorded")));
		}
		const prs = (saved.prs || []).map((pr) => `${pr.number ? "#" + pr.number : text(pr.url || "PR")} ${text(pr.state || "unknown")} (checked ${text(pr.checked) || "unknown"})`);
		if (prs.length) notes.push(short(prs.join("; ")));
		if (status !== "done") {
			for (const value of [saved.next, prog.next]) {
				const command = note(value);
				if (command && !/^\/dt-status\b/.test(command) && !(ticketMerged(saved) && /^\/dt-(lane|review)\b/.test(command))) notes.push(short(command));
			}
			const todos = [...(saved.todo || []), ...prog.todo];
			if (todos.length) notes.push(short("Todo: " + todos.map(note).join("; ")));
			if (saved.claim) notes.push(short(`Claim: ${text(saved.claim.owner)} · ${text(saved.claim.checkout)}`));
			if (saved.worktree) notes.push(short("Worktree: " + text(saved.worktree)));
		}
		lines.push(`| ${t.id} | ${cell(t.title)}${t.kind === "HITL" ? " (HITL)" : ""} | ${cell(state === "ready" ? "🟢 ready" : state)} | ${cell(saved.verification) || "not recorded"} | ${bullets(notes)} |`);
	}
	for (const id of Object.keys(prog.tickets).filter((id) => !tickets.some((t) => t.id === id)).sort((a, b) => Number(a) - Number(b))) {
		lines.push(`| ${cell(id)} | Missing ticket file | state gap | | ${bullets([prog.tickets[id].branch ? "Branch: " + text(prog.tickets[id].branch) : "", "Not counted: ticket file missing"])} |`);
	}
	const rows = lines.slice(2).sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1]));
	return [...lines.slice(0, 2), ...rows].join("\n");
}
