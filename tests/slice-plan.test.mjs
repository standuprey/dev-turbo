import assert from "node:assert/strict";
import { test } from "node:test";
import { slicePlan, renderSlicePlan } from "../extensions/dt-slice-plan/plan.mjs";
import { normalizeProgress, pickReady, deriveStatuses } from "../dt.mjs";

const ticket = (id, blocked_by = [], touches = [], unsafe_with = []) => ({ id, blocked_by, touches, unsafe_with });
const plan = (tickets, progress = {}, options = {}) => {
  const prog = normalizeProgress(progress);
  return slicePlan({ tickets, prog, st: deriveStatuses(tickets, prog) }, { ...options, pickReady });
};
const allPlan = (tickets, ticketsProgress = {}, extra = {}) => plan(tickets, {
  gates: { G2: { state: "approved" } }, tickets: ticketsProgress, ...extra,
}, { all: true });

test("all reconstructs batches from the beginning and labels current closed, active and blocked slices", () => {
  const tickets = [ticket("00"), ticket("01", ["00"]), ticket("02", ["00"]), ticket("03", ["01", "02"]), ticket("04", ["03"])];
  const progress = { "00": { status: "done", branch: "ticket/demo-00" }, "01": { status: "in_progress" } };
  const result = allPlan(tickets, progress);
  assert.equal(renderSlicePlan(result), "Completion: 30%\nSlice 1 [closed] · 100%: 00\nSlice 2 [in-flight] · 25%: 01, 02\nSlice 3 [blocked] · 0%: 03\nSlice 4 [blocked] · 0%: 04");
  const finished = Object.fromEntries(tickets.map(({ id }) => [id, { status: "done" }]));
  assert.deepEqual(allPlan(tickets, finished).slices, result.slices);
  assert.deepEqual(allPlan(tickets, finished).statuses, ["closed", "closed", "closed", "closed"]);
  assert.deepEqual(allPlan([...tickets].reverse(), progress), result);
  assert.deepEqual(plan(tickets, { tickets: progress }).slices, [["01", "02"], ["03"], ["04"]]);
});

test("all keeps review and reopened work active and uses ready guards without treating future batches as ready", () => {
  const tickets = [ticket("00"), ticket("01", ["00"], ["shared"]), ticket("02", ["00"], ["shared"]), ticket("03", ["00"], [], ["01"]), ticket("04", ["00"])];
  const progress = { "00": { status: "done" }, "01": { status: "review" }, "04": { blockers: ["Access needed"] } };
  const result = allPlan(tickets, progress);
  assert.deepEqual(result.statuses, ["closed", "in-flight", "blocked"]);
  assert.deepEqual(allPlan([ticket("00")]).statuses, ["in-flight"]);
  assert.deepEqual(allPlan([ticket("00")], {}, { blockers: ["Access needed"] }).statuses, ["blocked"]);
  assert.deepEqual(allPlan([ticket("00")], {}, { gates: {} }).statuses, ["blocked"]);
  assert.deepEqual(allPlan([ticket("00")], { "00": { status: "review", prs: [{ state: "merged" }] } }).statuses, ["closed"]);
  assert.deepEqual(allPlan([ticket("00")], { "00": { status: "in_progress", reopened: true, prs: [{ state: "merged" }] } }).statuses, ["in-flight"]);
  assert.deepEqual(allPlan([ticket("00"), ticket("01")], { "00": { status: "done" }, "01": { blockers: ["Access needed"] } }).statuses, ["blocked"]);
});

test("all retains empty-project and invalid-dependency reporting without changing saved data", () => {
  assert.equal(renderSlicePlan(allPlan([])), "Completion: 0%\nNo slices.");
  const tickets = [ticket("00"), ticket("01", ["99"]), ticket("02", ["03"]), ticket("03", ["02"])];
  const snapshot = { tickets, prog: normalizeProgress({ gates: { G2: { state: "approved" } }, tickets: { "00": { status: "done" } } }) };
  const before = structuredClone(snapshot);
  const result = slicePlan(snapshot, { all: true });
  assert.deepEqual(snapshot, before);
  assert.deepEqual(result.slices, [["00"]]);
  assert.equal(result.blocked.length, 3);
  const branches = { "00": "ticket/demo-00", "01": "ticket/demo-01" };
  const output = renderSlicePlan({ ...result, branches });
  assert.doesNotMatch(output, /ticket\/demo-/);
  assert.match(output, /Ticket 01: blocked by 99/);
  assert.match(renderSlicePlan(result), /Slice 1 \[closed\].*Cannot schedule.*Ticket 01: blocked by 99/s);
});

test("completion averages saved ticket progress, including unschedulable work, without counting readiness", () => {
  const tickets = [ticket("00"), ticket("01"), ticket("02"), ticket("03", ["99"]), ticket("04")];
  const progress = { "00": { status: "done" }, "01": { status: "in_progress" }, "02": { status: "review" }, "03": { status: "todo" }, "04": { status: "todo" } };
  const result = allPlan(tickets, progress);
  assert.equal(result.completion, 40);
  assert.deepEqual(result.sliceCompletions, [50]);
  assert.equal(result.blocked.length, 1);
  assert.equal(allPlan([ticket("00")]).completion, 0, "ready is not started");
  assert.equal(allPlan([ticket("00")], { "00": { status: "review", prs: [{ state: "merged" }] } }).completion, 100);
  assert.equal(allPlan([ticket("00")], { "00": { status: "in_progress", reopened: true, prs: [{ state: "merged" }] } }).completion, 50);
  assert.equal(allPlan([ticket("00"), ticket("01"), ticket("02")], { "00": { status: "in_progress" } }).completion, 17);
  assert.equal(allPlan(tickets, Object.fromEntries(tickets.map(({ id }) => [id, { status: "done" }]))).completion, 100);
  assert.equal(plan(tickets, { tickets: progress }).completion, undefined, "remaining-only output stays unchanged");
});

test("dependencies and asymmetric unsafe pairs split batches; shared modules do not", () => {
  const tickets = [ticket("00"), ticket("07", ["00"], ["a"]), ticket("42", ["00"], ["b"]),
    ticket("15", ["07"], ["a"]), ticket("16", ["42"], ["c"]), ticket("44", ["07"], ["d"]),
    ticket("19", ["15"], ["c"]), ticket("20", ["16"], ["e"])];
  const progress = { tickets: { "00": { status: "review", prs: [{ state: "merged" }] } } };
  assert.equal(renderSlicePlan(plan(tickets, progress)), "Slice 1: 07, 42\nSlice 2: 15, 16, 44\nSlice 3: 19, 20");
  assert.deepEqual(plan([ticket("01", [], ["a"]), ticket("02", [], ["a"]), ticket("03", [], ["b"], ["01"])]).slices, [["01", "02"], ["03"]]);
});

test("done and fully merged tickets satisfy dependencies; partial, closed and reopened PRs stay", () => {
  const tickets = [ticket("00"), ticket("01", ["00"]), ticket("02", ["01"]), ticket("03"), ticket("04"), ticket("05")];
  const progress = { tickets: {
    "00": { status: "done" }, "01": { status: "review", prs: [{ state: "merged" }, { state: "merged" }] },
    "02": { status: "in_progress" }, "03": { prs: [{ state: "merged" }, { state: "open" }] },
    "04": { prs: [{ state: "closed" }] }, "05": { reopened: true, prs: [{ state: "merged" }] },
  } };
  assert.deepEqual(plan(tickets, progress).slices, [["02", "03", "04", "05"]]);
  assert.deepEqual(plan([ticket("01")], { tickets: { "01": { status: "review", prs: [] } } }).slices, [["01"]]);
});

test("numeric ID order is stable regardless of ticket input order and does not cap batch size", () => {
  const tickets = [ticket("10"), ticket("2"), ticket("01"), ticket("03"), ticket("04")];
  const before = structuredClone(tickets);
  assert.deepEqual(plan(tickets).slices, [["01", "2", "03", "04", "10"]]);
  assert.deepEqual(plan([...tickets].reverse()), plan(tickets));
  assert.deepEqual(tickets, before);
});

test("missing dependencies, cycles and dependent tails are reported alongside schedulable work", () => {
  const result = plan([ticket("01", ["02"]), ticket("02", ["01"]), ticket("03", ["02"]), ticket("04", ["99"]), ticket("05"), ticket("06", ["05"])]);
  assert.deepEqual(result.slices, [["05"], ["06"]]);
  assert.deepEqual(result.blocked, [{ id: "01", blocked_by: ["02"] }, { id: "02", blocked_by: ["01"] }, { id: "03", blocked_by: ["02"] }, { id: "04", blocked_by: ["99"] }]);
  assert.match(renderSlicePlan(result), /Ticket 04: blocked by 99/);
  assert.match(renderSlicePlan(plan([ticket("00", ["00"])])), /Cannot schedule/);
  assert.throws(() => plan([ticket("00"), ticket("00")]), /Duplicate ticket ID/);
});

test("saved ticket branches appear in parentheses without inventing missing branches", () => {
  const result = plan([ticket("01"), ticket("02"), ticket("03", ["99"])], { tickets: {
    "01": { status: "in_progress", branch: "ticket/demo-01" },
    "03": { branch: "quick/fix" },
  } });
  assert.equal(renderSlicePlan(result), "Slice 1: 01 (ticket/demo-01), 02\nCannot schedule (missing dependencies or dependency cycle):\nTicket 03 (quick/fix): blocked by 99");
});

test("empty and complete projects show no remaining slices", () => {
  assert.equal(renderSlicePlan(plan([])), "No remaining slices.");
  assert.equal(renderSlicePlan(plan([ticket("00")], { tickets: { "00": { status: "done" } } })), "No remaining slices.");
});

test("slice planning ignores touches but keeps dependency and unsafe rules; start guards remain unchanged", () => {
  const tickets = [ticket("00"), ticket("01", ["00"], ["a"]), ticket("02", ["00"], ["a"]), ticket("03", ["00"], [], ["01"]), ticket("04", ["02", "03"])];
  const prog = normalizeProgress();
  const before = structuredClone(prog);
  const result = slicePlan({ tickets, prog });
  assert.deepEqual(prog, before);
  assert.deepEqual(result.slices, [["00"], ["01", "02"], ["03"], ["04"]]);
  assert.throws(() => pickReady(tickets, deriveStatuses(tickets, normalizeProgress({ tickets: { "00": { status: "done" }, "01": { status: "in_progress" } } })), "02"), /touches a/);
  const withoutTouches = tickets.map((t) => ({ ...t, touches: [] }));
  for (const batch of result.slices) {
    for (const id of batch) {
      assert.equal(pickReady(withoutTouches, deriveStatuses(withoutTouches, prog), id).id, id);
      prog.tickets[id] = { status: "in_progress" };
    }
    for (const id of batch) prog.tickets[id].status = "done";
  }
});
