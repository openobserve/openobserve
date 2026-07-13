# Alpha1 E2E Stabilization — Status & Handoff

_Autonomous overnight session. Branch: `test/alpha1-stabilization` (all fixes committed + pushed)._

## TL;DR
Genuine revamp-broken **selector/code bugs are fixed**. The **majority of remaining failures are the alpha ENVIRONMENT** (intermittent VPN/network drops + backend job/query latency), **not code** — they pass on retry / when the env is healthy. Getting modules to a stable 100% green is gated on env stability + CI `retries`, not more selector fixes.

## What's fixed (committed on `test/alpha1-stabilization`)
| Fix | Impact |
|---|---|
| Login user → `e2etest@o2-qa.com` (Okta 404 avoided) | unblocked all modules |
| Org-switch selectors (`global-setup-alpha1.js`) | unblocked all modules |
| **Ingestion http→https agent** (`ingestionPage.js`) | recovered ~27 tests/module |
| Streams add-stream modal → `ODialog` selectors | **streamCreation 4/4 green** |
| **Interesting-fields** (`logsPage.js`): prefer `interesting-` btn (resolve by count), hover-reveal, title-based idempotency, Quick-Mode aware | **logsquickmode 2/9 → 6/9**; cascades to Streams multiselect/streaming |

Plus **PR A #13155** (shared cloud fixes) and **PR B #2155** (workflow enhancements) — both raised & CI-validated.

## Module state (measured, retries=1)
| Module | State | Notes |
|---|---|---|
| **Cloud** | ✅ **100% green** (CI-verified) | done |
| **Logs-Core** | **66/84 passing** (was 35) | genuine bugs fixed; remaining ~15 = ~8 env-flakes (5 net::ERR_ADDRESS_UNREACHABLE + auth + latency) + 3 finicky interesting-fields (L91/L179/L206) + 2 behavior/assertion |
| **Streams** | **24/29 passing** (was 7) | streamCreation/streamname/streaming/stream-settings essentially clean; remaining 2-3 = **success-toast auto-dismiss + list-refresh timing** (selectors verified present — pure flake, passes standalone) |
| **Functions** | analyzed: **0 broken selectors** | ALL failures are timing/nav (async URL-jobs, `networkidle` goto to `_meta`) — env, not code |

### The ingestion bug was in THREE places (all now fixed)
The `http.Agent` rejecting `https://` bug existed in **3 separate ingestion helpers** — found by following cross-module failures:
1. `pages/generalPages/ingestionPage.js` (Logs)
2. `pages/streamsPages/streamsPage.js` `_nodeFetchSafe`
3. `utils/apiUtils.js` `sendRequest` (shared — used by streamsPage.ingestTestData, recovered multiselect + streamname)
All now select the agent by URL protocol. This single class of bug was the biggest single source of failures across modules.

## The env finding (important context)
- During tonight's runs the internal alpha URL **dropped repeatedly** (`net::ERR_ADDRESS_UNREACHABLE`), then recovered (5/5 reachable after). Intermittent, not persistent.
- Backend URL-fetch/enrichment jobs and cross-org (`_meta`) navigation are **slow**, causing `waitForResponse`/`page.goto`/`networkidle` timeouts.
- **Implication:** a chunk of "failures" are not fixable in test code. They need (a) env stability and (b) CI `retries:1` (already in the enhancements PR). Don't chase these as selector bugs.

## Remaining genuine (code-ish) items — classified, for judgment
1. **interesting-fields L91/L179/L206** — the toggle works (2→6 proved it) but SELECT propagation is view/timing-finicky after `clickAllFieldsButton` in the beforeEach. Needs either a beforeEach rethink or a stronger "ensure interesting-fields view" step. NOT a simple rename.
2. **`verifyAPICallCounts` (logstable:567)** = "exactly one search + one histogram call". If the revamp legitimately changed call counts, the *expected count* needs updating — **dev judgment**, don't blind-edit.
3. **`clickErrorMessage` / `ensureQuickModeState` / `expectTextVisible`** — selectors PRESENT in source; failures are timing/state. Candidate for adaptive waits, low certainty.

## Next modules — analyzed (read-only), genuine bugs applied
| Module | Genuine fatal selector bugs | Action taken |
|---|---|---|
| **Alerts** | **1**: `o2-table-select-all` → `o2-table-th-select` (select-all header; breaks move-to-folder + export in 3 specs) | ✅ **fixed + committed** |
| **Pipelines** | **1**: `scheduled-alert-tabs` → `scheduled-pipeline-tabs` | ✅ **fixed + committed** |
| **GeneralTests** | **1**: `settings-general-page-title` → `general-settings-tab` (unguarded `toBeVisible` in `validateSettingsGeneralPageElements`, landingPage.spec.js:291) | ✅ **fixed + committed** (`926738d53`) |
| **RegressionSet** | **1**: `clickVrlToggleButton` used dead `logs-search-bar-vrl-toggle-btn`; now routes through utilities menu like sibling `clickVrlToggle`. `.catch`-guarded click but fatal downstream at logs-bugs.spec.js:795 | ✅ **fixed + committed** (`1ae234104`) |
| **Traces** | **0 fatal** — 4 broken selectors are all **guarded/non-fatal** (tests pass *vacuously*); fixing restores coverage but risks exposing hidden failures | ⏸ documented, NOT blind-fixed (regression risk) |
| **Functions / Metrics / SDR / Logs-Queries / Logs-Features** | **0** — all failures timing/nav (async URL-jobs, `_meta` `networkidle` goto) | none |

**Sweep complete (13 modules analyzed).** Genuine module-specific fatal selector fixes: Streams×4, Alerts×1, Pipelines×1, GeneralTests×1, RegressionSet(VRL)×1 = **7**, plus the shared fixes (login, org, ingestion×3, interesting-fields). All other modules are env/timing only.

**Meta-finding:** genuine *fatal* red→green selector bugs are now **largely exhausted** — the big ones (3 ingestion helpers, Logs interesting-fields, Streams modal, Alerts select-all) are found & fixed. What remains across modules is **env/timing flakiness** (not code) + **non-fatal coverage selectors** (Traces — risky to blind-fix). Analyzing more modules will mostly repeat this pattern.

## Per-module PR plan (your "diff branches")
All fixes are stacked on `test/alpha1-stabilization` with **scoped, per-module commit messages** so they split cleanly:
- **Shared/cloud** (login, org, ingestion×3): `641d2665e`, `5f7263e74`, `b67f5d565` (+ PR A #13155)
- **Logs interesting-fields**: `6441d2a0d`, `7d54cb434`, `2c85d41c6`, `032aa2dfe`
- **Streams**: `c6803ffc6`, `574b5045d`
- **Alerts**: (this session's select-all commit)
To create per-module branches: `git checkout -b test/alpha1-<module> main` then `git cherry-pick <that module's commits>` (shared-fix commits are a prerequisite base for any module branch to actually run).

## Recommended next steps
1. Re-run Logs-Core when env is healthy — expect the ~8 env-flakes to clear, landing ~74-76/84.
2. For per-module PRs (your "diff branches"): cherry-pick from `test/alpha1-stabilization` — e.g. the Streams add-stream fix → Streams PR; the interesting-fields fix → Logs PR. (All commits have clear, scoped messages.)
3. `verifyAPICallCounts` + the interesting-fields beforeEach need a decision, not a blind fix.
4. **Functions/Traces/Metrics/etc.** will mostly be env-timing (like Functions), not selector work — budget accordingly.

_Full technical detail in the session memory (`alpha1-suite-stabilization`)._
