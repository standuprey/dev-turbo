const clean = (value) => String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();

export function dependencyStackCandidate(project, snapshot, id) {
  if (!["T1", "T2"].includes(project.tier)) return null;
  const ticket = snapshot.tickets.find((t) => t.id === id.padStart(2, "0"));
  if (!ticket || !["todo", "in_progress"].includes(snapshot.st[ticket.id]?.status)) return null;
  const unmet = ticket.blocked_by.filter((dep) => snapshot.st[dep]?.status !== "done");
  if (unmet.length !== 1 || snapshot.st[unmet[0]]?.status !== "review") return null;
  const dependency = snapshot.tickets.find((t) => t.id === unmet[0]);
  const saved = snapshot.prog.tickets[unmet[0]] || {};
  if (!dependency || (saved.prs?.length && saved.prs.every((pr) => ["merged", "closed"].includes(pr.state)))) return null;
  const branch = clean(saved.branch);
  if (branch && snapshot.prog.tickets[ticket.id]?.prs?.some((pr) => ["open", "draft"].includes(pr.state) && pr.base === branch)) return null;
  const prs = (saved.prs || []).filter((pr) => ["open", "draft"].includes(pr.state));
  return { ticket: ticket.id, dependency: dependency.id, title: clean(dependency.title), branch,
    prs: prs.map((pr) => ({ number: pr.number, url: clean(pr.url), branch: clean(pr.branch) })) };
}

// This choice grants stack consent only; normal start-warning confirmation still follows.
export async function chooseDependencyStack({ ctx, project, snapshot, id }) {
  const candidate = dependencyStackCandidate(project, snapshot, id);
  if (!candidate) return { action: "continue" };
  if (!ctx.hasUI) {
    ctx.ui.notify(`Ticket ${candidate.dependency} is in review. Run /dt-lane ${candidate.ticket} interactively to choose stacking or waiting; override alone does not approve a stack.`, "warning");
    return { action: "continue", declined: candidate };
  }
  const stack = `Stack PR on ticket ${candidate.dependency}${candidate.branch ? ` (${candidate.branch})` : ""}`;
  const wait = `Wait for ticket ${candidate.dependency} to merge`;
  const start = "Start without stacking";
  const links = candidate.prs.map((pr) => pr.url || `PR #${pr.number}`).join(" · ");
  const selected = await ctx.ui.select(`Ticket ${candidate.ticket} is blocked by ${candidate.dependency} · ${candidate.title}, in review.\n${links ? links + "\n" : ""}Stacking branches off its review branch and targets it; merge it first, then retarget to main. Later updates may need conflict resolution.\nStart warnings still require separate confirmation.`, [stack, wait, start]);
  if (selected === stack) return { action: "stack", candidate };
  if (selected === start) return { action: "continue", declined: candidate };
  return { action: "stop" };
}

export function stackConsentMessage(slug, candidate) {
  return { customType: "dt-stack-decision", display: true, details: { slug, ...candidate },
    content: `User explicitly chose to stack PR for ${slug} ticket ${candidate.ticket} on ticket ${candidate.dependency}'s review branch${candidate.branch ? ` (${candidate.branch})` : ""}. Branch off that review head and target it, not main; preserve existing PR URLs and include merge sequencing. This is separate stack consent, not permission to bypass any other blockers or setup. Verify the dependency's actual open PR and head before changing branches; follow Dependency in review instead of creating a new branch or PR from main. Save the agreed base and merge order in progress.` };
}
