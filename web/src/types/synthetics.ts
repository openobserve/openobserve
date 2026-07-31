// Copyright 2026 OpenObserve Inc.

export type SelectorType = "CSS" | "XPath" | "Text" | "TestID" | "Role";

// ── Replay state machine ──────────────────────────────────────────────────────
export type ReplayPhase = "idle" | "running" | "passed" | "failed" | "stopped";

/** Machine-readable error from the extension's replay pipeline. */
export interface StructuredError {
  message: string;
  name?: string; // "TimeoutError" | "TargetClosedError" | "Error"
  stack?: string;
  actionName?: string;
  selector?: string;
}

/** Per-step outcome pushed by the extension via stepReplayResult. */
/**
 * What the player reported about one replayed step.
 *
 * `fidelity` carries the X-8.2 divergence notes: the preview cannot reproduce every
 * probe behaviour (ordered candidate fallback, navigation and response settle, some
 * assertion kinds, an author-set timeout below 60 s, uploads, retired actions), and
 * the requirement is that it SAYS so per step rather than diverging in silence. The
 * extension emits these; the web layer used to drop them here, so every one of those
 * divergences was invisible and a skipped step could read as a pass.
 */
export interface StepReplayResult {
  stepId: string;
  stepName: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  structuredError?: StructuredError;
  fidelity?: { level: string; notes: string[] };
}

export type StepAction =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "press"
  // `check` / `uncheck` / `upload` are version-2 additions. The recorder used to
  // collapse a checkbox interaction to a plain click, which made the replayed
  // journey depend on the box's starting state — a page that renders it
  // pre-ticked silently inverted the journey (spec X-9.3).
  | "check"
  | "uncheck"
  | "upload"
  | "hover"
  | "scroll"
  | "wait"
  | "assert"
  | "screenshot";

// ── Version-2 locator bundle ────────────────────────────────────────────────
// A v1 step identifies its element with a single selector, so any cosmetic
// markup change breaks the monitor. A v2 step carries every way the recorder
// could find the element, ordered most-stable-first, and the runner falls back
// through them.
//
// Ordering matters and is not cosmetic: candidates only agree while the markup
// is unchanged. Once it changes — the case fallback exists for — a lower-ranked
// candidate may match a *different* element, so rank is what breaks ties.

/** Ordered most stable to least. `css`/`xpath` are structural and brittle. */
export type LocatorKind = "test_attribute" | "role" | "text" | "css" | "xpath";

export interface LocatorCandidate {
  kind: LocatorKind;
  value: string;
}

export interface StepLocator {
  /**
   * Machine-derived evidence from the recording session. Read-only in the UI:
   * author intent is expressed only by pinning, which keeps the stored list
   * byte-comparable for the self-healing precondition.
   */
  candidates: LocatorCandidate[];
  /** Author-pinned. When set, used exclusively — never falls back. */
  user_override?: LocatorCandidate | null;
}

// ── Version-2 settle block ──────────────────────────────────────────────────
// What the page demonstrably did after a step, observed while recording and
// waited for again at run time. This is what replaces hard sleeps: a sleep is
// simultaneously too short when the application is slow and pure waste when it
// is fast, whereas a settle signal is neither.
//
// Every signal is advisory unless an author marks it required. A recorded signal
// is evidence from one session, not a contract — an endpoint that gets renamed
// must annotate the step, not turn a healthy journey red.

export interface SettleNavigation {
  /** Glob over the URL with the query string stripped, e.g. `**\/web/**`. */
  url_pattern: string;
}

export interface SettleResponse {
  url_pattern: string;
  method?: string;
  /**
   * Author-set only. The recorder always emits `false`: deciding that a run is
   * meaningless without a given call is a judgement about the application, not
   * something a recording can observe.
   */
  required?: boolean;
}

export interface StepSettle {
  navigation?: SettleNavigation;
  responses?: SettleResponse[];
  /** How long settling took while recording. Reporting only — never a timeout. */
  observed_duration_ms?: number;
  /** How long this step may spend settling. Absent means the runner's 30s. */
  budget_ms?: number;
}

// ── Version-2 assertions ────────────────────────────────────────────────────
// A journey that only clicks can click its way through a broken application and
// still pass. An assertion is what turns a sequence of interactions into a
// statement about an outcome.

export type AssertionKind =
  | "element_visible"
  | "element_not_visible"
  | "element_text"
  | "url_matches"
  | "page_title"
  | "element_attribute";

export interface StepAssertion {
  kind: AssertionKind;
  /** Required for every kind except the two visibility ones. */
  expected?: string;
  /** Required for `element_attribute`. */
  attribute?: string;
}

export interface BrowserStep {
  id: string;
  action: StepAction;
  name?: string;
  selector?: string;
  selectorType?: SelectorType;
  /** Version-2 locator bundle. Absent on v1 steps, which use `selector`. */
  locator?: StepLocator;
  /** Version-2 settle block: what to wait for after this step's action. */
  settle?: StepSettle;
  /** Version-2 typed assertion. Required on `assert`, forbidden elsewhere. */
  assertion?: StepAssertion;
  /** Failure skips the step and the run continues (cookie banners, popups). */
  optional?: boolean;
  /** Runs even after an earlier step failed (logout, cleanup). */
  alwaysRun?: boolean;
  value?: string;
  timeout?: number; // ms; undefined = runner's per-category default
  code: string;
  // Original, untouched extension step (see WireStep). Preserved for replay,
  // which sends the rich step back to the extension verbatim. Absent on
  // manually-added steps.
  wire?: WireStep;
}

// ── OpenObserve Extension (playwright-crx) recorder protocol ────────────────
// Wire contract shared with the extension. Keep in sync with
// ../playwright-crx/.docs/synthetics-recorder.md → "Web-side integration".

export type RecorderMode = "recording" | "inspecting" | "asserting" | "playing";

/**
 * Step shape as emitted by the extension (Playwright-flavoured). Mapped to the
 * UI-facing {@link BrowserStep} via `@/utils/synthetics/mapRecordedStep`.
 */
export interface WireStep {
  id: string;
  action: string; // navigate | click | type | press | select | check | uncheck | setInputFiles | waitFor | assert | screenshot
  selector?: string;
  selector_type?: "css" | "xpath" | "text" | "role" | "data-test";
  /**
   * Version-2 evidence captured by the extension. Present on recorded steps
   * only; a hand-added step has none until it is re-recorded.
   */
  locator?: StepLocator;
  settle?: StepSettle;
  assertion?: StepAssertion;
  optional?: boolean;
  always_run?: boolean;
  name?: string;
  timeout_ms?: number;
  url?: string;
  value?: string;
  key?: string;
  options?: string[];
  text?: string;
  checked?: boolean;
  snapshot?: string;
  files?: string[];
  modifiers?: number;
  button?: "left" | "middle" | "right";
  position?: { x: number; y: number };
  code?: string;
  startTime?: number;
  endTime?: number;
  pageAlias?: string;
  framePath?: string[];
  description?: string;
}

/** Commands the web app sends to the extension via `chrome.runtime.sendMessage`. */
export type RecorderCommand =
  | { action: "getStatus" }
  | { action: "startRecording"; mode?: RecorderMode; testIdAttr?: string; targetUrl: string }
  | { action: "stopRecording" }
  | { action: "setMode"; mode: RecorderMode }
  | {
      action: "replay";
      steps: WireStep[];
      targetUrl?: string;
      auth?: { type: "basic"; username: string; password: string };
      headers?: { key: string; value: string }[];
      cookies?: { name: string; value: string; domain: string }[];
    }
  | { action: "stopReplay" };

export interface RecorderCommandEnvelope {
  type: "synthetics-command";
  command: RecorderCommand;
}

// Real `getStatus` payload from the extension (see
// ../playwright-crx/examples/synthetics-recorder/src/background.ts). There is no
// `installed` field — reachability is inferred from getting any reply back.
export interface RecorderStatus {
  isRecording: boolean;
  mode: string;
  tabId: number | null;
  stepCount: number;
}

export interface RecorderStartResponse {
  success: boolean;
  tabId?: number;
  error?: string;
}

export interface RecorderStopResponse {
  success: boolean;
  error?: string;
}

// Single overall result of a `replay` command (no per-step data). `passed` is
// false when a step fails (`error` carries that step's message) or when the run
// was cancelled via `stopReplay` (`stopped: true`).
export interface ReplayResponse {
  success: boolean;
  passed: boolean;
  stopped?: boolean;
  error?: string;
}

// ── Live data pushed over the port ──────────────────────────────────────────
// Mirrors the extension's `ExtensionToO2Message` / `ExtensionToO2Payload`
// (examples/synthetics-recorder/src/messaging.ts). The discriminant for data
// pushes is `payload.method`, NOT the top-level `type`. We model only the fields
// the web app consumes; `sources`/`elementInfo` are opaque here.
export type RecorderPushPayload =
  | { method: "setMode"; mode: RecorderMode }
  | { method: "setActions"; browserSteps: WireStep[]; sources?: unknown[] }
  | {
      method: "setSources";
      sources?: unknown[];
      generatedCode?: string;
      generatedLanguage?: string;
    }
  | { method: "elementPicked"; elementInfo: unknown; userGesture?: boolean }
  | { method: "recordingStarted"; tabId: number; url: string }
  | { method: "recordingStopped"; totalSteps: number }
  | {
      method: "stepReplayResult";
      stepId: string;
      stepName?: string;
      passed: boolean;
      duration_ms: number;
      error?: string;
      structuredError?: StructuredError;
      /** X-8.2 divergence notes, as the extension emits them. Declared here as
       *  well as on `StepReplayResult` because this is the INBOUND shape the
       *  composable reads from; without it, reading `payload.fidelity` does not
       *  type-check, and dropping the read instead would make every divergence
       *  silent again — a skipped step reading as a pass. */
      fidelity?: { level: string; notes: string[] };
    }
  | { method: "stepReplayStarted"; stepId: string; stepName?: string };

/** Live data push: `{ type:'synthetics-recorder', recordingId, payload }`. */
export interface RecorderPortMessage {
  type: "synthetics-recorder";
  recordingId: string;
  payload: RecorderPushPayload;
}

/** Anything the extension can post over the port (data push + command acks). */
export type RecorderPortInbound =
  | RecorderPortMessage
  | { type: "synthetics-response"; response: unknown };

// ---- Bridge transport types (content-script relay, replaces chrome.runtime.*) ----

export type BridgeStatusMessage = { type: "bridge-disconnected" };

/**
 * Check types creatable from the UI. Only types both the control plane and the
 * probes run end-to-end today — dns/ping/api exist server-side but have no
 * probe support yet, so they are deliberately absent.
 */
export type SyntheticCheckType = "browser" | "http" | "tcp" | "tls" | "ssh";

export const SYNTHETIC_CHECK_TYPES: SyntheticCheckType[] = ["browser", "http", "tcp", "tls", "ssh"];

/** Non-browser check types — configured on the shared configure page, no journey step. */
export type ProtocolCheckType = Exclude<SyntheticCheckType, "browser">;

// ── Per-type protocol configs (UI models; wire shapes live in buildPayload) ──

export interface HttpAssertion {
  field: string;
  operator: string;
  value: string;
}

export interface HttpCheckConfig {
  method: string;
  headers: { name: string; value: string }[];
  body: string;
  follow_redirects: boolean;
  timeout_ms: number;
  assertions: HttpAssertion[];
}

export interface TcpCheckConfig {
  port: number | null;
  timeout_ms: number;
  response_contains: string;
}

export interface TlsCheckConfig {
  port: number;
  timeout_ms: number;
  min_days_until_expiry: number;
  verify_chain: boolean;
  verify_hostname: boolean;
}

export interface SshCheckConfig {
  port: number;
  username: string;
  authType: "password" | "private_key";
  secret: string;
  timeout_ms: number;
}

/**
 * Protocol check model — the shared BrowserCheck fields (details, schedule,
 * alerts, locations…) plus exactly one per-type config, discriminated by
 * `checkType`. `journey`/`rum`/`capture` stay empty/unused for these types.
 */
export interface ProtocolCheck extends BrowserCheck {
  checkType: ProtocolCheckType;
  http?: HttpCheckConfig;
  tcp?: TcpCheckConfig;
  tls?: TlsCheckConfig;
  ssh?: SshCheckConfig;
}

export interface BrowserCheckFrequency {
  type: "minutes" | "hours" | "seconds" | "days" | "weeks" | "months" | "cron";
  interval?: number; // value in the unit specified by type
  cron?: string; // always present; empty string for interval types
  timezone?: string;
  start_time?: number; // unix epoch ms; only when scheduled later
}

export interface BrowserCheckSchedule {
  type: "interval" | "cron";
  intervalValue?: number;
  intervalUnit?: "minutes" | "hours" | "days" | "weeks" | "months";
  cron?: string;
  timezone?: string;
  startType?: "now" | "later";
  startDate?: string;
  startTime?: string;
  isCustomFrequency?: boolean; // true when user explicitly chose "Custom" frequency
}

// Synthetics folder (from GET /api/v2/{org}/folders/synthetics)
export interface SyntheticsFolder {
  folderId: string;
  name: string;
  description?: string;
}

// Available probe location returned by GET /api/{org}/synthetics/locations
export interface SyntheticsLocation {
  id: string;
  /** Display label — user/agent-chosen (private) or o2's friendly name (public). */
  label: string;
  region: string;
  provider: string;
  /** "public" (o2-operated) | "private" (customer agent) — absent in old payloads. */
  kind?: "public" | "private";
  enabled?: boolean;
  /** Check types runnable at this location (live agents' capabilities). */
  types?: string[];
  status?: "online" | "offline" | "pending";
  /** Live agents' names, most recently seen first (private rows). */
  agent_names?: string[];
  live_agents?: number;
  /** Most recent agent last_seen_at (epoch µs). */
  last_seen_at?: number;
}

/** Shape returned by GET /api/{org}/synthetics/agent-setup — ingredients the
 *  setup drawer composes per-platform install commands from. */
export interface AgentSetup {
  token?: string;
  org: string;
  o2_url: string;
  script_url: string;
  /** Legacy docker one-liner (drawer fallback when composing is impossible). */
  install: string;
}

// Full location record for admin/settings panel (GET /api/{org}/synthetics/locations)
export interface SyntheticsLocationRecord {
  id: string;
  label: string;
  region: string;
  provider: string;
  enabled: boolean;
  kind: string;
  pool: string;
}

export interface SyntheticsDevice {
  id: string;
  label: string;
  width: number;
  height: number;
}

// Shape returned by GET /api/{org}/synthetics/locations (repurposed as capabilities)
export interface SyntheticsCapabilities {
  locations: SyntheticsLocation[];
  browsers: string[];
  devices: SyntheticsDevice[];
}

export interface BrowserCheck {
  id?: string;
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
  folder?: string;
  tags: string[];
  journey: BrowserStep[];
  schedule: BrowserCheckSchedule;
  locations: string[];
  tz_offset?: number;
  start?: number; // microseconds, top-level — matches reports pattern
  browserDevices?: { browser: string; device: string }[];
  // Alert / retry settings (top-level in API payload)
  retries?: number;
  waitBeforeRetrySecs?: number;
  alertIfFails?: number;
  cooldownMins?: number;
  notifications: {
    destinations: string[];
  };
  rum: { collect: boolean; sessionReplay: boolean };
  capture: {
    screenshot: "always" | "on-fail" | "off";
    trace: "always" | "on-fail" | "off";
  };
  auth?: {
    type: "basic";
    username: string;
    password: string;
  };
  variables?: { id?: string; name: string; value: string; secure?: boolean; example?: string }[];
  secrets?: { id?: string; name: string; value: string }[];
  headers?: { id?: string; key: string; value: string }[];
  cookies?: { id?: string; name: string; value: string; domain: string }[];
}

// ── Private locations (GET /{org}/synthetics/locations + /{id}) ──────────────

/** One row of the locations API — registry fields + computed live stats. */
export interface SyntheticLocation {
  id: string;
  /** Display label — user/agent-chosen (private) or o2's friendly name (public). */
  label: string;
  region: string;
  provider: string;
  kind: "public" | "private";
  pool: string;
  enabled: boolean;
  types: string[];
  live_agents: number;
  /** Live agents' names, most recently seen first. */
  agent_names: string[];
  agents_total: number;
  status: "online" | "offline" | "pending";
  version?: string;
  /** Name of the most recently seen agent, live or stale. */
  last_agent_name?: string;
  last_seen_at?: number;
  monitors_count: number;
  checks_per_min: number;
}

/** A self-registered agent shown on the location detail page (read-only). */
export interface SyntheticLocationAgent {
  id: string;
  name: string;
  version?: string;
  capabilities?: { types?: string[]; icmp?: boolean; max_concurrency?: number };
  last_seen_at: number;
  created_at: number;
  live: boolean;
}

/** One synthetic assigned to a location, in the detail page's checks table. */
export interface SyntheticLocationCheck {
  id: string;
  name: string;
  type: string;
  interval_secs: number;
  enabled: boolean;
  last_check_status: string;
}

/** GET /{org}/synthetics/locations/{id} — flattened location + agents/checks. */
export interface SyntheticLocationDetail extends SyntheticLocation {
  agents: SyntheticLocationAgent[];
  checks: SyntheticLocationCheck[];
  install?: string;
}
