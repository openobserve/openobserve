// Copyright 2026 OpenObserve Inc.

export type SelectorType = 'CSS' | 'XPath' | 'Text' | 'TestID' | 'Role'

// ── Replay state machine ──────────────────────────────────────────────────────
export type ReplayPhase = 'idle' | 'running' | 'passed' | 'failed' | 'stopped'

/** Machine-readable error from the extension's replay pipeline. */
export interface StructuredError {
  message: string
  name?: string        // "TimeoutError" | "TargetClosedError" | "Error"
  stack?: string
  actionName?: string
  selector?: string
}

/** Per-step outcome pushed by the extension via stepReplayResult. */
export interface StepReplayResult {
  stepId: string
  stepName: string
  passed: boolean
  durationMs: number
  error?: string
  structuredError?: StructuredError
}

export type StepAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'assert'
  | 'screenshot'

export interface BrowserStep {
  id: string
  action: StepAction
  name?: string
  selector?: string
  selectorType?: SelectorType
  value?: string
  timeout?: number // ms, default 30000
  code: string
  // Original, untouched extension step (see WireStep). Preserved for replay,
  // which sends the rich step back to the extension verbatim. Absent on
  // manually-added steps.
  wire?: WireStep
}

// ── OpenObserve Extension (playwright-crx) recorder protocol ────────────────
// Wire contract shared with the extension. Keep in sync with
// ../playwright-crx/.docs/synthetics-recorder.md → "Web-side integration".

export type RecorderMode = 'recording' | 'inspecting' | 'asserting' | 'playing'

/**
 * Step shape as emitted by the extension (Playwright-flavoured). Mapped to the
 * UI-facing {@link BrowserStep} via `@/utils/synthetics/mapRecordedStep`.
 */
export interface WireStep {
  id: string
  action: string // navigate | click | type | press | select | setInputFiles | waitFor | assert | screenshot
  selector?: string
  selector_type?: 'css' | 'xpath' | 'text' | 'role' | 'data-test'
  name?: string
  timeout_ms?: number
  url?: string
  value?: string
  key?: string
  options?: string[]
  text?: string
  checked?: boolean
  snapshot?: string
  files?: string[]
  modifiers?: number
  button?: 'left' | 'middle' | 'right'
  position?: { x: number; y: number }
  code?: string
  startTime?: number
  endTime?: number
  pageAlias?: string
  framePath?: string[]
  description?: string
}

/** Commands the web app sends to the extension via `chrome.runtime.sendMessage`. */
export type RecorderCommand =
  | { action: 'getStatus' }
  | { action: 'startRecording'; mode?: RecorderMode; testIdAttr?: string, targetUrl: string }
  | { action: 'stopRecording' }
  | { action: 'setMode'; mode: RecorderMode }
  | { action: 'replay'; steps: WireStep[]; targetUrl?: string; auth?: { type: 'basic'; username: string; password: string }; headers?: { key: string; value: string }[]; cookies?: { name: string; value: string; domain: string }[] }
  | { action: 'stopReplay' }

export interface RecorderCommandEnvelope {
  type: 'synthetics-command'
  command: RecorderCommand
}

// Real `getStatus` payload from the extension (see
// ../playwright-crx/examples/synthetics-recorder/src/background.ts). There is no
// `installed` field — reachability is inferred from getting any reply back.
export interface RecorderStatus {
  isRecording: boolean
  mode: string
  tabId: number | null
  stepCount: number
}

export interface RecorderStartResponse {
  success: boolean
  tabId?: number
  error?: string
}

export interface RecorderStopResponse {
  success: boolean
  error?: string
}

// Single overall result of a `replay` command (no per-step data). `passed` is
// false when a step fails (`error` carries that step's message) or when the run
// was cancelled via `stopReplay` (`stopped: true`).
export interface ReplayResponse {
  success: boolean
  passed: boolean
  stopped?: boolean
  error?: string
}

// ── Live data pushed over the port ──────────────────────────────────────────
// Mirrors the extension's `ExtensionToO2Message` / `ExtensionToO2Payload`
// (examples/synthetics-recorder/src/messaging.ts). The discriminant for data
// pushes is `payload.method`, NOT the top-level `type`. We model only the fields
// the web app consumes; `sources`/`elementInfo` are opaque here.
export type RecorderPushPayload =
  | { method: 'setMode'; mode: RecorderMode }
  | { method: 'setActions'; browserSteps: WireStep[]; sources?: unknown[] }
  | { method: 'setSources'; sources?: unknown[]; generatedCode?: string; generatedLanguage?: string }
  | { method: 'elementPicked'; elementInfo: unknown; userGesture?: boolean }
  | { method: 'recordingStarted'; tabId: number; url: string }
  | { method: 'recordingStopped'; totalSteps: number }
  | { method: 'stepReplayResult'; stepId: string; stepName?: string; passed: boolean; duration_ms: number; error?: string; structuredError?: StructuredError }
  | { method: 'stepReplayStarted'; stepId: string; stepName?: string }

/** Live data push: `{ type:'synthetics-recorder', recordingId, payload }`. */
export interface RecorderPortMessage {
  type: 'synthetics-recorder'
  recordingId: string
  payload: RecorderPushPayload
}

/** Anything the extension can post over the port (data push + command acks). */
export type RecorderPortInbound =
  | RecorderPortMessage
  | { type: 'synthetics-response'; response: unknown }

// ---- Bridge transport types (content-script relay, replaces chrome.runtime.*) ----

export type BridgeStatusMessage =
  | { type: 'bridge-disconnected' }

/**
 * Check types creatable from the UI. Only types both the control plane and the
 * probes run end-to-end today — dns/ping/api exist server-side but have no
 * probe support yet, so they are deliberately absent.
 */
export type SyntheticCheckType = 'browser' | 'http' | 'tcp' | 'tls' | 'ssh'

export const SYNTHETIC_CHECK_TYPES: SyntheticCheckType[] = ['browser', 'http', 'tcp', 'tls', 'ssh']

/** Non-browser check types — configured on the shared configure page, no journey step. */
export type ProtocolCheckType = Exclude<SyntheticCheckType, 'browser'>

// ── Per-type protocol configs (UI models; wire shapes live in buildPayload) ──

export interface HttpAssertion {
  field: string
  operator: string
  value: string
}

export interface HttpCheckConfig {
  method: string
  headers: { name: string; value: string }[]
  body: string
  follow_redirects: boolean
  timeout_ms: number
  assertions: HttpAssertion[]
}

export interface TcpCheckConfig {
  port: number | null
  timeout_ms: number
  response_contains: string
}

export interface TlsCheckConfig {
  port: number
  timeout_ms: number
  min_days_until_expiry: number
  verify_chain: boolean
  verify_hostname: boolean
}

export interface SshCheckConfig {
  port: number
  username: string
  authType: 'password' | 'private_key'
  secret: string
  timeout_ms: number
}

/**
 * Protocol check model — the shared BrowserCheck fields (details, schedule,
 * alerts, locations…) plus exactly one per-type config, discriminated by
 * `checkType`. `journey`/`rum`/`capture` stay empty/unused for these types.
 */
export interface ProtocolCheck extends BrowserCheck {
  checkType: ProtocolCheckType
  http?: HttpCheckConfig
  tcp?: TcpCheckConfig
  tls?: TlsCheckConfig
  ssh?: SshCheckConfig
}

export interface BrowserCheckFrequency {
  type: 'minutes' | 'hours' | 'seconds' | 'days' | 'weeks' | 'months' | 'cron'
  interval?: number      // value in the unit specified by type
  cron?: string          // always present; empty string for interval types
  timezone?: string
  start_time?: number    // unix epoch ms; only when scheduled later
}

export interface BrowserCheckSchedule {
  type: 'interval' | 'cron'
  intervalValue?: number
  intervalUnit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months'
  cron?: string
  timezone?: string
  startType?: 'now' | 'later'
  startDate?: string
  startTime?: string
  isCustomFrequency?: boolean // true when user explicitly chose "Custom" frequency
}

// Synthetics folder (from GET /api/v2/{org}/folders/synthetics)
export interface SyntheticsFolder {
  folderId: string
  name: string
  description?: string
}

// Available probe location returned by GET /api/{org}/synthetics/locations
export interface SyntheticsLocation {
  id: string
  name: string
  region: string
  provider: string
  /** "public" (o2-operated) | "private" (customer agent) — absent in old payloads. */
  kind?: 'public' | 'private'
  enabled?: boolean
  /** Check types runnable at this location (live agents' capabilities). */
  types?: string[]
  status?: 'online' | 'offline' | 'pending'
  /** Live agents' names, most recently seen first (private rows). */
  agent_names?: string[]
  live_agents?: number
  /** Most recent agent last_seen_at (epoch µs). */
  last_seen_at?: number
}

/** Shape returned by GET /api/{org}/synthetics/agent-setup — ingredients the
 *  setup drawer composes per-platform install commands from. */
export interface AgentSetup {
  token?: string
  org: string
  o2_url: string
  script_url: string
  /** Legacy docker one-liner (drawer fallback when composing is impossible). */
  install: string
}

export interface SyntheticsDevice {
  id: string
  label: string
  width: number
  height: number
}

// Shape returned by GET /api/{org}/synthetics/locations (repurposed as capabilities)
export interface SyntheticsCapabilities {
  locations: SyntheticsLocation[]
  browsers: string[]
  devices: SyntheticsDevice[]
}

export interface BrowserCheck {
  id?: string
  name: string
  url: string
  description?: string
  enabled: boolean
  folder?: string
  tags: string[]
  journey: BrowserStep[]
  schedule: BrowserCheckSchedule
  locations: string[]
  tz_offset?: number
  start?: number // microseconds, top-level — matches reports pattern
  browserDevices?: { browser: string; device: string }[]
  // Alert / retry settings (top-level in API payload)
  retries?: number
  waitBeforeRetrySecs?: number
  alertIfFails?: number
  cooldownMins?: number
  notifications: {
    destinations: string[]
  }
  rum: { collect: boolean; sessionReplay: boolean }
  capture: {
    screenshot: 'always' | 'on-fail' | 'off'
    trace: 'always' | 'on-fail' | 'off'
  }
  auth?: {
    type: 'basic'
    username: string
    password: string
  }
  variables?: { id?: string; name: string; value: string; secure?: boolean; example?: string }[]
  secrets?: { id?: string; name: string; value: string }[]
  headers?: { id?: string; key: string; value: string }[]
  cookies?: { id?: string; name: string; value: string; domain: string }[]
}

// ── Private locations (GET /{org}/synthetics/locations + /{id}) ──────────────

/** One row of the locations API — registry fields + computed live stats. */
export interface SyntheticLocation {
  id: string
  name: string
  region: string
  provider: string
  kind: 'public' | 'private'
  pool: string
  enabled: boolean
  types: string[]
  live_agents: number
  /** Live agents' names, most recently seen first. */
  agent_names: string[]
  agents_total: number
  status: 'online' | 'offline' | 'pending'
  version?: string
  last_seen_at?: number
  monitors_count: number
  checks_per_min: number
}

/** A self-registered agent shown on the location detail page (read-only). */
export interface SyntheticLocationAgent {
  id: string
  name: string
  version?: string
  capabilities?: { types?: string[]; icmp?: boolean; max_concurrency?: number }
  last_seen_at: number
  created_at: number
  live: boolean
}

/** One synthetic assigned to a location, in the detail page's checks table. */
export interface SyntheticLocationCheck {
  id: string
  name: string
  type: string
  interval_secs: number
  enabled: boolean
  last_check_status: string
}

/** GET /{org}/synthetics/locations/{id} — flattened location + agents/checks. */
export interface SyntheticLocationDetail extends SyntheticLocation {
  agents: SyntheticLocationAgent[]
  checks: SyntheticLocationCheck[]
  install?: string
}
