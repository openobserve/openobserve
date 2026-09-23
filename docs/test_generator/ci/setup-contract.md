# Test Setup Contract: Community Slack Invite Dismissal Snooze  (area: GeneralTests)

> Scope note: this feature is **Cloud-only**. On the OSS build (`config.isCloud === "false"`,
> `web/src/aws-exports.ts:30-32`) the `CommunitySlackInvite` component bails out in `onMounted`
> (`web/src/components/CommunitySlackInvite.vue:73`) and renders **no DOM**. Therefore the OSS E2E
> spec is a **negative gating** test and needs **no streams/data** — only an authenticated session
> on an OSS deployment. The snooze state machine is already covered by Vitest unit tests.

## Environment / toggles the spec must establish

- **OSS build** — `VITE_OPENOBSERVE_CLOUD` is NOT `"true"` (this is inherent to the OSS test
  matrix; nothing to set). The spec must self-skip on Cloud so a shared matrix never false-reds:
  ```js
  test.skip(isCloudEnvironment(), 'Runs only on OSS/self-hosted (Cloud dialogs are expected)');
  ```
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/connectDataSourcePopup.spec.js:37`
  and `tests/ui-testing/pages/cloudPages/cloud-env.js:5-7`.
- **Authenticated session** — use the standard base fixture; it consumes the saved auth state.
  Reference: `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141`
  (`navigateToBase(page)`, includes `/web/?org_identifier=${ORGNAME}` and auth verification).

## Streams / data the spec must establish

- **None.** This is a marketing/invite popup with no data-plane dependency. The `[shared/read-only]`
  and `[per-test]` stream scopes do not apply here.

## How to establish the (only) precondition — copy these EXACT patterns, do NOT invent

- **Navigate + verify auth:** in `test.beforeEach`, call `navigateToBase(page)` then
  `pm = new PageManager(page)`. See
  `tests/ui-testing/playwright-tests/GeneralTests/connectDataSourcePopup.spec.js:27-32`.
- **Assert dialog absence:** reuse the existing page object locator
  `pm.connectDataSourcePopupPage.slackPopup` (`[data-test="community-slack-invite-dialog"]`) or
  call `pm.connectDataSourcePopupPage.expectBothDialogsAbsent()`. The page object lives at
  `tests/ui-testing/pages/generalPages/connectDataSourcePopupPage.js:16-18` and `:28-31`, and is
  already registered on PageManager at `tests/ui-testing/pages/page-manager.js:239`.
  - Correct assertion is `toHaveCount(0)`, NOT `toBeHidden()` — a closed reka-ui `DialogContent`
    mounts no DOM node (`web/src/lib/overlay/Dialog/ODialog.vue:379-381`).
- **Re-verify after a full page reload:** navigate to Logs via
  `pm.connectDataSourcePopupPage.navigateToLogs()` (page object line 21-25) and re-assert
  `toHaveCount(0)`, guarding re-mounts — mirroring `connectDataSourcePopup.spec.js:42-46`.

## Timing / waits

- No data hydration to wait for. Wait for the main nav rail as the auth signal (the base fixture
  already does this in `verifyAuthentication`, `enhanced-baseFixtures.js:126`). The absence
  assertion is race-free because the closed dialog never mounts DOM.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Do not assert any of the inner selectors** (`join-btn`, `maybe-later-btn`, `close-btn`,
  `members-text`) — they can never render on OSS and will always fail. Only the outer
  `community-slack-invite-dialog` absence is testable.
- **Do not test the snooze/`markSlackInviteDismissed` behavior in E2E** — it is unreachable on OSS
  (blocked by the `isCloud` render gate) and already fully covered by
  `web/src/utils/slackCommunityInvite.spec.ts` and `web/src/components/CommunitySlackInvite.spec.ts`.
- **`isCloudEnvironment()` (test-time `IS_CLOUD` env) vs `config.isCloud` (build-time
  `VITE_OPENOBSERVE_CLOUD`)** are two different signals; the skip guard uses the former, the
  component uses the latter. They coincide in the standard matrix, but do not substitute one for
  the other.
- **The sibling `connectDataSourcePopup.spec.js` already asserts BOTH dialogs absent** (including
  `community-slack-invite-dialog`). The new spec should stay focused on the Slack invite and not
  duplicate the Connect popup assertion unless the Architect decides a shared negative-gating spec
  is redundant.
