import { homedir } from "node:os";

export function aligned(left, right, width, { truncateToWidth, visibleWidth }) {
	right = truncateToWidth(right, Math.max(0, width), "");
	const available = Math.max(0, width - visibleWidth(right) - 2);
	left = truncateToWidth(left, available, "");
	return left + " ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right))) + right;
}

export function usageTotals(entries) {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of entries) {
		const usage = entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary" ? entry.usage
			: entry.type === "message" && ["assistant", "toolResult"].includes(entry.message.role) ? entry.message.usage : null;
		if (!usage) continue;
		for (const key of ["input", "output", "cacheRead", "cacheWrite"]) totals[key] += usage[key] || 0;
		totals.cost += usage.cost?.total || 0;
	}
	return totals;
}

export function createProjectFooter(ctx, pi, theme, data, tui, getProject, format) {
	const unsubscribe = data.onBranchChange(() => tui.requestRender());
	let cache;
	const token = (n) => n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
	return {
		dispose: unsubscribe,
		invalidate() { cache = undefined; },
		render(width) {
			const manager = ctx.sessionManager;
			const key = `${manager.getSessionId()}:${manager.getLeafId()}:${manager.getEntryCount()}`;
			if (cache?.key !== key) cache = { key, totals: usageTotals(manager.getEntries()) };
			const totals = cache.totals;
			let cwd = manager.getCwd();
			const home = homedir();
			if (cwd === home || cwd.startsWith(home + "/")) cwd = "~" + cwd.slice(home.length);
			const branch = data.getGitBranch();
			const name = manager.getSessionName();
			const left = `${cwd}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`;
			const project = getProject();
			const label = project ? `dt: ${project.slug}` : "dt: no project";
			const lines = [aligned(theme.fg("dim", left), theme.fg("accent", label), width, format)];
			const parts = [];
			for (const [key, prefix] of [["input", "↑"], ["output", "↓"], ["cacheRead", "R"], ["cacheWrite", "W"]]) {
				if (totals[key]) parts.push(prefix + token(totals[key]));
			}
			const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
			if (totals.cost || subscription) parts.push(`$${totals.cost.toFixed(3)}${subscription ? " (sub)" : ""}`);
			const usage = ctx.getContextUsage();
			parts.push(`${usage?.percent == null ? "?" : usage.percent.toFixed(1) + "%"}/${token(usage?.contextWindow || ctx.model?.contextWindow || 0)}`);
			let model = ctx.model?.id || "no-model";
			if (ctx.model?.reasoning) model += ` • ${pi.getThinkingLevel() || "off"}`;
			if (ctx.model && data.getAvailableProviderCount() > 1) model = `(${ctx.model.provider}) ${model}`;
			lines.push(theme.fg("dim", aligned(parts.join(" "), model, width, format)));
			const statuses = [...data.getExtensionStatuses()].sort(([a], [b]) => a.localeCompare(b))
				.map(([, value]) => value.replace(/[\r\n\t]/g, " ").trim()).join(" ");
			if (statuses) lines.push(format.truncateToWidth(statuses, width, "…"));
			return lines;
		},
	};
}
