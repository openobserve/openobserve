# Mobile RUM E2E — CI Scope

How to run `tests/mobile-testing/` in CI, the blockers, and a concrete workflow.

## 1. Goal
Run the mobile RUM E2E suite automatically (per-PR for smoke, nightly for full) across the platform
tracks, producing a pass/fail gate + an HTML report.

## 2. Three hard problems (mobile CI is different from web CI)

1. **An emulator/simulator must run in CI.**
   - Android: Linux runner **with KVM** + `reactivecircus/android-emulator-runner`. Or **Firebase
     Test Lab** / BrowserStack for real-device matrix.
   - iOS: a **macOS runner** + Xcode iOS simulator (RN-iOS / iOS-native tracks).
2. **The app under test must be built/available.** Build the `O2RumTester` APK in CI (or publish it
   as a release artifact and download it). iOS needs an Xcode build + `pod install`.
3. **The OpenObserve instance must be reachable from the runner.** `dev.o2aks1.internal.zinclabs.dev`
   is internal — GitHub-hosted runners cannot reach it. Choose one:
   - **(A) Self-hosted runner inside the network/VPN** (simplest for the existing dev instance).
   - **(B) Disposable OpenObserve in CI** — start an OO container, point the app's `customEndpoint`
     + the suite's `OO_URL` at it, ingest, assert. Best isolation; matches the design doc §10
     "disposable OpenObserve" contract-test idea. Requires the app to read the endpoint at runtime.

**Recommendation:** start with **(A) self-hosted runner** to reuse the current dev instance and get
signal fast; migrate the smoke tier to **(B) disposable OO** for hermetic, parallel-safe CI.

## 3. Gating policy
- `@P0` (crash, core capture) — **blocks** the PR.
- `@P1` — blocks nightly; warn on PR.
- `@known-bug` (xfail, e.g. #2289) — **never blocks**; alerts only if it starts passing.
- Flake: `retries: 1` already configured; a test that only passes on retry is reported flaky, not
  failed. Track flaky rate.

## 4. Concrete workflow — Android (self-hosted, dev instance)

`.github/workflows/mobile-rum-android.yml`:
```yaml
name: Mobile RUM E2E (Android)
on:
  pull_request:
    paths: ['tests/mobile-testing/**']
  schedule:
    - cron: '0 2 * * *'   # nightly full run
jobs:
  rn-android:
    runs-on: [self-hosted, linux, android]   # in-network runner with KVM + Android SDK
    timeout-minutes: 40
    env:
      OO_URL:  ${{ secrets.OO_URL }}
      OO_ORG:  ${{ secrets.OO_ORG }}
      OO_USER: ${{ secrets.OO_USER }}
      OO_PASS: ${{ secrets.OO_PASS }}
      MAESTRO_CLI_NO_ANALYTICS: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }

      # Build the test app (its source lives in the suite; postinstall applies the SDK fix)
      - name: Build o2-rum-tester APK
        run: |
          cd tests/mobile-testing/apps/o2-rum-tester
          npm install
          (cd android && ./gradlew assembleRelease)

      - name: Install Maestro
        run: curl -Ls "https://get.maestro.mobile.dev" | bash

      - name: Suite deps
        run: |
          cd tests/mobile-testing
          npm ci
          npx playwright install --with-deps chromium
          printf 'OO_URL=%s\nOO_ORG=%s\nOO_USER=%s\nOO_PASS="%s"\n' \
            "$OO_URL" "$OO_ORG" "$OO_USER" "$OO_PASS" > .env

      # Boot emulator + install app + run the suite
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          arch: x86_64
          script: |
            adb install -r tests/mobile-testing/apps/o2-rum-tester/android/app/build/outputs/apk/release/app-release.apk
            export PATH="$HOME/.maestro/bin:$PATH"
            cd tests/mobile-testing && npm run test:rn-android

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: tests/mobile-testing/playwright-report/
```

## 5. iOS addendum (when the iOS track exists)
- `runs-on: [self-hosted, macos]` (or GitHub macOS runner if the instance is reachable).
- Steps: `pod install` → build for a simulator (`xcodebuild`/`xcrun simctl`) → boot simulator →
  `maestro test maestro/ios-react-native/*.yaml` → same API + UI assertions.
- Remember: iOS Session Replay does not yet reach OpenObserve — keep `@replay`/`@masking` iOS cases
  disabled until fixed.

## 6. Secrets
`OO_URL`, `OO_ORG`, `OO_USER`, `OO_PASS` as GitHub repo/org secrets (never inline). The app's RUM
token is baked into the build; rotate via the dashboard's "Reset RUM Token".

## 7. Phasing
1. **Now:** self-hosted Android runner, smoke tier (`@P0` crash + core) per-PR; full nightly.
2. **Next:** add the gap scenarios; migrate smoke to a disposable OO instance for hermetic runs.
3. **Then:** add macOS runner for RN-iOS; add Android-native / iOS-native jobs once their sample
   apps exist. Consider a device-farm matrix (Firebase Test Lab) for OS/device coverage.
