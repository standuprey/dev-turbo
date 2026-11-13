# Overlay: web

- Slices are user-visible paths (route -> API -> storage), not components or layers.
- UI ticket descriptions name the page or route, visible UI elements, user actions and their visible results; keep mixed UI/backend work concrete too.
- BDD scenarios describe user intent and observable behavior ("saving a new brand in the Add brand dialog adds it to the list"). Use meaningful UI actions when needed, not CSS selectors or incidental click sequences.
- Test at the boundary with realistic data: API tests for contracts, a few end-to-end browser scenarios for the critical path only.
- Verify in a real browser when possible (browser MCP or Playwright): load the page, perform the scenario, and check console/network errors. Save a short result and useful links through `dt.mjs progress --verification`; do not create an `evidence/` folder or save browser logs by default.
- Read the ticket's UI reference section, linked screenshots and `references/ui/manifest.md` before implementing UI, including mixed UI/backend work. Missing references without an explicit user-approved waiver require `/dt-revise`, not an invented design.
- Compare the implemented screen/state against the ticket's reference screenshots during browser verification, respecting reference authority and agreed differences. Save the result and remaining gaps with `--verification`; do not claim a comparison if it was not run. Visual acceptance remains human-owned. Preserve planning captures; they are required inputs unless explicitly waived, not optional verification logs.
- Pixels and layout are HITL: capture and show a screenshot when useful for visual review, do not assert it in tests. Link retained screenshots in `--verification`.
- Keep UI state, API client, and domain logic in separate modules; the UI must not know storage shapes.
