# Test Setup Contract: Status Page Powered-by Brand Link  (area: GeneralTests)

Spec: `tests/ui-testing/playwright-tests/GeneralTests/statusPageBrandLink.spec.js`

## Streams / data the spec must establish

Status pages are **not** stream-backed — no ingestion is needed. The only data the feature needs is
a **status page record** (and, for the public-page test, that it be **published**). No streams,
fields, or ingestion helpers are involved.

- `status_page` **[per-test: both TCs]** — one page per test, uniquely named (e.g.
  `Brand Link Test ${Date.now()}`), so the public-plane 30s slug cache never collides across tests.
  - **Public-page TC** must then be **published**: `visibility = 1`.
  - **Preview TC** can stay `draft` (the editor preview renders for any page).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Seed a page (admin API, basic auth):** copy `seedStatusPage(page, orgId)` verbatim from
  `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:27-44`.
  It POSTs to `${baseUrl}/api/${orgId}/status_pages` with `{ name, description }` and returns the
  page `id` (the response is a `PageAdminView` that also carries `slug`).
  - `baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '')`
    (backend origin — see `statusPagesPage.detectBuildType` at
    `tests/ui-testing/pages/generalPages/statusPagesPage.js:43-54`).
  - Auth header: `Basic ${Buffer.from(\`${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}\`).toString('base64')}`.
- **Publish the page (only for the public-page TC):** `PUT /api/${orgId}/status_pages/${id}` with
  body `{ "visibility": 1 }` (1 = public; see `UpdatePageRequest.visibility` at
  `src/config/src/meta/status_pages.rs:182`). The response is a `PageAdminView` — read `body.slug`
  from either the create or update response.
- **Navigate to the public page:** `${backendBaseUrl}/status/${slug}` (NOT the `/web/` SPA). The
  brand link is static in the served shell, so assert on it immediately after
  `page.goto(...)` + `waitForLoadState('domcontentloaded')`. Do **not** wait for the snapshot —
  a just-published page answers `202` from `/api/status_pages_public/{slug}` and shows the
  "Collecting first data" banner, but the shell (and brand link) still renders.
- **Navigate to the editor preview:** `${process.env['ZO_BASE_URL']}/web/synthetics/status-pages/edit/${id}?org_identifier=${orgId}`
  (route `synthetics-status-page-edit`, `web/src/composables/shared/useEnterpriseRoutes.ts:224`).
  Wait for the editor to finish loading before asserting — the preview only mounts once
  `statusPagesService.get` resolves (see `StatusPageEditor.vue:54-71`). Use an existing editor
  `data-test` (e.g. `status-page-editor-save`) as the wait anchor, then assert the preview's two
  brand links.

## Preconditions / toggles

- `synthetics.enabled` must be on (public routes `/status/{slug}` and `/api/status_pages_public/*`
  are registered only then — `src/api/http/src/handler/http/router/mod.rs:707`). No further toggles.
- Org: `ORGNAME` (default `default`); authenticated SPA for the preview TC via
  `navigateToBase(page)` + `PageManager` (same as `status-pages-enterprise-gating.spec.js:50-55`).
- The public-page TC is **unauthenticated** and targets the backend origin, so it does not need
  `navigateToBase` — only the page-seed API call needs the basic-auth header.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The brand link has no `data-test` in either file.** The public page uses `class="brandlink"`;
  the preview uses no distinguishing attribute. Use attribute-based fallbacks, never text matching:
  `a.brandlink[href="https://openobserve.ai/"]` (public, expect 2) and
  `a[href="https://openobserve.ai/"]` (preview, expect 2). Distinguish header vs footer by scope:
  `span.brand.header-brand a.brandlink` vs `span.brand a.brandlink`.
- **Publish or you get 404.** `visibility=0` (draft) maps to `Cached::Missing` →
  `not_found()` (`public.rs:449`). The public-page assertion MUST run against a `visibility=1` page.
- **Don't wait for the snapshot.** The shell is served for both `Public` and `Unbuilt`
  (`public.rs:154-155`); the brand link is static markup and renders even when the JSON fetch is a
  `202`. Waiting for the snapshot/banner unnecessarily risks a ~60s build wait.
- **Assert attributes, don't click.** The link is `target="_blank"`; clicking opens a new tab and
  hits the external `openobserve.ai` domain. Assert `href`, `target`, `rel` instead.
- **Unique slug per test.** `resolve()` caches slug→kind for 30s and read-routes are IP
  rate-limited (`public.rs:47`, `read_rate_limited`). Reusing a slug across a retry could serve a
  stale/negative-cached entry; timestamp the page name.
