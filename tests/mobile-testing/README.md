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
├── maestro/react-native/     Maestro flows (crash, network, handled-error, navigation, masking)
├── specs/                    Playwright orchestration specs (rn-android.*.spec.js)
├── pages/rumDashboardPage.js Dashboard page object (login, open session, masking guard)
├── utils/
│   ├── ooClient.js           OpenObserve Search API client (poll-and-retry)
│   ├── maestro.js            Maestro flow runner
│   └── config.js             env loader
├── platforms/                Scaffolds for iOS-RN, Android-native, iOS-native tracks
├── docs/                     Test-case matrix (md + CSV)
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
npx playwright test --grep @known-bug         # skipped/xfail bug trackers (o2-enterprise#2289)
```

### Coverage (all four mobile tracks + known bugs)
Each platform has a **core RUM** suite (shared factory `utils/coreRumSpec.js`) asserting telemetry
in `_rumdata` (API) **and** that the crashed session renders in the dashboard (UI):

| Project | App | Service | source |
|---|---|---|---|
| `rn-android` | `apps/o2-rum-tester` (Android) | `o2-rum-tester` | `react-native`/`android` |
| `android-native` | `apps/o2-native-android` | `o2-native-android` | `android` |
| `rn-ios` | `apps/o2-rum-tester` (iOS) | `o2-rum-tester` | `react-native` |
| `ios-native` | `apps/o2-native-ios` | `o2-native-ios` | `ios` |
| `known-bugs` | — | — | `test.fixme` trackers for #2289 (flip green when fixed) |

Prereqs: Android emulator booted for the Android projects; an iOS simulator booted (udid in
`.env` `IOS_SIM_UDID`) for the iOS projects; the fixture apps built + installed (see `apps/`).

Tags: `@mobile @rn-android @P0 @P1 @crash @network @errors @views @replay @masking @known-bug`.

## Notes

- **`@known-bug` tests use `test.fail()`** — they assert the *correct* behavior, expect to fail on
  a tracked bug (e.g. Error Tracking, o2-enterprise#2289), and will alert (turn red) if the bug is
  fixed and they start passing.
- **Ingestion is async** — assertions poll-and-retry; never assert instantly.
- **Session isolation** — the current specs scope by `service` + time window. For parallel/CI runs,
  stamp a unique run-id as a RUM global attribute in the app and filter on it (see docs).
- **iOS / native tracks** — see `platforms/` for scaffolds + prerequisites (need their own sample
  apps; iOS additionally needs Xcode/simulator).
