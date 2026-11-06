---
description: T2 - spec with module map, contracts as code, module diagram, implementation plan and self-critique (stops at Architecture)
argument-hint: "[type: web|device|service|cli|mixed]"
---
Write or amend the spec for feature "$1" (type: $2) from the saved project facts and the codebase.

**Existing-project amendment:** if spec.md already exists, read it and saved progress before editing. Read `<features dir>/$1/amendment.md` when present; it carries the proposal from `/dt-amend` and is not approval. Preserve unchanged spec sections, approved decisions, actual ticket IDs and accepted/merged work. Propose only the requested design/behavior delta; do not regenerate the initial plan, renumber saved tickets or imply that merged 00 needs rebuilding. If the proposal is already reflected in the current spec, do not blindly replay it. Ask about any missing contract/behavior decision before editing.

In amendment mode, retain the existing spec structure and revise only affected sections. Show a concise Architecture card: spec path, current → proposed decisions with reasons, affected modules/contracts and actual tickets with status, rollout/verification impact, and only relevant diagrams or uncertainties. Clearly identify preserved work and any extra scope requiring follow-up tickets. Record Architecture pending and end with `/dt-approve architecture` as below; after approval, `/dt-slice` aligns the saved tickets. Initial specs still use the full sections/card below.

Before writing: run `node ~/.pi/agent/dt/dt.mjs info` and take the features dir from it (the spec goes to `<features dir>/$1/spec.md`); read `~/.pi/agent/dt/overlays/$2.md` (for mixed, read every relevant overlay rather than looking for mixed.md). Do not write implementation code.

For initial planning, this is the last step that may rely on this conversation; existing-project amendments use the saved amendment.md proposal: from Architecture on, every session starts from the feature folder alone (`feature.json`, `spec.md`, `tickets/`, `progress.json`). So the spec must carry every decision.

The spec stands on its own: it never mentions the grill, its questions ("grill Q10"), Scope or this conversation. Write every settled decision as a plain statement with its reason, so a reader who never saw the session understands it.

Decisions settled in the grill are binding. If the codebase forces you away from one, ask me in the questions round below (the grill decision, why it no longer holds, the alternatives). Never replace a grill decision with your own preference silently.

## Before writing: questions round

Do not deliver spec.md with decisions still open. First explore the codebase (dispatch a sub-agent with a fresh context when a question needs a fact from the environment) and draft the module map, contracts and plan in scratch, not in spec.md. Collect every decision the grill did not settle and the code cannot answer:
- the shape of a contract, a schema or stored data;
- user-visible behavior, including where the reference design or prototype is ambiguous or conflicts with the codebase;
- a new dependency, a new owner, a build or infrastructure change;
- a grill decision that the codebase contradicts;
- a gap the plan reveals (a slice needs something no contract provides).

Ask them in rounds, as the grill does: the frontier is every question whose prerequisites are settled; ask the whole frontier at once, numbered, wait for my answers, recompute, repeat. Each question is self-contained, because I have not read what you read: first the problem in plain words with its evidence (file, table, function, value), then why it matters (what breaks or is lost otherwise), then the options with their consequences, then your recommendation worded so that "yes" accepts it. Add a rendered diagram when it makes the problem clearer. Format:

```
❓ **Q1** - **<title>**: <problem and evidence> · <why it matters> · <options with consequences>

➡️ <recommended answer>
```

Do not ask about internal choices that change no contract, stored data or user-visible behavior: decide them and list them in section 10. Write spec.md only when the frontier is empty. If writing it raises a new question, stop and ask before delivering. Each answer goes into the spec as a plain decision with its reason. An answer of "out of scope" or "later" becomes a non-goal and, when it has a known next step, a follow-up in section 13.

## Initial spec: sections, in this order (amendments revise only affected sections)

1. **Problem and outcome** - short; the why.
2. **Goals / non-goals** - non-goals are mandatory and specific.
3. **Glossary** - terms settled in the grill; reuse the repo's existing vocabulary.
4. **Module map** - a table: Module | One-sentence responsibility | Public interface | Hides (decisions it keeps private) | Depends on | New or existing. Then the module diagram as a Mermaid block (notation below); it must be the first Mermaid block in the spec (`dt.mjs status` reads it). Rules: few, deep modules (small interface, substantial behavior behind it). A responsibility sentence containing "and" means split or rethink. Every NEW module gets a justification line. Dependencies point one way; flag any cycle. Temporary or one-off work (data migration, backfill, cleanup) is a script that reuses the modules' pure code and is never imported by what ships, unless the grill decided otherwise.
5. **Contracts** - the public interfaces as real code in the repo's language (types, signatures, DTOs, protocol messages). I review these line by line.
6. **Behaviors** - per capability, scenario TITLES only (declarative Given/When/Then one-liners). No full Gherkin yet.
7. **Scale and operability** - the targets from the grill (load, volume, growth, latency), what is bounded and what could grow without bound, behavior under failure and overload (timeouts, retries, backpressure, idempotency), what we log or measure, and which boundaries this shapes. If the grill concluded scale does not matter: say why in one line and name the trigger that would change that.
8. **Verification strategy** - per overlay: what is tested at which boundary, what needs a browser or a real device, what is faked and where the fake lives, how each scale target gets checked.
9. **Irreversible or risky decisions** - and how we de-risk each (spike, flag, dry-run).
10. **Critique** - be a skeptical senior architect on your own module map. Score each module 1-5 with one line of evidence: single responsibility, depth, contract clarity, dependency direction, testable at its boundary, scale fit. Then the 3 decisions you are least sure about, and every choice made while writing the spec that is not yet confirmed (titled as such, without reference to the grill).
11. **Open questions** - only what nobody in this conversation can answer yet (another team, a measurement, a spike), each with who answers it and which slice it blocks; "none" is the normal case. Decisions are not open questions: they were asked before writing.
12. **Implementation plan** - the cut and the order that `/dt-slice` will turn into tickets (it adds Gherkin and frontmatter; it does not re-plan). Draft it before freezing section 5: a contract the plan needs but section 5 lacks goes into section 5 and is flagged in section 10, never hidden in a slice. Follow the slicing rules: 00 is the walking skeleton and holds every contract; every slice is vertical (route -> API -> storage, or the overlay's equivalent), never a layer; roughly one module boundary and under ~300 lines of change per slice; anything shared (schema migration, dependency bump, build flag, generated file) is its own slice that lands first. Give:
    - **Milestones** - a table: Milestone | Slices | When it lands you can... (what I can test or demo) | What users see (nothing / behind a flag / live).
    - **Slices** - a table: id | Slice (one line, a demoable or verifiable outcome) | Kind (AFK, or HITL with who and why) | Blocked by | Touches | When it lands you can...
    - **Dependency graph** - the slices as a Mermaid `flowchart LR` (`A --> B` = B needs A).
    - **Lanes and release order** - at most 2 slices in flight: which slices form each lane and which serialize because they share touches or a file; the critical path; the deploy order across services; the build-up mechanism (flag, hidden route) and the cutover or rollout steps when there is one.
    - **Scale checks** - a table: Target | Slice | Check. Each target from section 7 is checked in the slice that creates the risk, as early as possible.
    - **Estimate** - slices and effort. If it differs from the rough size recorded at Scope, say so on the gate card, not in the spec.
    - **Slicing decisions you are least sure about** - up to 3.
13. **Follow-ups** - work left out on purpose that should become its own ticket after this feature: a non-goal with a known next step, a deferred check, a limitation accepted for now. One subsection each (`F1`, `F2`...): today's behavior and its consequence, with evidence (file, function, table); the change; what it needs (data checks, contract or ownership changes, choices still open, with options); what it unlocks; what stays out even then. The non-goal or risk it resolves points to it. Only non-goals with a known next step belong here; "none" is fine.

Module diagram notation (the same in every diagram of this feature): `flowchart LR`; one node per module labelled `name - public interface in one line`; a `subgraph` per layer or package; `A --> B` means A depends on B's public API; dashed edge or dashed border (`stroke-dasharray: 5 5`) = new in this feature; a one-line legend under the diagram.

## Architecture approval (stop here)

STOP. First record that the gate is waiting, so a new session knows: `node ~/.pi/agent/dt/dt.mjs gate $1 1 pending --note "<one line: what is up for approval>"`. Then, in chat, post the targeted amendment card described above for an existing-project amendment; use the full card below only for an initial spec. Show diagrams rendered (with the `mermaid-render` skill when it is available), not as Mermaid source; when a rendered graph is unreadable, split it per layer or package and say which edges each part leaves out. The spec keeps the Mermaid source.
1. What you are approving, in at most 10 lines: the modules, who depends on whom, the plan in one line (slices, milestones, lanes, estimate, and how it compares with Scope), and the follow-ups in one line (section 13).
2. The module diagram (section 4).
3. The plan: the milestone table and the lanes or slice dependency graph (section 12).
4. The 3 decisions I am least sure about (section 10) and the slicing decisions (section 12).
5. Look yourself: up to 5 files, interfaces or spec sections I should read, with why.
6. "Next command: `/dt-approve architecture`. Discussion is for changes, not approval."

Only `/dt-approve architecture` records approval (standalone: it opens the feature issue). Never record approval from a chat yes. Discuss changes, revise the spec and record `pending` again before posting an updated card. Do not write tickets until architecture is approved. After approval, the next command is `/dt-slice`.
