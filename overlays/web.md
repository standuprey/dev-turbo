# Overlay: web

- Slices are user-visible paths (route -> API -> storage), not components or layers.
- UI ticket descriptions name the page or route, visible UI elements, user actions and their visible results.
- Scenarios describe user intent and observable behavior ("saving a new brand in the Add brand dialog adds it to the list"). Use meaningful UI actions when needed, not CSS selectors or incidental click sequences.
- Test at the boundary with realistic data: API tests for contracts, a few browser end-to-end scenarios for the critical path only.
- Verify in a real browser when possible (browser MCP or Playwright): perform the scenario and check console/network errors. Compare the implemented screen/state against the ticket's reference screenshots, respecting their authority and agreed differences; never claim a comparison you did not run. Save a short result, gaps and links through `dt.mjs progress --verification`; do not create an `evidence/` folder or save browser logs by default.
- Visual acceptance remains human-owned: capture and show a screenshot when useful for visual review, do not assert it in tests. Link retained screenshots in `--verification`.
- Keep UI state, API client and domain logic in separate modules; the UI must not know storage shapes.
