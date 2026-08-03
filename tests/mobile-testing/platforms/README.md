# Platform tracks

The RN-Android track is implemented and runnable. The tracks below reuse the **same** API + UI
verification layers (`utils/ooClient.js`, `pages/rumDashboardPage.js`) — only the **drive layer**
(a Maestro flow + an app id) changes. Each needs its own sample app first.

## `ios-react-native/`
Run the existing `O2RumTester` RN app on an iOS simulator.
- **Prereqs:** macOS + Xcode + CocoaPods; `cd O2RumTester/ios && pod install`; boot an iOS simulator.
- **Drive:** the same Maestro flows work (`appId` becomes the iOS bundle id).
- **Known limitation:** iOS Session Replay does not yet reach OpenObserve (the SDK appends its own
  path) — RUM/logs/crashes work. So `@replay`/`@masking` cases are `⬜` for iOS until fixed.

## `android-native/`
A Kotlin sample app using `io.openobserve:oo-sdk-android-*` (no React Native).
- **Prereqs:** write a minimal Kotlin app with the OpenObserve Android SDK + the same triggers
  (network / handled error / crash / a masked form); build its APK.
- **Drive:** new Maestro flows under `maestro/android-native/` (same text-selector style).
- **Verify:** identical API + UI assertions, scoped to a new `service` (e.g. `o2-native-android`).

## `ios-native/`
A Swift sample app using the OpenObserve iOS pods.
- **Prereqs:** Xcode + a Swift app integrating the iOS SDK + the same triggers; run on a simulator.
- **Drive:** new Maestro flows under `maestro/ios-native/`.
- **Verify:** identical API + UI assertions, scoped to a new `service` (e.g. `o2-native-ios`).

## Adding a track (recipe)
1. Build/obtain the sample app; install it on the emulator/simulator.
2. Copy `maestro/react-native/*.yaml` → `maestro/<track>/*.yaml`; set `appId` and adjust labels.
3. Add `RN_SERVICE`-style env for the new service name.
4. Copy `specs/rn-android.*.spec.js` → `specs/<track>.*.spec.js`; point `runFlow` at the new flows
   and the service at the new env. The API/UI layers are unchanged.
5. Add a project to `playwright.config.js` (`testMatch: /<track>\..*\.spec\.js/`).
