# Test Setup Contract: Org Ingestion Token (Passcode) Access Control  (area: GeneralTests)

> Feature slug: `ingestion-passcode-forbidden` · spec: `tests/ui-testing/playwright-tests/GeneralTests/ingestion-passcode-forbidden.spec.js`

## The one fact that shapes everything

The forbidden banner is driven by **one** Vuex flag: `organizationData.organizationPasscodeForbidden`, set only
when `GET /api/{org}/passcode` returns **403**. In **OSS** that 403 is unreachable from a UI session:

- Root user → `db::user::is_root_user` bypasses (`src/db/src/user.rs:35-39`).
- Every other UI user → `save`/`update` force `base_role = Admin` under `#[cfg(not(feature = "enterprise"))]`
  (`src/api/management/src/request/users/mod.rs:213-216`, `:307-313`).
- OSS `get_roles()` returns only `Admin/Root/ServiceAccount` (`src/common/src/meta/user.rs:177-180`).

**Consequence for the spec:** the *banner* assertion cannot go green in OSS via a real user flow. Plan it as a
parked `test.fixme` (Architect). The only assertions that can go **green** in OSS are:

1. **Positive control (E2E, WIRED):** Admin/Root sees the real card/snippet (no forbidden banner).
2. **API boundary (needs_api, WIRED):** a ServiceAccount principal gets **403** on `GET /api/{org}/passcode`.

## Preconditions / toggles
- Self-hosted OSS only. Gate the whole spec with `test.skip(isCloudEnvironment(), ...)` (pattern:
  `tests/ui-testing/playwright-tests/GeneralTests/ingestionTokens.spec.js:9`).
- Org: `process.env.ORGNAME` (default `default`). Use `getOrgIdentifier()` for API calls
  (`tests/ui-testing/playwright-tests/utils/cloud-auth.js:64`).

## Data / state the spec must establish
Tag each item by SCOPE.

### Positive control (E2E)
- **`[shared/read-only]`** A logged-in Admin/Root session — the default `navigateToBase(page)` session already
  satisfies this (all OSS users are Admin/Root). No extra data needed. Why: confirms the passcode read returns
  200 and the card renders with the passcode substituted.

### Forbidden banner (E2E — parked `fixme`)
- **`[unreachable-in-OSS]`** A non-admin UI session (e.g. a "member" role user). **No existing helper can create
  this in OSS** — `userPage.selectUserRole('Admin')` (`tests/ui-testing/pages/generalPages/userPage.js:109-122`) is
  the only assignable role, and even arbitrary role strings are normalized to Admin server-side. Do **not** invent
  a setup; mark the case `test.fixme` with a comment pointing here.

### API boundary 403 (needs_api)
- **`[per-test]`** One service account, created via the UI/API and read via its token.
  - Create (UI): `pm.iamPage.gotoIamPage()` → `pm.iamPage.iamPageServiceAccountsTab()` →
    `pm.iamPage.iamPageAddServiceAccount()` → `pm.iamPage.enterNameServiceAccount(uniqueName)` →
    `pm.iamPage.clickSaveServiceAccount()` → capture token from reveal. See
    `tests/ui-testing/playwright-tests/GeneralTests/serviceAccount.spec.js:101-117` ("Service Account Token copied").
  - Assert: `GET ${ZO_BASE_URL}/api/${org}/passcode` with `Authorization: Basic base64(<sa-identifier>:<sa-token>)`
    returns **403** (service account identifier is `<name>.<org>@sa.internal`, per
    `serviceAccount.spec.js:9-11`).
  - **Verify before relying on it** (backend nuance): confirm the SA credential actually reaches
    `get_user_passcode` (rather than a 401 on auth) — see `src/api/management/src/request/organization/org.rs:343-363`
    and `require_credential_access` at `src/api/management/src/request/organization/mod.rs:40-78`.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Auth/org for API calls: `getAuthHeaders()` (self-hosted → `Basic email:password`) from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29-57`; use `authedRequest(page, 'get', url)` for the
  positive passcode read (`cloud-auth.js:126-142`).
- Ingest/navigation: `page.goto(`${process.env.ZO_BASE_URL}/web/ingestion?org_identifier=${process.env.ORGNAME || 'default'}`)`
  — pattern in `tests/ui-testing/playwright-tests/GeneralTests/ingestionTokens.spec.js:216-217`.
- Service account creation helper: `tests/ui-testing/pages/iamPages/iamPage.js` (methods `iamPageServiceAccountsTab`,
  `iamPageAddServiceAccount`, `enterNameServiceAccount`, `clickSaveServiceAccount`, `clickCopyToken`,
  `serviceAccountEmailFor`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Passcode read is async and races the tokens read.** On the positive path, wait for the card
  (`[data-test="data-source-setup-card"]`) to be visible with a timeout rather than asserting immediately — the
  passcode arrives after mount (`Ingestion.vue:436-461`). The recommended tab auto-redirects
  `recommended → ingestFromKubernetes`, so navigate to `/web/ingestion` and let it land.
- **Empty passcode ≠ forbidden.** A 200 with `passcode == ""` fires a `passcodeNotFound` toast and leaves the
  snippet rendering (dead command). Do not assert "no snippet" on that state.
- **Do not attempt to force a non-admin role via API in OSS** — `POST /api/{org}/users` and `PUT /api/{org}/users/{email}`
  normalize to Admin (`users/mod.rs:213-216`, `:307-313`). Any "member"/"editor"/"viewer" role string becomes a
  `custom_role` on top of `base_role=Admin` (`src/common/src/meta/user.rs:418-438`), still readable.
- **Cloud skip**: on cloud the ingestion-tokens surface is hidden and the org is OIDC-managed; `getAuthHeaders()`
  switches to `email:passcode`. Keep the spec self-hosted-only to avoid the cloud 401/403 self-heal masking the
  real 403 (`cloud-auth.js:126-142` retries on 403).
