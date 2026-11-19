# Overlay: service

- Each module exposes a public API package; everything else is internal. Other modules use only the public API.
- Ticket 00 defines the public API and contract tests; test consumer behavior at that boundary.
- Build and test affected targets with the `checks` command; no routine full suite.
- Rollout concerns (feature flag, migration order, backward compatibility) get explicit tickets.
- Before running lanes in parallel, check for local state shared between worktrees (ports, local DB, caches).
- Repo conventions (build files, package layout, test framework) beat generic advice.
