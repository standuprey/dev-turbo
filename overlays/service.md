# Overlay: service (inside the big monorepo)

- The unit of design is the module with a public API package; everything else is internal. Other modules may only depend on the public API.
- Ticket 00 defines the public API and contract tests. Consumer-facing behavior is tested at that boundary, not through internals.
- Build and test affected targets only, with the `checks` command from `dt.mjs info`; never run the whole monorepo suite as a routine step.
- Lanes are the clones listed by `dt.mjs info`. Tickets in flight together must not share modules, generated code, migrations or lockfiles: `dt.mjs next` enforces `touches` and `unsafe_with`, the slicing encodes the rest. Anything shared (schema migration, dependency bump, flag wiring) is its own slice that lands first.
- Rollout concerns (feature flag, migration order, backward compatibility) are explicit slices, not afterthoughts.
- Check for shared local state between clones (ports, local DB, caches) before running two lanes at once.
- Follow the repo's existing conventions (build files, package layout, test framework) over generic advice.
