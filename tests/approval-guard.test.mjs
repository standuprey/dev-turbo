import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalGuard } from "../extensions/dt-session/approval-guard.mjs";

const dt = "node ~/.pi/agent/dt/dt.mjs";
// Incident-shaped reproduction: the later --next is one quoted data argument.
const pendingAndProgress = `${dt} gate demo 4 pending --note "2 findings" && ${dt} progress demo --todo "drift 1: issue -> spec" --todo "drift 2: issue -> accept" --next "/dt-approve drift 1:spec 2:accept"`;

for (const command of [
	pendingAndProgress,
	`${dt} gate demo 4 pending`,
	`${dt} gate demo 2 change`,
	`${dt} gate demo 4 pending --note 'approve gate --status done'`,
	`${dt} progress demo --todo 'approve gate --status done' --next '/dt-approve drift; gate approve --status done'`,
	`${dt} progress demo --status review --next '/dt-approve ticket'`,
	`${dt} progress demo --status review --status done`, // CLI uses the first occurrence.
	`${dt} progress demo --todo 'gate approve' --next "say \"approve\""`,
	`${dt} gate demo 4 pen''ding --note ''`,
	`${dt} gate demo 4 pending # gate approve\n${dt} progress demo --next '/dt-approve drift'`,
	`DT_DIR=/tmp command node -- ~/.pi/agent/dt/dt.mjs gate demo 4 pending`,
	`exec ${dt} gate demo 4 pending`,
	`${dt} gate demo 4 pending && \\\n${dt} progress demo --next '/dt-approve drift'`,
	`git status --short`,
]) test(`allows literal non-approval: ${command}`, () => assert.equal(approvalGuard(command), undefined));

for (const command of [
	`${dt} gate demo 4 approve`,
	`'node' '~/.pi/agent/dt/dt.mjs' "gate" 'demo' "4" 'approve'`,
	`${dt} gate demo 4 ap"pro"ve`,
	`node ~/.pi/agent/dt/d\\t.mjs gate demo 4 approve`,
	`node ~/.pi/agent/dt/d''t.mjs gate demo 4 approve`,
	`~/.pi/agent/dt/dt.mjs gate demo 4 approve`,
	`${dt} progress demo --ticket 00 --status done`,
	`${dt} progress demo --ticket 00 --status "done"`,
	`${dt} progress demo --ticket 00 '--status' 'done'`,
	`${dt} progress demo --todo '--status' done`, // Also an option to the actual CLI.
	`command ${dt} gate demo 4 approve`,
]) test(`blocks literal approval: ${command}`, () => {
	assert.equal(approvalGuard(command)?.block, true);
	assert.match(approvalGuard(command).reason, /Nothing.*persisted/);
});

for (const separator of [" && ", " || ", "; ", "\n", " | ", " & ", " |& "]) {
	for (const forbidden of ["gate demo 4 approve", 'progress demo --status "done"']) {
		const command = `${dt} gate demo 4 pending${separator}${dt} ${forbidden}`;
		test(`blocks later approval across ${JSON.stringify(separator)}: ${forbidden}`, () => assert.equal(approvalGuard(command)?.block, true));
	}
}

for (const command of [
	`bash -c '${dt} gate demo 4 approve'`,
	`eval '${dt} gate demo 4 approve'`,
	`env DT_DIR=/tmp ${dt} gate demo 4 approve`,
	`node --no-warnings ~/.pi/agent/dt/dt.mjs gate demo 4 approve`,
	`${dt} gate demo 4 "$decision"`,
	`${dt} gate demo 4 $(printf approve)`,
	`${dt} gate demo 4 \`printf approve\``,
	`${dt} gate demo 4 $'approve'`,
	`(${dt} gate demo 4 approve)`,
	`{ ${dt} gate demo 4 approve; }`,
	`${dt} gate demo 4 pending > /tmp/out`,
	`${dt} gate demo 4 pending <<EOF\napprove\nEOF`,
	`node ~/.pi/agent/dt/dt.mjs gate demo 4 a*`,
	`${dt} gate demo 4 pending && bash -c '${dt} gate demo 4 approve'`,
	`${dt} gate demo 4 pending && $later`,
	`${dt} gate demo 4 'approve`,
]) test(`fails closed on unsupported dt shell syntax: ${command}`, () => {
	assert.equal(approvalGuard(command)?.block, true);
	assert.match(approvalGuard(command).reason, /Cannot safely inspect/);
});
