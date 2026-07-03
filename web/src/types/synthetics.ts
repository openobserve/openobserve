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
