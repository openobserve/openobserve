# Agent Rules — E2E refactor canonical ruleset

**Every background agent working on an e2e spec/PO MUST follow these rules.** Read this file at the start of every task.

---

## ⚠️ TOP-PRIORITY CRITICAL COMPLIANCE — read before EVERY edit

If you edit a spec or PO, you MUST comply with ALL of the following — no exceptions. The user has rejected multiple agent runs for violating these, even when the tests passed. **A passing test with a policy violation is worse than a failing test with clean policy compliance.**

1. **data-test ONLY for selectors.** Read §2 (Strict zero-tolerance selector policy) carefully.P
   - NO `body` / `html` / element-only locators (`page.locator('div')`, `tbody tr`, `td`, `input`, `button`, etc.)
   - NO `.class` selectors (`.q-tooltip`, `.view-line`, `.monaco-list-row`, etc.)
   - NO `getByText` / `getByRole` / `getByLabel` / `getByTitle` / `getByPlaceholder` / `getByAltText`
   - NO `:has-text(...)`, `:nth-child(...)`, `filter({ hasText: ... })`, `data-cy`
   - NO XPath element-tag predicates (`//tr[.//div[@title=...]]`). XPath via `ancestor::*[starts-with(@data-test,'...')]` IS OK.
   - If a needed data-test doesn't exist, add it to the source `.vue` minimally and log it in the audit.

2. **POM STRICT — locators live in the class constructor, methods reference them.**
   - NEVER write `this.page.locator(...)` INSIDE a method body. Hoist to a `this.<name>` class member in the constructor.
   - Per-name / per-index factory helpers (`getRowByName(name)`) are OK when the value is runtime-dynamic; they still return a `Locator`.
   - Spec files do NOT call `page.locator(...)` directly — they call PO methods only.
   - If a method needs a runtime-built locator, ADD a factory member to the constructor. Do NOT inline.

3. **Comment + log preservation (§9a) — NEVER remove:**
   - JSDoc blocks (`/** ... */`) above functions that still exist
   - Section banners (`// =========================================`, `// METHOD GROUP — ...`)
   - Inline `//` comments unless their code is also removed in the same edit
   - `testLogger.info` / `debug` / `warn` / `error` calls (string-only edits are OK)
   - "Update:" / "Note:" / "TODO:" annotation blocks — do NOT add these on top of existing comments; just modify code silently.

4. **Dev-server-only failures (§7a) — DO NOT add workarounds:**
   - NO time-range widening fallbacks (`if (!hasResults) await setTimeRange('12h')`)
   - NO inline `test.skip(true, 'No trace data')` runtime skips
   - NO "exit gracefully if no data" branches
   - NO `return false` instead of `throw` to dodge serial-chain failures
   - NO `page.request.put(INGESTION_URL...)` CORS-bypass workarounds
   - If a test only fails because of a local dev-server / pentest env quirk, classify it out-of-scope and report — leave the spec in the shape that works in CI / production.

5. **Hard prohibitions (§9) — NEVER:**
   - `test.skip` in source spec files to dodge a failure
   - Restart the dev server (it's already running on 8081)
   - Make data-test names collide across the project
   - Edit files outside your assigned scope

6. **`waitForTimeout` is BANNED (§10).**
   - NEVER add `page.waitForTimeout(...)` / `this.page.waitForTimeout(...)` / `await waitForUI(...)` anywhere — not as a "buffer", not after clicks, not after navigation, not after popover opens.
   - Use deterministic waits ONLY: `locator.waitFor({ state: 'visible' })`, `expect(locator).toBeVisible()`, `expect.poll(...)`, `page.waitForURL`, `page.waitForLoadState`, `page.waitForResponse`, `page.waitForFunction` keyed on a real condition.
   - If existing code has `waitForTimeout`, REMOVE it during your edit and replace with a deterministic wait keyed on the actual state you're waiting for.

**Before reporting back:** run the §11 self-audit. `git diff HEAD <file> | grep -E "^-\\s*(/\\*\\*|\\*|testLogger)"` — if it returns ANY line above surviving code, RESTORE it before reporting. Also run `git diff HEAD <file> | grep "+.*waitForTimeout"` — if you ADDED any waitForTimeout, remove it and use a deterministic wait instead.

---

## 1. Branch and environment

- Stay on branch `test/ux-revamp/dashboards`. No new branches, no git worktrees.
- Scope: **Dashboards-Variables** (`testfolder: "Dashboards-Variables"` in `playwright.yml`).
- Always use these pentest env vars when running Playwright: `.github/workflows/playwright.yml`):
  ```
  ZO_ROOT_USER_EMAIL=automation@tester.ai
  ZO_ROOT_USER_PASSWORD='12345678'
  ZO_BASE_URL=http://localhost:8081
  INGESTION_URL=https://pentest.o2aks1.internal.zinclabs.dev
  ORGNAME=default
  ```
- Run from `/Users/ktx/Documents/KTX-Projects/openobserve/tests/ui-testing`. Dev server already on 8081 — do NOT restart it.
- Spec files in scope (all under `playwright-tests/Dashboards/`):
  ```
  dashboard-variables-setting.spec.js
  dashboard-variables-global.spec.js
  dashboard-variables-tab-level.spec.js
  dashboard-variables-panel-level.spec.js
  dashboard-variables-dependency.spec.js
  dashboard-variables-refresh.spec.js
  dashboard-variables-url-sync.spec.js
  dashboard-variables-creation-scopes.spec.js
  dashboard-variables-default-values-chain.spec.js
  dashboard-variables-custom-parents.spec.js
  dashboard-variables-stream-field.spec.js
  dashboard-mustache-variables.spec.js
  ```

## 2. STRICT zero-tolerance selector policy

**Allowed:**

- `[data-test="..."]` and CSS attribute-selector composites of `data-test*` attributes (`^=`, `$=`, `*=` on `data-test*`)
- XPath via `ancestor::*[starts-with(@data-test,'...')]` — keys off a data-test prefix, no element-tag predicate
- `page.evaluate(...)` patterns scoped to data-test attributes (the approved Monaco / JsonPreview / virtualised-table pattern)
- `page.keyboard.press(...)` / `page.keyboard.type(...)` for editor input and Escape-to-dismiss

**Forbidden everywhere (spec files + PO files):**

- `body` / `html` / element-only locators (`page.locator('div')`, `tbody tr`, `td`, `input`, etc.)
- `.class` selectors (Quasar `.q-tooltip`, `.view-line`, `.monaco-list-row`, `.json-key`, etc.)
- `getByText`, `getByRole`, `getByLabel`, `getByTitle`, `getByPlaceholder`, `getByAltText`
- `:has-text("...")`, `:nth-child(...)`, `:nth-of-type(...)`
- `filter({ hasText: ... })`
- `data-cy="..."` (legacy Cypress attr)
- XPath with element-tag predicates (e.g. `//tr[.//div[@title="..."]]`, `//button[contains(text(),...)]`)
- Inline JS-concatenated selectors that produce invalid CSS (e.g. `${this.crossLinkFieldInput}-popover input` is INVALID — write the literal string)

## 3. POM strict

- All locators MUST live in the class constructor as `this.<name>` members.
- Methods MUST reference those class members. **NEVER** write inline `this.page.locator(...)` inside a method body.
- Per-name / per-index factory helpers (e.g. `getRowByName(name)`) are allowed when the value is runtime-dynamic; they still return a `Locator`.
- Spec files do not call `page.locator(...)` directly — they call PO methods only.

## 4. Component conventions to target

| Component                            | Convention                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| `OInput` wrapper                     | `data-test="<name>"`                                                                                                                                                                      |
| `OInput` inner native `<input>`      | `data-test="<name>-field"` (auto-derived) — **always fill the `-field` variant**                                                                                                          |
| `OFile` native `<input type="file">` | `data-test="<name>-field"`                                                                                                                                                                |
| `OSelect` listbox option             | `data-test="${parent}-option"` shared **and** `data-test-value="<value>"` per item — use the `data-test-value` for value-specific picks                                                   |
| `OSelect` popover                    | `data-test="${parent}-popover"`                                                                                                                                                           |
| `OTable` row                         | `data-test="o2-table-row-{N}"`; walk from cell up via `xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`                                                                        |
| `OTable` cell                        | `data-test="dashboard-data-row-cell"` (or per-row named, e.g. `dashboard-name-cell-{name}`)                                                                                               |
| `OToast`                             | `data-test="o-toast-success"` / `o-toast-error` / `o-toast-message`                                                                                                                       |
| `OCheckbox`                          | Read state via `data-state="checked                                                                                                                                                       | unchecked | indeterminate"`attribute (no native`<input type="checkbox">`) |
| `ODialog` footer buttons             | `data-test="o-dialog-primary-btn"` / `o-dialog-secondary-btn` (scoped under the parent dialog data-test)                                                                                  |
| `OTooltip` content                   | `data-test="o-tooltip-content"`                                                                                                                                                           |
| `ODateRangeCalendar` day cell        | `data-test="daterangecalendar-cell-{ISO-date}"` (e.g. `daterangecalendar-cell-2026-05-01`)                                                                                                |
| `OTime` trigger                      | data-test forwards from the consumer's attribute via `parentDataTest`                                                                                                                     |
| `OCombobox`                          | Wrapper `data-test="<name>"`, inner input `data-test="<name>-input"`, option `data-test="<name>-option"` (+ `data-test-value="<value>"`); imperative `clear()` exposed via `defineExpose` |

## 5. Monaco editor

- Drive value via `window.monaco.editor.getEditors()` and the editor's model — `editor.getValue() / setValue(...)` / `editor.executeEdits(...)`. **Do NOT** scrape `.view-lines .view-line`.
- Suggestion items: `editor.getContribution('editor.contrib.suggestController').model._completionModel?.items ?? editor.getContribution('editor.contrib.suggestController').model.items`. Map both `string` and `{ label }` shapes.
- `isAutocompleteOpen()` keys off completion items length, **not** the Monaco state enum (it varies by version).
- `web/src/components/CodeQueryEditor.vue` exposes `window.monaco` immediately after `loadMonaco()` — required for e2e.

## 6. Source `.vue` edits

- Add a missing `data-test` attribute when it's the only clean way to target an element. Keep the addition minimal — no component redesigns.
- When adding data-test attributes, prefer architectural patterns (e.g. forwarding a consumer's data-test, generating `${parent}-<role>` automatically) over per-instance hardcoded names.
- **Ensure data-test uniqueness across the entire project.** Pick names like `dashboard-…-foo`, `logs-…-bar` to scope them.
- Log every source `.vue` change in the audit md (this is a meaningful change worth recording).

## 7. Out-of-scope situations

- **Add-panel filter tests** in `dashboard.spec.js` (2 tests: `should dynamically update the filtered data ...`, `should apply various filter operators ...`) and `dashboard-chartJson.spec.js` (`Should display data as JSON ...`) — these exercise a known-broken filter UI. **Do not run them, do not edit them.** Do NOT add `test.skip` to the source file. Just don't `--grep` them.
- **`dashboard-share-link.spec.js`** and **`maxquery.spec.js`** — user directive: ignore these specs entirely (not in Dashboards-Variables scope anyway).
- Any spec **outside** the 12 `dashboard-variables-*.spec.js` / `dashboard-mustache-variables.spec.js` files listed in §1 — out of scope for this agent run.
- **Dev-server CORS** — when `page.evaluate(() => fetch('/api/...'))` 404s against the Vite dev server, that's a **local-only** concern. Do NOT add `page.request.put(INGESTION_URL...)` workarounds with Basic auth. The CORS gap does not exist in CI / production.
- **Real backend flakes** (e.g. pentest `_search_stream` timeout, intermittent canvas/`_echarts_instance_` render race) — classify as out-of-scope, report in the final summary, do NOT keep retrying.

### 7a. Dev-server-only failures (STRICT — added after env-specific workarounds slipped in)

If a test fails **only because of a local dev-server / pentest env quirk** — examples:

- Trace ingestion 404s on Vite dev because the SPA's API endpoint differs from page origin
- No trace data in the env, so search returns empty
- Stream list pagination shows the row on page 56+ because the pentest backend has 1000+ items
- `/web/traces` returns `Content-Type: text/javascript` without trailing slash (dev-server routing quirk)
- Any other failure that would NOT occur in CI / production

…then:

1. **DO NOT edit or modify the spec or PO to work around it.** No env-adaptive widening (`15m → 12h`), no inline `test.skip(...)` fallbacks for empty data, no widened time ranges, no "exit gracefully if no data" branches, no retry-with-different-params loops.
2. **DO NOT actually run the failing test against the dev server.** Skip the e2e run for that specific failure.
3. **Mark the test as "verified at policy level"** in your report and in the audit. The policy-level criterion is: selectors are data-test-only, POM is strict, comments + testLogger preserved, no source-spec `test.skip` was added.
4. If you previously added a dev-server workaround, **revert it.** The spec should be left in the shape that works on CI / production.

Real failures (PO bugs, real OSelect data-test misses, real OInput-wrapper-vs-field issues) still get fixed normally. The distinction: a real failure occurs against a healthy backend with valid data; a dev-server-only failure occurs because the local env can't produce the data or routing that the test depends on.

## 8. Workflow

1. **Foundation pass first:** clear selector violations from the shared PO file(s) without running tests. Hoist inline locators into class members.
2. **Run the spec:** `bunx playwright test playwright-tests/Dashboards/<spec> --reporter=list 2>&1 | tee /tmp/<spec>-T1.log` (from `tests/ui-testing/`). To run the whole group: `bunx playwright test playwright-tests/Dashboards/dashboard-variables-*.spec.js playwright-tests/Dashboards/dashboard-mustache-variables.spec.js --reporter=list`. Capture initial pass/fail counts.
3. **Per failing test (cap 3 attempts each):**
   - Read the failure stack trace.
   - Identify root cause: missing data-test, OInput-wrapper-vs-`-field`, OSelect virtualisation, OTab re-mount race, dialog portal close race, OToast wait, etc.
   - Fix the PO (preferred) or the spec inline. Never touch source `.vue` unless adding a missing data-test attribute.
   - Re-run that exact test with `--grep "<title>"` until it passes.
4. **Final full-spec re-run** to confirm no regressions.
5. **Audit append** — `tests/ui-testing/playwright-tests/Dashboards/audit/dashboards-variables.audit.md` (create if absent), under the appropriate section. **Only log meaningful changes** (real bug fixes, source modifications, architectural shifts). Skip routine selector swaps and pure POM hygiene.

## 9. Hard prohibitions

- **NEVER** add `test.skip` to source spec files to dodge a failure. Fix it, or report out-of-scope at the end.
- **NEVER** add CORS-bypass API workarounds (`page.request.put(INGESTION_URL...)` with Basic-auth from `ZO_ROOT_USER_*` env). Per user directive.
- **NEVER** make data-test names collide across the project — ensure uniqueness.
- **NEVER** edit files outside your assigned scope when running in parallel with another agent. File ownership is communicated in the agent prompt.
- **NEVER** restart the dev server. It's already running on 8081.

### 9a. Comment preservation (STRICT — added after multiple regressions)

- **NEVER remove a JSDoc block** (`/** ... */`) above a function that still exists after your refactor. Preserve it verbatim.
- **NEVER remove an inline `//` comment** unless the line(s) of code it describes are also being removed in the same edit.
- **NEVER remove section header banners** (e.g. `// =========================================`, `// STREAM UI CREATION METHODS`) — they're navigational landmarks.
- **NEVER add "Update:" / "Note:" / "TODO:" annotations** explaining what changed. Just keep the original comment and modify the code silently.
- **NEVER remove `testLogger.info` / `testLogger.debug` / `testLogger.warn` / `testLogger.error` calls** — preserve all telemetry logs. If you change a logger's message string, that's OK; removing it entirely is NOT.
- When in doubt, **err toward keeping the comment / log**. Comments and logs are part of the maintained surface area, not noise.

If you must change behaviour, change only the code. Leave the comment alone. The comment may end up describing the old behaviour — that's fine; it's historical context.

## 10. `waitForTimeout` is BANNED (latest user directive)

**NEVER use `page.waitForTimeout(...)` / `this.page.waitForTimeout(...)` / wrapper methods that do `setTimeout`-style waits (e.g. `waitForUI(ms)`).** This includes:

- After clicks, popover opens, dropdown opens
- After navigation / `page.goto`
- After Apply / Run query / network-triggering actions
- As any "buffer" / "settle" wait — banned outright

Use deterministic waits keyed on real state:

- `locator.waitFor({ state: 'visible' | 'attached' | 'hidden' | 'detached' })`
- `expect(locator).toBeVisible({ timeout })` / `expect(locator).toHaveText(...)` / etc.
- `expect.poll(async () => ..., { intervals, timeout })` for state convergence
- `page.waitForURL('**/path/**')` after a navigation
- `page.waitForLoadState('domcontentloaded' | 'networkidle')` after a route change
- `page.waitForResponse(url => ...)` after an action that triggers a network call
- `page.waitForFunction(() => ..., { timeout })` for arbitrary state convergence (e.g. Monaco editor ready, app store hydrated)

**When editing an existing method that has `waitForTimeout`, REMOVE it and replace with a deterministic wait** for the actual state the timeout was masking. If you don't know what state to wait for, dig until you find it — don't add a timeout back.

The user has reversed this rule once before ("tests get flaky"), but the latest directive (most recent) is **never use waitForTimeout**. Honour the latest.

## 11. Reporting

Every agent reports back with:

- Initial pass/fail counts.
- Per-failed-test fixes (title + one-line root cause + file changed).
- Final pass/fail counts.
- Tests still failing after the 3-attempt cap with their root-cause classification (real bug / out-of-scope backend / cross-suite dependency).
- Audit rows appended (only for meaningful changes — list them by file).

Keep the report under the word cap specified in the agent's prompt.
