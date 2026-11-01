# Overlay: web

- Slices are user-visible paths (route -> API -> storage), not components or layers.
- BDD scenarios describe user intent ("a signed-in user can rename a project"), never selectors or clicks.
- Test at the boundary with realistic data: API tests for contracts, a few end-to-end browser scenarios for the critical path only.
- Verify in a real browser when possible (browser MCP or Playwright): load the page, perform the scenario, capture a screenshot and console/network errors as evidence.
- Pixels and layout are HITL: show me the screenshot, do not assert it in tests.
- Keep UI state, API client, and domain logic in separate modules; the UI must not know storage shapes.
