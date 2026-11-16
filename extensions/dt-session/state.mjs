export const ENTRY = "dt-project";
export const TYPES = ["web", "device", "service", "cli", "mixed"];
export const COMMANDS = new Set(["dt-lane", "dt-review", "dt-revise", "dt-staging-test"]);
// Retired commands point to their replacement instead of reaching the model as unknown prompts.
export const RETIRED = { "dt-spec": "/dt-revise", "dt-slice": "/dt-revise", "dt-amend": "/dt-revise <change>", "dt-drift": "/dt-revise", "dt-quick": "/dt-lane" };
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
	if (parsed && Object.hasOwn(RETIRED, parsed[1])) throw new Error(`/${parsed[1]} was removed. Use ${RETIRED[parsed[1]]}.`);
	if (!parsed || !COMMANDS.has(parsed[1])) return null;
	if (!project) throw new Error("No dev-turbo project selected. Run /dt-resume [slug], or /dt-start <task> and approve the plan.");
	const command = parsed[1];
	let args = (parsed[2] || "").trim();
	const strip = (word) => { if (args === word) args = ""; else if (args.startsWith(word + " ")) args = args.slice(word.length + 1).trim(); };
	strip(project.slug);
	if (command === "dt-lane") {
		if (args && args !== "next" && !/^\d{1,2}(?: (?:force|override))?$/.test(args)) throw new Error("Usage: /dt-lane [ticket ID [force|override]]. Switch projects with /dt-resume.");
		if (args === "next") args = ""; // Legacy alias now opens the picker too.
	}
	if (command === "dt-review" && /\s/.test(args) && !/^\S+\s+autofix$/.test(args)) {
		throw new Error("Usage: /dt-review [ticket ID | branch] [autofix]. Switch projects with /dt-resume.");
	}
	if (command === "dt-staging-test" && args && !/^\d{1,2}$/.test(args)) {
		throw new Error("Usage: /dt-staging-test [ticket ID]. Switch projects with /dt-resume.");
	}
	return `/${command} ${project.slug}${args ? " " + args : ""}`;
}

// Saved CLI next steps remain usable, but the user sees slugless slash commands.
export function sessionCommand(text, slug) {
	return text
		.replace(new RegExp(`/(?:dt-final-check|dt-accept|dt-approve(?: ticket)?) (?:${slug} )?\\d{1,2}(?=\\s|$)`, "g"), "/dt-check-merged")
		.replace(/\/dt-approve ticket(?=\s|$)/g, "/dt-check-merged")
		.replace(new RegExp(`/dt-(?:spec|slice|amend|drift)(?: ${slug})?(?: (?:web|device|service|cli|mixed|apply))?(?=\\s|$)`, "g"), "/dt-revise")
		.replace(/\/dt-approve (?:architecture|slices|scope)(?=\s|$)/g, "/dt-approve plan")
		.replace(new RegExp(`(/dt-(?:revise|lane|review|status|staging-test)) ${slug}(?=\\s|$)`, "g"), "$1")
		.replace(/\/dt-lane next(?=\s|$)/g, "/dt-lane").trim();
}
