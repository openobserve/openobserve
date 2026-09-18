# Test Setup Contract: AI Assistant Chat (area: GeneralTests)

> Scope note: this feature is **enterprise-gated**. On the OSS run this contract was generated for
> (`edition: oss`), there is **no reachable chat UI** — the correct spec is an edition-gated test
> that detects the build and either skips on OSS or asserts the entry points are hidden. There is
> **no server-side data/stream setup required** at all: chat history is client-side IndexedDB
> (`o2ChatDB`), and the streaming backend (`/api/{org}/ai/chat_stream`) is enterprise-only.

## Streams / data the spec must establish
**None.** This feature has no dependency on ingested streams, schemas, or server-side datasets.

- Chat history is stored in browser IndexedDB (`o2ChatDB` / object store `chatHistory`), keyed by
  `SHA-256(email:org)` — see `web/src/composables/useChatHistory.ts:20-24,108-115`.
- The AI response backend is `/api/{org}/ai/chat_stream` (`web/src/composables/useAiChat.ts:77`),
  served only by the enterprise build. OSS has no equivalent endpoint.

## Preconditions / toggles (the actual gate)
The feature's visibility is gated on TWO values, both false in OSS:
- `config.isEnterprise === "true"` (build-time; `"false"` in OSS).
- `store.state.zoConfig.ai_enabled === true` — from the backend `/api/{org}/config` response field
  `ai_enabled`, which is `enterprise_value!(false, o2cfg.ai.enabled)`
  (`src/api/management/src/request/status/mod.rs:469`) → always `false` in OSS.

Result: `Header.vue:227` never renders `menu-link-ai-item`; `HomeView.vue:192` never adds the
`ai` home tab.

## How the OSS spec should detect/skip (copy these EXACT patterns — do NOT invent)
- Edition detection via backend config: `pm.statusPagesPage.detectBuildType(orgId)` reads
  `build_type` from `/api/{org}/config` — see
  `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:60,82`.
  The equivalent for `ai_enabled` is to read the same config response's `ai_enabled` field.
- Edition detection via rendered UI: `pm.editionFeaturesPage.detectEdition()` — see
  `tests/ui-testing/playwright-tests/GeneralTests/edition-features.spec.js:91,123`.
- Skip idiom: `test.skip(buildType !== 'opensource', 'Runs only on OSS build ...')` (or the
  inverse for an enterprise-only functional test) — same files.

### OSS assertions (the only green path in this run)
- Header: `page.locator('[data-test="menu-link-ai-item"]')` is **not present / not visible**.
  The page object already exposes it: `HomePage.aiChatButton`
  (`tests/ui-testing/pages/generalPages/homePage.js:42`).
- Home: `page.locator('[data-test="home-tab-ai"]')` is **not present** (the AI tab is never added).
- The chat shell never mounts: no `.chat-container` element in the DOM.

## Enterprise functional test (only for an ENT/`ai_enabled` run — future, not this OSS run)
If the spec is ever run against an enterprise build with a configured AI provider:
- Auth/org: `navigateToBase(page)` (saved auth state + `org_identifier=ORGNAME`) — see
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141-187`.
- Open chat: `pm.homePage.aiChatButton.click()` (header) or navigate Home → `[data-test="home-tab-ai"]`.
- No stream/ingest setup needed; the "data" is a free-text prompt.
- **Many chat controls lack `data-test`** — the Engineer must add stable selectors (or robust
  fallbacks) before an ENT functional test can target the input/send/stop buttons. See
  "NEEDS SELECTOR" list in the design document.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The whole feature is enterprise-gated.** A functional chat test will never go green on OSS —
  do not write one for this run; write the gating/skip test instead.
- `ai_enabled` arrives **asynchronously** with the `/config` response and is what gates the Home AI
  tab; `HomeView.vue:270-290` re-syncs `tabOrder` when it resolves. Assert the tab's absence only
  after config settles (the `build_type`/`ai_enabled` read from `/api/{org}/config` is the
  authoritative source).
- Chat history is **IndexedDB, not server-side** — clearing/resetting a test must clear the
  browser profile (fresh context per test) or the IndexedDB store, not a backend resource.
- `detectEdition` (header-button-label based) tolerates an OSS frontend served by an enterprise
  backend; `detectBuildType`/`ai_enabled` (config based) reads the exact value the gate reads —
  prefer the config read for this feature.
