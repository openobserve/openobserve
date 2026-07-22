// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type {
  BrowserCheck,
  BrowserCheckSchedule,
  HttpCheckConfig,
  TcpCheckConfig,
  TlsCheckConfig,
  SshCheckConfig,
  ProtocolCheck,
  SyntheticsLocation,
} from "@/types/synthetics";

// ── Monitor list fixtures ───────────────────────────────────────────────────

export const mockSchedule: BrowserCheckSchedule = {
  type: "interval",
  intervalValue: 5,
  intervalUnit: "minutes",
};

export const mockMonitorHttp: BrowserCheck = {
  id: "mon-http-1",
  name: "HTTP Health Check",
  url: "https://example.com/health",
  description: "Main endpoint health monitoring",
  enabled: true,
  folder: "folder-1",
  tags: ["production", "critical"],
  journey: [],
  schedule: mockSchedule,
  locations: ["us-east-1", "eu-west-1"],
  browserDevices: [{ browser: "chromium", device: "laptop_large" }],
  retries: 2,
  waitBeforeRetrySecs: 10,
  alertIfFails: 3,
  cooldownMins: 5,
  notifications: { destinations: ["dest-1"] },
  rum: { collect: false, sessionReplay: false },
  capture: { screenshot: "off", trace: "off" },
};

export const mockMonitorTcp: BrowserCheck = {
  id: "mon-tcp-1",
  name: "TCP Port Check",
  url: "tcp://db.internal:5432",
  description: "Database port availability",
  enabled: true,
  tags: ["database"],
  journey: [],
  schedule: { type: "interval", intervalValue: 1, intervalUnit: "minutes" },
  locations: ["us-east-1"],
  browserDevices: [],
  retries: 1,
  waitBeforeRetrySecs: 5,
  alertIfFails: 2,
  cooldownMins: 10,
  notifications: { destinations: [] },
  rum: { collect: false, sessionReplay: false },
  capture: { screenshot: "off", trace: "off" },
};

export const mockMonitorBrowser: BrowserCheck = {
  id: "mon-browser-1",
  name: "Browser Login Flow",
  url: "https://app.example.com/login",
  description: "End-to-end login flow check",
  enabled: true,
  folder: "folder-1",
  tags: ["critical", "e2e"],
  journey: [
    {
      id: "step-1",
      action: "navigate",
      value: "https://app.example.com/login",
      code: "await page.goto('...')",
    },
    {
      id: "step-2",
      action: "type",
      selector: "#username",
      value: "testuser",
      code: "await page.fill('#username', '...')",
    },
  ],
  schedule: { type: "interval", intervalValue: 15, intervalUnit: "minutes" },
  locations: ["us-east-1", "eu-west-1", "ap-southeast-1"],
  browserDevices: [
    { browser: "chromium", device: "laptop_large" },
    { browser: "firefox", device: "laptop_large" },
  ],
  retries: 0,
  waitBeforeRetrySecs: 0,
  alertIfFails: 1,
  cooldownMins: 5,
  notifications: { destinations: ["dest-2", "dest-3"] },
  rum: { collect: true, sessionReplay: true },
  capture: { screenshot: "on-fail", trace: "on-fail" },
};

export const mockMonitorDisabled: BrowserCheck = {
  ...mockMonitorHttp,
  id: "mon-disabled-1",
  name: "Disabled Check",
  enabled: false,
};

export const mockMonitorList: BrowserCheck[] = [
  mockMonitorHttp,
  mockMonitorTcp,
  mockMonitorBrowser,
  mockMonitorDisabled,
];

// ── Protocol check fixtures ─────────────────────────────────────────────────

export const mockHttpConfig: HttpCheckConfig = {
  method: "GET",
  headers: [{ name: "Authorization", value: "Bearer ****" }],
  body: "",
  follow_redirects: true,
  timeout_ms: 30000,
  assertions: [
    { field: "status_code", operator: "equals", value: "200" },
    { field: "response_time", operator: "less_than", value: "5000" },
  ],
};

export const mockTcpConfig: TcpCheckConfig = {
  port: 5432,
  timeout_ms: 10000,
  response_contains: "ready",
};

export const mockTlsConfig: TlsCheckConfig = {
  port: 443,
  timeout_ms: 10000,
  min_days_until_expiry: 30,
  verify_chain: true,
  verify_hostname: true,
};

export const mockSshConfig: SshCheckConfig = {
  port: 22,
  username: "deploy",
  authType: "private_key",
  secret: "****",
  timeout_ms: 15000,
};

export const mockProtocolCheckHttp: ProtocolCheck = {
  ...mockMonitorHttp,
  id: "proto-http-1",
  checkType: "http",
  http: mockHttpConfig,
};

export const mockProtocolCheckTcp: ProtocolCheck = {
  ...mockMonitorTcp,
  id: "proto-tcp-1",
  checkType: "tcp",
  tcp: mockTcpConfig,
};

// ── Run fixtures ────────────────────────────────────────────────────────────

export const mockRunPassed = {
  runId: "run-001",
  syntheticsId: "mon-http-1",
  timestamp: 1_700_000_000_000_000,
  status: "passed" as const,
  durationMs: 1240,
  location: "us-east-1",
  device: "laptop_large",
  browserEngine: "chromium",
  triggerType: "schedule" as const,
  error: "",
  jobId: "job-001",
  executionId: "exec-001",
  attempts: 1,
  failedStep: null,
  recordedSteps: [],
  lastAttemptSteps: [],
  retryHistory: [],
  network: null,
  webVitals: null,
  traceKey: null,
};

export const mockRunFailed = {
  runId: "run-002",
  syntheticsId: "mon-http-1",
  timestamp: 1_700_000_000_000_000,
  status: "failed" as const,
  durationMs: 29340,
  location: "eu-west-1",
  device: "laptop_large",
  browserEngine: "chromium",
  triggerType: "schedule" as const,
  error: "TimeoutError: page.waitForSelector timed out after 30000ms",
  jobId: "job-001",
  executionId: "exec-002",
  attempts: 2,
  failedStep: "step-2",
  recordedSteps: [
    { id: "step-1", action: "navigate", name: "Go to page", passed: true, durationMs: 1200 },
    {
      id: "step-2",
      action: "click",
      name: "Click submit",
      passed: false,
      durationMs: 28140,
      error: "Timeout",
    },
  ],
  lastAttemptSteps: [
    { id: "step-1", action: "navigate", name: "Go to page", passed: true, durationMs: 1100 },
  ],
  retryHistory: [{ attempt: 1, status: "failed", durationMs: 29340, error: "TimeoutError" }],
  network: null,
  webVitals: null,
  traceKey: "synthetics/org-1/mon-http-1/2026/03/run-002/trace.json",
};

export const mockRunList = [mockRunPassed, mockRunFailed];

export const mockRunDetail = {
  ...mockRunPassed,
  monitorName: "Test Monitor",
  scheduledTs: 1_700_000_000_000_000,
};

// ── Location fixtures ───────────────────────────────────────────────────────

export const mockLocations: SyntheticsLocation[] = [
  { id: "us-east-1", name: "US East (N. Virginia)", region: "us-east-1", provider: "aws" },
  { id: "eu-west-1", name: "EU (Ireland)", region: "eu-west-1", provider: "aws" },
  {
    id: "ap-southeast-1",
    name: "Asia Pacific (Singapore)",
    region: "ap-southeast-1",
    provider: "aws",
  },
];

// ── Capabilities / device fixtures ──────────────────────────────────────────

export const mockCapabilities = {
  locations: mockLocations,
  browsers: ["chromium", "firefox", "webkit"],
  devices: [
    { id: "laptop_large", label: "Laptop Large", width: 1440, height: 900 },
    { id: "laptop_small", label: "Laptop Small", width: 1280, height: 800 },
    { id: "tablet", label: "Tablet", width: 768, height: 1024 },
    { id: "mobile", label: "Mobile", width: 375, height: 667 },
  ],
};

// ── Timeline segment fixtures ───────────────────────────────────────────────

export const mockTimelineSegment = {
  runId: "run-001",
  status: "passed" as const,
  color: "var(--color-badge-success-solid-bg)",
  title: "Passed",
  timestampMs: 1_700_000_000_000,
  executions: [
    {
      location: "us-east-1",
      browserEngine: "chromium",
      device: "laptop_large",
      status: "passed",
      errorSnippet: "",
    },
  ],
};

export const mockTimelineSegments = [
  mockTimelineSegment,
  {
    runId: "run-002",
    status: "failed" as const,
    color: "var(--color-badge-error-solid-bg)",
    title: "Failed",
    timestampMs: 1_700_003_600_000,
    executions: [
      {
        location: "eu-west-1",
        browserEngine: "chromium",
        device: "laptop_large",
        status: "failed",
        errorSnippet: "TimeoutError",
      },
    ],
  },
];

// ── KPI fixtures (for MonitorRuns) ────────────────

export const mockKpiData = {
  uptimePct: 99.65,
  p95Ms: 2940,
  failedRuns: 1,
  totalRuns: 288,
  lastRunStatus: "passed" as "passed" | "warning" | "failed" | "error" | null,
  lastRunAt: Date.now() - 120_000,
};

export const mockBuckets = [
  { tsMs: 1_700_000_000_000, avgMs: 1500, p95Ms: 2000, uptimePct: 100, failedRuns: 0 },
  { tsMs: 1_700_003_600_000, avgMs: 1600, p95Ms: 2100, uptimePct: 99, failedRuns: 1 },
];
