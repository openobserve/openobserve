# Mobile RUM SDK — Coverage Matrix & Gap Analysis

_Coverage of the `tests/mobile-testing` suite across the four mobile tracks. Updated after the
capability-parity expansion (29 tests, 4 Playwright projects)._

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

- **Mobile SDK install docs are incomplete in the OpenObserve UI.** The RUM ingestion setup cards
  (`web/src/components/ingestion/setupCard/content/`) cover **Browser** (`rum.ts`) and **React
  Native** (`rumReactNative.ts`) only — there is **no Android-native (Kotlin) and no iOS-native
  (Swift)** install card. A customer choosing those platforms has no in-product install guide, even
  though the SDKs exist and are tested here. Recommend adding `rumAndroid`/`rumIos` setup cards
  (mirroring `rumReactNative.ts`) and, once present, a UI test asserting the RUM page lists every
  supported platform.
