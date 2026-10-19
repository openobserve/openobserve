# Test Setup Contract: Ingestion Setup Cards — eBPF Tracing  (area: Streams)

The tracing behaviors (variant toggles, per-variant inputs, command substitution,
`requireOneOf` warning, Helm/flag escaping) are **pure client-side renders** — they
need no stream or data preconditions. This contract therefore has **no mandatory
data setup**; the only requirements are the standard authenticated session and a
working org, plus the page-object helpers already used by `ingestion-config.spec.js`.

## Streams / data the spec must establish

- **None for the primary behaviors.** The Linux/Kubernetes tracing toggles,
  inputs and generated commands render from `RichCardContent` without touching
  the backend.
- **Optional (only if the spec also asserts the "verify" step detection):**
  - Linux detect: metrics stream named `system_*` (keyword match) —
    ingest via `POST {INGESTION_URL}/api/{org}/ingest/metrics/_json` with
    `[{ __name__: 'system_cpu_time', __type__: 'gauge', _timestamp: <us>, value: 1, host: 'e2e' }]`.
  - Kubernetes detect: logs stream `default` with a `k8s_namespace_name` field —
    ingest via `POST {INGESTION_URL}/api/{org}/default/_json`.
  - **Recommendation: keep the tracing spec focused on content; detection is
    already covered by `tests/ui-testing/playwright-tests/Onboarding/first-event.spec.js`
    (Linux keyword card at :160; fluentbit/default at :48-60).**

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / org:** `navigateToBase(page)` (from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`) then
  `getOrgIdentifier()` (from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`).
  Pattern: `tests/ui-testing/playwright-tests/Streams/ingestion-config.spec.js:13-16,24`.
- **Navigate to a card:**
  `pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/linux', orgId)`
  — see `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:77-80`
  (direct `page.goto` equivalent used at
  `tests/ui-testing/playwright-tests/Onboarding/first-event.spec.js:160`).
- **Select a step variant:** `pm.ingestionConfigPage.selectStepVariant('install', 'traces')`
  — `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:102-104`
  (clicks `[data-test="ai-step-<stepId>"] [data-test="ai-variant-<variantId>"]`).
- **Read a step's code block text:** `pm.ingestionConfigPage.getStepCode('install')`
  — `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:106-108`
  (reads `[data-test="ai-step-<stepId>"] [data-test="ingestion-setup-code-block"]`).
- **Type into a variant input:** the native input carries a `-field` suffix —
  `page.locator('[data-test="ai-input-ports-field"]').fill('80,443')`
  (OInput contract: `web/src/lib/forms/Input/OInput.vue:326` emits
  `${dataTest}-field` on the native input). Do NOT target `ai-input-ports` alone
  for typing (that is the wrapper).

## Preconditions / toggles

- No SQL/quick-mode toggle applies. The Recommended page is reachable directly;
  no feature flag gates the cards.
- `DataSourceSetupCard` renders the rich card only when the org passcode is not
  forbidden (`organizationPasscodeForbidden`); the default OSS org passes, so no
  action is needed. (The forbidden banner is enterprise-only.)
- The Kubernetes **install** step's external/internal endpoint toggle is
  self-hosted-only; the **instrument** (eBPF) step under test is identical on
  both editions, so OSS CI is representative.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Native input selector suffix:** OInput renders `data-test="ai-input-<id>"`
  on the wrapper and `ai-input-<id>-field` on the real `<input>`. `fill()` /
  `assertions` must target the `-field` node.
- **The Linux `ports` field defaults to `"8080"`.** So after selecting "traces",
  the command already ends `--trace-ports '8080'` and the `requireOneOf` guard is
  already satisfied — the warning only appears after you *clear* all of
  `ports`/`exe`/`cmd`.
- **eBPF fields open blank (K8s).** Selecting "eBPF" shows the three inputs empty,
  the `ai-variant-require-instrument` warning visible, and the code block hidden;
  a test must fill a selector before asserting the `--set-string` command.
- **Two toggle containers per K8s instrument step:** `ai-variant-tabs`
  (top-level libraries/ebpf) and `ai-subvariant-tabs-instrument` (nested
  java/dotnet/nodejs/python). Scope `selectStepVariant` by the step wrapper so a
  top-level click doesn't hit the nested group.
- **Command text is live-substituted in the DOM `<pre>`.** `getStepCode` reads
  `[data-test="ingestion-setup-code-block-pre"]`; the token is masked until
  revealed, so assert on flag substrings (e.g. `--trace-ports '80,443'`), not the
  whole masked token.
- **Ordering is deterministic:** flags follow the input declaration order
  (`ports, exe, cmd, serviceName`; `ebpfPorts, ebpfExe, ebpfCmd`) and blank flags
  are omitted (Linux) or emitted as `--set <key>=null` (K8s).
- **Windows/macOS are negative cases:** they render a single install code block
  with no `ai-variant-tabs`; assert absence, don't look for a "traces" label.
