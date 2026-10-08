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

import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

export type Scenario = "quiet" | "incident";
export type Severity = "p1" | "p2" | "p3" | "p4";
export type IssueStatus = "open" | "acknowledged" | "resolved";
export type Loop = "coverage" | "calibration" | "investigation";
export type LedgerStatus =
  "auto_applied" | "kept" | "awaiting" | "approved" | "rejected" | "rolled_back";
export type PolicyMode = "off" | "suggest" | "auto";
export type CellState = "watched" | "learning" | "gap" | "na";
export type Signal =
  "requests" | "errors" | "latency" | "saturation" | "logPatterns" | "dependencies";

export interface Evidence {
  kind: "log" | "trace" | "metric";
  title: I18nText;
  detail: I18nText;
  count?: I18nText;
  points?: number[];
}

export interface TimelineEntry {
  at: string;
  title: I18nText;
  detail: I18nText;
  variant: "primary" | "success" | "destructive" | "info" | "muted";
}

export interface ThreadMessage {
  at: string;
  lines: I18nText[];
  fields?: { label: I18nText; value: I18nText }[];
}

// sampleTimes are the wall-clock times of the firings shown in Alert Triggers; daysAgo counts back from the pinned demo day.
export interface Firing {
  detector: string;
  service: string;
  count: number;
  daysAgo: number;
  sampleTimes: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "service_dependency" | "temporal";
}

export interface Issue {
  id: string;
  title: I18nText;
  severity: Severity;
  services: string[];
  started: I18nText;
  status: IssueStatus;
  cause: I18nText;
  deferred?: boolean;
  summary: I18nText;
  likelyCause: I18nText;
  confidence: number;
  nextStep: I18nText;
  evidence: Evidence[];
  upstream: string[];
  downstream: string[];
  timeline: TimelineEntry[];
  firings: Firing[];
  edges: GraphEdge[];
  channel: I18nText;
  thread: ThreadMessage[];
  proposal?: { ledgerId: string; title: string; detail: string };
  facts?: {
    deployService: string;
    version: string;
    pods: number;
    alert: string;
    thresholdFrom: number;
    thresholdTo: number;
  };
}

export interface LedgerEntry {
  id: string;
  loop: Loop;
  actionClass: string;
  target: I18nText;
  status: LedgerStatus;
  confidence: number;
  evidence: I18nText;
  before: string;
  after: string;
  when: I18nText;
  reviewWindow?: I18nText;
  note?: I18nText;
  userBuilt?: boolean;
}

export interface CoverageCell {
  state: CellState;
  alsoWatchedBy?: { detector: string; library: string; ledgerId: string }[];
  detector?: string;
  method?: "anomaly" | "threshold";
  library?: string;
  predicate?: string;
  stream?: string;
  progress?: [number, number];
  reason?: I18nText;
}

export interface CoverageRow {
  service: string;
  lastScanned: I18nText;
  cells: Record<Signal, CoverageCell>;
}

export interface StreamScan {
  stream: string;
  lastScanned: I18nText | null;
  services: number;
}

export interface PlanItem {
  service: string;
  signal: Signal;
  library: string;
  // Plan items backed by a ledger entry take their state from it, so approving or undoing updates the plan.
  ledgerId?: string;
  reason: I18nText;
}

export interface Budget {
  id: string;
  destination: I18nText;
  kind: "slack" | "pagerduty" | "email";
  limit: number;
  used: Record<Scenario, number>;
  digest: boolean;
}

export interface ActionClassPolicy {
  id: string;
  mode: PolicyMode;
  group: "coverage" | "calibration" | "action";
}

export const SIGNALS: Signal[] = [
  "requests",
  "errors",
  "latency",
  "saturation",
  "logPatterns",
  "dependencies",
];

export const SERVICES_TOTAL = 50;
export const SERVICES_LEARNING = 2;
export const DETECTOR_CEILING = 200;
export const DEMO_DATE: [number, number, number] = [2026, 9, 7];

// exemptDeliveries are P1 pages, which never count against a destination budget.
export const FUNNEL: Record<
  Scenario,
  { firings: number; incidents: number; exemptDeliveries: number; heldForDigest: number }
> = {
  quiet: { firings: 1284, incidents: 3, exemptDeliveries: 0, heldForDigest: 0 },
  incident: { firings: 4612, incidents: 23, exemptDeliveries: 2, heldForDigest: 4 },
};

const PAYMENTS_INCIDENT: Issue = {
  id: "INC-1042",
  title: raw("Checkout payments failing: postgres-primary connection pool exhausted"),
  severity: "p1",
  services: ["payments", "postgres-primary", "checkout", "frontend"],
  started: raw("14 min ago"),
  status: "open",
  cause: raw(
    "Deploy payments v2.14.0 doubled connections per pod; the 100-connection pool ran out at 09:12.",
  ),
  summary: raw(
    "Since 09:12, 38% of payment authorisations fail with a connection-acquire timeout. Checkout surfaces these as 502s and frontend shows a payment error to shoppers. The failures began 6 minutes after payments v2.14.0 rolled out and are confined to the new pods.",
  ),
  likelyCause: raw(
    "payments v2.14.0 raised the per-pod pool size from 10 to 20 (PR #4812). With 6 pods that asks for 120 connections; postgres-primary allows 100, so new requests wait for a connection and time out after 5s.",
  ),
  confidence: 91,
  facts: {
    deployService: "payments",
    version: "v2.14.0",
    pods: 6,
    alert: "postgres-primary-connections",
    thresholdFrom: 95,
    thresholdTo: 85,
  },
  nextStep: raw(
    "Roll back payments to v2.13.2, or set the pool to 15 per pod so 6 pods stay under 100 connections.",
  ),
  evidence: [
    {
      kind: "log",
      title: raw("Log pattern in payments"),
      detail: raw("HikariPool-1 - Connection is not available, request timed out after <*>ms"),
      count: raw("18,402 in 14 min (new pattern)"),
    },
    {
      kind: "trace",
      title: raw("Slow span in payments"),
      detail: raw("POST /v1/authorize → pg.connect: p95 5,004 ms (baseline 3 ms)"),
      count: raw("2,911 traces"),
    },
    {
      kind: "metric",
      title: raw("Metric deviation on postgres-primary"),
      detail: raw("pg_stat_activity active connections: 100 of 100 (baseline 41)"),
      points: [41, 40, 43, 42, 44, 41, 58, 79, 96, 100, 100, 100],
    },
  ],
  upstream: [],
  downstream: ["redis-cache"],
  timeline: [
    {
      at: "09:06",
      title: raw("Deploy payments v2.14.0"),
      detail: raw("Rolled out to 6 of 6 pods"),
      variant: "info",
    },
    {
      at: "09:07",
      title: raw("Connection pool above 85%"),
      detail: raw("No alert: postgres-primary-connections pages at 95%"),
      variant: "muted",
    },
    {
      at: "09:11",
      title: raw("Detector fired"),
      detail: raw("postgres-primary-connections crossed 95%: first firing"),
      variant: "destructive",
    },
    {
      at: "09:12",
      title: raw("Incident opened, P1 paged"),
      detail: raw("Paged immediately; P1 skips the investigation gate and the budget"),
      variant: "destructive",
    },
    {
      at: "09:15",
      title: raw("Investigation landed"),
      detail: raw("Cause posted to the same thread, confidence 91%"),
      variant: "primary",
    },
    {
      at: "09:17",
      title: raw("Firings grouped into this incident"),
      detail: raw("214 firings from postgres-primary, payments, checkout and frontend"),
      variant: "muted",
    },
  ],
  firings: [
    {
      detector: "postgres-primary-connections",
      service: "postgres-primary",
      count: 38,
      daysAgo: 0,
      sampleTimes: ["09:11", "09:12", "09:13", "09:14"],
    },
    {
      detector: "payments-latency",
      service: "payments",
      count: 61,
      daysAgo: 0,
      sampleTimes: ["09:12", "09:13", "09:14", "09:15"],
    },
    {
      detector: "payments-errors",
      service: "payments",
      count: 74,
      daysAgo: 0,
      sampleTimes: ["09:12", "09:13", "09:14", "09:15"],
    },
    {
      detector: "payments-log-patterns",
      service: "payments",
      count: 12,
      daysAgo: 0,
      sampleTimes: ["09:13", "09:14", "09:15", "09:16"],
    },
    {
      detector: "checkout-errors",
      service: "checkout",
      count: 22,
      daysAgo: 0,
      sampleTimes: ["09:13", "09:14", "09:15", "09:16"],
    },
    {
      detector: "frontend-errors",
      service: "frontend",
      count: 7,
      daysAgo: 0,
      sampleTimes: ["09:14", "09:15", "09:16", "09:17"],
    },
  ],
  edges: [
    { from: "frontend-errors", to: "checkout-errors", kind: "service_dependency" },
    { from: "checkout-errors", to: "payments-errors", kind: "service_dependency" },
    { from: "payments-errors", to: "postgres-primary-connections", kind: "service_dependency" },
    { from: "payments-latency", to: "postgres-primary-connections", kind: "service_dependency" },
    { from: "postgres-primary-connections", to: "payments-latency", kind: "temporal" },
    { from: "payments-latency", to: "payments-errors", kind: "temporal" },
    { from: "payments-errors", to: "checkout-errors", kind: "temporal" },
    { from: "checkout-errors", to: "frontend-errors", kind: "temporal" },
    { from: "payments-errors", to: "payments-log-patterns", kind: "temporal" },
  ],
  channel: raw("#oncall-payments"),
  thread: [
    {
      at: "09:12",
      lines: [
        raw("P1 · Checkout payments failing"),
        raw("38% of payment authorisations are failing. Checkout is returning 502s."),
        raw("Investigation running — cause will follow in this thread."),
      ],
      fields: [
        { label: raw("Services"), value: raw("payments, postgres-primary, checkout, frontend") },
        { label: raw("Started"), value: raw("09:12") },
      ],
    },
    {
      at: "09:15",
      lines: [
        raw(
          "Likely cause (91% confidence): payments v2.14.0, deployed 09:06, raised the pool to 20 per pod. 6 pods × 20 = 120 connections against a 100-connection limit on postgres-primary.",
        ),
        raw(
          "Evidence: new log pattern 'Connection is not available' (18k), pg.connect p95 5s, postgres-primary at 100/100 connections.",
        ),
        raw("Suggested next step: roll back payments to v2.13.2 or set the pool to 15 per pod."),
      ],
    },
  ],
  proposal: {
    ledgerId: "L-311",
    title: raw("Lower the postgres-primary-connections threshold from 95% to 85%"),
    detail: raw(
      "The alert fired at 09:11 at 95%. At 85% it would have paged at 09:07, before the first checkout error.",
    ),
  },
};

const RECS_INCIDENT: Issue = {
  id: "INC-1043",
  title: raw("Recommendation consumer lag growing on the orders topic"),
  severity: "p3",
  services: ["recommendation", "kafka"],
  started: raw("52 min ago"),
  status: "acknowledged",
  cause: raw(
    "Consumer pods are OOM-killed after the memory limit was cut to 512Mi; the group rebalances every ~40s.",
  ),
  summary: raw(
    "Consumer lag on orders.recommendation has grown from 0 to 184k messages since 08:34. Recommendations shown on the product page are now about 20 minutes stale. No customer-facing errors.",
  ),
  likelyCause: raw(
    "A config change at 08:20 lowered the recommendation memory limit from 1Gi to 512Mi. Pods exceed it while loading the model and are OOM-killed, so the consumer group rebalances continuously and makes little progress.",
  ),
  confidence: 84,
  nextStep: raw(
    "Restore the recommendation memory limit to 1Gi; the backlog drains in about 15 minutes.",
  ),
  evidence: [
    {
      kind: "log",
      title: raw("Log pattern in recommendation"),
      detail: raw("Revoking previously assigned partitions [orders-<*>] for group recommendation"),
      count: raw("412 since 08:34"),
    },
    {
      kind: "trace",
      title: raw("Slow span in recommendation"),
      detail: raw("kafka.poll → model.score: p95 3,850 ms (baseline 210 ms)"),
      count: raw("640 traces"),
    },
    {
      kind: "metric",
      title: raw("Metric deviation on kafka"),
      detail: raw("consumer_group_lag{group=recommendation}: 184k (baseline under 200)"),
      points: [120, 90, 150, 110, 2400, 9800, 31000, 62000, 98000, 131000, 160000, 184000],
    },
  ],
  upstream: ["frontend"],
  downstream: ["redis-cache"],
  timeline: [
    {
      at: "08:20",
      title: raw("Config change"),
      detail: raw("recommendation memory limit 1Gi → 512Mi"),
      variant: "info",
    },
    {
      at: "08:34",
      title: raw("Detectors fired"),
      detail: raw("kafka consumer lag first, then recommendation log patterns: 46 grouped firings"),
      variant: "destructive",
    },
    {
      at: "08:36",
      title: raw("Investigation landed, notification sent"),
      detail: raw("P3 waits for the cause before notifying"),
      variant: "primary",
    },
    {
      at: "08:49",
      title: raw("Acknowledged"),
      detail: raw("marco@acme.io from the email"),
      variant: "muted",
    },
  ],
  firings: [
    {
      detector: "kafka-consumer-lag",
      service: "kafka",
      count: 37,
      daysAgo: 0,
      sampleTimes: ["08:34", "08:35", "08:36", "08:37"],
    },
    {
      detector: "recommendation-log-patterns",
      service: "recommendation",
      count: 9,
      daysAgo: 0,
      sampleTimes: ["08:35", "08:36", "08:37", "08:38"],
    },
  ],
  edges: [
    { from: "recommendation-log-patterns", to: "kafka-consumer-lag", kind: "service_dependency" },
    { from: "kafka-consumer-lag", to: "recommendation-log-patterns", kind: "temporal" },
  ],
  channel: raw("platform-team@acme.io"),
  thread: [
    {
      at: "08:36",
      lines: [
        raw("P3 · Recommendation consumer lag growing on orders"),
        raw(
          "Likely cause (84% confidence): recommendation pods are OOM-killed since the memory limit dropped to 512Mi at 08:20. The consumer group rebalances every ~40s.",
        ),
        raw("Impact: recommendations about 20 minutes stale. No errors shown to customers."),
      ],
      fields: [
        { label: raw("Services"), value: raw("recommendation, kafka") },
        { label: raw("Started"), value: raw("08:34") },
      ],
    },
  ],
};

const WEBHOOK_DEFERRED: Issue = {
  id: "INC-1044",
  title: raw("Payments webhook retry queue growing slowly"),
  severity: "p4",
  services: ["payments"],
  started: raw("1 h ago"),
  status: "open",
  deferred: true,
  cause: raw("A partner endpoint returns 503 for 2% of webhook calls; retries are succeeding."),
  summary: raw(
    "The webhook retry queue grew from 40 to 310 items since 08:26. All retries eventually succeed; median delivery delay rose from 1s to 9s.",
  ),
  likelyCause: raw(
    "partner-hooks.example.net returns 503 for about 2% of calls since 08:20. Not caused by any change on our side.",
  ),
  confidence: 78,
  nextStep: raw("No action needed tonight. Raise it with the partner if the 503 rate holds."),
  evidence: [
    {
      kind: "log",
      title: raw("Log pattern in payments"),
      detail: raw("webhook delivery failed status=503 attempt=<*> — scheduling retry"),
      count: raw("1,140 since 08:20"),
    },
    {
      kind: "metric",
      title: raw("Metric deviation on payments"),
      detail: raw("webhook_retry_queue_depth: 310 (baseline 40)"),
      points: [40, 42, 39, 55, 80, 110, 140, 170, 210, 240, 280, 310],
    },
  ],
  upstream: [],
  downstream: ["kafka"],
  timeline: [
    {
      at: "08:26",
      title: raw("Detector fired"),
      detail: raw("payments saturation (retry queue)"),
      variant: "info",
    },
    {
      at: "08:27",
      title: raw("Held for digest"),
      detail: raw("#oncall-payments weekly budget spent (10/10); P4 goes to tonight's digest"),
      variant: "muted",
    },
  ],
  firings: [
    {
      detector: "payments-retry-queue",
      service: "payments",
      count: 6,
      daysAgo: 0,
      sampleTimes: ["08:26", "08:27", "08:28", "08:29"],
    },
  ],
  edges: [],
  channel: raw("#oncall-payments"),
  thread: [],
};

const RESOLVED: Issue[] = [
  {
    id: "INC-1038",
    title: raw("Login latency p95 at 1.9s"),
    severity: "p2",
    services: ["auth", "redis-cache"],
    started: raw("Yesterday 16:40"),
    status: "resolved",
    cause: raw(
      "redis-cache hit maxmemory and evicted session keys; fixed by switching the eviction policy.",
    ),
    summary: raw(
      "Login p95 rose from 180ms to 1.9s for 26 minutes. Sessions were re-read from postgres-primary after redis-cache evicted them.",
    ),
    likelyCause: raw(
      "redis-cache reached maxmemory at 16:38 with policy allkeys-random, evicting hot session keys. Resolved at 17:06 by switching to volatile-lru.",
    ),
    confidence: 88,
    nextStep: raw("Keep volatile-lru and size redis-cache for peak session count plus 30%."),
    evidence: [
      {
        kind: "metric",
        title: raw("Metric deviation on redis-cache"),
        detail: raw("evicted_keys/s: 2,300 (baseline 0)"),
        points: [0, 0, 0, 10, 900, 2300, 2100, 1800, 400, 20, 0, 0],
      },
      {
        kind: "trace",
        title: raw("Slow span in auth"),
        detail: raw("POST /login → session.load: p95 1,720 ms (baseline 4 ms)"),
        count: raw("1,204 traces"),
      },
    ],
    upstream: ["frontend"],
    downstream: ["postgres-primary"],
    timeline: [
      {
        at: "16:38",
        title: raw("Detectors fired"),
        detail: raw("redis-cache memory, auth latency"),
        variant: "destructive",
      },
      {
        at: "16:43",
        title: raw("Notified with cause"),
        detail: raw("platform-team@acme.io"),
        variant: "primary",
      },
      {
        at: "17:06",
        title: raw("Resolved"),
        detail: raw("Eviction policy changed"),
        variant: "success",
      },
    ],
    firings: [
      {
        detector: "redis-cache-memory",
        service: "redis-cache",
        count: 14,
        daysAgo: 1,
        sampleTimes: ["16:38", "16:39", "16:40", "16:41"],
      },
      {
        detector: "auth-latency",
        service: "auth",
        count: 31,
        daysAgo: 1,
        sampleTimes: ["16:40", "16:41", "16:42", "16:43"],
      },
    ],
    edges: [
      { from: "auth-latency", to: "redis-cache-memory", kind: "service_dependency" },
      { from: "redis-cache-memory", to: "auth-latency", kind: "temporal" },
    ],
    channel: raw("platform-team@acme.io"),
    thread: [
      {
        at: "16:43",
        lines: [
          raw("P2 · Login latency p95 at 1.9s"),
          raw(
            "Likely cause (88% confidence): redis-cache reached maxmemory and is evicting session keys; auth falls back to postgres-primary.",
          ),
        ],
        fields: [{ label: raw("Services"), value: raw("auth, redis-cache") }],
      },
    ],
  },
  {
    id: "INC-1035",
    title: raw("Search 5xx spike during index rebuild"),
    severity: "p3",
    services: ["search"],
    started: raw("Mon 03:10"),
    status: "resolved",
    cause: raw("Nightly full reindex ran on the serving replicas instead of the standby."),
    summary: raw(
      "Search returned 5xx for 4.2% of queries for 18 minutes during the nightly reindex.",
    ),
    likelyCause: raw(
      "The reindex job was scheduled against the serving replicas after a config rename. Moved back to the standby the same morning.",
    ),
    confidence: 80,
    nextStep: raw("Pin the reindex job to the standby replica set."),
    evidence: [
      {
        kind: "metric",
        title: raw("Metric deviation on search"),
        detail: raw("http 5xx rate: 4.2% (baseline 0.05%)"),
        points: [0, 0, 0, 1, 3, 4, 4, 3, 1, 0, 0, 0],
      },
    ],
    upstream: ["frontend"],
    downstream: [],
    timeline: [
      {
        at: "03:10",
        title: raw("Detector fired"),
        detail: raw("search errors"),
        variant: "destructive",
      },
      {
        at: "03:13",
        title: raw("Notified with cause"),
        detail: raw("platform-team@acme.io"),
        variant: "primary",
      },
      { at: "03:28", title: raw("Resolved"), detail: raw("Reindex finished"), variant: "success" },
    ],
    firings: [
      {
        detector: "search-errors",
        service: "search",
        count: 19,
        daysAgo: 2,
        sampleTimes: ["03:10", "03:11", "03:12", "03:13"],
      },
    ],
    edges: [],
    channel: raw("platform-team@acme.io"),
    thread: [
      {
        at: "03:13",
        lines: [
          raw("P3 · Search 5xx spike during index rebuild"),
          raw(
            "Likely cause (80% confidence): the nightly reindex is running on the serving replicas.",
          ),
        ],
      },
    ],
  },
  {
    id: "INC-1031",
    title: raw("Email-worker rate-limited by the SMTP relay"),
    severity: "p3",
    services: ["email-worker"],
    started: raw("Sun 22:05"),
    status: "resolved",
    cause: raw(
      "Weekly newsletter burst exceeded the relay's 50 msg/s limit; 429s cleared once the batch drained.",
    ),
    summary: raw("Transactional emails were delayed up to 11 minutes behind the newsletter batch."),
    likelyCause: raw(
      "The newsletter and transactional mail share one relay credential. The relay throttled both at 50 msg/s.",
    ),
    confidence: 86,
    nextStep: raw("Give transactional mail its own relay credential."),
    evidence: [
      {
        kind: "log",
        title: raw("Log pattern in email-worker"),
        detail: raw("SMTP 421 4.7.0 Try again later, closing connection"),
        count: raw("6,880 in 40 min"),
      },
    ],
    upstream: ["checkout", "auth"],
    downstream: [],
    timeline: [
      {
        at: "22:05",
        title: raw("Guardrail fired"),
        detail: raw("email-worker error-ratio ceiling (guardrail while learning)"),
        variant: "destructive",
      },
      {
        at: "22:08",
        title: raw("Notified with cause"),
        detail: raw("platform-team@acme.io"),
        variant: "primary",
      },
      { at: "22:45", title: raw("Resolved"), detail: raw("Batch drained"), variant: "success" },
    ],
    firings: [
      {
        detector: "email-worker-error-ratio-ceiling",
        service: "email-worker",
        count: 26,
        daysAgo: 3,
        sampleTimes: ["22:05", "22:06", "22:07", "22:08"],
      },
    ],
    edges: [],
    channel: raw("platform-team@acme.io"),
    thread: [
      {
        at: "22:08",
        lines: [
          raw("P3 · Email-worker rate-limited by the SMTP relay"),
          raw(
            "Likely cause (86% confidence): the weekly newsletter burst is throttling transactional mail on the shared relay credential.",
          ),
        ],
      },
    ],
  },
];

export const issuesFor = (scenario: Scenario): Issue[] =>
  scenario === "incident"
    ? [PAYMENTS_INCIDENT, RECS_INCIDENT, WEBHOOK_DEFERRED, ...RESOLVED]
    : [...RESOLVED];

const BASE_LEDGER: LedgerEntry[] = [
  {
    id: "L-301",
    loop: "coverage",
    actionClass: "CreateDetector",
    target: raw("email-worker · Requests"),
    status: "kept",
    confidence: 92,
    evidence: raw(
      "New service discovered in otel_traces 4 days ago; matched library entry http-service/requests.",
    ),
    before: "# no detector",
    after:
      "detector: email-worker-requests\nsignal: requests\nmethod: anomaly (weekday/weekend × hour baseline)\nsource: library/http-service/requests",
    when: raw("4 days ago"),
    note: raw("Kept — checks passed at the end of the 3-day review window"),
  },
  {
    id: "L-302",
    loop: "calibration",
    actionClass: "EnableDeduplication",
    target: raw("Detector payments-errors (created by AutoObserve)"),
    status: "auto_applied",
    confidence: 88,
    evidence: raw(
      "Fired 212 times in 30 days, 0 acknowledged; 94% within 5 min of a previous firing.",
    ),
    before: "dedup: off",
    after: "dedup:\n  window: 15m\n  fields: [service.name, http.route]",
    when: raw("2 days ago"),
    reviewWindow: raw("1 more day"),
  },
  {
    id: "L-303",
    loop: "calibration",
    actionClass: "RepairDestination",
    target: raw("Destination #oncall-search (Slack)"),
    status: "auto_applied",
    confidence: 97,
    evidence: raw(
      "Slack returned channel_not_found 18 times since Tue; the channel was renamed to #search-oncall.",
    ),
    before: "channel: #oncall-search",
    after: "channel: #search-oncall",
    when: raw("Yesterday"),
    reviewWindow: raw("2 more days"),
  },
  {
    id: "L-304",
    loop: "calibration",
    actionClass: "RaiseThreshold",
    target: raw("Alert 'Cart p95 latency above 400ms'"),
    status: "awaiting",
    confidence: 81,
    evidence: raw("Fired 64 times in 30 days, 2 acknowledged; healthy-day p95 peaks at 520ms."),
    before: "condition: p95(duration) > 400ms",
    after: "condition: p95(duration) > 650ms",
    when: raw("Yesterday"),
  },
  {
    id: "L-305",
    loop: "calibration",
    actionClass: "LengthenEvaluationWindow",
    target: raw("Alert 'Inventory CPU above 80%'"),
    status: "awaiting",
    confidence: 76,
    evidence: raw("Fired 131 times in 30 days, 0 acknowledged; 88% cleared within 2 minutes."),
    before: "period: 1m\nfrequency: 1m",
    after: "period: 10m\nfrequency: 1m",
    when: raw("Yesterday"),
  },
  {
    id: "L-306",
    loop: "calibration",
    actionClass: "ReviewForDeletion",
    target: raw("Alert 'Legacy frontend 404 count'"),
    status: "awaiting",
    confidence: 90,
    evidence: raw(
      "Fired 212 times in 30 days, 0 acknowledged; fully covered by the frontend errors detector.",
    ),
    before: "enabled: true",
    after: "enabled: false   # retire after your review",
    when: raw("3 days ago"),
  },
  {
    id: "L-307",
    loop: "calibration",
    actionClass: "MoveToIncidentDelivery",
    target: raw("Alert 'High 5xx on checkout'"),
    status: "awaiting",
    confidence: 84,
    evidence: raw(
      "Route 'High 5xx on checkout' through incidents instead of its own Slack route — avoids duplicate pages. Paged alongside an incident 9 of 11 times in 30 days.",
    ),
    before: "destinations: [slack-checkout-alerts]\nincident_grouping: off",
    after: "destinations: []   # delivered by its incident\nincident_grouping: on",
    when: raw("Today"),
    userBuilt: true,
  },
  {
    id: "L-308",
    loop: "calibration",
    actionClass: "AttachDestination",
    target: raw("Detector redis-cache-memory"),
    status: "rejected",
    confidence: 70,
    evidence: raw("Detector has fired 3 times with no destination attached."),
    before: "destinations: []",
    after: "destinations: [slack-oncall-payments]",
    when: raw("2 days ago"),
    note: raw("Rejected by priya@acme.io — goes through the platform digest instead"),
  },
  {
    id: "L-309",
    loop: "calibration",
    actionClass: "EnableDeduplication",
    target: raw("Detector search-errors (created by AutoObserve)"),
    status: "rolled_back",
    confidence: 74,
    evidence: raw("Fired 48 times in 30 days, 1 acknowledged."),
    before: "dedup: off",
    after: "dedup:\n  window: 30m\n  fields: [service.name]",
    when: raw("3 days ago"),
    note: raw("Undone by marco@acme.io — prior state restored from snapshot"),
  },
  {
    id: "L-310",
    loop: "coverage",
    actionClass: "AddLibraryAlert",
    target: raw("postgres-primary · Replication lag"),
    status: "auto_applied",
    confidence: 68,
    evidence: raw(
      "Library entry postgres/replication-lag applies; a replica was found in otel_metrics.",
    ),
    before: "# no alert",
    after: "alert: postgres-replication-lag\ncondition: lag_seconds > 30 for 5m",
    when: raw("Yesterday"),
    reviewWindow: raw("2 more days"),
  },
];

const INCIDENT_LEDGER: LedgerEntry[] = [
  {
    id: "L-313",
    loop: "calibration",
    actionClass: "MoveToIncidentDelivery",
    target: raw("Alerts 'Payments webhook retry *' (3 alerts)"),
    status: "awaiting",
    confidence: 82,
    evidence: raw(
      "Destination over budget — proposing to group payments retry alerts into one incident. #oncall-payments is at 10/10 this week; 6 of the 10 notifications came from these 3 alerts firing together.",
    ),
    before: "destinations: [slack-oncall-payments]\nincident_grouping: off",
    after: "destinations: []   # delivered by one incident\nincident_grouping: on",
    when: raw("1 h ago"),
    userBuilt: true,
  },
  {
    id: "L-311",
    loop: "investigation",
    actionClass: "LowerThreshold",
    target: raw("Alert 'postgres-primary-connections'"),
    status: "awaiting",
    confidence: 87,
    evidence: raw(
      "Fired at 09:11 at 95%. Pool usage crossed 85% at 09:07, five minutes before the first checkout error in INC-1042.",
    ),
    before: "condition: active / max_connections > 0.95 for 1m",
    after: "condition: active / max_connections > 0.85 for 1m",
    when: raw("11 min ago"),
  },
  {
    id: "L-312",
    loop: "investigation",
    actionClass: "FixAlertQuery",
    target: raw("Alert 'Recommendation consumer lag'"),
    status: "awaiting",
    confidence: 79,
    evidence: raw(
      "The alert filters on group='recs' but the consumer group is named 'recommendation'; it never fired during INC-1043.",
    ),
    before: "WHERE consumer_group = 'recs'",
    after: "WHERE consumer_group = 'recommendation'",
    when: raw("40 min ago"),
  },
];

export const ledgerFor = (scenario: Scenario): LedgerEntry[] =>
  (scenario === "incident" ? [...INCIDENT_LEDGER, ...BASE_LEDGER] : BASE_LEDGER).map((e) => ({
    ...e,
  }));

const w = (
  detector: string,
  method: "anomaly" | "threshold",
  library: string,
  predicate: string,
  stream: string,
): CoverageCell => ({ state: "watched", detector, method, library, predicate, stream });
const learning = (
  detector: string,
  library: string,
  predicate: string,
  stream: string,
): CoverageCell => ({
  state: "learning",
  detector,
  method: "anomaly",
  library,
  predicate,
  stream,
  progress: [4, 7],
});
const gap = (reason: I18nText, library?: string, predicate?: string): CoverageCell => ({
  state: "gap",
  reason,
  library,
  predicate,
});
const na = (reason: I18nText): CoverageCell => ({ state: "na", reason });

const HTTP_REQ = "requires service.name + http.route";
const HTTP_ERR = "requires service.name + http.status_code";
const HTTP_LAT = "requires service.name + span duration";
const CPU = "requires k8s.pod.name + container CPU";
const LOGS = "requires service.name in logs";
const DEPS = "requires span.kind = client";
const CEILING = raw(`Org detector ceiling reached (${DETECTOR_CEILING} of ${DETECTOR_CEILING})`);

const httpService = (svc: string) => ({
  requests: w(`${svc}-requests`, "anomaly", "http-service/requests", HTTP_REQ, "otel_traces"),
  errors: w(`${svc}-errors`, "anomaly", "http-service/error-rate", HTTP_ERR, "otel_traces"),
  latency: w(`${svc}-latency`, "anomaly", "http-service/latency-p95", HTTP_LAT, "otel_traces"),
});
const logs = (svc: string) =>
  w(`${svc}-log-patterns`, "anomaly", "logs/new-pattern", LOGS, "default");
const deps = (svc: string) =>
  w(`${svc}-deps`, "anomaly", "dependencies/client-errors", DEPS, "otel_traces");
const cpu = (svc: string) => w(`${svc}-cpu`, "threshold", "k8s-workload/cpu", CPU, "otel_metrics");

export const COVERAGE: CoverageRow[] = [
  {
    service: "checkout",
    lastScanned: raw("4 min ago"),
    cells: {
      ...httpService("checkout"),
      saturation: cpu("checkout"),
      logPatterns: logs("checkout"),
      dependencies: deps("checkout"),
    },
  },
  {
    service: "payments",
    lastScanned: raw("4 min ago"),
    cells: {
      ...httpService("payments"),
      saturation: w(
        "payments-retry-queue",
        "anomaly",
        "queue/depth",
        "requires a *_queue_depth gauge",
        "otel_metrics",
      ),
      logPatterns: logs("payments"),
      dependencies: deps("payments"),
    },
  },
  {
    service: "cart",
    lastScanned: raw("4 min ago"),
    cells: {
      ...httpService("cart"),
      saturation: cpu("cart"),
      logPatterns: logs("cart"),
      dependencies: deps("cart"),
    },
  },
  {
    service: "frontend",
    lastScanned: raw("3 min ago"),
    cells: {
      ...httpService("frontend"),
      saturation: cpu("frontend"),
      logPatterns: logs("frontend"),
      dependencies: deps("frontend"),
    },
  },
  {
    service: "auth",
    lastScanned: raw("3 min ago"),
    cells: {
      ...httpService("auth"),
      saturation: cpu("auth"),
      logPatterns: logs("auth"),
      dependencies: deps("auth"),
    },
  },
  {
    service: "inventory",
    lastScanned: raw("6 min ago"),
    cells: {
      ...httpService("inventory"),
      errors: gap(
        raw("Spans carry no http.status_code — set it in the inventory instrumentation"),
        "http-service/error-rate",
        HTTP_ERR,
      ),
      saturation: cpu("inventory"),
      logPatterns: logs("inventory"),
      dependencies: deps("inventory"),
    },
  },
  {
    service: "postgres-primary",
    lastScanned: raw("9 min ago"),
    cells: {
      requests: w(
        "postgres-primary-tps",
        "anomaly",
        "postgres/transactions",
        "requires db.system = postgresql metrics",
        "otel_metrics",
      ),
      errors: w(
        "postgres-primary-errors",
        "anomaly",
        "postgres/errors",
        "requires severity in postgres logs",
        "postgres_logs",
      ),
      latency: w(
        "postgres-primary-query-latency",
        "anomaly",
        "postgres/query-latency",
        "requires db.system = postgresql spans",
        "otel_traces",
      ),
      saturation: {
        ...w(
          "postgres-primary-connections",
          "threshold",
          "postgres/connections",
          "requires pg_stat_activity_count + max_connections",
          "otel_metrics",
        ),
        alsoWatchedBy: [
          {
            detector: "postgres-replication-lag",
            library: "postgres/replication-lag",
            ledgerId: "L-310",
          },
        ],
      },
      logPatterns: logs("postgres-primary"),
      dependencies: na(raw("A database has no downstream calls to watch")),
    },
  },
  {
    service: "redis-cache",
    lastScanned: raw("9 min ago"),
    cells: {
      requests: w(
        "redis-cache-ops",
        "anomaly",
        "redis/ops",
        "requires redis_commands_processed_total",
        "otel_metrics",
      ),
      errors: w(
        "redis-cache-rejections",
        "threshold",
        "redis/rejected-connections",
        "requires redis_rejected_connections_total",
        "otel_metrics",
      ),
      latency: w(
        "redis-cache-latency",
        "anomaly",
        "redis/latency",
        "requires db.system = redis spans",
        "otel_traces",
      ),
      saturation: w(
        "redis-cache-memory",
        "threshold",
        "redis/memory",
        "requires redis_memory_used_bytes + maxmemory",
        "otel_metrics",
      ),
      logPatterns: gap(raw("No log stream shipped for redis-cache"), "logs/new-pattern", LOGS),
      dependencies: na(raw("A cache has no downstream calls to watch")),
    },
  },
  {
    service: "kafka",
    lastScanned: raw("5 min ago"),
    cells: {
      requests: w(
        "kafka-messages-in",
        "anomaly",
        "kafka/throughput",
        "requires kafka_server_brokertopicmetrics",
        "otel_metrics",
      ),
      errors: w(
        "kafka-under-replicated",
        "threshold",
        "kafka/under-replicated",
        "requires kafka_server_replicamanager",
        "otel_metrics",
      ),
      latency: w(
        "kafka-produce-latency",
        "anomaly",
        "kafka/request-latency",
        "requires kafka_network_requestmetrics",
        "otel_metrics",
      ),
      saturation: w(
        "kafka-consumer-lag",
        "anomaly",
        "kafka/consumer-lag",
        "requires consumer_group_lag",
        "otel_metrics",
      ),
      logPatterns: logs("kafka"),
      dependencies: na(raw("Brokers have no downstream calls to watch")),
    },
  },
  {
    service: "email-worker",
    lastScanned: raw("6 min ago"),
    cells: {
      requests: learning("email-worker-requests", "http-service/requests", HTTP_REQ, "otel_traces"),
      errors: learning("email-worker-errors", "http-service/error-rate", HTTP_ERR, "otel_traces"),
      latency: learning(
        "email-worker-latency",
        "http-service/latency-p95",
        HTTP_LAT,
        "otel_traces",
      ),
      saturation: cpu("email-worker"),
      logPatterns: learning("email-worker-log-patterns", "logs/new-pattern", LOGS, "default"),
      dependencies: learning(
        "email-worker-deps",
        "dependencies/client-errors",
        DEPS,
        "otel_traces",
      ),
    },
  },
  {
    service: "search",
    lastScanned: raw("5 min ago"),
    cells: {
      ...httpService("search"),
      saturation: gap(CEILING, "jvm/heap", "requires jvm.memory.used + jvm.memory.max"),
      logPatterns: logs("search"),
      dependencies: deps("search"),
    },
  },
  {
    service: "recommendation",
    lastScanned: raw("5 min ago"),
    cells: {
      requests: w(
        "recommendation-requests",
        "anomaly",
        "http-service/requests",
        HTTP_REQ,
        "otel_traces",
      ),
      errors: w(
        "recommendation-errors",
        "anomaly",
        "http-service/error-rate",
        HTTP_ERR,
        "otel_traces",
      ),
      latency: gap(CEILING, "http-service/latency-p95", HTTP_LAT),
      saturation: gap(CEILING, "k8s-workload/memory", "requires k8s.pod.name + container memory"),
      logPatterns: logs("recommendation"),
      dependencies: gap(CEILING, "dependencies/client-errors", DEPS),
    },
  },
];

export const STREAMS: StreamScan[] = [
  { stream: "otel_traces", lastScanned: raw("3 min ago"), services: 41 },
  { stream: "otel_metrics", lastScanned: raw("4 min ago"), services: 47 },
  { stream: "default", lastScanned: raw("6 min ago"), services: 38 },
  { stream: "postgres_logs", lastScanned: raw("9 min ago"), services: 2 },
  { stream: "k8s_events", lastScanned: null, services: 0 },
];

export const COVERAGE_PLAN: PlanItem[] = [
  {
    service: "postgres-primary",
    signal: "saturation",
    library: "postgres/replication-lag",
    ledgerId: "L-310",
    reason: raw("Library entry applies: replica found in otel_metrics (L-310)."),
  },
  {
    service: "inventory",
    signal: "errors",
    library: "http-service/error-rate",
    reason: raw("Needs http.status_code on inventory spans"),
  },
  {
    service: "search",
    signal: "saturation",
    library: "jvm/heap",
    reason: CEILING,
  },
  {
    service: "recommendation",
    signal: "latency",
    library: "http-service/latency-p95",
    reason: CEILING,
  },
  {
    service: "recommendation",
    signal: "saturation",
    library: "k8s-workload/memory",
    reason: CEILING,
  },
  {
    service: "recommendation",
    signal: "dependencies",
    library: "dependencies/client-errors",
    reason: CEILING,
  },
];

export const gapServices = (): string[] =>
  COVERAGE.filter((r) => SIGNALS.some((s) => r.cells[s].state === "gap")).map((r) => r.service);

export const unscannedStreams = (): StreamScan[] => STREAMS.filter((s) => !s.lastScanned);

export const BUDGETS: Budget[] = [
  {
    id: "slack-oncall-payments",
    destination: raw("#oncall-payments"),
    kind: "slack",
    limit: 10,
    used: { quiet: 0, incident: 10 },
    digest: true,
  },
  {
    id: "pagerduty-payments",
    destination: raw("PagerDuty · payments"),
    kind: "pagerduty",
    limit: 5,
    used: { quiet: 0, incident: 3 },
    digest: true,
  },
  {
    id: "email-platform-team",
    destination: raw("platform-team@acme.io"),
    kind: "email",
    limit: 20,
    used: { quiet: 3, incident: 4 },
    digest: true,
  },
];

export const ACTION_CLASSES: ActionClassPolicy[] = [
  { id: "CreateDetector", mode: "auto", group: "coverage" },
  { id: "AddLibraryAlert", mode: "auto", group: "coverage" },
  { id: "RepairDestination", mode: "auto", group: "calibration" },
  { id: "EnableDeduplication", mode: "auto", group: "calibration" },
  { id: "RaiseThreshold", mode: "suggest", group: "calibration" },
  { id: "LowerThreshold", mode: "suggest", group: "calibration" },
  { id: "LengthenEvaluationWindow", mode: "suggest", group: "calibration" },
  { id: "FixAlertQuery", mode: "suggest", group: "calibration" },
  { id: "AttachDestination", mode: "suggest", group: "calibration" },
  { id: "MoveToIncidentDelivery", mode: "suggest", group: "calibration" },
  { id: "ReviewForDeletion", mode: "suggest", group: "calibration" },
  { id: "RollbackDeploy", mode: "off", group: "action" },
  { id: "ScaleService", mode: "off", group: "action" },
  { id: "RestartPod", mode: "off", group: "action" },
  { id: "ToggleFeatureFlag", mode: "off", group: "action" },
  { id: "RunRunbookStep", mode: "off", group: "action" },
];

export const LEDGER_STATUS: Record<LedgerStatus, { variant: BadgeVariant; key: I18nKey }> = {
  auto_applied: { variant: "blue-soft", key: "autoobserve.ledgerStatus.autoApplied" },
  kept: { variant: "success-soft", key: "autoobserve.ledgerStatus.kept" },
  awaiting: { variant: "warning-soft", key: "autoobserve.ledgerStatus.awaiting" },
  approved: { variant: "success-soft", key: "autoobserve.ledgerStatus.approved" },
  rejected: { variant: "default-soft", key: "autoobserve.ledgerStatus.rejected" },
  rolled_back: { variant: "purple-soft", key: "autoobserve.ledgerStatus.rolledBack" },
};

export const LOOP_LABEL: Record<Loop, I18nKey> = {
  coverage: "autoobserve.loops.coverage",
  calibration: "autoobserve.loops.calibration",
  investigation: "autoobserve.loops.investigation",
};

export const SIGNAL_LABEL: Record<Signal, I18nKey> = {
  requests: "autoobserve.signals.requests",
  errors: "autoobserve.signals.errors",
  latency: "autoobserve.signals.latency",
  saturation: "autoobserve.signals.saturation",
  logPatterns: "autoobserve.signals.logPatterns",
  dependencies: "autoobserve.signals.dependencies",
};
