# Mobile RUM SDK — End-to-End Test Suite

E2E tests for OpenObserve's **Mobile RUM SDK** (`@openobserve/mobile-react-native` and native
tracks). Each test drives a real mobile app on an emulator/simulator, then asserts the telemetry
both **at the data layer** (OpenObserve Search API) and **at the product layer** (the RUM
dashboard UI) — because most mobile-RUM defects live in the dashboard, not the pipeline.

## The 3-layer pattern

Every scenario is the same shape, threaded by `session_id`:

```
1. DRIVE   Maestro flow taps through the app        (maestro/<track>/*.yaml)
2. API     query _rumdata → assert data is correct  (utils/ooClient.js)
3. UI      open the dashboard → assert it renders    (pages/rumDashboardPage.js)
```

Why both layers? Nearly every bug found in manual testing (Error Tracking, Web Vitals,
breadcrumbs, Traces) was a **display bug**: the data was correct in `_rumdata` but the dashboard
failed to show it. An API-only suite would have been green on a broken product.

## Layout

```
mobile-testing/
├── apps/                     Vendored fixture apps (o2-rum-tester, o2-native-android, o2-native-ios)
├── maestro/                  Maestro flows per track (react-native, android-native, ios-native, ios-react-native)
├── specs/                    Playwright specs (rn-android.*, rn-ios.*, android-native.*, ios-native.*)
├── pages/rumDashboardPage.js Dashboard page object (login, open session, masking guard)
├── utils/
│   ├── ooClient.js           OpenObserve Search API client (poll-and-retry)
│   ├── rumChecks.js          per-capability test factories (attributes/user/network/masking/…)
│   ├── coreRumSpec.js        the crash → dashboard core journey
│   ├── maestro.js            Maestro flow runner
│   ├── adb.js                device-level Android steps
│   └── config.js             env loader
├── docs/                     Coverage matrix, CI notes, test-case matrix
├── playwright.config.js
└── .env / .env.example       instance URL, org, creds, app id
```

## Prerequisites

- **Node 20+**, **JDK 17**, Android SDK + an emulator (AVD)
- **Maestro** CLI: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- The app under test (`com.o2rumtester`) — its source lives **in this suite** at
  `apps/o2-rum-tester/`. Build + install it:
  ```bash
  cd apps/o2-rum-tester && npm install    # postinstall auto-applies the SDK build fix
  (cd android && ./gradlew assembleRelease)
  adb install -r android/app/build/outputs/apk/release/app-release.apk
  ```
- A reachable OpenObserve instance with a RUM token wired into the app (see `.env` and
  `apps/o2-rum-tester/App.tsx`)

## Setup

```bash
cp .env.example .env     # fill in OO_URL / OO_ORG / OO_USER / OO_PASS  (quote passwords with #)
npm install
npx playwright install chromium
```

## Run

```bash
# one platform (Playwright projects)
npx playwright test --project=rn-android
npx playwright test --project=android-native
npx playwright test --project=rn-ios          # needs a booted iOS simulator
npx playwright test --project=ios-native      # needs a booted iOS simulator

# by tag
npx playwright test --grep @crash
npx playwright test --grep @masking
npx playwright test --grep @known-bug         # the skipped #2289 markers
```

### Coverage (all four mobile tracks) — 42 tests
Each platform has a **core RUM** bundle (`utils/coreRumSpec.js`: views + actions + handled error +
native crash in `_rumdata`, then the crashed session rendering in the dashboard) **plus**
per-capability specs built from shared factories in **`utils/rumChecks.js`** — so the platforms stay
at parity without copy-paste:

- `attributesSuite` — env / service / version tagging
- `userIdentitySuite` — events attributed to the set user (usr_* fields)
- `networkSuite` — a successful fetch is a resource (**positive**) + a 4xx status is captured (**negative**)
- `maskingSuite` — no PII leaks into the session replay (MASK_ALL)
- `bgFgSuite` — a pre-background view and a post-foreground view share one session
- `noPhoneHomeAndroidSuite` — the installed APK contains zero Datadog hosts (**security/negative**)

| Project | App | Service | Specs |
|---|---|---|---|
| `rn-android` | `apps/o2-rum-tester` (Android) | `o2-rum-tester` | crash, network(+404), handled-error, views, masking, attributes, user-identity, background-foreground, no-phone-home |
| `android-native` | `apps/o2-native-android` | `o2-native-android` | core bundle, attributes, user-identity, no-phone-home |
| `rn-ios` | `apps/o2-rum-tester` (iOS) | `o2-rum-tester` | core bundle, network(+404), attributes, user-identity, masking |
| `ios-native` | `apps/o2-native-ios` | `o2-native-ios` | core bundle, attributes |

See **`docs/COVERAGE-MATRIX.md`** for the full capability×platform matrix, on-device validation
status, and the deferred follow-ups (native/iOS background-foreground, native network/masking,
iOS-native user identity — each needs a fixture-app change or a background harness).

Prereqs: Android emulator booted for the Android projects; an iOS simulator booted (udid in
`.env` `IOS_SIM_UDID`) for the iOS projects; the fixture apps built + installed (see `apps/`).

Tags: `@mobile @rn-android @rn-ios @android-native @ios-native @P0 @P1 @crash @network @negative @errors @views @replay @masking @lifecycle @attributes @user-identity @security @known-bug`.

## Notes

- **The known Error-Tracking outage (o2-enterprise#2289) is a `test.fixme` skip** inline in the
  relevant spec — no separate file or project. It stays skipped and turns into a real assertion
  when the bug is fixed.
- **Ingestion is async** — assertions poll-and-retry; never assert instantly.
- **Session isolation** — the current specs scope by `service` + time window. For parallel/CI runs,
  stamp a unique run-id as a RUM global attribute in the app and filter on it (see `docs/CI-NOTES.md`).
- **Fixture apps** — the four apps live in `apps/` (each builds against the SDK from npm/Maven/SPM);
  iOS tracks additionally need Xcode/simulator. Build/run steps are in each app + `docs/CI-NOTES.md`.
