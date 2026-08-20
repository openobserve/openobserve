# Mobile RUM SDK — Coverage Matrix & Gap Analysis

_Coverage of the `tests/mobile-testing` suite across the four mobile tracks. **42 tests, 5 Playwright
projects** (rn-android, android-native, rn-ios, ios-native, sdk-drift). The native tracks are now at
RN parity — masking, network, background/foreground, user-identity and no-phone-home ship for both
`android-native` and `ios-native` (previously listed here as deferred). The PR-description matrix is the
authoritative capability×platform view; anything below marked "deferred / N/A" for those native
capabilities is superseded by the shipped specs._

## How the suite is structured

- **DRIVE → API → UI** on every scenario: Maestro taps the app (`maestro/`), the OpenObserve Search
  API proves the data landed (`utils/ooClient.js`), the RUM dashboard proves it renders
  (`pages/rumDashboardPage.js`).
- **Per-capability factories** (`utils/rumChecks.js`) keep the four platforms at parity without
  copy-paste: `attributesSuite`, `userIdentitySuite`, `networkSuite` (positive + 404 negative),
  `maskingSuite`, `bgFgSuite`, `noPhoneHomeAndroidSuite`. Each platform's spec is a thin call.
- **`coreRumSpec.js`** bundles the end-to-end crash journey (views + actions + handled error +
  native crash in `_rumdata`, then the crashed session rendering in the dashboard) for the three
  non-RN-Android platforms.

## The RUM capability × platform matrix

Legend: **✓** covered · **N/A** app can't do it without a code change · **⏭** deferred (see
follow-ups) · **⚠** blocked by dashboard bug o2-enterprise#2289.

| Capability (layer) | RN-Android | Android-native | RN-iOS | iOS-native |
|---|---|---|---|---|
| Session created (API) | ✓ | ✓ | ✓ | ✓ |
| Named view tracking (API) | ✓ | ✓ bundle | ✓ bundle | ✓ bundle |
| Actions — tap/custom (API) | ✓ bundle | ✓ bundle | ✓ bundle | ✓ bundle |
| Resource: fetch success (API) | ✓ | N/A no net | ✓ | N/A no net |
| **Resource error: 4xx status (API, negative)** | ✓ | N/A | ✓ | N/A |
| Handled error, is_crash=false (API) | ✓ | ✓ bundle | ✓ bundle | ✓ bundle |
| Native crash, is_crash=true (API) | ✓ | ✓ | ✓ | ✓ |
| User identity — usr_* fields (API) | ✓ | ✓ | ✓ | N/A app doesn't set |
| Attributes: env/service/version (API) | ✓ | ✓ | ✓ | ✓ |
| Session replay privacy masking (UI, negative) | ✓ | N/A no form | ✓ | N/A no form |
| Background/foreground continuity (API) | ✓ | ⏭ | ⏭ | ⏭ |
| No-phone-home: no Datadog hosts (security, negative) | ✓ | ✓ | N/A IPA | N/A IPA |
| Crashed session viewable (UI) | ✓ | ✓ | ✓ | ✓ |
| Error Tracking tab shows error (UI) | ⚠ skip | ⚠ skip | ⚠ skip | ⚠ skip |

## On-device validation status (Phase 5)

Run against the emulator + booted iOS simulator on the migrated dev cluster:

- **Validated green on-device:** RN-Android attributes / user-identity / **network incl. the 404
  negative** / no-phone-home / background-foreground; Android-native attributes / user-identity /
  no-phone-home; RN-iOS attributes (confirms iOS-through-the-factory + simulator device targeting).
- **Generated + statically validated, pending a device run:** RN-iOS network (+404) / user-identity /
  masking; iOS-native attributes; plus the pre-existing per-platform core bundles and the RN-Android
  crash / masking / views / handled-error specs. (The suite parses and lists cleanly; they reuse the
  exact factory paths already proven above, so they need a booted sim to execute, not new logic.)

> **Key finding:** the SDK **does** capture `resource_status_code` for failing requests — the 404
> negative asserts `>= 400` and passes on RN-Android.

## Deferred / follow-ups (not shipped as tests)

- **Background/foreground on native (Android-native, iOS-native) and RN-iOS.** The RN-Android adb
  cycle (HOME → `am start`) keeps one session and passes. The same mechanism produced **two**
  sessions on Android-native (activity-based views), and the iOS Home-key backgrounding was
  unreliable on the simulator. Needs investigation: is native session continuity across background a
  real SDK difference, or a drive-mechanism artifact? Held out rather than shipped red/flaky.
- **Native network / masking tests** — the Android-native and iOS-native apps make no network calls
  and have no PII form; needs a Fetch button + a form added to those fixture apps.
- **iOS-native user identity** — that app never calls `setUserInfo` (one-line app change, or accept N/A).
- **iOS no-phone-home** — scanning an `.ipa` for Datadog hosts is materially harder than the Android
  APK scan; separate follow-up.
- **Error Tracking tab** (o2-enterprise#2289) — kept as a `test.fixme` skip on every platform.

## Negative-scenario coverage

Shipped negatives: **404/4xx resource status captured** (RN, validated), **PII must not leak** into
the replay (masking), **no Datadog hosts** in the app (no-phone-home), **handled error must be
is_crash=false** (all platforms). Offline/airplane-mode behavior remains a possible later addition.

## Product findings (log to o2-enterprise#2289)

- **The RUM install docs in the UI pin a STALE SDK version.** The Data Sources → Real User
  Monitoring page has all four platform tabs (Browser · React Native · Android · iOS, all BETA) — so
  the docs exist. But the versions are hardcoded and have drifted behind the shipped SDKs:
  | Platform | Version shown in the UI | Version we build/test | Drift |
  |---|---|---|---|
  | React Native | `0.1.0-alpha.4` (`RUM_RN_SDK_VERSION`, OSS `rumReactNative.ts`) | `alpha.6` | 2 behind |
  | Android | `0.1.0-alpha4` (enterprise card) | `alpha5` | 1 behind |
  | iOS | `from: "0.1.0-alpha.4"` (enterprise card) | `alpha.5` | 1 behind |
  A customer copy-pasting from this page installs an older SDK than what's published. Root cause: the
  version is a hardcoded constant with no freshness check.
- **The mobile RUM SDK is NOT enterprise-gated** — corrected. RUM ingestion (`/rum/v1/...` in the base
  OSS router, no enterprise import), the RUM dashboard (`web/src/views/RUM/*`), and the SDK packages
  (public npm/Maven/GitHub) are all **open source**. The ONLY edition difference is which *install-doc
  cards* are surfaced: OSS `FrontendRumConfig.vue` ships `PLATFORMS = [browser, reactNative]` (code
  comment: "Adding iOS / Android / Flutter later"), while the enterprise build additionally shows the
  Android + iOS cards. So a docs-presence/drift test for Android/iOS runs `@enterprise`, but the SDK
  *functionality* tests are all OSS — which is why the self-contained (plain-OSS) CI works.
- **How to verify (proposed):** (1) a **drift test** comparing the UI-pinned version against the
  latest published (npm / Maven / GitHub releases) — currently RED; (2) **executable docs** — this
  E2E suite already proves "these coordinates + this init code produce working RUM"; with the new
  version injection it can run against the *documented* version and the *latest* to prove both work.
