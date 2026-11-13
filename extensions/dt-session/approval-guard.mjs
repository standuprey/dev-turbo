const APPROVAL = "Approvals are user commands. Ask the user to run /dt-approve <gate>; do not record approval from discussion. Nothing in this shell call was persisted.";
const UNSUPPORTED = "Cannot safely inspect this dt.mjs shell call. Use literal node dt.mjs arguments in simple commands (no expansions, shell wrappers, grouping or redirections). Nothing in this shell call was persisted; approvals require user /dt-approve.";

// Deliberately a static shell subset, not a shell interpreter. Keep argument
// boundaries through quoting/escaping and inspect every command in a list.
// Unsupported syntax fails closed for calls mentioning dt.mjs, even when the
// first invocation is harmless. Never execute shell text to resolve arguments.
function shellCommands(source) {
	const commands = [], words = [];
	let value = "", started = false, quote = "", unsupported = false;
	const word = () => { if (started) words.push(value); value = ""; started = false; };
	const command = () => { word(); if (words.length) commands.push(words.splice(0)); };
	for (let i = 0; i < source.length; i++) {
		const c = source[i];
		if (quote === "'") {
			if (c === "'") quote = ""; else value += c;
			continue;
		}
		if (c === "\\") {
			const next = source[i + 1];
			if (next === undefined) { unsupported = true; break; }
			if (next === "\n") { i++; continue; }
			if (!quote || '$`"\\'.includes(next)) { value += next; started = true; i++; continue; }
			value += c; continue;
		}
		if (quote === '"') {
			if (c === '"') quote = "";
			else { if (c === "$" || c === "`") unsupported = true; value += c; }
			continue;
		}
		if (c === "'" || c === '"') { quote = c; started = true; continue; }
		if (c === "#" && !started) { while (i + 1 < source.length && source[i + 1] !== "\n") i++; continue; }
		if (c === "\n" || ";|&".includes(c)) {
			command();
			if ((c === "|" || c === "&") && source[i + 1] === c) i++;
			continue;
		}
		if (/\s/.test(c)) { word(); continue; }
		if ('$`(){}<>*?[]'.includes(c) || (c === "~" && (started || source[i + 1] !== "/"))) unsupported = true;
		value += c; started = true;
	}
	if (quote) unsupported = true;
	command();
	return { commands, unsupported };
}

const base = (value) => value.split("/").at(-1);
const mentionsDt = (value) => value.includes("dt.mjs");

export function approvalGuard(command) {
	const { commands, unsupported } = shellCommands(String(command));
	const relevant = mentionsDt(String(command)) || commands.some((args) => args.some(mentionsDt));
	if (!relevant) return undefined;
	if (unsupported) return { block: true, reason: UNSUPPORTED };
	for (const words of commands) {
		let args = words;
		// Literal environment assignments and these two non-evaluating builtins
		// do not change the remaining executable's argument boundaries.
		while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(args[0] || "")) args = args.slice(1);
		while (["command", "exec"].includes(args[0])) args = args.slice(1);
		let scriptArgs;
		if (base(args[0] || "") === "dt.mjs") scriptArgs = args.slice(1);
		else if (base(args[0] || "") === "node") {
			const start = args[1] === "--" ? 2 : 1;
			if (base(args[start] || "") === "dt.mjs") scriptArgs = args.slice(start + 1);
		}
		if (!scriptArgs) {
			if (args.some(mentionsDt)) return { block: true, reason: UNSUPPORTED };
			continue;
		}
		// Match dt.mjs's positional dispatch and opt(): options are exact argv
		// entries, not substrings, and the first --status wins. Do not skip an
		// argv entry because another option could also consume it as data:
		// dt.mjs itself scans all entries for options.
		const status = scriptArgs.indexOf("--status");
		if ((scriptArgs[0] === "gate" && scriptArgs[3] === "approve") ||
			(scriptArgs[0] === "progress" && status >= 0 && scriptArgs[status + 1] === "done")) {
			return { block: true, reason: APPROVAL };
		}
	}
	return undefined;
}
