# Mobile RUM SDK — Test-Case Matrix

Legend — **Automation:** ✅ automated (this suite) · 🟡 scaffolded (flow/spec ready, needs app) ·
⬜ manual/blocked. **P:** priority.

## Capabilities × platform tracks

| # | Capability | P | RN-Android | RN-iOS | Android-native | iOS-native | Verify layers |
|---|-----------|---|-----------|--------|----------------|-----------|---------------|
| 1 | Session created + id | P0 | ✅ | 🟡 | 🟡 | 🟡 | API + UI |
| 2 | View tracking (named) | P1 | ✅ | 🟡 | 🟡 | 🟡 | API + UI |
| 3 | User actions (taps) | P1 | ✅ | 🟡 | 🟡 | 🟡 | API |
| 4 | Network/resource tracking | P1 | ✅ | 🟡 | 🟡 | 🟡 | API + UI |
| 5 | Handled JS/native error | P1 | ✅ | 🟡 | 🟡 | 🟡 | API |
| 6 | Native crash → is_crash | P0 | ✅ | 🟡 | 🟡 | 🟡 | API + UI |
| 7 | Background/foreground continuity | P1 | 🟡 | 🟡 | 🟡 | 🟡 | API |
| 8 | Attributes (env/service/version) | P1 | ✅ (implicit) | 🟡 | 🟡 | 🟡 | API + UI |
| 9 | Session Replay records | P1 | ✅ | ⬜ (iOS replay N/A yet) | 🟡 | ⬜ | UI |
| 10 | Replay PII masking (MASK_ALL) | P1 | ✅ | ⬜ | 🟡 | ⬜ | UI (+ pixelmatch) |
| 11 | No-phone-home (no Datadog host) | P0 | 🟡 (static) | 🟡 | 🟡 | 🟡 | build scan |
| 12 | Offline buffering → send on reconnect | P2 | 🟡 | 🟡 | 🟡 | 🟡 | API |
| 13 | Dashboard: Error Tracking shows error | P1 | ✅ `@known-bug` #2289 | — | — | — | UI |
| 14 | Dashboard: session breadcrumbs render | P1 | 🟡 `@known-bug` | — | — | — | UI |

## Implemented RN-Android specs

| Spec | Test | Tags | Layers | Status |
|------|------|------|--------|--------|
| `rn-android.crash.spec.js` | native crash ingested + session viewable | `@P0 @crash` | API+UI | ✅ |
| `rn-android.crash.spec.js` | crash shows in Error Tracking | `@known-bug` | UI | ✅ (xfail #2289) |
| `rn-android.network.spec.js` | fetch captured as resource | `@P1 @network` | API | ✅ |
| `rn-android.handled-error.spec.js` | handled error ingested | `@P1 @errors` | API | ✅ |
| `rn-android.views.spec.js` | named views recorded | `@P1 @views` | API | ✅ |
| `rn-android.masking.spec.js` | PII masked in replay | `@P1 @masking` | UI | ✅ |

## Backlog (flows/specs to add next)

- Background/foreground continuity flow (`pressKey: HOME` → relaunch → assert same session).
- Offline buffering (`setAirplaneMode` on → act → off → assert late ingest).
- Attribute assertions spec (env=testing, service, version present + correct).
- HTTPS-only / fail-closed (needs a misconfigured build variant).
- No-phone-home: automate the APK scan for `datadoghq`/`ddog-gov` hosts in CI.

## Prerequisites per track

- **RN-iOS** — build the RN app for iOS (Xcode + CocoaPods + simulator). Note: iOS Session Replay
  does not yet reach OpenObserve (SDK appends its own path); RUM/logs/crashes work.
- **Android-native** — a Kotlin sample app using `io.openobserve:oo-sdk-android-*`.
- **iOS-native** — a Swift sample app using the OpenObserve iOS pods (Xcode + simulator).

All tracks reuse the **same** API + UI verification layers — only the drive layer (Maestro flow /
app id) changes.
