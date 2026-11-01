---
description: T2 - spec with module map, contracts as code, module diagram and self-critique (stops at Gate 1)
argument-hint: "<slug> <type: web|device|service|mixed>"
---
Write the spec for feature "$1" (type: $2) from our grill session and the codebase.

Before writing: run `node ~/.pi/agent/dt/dt.mjs info` and take the features dir from it (the spec goes to `<features dir>/$1/spec.md`); read `~/.pi/agent/dt/overlays/$2.md` (for mixed, every relevant overlay). Do not write implementation code.

## Sections, in this order

1. **Problem and outcome** - short; the why.
2. **Goals / non-goals** - non-goals are mandatory and specific.
3. **Glossary** - terms settled in the grill; reuse the repo's existing vocabulary.
4. **Module map** - a table: Module | One-sentence responsibility | Public interface | Hides (decisions it keeps private) | Depends on | New or existing. Then the module diagram as a Mermaid block (notation below). Rules: few, deep modules (small interface, substantial behavior behind it). A responsibility sentence containing "and" means split or rethink. Every NEW module gets a justification line. Dependencies point one way; flag any cycle.
5. **Contracts** - the public interfaces as real code in the repo's language (types, signatures, DTOs, protocol messages). I review these line by line.
6. **Behaviors** - per capability, scenario TITLES only (declarative Given/When/Then one-liners). No full Gherkin yet.
7. **Scale and operability** - the targets from the grill (load, volume, growth, latency), what is bounded and what could grow without bound, behavior under failure and overload (timeouts, retries, backpressure, idempotency), what we log or measure, and which boundaries this shapes. If the grill concluded scale does not matter: say why in one line and name the trigger that would change that.
8. **Verification strategy** - per overlay: what is tested at which boundary, what needs a browser or a real device, what is faked and where the fake lives, how each scale target gets checked.
9. **Irreversible or risky decisions** - and how we de-risk each (spike, flag, dry-run).
10. **Critique** - be a skeptical senior architect on your own module map. Score each module 1-5 with one line of evidence: single responsibility, depth, contract clarity, dependency direction, testable at its boundary, scale fit. Then the 3 decisions you are least sure about, and everything in the map that was your choice rather than something we agreed.
11. **Open questions** - only real ones.

Module diagram notation (the same in every diagram of this feature): `flowchart LR`; one node per module labelled `name - public interface in one line`; a `subgraph` per layer or package; `A --> B` means A depends on B's public API; dashed edge or dashed border (`stroke-dasharray: 5 5`) = new in this feature; a one-line legend under the diagram.

## Gate 1 (stop here)

STOP. In chat, post the gate card:
1. What you are approving, in at most 10 lines: the modules and who depends on whom.
2. The module diagram (the Mermaid block from section 4).
3. The 3 decisions I am least sure about (from section 10).
4. Look yourself: up to 5 files or interfaces I should read, with why.
5. "Approve Gate 1, or what changes?"

On my approval: save the card to a temp file and run `node ~/.pi/agent/dt/dt.mjs gate $1 1 approve --card <file> --note "<my words>"` (in standalone modality this also opens the feature issue on GitHub). If I ask for changes, revise the spec and post the card again. Do not slice until Gate 1 is approved.
