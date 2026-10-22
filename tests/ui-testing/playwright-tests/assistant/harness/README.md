# O2 Assistant mock harness

Runs the real OpenObserve frontend against a real (open-source) backend and fakes every
AI endpoint with Playwright, so every assistant surface can be tested end to end without
o2-ai, an LLM or an enterprise backend. It is the CI baseline for the assistant: every PR
runs `SMOKE-01` (the legacy path with the `assistant_v2` flag off) and its own flows here.

The design folder's `capture.mjs` and `gap1-multitab.mjs` import these modules by path, so
`createMockState`, `installMocks`, `nextScenario`, `login` and `forceCloudBuild` keep their
signatures.

## Layout

| File | What it is |
|---|---|
| `mocks.mjs` | Every mock payload: config patch, SSE scenarios (`SCENARIOS`), HTTP refusal scenarios (`HTTP_SCENARIOS`), chats, shares, toolsets, paid-overage status |
| `stream-shim.js` | Browser init script; answers `fetch` for `/ai/chat_stream`, `/ai/confirm/*` and `/ai/chats/*/cancel` with a real, incrementally delivered SSE `ReadableStream` |
| `setup.mjs` | `ENV`, `createMockState()`, `installMocks(context, state)`, `nextScenario(page, name)`, `login(page)` and the helpers below |
| `modes.mjs` | `ASSISTANT_E2E_MODE`, the mode tags and the checks that skip a flow outside its declared modes |
| `a11y.mjs` | axe with the shared-component allow-list, live-region recording and captures (used by `../a11y.spec.js`) |
| `../stack/run.mjs` | the stack runner: runs the flows tagged for the current mode |
| `../stack/replay-proxy/` | the replay LLM proxy o2-ai uses in `stack-ee` (see its README) |
| `out/` | captures, axe reports, telemetry exports and server switches of a run (git-ignored; the nightly uploads it) |
| `../*.spec.js` | The assistant flows; every flow uses `tests/ui-testing/pages/assistantPage.js` |
| `../fixme.spec.js` | One `test.fixme` per state the harness cannot reach yet, naming the capability it waits for |

Specs load the harness with `await import("./harness/setup.mjs")`: Playwright compiles a
static `import` in a `.spec.js` to `require()`, which would evaluate the `.mjs` modules as
CommonJS and fail. Node ≥ 22.12 (CI uses 24).

## Run locally

The suite needs a running OpenObserve server (any debug build) because only AI routes are
mocked. Credentials come from the same variables as every `tests/ui-testing` suite.

```bash
# 1. Start a server (repo root). Use the credentials you keep in tests/ui-testing/.env.
ZO_ROOT_USER_EMAIL=$ZO_ROOT_USER_EMAIL ZO_ROOT_USER_PASSWORD=$ZO_ROOT_USER_PASSWORD \
  ZO_LOCAL_MODE=true ZO_DATA_DIR=./data-assistant cargo run

# 2a. Use the UI the binary embeds (what CI does).
cd web && npm run test:assistant          # reads ZO_BASE_URL from tests/ui-testing/.env

# 2b. Or the Vite dev server, needed by @edition flows (forceOssBuild / forceCloudBuild).
cd web && npm ci && npx vite --base /web/ --port 8093 --strictPort &
cd tests/ui-testing && O2_VITE_DEV=1 O2_APP_URL=http://localhost:8093/web \
  O2_BACKEND=http://localhost:5080 npx playwright test playwright-tests/assistant
```

`re2js` is declared in `web/package.json`, so `npm ci` installs it and the dev server boots
without the wrapper config the design folder used.

## Environment

| Var | Meaning |
|---|---|
| `ZO_BASE_URL` | Same-origin UI (`/web`) and API, as in CI. Wins unless `O2_VITE_DEV` is set; no backend rewrite |
| `ZO_ROOT_USER_EMAIL`, `ZO_ROOT_USER_PASSWORD` | Login (fallback `O2_USER`, `O2_PASS`); there are no built-in credentials |
| `ORGNAME` | Org (fallback `O2_ORG`, then `default`) |
| `O2_VITE_DEV` | Set when the app is served by the Vite dev server; enables the edition rewrite |
| `O2_APP_URL` | Where Vite serves the app (default `http://localhost:8093/web`) |
| `O2_API_ORIGIN` | API origin baked into the bundle (default `http://localhost:5080`); every request to it is routed |
| `O2_BACKEND` | If set, non-mocked API calls are re-sent here and CORS headers normalised |

## Modes and tags

`ASSISTANT_E2E_MODE` picks the server a run talks to: `mock` (the default) fakes every AI
endpoint, and `stack-ee`, `stack-ee-noagent`, `stack-oss` and `stack-cloud` run the same
specs against a real server. Every flow declares where it runs with Playwright tags:

| Tag | Runs in |
|---|---|
| `@mock` | mock mode, on every PR |
| `@stack-ee` | an enterprise build with OpenFGA, o2-ai and the replay proxy (nightly, persistence on and off) |
| `@stack-ee-noagent` | an enterprise build with no agent configured (nightly) |
| `@stack-oss` | an OSS build (nightly) |
| `@stack-cloud` | the scripted Cloud run by a person with access |
| `@responsive` | declared for 768 and 375 too; the a11y matrix runs these sizes, the runner does not fan out |

`installMocks` and `login` skip a flow whose tags do not name the current mode, and a
flow with no mode tag runs in mock mode only. In a stack mode nothing is faked except the
telemetry sink. `nextScenario`, `setKnobs`, `expireSession`, a `createMockState` override,
reading or writing any key of the mock state, `send(text, scenario)` and an edition
rewrite of another edition each skip the flow and name the mock it needed. Stack flows
send a `[replay:<scenario>]` tag in the prompt, which only the replay proxy reads, and
assert structure only: states, `data-test` ids, network calls and telemetry, never model
prose. Stack runs pass `--retries=0`, so a flow that passes only on a retry shows as a
failure. `ASSISTANT_E2E_GREP` is case-sensitive, so `STACK-` selects flow ids and never the
`@stack-*` tags. `STACK-02` signs in as the seeded viewer from `ASSISTANT_E2E_VIEWER_EMAIL` and
`ASSISTANT_E2E_MEMBER_PASSWORD` and skips without them.

```bash
cd tests/ui-testing
ASSISTANT_E2E_MODE=stack-ee node playwright-tests/assistant/stack/run.mjs            # every @stack-ee flow
ASSISTANT_E2E_MODE=stack-ee ASSISTANT_E2E_GREP=SMOKE node playwright-tests/assistant/stack/run.mjs
```

The nightly workflows are `.github/workflows/assistant-stack-nightly.yml` here
(`stack-oss`) and in o2-enterprise (`stack-ee` with persistence off and on, and
`stack-ee-noagent`). Scheduled runs keep to the flows that are structural today
(`STACK-|SMOKE-`, plus the OSS gate flows on `stack-oss`); a manual dispatch with an empty
`grep` runs every tagged flow.

## Scenario selection

The next `chat_stream` call picks, in order: `window.__o2mock.next` (one-shot, set with
`nextScenario(page, name, { speed })`), `window.__o2mock.sticky`, natural-language query
calls (caller stack contains `useNLQuery`) → `window.__o2mock.nlScenario` or `nl_sql`, a
`[scenario]` tag in the prompt (`"why? [error]"`), prompts mentioning `promql` / `vrl`, then
`complete`. `window.__o2mock.speed` divides every delay; `window.__o2mock.requests` and
`window.__o2mock.confirmations` record what the UI sent.

## Scenarios

Present today (`mocks.mjs`):

| Name | Kind | What it streams or answers |
|---|---|---|
| `complete` | SSE | status → title → StreamList, StreamSchema, SearchSQL calls and results → ~60 Markdown deltas → usage → complete |
| `slow` | SSE | `complete` at 450 ms per frame |
| `hang_tool` | SSE | a SearchSQL `tool_call`, then held open |
| `error` | SSE | failed `tool_result` → `error` (`llm_overload`) |
| `confirmation` | SSE | `confirmation_required` (`o2_delete`) → waits for `/ai/confirm` → result → complete |
| `navigation` | SSE | `navigation_action` (logs, `load_query`) → waits → complete |
| `nl_sql` | SSE | a fenced SQL block for the NL bar |
| `nl_needs_chat` | SSE | prose with no query and no question: the inline helper's "needs the assistant" line |
| `rca_stream` | SSE | the incident analysis route's `start`, ten `chunk` frames at 350 ms, `complete`; answered for `/alerts/incidents/{id}/rca?stream=true` (`window.__o2mock.rcaScenario` overrides it) |
| `rca_dropped` | SSE | two `chunk` frames and no terminal frame: the stream drops while the run finishes on the server |
| `nl_sql_e2e` | SSE | the `nl_sql` proposal over `e2e_automate`, so Accept keeps the Logs stream selection |
| `rca_in_progress`, `rca_priority_off`, `rca_not_enabled` | HTTP 400 | the incident route's own refusals, set through `window.__o2mock.rcaScenario` |
| `promql`, `vrl` | SSE | short answers with a PromQL / VRL block |
| `consent` | HTTP 412 | `paid_overage_consent_required` with a `consent` status |
| `credits_exhausted`, `subscription_required` | HTTP 402 | credit refusals |
| `turn_limit` | HTTP 429 | `error_code: "turn_limit"` |
| `drop_mid_stream` | SSE | 3 deltas, then EOF without `complete`; with `tailEnabled` the tail resumes with the rest and `complete` |
| `drop_before_first_byte` | SSE | a 200 whose body closes before any frame |
| `keepalive_stall` | SSE | one SearchSQL `tool_call`, then `: keepalive` comments for 35 s, held open |
| `tool_interrupted_by_error` | SSE | a SearchSQL `tool_call` cut by an `error` (`llm_overload`) |
| `persistence_failed` | SSE | an answer, `complete{persisted:false}`, then the `persistence_failed` error frame |
| `empty_turn` | SSE | `complete` with no text, step or card |
| `owner_race_no_code` | SSE | the M2 frame: `category: "session_owner_unavailable"`, no `code` |
| `cancelled_frame` | SSE | a partial answer, then `cancelled` this tab did not cause |
| `long_answer` | SSE | 400 deltas with three tables and two code blocks |
| `stale_epoch` | SSE | the M1 `stale_epoch` frame |
| `oversized_frame` | SSE | one `data:` line over 1 MiB |
| `garbage_body` | SSE | a non-JSON line and an unknown frame type, then a normal answer |
| `offline` | HTTP | the request rejects (`TypeError: Failed to fetch`) |
| `unauthorized_401`, `forbidden_403`, `not_enabled_400`, `lease_409`, `already_submitted_409`, `upstream_429`, `agent_503`, `authz_503` | HTTP | today's wire body of each shape; the B-01 envelope instead with `envelopeEnabled` |
| `consent_twice` | HTTP 412 | the 412 again on the same-turn retry after Enable |
| `payloads_markdown` | SSE | one answer carrying the `99` §1.2 Markdown payloads (image beacon, `javascript:`/`data:` links, raw HTML, same-origin logout/share/autorun links) (WP-06) |
| `long_answer_fenced` | SSE | a 400-delta unlabelled fence, then a 400-delta ```` ```sql ```` fence (PERF-02 variant, WP-06) |
| `retrying_frame`, `compacting_frame` | SSE | a B-02 `retrying{attempt:2, reason, retry_after:20}` or `compacting` frame, then held open (WP-06) |
| `permission_denied_frame` | SSE | `o2_UpdateAlert` refused by policy (`step{state:"failed"}` + `permission_denied`), then the answer goes on (WP-06) |
| `cite` | SSE | the `complete` turn whose answer cites `call_3` and `call_1` with `[^call_id]` markers |
| `navigation_card` | SSE | a Logs `navigation_action`, then `complete` with no confirmation wait |
| `nav_path_override`, `nav_org_override` | SSE | a dashboard navigation whose `target.path` and label point at logout, an alert navigation naming another org |
| `assistant_stage_link` | SSE | an answer link to `/web/assistant/{id}` with `assistant`/`object`/`ref` keys |
| `findings_valid`, `findings_invalid` | SSE | a `findings` frame, and one missing `likely_cause` and `confidence` |
| `findings_inconclusive` | SSE | a `findings` frame with `confidence:"inconclusive"` |
| `multi_window` | SSE | two SearchSQL steps over different windows |

Named by the specs and added by the WP that first needs them (`99` §5, honest-turns §0.4):
`data_level_frame`,
`confirm_500`, `update_card`, `cli_card`,
`permission_card`, `resource_changed_unreviewed`,
`nl_parse_error`, `delimiter_breakout`,
`cloud_401_mid_stream`, `payloads/*`; fixture `chat_300`. The wire shapes they replay are
the golden fixtures in `web/src/composables/assistant/__fixtures__/`.

### Adding a scenario

`SCENARIOS` and `HTTP_SCENARIOS` are append-only named maps (`00` §17.1): add a new name,
never change an existing scenario's frames (another PR's flow asserts on them). Build SSE
frames from the `f.*` builders or copy a fixture from `__fixtures__/frames/`; an HTTP
refusal is `{ status, body }` copied from `__fixtures__/errors/wire/`. Select it with
`nextScenario(page, "<name>")` or a `[<name>]` tag in the prompt, and list it in the table
above in the same PR.

## Knobs (`createMockState(overrides)`)

Working today: `historyStatus` (500 → history unavailable), `sharesStatus`,
`sharedChatStatus` (404 → not available), `overage`, `configPatch`, `chats`, `shares`, `log`
(every AI request seen), `persistence`, `publicLinks`, `aiEnabled` (config patches),
`expireNext` (set by `expireSession`), `role` (`admin` | `editor` | `viewer` | `user` |
`custom`: anything but `admin` rewrites the login response's role and turns `rbac_enabled` on,
and the access probe `POST …/ai/chats/{id}/cancel` answers 403 for `viewer`, 404 otherwise),
`probeStatus` (overrides that answer, e.g. 403 for a custom role) and `probeDelayMs` (a delay
past the probe's 5 s timeout leaves `canChat` unknown), `capabilitiesEnabled` (B-06 `GET …/ai/capabilities` and `POST …/capabilities/test`; 404 while
off) and `capabilities` (fields merged over the role-derived answer), `historySearchEnabled`
(B-12: `GET …/ai/chats` filters by `q` and the capabilities answer advertises `history_search`),
`historyPinsEnabled` (B-12: rows carry `pinned`, `PATCH …/ai/chats/{sid}` stores it, advertised as
`history_pins`) and `listMarkersEnabled` (B-03: rows carry `active_turn`, `active_turn_id` and
`pending_approval` from the chat's `running` and `pending_approval`).

Read by the stream shim in the page (set at `installMocks`, changed later with
`setKnobs(page, knobs)`): `envelopeEnabled` (B-01 bodies for the HTTP scenarios that carry an
`envelope`), `lifecycleFramesEnabled` (B-02 `turn_started` first and a `step` before each
`tool_call`), `tailEnabled` (B-03: `id:` lines on every frame and the tail route
`GET …/ai/chats/{sid}/turns/{tid}/stream?from_seq=`, 404 while off), `cancelDelayMs` and
`cancelStatus` (the `POST …/cancel` answer, also on the Node-side XHR route;
`window.__o2mock.cancels` records each cancel).

Toolsets, grants, activity and credits: `toolsets` (rows behind `GET …/ai/toolsets`, default
`TOOLSET_RECORDS`), `toolsetsStatus`, `toolsetsDelayMs`, `toolsetWrites` (every POST/PUT/PATCH/DELETE
as `{ method, id, body }`), `toolsetHealthEnabled` (B-15 fields from `TOOLSET_HEALTH` and the
`…/test` route, 404 while off), `toolsetTestResults`, `secretMergeEnabled` (the capabilities
answer's `toolset_secret_merge`), `grantsEnabled` / `grants` (B-16, 404 while off; a revoke logs
`REVOKE grant {id}`), `activityEnabled` / `activity` (B-17, 404 while off; undo marks the row undone),
`usage` / `usageStatus` (`GET …/ai/usage`) and `overageStatus` (`GET …/paid_overage`).

Declared with a no-op default, filled in by the WP that owns the behaviour:
`decisionFramesEnabled`, `policyEnforced`, `ephemeralEnabled`, `consentPutStatus`,
`settingsEnabled`, `settings`, `importEnabled`, `orgs`.

## Helpers (`setup.mjs`)

| Helper | Does |
|---|---|
| `setFlag(context, on)` | `window.__O2_ASSISTANT_V2__ = on` on every page (init script), so a spec runs either path |
| `forceCloudBuild(context)`, `forceOssBuild(context)` | Rewrite the served `/web/src/aws-exports.ts`; it exists only on the Vite dev server, so they skip unless `O2_VITE_DEV` is set. Flows that use them carry `@edition` in their title and run in the `assistant_editions` CI job (`legacy-smoke.spec.js` holds the first two: OSS locks the header button, Cloud opens the sidebar) |
| `setOnline(page, online)` | `context.setOffline(!online)` |
| `setKnobs(page, knobs)` | Changes the browser-side knobs above on a loaded page |
| `expireSession(state)` | The next AI request answers 401 once |
| `twoTabs(context)` | Two pages in one context (shared storage, shared mocks) |
| `captureTelemetry(page)` | The events `trackAssistant` copied into `window.__o2telemetry` (`installMocks` enables the sink) |
| `readAnnouncements(page)` | Text of every `role="status"` region |

## Useful selectors (legacy UI, flag off)

Header toggle `[data-test=menu-link-ai-item]` (also reused by the alert dialog, pipeline
query node, functions toolbar and JSON editor); regex drawer
`[data-test=add-regex-pattern-open-close-ai-btn]`; chat root `.chat-container`; composer
`.chat-container [contenteditable=true]`; logs NL toggle
`[data-test=logs-search-bar-ai-toggle-btn]`, NL input
`[data-test=logs-search-bar-ai-input-field-field]`; row add-to-context
`[data-test=logs-search-result-ai-btn]`; Home tab `[data-test=home-tab-ai]`.

Known limits: the NL-bar stack check depends on unminified module names (Vite dev server
only); `GET /ai/chats/{sid}` replays the scenario frames regardless of what was typed.

A re-analysis (`reanalysis=true`) is answered `202 {"message":"Analysis started"}` as the server does today; knob `rcaReanalysisStreams` streams it instead, as a server that streams re-analysis would. `configPatch.rca_enabled` puts the `rca_enabled` flag in `/config`.
