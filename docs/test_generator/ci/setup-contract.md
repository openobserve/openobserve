# Test Setup Contract: Billing Group Remove Action Icon (area: Management)

This contract tells the Engineer exactly what data/state the `billingGroup.spec.js` Playwright tests
must establish, and the **exact existing helpers** to do it. The feature is **Cloud-only** at the
backend (`#[cfg(feature = "cloud")]`) and the page is data-driven, so the recommended setup is to
**mock the three billing-group GETs** with `page.route` (mirrors the existing billing E2E) rather than
provision real multi-org billing groups. Real-API provisioning is documented as the Cloud fallback.

## Streams / data the spec must establish

Billing groups are **not** streams — they are org relationships (`payer_org_id` → `member_org_id`).
There is no ingestion involved. The "data" here is the response shape of three API endpoints.

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`[shared/read-only]`** — mock ONCE per test (or per describe) for every test that just reads.
- **`[per-test]`** — a test mutates it or needs a distinct shape → mock inside that test.

### Required response shapes (the "data")

- **`membership`** — `GET /api/{org}/billing_group/membership`
  For a **payer/super** org it must return `{ membership: null }`. If non-null the page renders the
  *child* view instead (no remove icon).
  Shape (when present): `{ membership: { id, payer_org_id, payer_org_name, member_org_id, member_org_name, created_at, created_by, accepted_by } }`.

- **`members`** — `GET /api/{org}/billing_group/members` **[shared/read-only]** for the remove-flow
  tests. Must return ≥1 **Active** member so `role === 'super'` and the remove icon renders.
  Shape per member:
  ```js
  { id: 1, payer_org_id: '<orgId>', payer_org_name: 'Acme', member_org_id: 'child-1',
    member_org_name: 'Child One', created_at: 1720000000, created_by: 'a@b.com', accepted_by: null }
  ```
  The remove icon's data-test derives from `member_org_id`, e.g. `org-group-remove-member-child-1`.

- **`invites`** — `GET /api/{org}/billing_group/invites`
  For the "Pending rows have no remove action" case, return a Pending **sent** invite so a pending
  row appears next to the Active member:
  ```js
  { id: 2, inviter_org_id: '<orgId>', inviter_org_name: 'Acme', invitee_org_id: 'target-org',
    invitee_org_name: 'Target Org', inviter_id: 'me@acme.com', created_at: 1720000001,
    expires_at: 1820000001, status: 'Pending', token: 'sent-1' }
  ```
  Empty `[]` is fine for the happy-path remove test.

### How to establish each (copy these EXACT patterns — do NOT invent setup)

- **Mock via `page.route` (PRIMARY — deterministic, env-independent).**
  Copy the routing pattern from `tests/ui-testing/playwright-tests/Onboarding/billing.spec.js:10-23`
  (`pinBillingState` uses `page.route(...)` → `route.fetch()` → mutate → `route.fulfill`). For the
  billing group the matcher regexes are:
  - `page.route(/\/api\/[^/]+\/billing_group\/membership(\?.*)?$/, ...)`
  - `page.route(/\/api\/[^/]+\/billing_group\/members(\?.*)?$/, ...)`
  - `page.route(/\/api\/[^/]+\/billing_group\/invites(\?.*)?$/, ...)`
  - For the DELETE assertion/mock: `page.route(/\/api\/[^/]+\/billing_group\/members\/[^/]+$/, ...)`
    and check `route.request().method() === 'DELETE'` (fulfill `{ ok: true, body: '"successfully removed"' }`
    or `route.continue()` to let the real call through).
  Unroute in `afterEach` with `await page.unrouteAll({ behavior: 'ignoreErrors' })`
  (same as `billing.spec.js:40-42`) so a pending route can't fail a finished test.

- **Navigation.**
  Copy `openBillingFromRail` from `billing.spec.js:25-29`: `page.goto(\`${ZO_BASE_URL}/web/billings/billing_group?org_identifier=${orgId}\`)`
  then `page.waitForURL(/\/billings\/billing_group/)`. `orgId = getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:64-72` (Cloud: `cloud-config.json`; else `ORGNAME`).
  Navigate **directly** to the route — do NOT depend on clicking `billing-tab-group`, which is
  hidden unless `config.isCloud === 'true'`.

- **Fixtures.**
  Use the enhanced `test` fixture + `navigateToBase` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` (as `billing.spec.js:1` does).
  `beforeEach` calls `navigateToBase(page)` first, THEN applies `page.route` mocks and navigates to
  the billing-group route (mocks must be registered before the route's `loadAll` fires).

- **Cloud-only guard (if running the real API instead of mocks).**
  Copy `test.skip(!isCloudEnvironment(), 'Billing is Cloud-only')` from `billing.spec.js:32`.

- **Real-API provisioning (Cloud fallback, only if mocks are unacceptable).**
  No existing Playwright helper provisions a billing group. The full flow would be:
  1. Create a second org (pattern: `web/src/components/iam/organizations/AddUpdateOrganization.vue`
     or the backend `infra::table::organizations::add`).
  2. As payer: `POST /api/{payer}/billing_group/invites` with `{ org_id: memberOrgId }`
     (requires `billing_group_allowed_orgs` config to include the payer).
  3. As member (different user/org context): `POST /api/{member}/billing_group/invites/{token}/accept`.
  This is multi-org + multi-user and requires Cloud config; the mock approach above is strongly
  preferred for a deterministic, shard-safe E2E test.

## Preconditions / toggles
- **No** SQL/quick-mode toggles, streams, or ingestion required.
- The three GETs resolve on mount (`loadAll`). If mocked, the page resolves `role === 'super'`
  synchronously after the mocks fulfill; assert on `[data-test="org-group-super-view"]` before
  asserting the remove icon.
- `allowedForBillingGroup` (from `zoConfig.billing_group_allowed_orgs`) only affects the invite CTA —
  it does **not** gate the remove icon; a payer org with members can always remove them.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`membership` must be `null`** for the super view. A non-null membership renders the child view
  and the remove icon is absent — this is the #1 silent "test has no remove button" cause.
- The remove icon `data-test` embeds the member's `member_org_id`, so the mock must use a known id
  (e.g. `child-1`) and the test must assert `[data-test="org-group-remove-member-child-1"]`.
- The icon button is `max-md:hidden` (desktop) and the menu item is `md:hidden` (mobile). The default
  Playwright viewport is desktop (`1500×1024`, from `enhanced-baseFixtures.js`), so the **icon** path
  is the default; a mobile test needs `test.use({ viewport })` or `page.setViewportSize`.
- Dialog buttons are inside the forwarded panel: use
  `[data-test="org-group-remove-dialog"] [data-test="o-dialog-primary-btn"]` (not a bare `o-dialog-primary-btn`).
- The remove icon and the `more-vert` trigger both have the SAME `aria-label`/`title` "Remove" only
  on the icon; the more-vert trigger has no "Remove" label — prefer `data-test` selectors.
- If a real DELETE is allowed to run (unmocked), the member list reloads on success AND on failure
  (`removeMember` calls `loadAll()` in both cases), and the dialog closes regardless.
