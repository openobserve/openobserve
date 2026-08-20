# Apps under test (test fixtures)

The apps the Maestro flows drive. Each embeds an OpenObserve Mobile RUM SDK and exposes buttons that
generate every telemetry type (views, actions, network, handled error, crash) plus a PII form for
masking tests. These are **fixtures**, not products.

## `o2-rum-tester/` — React Native (Android/iOS)
A minimal RN app using `@openobserve/mobile-react-native@0.1.0-alpha.5` (same SDK family as the
ShopSphere alpha5 build). App id: `com.o2rumtester`. Screens/triggers are in `App.tsx`.

**Build & install (Android):**
```bash
cd o2-rum-tester
npm install                         # postinstall applies the SDK build fix (see below)
(cd android && ./gradlew assembleRelease)
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**SDK build fix (`scripts/patch-sdk.js`, run on postinstall):**
alpha5's `@openobserve/mobile-react-native-session-replay` ships an un-rebranded Gradle project
reference (`:datadog_mobile-react-native`) that breaks `assembleRelease` (o2-enterprise#2289). The
postinstall script rewrites it to `:openobserve_mobile-react-native` and runs the SDK's required
`replace-react-require` step. Idempotent — safe to re-run.

**Endpoint / token:** configured in `App.tsx` (`customEndpoint` + `clientToken`) to point at the org
under test. Rotate the token via the dashboard's "Reset RUM Token".

## Adding a native fixture
For the Android-native / iOS-native tracks, add sibling apps here (`o2-native-android/`,
`o2-native-ios/`) using the respective OpenObserve native SDKs with the same triggers, then point new
Maestro flows at their app ids. The API + UI verification layers are unchanged.
