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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import {
  AUTONOMY,
  DAY_DATE,
  DEMO_DATE,
  DEMO_NOW,
  DESTINATIONS,
  LEARNING_WINDOW_DAYS,
  LEDGER,
  MACHINE_ALERT,
  PROBLEMS,
  SCENARIOS,
  STALLED,
  chartPoints,
  confidenceBand,
  daysBefore,
  groupedFirings,
  ledgerIn,
  pagesTo,
  asksTo,
  periodStats,
  problemsIn,
  scenarioFacts,
  serviceStats,
  type Autonomy,
  type ConfidenceBand,
  type DayKey,
  type FixKind,
  type HypothesisVerdict,
  type LedgerFact,
  type Period,
  type ProblemFact,
  type Scenario,
  type ServiceFact,
} from "./data/facts";

export type { Scenario };
export { DEMO_DATE, SCENARIOS };

export type Severity = "p1" | "p2" | "p3" | "p4";
export type IssueStatus = "open" | "acknowledged" | "resolved";
export type Loop = "coverage" | "calibration" | "investigation" | "action";
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
  projected?: number;
  card?: string;
}

export interface Analysis {
  verdict: I18nText;
  impact: I18nText[];
  duration?: I18nText;
  hypotheses: { name: I18nText; verdict: HypothesisVerdict; reason: I18nText }[];
  comparison?: {
    metric: I18nText;
    rows: {
      label: I18nText;
      value: number;
      shown: I18nText;
      kind: "affected" | "healthy" | "limit";
    }[];
  };
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

export type UnfoldKind =
  "metric" | "log" | "trace" | "change" | "unwatched" | "forecast" | "outcome";
export type UnfoldOutcome =
  "paged" | "asked" | "notified" | "held" | "fixFailed" | "fixed" | "resolved" | "open";
export type UnfoldTone = "danger" | "warning" | "info" | "success" | "neutral";

// lane is a service name, or null for the team's lane; minute orders the chain and is null for anything without a clock time.
export interface UnfoldCard {
  id: string;
  kind: UnfoldKind;
  outcome?: UnfoldOutcome;
  lane: string | null;
  at: string;
  minute: number | null;
  title: I18nText;
  detail?: I18nText;
  tag?: I18nKey;
  tone: UnfoldTone;
  times?: string[];
  count?: number;
  peak?: I18nText;
  threshold?: I18nText;
  points?: number[];
  projected?: number;
  after?: string;
  via?: I18nText;
}

export interface Issue {
  id: string;
  problemId: string;
  day: DayKey;
  time: string;
  // Absent while the problem is open, or when it was held without an end.
  endedAt?: string;
  minutes?: number;
  alerts: number;
  title: I18nText;
  severity: Severity;
  services: string[];
  started: I18nText;
  status: IssueStatus;
  cause: I18nText;
  deferred?: boolean;
  summary: I18nText;
  likelyCause: I18nText;
  confidence: ConfidenceBand;
  nextStep: I18nText;
  evidence: Evidence[];
  analysis: Analysis;
  upstream: string[];
  downstream: string[];
  timeline: TimelineEntry[];
  firings: Firing[];
  unfold: UnfoldCard[];
  channel: I18nText;
  thread: ThreadMessage[];
  proposal?: { ledgerId: string; title: string; detail: string; kind: "detection" | "fix" };
  facts?: {
    deployService: string;
    version: string;
    pods: number;
    alert: string;
    dbLimit: number;
  };
}

export interface LedgerEntry {
  id: string;
  loop: Loop;
  actionClass: string;
  target: I18nText;
  status: LedgerStatus;
  confidence: ConfidenceBand;
  evidence: I18nText;
  before: string;
  after: string;
  when: I18nText;
  reviewWindow?: I18nText;
  note?: I18nText;
  userBuilt?: boolean;
  decided?: boolean;
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
  stream: string;
  blockedBy?: "noLink" | "stopped";
  addedThisWeek?: boolean;
  lastScanned: I18nText;
  scannedMinutes: number | null;
  cells: Record<Signal, CoverageCell>;
}

export interface StreamScan {
  stream: string;
  lastScanned: I18nText | null;
  stale?: boolean;
  services: number;
}

export interface PlanItem {
  service: string;
  signal: Signal;
  library: string;
  reason: I18nText;
}

export interface DestinationPages {
  id: string;
  destination: I18nText;
  kind: "slack" | "pagerduty" | "email";
  pages: Record<Scenario, number>;
  asks: Record<Scenario, number>;
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

const DAY_LABEL: Record<DayKey, I18nKey> = {
  today: "autoobserve2.days.today",
  monday: "autoobserve2.days.monday",
  tuesday: "autoobserve2.days.tuesday",
  wednesday: "autoobserve2.days.wednesday",
  thursday: "autoobserve2.days.thursday",
  friday: "autoobserve2.days.friday",
  jul18: "autoobserve2.days.jul18",
  jul30: "autoobserve2.days.jul30",
  aug13: "autoobserve2.days.aug13",
  aug26: "autoobserve2.days.aug26",
  sep4: "autoobserve2.days.sep4",
  sep12: "autoobserve2.days.sep12",
  sep23: "autoobserve2.days.sep23",
  sep24: "autoobserve2.days.sep24",
  sep30: "autoobserve2.days.sep30",
  oct1: "autoobserve2.days.oct1",
  oct2: "autoobserve2.days.oct2",
};

const MODE: Record<Autonomy, PolicyMode> = { tell: "off", ask: "suggest", fix: "auto" };

const k = (key: string) => key as I18nKey;

const whenLabel = (t: TranslateFn, day: DayKey, time?: string) =>
  time ? t("autoobserve2.when", { day: t(DAY_LABEL[day]), time: raw(time) }) : t(DAY_LABEL[day]);

const destinationName = (id: string) => DESTINATIONS.find((d) => d.id === id)?.name ?? id;

export const funnelFor = (scenario: Scenario) => {
  const stats = periodStats(scenario, "week");
  return {
    firings: scenarioFacts(scenario).weekFirings,
    incidents: stats.problems,
    heldForDigest: stats.held,
    pages: stats.pages,
    oldAlertPages: stats.oldAlertPages,
  };
};

export const FUNNEL: Record<Scenario, ReturnType<typeof funnelFor>> = Object.fromEntries(
  SCENARIOS.map((s) => [s, funnelFor(s)]),
) as Record<Scenario, ReturnType<typeof funnelFor>>;

const SEVERITY_TONE: Record<Severity, UnfoldTone> = {
  p1: "danger",
  p2: "danger",
  p3: "warning",
  p4: "neutral",
};

const minuteOf = (at: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const stepDetail = (fact: ProblemFact, title: string) =>
  fact.steps.find((s) => s.title.startsWith(title))?.detail;

// The first change event is the cause card; a low-confidence read only says the two line up.
const causeCard = (fact: ProblemFact): UnfoldCard[] => {
  const step = fact.steps.find((s) => s.by === "event" && s.variant === "info");
  if (!step) return [];
  return [
    {
      id: "change",
      kind: "change",
      lane: step.service ?? fact.deploy?.service ?? fact.service,
      at: step.at,
      minute: minuteOf(step.at),
      title: raw(step.title),
      detail: raw(step.detail),
      tag:
        confidenceBand(fact.confidence) === "low"
          ? "autoobserve.unfold.linesUpWith"
          : "autoobserve.unfold.likelyCause",
      tone: "info",
    },
  ];
};

const signalCards = (fact: ProblemFact, fixed: boolean): UnfoldCard[] => [
  ...fact.firings.map((f): UnfoldCard => ({
    id: f.detector,
    kind: f.signal,
    lane: f.service,
    at: f.times[0],
    minute: minuteOf(f.times[0]),
    title: raw(f.name),
    detail: raw(f.detector),
    tone: SEVERITY_TONE[fact.severity],
    times: f.times,
    count: f.count,
    peak: raw(f.peak),
    threshold: f.threshold ? raw(f.threshold) : undefined,
    points: f.charted ? chartPoints(fact.chart, fixed) : undefined,
    projected: f.charted ? fact.chart.forecast : undefined,
    after: f.after,
    via: f.via ? raw(f.via) : undefined,
  })),
  ...(fact.chainNotes ?? []).map((n): UnfoldCard => ({
    id: n.id,
    kind: n.kind,
    lane: n.service,
    at: n.at,
    minute: minuteOf(n.at),
    title: raw(n.title),
    detail: raw(n.detail),
    tone: n.kind === "forecast" ? "warning" : "neutral",
    after: n.after,
    via: n.via ? raw(n.via) : undefined,
  })),
];

const outcomeCard = (
  outcome: UnfoldOutcome,
  at: string,
  tone: UnfoldTone,
  detail: I18nText | undefined,
  t: TranslateFn,
): UnfoldCard => ({
  id: `outcome-${outcome}`,
  kind: "outcome",
  outcome,
  lane: null,
  at,
  minute: minuteOf(at),
  title: t(k(`autoobserve.unfold.outcome.${outcome}`)),
  detail,
  tone,
});

// What reached people, then how it ended; a fix that worked is folded into the ending.
const outcomeCards = (fact: ProblemFact, t: TranslateFn, fixed: boolean): UnfoldCard[] => {
  const channel = raw(destinationName(fact.destination));
  const heldAt = fact.steps.find((s) => s.title.startsWith("Held"))?.at;
  const notice = fact.pagedAt
    ? outcomeCard("paged", fact.pagedAt, "danger", channel, t)
    : fact.askedAt
      ? outcomeCard("asked", fact.askedAt, "info", channel, t)
      : fact.notifiedAt
        ? outcomeCard("notified", fact.notifiedAt, "warning", channel, t)
        : heldAt
          ? outcomeCard("held", heldAt, "neutral", channel, t)
          : null;
  const fixStep = stepDetail(fact, "Fix applied");
  const fixDetail = fixStep ? raw(fixStep) : undefined;
  const resolvedStep = stepDetail(fact, "Resolved");
  const failedFix =
    fact.fix && !fact.fix.worked
      ? outcomeCard("fixFailed", fact.fix.at, "danger", fixDetail, t)
      : null;
  const now = t("autoobserve2.drawer.now");
  const lastStep = raw(fact.steps[fact.steps.length - 1].detail);
  let ending: UnfoldCard | null = null;
  if (fact.resolvedAt && fact.fix?.worked) {
    ending = outcomeCard("fixed", fact.resolvedAt, "success", fixDetail, t);
  } else if (fact.resolvedAt) {
    const detail = resolvedStep ? raw(resolvedStep) : undefined;
    ending = outcomeCard("resolved", fact.resolvedAt, "success", detail, t);
  } else if (fact.outcome === "active") {
    ending = fixed
      ? outcomeCard("fixed", now, "success", undefined, t)
      : outcomeCard("open", now, "warning", lastStep, t);
  }
  return [notice, failedFix, ending].filter((c): c is UnfoldCard => c !== null);
};

const byMinute = (a: UnfoldCard, b: UnfoldCard) => (a.minute ?? Infinity) - (b.minute ?? Infinity);

// Cards run by time, except a card never comes before the card it followed from.
const unfoldFor = (fact: ProblemFact, t: TranslateFn, fixed: boolean): UnfoldCard[] => {
  const pending = [...signalCards(fact, fixed), ...outcomeCards(fact, t, fixed)].sort(byMinute);
  const placed = causeCard(fact);
  while (pending.length) {
    const ready = pending.findIndex((c) => !c.after || !pending.some((p) => p.id === c.after));
    placed.push(...pending.splice(Math.max(ready, 0), 1));
  }
  return placed;
};

// An open problem runs until now on the pinned demo clock; one the viewer fixed on the page has no running clock.
const minutesOf = (fact: ProblemFact, fixed: boolean): number | undefined => {
  if (fact.resolvedIn) return fact.resolvedIn;
  const [from, now] = [minuteOf(fact.time), minuteOf(DEMO_NOW)];
  if (fact.outcome !== "active" || fixed || from === null || now === null) return undefined;
  return now - from;
};

const durationOf = (fact: ProblemFact, t: TranslateFn, fixed: boolean): I18nText | undefined => {
  const count = minutesOf(fact, fixed);
  if (count === undefined) return undefined;
  return fact.resolvedIn
    ? t("autoobserve.analysis.lasted", { count })
    : t("autoobserve.analysis.soFar", { count });
};

const analysisFor = (fact: ProblemFact, t: TranslateFn, fixed: boolean): Analysis => ({
  verdict: raw(fact.verdict),
  impact: fact.impact.map(raw),
  duration: durationOf(fact, t, fixed),
  hypotheses: fact.hypotheses.map((h) => ({
    name: raw(h.name),
    verdict: h.verdict,
    reason: raw(h.reason),
  })),
  comparison: fact.comparison && {
    metric: raw(fact.comparison.metric),
    rows: fact.comparison.rows.map((r) => ({ ...r, label: raw(r.label), shown: raw(r.shown) })),
  },
});

const proposalFor = (fact: ProblemFact): Issue["proposal"] => {
  const entry = LEDGER.find((e) => e.id === fact.proposalLedgerId);
  if (!entry) return undefined;
  return {
    ledgerId: entry.id,
    title: `${entry.actionClass} · ${entry.target}`,
    detail: entry.evidence,
    kind: entry.loop === "action" ? "fix" : "detection",
  };
};

// fixedIds are problems the viewer has fixed on the page, so their incidents read as resolved in both views.
const toIssue = (fact: ProblemFact, t: TranslateFn, fixedIds: string[] = []): Issue => {
  const daysAgo = daysBefore(fact.day);
  const started = whenLabel(t, fact.day, fact.time);
  const held = fact.outcome === "held";
  const lines = held
    ? []
    : Array.from({ length: 3 }, (_, i) => t(k(`autoobserve2.problems.${fact.id}.notify${i + 1}`)));
  const messageAt =
    fact.pagedAt ?? fact.notifiedAt ?? fact.steps.find((s) => s.by === "me")?.at ?? fact.time;
  const fixed = fixedIds.includes(fact.id);
  return {
    id: fact.incidentId,
    problemId: fact.id,
    day: fact.day,
    time: fact.time,
    endedAt: fact.resolvedAt ?? (fixed ? DEMO_NOW : undefined),
    minutes: minutesOf(fact, fixed),
    alerts: groupedFirings(fact),
    title: raw(fact.title),
    severity: fact.severity,
    services: fact.services,
    started,
    status:
      ["active", "predicted"].includes(fact.outcome) && !fixedIds.includes(fact.id)
        ? "open"
        : "resolved",
    deferred: held || undefined,
    cause: raw(fact.cause),
    summary: raw(fact.summary),
    likelyCause: raw(fact.likelyCause),
    confidence: confidenceBand(fact.confidence),
    nextStep: raw(fact.nextStep),
    evidence: fact.evidence.map((e) => ({
      kind: e.kind,
      title: raw(e.title),
      detail: raw(e.detail),
      count: e.count ? raw(e.count) : undefined,
      points: e.chart ? chartPoints(fact.chart, fixedIds.includes(fact.id)) : undefined,
      projected: e.chart ? fact.chart.forecast : undefined,
      card: e.card ?? (e.chart ? fact.firings.find((f) => f.charted)?.detector : undefined),
    })),
    analysis: analysisFor(fact, t, fixedIds.includes(fact.id)),
    upstream: fact.upstream,
    downstream: fact.downstream,
    timeline: fact.steps.map((s) => ({
      at: s.at || t("autoobserve2.drawer.now"),
      title: raw(s.title),
      detail: raw(s.detail),
      variant: s.variant,
    })),
    firings: fact.firings.map((f) => ({
      detector: f.detector,
      service: f.service,
      count: f.count,
      daysAgo,
      sampleTimes: f.times,
    })),
    unfold: unfoldFor(fact, t, fixedIds.includes(fact.id)),
    channel: raw(destinationName(fact.destination)),
    thread: held
      ? []
      : [
          {
            at: messageAt,
            lines,
            fields: [
              { label: t("autoobserve.issues.colServices"), value: raw(fact.services.join(", ")) },
              { label: t("autoobserve.issues.colStarted"), value: started },
            ],
          },
        ],
    proposal: proposalFor(fact),
    facts: fact.deploy
      ? {
          deployService: fact.deploy.service,
          version: fact.deploy.version,
          pods: fact.deploy.pods,
          alert: MACHINE_ALERT.name,
          dbLimit: MACHINE_ALERT.dbLimit,
        }
      : undefined,
  };
};

export const issuesFor = (
  scenario: Scenario,
  t: TranslateFn,
  fixedIds: string[] = [],
  period: Period = "week",
): Issue[] => problemsIn(scenario, period).map((fact) => toIssue(fact, t, fixedIds));

export const issueFor = (id: string, t: TranslateFn): Issue => toIssue(PROBLEMS[id], t);

export const issueByIncidentId = (
  incidentId: string,
  t: TranslateFn,
  fixedIds: string[] = [],
): Issue | undefined => {
  const fact = Object.values(PROBLEMS).find((p) => p.incidentId === incidentId);
  return fact ? toIssue(fact, t, fixedIds) : undefined;
};

const toLedger = (entry: LedgerFact, t: TranslateFn): LedgerEntry => ({
  id: entry.id,
  loop: entry.loop,
  actionClass: entry.actionClass,
  target: raw(entry.target),
  status: entry.state,
  confidence: confidenceBand(entry.confidence),
  evidence: raw(entry.evidence),
  before: entry.before,
  after: entry.after,
  when: whenLabel(t, entry.day, entry.time),
  reviewWindow: entry.reviewWindow ? raw(entry.reviewWindow) : undefined,
  note: entry.note ? raw(entry.note) : undefined,
  userBuilt: entry.userBuilt,
});

const sortKey = (e: LedgerFact) => `${DAY_DATE[e.day]} ${e.time ?? "00:00"}`;

// Pending proposals lead, then the rest newest first.
export const ledgerFor = (scenario: Scenario, t: TranslateFn): LedgerEntry[] =>
  [...ledgerIn(scenario)]
    .sort((a, b) => {
      const pending = Number(b.state === "awaiting") - Number(a.state === "awaiting");
      return pending || sortKey(b).localeCompare(sortKey(a));
    })
    .map((e) => toLedger(e, t));

export const allLedger = (t: TranslateFn): LedgerEntry[] => LEDGER.map((e) => toLedger(e, t));

export const THIS_WEEK_LEDGER = LEDGER.filter((e) => DAY_DATE[e.day] >= DAY_DATE.monday).map(
  (e) => e.id,
);

const w = (
  detector: string,
  method: "anomaly" | "threshold",
  library: string,
  predicate: string,
  stream: string,
): CoverageCell => ({ state: "watched", detector, method, library, predicate, stream });
const na = (reason: string): CoverageCell => ({ state: "na", reason: raw(reason) });

const HTTP_REQ = "requires service.name + http.route";
const HTTP_ERR = "requires service.name + http.status_code";
const HTTP_LAT = "requires service.name + span duration";
const CPU = "requires k8s.pod.name + container CPU";
const LOGS = "requires service.name in logs";
const DEPS = "requires span.kind = client";

// Agrees with the incident facts: checkout saturates on its connection pool, search on memory.
const SATURATION_OVERRIDE: Record<string, CoverageCell> = {
  checkout: w(
    "checkout-pool-saturation",
    "threshold",
    "db-client/pool",
    "requires db.client.connections.usage + max",
    "otel_traces",
  ),
  search: w(
    "search-memory",
    "threshold",
    "k8s-workload/memory",
    "requires container memory + limit",
    "k8s_metrics",
  ),
};

const watchedCells = (svc: ServiceFact): Record<Signal, CoverageCell> => {
  const name = svc.name;
  const logs = w(`${name}-log-patterns`, "anomaly", "logs/new-pattern", LOGS, svc.stream);
  if (svc.kind === "database") {
    return {
      requests: w(
        `${name}-tps`,
        "anomaly",
        "postgres/transactions",
        "requires db.system = postgresql metrics",
        "k8s_metrics",
      ),
      errors: w(
        `${name}-errors`,
        "anomaly",
        "postgres/errors",
        "requires severity in postgres logs",
        svc.stream,
      ),
      latency: w(
        `${name}-query-latency`,
        "anomaly",
        "postgres/query-latency",
        "requires db.system = postgresql spans",
        "otel_traces",
      ),
      saturation: w(
        `${name}-connections`,
        "threshold",
        "postgres/connections",
        "requires pg_stat_activity_count + max_connections",
        "k8s_metrics",
      ),
      logPatterns: logs,
      dependencies: na("A database has no downstream calls to watch"),
    };
  }
  if (svc.kind === "cache") {
    return {
      requests: w(
        `${name}-ops`,
        "anomaly",
        "redis/ops",
        "requires redis_commands_processed_total",
        "k8s_metrics",
      ),
      errors: w(
        `${name}-rejections`,
        "threshold",
        "redis/rejected-connections",
        "requires redis_rejected_connections_total",
        "k8s_metrics",
      ),
      latency: w(
        `${name}-latency`,
        "anomaly",
        "redis/latency",
        "requires db.system = redis spans",
        "otel_traces",
      ),
      saturation: w(
        `${name}-memory`,
        "threshold",
        "redis/memory",
        "requires redis_memory_used_bytes + maxmemory",
        "k8s_metrics",
      ),
      logPatterns: logs,
      dependencies: na("A cache has no downstream calls to watch"),
    };
  }
  if (svc.kind === "queue") {
    return {
      requests: w(
        `${name}-messages-in`,
        "anomaly",
        "queue/throughput",
        "requires queue messages-in counter",
        "k8s_metrics",
      ),
      errors: w(
        `${name}-dead-letters`,
        "threshold",
        "queue/dead-letters",
        "requires dead-letter counter",
        "k8s_metrics",
      ),
      latency: w(
        `${name}-age`,
        "anomaly",
        "queue/age",
        "requires oldest-message age gauge",
        "k8s_metrics",
      ),
      saturation: w(
        `${name}-depth`,
        "anomaly",
        "queue/depth",
        "requires a *_queue_depth gauge",
        "k8s_metrics",
      ),
      logPatterns: logs,
      dependencies: na("A queue has no downstream calls to watch"),
    };
  }
  return {
    requests: w(`${name}-requests`, "anomaly", "http-service/requests", HTTP_REQ, svc.stream),
    errors: w(`${name}-errors`, "anomaly", "http-service/error-rate", HTTP_ERR, svc.stream),
    latency: w(`${name}-latency`, "anomaly", "http-service/latency-p95", HTTP_LAT, svc.stream),
    saturation:
      SATURATION_OVERRIDE[name] ??
      w(`${name}-cpu`, "threshold", "k8s-workload/cpu", CPU, "k8s_metrics"),
    logPatterns: logs,
    dependencies: w(`${name}-deps`, "anomaly", "dependencies/client-errors", DEPS, svc.stream),
  };
};

const LEARNING_WINDOW = LEARNING_WINDOW_DAYS;

const gapReason = (svc: ServiceFact): string =>
  svc.reason === "stopped"
    ? `No data since ${STALLED.since} from ${STALLED.cluster}: collector, network or credentials. Check the collector first.`
    : `Metrics arrive without service.name, so they can't be tied to ${svc.name}. Add the label, or map the metrics to a service.`;

const cellsFor = (svc: ServiceFact): Record<Signal, CoverageCell> => {
  const cells = watchedCells(svc);
  if (svc.state === "cantSee") {
    const reason = raw(gapReason(svc));
    return Object.fromEntries(
      SIGNALS.map((s) =>
        cells[s].state === "na"
          ? [s, cells[s]]
          : [s, { state: "gap", reason, library: cells[s].library, predicate: cells[s].predicate }],
      ),
    ) as Record<Signal, CoverageCell>;
  }
  if (svc.state !== "learning") return cells;
  const learned = LEARNING_WINDOW - (svc.readyInDays ?? 0);
  return Object.fromEntries(
    SIGNALS.map((s) =>
      cells[s].method === "anomaly"
        ? [s, { ...cells[s], state: "learning", progress: [learned, LEARNING_WINDOW] }]
        : [s, cells[s]],
    ),
  ) as Record<Signal, CoverageCell>;
};

const scannedLabel = (t: TranslateFn, minutes: number | null, stale?: boolean) => {
  if (minutes === null) return null;
  if (stale) {
    return t(
      "autoobserve2.coverageDrawer.ago.stale",
      { count: minutes, since: raw(STALLED.since) },
      minutes,
    );
  }
  return t("autoobserve2.coverageDrawer.ago.minutes", { count: minutes }, minutes);
};

export const coverageFor = (scenario: Scenario, t: TranslateFn): CoverageRow[] => {
  const facts = scenarioFacts(scenario);
  const ORDER = { cantSee: 0, learning: 1, watching: 2 };
  return [...facts.services]
    .sort((a, b) => ORDER[a.state] - ORDER[b.state])
    .map((svc) => {
      const stream = facts.streams.find((s) => s.name === svc.stream);
      return {
        service: svc.name,
        stream: svc.stream,
        blockedBy: svc.state === "cantSee" ? svc.reason : undefined,
        addedThisWeek: svc.foundToday,
        scannedMinutes: stream?.scannedMinutesAgo ?? null,
        lastScanned:
          scannedLabel(t, stream?.scannedMinutesAgo ?? null, stream?.stale) ??
          t("autoobserve.coverage.notScanned"),
        cells: cellsFor(svc),
      };
    });
};

export const streamsFor = (scenario: Scenario, t: TranslateFn): StreamScan[] =>
  scenarioFacts(scenario).streams.map((s) => ({
    stream: s.name,
    lastScanned: scannedLabel(t, s.scannedMinutesAgo, s.stale),
    stale: s.stale,
    services: s.services,
  }));

// The plan only lists what can't be watched yet because the data falls short; nothing waits for permission.
export const planFor = (scenario: Scenario): PlanItem[] =>
  scenarioFacts(scenario)
    .services.filter((s) => s.state === "cantSee")
    .map((s) => ({
      service: s.name,
      signal: "requests" as Signal,
      library: s.kind === "database" ? "postgres/transactions" : "http-service/requests",
      reason: raw(gapReason(s)),
    }));

export const coverageStats = (scenario: Scenario) => {
  const s = serviceStats(scenario);
  const detectors = scenarioFacts(scenario)
    .services.filter((svc) => svc.state === "watching" || svc.state === "learning")
    .reduce(
      (n, svc) => n + SIGNALS.filter((sig) => watchedCells(svc)[sig].state !== "na").length,
      0,
    );
  return {
    total: s.total,
    learning: s.learning,
    gaps: s.unseen,
    fullyWatched: s.total - s.learning - s.unseen,
    added: s.foundToday,
    detectors,
  };
};

export const gapServices = (scenario: Scenario): string[] =>
  scenarioFacts(scenario)
    .services.filter((s) => s.state === "cantSee")
    .map((s) => s.name);

export const unscannedStreams = (scenario: Scenario, t: TranslateFn): StreamScan[] =>
  streamsFor(scenario, t).filter((s) => !s.lastScanned);

export const PAGES_BY_DESTINATION: DestinationPages[] = DESTINATIONS.filter(
  (d) => d.kind === "slack",
).map((d) => ({
  id: d.id,
  destination: raw(d.name),
  kind: d.kind,
  pages: Object.fromEntries(SCENARIOS.map((s) => [s, pagesTo(s, d.id)])) as Record<
    Scenario,
    number
  >,
  asks: Object.fromEntries(SCENARIOS.map((s) => [s, asksTo(s, d.id)])) as Record<Scenario, number>,
}));

export const CHANNELS = DESTINATIONS;

const autonomyMode = (actionClass: string): PolicyMode =>
  MODE[AUTONOMY.find((a) => a.actionClass === actionClass)?.mode ?? "tell"];

export const ACTION_CLASSES: ActionClassPolicy[] = [
  { id: "CreateDetector", mode: "auto", group: "coverage" },
  { id: "AddLibraryAlert", mode: "auto", group: "coverage" },
  { id: "EnableDeduplication", mode: "auto", group: "calibration" },
  { id: "RaiseThreshold", mode: autonomyMode("RaiseThreshold"), group: "calibration" },
  { id: "LowerThreshold", mode: "suggest", group: "calibration" },
  { id: "LengthenEvaluationWindow", mode: "suggest", group: "calibration" },
  { id: "FixAlertQuery", mode: "suggest", group: "calibration" },
  { id: "AttachDestination", mode: "suggest", group: "calibration" },
  { id: "MoveToIncidentDelivery", mode: "suggest", group: "calibration" },
  { id: "ReviewForDeletion", mode: "suggest", group: "calibration" },
  ...AUTONOMY.filter((a) => a.kind !== "retune").map((a) => ({
    id: a.actionClass,
    mode: MODE[a.mode],
    group: "action" as const,
  })),
  { id: "RestartPod", mode: "off", group: "action" },
  { id: "ScaleService", mode: "off", group: "action" },
  { id: "ToggleFeatureFlag", mode: "off", group: "action" },
  { id: "RunRunbookStep", mode: "off", group: "action" },
];

// Classes behind a Settings row follow the viewer's current choice there.
export const actionClassesFor = (modes: Partial<Record<FixKind, Autonomy>>): ActionClassPolicy[] =>
  ACTION_CLASSES.map((c) => {
    const kind = AUTONOMY.find((a) => a.actionClass === c.id)?.kind;
    const mode = kind && modes[kind];
    return mode ? { ...c, mode: MODE[mode] } : c;
  });

export const LEDGER_STATUS: Record<LedgerStatus, { variant: BadgeVariant; key: I18nKey }> = {
  auto_applied: { variant: "blue-soft", key: "autoobserve.ledgerStatus.autoApplied" },
  kept: { variant: "success-soft", key: "autoobserve.ledgerStatus.kept" },
  awaiting: { variant: "warning-soft", key: "autoobserve.ledgerStatus.awaiting" },
  approved: { variant: "success-soft", key: "autoobserve.ledgerStatus.approved" },
  rejected: { variant: "default-soft", key: "autoobserve.ledgerStatus.rejected" },
  rolled_back: { variant: "purple-soft", key: "autoobserve.ledgerStatus.rolledBack" },
};

export const CONFIDENCE_LABEL: Record<ConfidenceBand, I18nKey> = {
  high: "autoobserve.confidence.high",
  medium: "autoobserve.confidence.medium",
  low: "autoobserve.confidence.low",
};

export const LOOP_LABEL: Record<Loop, I18nKey> = {
  coverage: "autoobserve.loops.coverage",
  calibration: "autoobserve.loops.calibration",
  investigation: "autoobserve.loops.investigation",
  action: "autoobserve.loops.action",
};

export const SIGNAL_LABEL: Record<Signal, I18nKey> = {
  requests: "autoobserve.signals.requests",
  errors: "autoobserve.signals.errors",
  latency: "autoobserve.signals.latency",
  saturation: "autoobserve.signals.saturation",
  logPatterns: "autoobserve.signals.logPatterns",
  dependencies: "autoobserve.signals.dependencies",
};

export const lastResolved = (scenario: Scenario, t: TranslateFn): I18nText | null => {
  const done = problemsIn(scenario, "month")
    .filter((p) => p.outcome !== "active" && p.resolvedAt)
    .sort((a, b) =>
      `${DAY_DATE[b.day]} ${b.resolvedAt}`.localeCompare(`${DAY_DATE[a.day]} ${a.resolvedAt}`),
    )[0];
  return done ? whenLabel(t, done.day, done.resolvedAt) : null;
};

export const groupedCount = groupedFirings;

// Forecast points render muted, so a projection never reads as a measurement.
export const sparkPoints = ({
  points = [],
  projected,
}: {
  points?: number[];
  projected?: number;
}) => {
  const from = points.length - (projected ?? 0);
  return projected ? points.map((value, i) => ({ value, provisional: i >= from })) : points;
};
