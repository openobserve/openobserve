# OpenObserve Mobile RUM SDK — Ultimate Compatibility Report

**Date:** 2026-08-04 · **Tester:** QA (vkarthik) · **SDKs:** `@openobserve/mobile-*` alpha.5/alpha.6
(React Native), `ai.openobserve:o2-sdk-android-*` alpha5 (Android native), OpenObserve iOS pods
(via RN-iOS). **Instance:** migrated mid-test from `dev.o2aks1` → `dev.common-dev.internal.zinclabs.dev`
(reactnativeapp org `3HOStgiihM8H43cMLWY3BUfXV5r`). **Tracker:** o2-enterprise#2289.

---

## 1. Executive verdict

**Functionally, the SDK is compatible across all four mobile tracks — RN-Android, Android-native,
RN-iOS, and iOS-native** — the full core RUM surface (sessions, views, actions, errors, native
crashes, network resources, vitals) ingests correctly on every platform tested, with native crashes
flagged `is_crash=true` on all three native/iOS tracks. Distinct sources: `android` (native), `ios`
(native), `react-native` (both RN platforms).

**BUT two build-blocking bugs mean the SDK does not build out-of-the-box** per the published docs —
the session-replay package ships un-rebranded Datadog references on **both Android and iOS**. Every
consumer must patch the SDK before it compiles. That is a serious compatibility / developer-experience
defect.

**The dashboard viewing layer** improved a lot (many #2289 UI bugs fixed) but still has a
**cross-platform Error Tracking outage** (broken for web *and* mobile) plus replay/breadcrumb
inconsistencies.

## 2. Platforms tested — build → run → telemetry verified

| Platform | Build | Runs | Telemetry verified in `_rumdata` | `source` | Crash |
|---|---|---|---|---|---|
| **RN-Android** (alpha.6) | ✅ (after patch) | ✅ emulator | sessions, views(named), actions, network, handled-err, attributes, bg/fg, setUser | `react-native`→`android`* | delivered |
| **Android-native** (Kotlin, alpha5) | ✅ | ✅ emulator | sessions, views(Activity), actions, handled-err, **crash is_crash=true**, vitals, long_tasks | `android` | **is_crash=true** |
| **RN-iOS** (alpha.6) | ✅ (after 2 patches) | ✅ simulator | sessions, views(named), actions, network, handled-err, **crash is_crash=true**, vitals | `react-native` | **is_crash=true** |
| **iOS-native** (Swift, alpha.5) | ✅ | ✅ simulator | sessions, views(UIKit VC), actions, handled-err, **crash is_crash=true (SIGTRAP)**, vitals, long_tasks | `ios` | **is_crash=true** |
| **Browser/Web** | n/a | ✅ | web-vitals (real values), sessions, errors | `browser` | n/a |

*RN-Android platform tag flipped `React Native` → `Android` between alpha.5 and alpha.6.

## 3. Build-blocking bugs (NEW — both still present, both patched to proceed)

1. **Android** — `@openobserve/mobile-react-native-session-replay/android/build.gradle:221` references
   the un-rebranded `:datadog_mobile-react-native` (should be `:openobserve_mobile-react-native`).
   Present in **alpha.5 and alpha.6**. Breaks `assembleRelease`.
2. **iOS** — `.../session-replay/ios/Sources/RCTTextViewRecorder.swift` calls `Int64.ddWithNoOverflow`
   (the iOS SDK renamed it to `ooWithNoOverflow`). Breaks `xcodebuild`.

Both are leftover Datadog names the rebrand missed. Our `patch-sdk.js` fixes both on postinstall so the
apps build reproducibly, but the **published packages are broken as shipped**.

## 4. `#2289` retest — current dashboard code (verified live)

**✅ Fixed:** Web-Vitals `0.00 ns` (cards removed for mobile) · Web-Vitals tab schema errors (graceful
empty state) · Session-detail Traces HTTP 400 (graceful) · session-duration inflation (now sane,
median ~3–5s) · user identity displays (`alex.morgan`) · view names `undefined` (now proper names) ·
RN/Browser install-tab placement.

**❌ Still broken:** **Error Tracking** — placeholder query (`…='value'`) + HTTP 429 → "Search query
cancelled", 0 errors shown. **Confirmed broken for BROWSER too** (webrum org: 5530 errors, tab shows 0)
→ this is a **general RUM bug and a web regression**, not mobile-only.

**⚠️ Still inconsistent:** session-detail **breadcrumbs intermittently empty**; **session replay missing**
("No session replay available") on some active sessions.

## 5. Per-platform findings worth noting

- **Native crash classification is better on native than RN.** Android-native + RN-iOS crashes carry
  `is_crash=true`; the earlier RN-Android path showed `Total Unhandled Errors: 0` (ambiguous).
- **`source` does not distinguish iOS vs Android for RN** — both report `source=react-native`. Use
  `os`/`device` fields to tell them apart.
- **setUser works** across platforms (attributes `usr_email` populated, shown in UI).
- **Attributes** (env/service/version) tag correctly; note the SDK also emits its own service
  (`o2-sdk-android`) alongside the app service.

## 6. Security

- **No-phone-home:** the built Android APK contains **zero Datadog hosts** (verified by scan). The
  SDK sends only to the configured OpenObserve endpoint.
- **PII masking:** Session Replay masks all text at `MASK_ALL` (verified on RN-Android). On iOS,
  replay availability was inconsistent, so masking there is **not yet confirmed**.

## 7. Web regression

Browser RUM is **healthy** — web-vitals show real values with correct units (LCP 6.59s, INP 104.31ms),
sessions/errors populate. The RUM UI redesign correctly shows web-vitals for browser and hides them for
mobile. **The one web regression is the shared Error Tracking outage** (§4).

## 8. Note: cluster migration mid-test

The dev instance migrated from `dev.o2aks1` → `dev.common-dev` during testing (old URL now 404, new
auth = `root@example.com`, reactnativeapp org re-identified). RN-Android + Android-native were verified
on the old cluster before it died; RN-iOS was re-pointed and verified on the new cluster.

## 9. Recommendations

1. **Fix the two build-blockers** in the published session-replay packages (Android gradle ref + iOS
   `ddWithNoOverflow`) — highest priority; the SDK is unusable out-of-the-box without them.
2. **Fix Error Tracking** (placeholder query + 429) — affects web and mobile.
3. **Investigate replay/breadcrumb inconsistency** (missing replays, empty breadcrumbs).
4. **Clarify** the RN `source=react-native` (add platform disambiguation) and the RN crash `is_crash`
   classification to match native.
5. **iOS-native (Swift) — done:** built + verified (`source=ios`, `is_crash=true`). The full
   4-platform mobile matrix is now covered.

## 10. What's automated
`tests/mobile-testing/` — Maestro flows + API + Playwright UI assertions across RN-Android (11 specs),
RN-iOS (flow), Android-native (app + verification); vendored fixture apps; CI scope in `CI-SCOPE.md`.
