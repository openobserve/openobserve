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

export type Scenario = "demo" | "allClear" | "incident" | "cantSee" | "noBaseline";
export type Period = "week" | "month";
export type DayKey =
  | "today"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "sep12"
  | "sep23"
  | "sep24"
  | "sep30"
  | "oct1"
  | "oct2";
export type Severity = "p1" | "p2" | "p3" | "p4";
export type Outcome = "active" | "fixed" | "resolved" | "held" | "predicted";
export type StepBy = "event" | "me" | "team";
export type StepVariant = "primary" | "success" | "destructive" | "info" | "muted";
export type ServiceKind = "http" | "worker" | "database" | "cache" | "queue";
export type ServiceState = "watching" | "learning" | "cantSee";
export type CantSeeReason = "noLink" | "stopped";
export type FixKind =
  "revertConfig" | "pool" | "abortRollout" | "queueWorker" | "retune" | "rollback";
export type Autonomy = "tell" | "ask" | "fix";
export type RequestKind = "retune" | "fixNow" | "fromNowOn";
export type GapKind = "paymentsDb" | "unscanned" | "stalled";
export type HistoryKind = "problems" | "changes" | "fixes" | "decisions";
export type LedgerLoop = "coverage" | "calibration" | "investigation" | "action";
export type LedgerState =
  "auto_applied" | "kept" | "awaiting" | "approved" | "rejected" | "rolled_back";

export interface Destination {
  id: string;
  kind: "slack" | "email";
  name: string;
}

export type SignalKind = "metric" | "log" | "trace";

// after names the detector this one followed from (default: the one before it); via labels that link.
export interface Firing {
  detector: string;
  service: string;
  count: number;
  times: string[];
  signal: SignalKind;
  name: string;
  peak: string;
  threshold?: string;
  charted?: boolean;
  after?: string;
  via?: string;
}

export interface Step {
  at: string;
  by: StepBy;
  title: string;
  detail: string;
  variant: StepVariant;
  service?: string;
}

// A link in the chain that no detector fired for: a service I can't see, or harm still to come.
export interface ChainNote {
  id: string;
  kind: "unwatched" | "forecast";
  service: string;
  at: string;
  title: string;
  detail: string;
  after?: string;
  via?: string;
}

// card names the How it unfolded card this row is about; a charted row defaults to the charted firing.
export interface Evidence {
  kind: "log" | "trace" | "metric";
  title: string;
  detail: string;
  count?: string;
  chart?: boolean;
  card?: string;
}

export type HypothesisVerdict = "confirmed" | "ruled_out" | "open";

export interface Hypothesis {
  name: string;
  verdict: HypothesisVerdict;
  reason: string;
}

export interface ComparisonRow {
  label: string;
  value: number;
  shown: string;
  kind: "affected" | "healthy" | "limit";
}

export interface Comparison {
  metric: string;
  rows: ComparisonRow[];
}

export interface ChartFact {
  metric: string;
  unit: string;
  points: number[];
  detectedAt: number;
  actionAt?: number;
  // The last points are a forecast, not measurements.
  forecast?: number;
  limit?: number;
  peak: number;
  // Measured after a fix the viewer approves on the page, so it only shows once that fix is done.
  recovery?: number[];
}

export interface Deploy {
  service: string;
  version: string;
  at: string;
  pods: number;
}

export interface FixFact {
  kind: FixKind;
  at: string;
  ledgerId: string;
  worked: boolean;
}

export interface ProblemFact {
  id: string;
  incidentId: string;
  title: string;
  service: string;
  services: string[];
  upstream: string[];
  downstream: string[];
  severity: Severity;
  day: DayKey;
  time: string;
  seconds: string;
  outcome: Outcome;
  resolvedAt?: string;
  resolvedIn?: number;
  destination: string;
  pagedAt?: string;
  askedAt?: string;
  notifiedAt?: string;
  firings: Firing[];
  steps: Step[];
  chainNotes?: ChainNote[];
  chart: ChartFact;
  cause: string;
  summary: string;
  likelyCause: string;
  confidence: number;
  nextStep: string;
  verdict: string;
  impact: string[];
  hypotheses: Hypothesis[];
  comparison?: Comparison;
  evidence: Evidence[];
  deploy?: Deploy;
  fix?: FixFact;
  proposalLedgerId?: string;
  alsoInvolved?: string[];
  // An approved fix that stops the harm without explaining it contains the problem rather than fixing it.
  containOnly?: boolean;
}

export interface ServiceFact {
  name: string;
  kind: ServiceKind;
  state: ServiceState;
  readyInDays?: number;
  foundToday?: boolean;
  reason?: CantSeeReason;
  stream: string;
}

export interface StreamFact {
  name: string;
  scannedMinutesAgo: number | null;
  stale?: boolean;
  services: number;
}

export interface GapFact {
  kind: GapKind;
  focus?: string;
  count?: number;
}

export interface RequestFact {
  kind: RequestKind;
  ledgerId: string;
  problem?: string;
  autonomyKind?: FixKind;
  fixKind?: FixKind;
}

export interface LedgerFact {
  id: string;
  loop: LedgerLoop;
  actionClass: string;
  target: string;
  state: LedgerState;
  confidence: number;
  evidence: string;
  before: string;
  after: string;
  day: DayKey;
  time?: string;
  reviewWindow?: string;
  note?: string;
  userBuilt?: boolean;
  history: { kind: HistoryKind; key: string; worked?: boolean }[];
  in: Scenario[];
}

export interface EventFact {
  id: string;
  day: DayKey;
  time?: string;
  kind: HistoryKind;
  key: string;
  count?: number;
  in: Scenario[];
}

export interface AutonomyFact {
  kind: FixKind;
  actionClass: string;
  done: number;
  worked: number;
  mode: Autonomy;
  recurringBug?: string;
}

export interface PeriodFact {
  problems: string[];
  oldAlertPages: number | null;
}

export interface ScenarioFact {
  services: ServiceFact[];
  streams: StreamFact[];
  periods: Record<Period, PeriodFact>;
  weekFirings: number;
  requests: RequestFact[];
  gaps: GapFact[];
  connectedDaysAgo?: number;
  foundToday?: string[];
}

export type ConfidenceBand = "high" | "medium" | "low";

export const SCENARIOS: Scenario[] = ["demo", "allClear", "incident", "cantSee", "noBaseline"];

export const DEMO_DATE: [number, number, number] = [2026, 9, 11];

export const DAY_DATE: Record<DayKey, string> = {
  today: "2026-10-11",
  monday: "2026-10-05",
  tuesday: "2026-10-06",
  wednesday: "2026-10-07",
  thursday: "2026-10-08",
  friday: "2026-10-09",
  sep12: "2026-09-12",
  sep23: "2026-09-23",
  sep24: "2026-09-24",
  sep30: "2026-09-30",
  oct1: "2026-10-01",
  oct2: "2026-10-02",
};

export const LAST_CHECKED_MINUTES = 2;
export const DEMO_NOW = "10:52";
export const LEARNING_WINDOW_DAYS = 7;
export const DIGEST_DESTINATION = "email-oncall";

export const DESTINATIONS: Destination[] = [
  { id: "slack-oncall-payments", kind: "slack", name: "#oncall-payments" },
  { id: "slack-oncall-search", kind: "slack", name: "#oncall-search" },
  { id: "slack-platform-alerts", kind: "slack", name: "#platform-alerts" },
  { id: DIGEST_DESTINATION, kind: "email", name: "oncall@yourcompany.com" },
];

export const AUTONOMY: AutonomyFact[] = [
  { kind: "revertConfig", actionClass: "RevertConfigChange", done: 3, worked: 3, mode: "ask" },
  {
    kind: "pool",
    actionClass: "EvictLeakedConnections",
    done: 3,
    worked: 3,
    mode: "ask",
    recurringBug: "CHK-482",
  },
  { kind: "abortRollout", actionClass: "AbortRollout", done: 6, worked: 6, mode: "ask" },
  { kind: "queueWorker", actionClass: "ScaleQueueWorkers", done: 8, worked: 7, mode: "fix" },
  { kind: "retune", actionClass: "RaiseThreshold", done: 6, worked: 6, mode: "ask" },
  { kind: "rollback", actionClass: "RollbackDeploy", done: 0, worked: 0, mode: "tell" },
];

export const DEFAULT_AUTONOMY: Autonomy = "ask";

export const RETUNE = { alert: "disk 80%", host: "ingest-3", fired: 41, from: 80, to: 90 };
// Services that showed up this morning; like every new service they are watched at once and start learning.
export const NEW_SERVICES = {
  stream: "orders_logs",
  names: ["returns", "exchanges", "gift-cards"],
};
export const FOUND_TODAY_CANT_SEE = [
  "archive-worker",
  "batch-exporter",
  "legacy-crm",
  "partner-sync",
  "pdf-renderer",
  "sms-gateway",
];
export const STALLED = { cluster: "prod-eu", since: "09:40" };
export const UNSCANNED_STREAM = "billing_archive";

const PAYMENTS = "slack-oncall-payments";
const SEARCH = "slack-oncall-search";
const PLATFORM = "slack-platform-alerts";

// Every CHK-482 leak has the same shape: payments time out at 50 of 50 connections and recover 2 minutes after the fix.
const LEAK_CHART: ChartFact = {
  metric: "timed-out payments",
  unit: "%",
  points: [
    0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0.2, 6.2, 10.4, 11.1, 10.8, 3.9, 0.4, 0, 0.1, 0, 0, 0, 0, 0.1, 0,
    0, 0,
  ],
  detectedAt: 10,
  actionAt: 13,
  peak: 11.1,
};

// The two earlier CHK-482 leaks share the Wednesday incident's shape; only the times and counts differ.
const earlierLeak = (
  id: string,
  incidentId: string,
  day: DayKey,
  [start, asked, fixed, resolved, filed]: [string, string, string, string, string?],
  { leaked, ledgerId, first }: { leaked: number; ledgerId: string; first: boolean },
): ProblemFact => ({
  id,
  incidentId,
  title: "Checkout connection pool exhausted by leaked connections: payments timing out",
  service: "checkout",
  services: ["checkout"],
  upstream: ["api-gateway"],
  downstream: ["payments-api"],
  severity: "p2",
  day,
  time: start,
  seconds: "12",
  outcome: "fixed",
  resolvedAt: resolved,
  resolvedIn: 5,
  destination: PAYMENTS,
  askedAt: asked,
  firings: [
    {
      detector: "checkout-pool-saturation",
      service: "checkout",
      count: 3,
      times: [start, asked, fixed],
      signal: "metric",
      name: "Pool in use",
      peak: "50 of 50, 0 idle",
      threshold: "limit 50",
    },
    {
      detector: "checkout-log-patterns",
      service: "checkout",
      count: 1,
      times: [start],
      signal: "log",
      name: "Connection leak logs",
      peak: `${leaked} held > 10 min`,
      threshold: "none before",
      via: "same pool",
    },
    {
      detector: "checkout-errors",
      service: "checkout",
      count: 2,
      times: [asked, fixed],
      signal: "metric",
      name: "Timed-out payments",
      peak: "11% of payments",
      threshold: "baseline 0%",
      charted: true,
      via: "pool empty",
    },
  ],
  steps: [
    {
      at: start,
      by: "event",
      title: "Detector fired",
      detail: "checkout-pool-saturation: 50 of 50 connections",
      variant: "destructive",
    },
    {
      at: asked,
      by: "me",
      title: first ? "Leak detected, fix proposed" : "Known leak (CHK-482), fix proposed",
      detail: "EvictLeakedConnections asked in #oncall-payments",
      variant: "primary",
    },
    {
      at: fixed,
      by: "team",
      title: "Approved",
      detail: "One-time approval from the Slack message",
      variant: "info",
    },
    {
      at: fixed,
      by: "me",
      title: "Fix applied",
      detail: `EvictLeakedConnections on checkout (${leaked} connections)`,
      variant: "primary",
    },
    {
      at: resolved,
      by: "event",
      title: "Resolved",
      detail: "Payments back to normal",
      variant: "success",
    },
    ...(first && filed
      ? [
          {
            at: filed,
            by: "me" as const,
            title: "Bug filed",
            detail:
              "CHK-482 filed with the checkout team: connections leaked by RefundExporter.export()",
            variant: "muted" as const,
          },
        ]
      : []),
  ],
  chart: LEAK_CHART,
  cause:
    "Refund exports check out database connections and never return them, so checkout ran out of free connections.",
  summary:
    "About 1 in 9 payments timed out for 5 minutes while checkout had no free database connections.",
  likelyCause: first
    ? `Pool 50 of 50, 0 idle. ${leaked} connections were held over 10 min with no query running; leak detection traces all of them to RefundExporter.export(). A new leak, so after the fix I filed it with the checkout team as CHK-482.`
    : `Pool 50 of 50, 0 idle. ${leaked} connections held over 10 min with no query running, all from RefundExporter.export(). Same signature as 23 Sep: known bug CHK-482, second time in 8 days.`,
  confidence: 90,
  nextStep: "Fixed for now by evicting the leaked connections. Root cause CHK-482.",
  verdict:
    "Refund exports leak database connections (CHK-482) until checkout has none left for payments.",
  impact: ["1 in 9 payments timed out"],
  hypotheses: [
    {
      name: "Leaked connections (CHK-482)",
      verdict: "confirmed",
      reason: `${leaked} of 50 held over 10 minutes with no query running, all from RefundExporter.export().`,
    },
    {
      name: "Pool too small for traffic",
      verdict: "ruled_out",
      reason: `Only ${50 - leaked} connections were doing real work; the rest were leaked.`,
    },
    {
      name: "payments-api slow",
      verdict: "ruled_out",
      reason: "Payments time out waiting for a free connection, before any call to payments-api.",
    },
  ],
  comparison: {
    metric: "checkout's 50 database connections",
    rows: [
      {
        label: "Leaked by RefundExporter.export()",
        value: leaked,
        shown: String(leaked),
        kind: "affected",
      },
      {
        label: "Left for payments",
        value: 50 - leaked,
        shown: String(50 - leaked),
        kind: "healthy",
      },
      { label: "Pool limit", value: 50, shown: "50", kind: "limit" },
    ],
  },
  evidence: [
    {
      kind: "metric",
      title: "Metric deviation on checkout",
      detail: "pool connections in use: 50 of 50, 0 idle",
      card: "checkout-pool-saturation",
    },
    {
      kind: "metric",
      title: "Payment timeouts on checkout",
      detail: "about 1 in 9 payments (11%) at worst, 0 after the fix",
      chart: true,
    },
    {
      kind: "log",
      title: "Connection leak detection",
      detail: `${leaked} held > 10 min, acquired at RefundExporter.export()`,
      card: "checkout-log-patterns",
    },
  ],
  fix: { kind: "pool", at: fixed, ledgerId, worked: true },
});

export const PROBLEMS: Record<string, ProblemFact> = {
  search: {
    id: "search",
    incidentId: "INC-1051",
    title: "Search p95 at 3.4 s: search-2 out of memory after a cache setting change",
    service: "search",
    services: ["search"],
    upstream: ["api-gateway"],
    downstream: ["search-indexer"],
    severity: "p2",
    day: "today",
    time: "10:27",
    seconds: "20",
    outcome: "active",
    destination: SEARCH,
    pagedAt: "10:29",
    firings: [
      {
        detector: "search-latency",
        service: "search",
        count: 7,
        times: ["10:27", "10:28", "10:29", "10:30"],
        signal: "metric",
        name: "p95 latency",
        peak: "3.4 s",
        threshold: "baseline 0.38 s",
        charted: true,
      },
      {
        detector: "search-jvm-memory",
        service: "search",
        count: 6,
        times: ["10:20", "10:23", "10:26"],
        signal: "metric",
        name: "Memory on search-2",
        peak: "99% of 16 GB heap",
        threshold: "other nodes 55–62%",
      },
      {
        detector: "search-log-patterns",
        service: "search",
        count: 4,
        times: ["10:20", "10:24", "10:28", "10:31"],
        signal: "log",
        name: "OutOfMemory logs",
        peak: "1,240 lines, ~10 crashes",
        threshold: "0 on search-1, 3, 4, 5",
        via: "same node",
      },
      {
        detector: "search-slow-spans",
        service: "search",
        count: 3,
        times: ["10:25", "10:27", "10:29"],
        signal: "trace",
        name: "Slow query spans",
        peak: "p95 3,400 ms",
        threshold: "baseline 380 ms",
        via: "queries stall",
      },
    ],
    steps: [
      {
        at: "10:16",
        by: "event",
        title: "Config change",
        detail: "search-2: search.query_cache.size 10% → 60% (search-2 only)",
        variant: "info",
      },
      {
        at: "10:27",
        by: "event",
        title: "Detector fired",
        detail: "search-latency crossed its baseline",
        variant: "destructive",
      },
      {
        at: "10:28",
        by: "me",
        title: "Investigation landed",
        detail: "Cause: 10:16 cache change on search-2, confidence high",
        variant: "primary",
      },
      {
        at: "10:29",
        by: "me",
        title: "Paged with cause",
        detail: "#oncall-search; P2 waits for the cause",
        variant: "destructive",
      },
      {
        at: "10:30",
        by: "me",
        title: "Fix proposed",
        detail: "RevertConfigChange search-2 query cache 60% → 10%, waiting for approval",
        variant: "info",
      },
      {
        at: "10:33",
        by: "team",
        title: "Acknowledged",
        detail: "On-call is reviewing the revert and asking who made the change",
        variant: "muted",
      },
      {
        at: "",
        by: "event",
        title: "Still open",
        detail: "Waiting on the revert decision",
        variant: "muted",
      },
    ],
    chart: {
      metric: "p95 latency",
      unit: "s",
      points: [
        0.37, 0.39, 0.38, 0.36, 0.38, 0.4, 0.37, 0.38, 0.41, 0.52, 1.1, 1.9, 2.6, 3.1, 3.3, 2.9,
        3.4, 3.2, 3.0, 3.4, 3.3, 3.1, 3.4, 3.2, 3.3, 3.4,
      ],
      detectedAt: 13,
      peak: 3.4,
      recovery: [2.2, 0.7, 0.4, 0.38],
    },
    cause:
      "A 10:16 change raised search-2's query cache to 60% of heap. The heap fills within minutes of each restart, the node stalls in GC, then exits on OutOfMemoryError.",
    summary:
      "Since 10:27 about 1 in 5 searches take longer than 3 s (p95 3.4 s, baseline 0.38 s). search-2 has crashed about 10 times since 10:20. search-1, 3, 4 and 5 are healthy.",
    likelyCause:
      "search.query_cache.size on search-2 went from 10% to 60% at 10:16 (config audit). It is the only node with the change and the only node out of memory. Each restart empties the cache, it refills in 2–3 minutes, heap hits 99%, GC takes over and queries routed to search-2 stall until the JVM exits. Restarting cannot fix it.",
    confidence: 86,
    nextStep:
      "Approve reverting search-2's query cache to 10%, the value the other 4 nodes run (L-308). Follow-up: confirm why it was changed at 10:16, and route node-level setting changes through review.",
    verdict:
      "search-2 runs out of memory because a 10:16 setting change gave its query cache 60% of the heap.",
    impact: ["1 in 5 searches slower than 3 s", "search-2 crashed about 10 times"],
    hypotheses: [
      {
        name: "Config change on search-2",
        verdict: "confirmed",
        reason:
          "The only node changed (query cache 10% → 60% at 10:16) is the only node out of memory.",
      },
      {
        name: "Traffic spike",
        verdict: "ruled_out",
        reason: "Search traffic stayed flat all morning.",
      },
      {
        name: "Bad deploy",
        verdict: "ruled_out",
        reason: "Nothing was deployed to search in the 6 hours before 10:16.",
      },
      {
        name: "Shared dependency",
        verdict: "ruled_out",
        reason: "search-1, 3, 4 and 5 use the same dependencies and are healthy at 55–62% memory.",
      },
    ],
    comparison: {
      metric: "Heap used, by node",
      rows: [
        { label: "search-2", value: 99, shown: "99%", kind: "affected" },
        { label: "search-1", value: 58, shown: "58%", kind: "healthy" },
        { label: "search-3", value: 55, shown: "55%", kind: "healthy" },
        { label: "search-4", value: 62, shown: "62%", kind: "healthy" },
        { label: "search-5", value: 60, shown: "60%", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "log",
        title: "Log pattern in search",
        detail:
          "java.lang.OutOfMemoryError: Java heap space (search-2 only, about 10 crashes; 0 on search-1,3,4,5)",
        card: "search-log-patterns",
        count: "1,240 since 10:20",
      },
      {
        kind: "log",
        title: "Config audit",
        detail: "search-2 search.query_cache.size 10% → 60% at 10:16",
        card: "change",
      },
      {
        kind: "trace",
        title: "Slow span in search",
        detail: "GET /search → shard.query: p95 3,400 ms (baseline 380 ms)",
        card: "search-slow-spans",
        count: "2,108 traces",
      },
      {
        kind: "metric",
        title: "Metric deviation on search",
        detail: "jvm.memory.used{pod=search-2}: 99% of 16 GB; other nodes 55–62%",
        card: "search-jvm-memory",
      },
      {
        kind: "metric",
        title: "Latency on search",
        detail: "p95 latency: 3.4 s (baseline 0.38 s), high since 10:27",
        chart: true,
      },
    ],
    proposalLedgerId: "L-308",
  },
  ordersDisk: {
    id: "ordersDisk",
    incidentId: "INC-1050",
    title: "orders-db disk full in ~3 d: data volume +18 GB/day since orders 3.8.0 audit logging",
    service: "orders-db",
    services: ["orders-db"],
    upstream: ["checkout", "orders", "refunds"],
    downstream: [],
    severity: "p3",
    day: "today",
    time: "09:40",
    seconds: "08",
    outcome: "predicted",
    destination: PLATFORM,
    notifiedAt: "09:42",
    firings: [
      {
        detector: "orders-db-disk-forecast",
        service: "orders-db",
        count: 5,
        times: ["09:40", "09:55", "10:10", "10:25", "10:40"],
        signal: "metric",
        name: "Disk full forecast",
        peak: "445 of 500 GB, full in ~3 days",
        threshold: "growth was 6 GB/day",
        charted: true,
        via: "40× audit rows",
      },
    ],
    steps: [
      {
        at: "Thu 14:05",
        by: "event",
        title: "Deploy orders 3.8.0",
        detail: "order_audit.level summary → full: every order write is now audited",
        variant: "info",
        service: "orders",
      },
      {
        at: "Thu 14:10",
        by: "event",
        title: "Disk growth tripled",
        detail: "orders-db data volume: about 6 → 18 GB/day",
        variant: "info",
      },
      {
        at: "09:40",
        by: "event",
        title: "Forecast fired",
        detail:
          "orders-db-disk-forecast · Forecast (linear trend on disk used, 14 days): full in about 3 days",
        variant: "destructive",
      },
      {
        at: "09:41",
        by: "me",
        title: "Investigation landed",
        detail: "Cause: orders 3.8.0 audit logging since Thursday, confidence high",
        variant: "primary",
      },
      {
        at: "09:42",
        by: "me",
        title: "Message sent, no page",
        detail: "#platform-alerts; P3 notifies without paging",
        variant: "info",
      },
      {
        at: "",
        by: "event",
        title: "Open",
        detail: "Forecast: full Wednesday around 11:00",
        variant: "muted",
      },
    ],
    chainNotes: (
      [
        ["checkout", "Can't save orders"],
        ["orders", "Order updates fail"],
        ["refunds", "Refunds fail"],
      ] as const
    ).map(([svc, title], i) => ({
      id: `${svc}-writes`,
      kind: "forecast" as const,
      service: svc,
      at: "Wed ~11:00",
      title,
      detail: "orders-db stops accepting writes once its disk is full",
      after: "orders-db-disk-forecast",
      via: i === 0 ? "when full" : undefined,
    })),
    chart: {
      metric: "disk used",
      unit: "GB",
      points: [334, 340, 346, 352, 358, 364, 370, 376, 382, 388, 394, 409, 427, 445, 463, 481, 500],
      detectedAt: 13,
      forecast: 3,
      limit: 500,
      peak: 445,
    },
    cause:
      "orders 3.8.0 turned order-audit logging up on Thursday, so orders-db's disk grows about 18 GB a day instead of 6.",
    summary:
      "orders-db's data disk is at 445 of 500 GB (89%) and grows about 18 GB a day, so the 55 GB left fill around Wednesday 11:00. Nothing is broken yet.",
    likelyCause:
      "orders 3.8.0 went out on Thursday at 14:05 and raised order_audit.level from summary to full. Since then the order_audit table grows about 12 GB a day and the disk about 18 GB a day; before it grew about 6. When the disk fills, orders-db stops accepting writes: checkout can't save orders, and orders and refunds start failing.",
    confidence: 90,
    nextStep:
      "Turn order-audit logging back down, or add disk space before Wednesday. No automatic fix: neither is a change I'm allowed to make.",
    verdict:
      "orders 3.8.0 turned on full audit logging, so orders-db's disk now fills three times faster.",
    impact: ["Disk full in about 3 days", "Nothing broken yet"],
    hypotheses: [
      {
        name: "orders 3.8.0 audit logging",
        verdict: "confirmed",
        reason:
          "order_audit grows about 16 M rows a day since Thursday 14:05 (was 0.4 M): 12 of the 18 GB a day.",
      },
      {
        name: "Gradual order growth",
        verdict: "ruled_out",
        reason: "Growth tripled within 5 minutes of the deploy, not over weeks.",
      },
      {
        name: "Other tables or bloat",
        verdict: "ruled_out",
        reason: "Everything except order_audit still grows about 6 GB a day, as before.",
      },
    ],
    comparison: {
      metric: "Disk growth per day",
      rows: [
        { label: "Since orders 3.8.0", value: 18, shown: "18 GB", kind: "affected" },
        { label: "Before Thursday", value: 6, shown: "6 GB", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Disk used on orders-db",
        detail:
          "data volume: 445 of 500 GB (89%); +6 GB/day until Thursday, +18 GB/day since. Faded bars are the forecast",
        chart: true,
      },
      {
        kind: "log",
        title: "Deploy orders 3.8.0",
        detail: "Thursday 14:05: order_audit.level summary → full",
        card: "change",
      },
      {
        kind: "metric",
        title: "Table growth in orders-db",
        detail: "order_audit: about 16 M rows/day since Thursday 14:05 (was 0.4 M), +12 GB/day",
      },
    ],
  },
  checkoutNow: {
    id: "checkoutNow",
    incidentId: "INC-1052",
    title: "Checkout failing 1 in 6 payments after checkout 2.4.0",
    service: "checkout",
    services: ["checkout", "payments-api"],
    upstream: ["api-gateway"],
    downstream: ["payments-api"],
    severity: "p1",
    day: "today",
    time: "10:43",
    seconds: "05",
    outcome: "active",
    destination: PAYMENTS,
    pagedAt: "10:44",
    firings: [
      {
        detector: "checkout-errors",
        service: "checkout",
        count: 9,
        times: ["10:43", "10:44", "10:45", "10:46"],
        signal: "metric",
        name: "Failed payments",
        peak: "16% of payments",
        threshold: "baseline 0.1%",
        charted: true,
      },
      {
        detector: "checkout-latency",
        service: "checkout",
        count: 5,
        times: ["10:43", "10:44", "10:45", "10:46"],
        signal: "metric",
        name: "p95 latency",
        peak: "1.9 s",
        threshold: "baseline 0.42 s",
        via: "same pods",
      },
      {
        detector: "checkout-error-spans",
        service: "checkout",
        count: 3,
        times: ["10:44", "10:45", "10:46"],
        signal: "trace",
        name: "2.4.0 failed spans",
        peak: "3,204 traces, all on 2.4.0",
        threshold: "0 on the previous version",
        via: "2.4.0 only",
      },
    ],
    steps: [
      {
        at: "10:41",
        by: "event",
        title: "Deploy checkout 2.4.0",
        detail: "Rollout paused at its 50% step (6 of 12 pods)",
        variant: "info",
      },
      {
        at: "10:43",
        by: "event",
        title: "Detector fired",
        detail: "checkout-errors crossed its baseline",
        variant: "destructive",
      },
      {
        at: "10:44",
        by: "me",
        title: "Incident opened, P1 paged",
        detail: "Paged at once; P1 never waits for the investigation",
        variant: "destructive",
      },
      {
        at: "10:44",
        by: "me",
        title: "Fix proposed",
        detail: "AbortRollout checkout 2.4.0, waiting for approval",
        variant: "info",
      },
      {
        at: "",
        by: "event",
        title: "Investigation running",
        detail: "Cause will follow in the same thread",
        variant: "primary",
      },
    ],
    chart: {
      metric: "failed payments",
      unit: "%",
      points: [
        0.1, 0.12, 0.09, 0.1, 0.11, 0.08, 0.1, 0.13, 0.1, 0.09, 0.11, 0.1, 0.12, 0.1, 0.09, 0.1,
        0.11, 2.4, 11.8, 15.6, 16.3, 15.9, 16.8, 15.7, 16.2, 16.5, 15.8, 16.1,
      ],
      detectedAt: 18,
      peak: 16.8,
      recovery: [9.4, 1.2, 0.2, 0.1],
    },
    cause:
      "Not confirmed yet. Failures come only from pods running checkout 2.4.0, deployed at 10:41.",
    summary:
      "Since 10:43 checkout fails about 1 in 6 payments (error ratio 16%, baseline 0.1%). Only the 6 pods running 2.4.0 fail.",
    likelyCause:
      "Not confirmed yet. The failures are confined to the 6 pods running checkout 2.4.0, and the card provider is inside its baseline. payments-db is a coverage gap (no service.name), so it cannot be ruled out from here.",
    confidence: 62,
    nextStep:
      "Stop the 2.4.0 rollout and send traffic back to the 6 pods on the previous version. They run at 40% CPU, so they can take the full load. Then investigate.",
    verdict: "Payments fail only on the pods running checkout 2.4.0, but why is not confirmed yet.",
    impact: ["1 in 6 payments failing"],
    hypotheses: [
      {
        name: "checkout 2.4.0",
        verdict: "open",
        reason:
          "Every failure is on the 6 pods running 2.4.0, deployed 2 minutes before. Why it fails is not confirmed yet.",
      },
      {
        name: "Card provider",
        verdict: "ruled_out",
        reason: "The card provider is inside its baseline.",
      },
      {
        name: "Not enough capacity",
        verdict: "ruled_out",
        reason: "The 6 pods on the previous version are healthy at 40% CPU.",
      },
      {
        name: "payments-db",
        verdict: "open",
        reason: "A coverage gap (no service.name), so it can't be checked from here.",
      },
    ],
    comparison: {
      metric: "Failed payment traces, by version",
      rows: [
        { label: "2.4.0 · 6 pods", value: 3204, shown: "3,204", kind: "affected" },
        { label: "Previous version · 6 pods", value: 0, shown: "0", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on checkout",
        detail: "error ratio: 16% (baseline 0.1%)",
        chart: true,
      },
      {
        kind: "trace",
        title: "Errors by version",
        detail: "checkout 2.4.0: 100% of failed spans; 6 of 12 pods",
        card: "checkout-error-spans",
        count: "3,204 traces",
      },
    ],
    proposalLedgerId: "L-313",
    containOnly: true,
  },
  email: {
    id: "email",
    incidentId: "INC-1049",
    title: "Order confirmation emails up to 9 minutes late",
    service: "email-worker",
    services: ["email-worker"],
    upstream: ["orders"],
    downstream: [],
    severity: "p4",
    day: "thursday",
    time: "03:15",
    seconds: "42",
    outcome: "held",
    resolvedAt: "03:36",
    resolvedIn: 21,
    destination: DIGEST_DESTINATION,
    firings: [
      {
        detector: "email-worker-queue-age",
        service: "email-worker",
        count: 3,
        times: ["03:15", "03:16", "03:17"],
        signal: "metric",
        name: "Email queue age",
        peak: "9 m 12 s",
        threshold: "baseline under 10 s",
        charted: true,
        after: "email-worker-requests",
        via: "no consumers",
      },
      {
        detector: "email-worker-requests",
        service: "email-worker",
        count: 2,
        times: ["03:15", "03:16"],
        signal: "metric",
        name: "Emails sent per minute",
        peak: "0 for about 8 min",
        threshold: "baseline ~140/min",
      },
      {
        detector: "email-worker-log-patterns",
        service: "email-worker",
        count: 1,
        times: ["03:16"],
        signal: "log",
        name: "Consumer rebalance logs",
        peak: "4 of 4 pods restarting",
        threshold: "none before 03:12",
      },
    ],
    steps: [
      {
        at: "03:12",
        by: "event",
        title: "Deploy email-worker",
        detail: "All 4 pods replaced at once",
        variant: "info",
      },
      {
        at: "03:15",
        by: "event",
        title: "Detector fired",
        detail: "email-worker-queue-age crossed its baseline",
        variant: "destructive",
      },
      {
        at: "03:16",
        by: "me",
        title: "Held for the Friday summary",
        detail: "P4: no page",
        variant: "muted",
      },
      {
        at: "03:36",
        by: "event",
        title: "Resolved",
        detail: "Queue caught up by itself",
        variant: "success",
      },
    ],
    chart: {
      metric: "email delay",
      unit: "min",
      points: [
        0.1, 0.1, 0.12, 0.1, 0.1, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.2, 8.8, 8.1, 7.3, 6.5,
        5.6, 4.8, 4.0, 3.2, 2.5, 1.9, 1.3, 0.8, 0.5, 0.3, 0.1, 0.1, 0.12, 0.1, 0.1, 0.1, 0.1, 0.1,
      ],
      detectedAt: 7,
      peak: 9.2,
    },
    cause:
      "At 03:12 all 4 email-worker pods were replaced at once; nothing consumed the queue for about 8 minutes, and it drained by 03:36.",
    summary:
      "Order confirmation emails went out up to 9 minutes late for 21 minutes. No emails were lost.",
    likelyCause:
      "At 03:12 all 4 email-worker pods were replaced at once; nothing consumed the queue for about 8 minutes, and it drained by 03:36.",
    confidence: 83,
    nextStep:
      "No action needed tonight. Summary suggestion: roll email-worker one pod at a time so the queue always has consumers.",
    verdict: "All email workers restarted at once, so nothing sent emails for about 8 minutes.",
    impact: ["Emails up to 9 minutes late", "No emails lost"],
    hypotheses: [
      {
        name: "All pods replaced at once",
        verdict: "confirmed",
        reason:
          "At 03:12 all 4 pods restarted together, and 0 emails went out for about 8 minutes.",
      },
      {
        name: "Emails dropped",
        verdict: "ruled_out",
        reason: "The sent count matched the queued count.",
      },
      {
        name: "More orders than usual",
        verdict: "ruled_out",
        reason:
          "The queue grew because nothing consumed it, and drained by 03:36 once pods were back.",
      },
    ],
    comparison: {
      metric: "Oldest email waiting",
      rows: [
        { label: "During the deploy", value: 552, shown: "9 m 12 s", kind: "affected" },
        { label: "Normal", value: 10, shown: "under 10 s", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on email-worker",
        detail: "email-queue age: 9 m 12 s at worst (baseline under 10 s)",
        chart: true,
      },
      {
        kind: "log",
        title: "Delivery check",
        detail: "sent count matched queued count: no dropped messages",
      },
    ],
  },
  pool: {
    id: "pool",
    incidentId: "INC-1048",
    title: "Checkout connection pool exhausted by leaked connections: payments timing out",
    service: "checkout",
    services: ["checkout"],
    upstream: ["api-gateway"],
    downstream: ["payments-api"],
    severity: "p2",
    day: "wednesday",
    time: "11:18",
    seconds: "31",
    outcome: "fixed",
    resolvedAt: "11:23",
    resolvedIn: 5,
    destination: PAYMENTS,
    askedAt: "11:19",
    firings: [
      {
        detector: "checkout-pool-saturation",
        service: "checkout",
        count: 4,
        times: ["11:18", "11:19", "11:20", "11:21"],
        signal: "metric",
        name: "Pool in use",
        peak: "50 of 50, 0 idle",
        threshold: "limit 50",
      },
      {
        detector: "checkout-latency",
        service: "checkout",
        count: 2,
        times: ["11:19", "11:20"],
        signal: "trace",
        name: "Slow pool waits",
        peak: "waits 30 s",
        threshold: "baseline under 5 ms",
        after: "checkout-log-patterns",
        via: "pool empty",
      },
      {
        detector: "checkout-log-patterns",
        service: "checkout",
        count: 2,
        times: ["11:18", "11:20"],
        signal: "log",
        name: "Connection leak logs",
        peak: "48 held > 10 min",
        threshold: "none before",
        via: "same pool",
      },
      {
        detector: "checkout-errors",
        service: "checkout",
        count: 3,
        times: ["11:19", "11:20", "11:21"],
        signal: "metric",
        name: "Timed-out payments",
        peak: "11% of payments",
        threshold: "baseline 0%",
        charted: true,
        after: "checkout-latency",
        via: "timeouts",
      },
    ],
    steps: [
      {
        at: "11:18",
        by: "event",
        title: "Detector fired",
        detail: "checkout-pool-saturation: 50 of 50 connections",
        variant: "destructive",
      },
      {
        at: "11:19",
        by: "me",
        title: "Known leak (CHK-482), fix proposed",
        detail: "EvictLeakedConnections asked in #oncall-payments",
        variant: "primary",
      },
      {
        at: "11:21",
        by: "team",
        title: "Approved",
        detail: "One-time approval from the Slack message",
        variant: "info",
      },
      {
        at: "11:21",
        by: "me",
        title: "Fix applied",
        detail: "EvictLeakedConnections on checkout (48 connections)",
        variant: "primary",
      },
      {
        at: "11:23",
        by: "event",
        title: "Resolved",
        detail: "Payments back to normal",
        variant: "success",
      },
    ],
    chart: LEAK_CHART,
    cause:
      "Refund exports check out database connections and never return them. At 11:18 checkout had none free.",
    summary:
      "About 1 in 9 payments timed out for 5 minutes while checkout had no free database connections.",
    likelyCause:
      "Pool 50 of 50, 0 idle. 48 connections were held over 10 min with no query running; leak detection traces all of them to RefundExporter.export(). Same signature on 23 Sep and 1 Oct: known bug CHK-482, third time in two weeks.",
    confidence: 92,
    nextStep:
      "Fixed for now by evicting the leaked connections. Root cause CHK-482 (fix in review). The earlier leaks came 8 and 6 days apart, so the pool fills again in about a week.",
    verdict:
      "Refund exports leak database connections (CHK-482) until checkout has none left for payments.",
    impact: ["1 in 9 payments timed out"],
    hypotheses: [
      {
        name: "Leaked connections (CHK-482)",
        verdict: "confirmed",
        reason:
          "48 of 50 held over 10 minutes with no query running, all from RefundExporter.export().",
      },
      {
        name: "Pool too small for traffic",
        verdict: "ruled_out",
        reason: "Only 2 connections were doing real work; the rest were leaked.",
      },
      {
        name: "payments-api slow",
        verdict: "ruled_out",
        reason:
          "Payments time out waiting 30 s for a free connection, before any call to payments-api.",
      },
    ],
    comparison: {
      metric: "checkout's 50 database connections",
      rows: [
        { label: "Leaked by RefundExporter.export()", value: 48, shown: "48", kind: "affected" },
        { label: "Left for payments", value: 2, shown: "2", kind: "healthy" },
        { label: "Pool limit", value: 50, shown: "50", kind: "limit" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on checkout",
        detail: "pool connections in use: 50 of 50, 0 idle",
        card: "checkout-pool-saturation",
      },
      {
        kind: "metric",
        title: "Payment timeouts on checkout",
        detail: "about 1 in 9 payments (11%) at worst, 0 after the fix",
        chart: true,
      },
      {
        kind: "log",
        title: "Connection leak detection",
        detail: "48 held > 10 min, acquired at RefundExporter.export()",
        card: "checkout-log-patterns",
      },
      {
        kind: "trace",
        title: "Slow span in checkout",
        detail: "POST /pay → pool.acquire: waits 30 s",
        card: "checkout-latency",
        count: "1,312 traces",
      },
    ],
    fix: { kind: "pool", at: "11:21", ledgerId: "L-304", worked: true },
  },
  poolOct: earlierLeak("poolOct", "INC-1038", "oct1", ["10:05", "10:06", "10:08", "10:10"], {
    leaked: 46,
    ledgerId: "L-299",
    first: false,
  }),
  poolSep: earlierLeak(
    "poolSep",
    "INC-1034",
    "sep23",
    ["15:42", "15:43", "15:45", "15:47", "15:58"],
    {
      leaked: 47,
      ledgerId: "L-296",
      first: true,
    },
  ),
  checkout: {
    id: "checkout",
    incidentId: "INC-1047",
    title: "Checkout payments failing: payments-api 2.3.1 over payments-db's connection limit",
    service: "checkout",
    services: ["checkout", "payments-api"],
    upstream: ["api-gateway"],
    downstream: [],
    severity: "p2",
    day: "tuesday",
    time: "14:02",
    seconds: "11",
    outcome: "resolved",
    resolvedAt: "14:20",
    resolvedIn: 18,
    destination: PAYMENTS,
    pagedAt: "14:04",
    firings: [
      {
        detector: "checkout-errors",
        service: "checkout",
        count: 12,
        times: ["14:02", "14:03", "14:04", "14:05"],
        signal: "metric",
        name: "Failed payments",
        peak: "8.3% of payments",
        threshold: "baseline 0.1%",
        charted: true,
        after: "payments-api-log-patterns",
        via: "calls",
      },
      {
        detector: "payments-api-errors",
        service: "payments-api",
        count: 7,
        times: ["14:02", "14:03", "14:04", "14:05"],
        signal: "metric",
        name: "Error ratio",
        peak: "8.9% of requests",
        threshold: "baseline 0.1%",
        after: "payments-api-log-patterns",
        via: "same pods",
      },
      {
        detector: "payments-api-latency",
        service: "payments-api",
        count: 3,
        times: ["14:03", "14:04", "14:05"],
        signal: "metric",
        name: "p95 latency",
        peak: "2.8 s",
        threshold: "baseline 0.21 s",
      },
      {
        detector: "payments-api-log-patterns",
        service: "payments-api",
        count: 1,
        times: ["14:02"],
        signal: "log",
        name: "Too many clients",
        peak: "3,914 lines",
        threshold: "none before 14:02",
        after: "payments-db-limit",
        via: "refused",
      },
    ],
    steps: [
      {
        at: "14:01",
        by: "event",
        title: "Deploy payments-api 2.3.1",
        detail: "Rolled out to all 6 pods at once (no canary)",
        variant: "info",
      },
      {
        at: "14:02",
        by: "event",
        title: "Detector fired",
        detail: "checkout-errors crossed its baseline",
        variant: "destructive",
      },
      {
        at: "14:03",
        by: "me",
        title: "Investigation landed",
        detail: "Cause: the 14:01 deploy, confidence high",
        variant: "primary",
      },
      {
        at: "14:04",
        by: "me",
        title: "Paged with cause",
        detail: "#oncall-payments; P2 waits for the cause",
        variant: "destructive",
      },
      {
        at: "14:11",
        by: "team",
        title: "Rollback started",
        detail: "payments-api back to 2.3.0",
        variant: "muted",
      },
      {
        at: "14:20",
        by: "event",
        title: "Resolved",
        detail: "Payments back to normal",
        variant: "success",
      },
    ],
    chainNotes: [
      {
        id: "payments-db-limit",
        kind: "unwatched",
        service: "payments-db",
        at: "14:01",
        title: "At connection limit",
        detail:
          "200 of 200 connections at 14:01:58. payments-db is a coverage gap: the limit is inferred from payments-api's client connections and its errors.",
        via: "6 × 50 > 200",
      },
    ],
    chart: {
      metric: "failed payments",
      unit: "%",
      points: [
        0.1, 0.12, 0.09, 0.1, 0.11, 0.08, 0.1, 0.13, 0.1, 0.1, 6.9, 8.1, 8.3, 8.2, 8.0, 8.3, 7.9,
        8.2, 8.1, 8.3, 7.4, 6.1, 4.8, 3.6, 2.5, 1.6, 0.9, 0.4, 0.12, 0.1, 0.09, 0.11, 0.1, 0.1,
        0.08, 0.1,
      ],
      detectedAt: 10,
      actionAt: 19,
      peak: 8.3,
    },
    cause:
      "payments-api 2.3.1 raised each pod's connection pool from 20 to 50; 6 pods asked for more than payments-db's 200 connections.",
    summary:
      "From 14:02 to 14:20 checkout failed about 1 in 12 payments (error ratio 8.3%, baseline 0.1%). The failures started a minute after payments-api 2.3.1 went out.",
    likelyCause:
      "db.pool.max went from 20 to 50 in 2.3.1. 6 × 50 = 300 > payments-db max_connections 200. Total client connections plateaued at 200 at 14:01:58 and payments-api logged 'too many clients already' from 14:02:05. payments-db is a coverage gap; its limit is inferred from the plateau and the error.",
    confidence: 91,
    nextStep:
      "Rolled back to 2.3.0. Before shipping 2.3.1 again, keep pool size × replicas under 200, with headroom. Ship payments-api through a progressive rollout.",
    verdict: "payments-api 2.3.1 opened more database connections than payments-db allows.",
    impact: ["1 in 12 payments failed"],
    hypotheses: [
      {
        name: "payments-api 2.3.1 pool size",
        verdict: "confirmed",
        reason:
          "db.pool.max went 20 → 50, so 6 pods × 50 = 300, over payments-db's 200. Errors began a minute after the deploy.",
      },
      {
        name: "payments-db down",
        verdict: "ruled_out",
        reason:
          "It kept 200 connections open and refused only the extra ones ('too many clients').",
      },
      {
        name: "checkout itself",
        verdict: "ruled_out",
        reason: "92% of failed checkout spans end in a payments-api db.connect error.",
      },
      {
        name: "payments-db internals",
        verdict: "open",
        reason: "A coverage gap: its limit is inferred from the plateau at 200 and the error.",
      },
    ],
    comparison: {
      metric: "Connections to payments-db",
      rows: [
        {
          label: "payments-api 2.3.1 asks for (6 × 50)",
          value: 300,
          shown: "300",
          kind: "affected",
        },
        { label: "payments-db limit", value: 200, shown: "200", kind: "limit" },
        { label: "payments-api 2.3.0 used (6 × 20)", value: 120, shown: "120", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on checkout",
        detail: "checkout-errors: error ratio 0.1% → 8.3%",
        chart: true,
      },
      {
        kind: "metric",
        title: "payments-api database client connections",
        detail: "sum of 6 pods: 120 → 200 at 14:01:58, flat after",
        card: "payments-db-limit",
      },
      {
        kind: "log",
        title: "Log pattern in payments-api",
        detail: "FATAL: sorry, too many clients already",
        card: "payments-api-log-patterns",
        count: "3,914 since 14:02:05",
      },
      {
        kind: "trace",
        title: "Failed span in checkout",
        detail: "92% of failed checkout spans end in a payments-api db.connect error",
        card: "payments-api-errors",
        count: "2,911 traces",
      },
    ],
    deploy: { service: "payments-api", version: "2.3.1", at: "14:01", pods: 6 },
    alsoInvolved: ["payments-db"],
    proposalLedgerId: "L-307",
  },
  recs: {
    id: "recs",
    incidentId: "INC-1046",
    title: "Recommendations slow during a manual cache rebuild",
    service: "recommendations",
    services: ["recommendations"],
    upstream: ["api-gateway"],
    downstream: [],
    severity: "p4",
    day: "monday",
    time: "16:40",
    seconds: "03",
    outcome: "held",
    resolvedAt: "16:55",
    resolvedIn: 15,
    destination: DIGEST_DESTINATION,
    firings: [
      {
        detector: "recommendations-latency",
        service: "recommendations",
        count: 3,
        times: ["16:40", "16:41", "16:42"],
        signal: "metric",
        name: "p95 latency",
        peak: "0.94 s",
        threshold: "baseline 0.26 s",
        charted: true,
        after: "recommendations-cpu",
        via: "same pods",
      },
      {
        detector: "recommendations-cpu",
        service: "recommendations",
        count: 2,
        times: ["16:40", "16:42"],
        signal: "metric",
        name: "CPU",
        peak: "92% of limit",
        threshold: "threshold 85%",
      },
    ],
    steps: [
      {
        at: "16:38",
        by: "event",
        title: "Cache rebuild started by hand",
        detail: "From the admin console during peak traffic; normally runs at 02:00",
        variant: "info",
      },
      {
        at: "16:40",
        by: "event",
        title: "Detector fired",
        detail: "recommendations-latency crossed its baseline",
        variant: "destructive",
      },
      {
        at: "16:41",
        by: "me",
        title: "Held for the Friday summary",
        detail: "P4: no page",
        variant: "muted",
      },
      {
        at: "16:55",
        by: "event",
        title: "Resolved",
        detail: "Rebuild finished",
        variant: "success",
      },
    ],
    chart: {
      metric: "p95 latency",
      unit: "s",
      points: [
        0.26, 0.25, 0.27, 0.26, 0.26, 0.25, 0.26, 0.27, 0.27, 0.52, 0.78, 0.89, 0.94, 0.92, 0.9,
        0.93, 0.91, 0.94, 0.9, 0.88, 0.92, 0.89, 0.86, 0.71, 0.45, 0.29, 0.26, 0.27, 0.26, 0.25,
        0.26, 0.26, 0.27, 0.26, 0.25, 0.26,
      ],
      detectedAt: 10,
      peak: 0.94,
    },
    cause:
      "The nightly cache rebuild was started by hand at 16:38, during peak traffic, and finished by itself.",
    summary: "Recommendations went from about 0.26 s to 0.94 s for 15 minutes. Pages still loaded.",
    likelyCause:
      "The nightly cache rebuild was started by hand from the admin console at 16:38, during peak traffic. It finished by itself at 16:55.",
    confidence: 88,
    nextStep:
      "No action needed. Summary note: a rebuild slows recommendations about 3×, so run it off-peak.",
    verdict: "Someone started the nightly cache rebuild by hand during peak traffic.",
    impact: ["Recommendations about 3× slower", "Pages still loaded"],
    hypotheses: [
      {
        name: "Cache rebuild started by hand",
        verdict: "confirmed",
        reason:
          "Started from the admin console at 16:38, during peak traffic; it usually runs at 02:00.",
      },
      {
        name: "Lasting slowdown",
        verdict: "ruled_out",
        reason: "Back to about 0.26 s once the rebuild finished at 16:55.",
      },
      { name: "Pages failing", verdict: "ruled_out", reason: "Pages still loaded; only slower." },
    ],
    comparison: {
      metric: "p95 latency",
      rows: [
        { label: "During the rebuild", value: 0.94, shown: "0.94 s", kind: "affected" },
        { label: "Normal", value: 0.26, shown: "0.26 s", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on recommendations",
        detail: "p95 0.94 s (baseline 0.26 s)",
        chart: true,
      },
      {
        kind: "log",
        title: "Job log",
        detail:
          "cache-rebuild job started manually from the admin console at 16:38 (usually 02:00)",
        card: "change",
      },
    ],
  },
  gateway: {
    id: "gateway",
    incidentId: "INC-1001",
    title: "API gateway rejecting 1 in 30 requests after a config change",
    service: "api-gateway",
    services: ["api-gateway"],
    upstream: [],
    downstream: ["login"],
    severity: "p2",
    day: "thursday",
    time: "15:22",
    seconds: "14",
    outcome: "resolved",
    resolvedAt: "15:35",
    resolvedIn: 13,
    destination: PLATFORM,
    pagedAt: "15:24",
    firings: [
      {
        detector: "api-gateway-401-spike",
        service: "api-gateway",
        count: 5,
        times: ["15:22", "15:23", "15:24", "15:25"],
        signal: "metric",
        name: "401 responses",
        peak: "3.3% of requests",
        threshold: "10× the level 5 min earlier",
        charted: true,
      },
      {
        detector: "login-errors",
        service: "login",
        count: 2,
        times: ["15:23", "15:24"],
        signal: "metric",
        name: "Sign-in errors",
        peak: "4.1% of sign-ins",
        threshold: "ceiling 2%",
        via: "tokens expire",
      },
    ],
    steps: [
      {
        at: "15:20",
        by: "event",
        title: "Config change",
        detail: "token_ttl 3600 → 60",
        variant: "info",
      },
      {
        at: "15:22",
        by: "event",
        title: "Guardrail fired",
        detail: "api-gateway 401s jumped 10× in 5 min (safety check while learning)",
        variant: "destructive",
      },
      {
        at: "15:24",
        by: "me",
        title: "Paged with cause",
        detail: "#platform-alerts; P2 waits for the cause",
        variant: "destructive",
      },
      {
        at: "15:34",
        by: "team",
        title: "Change reverted",
        detail: "token_ttl back to 3600",
        variant: "muted",
      },
      {
        at: "15:35",
        by: "event",
        title: "Resolved",
        detail: "Rejections back to normal",
        variant: "success",
      },
    ],
    chart: {
      metric: "rejected requests",
      unit: "%",
      points: [
        0.3, 0.35, 0.3, 0.32, 0.28, 0.33, 0.31, 0.3, 0.32, 1.6, 3.1, 3.3, 3.4, 3.2, 3.3, 3.4, 3.3,
        3.2, 3.4, 3.3, 3.2, 3.3, 3.1, 0.6, 0.3, 0.32, 0.29, 0.3, 0.31, 0.3, 0.33, 0.3, 0.29, 0.3,
      ],
      detectedAt: 10,
      actionAt: 22,
      peak: 3.4,
    },
    cause: "A config change at 15:20 cut the sign-in token lifetime from 3600 s to 60 s.",
    summary: "The API rejected about 1 in 30 requests with 401 for 13 minutes.",
    likelyCause:
      "token_ttl was changed from 3600 to 60 at 15:20, so tokens expired mid-session and requests were rejected.",
    confidence: 89,
    nextStep: "Reverted. Add a review step for token_ttl changes.",
    verdict: "A config change cut sign-in tokens to 60 seconds, so they expired mid-session.",
    impact: ["1 in 30 requests rejected"],
    hypotheses: [
      {
        name: "token_ttl config change",
        verdict: "confirmed",
        reason:
          "Cut from 3600 s to 60 s at 15:20; 401s jumped 2 minutes later, as tokens expired mid-session.",
      },
      {
        name: "Sign-in outage",
        verdict: "ruled_out",
        reason: "Sign-in errors followed the 401s, not the other way round.",
      },
      {
        name: "Normal for this hour",
        verdict: "open",
        reason:
          "Only 3 days of history, so judged against 5 minutes earlier, not a learned baseline.",
      },
    ],
    comparison: {
      metric: "401 responses",
      rows: [
        { label: "After the change", value: 3.3, shown: "3.3%", kind: "affected" },
        { label: "5 minutes before", value: 0.3, shown: "0.3%", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on api-gateway",
        detail:
          "401 responses: 3.3%, 10× the level 5 minutes earlier (safety check while learning)",
        chart: true,
      },
      {
        kind: "log",
        title: "Config audit",
        detail: "token_ttl 3600 → 60 at 15:20",
        card: "change",
      },
    ],
  },
  queue: {
    id: "queue",
    incidentId: "INC-1040",
    title: "Orders queue backing up after a database migration",
    service: "orders",
    services: ["orders", "order-queue"],
    upstream: ["checkout"],
    downstream: ["order-queue", "orders-db"],
    severity: "p2",
    day: "oct2",
    time: "21:30",
    seconds: "47",
    outcome: "resolved",
    resolvedAt: "22:10",
    resolvedIn: 40,
    destination: PLATFORM,
    pagedAt: "21:36",
    firings: [
      {
        detector: "order-queue-depth",
        service: "order-queue",
        count: 6,
        times: ["21:30", "21:31", "21:33", "21:35"],
        signal: "metric",
        name: "Orders waiting",
        peak: "4,120 orders",
        threshold: "baseline under 50",
        charted: true,
        after: "orders-latency",
        via: "backlog",
      },
      {
        detector: "orders-latency",
        service: "orders",
        count: 3,
        times: ["21:31", "21:32", "21:34"],
        signal: "metric",
        name: "p95 latency",
        peak: "1.6 s",
        threshold: "baseline 0.12 s",
        after: "orders-db-query-latency",
        via: "40× slower",
      },
      {
        detector: "orders-db-query-latency",
        service: "orders-db",
        count: 2,
        times: ["21:32", "21:34"],
        signal: "trace",
        name: "Slow index lookups",
        peak: "p95 120 ms",
        threshold: "baseline 3 ms",
        after: "change",
        via: "index invalid",
      },
    ],
    steps: [
      {
        at: "21:20",
        by: "event",
        title: "Database migration",
        detail: "orders-db migration 0142: rebuild orders_by_status",
        variant: "info",
        service: "orders-db",
      },
      {
        at: "21:30",
        by: "event",
        title: "Detector fired",
        detail: "order-queue-depth crossed its baseline",
        variant: "destructive",
      },
      {
        at: "21:33",
        by: "me",
        title: "Fix applied",
        detail: "ScaleQueueWorkers orders-consumer 4 → 8 (standing permission)",
        variant: "primary",
      },
      {
        at: "21:36",
        by: "me",
        title: "Fix didn't help, scaled back to 4, paged",
        detail: "#platform-alerts",
        variant: "destructive",
      },
      {
        at: "21:52",
        by: "team",
        title: "Index rebuilt",
        detail: "The 21:20 build had failed and left orders_by_status invalid",
        variant: "muted",
      },
      { at: "22:10", by: "event", title: "Resolved", detail: "Queue empty", variant: "success" },
    ],
    chart: {
      metric: "orders waiting",
      unit: "orders",
      points: [
        30, 45, 90, 220, 420, 680, 960, 1300, 1650, 2000, 2350, 2700, 3000, 3300, 3600, 3900, 4120,
        3850, 3400, 2900, 2350, 1800, 1250, 750, 320, 40, 30, 40, 30,
      ],
      detectedAt: 5,
      actionAt: 16,
      peak: 4120,
    },
    cause:
      "The 21:20 migration left index orders_by_status invalid, so lookups scanned the whole table; adding workers didn't help.",
    summary: "Orders piled up to about 4,000 behind for 40 minutes.",
    likelyCause:
      "orders_by_status lookups went from 3 ms to 120 ms at 21:21; each worker drained a third as many orders.",
    confidence: 84,
    nextStep:
      "Resolved by rebuilding the index. Follow-up: migrations that build indexes concurrently should check the index is valid before finishing.",
    verdict: "The 21:20 migration left an index invalid, so order lookups became 40× slower.",
    impact: ["About 4,000 orders waiting at peak"],
    hypotheses: [
      {
        name: "Index left invalid by migration 0142",
        verdict: "confirmed",
        reason:
          "orders_by_status lookups went from 3 ms to 120 ms at 21:21, a minute after the migration.",
      },
      {
        name: "Too few workers",
        verdict: "ruled_out",
        reason: "Doubling workers 4 → 8 at 21:33 didn't help, so I scaled back and paged.",
      },
      {
        name: "More orders than usual",
        verdict: "ruled_out",
        reason:
          "Each worker drained a third as many orders; the slow lookup, not the volume, built the backlog.",
      },
    ],
    comparison: {
      metric: "orders_by_status lookup, p95",
      rows: [
        { label: "Since 21:21", value: 120, shown: "120 ms", kind: "affected" },
        { label: "Before the migration", value: 3, shown: "3 ms", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on order-queue",
        detail: "depth 4,120 at peak (baseline under 50)",
        chart: true,
      },
      {
        kind: "trace",
        title: "Slow span in orders",
        detail:
          "orders → orders-db SELECT … WHERE status = $1: p95 120 ms (baseline 3 ms) since 21:21",
        card: "orders-db-query-latency",
      },
    ],
    fix: { kind: "queueWorker", at: "21:33", ledgerId: "L-305", worked: false },
  },
  push: {
    id: "push",
    incidentId: "INC-1039",
    title: "Push notifications 2 minutes late during a provider slowdown",
    service: "notifications",
    services: ["notifications"],
    upstream: [],
    downstream: [],
    severity: "p4",
    day: "oct1",
    time: "13:50",
    seconds: "19",
    outcome: "held",
    resolvedAt: "14:20",
    resolvedIn: 30,
    destination: DIGEST_DESTINATION,
    firings: [
      {
        detector: "notifications-delivery-delay",
        service: "notifications",
        count: 2,
        times: ["13:50", "13:51"],
        signal: "metric",
        name: "Delivery delay",
        peak: "p95 128 s",
        threshold: "baseline 4 s",
        charted: true,
        after: "notifications-deps",
      },
      {
        detector: "notifications-deps",
        service: "notifications",
        count: 3,
        times: ["13:50", "13:52", "13:55"],
        signal: "trace",
        name: "Slow provider calls",
        peak: "p95 3.1 s",
        threshold: "baseline 0.1 s",
        via: "calls",
      },
    ],
    steps: [
      {
        at: "13:48",
        by: "event",
        title: "Push provider slowed down",
        detail: "Provider API latency 30× its usual level (status page: degraded)",
        variant: "info",
        service: "push provider",
      },
      {
        at: "13:50",
        by: "event",
        title: "Detector fired",
        detail: "delivery delay crossed its baseline",
        variant: "destructive",
      },
      {
        at: "13:51",
        by: "me",
        title: "Held for the Friday summary",
        detail: "P4: provider slowdown",
        variant: "muted",
      },
      {
        at: "14:20",
        by: "event",
        title: "Resolved",
        detail: "Provider recovered",
        variant: "success",
      },
    ],
    chart: {
      metric: "delivery delay",
      unit: "s",
      points: [
        4, 5, 4, 4, 30, 96, 118, 128, 121, 115, 124, 119, 110, 117, 122, 108, 97, 84, 52, 18, 6, 4,
        4, 5, 4, 4,
      ],
      detectedAt: 5,
      peak: 128,
    },
    cause: "The outside push provider was slow.",
    summary: "Push notifications arrived about 2 minutes late for 30 minutes.",
    likelyCause: "Provider API latency rose 30× from 13:48.",
    confidence: 90,
    nextStep: "No action needed.",
    verdict: "The outside push provider slowed down; nothing changed on our side.",
    impact: ["Push about 2 minutes late"],
    hypotheses: [
      {
        name: "Push provider slow",
        verdict: "confirmed",
        reason: "Provider calls went from 0.1 s to 3.1 s at 13:48; its status page said degraded.",
      },
      {
        name: "Our notifications service",
        verdict: "ruled_out",
        reason: "The extra wait is all inside the provider calls.",
      },
      {
        name: "A change on our side",
        verdict: "ruled_out",
        reason: "No deploy or config change to notifications before 13:48.",
      },
    ],
    comparison: {
      metric: "Provider call time, p95",
      rows: [
        { label: "From 13:48", value: 3.1, shown: "3.1 s", kind: "affected" },
        { label: "Normal", value: 0.1, shown: "0.1 s", kind: "healthy" },
      ],
    },
    evidence: [
      { kind: "metric", title: "Delivery delay", detail: "p95 128 s (baseline 4 s)", chart: true },
    ],
  },
  login: {
    id: "login",
    incidentId: "INC-1037",
    title: "Sign-in slow: session cache full after a traffic spike",
    service: "login",
    services: ["login", "session-cache"],
    upstream: ["api-gateway"],
    downstream: ["session-cache"],
    severity: "p2",
    day: "sep30",
    time: "10:12",
    seconds: "55",
    outcome: "resolved",
    resolvedAt: "10:37",
    resolvedIn: 25,
    destination: PLATFORM,
    pagedAt: "10:14",
    firings: [
      {
        detector: "login-latency",
        service: "login",
        count: 11,
        times: ["10:12", "10:13", "10:14", "10:15"],
        signal: "metric",
        name: "p95 sign-in time",
        peak: "5.8 s",
        threshold: "baseline 0.6 s",
        charted: true,
        after: "session-cache-memory",
        via: "cache misses",
      },
      {
        detector: "session-cache-memory",
        service: "session-cache",
        count: 6,
        times: ["10:11", "10:12", "10:13", "10:14"],
        signal: "metric",
        name: "Cache memory",
        peak: "100% of maxmemory",
        threshold: "threshold 90%",
        via: "2× sessions",
      },
      {
        detector: "session-cache-evictions",
        service: "session-cache",
        count: 4,
        times: ["10:12", "10:13", "10:15", "10:17"],
        signal: "metric",
        name: "Sessions evicted",
        peak: "3,400 a minute",
        threshold: "baseline near 0",
        via: "cache full",
      },
      {
        detector: "login-log-patterns",
        service: "login",
        count: 2,
        times: ["10:13", "10:15"],
        signal: "log",
        name: "Session lost logs",
        peak: "people signed out",
        threshold: "none before 10:13",
        after: "session-cache-evictions",
      },
    ],
    steps: [
      {
        at: "10:05",
        by: "event",
        title: "Traffic doubled",
        detail: "Marketing email",
        variant: "info",
      },
      {
        at: "10:12",
        by: "event",
        title: "Detector fired",
        detail: "login-latency crossed its baseline",
        variant: "destructive",
      },
      {
        at: "10:14",
        by: "me",
        title: "Paged with cause",
        detail: "#platform-alerts",
        variant: "destructive",
      },
      {
        at: "10:31",
        by: "team",
        title: "Cache resized",
        detail: "session-cache memory raised",
        variant: "muted",
      },
      {
        at: "10:37",
        by: "event",
        title: "Resolved",
        detail: "Sign-in back to normal",
        variant: "success",
      },
    ],
    chart: {
      metric: "p95 sign-in time",
      unit: "s",
      points: [
        0.6, 0.6, 0.7, 0.8, 1.1, 1.9, 3.4, 4.6, 5.2, 5.5, 5.8, 5.6, 5.4, 5.7, 5.5, 5.8, 5.6, 5.3,
        5.5, 5.7, 5.4, 5.6, 5.5, 5.3, 5.6, 5.4, 5.5, 4.4, 3.1, 2.0, 1.2, 0.8, 0.6, 0.6, 0.6, 0.5,
        0.6, 0.6, 0.6, 0.6,
      ],
      detectedAt: 7,
      actionAt: 26,
      peak: 5.8,
    },
    cause: "The session cache filled up after traffic doubled.",
    summary: "1 in 8 people waited more than 5 s to sign in for 25 minutes.",
    likelyCause:
      "session-cache hit 100% memory and evicted 3,400 sessions a minute, so some people were signed out.",
    confidence: 88,
    nextStep:
      "Resolved by adding cache memory. Follow-up: sessions live in a cache that evicts when full, so a full cache signs people out.",
    verdict:
      "Doubled traffic filled the session cache, which evicted sessions and signed people out.",
    impact: ["1 in 8 sign-ins took over 5 s", "Some people signed out"],
    hypotheses: [
      {
        name: "Session cache full",
        verdict: "confirmed",
        reason: "session-cache hit 100% of its memory and evicted 3,400 sessions a minute.",
      },
      {
        name: "Traffic doubled",
        verdict: "confirmed",
        reason: "A marketing email doubled traffic at 10:05 and filled the cache.",
      },
      {
        name: "Bug in login",
        verdict: "ruled_out",
        reason: "Sign-in recovered once cache memory was raised at 10:31, with no change to login.",
      },
    ],
    comparison: {
      metric: "p95 sign-in time",
      rows: [
        { label: "Cache full", value: 5.8, shown: "5.8 s", kind: "affected" },
        { label: "Normal", value: 0.6, shown: "0.6 s", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on login",
        detail: "p95 5.8 s (baseline 0.6 s)",
        chart: true,
      },
    ],
  },
  uploads: {
    id: "uploads",
    incidentId: "INC-1035",
    title: "Image uploads failing after a certificate expired",
    service: "image-resizer",
    services: ["image-resizer"],
    upstream: ["api-gateway"],
    downstream: ["media-store"],
    severity: "p4",
    day: "sep24",
    time: "07:05",
    seconds: "38",
    outcome: "held",
    resolvedAt: "07:15",
    resolvedIn: 10,
    destination: DIGEST_DESTINATION,
    firings: [
      {
        detector: "image-resizer-errors",
        service: "image-resizer",
        count: 2,
        times: ["07:05", "07:06"],
        signal: "metric",
        name: "Failed uploads",
        peak: "2.4% after retries",
        threshold: "baseline 0.05%",
        charted: true,
        after: "image-resizer-log-patterns",
      },
      {
        detector: "image-resizer-log-patterns",
        service: "image-resizer",
        count: 3,
        times: ["07:05", "07:08", "07:11"],
        signal: "log",
        name: "TLS handshake errors",
        peak: "1 of 12 pods",
        threshold: "none before 07:04",
        via: "old cert",
      },
    ],
    steps: [
      {
        at: "07:04",
        by: "event",
        title: "Certificate expired",
        detail: "Replacement issued at 06:58; 1 of 12 pods hadn't loaded it",
        variant: "info",
      },
      {
        at: "07:05",
        by: "event",
        title: "Detector fired",
        detail: "image-resizer-errors crossed its baseline",
        variant: "destructive",
      },
      {
        at: "07:06",
        by: "me",
        title: "Held for the Friday summary",
        detail: "P4: people could retry",
        variant: "muted",
      },
      {
        at: "07:15",
        by: "event",
        title: "Resolved",
        detail: "The last pod loaded the new certificate",
        variant: "success",
      },
    ],
    chart: {
      metric: "failed uploads",
      unit: "%",
      points: [
        0.05, 0.05, 0.04, 0.05, 0.06, 0.05, 0.05, 0.04, 0.05, 0.9, 2.1, 2.4, 2.3, 2.4, 2.2, 2.3,
        2.4, 2.2, 2.3, 1.6, 0.3, 0.05, 0.05, 0.04, 0.05, 0.06, 0.05, 0.05, 0.04, 0.05, 0.05,
      ],
      detectedAt: 10,
      peak: 2.4,
    },
    cause:
      "The certificate expired at 07:04. Its replacement was only issued at 06:58, and 1 of the 12 servers didn't load it until 07:15.",
    summary: "About 1 in 40 image uploads failed for 10 minutes.",
    likelyCause:
      "The certificate expired at 07:04. Its replacement was only issued at 06:58, and 1 of the 12 servers didn't load it until 07:15. The app retried most failed uploads, so about 1 in 40 people saw an error.",
    confidence: 87,
    nextStep:
      "Renew certificates days before expiry, not minutes, and have servers reload them without a restart.",
    verdict: "One of 12 servers kept serving an expired certificate until 07:15.",
    impact: ["1 in 40 uploads failed"],
    hypotheses: [
      {
        name: "Expired certificate on one pod",
        verdict: "confirmed",
        reason:
          "1 of 12 pods hadn't loaded the replacement issued at 06:58 and failed TLS handshakes from 07:04.",
      },
      {
        name: "Every server",
        verdict: "ruled_out",
        reason: "The other 11 pods served the new certificate without errors.",
      },
      {
        name: "Why renewal came so late",
        verdict: "open",
        reason: "The replacement was issued 6 minutes before expiry; I haven't checked why.",
      },
    ],
    comparison: {
      metric: "Uploads failing, by pod",
      rows: [
        { label: "1 pod on the expired certificate", value: 100, shown: "all", kind: "affected" },
        { label: "11 pods on the new certificate", value: 0, shown: "none", kind: "healthy" },
      ],
    },
    evidence: [
      {
        kind: "metric",
        title: "Metric deviation on image-resizer",
        detail: "errors 8.3% server-side; 2.4% after retries (baseline 0.05%)",
        chart: true,
      },
    ],
  },
};

const SERVICE_KINDS: Record<string, ServiceKind> = {
  "payments-db": "database",
  "orders-db": "database",
  "session-cache": "cache",
  "order-queue": "queue",
  "email-worker": "worker",
  "billing-worker": "worker",
  "analytics-collector": "worker",
  "search-indexer": "worker",
  scheduler: "worker",
};

const BASE_SERVICES = [
  "admin-portal",
  "analytics-collector",
  "api-gateway",
  "audit-log",
  "billing-api",
  "billing-worker",
  "cart",
  "catalog",
  "cdn-edge",
  "checkout",
  "config-service",
  "currency",
  "email-worker",
  "feature-flags",
  "fraud-check",
  "geo-lookup",
  "image-resizer",
  "inventory",
  "invoice-service",
  "login",
  "loyalty",
  "media-store",
  "notifications",
  "order-queue",
  "orders",
  "orders-db",
  "payments-api",
  "payments-db",
  "pricing",
  "recommendations",
  "refunds",
  "reporting",
  "reviews",
  "scheduler",
  "search",
  "search-indexer",
  "session-cache",
  "shipping",
  "support-chat",
  "tax",
  "user-profile",
  "webhooks",
  "wishlist",
];

const PROD_EU = [
  "cdn-edge",
  "geo-lookup",
  "reviews",
  "shipping",
  "support-chat",
  "tax",
  "webhooks",
  "wishlist",
];

// The billing trio was found together on Wednesday 09:12, so all three are equally far along.
const LEARNING_DAYS: Record<string, number> = {
  "billing-api": 3,
  "billing-worker": 3,
  "invoice-service": 3,
};

// A new customer connected 3 days ago, so every service has 3 of 7 days and none has a baseline yet.
const NEW_CUSTOMER_READY_IN = 4;

const NEW_CUSTOMER = [
  "api-gateway",
  "cart",
  "catalog",
  "checkout",
  "email-worker",
  "inventory",
  "login",
  "notifications",
  "orders",
  "payments-api",
  "payments-db",
  "pricing",
  "recommendations",
  "search",
  "session-cache",
  "shipping",
  "user-profile",
  "webhooks",
];

const streamOf = (name: string) => {
  if (PROD_EU.includes(name)) return "prod_eu_logs";
  if (["orders", "order-queue", "refunds", ...NEW_SERVICES.names].includes(name))
    return "orders_logs";
  if (SERVICE_KINDS[name] === "database" || SERVICE_KINDS[name] === "cache") return "k8s_metrics";
  return "otel_traces";
};

const service = (
  name: string,
  state: ServiceState,
  extra: Partial<ServiceFact> = {},
): ServiceFact => ({
  name,
  kind: SERVICE_KINDS[name] ?? "http",
  state,
  stream: streamOf(name),
  ...extra,
});

const servicesFor = (scenario: Scenario): ServiceFact[] => {
  if (scenario === "noBaseline") {
    return NEW_CUSTOMER.map((name) =>
      service(name, "learning", { readyInDays: NEW_CUSTOMER_READY_IN }),
    );
  }
  const base = BASE_SERVICES.map((name) => {
    if (scenario === "allClear") return service(name, "watching");
    if (name === "payments-db") return service(name, "cantSee", { reason: "noLink" });
    if (scenario === "cantSee" && PROD_EU.includes(name)) {
      return service(name, "cantSee", { reason: "stopped" });
    }
    if (scenario !== "cantSee" && LEARNING_DAYS[name]) {
      return service(name, "learning", { readyInDays: LEARNING_DAYS[name] });
    }
    return service(name, "watching");
  });
  const foundToday = SCENARIO_BASE[scenario].foundToday ?? [];
  return [
    ...base,
    ...foundToday.map((name) =>
      service(name, "learning", { readyInDays: LEARNING_WINDOW_DAYS, foundToday: true }),
    ),
  ];
};

const countIn = (services: ServiceFact[], stream: string) =>
  services.filter((s) => s.stream === stream).length;

const STREAM_SCAN_MINUTES: Record<string, number> = {
  otel_traces: 1,
  k8s_metrics: 3,
  orders_logs: 5,
  prod_eu_logs: 2,
};

// Every stream that carries a known service is listed, so per-stream counts add up to the total.
const streamsFor = (scenario: Scenario, services: ServiceFact[]): StreamFact[] => {
  const listed = Object.keys(STREAM_SCAN_MINUTES)
    .filter((name) => countIn(services, name) > 0)
    .map((name): StreamFact => {
      const stalled = scenario === "cantSee" && name === "prod_eu_logs";
      return {
        name,
        scannedMinutesAgo: stalled ? 72 : STREAM_SCAN_MINUTES[name],
        stale: stalled || undefined,
        services: countIn(services, name),
      };
    });
  const unscanned = SCENARIO_BASE[scenario].gaps.some((g) => g.kind === "unscanned");
  return unscanned
    ? [...listed, { name: UNSCANNED_STREAM, scannedMinutesAgo: null, services: 0 }]
    : listed;
};

const SCENARIO_BASE: Record<Scenario, Omit<ScenarioFact, "services" | "streams">> = {
  demo: {
    periods: {
      week: {
        problems: ["search", "ordersDisk", "email", "pool", "checkout", "recs"],
        oldAlertPages: 37,
      },
      month: {
        problems: [
          "search",
          "ordersDisk",
          "email",
          "pool",
          "checkout",
          "recs",
          "queue",
          "push",
          "poolOct",
          "login",
          "uploads",
          "poolSep",
        ],
        oldAlertPages: 161,
      },
    },
    weekFirings: 1284,
    requests: [
      { kind: "fixNow", ledgerId: "L-308", problem: "search", fixKind: "revertConfig" },
      { kind: "retune", ledgerId: "L-309" },
      { kind: "fromNowOn", ledgerId: "L-311", autonomyKind: "abortRollout" },
    ],
    foundToday: NEW_SERVICES.names,
    gaps: [{ kind: "paymentsDb", focus: "payments-db" }, { kind: "unscanned" }],
  },
  allClear: {
    periods: {
      week: { problems: [], oldAlertPages: 9 },
      month: { problems: ["login", "uploads"], oldAlertPages: 34 },
    },
    weekFirings: 640,
    requests: [],
    gaps: [],
  },
  incident: {
    periods: {
      week: {
        problems: ["checkoutNow", "search", "ordersDisk", "email", "checkout"],
        oldAlertPages: 52,
      },
      month: {
        problems: ["checkoutNow", "search", "ordersDisk", "email", "checkout", "login", "uploads"],
        oldAlertPages: 176,
      },
    },
    weekFirings: 1530,
    requests: [
      { kind: "fixNow", ledgerId: "L-313", problem: "checkoutNow", fixKind: "abortRollout" },
      { kind: "fixNow", ledgerId: "L-308", problem: "search", fixKind: "revertConfig" },
    ],
    foundToday: NEW_SERVICES.names,
    gaps: [{ kind: "paymentsDb", focus: "payments-db" }, { kind: "unscanned" }],
  },
  cantSee: {
    periods: {
      week: { problems: ["email", "checkout"], oldAlertPages: 31 },
      month: { problems: ["email", "checkout", "login", "uploads"], oldAlertPages: 140 },
    },
    weekFirings: 1021,
    requests: [],
    gaps: [
      { kind: "stalled", focus: PROD_EU[0], count: PROD_EU.length },
      { kind: "paymentsDb", focus: "payments-db" },
    ],
    foundToday: FOUND_TODAY_CANT_SEE,
  },
  noBaseline: {
    periods: {
      week: { problems: ["gateway"], oldAlertPages: null },
      month: { problems: ["gateway"], oldAlertPages: null },
    },
    weekFirings: 214,
    requests: [],
    gaps: [],
    connectedDaysAgo: 3,
  },
};

export const LEDGER: LedgerFact[] = [
  {
    id: "L-313",
    loop: "action",
    actionClass: "AbortRollout",
    target: "checkout 2.4.0 rollout (paused at 6 of 12 pods)",
    state: "awaiting",
    confidence: 90,
    evidence:
      "Safe whatever the cause: only 2.4.0 pods fail. Every failure comes from the 6 pods on 2.4.0; the 6 on the previous version are healthy at 40% CPU and can take the full load. Stopping the rollout sends traffic back to them and leaves 2.4.0 deployed for debugging. payments-db is a coverage gap, so it isn't ruled out.",
    before: "rollout: checkout 2.4.0, paused at its 50% step (6 of 12 pods)",
    after: "rollout: paused\ntraffic: previous version (6 pods)\n2.4.0 pods: kept, no traffic",
    day: "today",
    time: "10:44",
    history: [{ kind: "problems", key: "checkoutNowAsked" }],
    in: ["incident"],
  },
  {
    id: "L-308",
    loop: "action",
    actionClass: "RevertConfigChange",
    target: "search-2 · search.query_cache.size",
    state: "awaiting",
    confidence: 86,
    evidence:
      "Changed 10% → 60% at 10:16 on search-2 only. search-2 is the only node out of memory; the 4 nodes on 10% are healthy. Applying it takes one restart of search-2, which is already restarting every few minutes. Undo re-applies 60%.",
    before: "search.query_cache.size: 60%   # search-2 only, changed 10:16",
    after:
      "search.query_cache.size: 10%   # same as search-1,3,4,5\napply: one restart of search-2",
    day: "today",
    time: "10:30",
    history: [{ kind: "problems", key: "searchAsked" }],
    in: ["demo", "incident"],
  },
  {
    id: "L-309",
    loop: "calibration",
    actionClass: "RaiseThreshold",
    target: `Alert '${RETUNE.alert}' on ${RETUNE.host}`,
    state: "awaiting",
    confidence: 88,
    evidence: `Fired ${RETUNE.fired} times in 30 days; none acknowledged or acted on. Peak 86% during nightly compaction, back to about 70% by 07:00. Largest daily net growth in 30 days: 3 points, so from ${RETUNE.to}% it would take more than 3 days to fill. The fill-forecast check (full within 24 h) stays on.`,
    before: `condition: disk_used_percent > ${RETUNE.from}`,
    after: `condition: disk_used_percent > ${RETUNE.to}`,
    day: "friday",
    time: "09:00",
    userBuilt: true,
    history: [],
    in: ["demo"],
  },
  {
    id: "L-310",
    loop: "coverage",
    actionClass: "CreateDetector",
    target: `${NEW_SERVICES.names.join(", ")} · requests, errors, latency`,
    state: "auto_applied",
    confidence: 92,
    evidence: `${NEW_SERVICES.names.length} new services found in ${NEW_SERVICES.stream} this morning; matched library entry http-service. Watched at once with basic safety checks; learned baselines follow once there is a week of history.`,
    before: "# not watched",
    after: `detectors: ${NEW_SERVICES.names.map((n) => `${n}-{requests,errors,latency}`).join(", ")}\nmethod: anomaly (learning)\nguardrails: error-ratio ceiling, freshness`,
    day: "today",
    time: "08:12",
    reviewWindow: "7 days",
    history: [{ kind: "changes", key: "newWatch" }],
    in: ["demo", "incident"],
  },
  {
    id: "L-314",
    loop: "coverage",
    actionClass: "CreateDetector",
    target: `${FOUND_TODAY_CANT_SEE.length} services · requests, errors, latency`,
    state: "auto_applied",
    confidence: 91,
    evidence: `${FOUND_TODAY_CANT_SEE.length} new services found in otel_traces this morning; matched library entry http-service. Watched at once with basic safety checks; learned baselines follow once there is a week of history.`,
    before: "# not watched",
    after: `detectors: ${FOUND_TODAY_CANT_SEE.join(", ")} × {requests, errors, latency}\nmethod: anomaly (learning)\nguardrails: error-ratio ceiling, freshness`,
    day: "today",
    time: "07:30",
    reviewWindow: "7 days",
    history: [{ kind: "changes", key: "foundWatch" }],
    in: ["cantSee"],
  },
  {
    id: "L-311",
    loop: "action",
    actionClass: "RaiseAutonomy",
    target: "Action class AbortRollout",
    state: "awaiting",
    confidence: 95,
    evidence:
      "Stopped 6 rollouts on approval in 60 days when only the new version's pods were failing; errors returned to baseline within 2 minutes each time, and the team fixed forward. Only acts mid-rollout, while the old version still runs at full capacity.",
    before: "AbortRollout: suggest",
    after:
      "AbortRollout: auto   # only when errors are confined to new-version pods; never deletes or rolls back; report each",
    day: "friday",
    time: "09:00",
    history: [],
    in: ["demo"],
  },
  {
    id: "L-304",
    loop: "action",
    actionClass: "EvictLeakedConnections",
    target: "checkout connection pool",
    state: "approved",
    confidence: 92,
    evidence:
      "Pool 50 of 50, 0 idle; 48 connections held > 10 min with no active query, all from RefundExporter.export(). Known leak CHK-482, third time in two weeks.",
    before: "pool: 50 of 50 in use, 0 idle",
    after:
      "action: close connections held > 10m with no active query (48)\nin-flight queries: untouched",
    day: "wednesday",
    time: "11:21",
    note: "Worked: payments back to normal by 11:23",
    history: [
      { kind: "fixes", key: "poolFixed", worked: true },
      { kind: "decisions", key: "poolApproved" },
    ],
    in: ["demo"],
  },
  {
    id: "L-299",
    loop: "action",
    actionClass: "EvictLeakedConnections",
    target: "checkout connection pool",
    state: "approved",
    confidence: 90,
    evidence:
      "Pool 50 of 50, 0 idle; 46 connections held > 10 min with no active query, all from RefundExporter.export(). Same leak as 23 Sep (CHK-482), second time in 8 days.",
    before: "pool: 50 of 50 in use, 0 idle",
    after:
      "action: close connections held > 10m with no active query (46)\nin-flight queries: untouched",
    day: "oct1",
    time: "10:08",
    note: "Worked: payments back to normal by 10:10",
    history: [
      { kind: "fixes", key: "poolFixed", worked: true },
      { kind: "decisions", key: "poolApproved" },
    ],
    in: ["demo"],
  },
  {
    id: "L-296",
    loop: "action",
    actionClass: "EvictLeakedConnections",
    target: "checkout connection pool",
    state: "approved",
    confidence: 88,
    evidence:
      "Pool 50 of 50, 0 idle; 47 connections held > 10 min with no active query, all acquired at RefundExporter.export(). A new leak, so the eviction was proposed from leak detection; I filed it with the checkout team as CHK-482 afterwards.",
    before: "pool: 50 of 50 in use, 0 idle",
    after:
      "action: close connections held > 10m with no active query (47)\nin-flight queries: untouched",
    day: "sep23",
    time: "15:45",
    note: "Worked: payments back to normal by 15:47",
    history: [
      { kind: "fixes", key: "poolFixed", worked: true },
      { kind: "decisions", key: "poolApproved" },
    ],
    in: ["demo"],
  },
  {
    id: "L-301",
    loop: "coverage",
    actionClass: "CreateDetector",
    target: "billing-api, billing-worker, invoice-service · requests, errors, latency",
    state: "auto_applied",
    confidence: 93,
    evidence: "3 new services found in otel_traces; matched library entry http-service.",
    before: "# not watched",
    after:
      "detectors: billing-api-*, billing-worker-*, invoice-service-*\nmethod: anomaly (learning)\nguardrails: error-ratio ceiling, freshness",
    day: "wednesday",
    time: "09:12",
    reviewWindow: "3 more days",
    history: [{ kind: "changes", key: "billingWatch" }],
    in: ["demo", "incident"],
  },
  {
    id: "L-307",
    loop: "investigation",
    actionClass: "FixAlertQuery",
    target: "Alert 'payments-api-db-pool'",
    state: "approved",
    confidence: 87,
    evidence:
      "Never fired: each pod held about 33 of its 50 connections; together they hit payments-db's 200. Counting all pods against 200 at 85% for 15s, it would have fired at 14:01:55, before the first failed payment and 2 minutes before my page.",
    before: "max by (pod)(in_use / pool_max) > 0.95 for 1m",
    after: "sum(in_use) / 200 > 0.85 for 15s   # 200 = payments-db max_connections",
    day: "tuesday",
    time: "15:10",
    userBuilt: true,
    history: [{ kind: "decisions", key: "thresholdApproved" }],
    in: ["demo", "incident", "cantSee"],
  },
  {
    id: "L-302",
    loop: "calibration",
    actionClass: "EnableDeduplication",
    target: "Alerts 'checkout latency *' (3 alerts)",
    state: "kept",
    confidence: 89,
    evidence:
      "The 3 alerts fired together 94% of the time in 30 days, so one slowdown paged 3 times.",
    before: "dedup: off",
    after: "dedup:\n  window: 15m\n  fields: [service.name]",
    day: "monday",
    time: "08:30",
    note: "Kept — checks passed at the end of the review window",
    history: [{ kind: "changes", key: "latencyGrouped" }],
    in: ["demo", "incident", "allClear", "cantSee"],
  },
  {
    id: "L-303",
    loop: "calibration",
    actionClass: "RaiseThreshold",
    target: "Alert 'disk 80%' on ingest-1",
    state: "approved",
    confidence: 85,
    evidence:
      "Fired 29 times in 30 days; none acknowledged or acted on. Peak 84% during nightly compaction, back to about 70% by 07:00. Largest daily net growth in 30 days: 2 points, so from 90% it would take more than 4 days to fill. The fill-forecast check (full within 24 h) stays on.",
    before: "condition: disk_used_percent > 80",
    after: "condition: disk_used_percent > 90",
    day: "monday",
    userBuilt: true,
    history: [{ kind: "decisions", key: "diskApproved" }],
    in: ["demo", "incident", "allClear", "cantSee"],
  },
  {
    id: "L-305",
    loop: "action",
    actionClass: "ScaleQueueWorkers",
    target: "orders-consumer workers",
    state: "auto_applied",
    confidence: 80,
    evidence:
      "Queue depth about 2,000 and rising; consumers at a third of their usual rate. Standing permission since 12 Sep (cap 8).",
    before: "orders-consumer: 4 workers",
    after: "orders-consumer: 4 → 8 workers\nscale back: if drain rate doesn't improve in 3m",
    day: "oct2",
    time: "21:33",
    note: "Didn't help: drain rate unchanged. Scaled back to 4 and paged on-call at 21:36. Added pre-check: skip when database latency is the bottleneck.",
    history: [{ kind: "fixes", key: "queueFixed", worked: false }],
    in: ["demo"],
  },
  {
    id: "L-306",
    loop: "action",
    actionClass: "RaiseAutonomy",
    target: "Action class ScaleQueueWorkers",
    state: "approved",
    confidence: 94,
    evidence:
      "Added orders workers 7 times on approval during traffic bursts; the backlog cleared each time.",
    before: "ScaleQueueWorkers: suggest",
    after:
      "ScaleQueueWorkers: auto   # cap 8 workers; scale back if the drain rate doesn't improve in 3m; report each",
    day: "sep12",
    history: [{ kind: "decisions", key: "queuePermission" }],
    in: ["demo"],
  },
  {
    id: "L-312",
    loop: "coverage",
    actionClass: "CreateDetector",
    target: `${NEW_CUSTOMER.length} services · requests, errors, latency`,
    state: "auto_applied",
    confidence: 91,
    evidence: `${NEW_CUSTOMER.length} services found across ${streamsFor(
      "noBaseline",
      servicesFor("noBaseline"),
    )
      .map((st) => st.name)
      .join(", ")} in the first scan.`,
    before: "# not watched",
    after: `detectors: ${NEW_CUSTOMER.length} services × {requests, errors, latency}\nmethod: anomaly (learning)\nguardrails: error-ratio ceiling, freshness`,
    day: "thursday",
    time: "09:02",
    reviewWindow: "until each baseline is ready",
    history: [{ kind: "changes", key: "found18" }],
    in: ["noBaseline"],
  },
];

export const EVENTS: EventFact[] = [
  {
    id: "checkoutNowPaged",
    day: "today",
    time: "10:44",
    kind: "problems",
    key: "checkoutNowPaged",
    in: [],
  },
  { id: "searchPaged", day: "today", time: "10:29", kind: "problems", key: "searchPaged", in: [] },
  {
    id: "euStopped",
    day: "today",
    time: STALLED.since,
    kind: "problems",
    key: "euStopped",
    in: ["cantSee"],
  },
  {
    id: "fridaySummary",
    day: "friday",
    time: "09:00",
    kind: "problems",
    key: "fridaySummary",
    in: [],
  },
  {
    id: "gatewayPaged",
    day: "thursday",
    time: "15:24",
    kind: "problems",
    key: "gatewayPaged",
    in: [],
  },
  {
    id: "connected",
    day: "thursday",
    time: "08:55",
    kind: "decisions",
    key: "connected",
    in: ["noBaseline"],
  },
  { id: "emailHeld", day: "thursday", time: "03:16", kind: "problems", key: "emailHeld", in: [] },
  {
    id: "checkoutPaged",
    day: "tuesday",
    time: "14:04",
    kind: "problems",
    key: "checkoutPaged",
    in: [],
  },
  { id: "recsHeld", day: "monday", time: "16:41", kind: "problems", key: "recsHeld", in: [] },
  { id: "loginPaged", day: "sep30", time: "10:14", kind: "problems", key: "loginPaged", in: [] },
];

// Events about a problem appear in exactly the scenarios whose month includes that problem.
export const EVENT_PROBLEM: Record<string, string> = {
  checkoutNowPaged: "checkoutNow",
  searchPaged: "search",
  gatewayPaged: "gateway",
  emailHeld: "email",
  checkoutPaged: "checkout",
  recsHeld: "recs",
  loginPaged: "login",
};

// The fix's recovery is only measured once the viewer's approved fix is done.
export const chartPoints = (chart: ChartFact, fixed: boolean) =>
  fixed && chart.recovery ? [...chart.points, ...chart.recovery] : chart.points;

export const scenarioFacts = (scenario: Scenario): ScenarioFact => {
  const services = servicesFor(scenario);
  return { ...SCENARIO_BASE[scenario], services, streams: streamsFor(scenario, services) };
};

export const problemsIn = (scenario: Scenario, period: Period): ProblemFact[] =>
  SCENARIO_BASE[scenario].periods[period].problems.map((id) => PROBLEMS[id]);

export const periodStats = (scenario: Scenario, period: Period) => {
  const problems = problemsIn(scenario, period);
  return {
    problems: problems.length,
    pages: problems.filter((p) => p.pagedAt).length,
    asks: problems.filter((p) => p.askedAt && !p.pagedAt).length,
    fixed: problems.filter((p) => p.outcome === "fixed").length,
    failedFixes: problems.filter((p) => p.fix && !p.fix.worked).length,
    held: problems.filter((p) => p.outcome === "held").length,
    oldAlertPages: SCENARIO_BASE[scenario].periods[period].oldAlertPages,
  };
};

export const serviceStats = (scenario: Scenario) => {
  const services = servicesFor(scenario);
  const count = (state: ServiceState) => services.filter((s) => s.state === state).length;
  return {
    total: services.length,
    watching: count("watching"),
    learning: count("learning"),
    cantSee: count("cantSee"),
    unseen: count("cantSee"),
    foundToday: services.filter((svc) => svc.foundToday).length,
  };
};

export const pagesTo = (scenario: Scenario, destination: string) =>
  problemsIn(scenario, "week").filter((p) => p.pagedAt && p.destination === destination).length;

export const asksTo = (scenario: Scenario, destination: string) =>
  problemsIn(scenario, "week").filter(
    (p) => p.askedAt && !p.pagedAt && p.destination === destination,
  ).length;

export const heldBeforeFriday = (scenario: Scenario) =>
  problemsIn(scenario, "week").filter(
    (p) => p.outcome === "held" && DAY_DATE[p.day] < DAY_DATE.friday,
  ).length;

export const groupedFirings = (problem: ProblemFact) =>
  problem.firings.reduce((n, f) => n + f.count, 0);

// Investigation only yields a band; the stored numbers just place each item in one.
export const confidenceBand = (confidence: number): ConfidenceBand =>
  confidence >= 85 ? "high" : confidence >= 70 ? "medium" : "low";

export const ledgerIn = (scenario: Scenario) => LEDGER.filter((e) => e.in.includes(scenario));

export const eventScenarios = (event: EventFact): Scenario[] => {
  const problem = EVENT_PROBLEM[event.id];
  if (event.id === "fridaySummary") return SCENARIOS.filter((s) => heldBeforeFriday(s) > 0);
  if (!problem) return event.in;
  return SCENARIOS.filter((s) => SCENARIO_BASE[s].periods.month.problems.includes(problem));
};

export const daysBefore = (day: DayKey) => {
  const [y, m, d] = DEMO_DATE;
  const today = Date.UTC(y, m, d);
  const [yy, mm, dd] = DAY_DATE[day].split("-").map(Number);
  return Math.round((today - Date.UTC(yy, mm - 1, dd)) / 86400000);
};

export const MACHINE_EXAMPLE = "checkout";
export const MACHINE_ALERT = {
  name: "payments-api-db-pool",
  dbLimit: 200,
  ledgerId: "L-307",
};
