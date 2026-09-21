# Test Setup Contract: Connect Data Source Onboarding Popup  (area: GeneralTests)

> Read by the **Engineer** (implements setup), **Healer** and **Refiner** (consult on
> data/setup failures). The feature is **Cloud-only** and this run targets **OSS**, so the
> primary E2E test is a **negative gating assertion** that needs **no data setup at all**.
> The Cloud positive flows are documented here for completeness (for a `@cloud`-tagged,
> self-skipping companion test) and must NOT be attempted on OSS.

## Streams / data the spec must establish

**None for the OSS test.** The two popups (`ConnectDataSourcePopup`,
`CommunitySlackInvite`) bail out in `onMounted` when `config.isCloud !== "true"`
(`ConnectDataSourcePopup.vue:186-190`, `CommunitySlackInvite.vue:72`) — before any `/summary`
call or data check. On OSS the dialogs never render regardless of whether the org has streams,
so no stream/ingestion precondition exists.

For the optional Cloud companion (see below), the required precondition is the *absence* of
data, not its presence:

- **`[per-test]` empty org** — the connect popup opens only when `GET /api/{org}/summary`
  returns `streams.num_streams === 0`. The shared CI org is normally pre-seeded by
  `global-setup.js`'s `performGlobalIngestion`, so a Cloud test must use a fresh org/user or
  explicitly avoid ingesting — do **not** rely on the shared org being empty.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Authenticated navigation (OSS negative test):**
  `await navigateToBase(page)` — from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` (already used by every
  GeneralTests spec, e.g. `GeneralTests/edition-features.spec.js:85`). It navigates to
  `${ZO_BASE_URL}/web/?org_identifier=${ORGNAME}` and verifies auth via the nav rail.
- **Page object wiring:** add the new page object to
  `tests/ui-testing/pages/page-manager.js` (constructor list, GeneralTests section) and expose
  it as `pm.connectDataSourcePopupPage` — same pattern as `editionFeaturesPage`
  (`page-manager.js:232`) and `statusPagesPage` (`page-manager.js:233`).
- **Asserting absence (OSS):** after `navigateToBase`, assert both panels have count 0:
  `await expect(page.locator('[data-test="connect-data-source-popup-dialog"]')).toHaveCount(0)`
  and the same for `[data-test="community-slack-invite-dialog"]`. reka-ui's `DialogContent` is
  mounted lazily, so a closed dialog has **no** DOM node — `toHaveCount(0)` (not
  `toBeHidden()`) is the correct, race-free assertion.

## Preconditions / toggles

- **Edition detection (skip guard):** the frontend gate is the build-time flag `config.isCloud`
  (`VITE_OPENOBSERVE_CLOUD`), not the backend `build_type`. The closest established test-side
  signal is `isCloudEnvironment()` (`pages/cloudPages/cloud-env.js`, `IS_CLOUD === 'true'`).
  Use `test.skip(isCloudEnvironment(), ...)` for the OSS test so a shared CI matrix that happens
  to run against a Cloud deployment doesn't produce a false red (the dialogs *would* appear on
  Cloud). See the self-skip idiom in `GeneralTests/edition-features.spec.js:88-93` and
  `status-pages-enterprise-gating.spec.js:57-62`.
- **No `isFirstTimeLogin` seed on OSS.** `isFirstTimeLogin` is set only on Cloud
  `new_user_login` (`Login.vue:166-171`), so the OSS `GetStarted` dialog and the first-login
  branch never fire. Do not seed `localStorage.isFirstTimeLogin` in the OSS test.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Closed dialogs have no DOM.** `ODialog` forwards `data-test` onto `DialogContent`, which
  reka-ui only mounts when `open` is true (`ODialog.vue:379-381`). A `.toBeVisible()` on a
  closed popup will time out waiting for an element that is structurally absent; use
  `toHaveCount(0)` for the negative case.
- **Selector forwarding is real and stable.** `ODialog` maps `$attrs["data-test"]` to the
  panel (`ODialog.vue:40,381`); `OButton` `v-bind="$attrs"` onto the `<button>`
  (`OButton.vue:361`). Both are safe for the connect CTA and Slack buttons.
- **Do not confuse the two dialogs' close buttons.** The Connect popup uses ODialog's shared
  `[data-test="o-dialog-close-btn"]` (default `showClose=true`); `CommunitySlackInvite` sets
  `:show-close="false"` and supplies its own
  `[data-test="community-slack-invite-close-btn"]`.
- **Cloud positive flow needs an empty org.** The CI org is pre-seeded (see
  `global-setup.js` `performGlobalIngestion`); a Cloud test that naively expects the connect
  popup will silently never see it because `num_streams > 0`. Fresh org/user or skip ingestion,
  and force the popup either via `isFirstTimeLogin="true"` + `o2:onboarding-complete` or a
  returning session with no data.
- **Cloud positive flow: `new_user_login` hash is impractical to simulate** — prefer the
  returning-session path (no `isFirstTimeLogin`) with an empty org, which opens the popup on
  mount without needing to drive the OAuth/GetStarted dance.
