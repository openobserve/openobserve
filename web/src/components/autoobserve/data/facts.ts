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
export type Period = "week" | "month" | "quarter";
export type DayKey =
  | "today"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "jul18"
  | "jul30"
  | "aug13"
  | "aug26"
  | "sep4"
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

interface FactData {
  PROBLEMS: Record<string, ProblemFact>;
  LEDGER: LedgerFact[];
  EVENTS: EventFact[];
  EVENT_PROBLEM: Record<string, string>;
  SCENARIO_BASE: Record<Scenario, Omit<ScenarioFact, "services" | "streams">>;
  servicesFor: (scenario: Scenario) => ServiceFact[];
  streamsFor: (scenario: Scenario, services: ServiceFact[]) => StreamFact[];
}

export const SCENARIOS: Scenario[] = ["demo", "allClear", "incident", "cantSee", "noBaseline"];

export const DEMO_DATE: [number, number, number] = [2026, 9, 11];

export const DAY_DATE: Record<DayKey, string> = {
  today: "2026-10-11",
  monday: "2026-10-05",
  tuesday: "2026-10-06",
  wednesday: "2026-10-07",
  thursday: "2026-10-08",
  friday: "2026-10-09",
  jul18: "2026-07-18",
  jul30: "2026-07-30",
  aug13: "2026-08-13",
  aug26: "2026-08-26",
  sep4: "2026-09-04",
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

export let PROBLEMS: Record<string, ProblemFact> = {};
export let LEDGER: LedgerFact[] = [];
export let EVENTS: EventFact[] = [];
export let EVENT_PROBLEM: Record<string, string> = {};

const EMPTY_PERIOD: PeriodFact = { problems: [], oldAlertPages: null };
const EMPTY_BASE: Omit<ScenarioFact, "services" | "streams"> = {
  periods: { week: EMPTY_PERIOD, month: EMPTY_PERIOD, quarter: EMPTY_PERIOD },
  weekFirings: 0,
  requests: [],
  gaps: [],
};

let data: FactData | null = null;

const base = (scenario: Scenario) => data?.SCENARIO_BASE[scenario] ?? EMPTY_BASE;
const servicesFor = (scenario: Scenario): ServiceFact[] => data?.servicesFor(scenario) ?? [];
const streamsFor = (scenario: Scenario, services: ServiceFact[]): StreamFact[] =>
  data?.streamsFor(scenario, services) ?? [];

/** Fills the sample scenarios' facts; until then every scenario reads as empty. */
export const installFacts = (next: FactData) => {
  data = next;
  PROBLEMS = next.PROBLEMS;
  LEDGER = next.LEDGER;
  EVENTS = next.EVENTS;
  EVENT_PROBLEM = next.EVENT_PROBLEM;
};

// The sample data loads only in dev and test builds, so a production bundle carries none of it.
export const factsReady: Promise<void> =
  import.meta.env.DEV || import.meta.env.MODE === "test"
    ? import("./factsData").then((m) => installFacts(m.FACT_DATA))
    : Promise.resolve();

// The fix's recovery is only measured once the viewer's approved fix is done.
export const chartPoints = (chart: ChartFact, fixed: boolean) =>
  fixed && chart.recovery ? [...chart.points, ...chart.recovery] : chart.points;

export const scenarioFacts = (scenario: Scenario): ScenarioFact => {
  const services = servicesFor(scenario);
  return { ...base(scenario), services, streams: streamsFor(scenario, services) };
};

export const problemsIn = (scenario: Scenario, period: Period): ProblemFact[] =>
  base(scenario).periods[period].problems.map((id) => PROBLEMS[id]);

export const periodStats = (scenario: Scenario, period: Period) => {
  const problems = problemsIn(scenario, period);
  return {
    problems: problems.length,
    pages: problems.filter((p) => p.pagedAt).length,
    asks: problems.filter((p) => p.askedAt && !p.pagedAt).length,
    fixed: problems.filter((p) => p.outcome === "fixed").length,
    failedFixes: problems.filter((p) => p.fix && !p.fix.worked).length,
    held: problems.filter((p) => p.outcome === "held").length,
    oldAlertPages: base(scenario).periods[period].oldAlertPages,
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
  return SCENARIOS.filter((s) => base(s).periods.month.problems.includes(problem));
};

export const daysBefore = (day: DayKey) => {
  const [y, m, d] = DEMO_DATE;
  const today = Date.UTC(y, m, d);
  const [yy, mm, dd] = DAY_DATE[day].split("-").map(Number);
  return Math.round((today - Date.UTC(yy, mm - 1, dd)) / 86400000);
};

export const MACHINE_ALERT = {
  name: "payments-api-db-pool",
  dbLimit: 200,
  ledgerId: "L-307",
};
