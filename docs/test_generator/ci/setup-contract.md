# Test Setup Contract: Alert Creation Redirect Preserves Org Identifier (area: Alerts)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **A notification destination `auto_p0_dest`** **[shared/read-only]** — required so `AddAlertView` renders `AddAlert` instead of bouncing to the list (`AddAlertView.onBeforeMount` bounces when `destinations.length === 0 && !hasPrefill && !isUpdated`). Why: every test that opens the add-alert form to click the header back button.
- **A template `auto_p0_tmpl`** **[shared/read-only]** — created idempotently alongside the destination (the list's "Add Alert" button is disabled when `!destinations.length || !templates.length`; keep it seeded for the list-path variant).
- **Stream `alerts_p0_stream`** **[shared/read-only]** — fields: `city`, `latency`, `status`. Not strictly required to click the header back button, but seeded by the same helper so the stream dropdown is non-empty if the test touches stream selection. No FTS/text requirement for this feature.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Seed everything in one call:** `await seedAlertFixtures(page)` — idempotently POSTs the template, the dogfood destination, and ingests 3 rows into `alerts_p0_stream`. Reference: `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:144-166`; used from specs e.g. `tests/ui-testing/playwright-tests/Alerts/alerts-composite-ui.spec.js:21` (`beforeEach`).
- **Destination only (minimal):** `api(page, 'post', \`${urls().v1}/alerts/destinations\`, { name: 'auto_p0_dest', url: \`${v1}/${SINK}/_json\`, method: 'post', template: 'auto_p0_tmpl', type: 'http', headers: getAuthHeaders() })` — see `alerts-api-helpers.js:150-158`.
- **Auth/org:** `navigateToBase(page)` (from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`) navigates to `/web/?org_identifier=${process.env.ORGNAME}`; `getOrgIdentifier()` (from `utils/cloud-auth.js`) returns the active org (`ORGNAME` env, `'default'` in OSS). Use it for both the URL and the assertion.
- **Navigate to the add form (direct route):** `await page.goto(\`/web/alerts/add?org_identifier=${getOrgIdentifier()}&folder=default\`)` (route name `addAlert`).

## Preconditions / toggles
- No SQL-mode / quick-mode / histogram toggles needed — the header back button is always present in create and edit modes.
- Ensure at least one destination exists **before** navigating to `/web/alerts/add`, or the form is never rendered (bounce + toast).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Selector collision:** `[data-test="add-alert-back-btn"]` is also emitted by `QueryEditorDialog.vue:30` (the query-editor dialog's own back button) and `UploadSourceMaps.vue:21` (RUM page — not in this route). Scope the click to the header back button: use `.first()` (the header button precedes the dialog in the DOM, and the dialog is closed on initial load), or scope within the OPageLayout header. Existing page-object precedent: `alertsPage.js:1748-1761` uses `.first()` + force click.
- **Bounce guard:** if destinations are empty the app redirects to `alertList` with `org_identifier` and shows a "no destinations" toast — a test that skips `seedAlertFixtures` will time out waiting for `add-alert-back-btn`.
- **Back vs Cancel:** the header back button (`goBackToAlertsList`) is the feature; the Cancel button (`add-alert-cancel-btn`) goes through `cancel:hideform` → `router.back()` (history-based) in the route flow. Do not assert on the Cancel button for the org-preservation contract.
- **URL assertion:** `router.push` with the `{ folder, org_identifier }` object serializes deterministically, but assert with a regex or parse `new URL(page.url()).searchParams` (e.g. `toHaveURL(/org_identifier=<org>/)` + check `folder=default`) rather than exact full-URL string matching, to stay robust to param ordering.
- **Async org hydration:** `selectedOrganization.identifier` is set from `route.query.org_identifier` by `MainLayout.setSelectedOrganization` on mount. `goBackToAlertsList` reads it at click time, so a small wait for the form (back button) to be visible before clicking is sufficient — no special wait needed.
