# Mobile SDK E2E — CI status, optimization & strategy (overnight report)

_Written overnight while you slept. Read the TL;DR, then the decision in §4 — that's the one thing
that needs your call before the next run can go green._

## TL;DR
- **Big progress + a real root cause found & fixed.** From "nothing ran" → tests build, render, run;
  and I found **why the RN app produced no data.**
- **THE bug:** the config-injection I'd added — `import rumCfg from './rum.config.json'` in `App.tsx`
  — **silently breaks RUM upload in the Hermes release build** (JSON-import version → **0 uploads**;
  reverting to inline constants → **uploads work, 16–20 rows landed**). The **native** apps were
  never affected (they use `BuildConfig`/generated Swift). **Fixed:** App.tsx now uses inline
  constants and CI text-substitutes them (`gen-config.js` seds `@gen:*`), no JSON import. ✅ validated.
- **Also fixed + validated:** RN blank-screen (Release build), iOS link error (Xcode 16.4), token
  rotation (GET not POST), Android test cwd (`cd && npx`). Fresh Docker OO ingests RUM correctly.
- **One networking caveat left (§4):** with the app fixed, it uploads fine to a **reachable instance
  (the dev cluster, over the internet)** — but on my *local* emulator it still can't reach a
  **host-local** OO via `10.0.2.2` **or** `adb reverse`. GitHub's standard AVD may not have this
  quirk, so the pushed fix might just work; if not, point CI at a reachable instance (Model A).

## 1. What was broken and is now fixed (validated)
| Problem | Root cause | Fix | Status |
|---|---|---|---|
| Tests didn't run (Android) | emulator-runner runs each script line in a new shell → `cd` lost | chain `cd && npx` | ✅ fixed (tests ran: 2 passed) |
| RN app = blank screen | `Debug` build loads JS from Metro (absent in CI) | build **Release** (embeds JS) | ✅ **validated locally** — app renders |
| iOS link error | Xcode 26 dropped `swiftCompatibility56` the SDK force-loads | pin **Xcode 16.4** | ✅ CI got past the build → ran the suite |
| Token rejected (403/401) | `POST /rumtoken` **rotates** the token each call | use **GET** (stable token) | ✅ fixed in workflow tonight |

## 2. The root cause — found, fixed, validated
Symptom: app renders, flows complete, `UploadWorker` runs — but **0 events reach OO**.

**How I isolated it (methodically):** the fresh Docker OO ingests a direct-curl RUM event fine;
the **native** Android app has real rows in the dev cluster; only **`o2-rum-tester` (React Native)**
had zero. The only RN-specific change since it last worked was the config-injection. Reverting
`App.tsx` to its **pre-injection inline constants → 20 rows uploaded**; the **JSON-import version →
0**. So: `import rumCfg from './rum.config.json'` **breaks RUM upload in the Hermes release build**
(likely how the JSON module resolves at SDK-init time). **Fix:** inline constants + `gen-config.js`
text-substitution (`sed` the `@gen:*` literals from env) — no JSON import. Re-validated: **16 rows
uploaded** with the fixed build. `rum.config.json` deleted.

### The one thing still open: emulator → host-local OO
With the app fixed, it uploads to a **reachable** instance (dev cluster, internet). But on my local
emulator it still can't reach a **host-local** Docker OO via `10.0.2.2` **or** `adb reverse` (0 POSTs
arrive), while internet traffic works. That's an emulator↔host-loopback quirk of this machine's
emulator; GitHub's `reactivecircus/android-emulator-runner` AVD commonly *does* tunnel correctly, so
the pushed fix may already make CI green. If it doesn't, the fallback is §4 (reachable instance).

<details><summary>Facts established while isolating (kept for the record)</summary>

- ✅ **OO ingestion works** — a direct curl with a proper RUM body lands a row in a fresh Docker OO.
- ✅ **Token** — GET token (not rotating POST) + ingest → HTTP 200.
- ✅ **Native app uploads** — `o2-native-android` had real rows in the dev cluster; RN did not → RN-specific.
- ✅ **The JSON import is the bug** — inline consts upload (16–20 rows); JSON import uploads 0.
- ✅ **Not networking-for-the-fix** — the fixed app uploads to the internet fine; only *host-local* OO
  is unreachable from this emulator (both `10.0.2.2` and `adb reverse`), an emulator-specific quirk.
</details>

## 3. Optimization — the run is slow (~1 hr); here's how to cut it
1. **Cache is cold because builds fail.** Gradle/Pods/SPM/npm caches only *save* on success. The
   first green run warms them; subsequent runs drop ~10–15 min. (Already wired.)
2. **iOS build is the tentpole (~20 min cold).** Cache `Pods/` + DerivedData + SPM (wired); also add
   `xcbeautify`/`-quiet` to cut log noise (cosmetic).
3. **Don't rebuild unchanged apps.** Cache the built **APK/.app keyed by a hash of the app source +
   SDK version**; skip the whole build when unchanged. Biggest single win for repeat runs.
4. **Build once, reuse across suites.** The restructure (§6) builds each app once and runs multiple
   test suites against it (needs runtime-token injection) — avoids the duplicate iOS build.
5. **Pin the OO image** (drop `:latest`) to skip re-pull + get reproducibility.
6. **Right cadence.** This suite should run on **SDK release (dispatch) + nightly**, not every PR —
   so its cost is amortised, not paid per push.

## 4. ⭐ The decision: how CI reaches OpenObserve (Model A vs B)
| | **Model A — reachable instance** | **Model B — self-contained localhost OO** |
|---|---|---|
| How | apps + tests point at a real OO (alpha/cloud), HTTPS | each run starts its own Docker OO on the runner |
| Secrets | needs URL/token (secrets) | none |
| Networking | plain HTTPS — **no emulator tunnel** | needs `adb reverse`/`10.0.2.2` (the current blocker) |
| Proven? | **Yes** — the suite passed against the dev cluster this session | ingestion yes, app→localhost **no (blocked)** |
| Caveat | the dev cluster is `internal.zinclabs.dev` — may not be reachable from GitHub runners; need an **alpha/public** OO | self-contained + free once the tunnel works |

**Recommendation:** get to green with **Model A** against a **reachable alpha/cloud OO** (the app +
SDK + tests are already proven there; HTTPS sidesteps the emulator-tunnel problem). Keep **Model B**
as a follow-up optimization once the `adb reverse` upload path is solved (or use a device farm, §5).
**What I need from you:** a reachable OpenObserve URL + org the runners can hit (alpha?), and I'll
wire it as secrets and we should be green quickly.

## 5. Right track for CI / SDK testing (the strategy)
- **Layered:** unit tests in the SDK repos → **integration** (fixture apps build against each SDK
  version) → **E2E** (this suite: drive → API → UI) → **docs-freshness** (the drift check).
- **Trigger by SDK release** (cross-repo dispatch) + nightly — the real signal, amortised cost.
- **Device reliability:** GitHub emulators/simulators are slow + flaky. For scale, consider a
  **device farm** (Firebase Test Lab, BrowserStack App Automate) that hosts Maestro — more reliable
  than self-hosted emulators, and it removes the emulator↔host networking problem entirely (the
  device and the OO can share a network you control).
- **Executable docs:** align the fixture apps' install/init with the in-product RUM setup snippets so
  a green E2E also validates the documentation.

## 6. Restructure (ready to apply once green)
Target shape, close to `playwright.yml`:
```
preflight → build-android / build-ios (→ app artifacts) → [rn-android · android-native · rn-ios · ios-native] → merge-reports → summary
```
Per-suite jobs = a red job points at one platform; named steps (build/install/run) = build-vs-test at
a glance; merge-reports = one HTML. This needs **runtime-token injection** (pass the token via
`simctl --env` / adb at launch instead of baking it) so build can be its own artifact job. I did
**not** apply it tonight on purpose — reshaping a pipeline whose data-path is still red would just be
moving red boxes. It's designed and ready the moment §4 unblocks the data path.

## 7. Concrete next steps (in order)
1. **You:** pick a reachable OO instance for CI (§4) — alpha or a small cloud OO.
2. **Me:** wire it as secrets, point apps + tests at it (HTTPS), confirm green on one platform.
3. **Me:** apply the restructure (§6) + runtime-token + build-artifact caching (§3).
4. **Me:** enable the docs-drift check + align fixtures to the UI snippets.

_All tonight's validated fixes are committed on `test/mobile-sdk-e2e-automation`. The working tree is
clean; no half-done edits left in the apps._
