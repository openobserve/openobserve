# Mobile RUM SDK — E2E Testing: Final Report

**Date:** 2026-08-03 · **Author:** QA (vkarthik) · **Suite:** `tests/mobile-testing/`
**Under test:** OpenObserve Mobile RUM SDK `@openobserve/mobile-*@0.1.0-alpha.5` (React Native), same
family as the ShopSphere alpha5 build · **Instance:** `dev.o2aks1.internal.zinclabs.dev`, org
`reactnativeapp` · **Related:** feature epic o2-enterprise#2129, bug tracker o2-enterprise#2289.

---

## 1. Executive summary

- Built a **3-layer E2E harness** for mobile RUM: Maestro drives a real app on an emulator → the
  **Search API** asserts the data landed in `_rumdata` → **Playwright** asserts the RUM **dashboard**
  renders it. Both layers matter because most defects are display-layer.
- **RN-Android is automated and passing (6/6 tests).** Android-native and iOS tracks are scaffolded
  but **not** built (need their own sample apps; iOS also needs Xcode/simulator).
- The SDK's **data pipeline is solid**; the **dashboard viewing layer is where defects cluster**
  (Error Tracking, Web Vitals, Traces, breadcrumbs) — all logged in #2289.
- **Coverage is partial vs. the full browser-RUM feature surface.** Core capture is covered; several
  functionalities (frustration signals, user identity, geo, traces, source maps, full breadcrumb UI)
  are gaps or blocked by known bugs.

## 2. Approach — the 3-layer pattern

```
DRIVE  (Maestro flow, text selectors)  →  session_id
API    (ooClient → _rumdata)           →  assert data correct     ← fast, precise, stable
UI     (Playwright → RUM dashboard)    →  assert product renders   ← where the bugs live
```

## 3. What is automated (RN-Android) — all passing

| Scenario | Layers | Result |
|---|---|---|
| Native crash → ingested (is_crash) + session viewable | Maestro+API+UI | ✅ (flaky→retry) |
| Crash inspectable in Error Tracking tab | UI | ✅ xfail (bug #2289) |
| Network / resource tracking (A4) | Maestro+API | ✅ |
| Handled JS error (A5) | Maestro+API | ✅ |
| Named view tracking | Maestro+API | ✅ |
| Session Replay PII masking (MASK_ALL) | Maestro+API+UI | ✅ |
| Attributes tagging (env/service/version) | Maestro+API | ✅ |
| Background/foreground session continuity | Maestro+adb+API | ✅ |
| No-phone-home (zero Datadog hosts in APK) | adb+scan | ✅ |
| User identity (setUser → usr_* fields) | Maestro+API | ✅ |

10 tests. Run: `npm run test:rn-android`. Runtime ~6–16 min depending on retries.

## 4. Coverage vs. browser-RUM feature surface (the evaluation)

Legend: ✅ automated · 🟡 partial/data-only · ⬜ gap · ❌ blocked by a known bug.

| Functionality | API | UI | Status / note |
|---|-----|----|---------------|
| Sessions (list + detail) | ✅ | ✅ | viewable |
| Views (named) | ✅ | 🟡 | breadcrumb UI not asserted |
| Actions (taps) | ✅ | 🟡 | breadcrumb UI not asserted |
| Errors (handled) | ✅ | ❌ | Error Tracking tab broken (#2289) — xfail |
| Crashes | ✅ | 🟡 | session flagged; detail via ET blocked |
| Resources (network) | ✅ | ⬜ | UI (Performance→API) not asserted |
| Session Replay record + playback | ✅ | ✅ | |
| Replay PII masking | ✅ | ✅ | verified at MASK_ALL |
| Breadcrumbs timeline | 🟡 | ⬜ | intermittent-empty bug; no dedicated assertion |
| Frustration signals (rage/dead) | ⬜ | ⬜ | not covered (needs app trigger) |
| User identity (setUser) | ✅ | — | app calls setUserInfo; usr_email asserted |
| Attributes (env/service/version) | ✅ | — | asserted (env=testing, service, version) |
| Background/foreground continuity | ✅ | — | true bg/fg keeps one session |
| No-phone-home (no Datadog host) | ✅ | — | APK scan; zero Datadog hosts |
| Geo/IP enrichment | ⬜ | ⬜ | not covered (emulator has no public IP) |
| Traces linking | ⬜ | ❌ | Traces tab HTTP 400 (#2289) |
| Source maps / symbolication | ⬜ | ❌ | v1 out-of-scope + tab bug |
| Performance / Web Vitals | n/a | ❌ | schema-error bug; browser-only metrics |

**Automated: ~7 · Gap/blocked: ~8.** Two of three platform tracks (Android-native, iOS) not yet built.

## 5. Bugs found (all in o2-enterprise#2289)

1. **Session-replay package fails the Android build** — `build.gradle:221` references un-rebranded
   `:datadog_mobile-react-native` (found only by building from the docs).
2. **Error Tracking tab broken** — malformed default query (`…='value'`) + HTTP 429 → crashes not
   inspectable (P1; blocks error verification).
3. **Web Vitals tab** — raw schema errors for `source=react-native`.
4. **Traces tab** — HTTP 400 on session detail.
5. **Breadcrumbs panel** — intermittently empty.
6. **View names `undefined`** via auto react-navigation (manual `startView` is fine).
7. **Bottom-nav actions labeled `RCTView`** (missing accessibility labels).
8. **Session duration inflated** — session doesn't time out on idle.
9. **User identity "Unknown"** despite a logged-in user (setUser not wired).
10. **SDK dual service/version** (`o2-sdk-android` alongside the app) — confirm intended.

## 6. Gaps & backlog (to reach full coverage)

- **UI-layer assertions** for resources, breadcrumb timeline (once #2289 fixed), attributes.
- **New scenarios:** frustration signals, user identity (setUser), geo enrichment, background/
  foreground continuity, offline buffering, HTTPS-only / fail-closed, no-phone-home APK scan.
- **Platform tracks:** RN-iOS (Xcode), Android-native (Kotlin sample app), iOS-native (Swift sample
  app) — reuse the same API+UI layers; only the drive layer changes.
- **Isolation:** stamp a unique run-id as a RUM global attribute for parallel/CI-safe filtering.

## 7. Recommendation

The harness is proven and reusable. Prioritize: (a) fix #2289 dashboard bugs so the blocked UI
assertions can be enabled; (b) add the gap scenarios above to RN-Android; (c) stand up the
Android-native + iOS sample apps to complete the 3-platform matrix. See `docs/CI-SCOPE.md` for
automation-in-CI.
