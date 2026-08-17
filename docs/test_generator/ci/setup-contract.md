# Test Setup Contract: Alert Notification Dependency Graph  (area: Alerts)

Spec target: `tests/ui-testing/playwright-tests/Alerts/alerts-dependency-graph.spec.js`

The feature reads the client-side graph built from three list APIs cross-referenced by NAME.
There is no reverse-lookup endpoint, so the linkage lives only in:
- `alert.destinations[]` (destination NAMES) → `usage` edge
- destination's `template` (name) → `template` edge
- `alert.template` (name) → `override` edge

Every behavior a test asserts is derived from this. The exact API helpers already exist in
`tests/ui-testing/playwright-tests/Alerts/alerts-history.spec.js` (a spec that establishes the
identical template → destination → alert chain). **Copy those patterns — do not invent setup.**

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it → set up ONCE in `beforeAll` (or reuse a pre-seeded chain).
- **`[per-test]`** — only one test needs it, or a test MUTATES/deletes it → set up INSIDE that test, uniquely named.

### Entity chain (template → destination → alert)
- **`depgraph_tmpl`** — a template (the source of the graph's `template` edge).
  **[shared/read-only]** — Why: template-focus impact dialog, destination default-template edge.
- **`depgraph_dest`** — a custom HTTP destination whose `template` is `depgraph_tmpl`.
  **[shared/read-only]** — Why: destination-focus impact dialog, "Used by" cell on destination list.
- **`depgraph_alert`** — a log alert (on `STREAM_NAME`, see below) with `destinations: ["depgraph_dest"]`
  and `template: null` (no override).
  **[shared/read-only]** — Why: produces the `usage` edge → the destination's alert count badge.
- **`depgraph_alert_override`** — a second log alert with `destinations: ["depgraph_dest"]` **and**
  `template: "depgraph_tmpl"` (alert-level override).
  **[per-test: template override / direct-overrides section]** — Why: exercises the dashed
  `override` edge → "Uses this template directly" section in the template-focus dialog.

### Orphan ("Unused") entities
- **`depgraph_orphan_dest`** — a custom HTTP destination with NO alerts referencing it.
  **[per-test: Unused badge on destination list]** — Why: `orphan` node → "Unused" chip.
- **`depgraph_orphan_tmpl`** — a template referenced by nothing.
  **[per-test: Unused badge on template list]** — Why: `orphan` node → "Unused" chip.

### Dangling reference ("Missing")
- No deterministic API path exists: the backend 409-blocks deleting an entity still referenced by
  an alert/destination, so a `missing` node is not reliably creatable through the public API.
  **Do NOT invent a setup.** If a "Missing" test is planned, mark it `test.fixme` (see Design Doc
  Edge Case 2). The "Missing" chip also lacks a `data-test`.

### Logs stream (alert precondition)
- **`STREAM_NAME = 'e2e_automate'`** — an existing logs stream the alerts query against.
  **[shared/read-only]** — Why: `create_by_alert_id` requires a `stream_name`/`stream_type`. This
  stream is already assumed present by `alerts-history.spec.js` (same constant, line 6).

## How to create it (copy these EXACT patterns — do NOT invent setup)

Reference file: `tests/ui-testing/playwright-tests/Alerts/alerts-history.spec.js`
(`apiCall` wrapper at :12-22; `getAuthHeaders`/`getOrgIdentifier` from `../utils/cloud-auth.js`).

- **Auth/org:** `const org = getOrgIdentifier();` (default `default`). Headers via `getAuthHeaders()`.
  `apiCall` uses `page.evaluate(fetch)` so it bypasses the RUM SDK fetch wrapper.
- **Template** — `POST /api/{org}/alerts/templates` with `{ name, body: JSON.stringify({text:'...'}), isDefault:false }`.
  Accept 200 or 409 (already exists). See `alerts-history.spec.js:24-36` (`ensureTemplate`).
  Page-object alternative: `pm.alertTemplatesPage.ensureTemplateExists(name)` / `createTemplateViaApi(name)`.
- **Destination** — `POST /api/{org}/alerts/destinations` with
  `{ name, url:'https://httpbin.org/post', method:'post', skip_tls_verify:true, template:'depgraph_tmpl', headers:{} }`.
  Accept 200 or 409. See `alerts-history.spec.js:38-53` (`ensureDestination`).
- **Alert (usage + override)** — `POST /api/v2/{org}/alerts?folder=default` with a full payload
  (`name`, `stream_type:'logs'`, `stream_name: STREAM_NAME`, `is_real_time:false`,
  `query_condition`, `trigger_condition`, `destinations:[...]`, `enabled:true`, …).
  - Usage edge: `destinations: ["depgraph_dest"]`.
  - Override edge: add `template: "depgraph_tmpl"` to the SAME payload (alert-level override).
  See `alerts-history.spec.js:55-86` (`createHistoryTestAlert`). Add `template` to the payload for the override case.
- **Orphan destination** — same `POST /api/{org}/alerts/destinations` as above but with NO alert
  ever referencing it (and `template` can be any valid template name or omitted).
- **Orphan template** — same `POST /api/{org}/alerts/templates` with NO destination/alert referencing it.
- **Cleanup (deletes)** — mirror the existing teardown: `DELETE /api/v2/{org}/alerts/{alertId}?folder=default`
  (`alerts-history.spec.js:102-109`); destinations/templates delete via the same
  `destinationService.delete` / `templateService.delete` endpoints the UI uses
  (`DELETE /api/{org}/alerts/destinations` with `{destination_name}`, `DELETE /api/{org}/alerts/templates/{name}`).
  Alert IDs are resolved via `GET /api/v2/{org}/alerts?folder=default` and matching `.name`.

## Preconditions / toggles
- **Navigation** — destinations/templates live in the Reliability nav group, not Settings. Use
  `pm.alertDestinationsPage.navigateToDestinations()` / `pm.alertTemplatesPage.navigateToTemplates()`
  (URL-first: `${ZO_BASE_URL}/web/alert-destinations?org_identifier=<org>` and `/web/alert-templates?...`).
- **Add-button enablement** — the destination "Add" button is disabled until templates load; wait
  for the list skeleton to clear and the button to be enabled before interacting.
- **No SQL/quick-mode toggle needed** — the graph is a pure client-side list cross-reference; no
  query-mode or feature flag gates it (OSS build).
- **Graph is cached 300s** — after a test mutates/deletes an entity, call the same
  refresh path (`getDestinations`/`getTemplates`) or rely on the built-in invalidation; do NOT
  assume a fresh `loadGraph` result without a mutation/refresh.

## Timing / waits (so the Healer/Engineer don't rediscover them)
- The graph resolves only after ALL THREE list calls (`Promise.all`) return AND the host page
  calls `loadDepGraph(org)` in the `.then` of its own list fetch. **Assert "Used by" badges only
  after the table loading skeleton (`[data-test="o2-table-skeleton-body"]`) is hidden** — the cell
  deliberately renders a neutral graph icon while `graph.nodes.length === 0` (loading), never a
  false "Unused".
- After creating entities via API in `beforeAll`, the list fetch + graph build happen on page load;
  if a badge is stale, use the refresh button (`alert-destinations-list-refresh-btn` /
  `template-list-refresh-btn`) which re-runs `getDestinations`/`getTemplates` → invalidate + reload graph.
- Hover-revealed action buttons (`dependency-impact-open-*` / `dependency-impact-delete-*`) require
  hovering the row first; they are `opacity-0` until `group-hover`.

## Gotchas
- **`include_dependencies=true` is required** for the graph's alert list to carry
  `destinations` + `template`. The graph service (`useDependencyGraph.loadGraph`) already sends it;
  tests that create alerts via API do NOT need it, but any test that re-queries alerts and expects
  `destinations` on the DTO must add `&include_dependencies=true`.
- **The graph list call is unpaginated** (returns the full alert list). A very large org makes the
  dialog slower, but the 300s per-org cache prevents repeats.
- **Destination "Add" is disabled with zero templates**; ensure at least one template exists before
  creating a destination via UI (API creation has no such dependency).
- **Delete of a used entity returns 409** — the impact-dialog delete toast shows an error; do not
  assert success on a used entity.
- **"Missing" chip has no `data-test`** and is not API-reachable deterministically — see Design Doc.
