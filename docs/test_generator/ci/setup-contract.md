# Test Setup Contract: IAM Users RBAC Custom Roles  (area: GeneralTests)

Spec: `tests/ui-testing/playwright-tests/GeneralTests/usersRbacCustomRoles.spec.js`
Edition under test: **OSS** (`config.isEnterprise == "false"`, `config.isCloud == "false"`).

## What this feature needs (data conditions, NOT streams)

This is an **IAM feature — no log/stream/metrics ingestion is required.** The feature operates on
the org's **users**, so the "data" to establish is an org containing the authenticated root user,
plus any extra users a test creates to exercise role tiles / actions. No ingestion helper is needed.

## Auth / org — reuse the existing global-session pattern (DO NOT re-invent login)

- **Global setup already logs in once** as the root user and saves auth state to
  `tests/ui-testing/playwright-tests/utils/auth/user.json` (see
  `tests/ui-testing/playwright-tests/utils/global-setup.js:79-104`, using
  `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD`).
- Each test starts with `await navigateToBase(page)` (from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:140`), then navigates with
  `await pageManager.userPage.gotoIamPage()` (`tests/ui-testing/pages/generalPages/userPage.js:94`).
- Org: `process.env["ORGNAME"]` (default `"default"`). The root user lives in `default` and its
  role is **`root`** (so `currentUserRole` = `"root"` after `getOrgMembers`).

## Data/state the spec must establish

### Pre-seeded (shared/read-only — NO setup required)
- `<default org>` **[shared/read-only]** — contains the root user (role `root`). This alone is
  sufficient for:
  - `user-summary-role-root` tile (count ≥1) and `user-summary-total` tile (always rendered) →
    Workflow 1 (view list + role tiles).
  - Role facet filter on `root` → Workflow 2.
  - Absence of the custom-roles fetch/field → the diff's regression guard.

### Per-test (mutating — create INSIDE the test, uniquely named)
- `email${Date.now()}_${rand}@gmail.com` **[per-test: add/edit/delete/role-overlap]** — a normal
  user created with a chosen role (e.g. `Admin` → value `admin`) to exercise:
  - Add-user create flow, edit flow, delete flow.
  - A **second** distinct role appearing as its own tile (e.g. `user-summary-role-admin`), proving
    the strip enumerates roles from data rather than a hardcoded list.
  - Row action buttons (`edit-basic-user-<email>`, `delete-basic-user-<email>`) — these render only
    for **non-root, non-self** rows when the current user is admin/root (see `shouldAllowEdit`/
    `shouldAllowDelete` in `User.vue:937-992`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Create a user (UI):** `pm.userPage.addUser(email)` → `pm.userPage.selectUserRole('Admin')` →
  `pm.userPage.userCreate()` → `pm.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"])` →
  `pm.userPage.addUserFirstLast('a', 'b')` → `pm.userPage.userCreate()`.
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/usersOrg.spec.js:39-60`.
- **Role option value:** OSelect option is `[data-test="user-role-field-option"][data-test-value="admin"]`
  (lowercase); `pm.userPage.getRoleOption('Admin')` normalises the human label.
- **Delete a created user (cleanup):** `pm.userPage.deleteUser(email)` →
  `tests/ui-testing/playwright-tests/GeneralTests/usersOrg.spec.js:135-160`. Unique emails make
  cleanup optional, but deleting keeps the shared `default` org from accumulating rows across runs.
- **Edit a user:** `pm.userPage.editUser(email)` →
  `tests/ui-testing/playwright-tests/GeneralTests/usersOrg.spec.js:191-218`.

## Regression guard for the diff (OSS-specific)

- **Assert the custom-roles fetch is SKIPPED:** the diff (User.vue:705-722 and :843) is only
  observable in OSS as *no request ever fires*. Register a request listener and assert **zero**
  matches to the custom-roles endpoint while the page loads and while the Add-user dialog opens:
  - custom-roles list endpoint: `**/api/{org}/roles` (`usersService.getRoles` in `iam.ts:49-52`);
  - batched role endpoint: `**/api/{org}/users/roles/all` (`usersService.getAllUserRoles`, `users.ts:65-67`).
  - The allowed role-options fetch (`**/api/{org}/users/roles` — plural `users/roles`) DOES fire
    (`getRoles()` in `User.vue:695-704`) and must NOT be confused with `/api/{org}/roles`.
- **Assert the custom-role field is absent** in the Add-user dialog:
  `await expect(page.locator('[data-test="user-custom-role-field"]')).toHaveCount(0)` after opening
  `add-basic-user` and selecting a role.

## Timing / readiness gotchas (so the Healer/Engineer don't rediscover them)

- **Rows arrive async:** `getOrgMembers()` resolves rows before the (enterprise-only) batched role
  fetch; in OSS the batched fetch never runs, so wait for the table rows
  (`[data-test^="o2-table-row-"]`) or the summary strip (`[data-test="user-list-summary"]`) before
  asserting — not `networkidle` (deployed envs poll RUM/analytics and never idle).
- **Tile keys are lowercase, row `role` is display-cased:** tiles use `roleTally` keyed by lowercase
  role name (`user-summary-role-root`), while the single-role column shows `toCamelCase(role)`
  (`"Root"`). Match the tile by `data-test`, and the cell by row text.
- **Root's own row has no edit/delete:** `shouldAllowEdit`/`shouldAllowDelete` exclude self and
  root rows, so a test that deletes "the root user" will find no button — target the *created*
  user instead.
- **Add-user role select visibility:** the role `OFormSelect` is hidden when `userRole === 'member'`
  or when editing self; for the root user creating a normal user it is always shown.
- **`@` in email must be CSS-escaped** in `data-test` selectors (`edit-basic-user-...` etc.) — the
  existing `pm.userPage.getEditUserButton`/`getDeleteUserButton` already do `email.replace('@','\\@')`.

## Preconditions / toggles

- No SQL/quick-mode, stream, or RBAC toggles are relevant in OSS. `rbac_enabled` is absent from
  `zoConfig` (store default `{}`, `stores/index.ts:100`), which — combined with the OSS edition
  flags — is exactly what keeps the custom-roles paths dead (the behaviour under test).
- If a future ENT run reuses this spec, the custom-roles assertions flip: `rbac_enabled` must be
  true AND `config.isEnterprise == "true"`/`isCloud == "true"` for the fetch/field to appear —
  but that is out of scope for this OSS run.
