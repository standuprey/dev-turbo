export const ENTRY = "dt-project";
export const TYPES = ["web", "device", "service", "cli", "mixed"];
export const COMMANDS = new Set(["dt-spec", "dt-slice", "dt-amend", "dt-lane", "dt-review", "dt-final-check", "dt-drift", "dt-quick"]);
export const validSlug = (slug) => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

export function restoreProject(branch, repo) {
	let project = null;
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === ENTRY) project = entry.data;
	}
	return project && validSlug(project.slug) && project.key === repo?.key && project.base === repo?.featuresBase
		&& /^T[012]$/.test(project.tier) && TYPES.includes(project.type) ? project : null;
}

// Only the active project can be injected. Old saved commands may repeat its slug.
export function resolveCommand(text, project) {
	const parsed = text.match(/^\/(dt-[\w-]+)(?:\s+([\s\S]*))?$/);
	if (!parsed || !COMMANDS.has(parsed[1])) return null;
	if (!project) throw new Error("No dev-turbo project selected. Run /dt-resume [slug], or /dt-grill <task> and confirm Gate 0 + the slug.");
	const command = parsed[1];
	let args = (parsed[2] || "").trim();
	const strip = (word) => { if (args === word) args = ""; else if (args.startsWith(word + " ")) args = args.slice(word.length + 1).trim(); };
	strip(project.slug);
	if (command === "dt-review" && project.tier !== "T2") strip("quick");
	if (command === "dt-quick") {
		if (project.tier === "T2") throw new Error("/dt-quick is for T0/T1. Use /dt-lane for the selected T2 project.");
		strip(project.type);
		return `/dt-quick ${project.type} ${args || "as aligned"}`;
	}
	if (command === "dt-spec") {
		if (args && !TYPES.includes(args)) throw new Error("Usage: /dt-spec [type]. Switch projects with /dt-resume.");
		return `/dt-spec ${project.slug} ${args || project.type}`;
	}
	if ((command === "dt-slice" || (command === "dt-drift" && args !== "apply")) && args) {
		throw new Error(`Usage: /${command}. Switch projects with /dt-resume.`);
	}
	if (["dt-slice", "dt-amend", "dt-lane", "dt-final-check", "dt-drift"].includes(command) && project.tier !== "T2") {
		throw new Error(`/${command} needs a T2 feature. The selected project is ${project.tier}; use /dt-quick.`);
	}
	if (command === "dt-amend" && (!args || /^(?:--?[\w-]+|""|'')$/.test(args))) {
		throw new Error("Usage: /dt-amend <description of the change>.");
	}
	if (command === "dt-final-check" && !/^\d{1,2}$/.test(args)) {
		throw new Error("Usage: /dt-final-check <ticket ID>. Switch projects with /dt-resume.");
	}
	if (command === "dt-lane") {
		if (args && args !== "next" && !/^\d{1,2}$/.test(args)) throw new Error("Usage: /dt-lane [ticket ID | next]. Switch projects with /dt-resume.");
		args ||= "next";
	}
	if (command === "dt-review" && /\s/.test(args) && !/^\S+\s+autofix$/.test(args)) {
		throw new Error("Usage: /dt-review [ticket ID | branch] [autofix]. Switch projects with /dt-resume.");
	}
	const slug = command === "dt-review" && project.tier !== "T2" ? "quick" : project.slug;
	return `/${command} ${slug}${args ? " " + args : ""}`;
}

// Saved CLI next steps remain usable, but the user sees slugless slash commands.
export function sessionCommand(text, slug) {
	return text.replace(/\/dt-accept\b/g, "/dt-final-check").replace(new RegExp(`(/dt-(?:spec|slice|amend|lane|review|final-check|drift|status)) ${slug}(?=\\s|$)`, "g"), "$1").trim();
}
