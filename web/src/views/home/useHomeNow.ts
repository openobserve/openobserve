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

import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";

import type {
  OverviewBucket,
  OverviewNowRow,
  OverviewNowSnapshot,
  ServiceSignal,
} from "@/composables/contextProviders/types";
import type { Incident } from "@/services/incidents";
import type { ServiceTrend, ServicesTrendResponse } from "@/services/service_graph";
import { isFiringOutcome, isOkOutcome } from "@/utils/alerts/runOutcome";

import { coverageOf, type CoverageAlert } from "./homeCoverage";

/** Requests below this never rank, matching the trend endpoint's `MIN_REQUESTS`. */
export const MIN_REQUESTS = 20;

/** A held `errors` service leaves only below this error-rate delta, in percentage points. */
export const ERRORS_LEAVE_PP = 0.5;

/** A held `latency` service leaves only below this p99 ratio. */
export const LATENCY_LEAVE_RATIO = 1.6;

/** The trend endpoint takes at most this many `include` names. */
export const MAX_INCLUDE = 12;

/** Without a baseline an error rate at or over this percentage is `errors`, as the server rules. */
export const NO_BASELINE_ERROR_PCT = 5;

/** A topology p99 at or over this multiple of its edge baseline is `latency`. */
export const TOPOLOGY_LATENCY_RATIO = 2;

const BUCKETS: readonly OverviewBucket[] = ["critical", "degraded", "anomaly", "recovered"];

const SEVERITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/** One anomaly config with anomalous points in the window. */
export interface OverviewAnomalyInput {
  configId: string;
  name: string;
  stream: string;
  anomalyCount: number;
  /** Microseconds. */
  at: number;
}

/** The fields of an alert history hit the Now list reads. */
export interface OverviewAlertHit {
  alert_name?: string;
  status?: string;
  /** Microseconds. */
  timestamp?: number;
}

/** The fields of an alert list item the recovery and coverage rules read. */
export interface OverviewAlertItem extends CoverageAlert {
  alert_id?: string;
  name?: string;
  alert_type?: string;
  last_outcome?: string | null;
  last_outcome_at?: number | null;
  last_triggered_at?: number | null;
  last_satisfied_at?: number | null;
}

/** The topology the trend falls back to: nodes carry `error_rate` in percent and `requests`. */
export interface OverviewTopology {
  nodes: { id: string; label?: string; requests?: number; error_rate?: number }[];
  edges: { to: string; p99_latency_ns?: number; baseline_p99_latency_ns?: number }[];
}

/** Everything one load produced; a source that failed or does not apply is `null`. */
export interface OverviewNowInput {
  /** Org plus the range descriptor; a different key drops the previous snapshot. */
  resetKey: string;
  /** Microseconds. */
  window: { start: number; end: number };
  nowUs: number;
  incidents: { open: Incident[]; acknowledged: Incident[] } | null;
  trend: ServicesTrendResponse | null;
  topology: OverviewTopology | null;
  anomalies: OverviewAnomalyInput[] | null;
  alertHits: OverviewAlertHit[] | null;
  alertList: OverviewAlertItem[] | null;
  allRegions: boolean;
}

/** One committed Now list. */
export interface OverviewNowState {
  resetKey: string;
  rows: OverviewNowRow[];
  services: OverviewNowSnapshot["services"];
  window: { start: number; end: number };
  /** True when the trend answered; a fallback to topology drops the hysteresis memory. */
  fromTrend: boolean;
}

export interface UseHomeNow {
  state: Readonly<Ref<OverviewNowState | null>>;
  selectedKey: Ref<string | null>;
  snapshot: ComputedRef<OverviewNowSnapshot>;
  /** Builds the next list from one finished load against the previous one. */
  commit(input: OverviewNowInput): OverviewNowState;
  /** Rebuilds the committed list with a newer alert list; ignored when nothing is committed for `resetKey`. */
  refreshAlertList(
    resetKey: string,
    alertList: OverviewAlertItem[] | null,
  ): OverviewNowState | null;
  /** The services to send as `include`: the shown ones, unless the key changed. */
  includeFor(resetKey: string): string[];
  /** Drops the committed list; the selection is the caller's, since a first load keeps the URL's row. */
  reset(): void;
}

type ServiceRow = Extract<OverviewNowRow, { kind: "service" }>;

interface Candidate {
  row: OverviewNowRow;
  /** Default position inside its bucket when the row is new there. */
  rank: number;
}

/** Holds the last committed list, so the next load can apply the leave thresholds and keep row order. */
export function useHomeNow(
  pageWindow: () => { start: number; end: number } = () => ({ start: 0, end: 0 }),
): UseHomeNow {
  const state = shallowRef<OverviewNowState | null>(null);
  const selectedKey = ref<string | null>(null);
  let lastInput: OverviewNowInput | null = null;
  // Before the first load lands the provider still sends the page range, never an empty window.
  const snapshot = computed<OverviewNowSnapshot>(() => {
    const out = snapshotOf(state.value, selectedKey.value);
    return state.value ? out : { ...out, window: pageWindow() };
  });
  return {
    state,
    selectedKey,
    snapshot,
    commit(input) {
      const next = buildOverviewNow(input, state.value);
      lastInput = input;
      state.value = next;
      return next;
    },
    refreshAlertList(resetKey, alertList) {
      if (!lastInput || !state.value || lastInput.resetKey !== resetKey) return null;
      if (lastInput.alertList === alertList) return state.value;
      lastInput = { ...lastInput, alertList };
      state.value = buildOverviewNow(lastInput, state.value);
      return state.value;
    },
    includeFor(resetKey) {
      const current = state.value;
      if (!current || current.resetKey !== resetKey || !current.fromTrend) return [];
      return current.rows
        .filter((row): row is ServiceRow => row.kind === "service")
        .map((row) => row.service)
        .slice(0, MAX_INCLUDE);
    },
    reset() {
      lastInput = null;
      state.value = null;
    },
  };
}

/** The snapshot shared with the Home context provider and the starters. */
export function snapshotOf(
  state: OverviewNowState | null,
  selectedKey: string | null,
): OverviewNowSnapshot {
  const rows = state?.rows ?? [];
  return {
    rows,
    selectedKey: selectedKey && rows.some((row) => row.key === selectedKey) ? selectedKey : null,
    window: state?.window ?? { start: 0, end: 0 },
    services: state?.services ?? {
      available: false,
      partial: false,
      dataUntil: null,
      window: null,
      allRegions: false,
    },
    noData: false,
  };
}

/** Merges the sources into buckets, applies the leave thresholds and keeps the previous order inside a bucket. */
export function buildOverviewNow(
  input: OverviewNowInput,
  prev: OverviewNowState | null,
): OverviewNowState {
  const fromTrend = input.trend !== null;
  const held =
    prev && prev.resetKey === input.resetKey && prev.fromTrend && fromTrend ? prev : null;
  const candidates = [
    ...incidentCandidates(input),
    ...serviceCandidates(input, held),
    ...alertCandidates(input),
    ...anomalyCandidates(input),
  ];
  const sameRange = prev && prev.resetKey === input.resetKey ? prev : null;
  return {
    resetKey: input.resetKey,
    rows: ordered(candidates, sameRange, input.nowUs),
    services: servicesMeta(input),
    window: input.window,
    fromTrend,
  };
}

function servicesMeta(input: OverviewNowInput): OverviewNowSnapshot["services"] {
  const trend = input.trend;
  return {
    available: trend !== null,
    partial: trend?.partial ?? false,
    dataUntil: trend?.data_until ?? null,
    window: trend ? { start: trend.window.start_time, end: trend.window.end_time } : null,
    allRegions: input.allRegions,
  };
}

function incidentCandidates(input: OverviewNowInput): Candidate[] {
  const lists = input.incidents;
  if (!lists) return [];
  return [...lists.open, ...lists.acknowledged]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4) ||
        (b.last_alert_at ?? 0) - (a.last_alert_at ?? 0),
    )
    .map((incident, index) => ({
      row: incidentRow(incident, isCritical(incident) ? "critical" : "degraded"),
      rank: (isCritical(incident) ? 100 : 300) + index,
    }));
}

function isCritical(incident: Incident): boolean {
  return incident.severity === "P1" || incident.severity === "P2";
}

/** When an incident opened, in microseconds: its first alert, else its creation; 0 when neither is set. */
export function incidentOpenedAt(
  incident: Pick<Incident, "first_alert_at" | "created_at">,
): number {
  return incident.first_alert_at || incident.created_at || 0;
}

function incidentRow(incident: Incident, bucket: OverviewBucket): OverviewNowRow {
  return {
    kind: "incident",
    key: `incident:${incident.id}`,
    id: incident.id,
    bucket,
    changedAt: 0,
    title: incident.title ?? "",
    severity: incident.severity,
    status: incident.status,
    alertCount: incident.alert_count ?? 0,
  };
}

interface ServiceFigures {
  service: string;
  errorRate: number;
  requests: number;
  p99Ms: number | null;
  p99Ratio: number | null;
  errorRateDelta: number | null;
  baselineErrorRate: number | null;
  baselineHours: number | null;
  serverSignal: ServiceSignal;
}

function serviceCandidates(input: OverviewNowInput, held: OverviewNowState | null): Candidate[] {
  const figures = input.trend
    ? input.trend.services.map(trendFigures)
    : topologyFigures(input.topology);
  const heldSignals = new Map(
    (held?.rows ?? [])
      .filter((row): row is ServiceRow => row.kind === "service")
      .map((row) => [row.service, row.signal]),
  );
  const partial = input.trend?.partial ?? false;
  const candidates: Candidate[] = [];
  figures.forEach((figure, index) => {
    const signal = heldSignal(figure, heldSignals.get(figure.service));
    if (signal !== "errors" && signal !== "latency") return;
    candidates.push({
      row: serviceRow(figure, signal, coverageOf(input.alertList, figure.service), partial),
      rank: 200 + index,
    });
  });
  return candidates;
}

// A held row keeps its signal until it falls under the leave threshold, so a row does not flap at the edge.
function heldSignal(figure: ServiceFigures, previous: ServiceSignal | undefined): ServiceSignal {
  const server = figure.serverSignal;
  if (server === "errors" || !previous) return server;
  if (figure.requests < MIN_REQUESTS) return server;
  if (previous === "errors") {
    const delta = figure.errorRateDelta ?? figure.errorRate;
    if (delta >= ERRORS_LEAVE_PP) return "errors";
  }
  if (server === "latency") return server;
  if (previous === "latency" && (figure.p99Ratio ?? 0) >= LATENCY_LEAVE_RATIO) return "latency";
  return server;
}

function serviceRow(
  figure: ServiceFigures,
  signal: ServiceSignal,
  coverage: ServiceRow["coverage"],
  partial: boolean,
): OverviewNowRow {
  return {
    kind: "service",
    key: `service:${figure.service}`,
    id: figure.service,
    bucket: signal === "errors" ? "critical" : "degraded",
    changedAt: 0,
    service: figure.service,
    errorRate: figure.errorRate,
    requests: figure.requests,
    p99Ms: figure.p99Ms,
    p99Ratio: figure.p99Ratio,
    baselineErrorRate: figure.baselineErrorRate,
    baselineHours: figure.baselineHours,
    signal,
    coverage,
    partial,
  };
}

function trendFigures(trend: ServiceTrend): ServiceFigures {
  return {
    service: trend.service,
    errorRate: trend.current.error_rate,
    requests: trend.current.requests,
    p99Ms: nsToMs(trend.current.p99_latency_ns),
    p99Ratio: trend.p99_ratio,
    errorRateDelta: trend.error_rate_delta,
    baselineErrorRate: trend.baseline?.error_rate ?? null,
    baselineHours: trend.baseline?.covered_hours ?? null,
    serverSignal: trend.signal,
  };
}

function nsToMs(ns: number | null | undefined): number | null {
  return ns === null || ns === undefined ? null : Math.round(ns / 1e6);
}

// Topology figures under the server's no-baseline rules; the edge baseline gives the p99 multiple.
function topologyFigures(topology: OverviewTopology | null): ServiceFigures[] {
  if (!topology) return [];
  const ratioByNode = new Map<string, number>();
  for (const edge of topology.edges) {
    const base = edge.baseline_p99_latency_ns ?? 0;
    const current = edge.p99_latency_ns ?? 0;
    if (base > 0 && current > 0) {
      ratioByNode.set(edge.to, Math.max(ratioByNode.get(edge.to) ?? 0, current / base));
    }
  }
  return topology.nodes
    .map((node) => {
      const requests = node.requests ?? 0;
      const errorRate = node.error_rate ?? 0;
      const ratio = ratioByNode.get(node.id) ?? null;
      return {
        service: node.label ?? node.id,
        errorRate,
        requests,
        p99Ms: null,
        p99Ratio: ratio,
        errorRateDelta: null,
        baselineErrorRate: null,
        baselineHours: null,
        serverSignal: topologySignal(requests, errorRate, ratio),
      };
    })
    .sort(
      (a, b) =>
        signalTier(a.serverSignal) - signalTier(b.serverSignal) ||
        b.errorRate - a.errorRate ||
        a.service.localeCompare(b.service),
    );
}

function topologySignal(requests: number, errorRate: number, ratio: number | null): ServiceSignal {
  if (requests < MIN_REQUESTS) return "low_traffic";
  if (errorRate >= NO_BASELINE_ERROR_PCT) return "errors";
  if ((ratio ?? 0) >= TOPOLOGY_LATENCY_RATIO) return "latency";
  return "normal";
}

function signalTier(signal: ServiceSignal): number {
  return ["errors", "latency", "normal", "low_traffic"].indexOf(signal);
}

function alertCandidates(input: OverviewNowInput): Candidate[] {
  const items = input.alertList ?? [];
  const byName = new Map<string, OverviewAlertItem[]>();
  for (const item of items) {
    if (item.name) byName.set(item.name, [...(byName.get(item.name) ?? []), item]);
  }
  const recovered = new Map<string, OverviewAlertItem>();
  for (const item of items) {
    if (item.alert_id && isRecovered(item, input.window)) recovered.set(item.alert_id, item);
  }
  const firing = firingGroups(input.alertHits ?? []);
  const rows: Candidate[] = [];
  firing.forEach((group, index) => {
    const matches = byName.get(group.name) ?? [];
    const item = matches.length === 1 ? matches[0] : null;
    if (item?.alert_id && recovered.has(item.alert_id)) return;
    const alertId = item?.alert_id ?? group.name;
    rows.push({
      row: alertRow(alertId, group.name, "firing", group.count, group.lastAt, "degraded"),
      rank: index,
    });
  });
  [...recovered.values()]
    .sort((a, b) => (b.last_outcome_at ?? 0) - (a.last_outcome_at ?? 0))
    .forEach((item, index) => {
      const count = firing.find((group) => group.name === item.name)?.count ?? 0;
      rows.push({
        row: alertRow(
          item.alert_id ?? "",
          item.name ?? "",
          "recovered",
          count,
          item.last_outcome_at ?? 0,
          "recovered",
        ),
        rank: 100 + index,
      });
    });
  return rows;
}

// `last_triggered_at` moves on every evaluation, so only `last_satisfied_at` says the alert fired.
function isRecovered(item: OverviewAlertItem, window: { start: number; end: number }): boolean {
  if (item.alert_type === "anomaly_detection") return false;
  const fired = item.last_satisfied_at ?? 0;
  if (!fired || fired < window.start || fired > window.end) return false;
  return isOkOutcome(item.last_outcome) && (item.last_outcome_at ?? 0) > fired;
}

/** The firing hits grouped by alert name, the most-fired first. */
export function firingGroups(
  hits: readonly OverviewAlertHit[],
): { name: string; count: number; lastAt: number }[] {
  const groups = new Map<string, { name: string; count: number; lastAt: number }>();
  for (const hit of hits) {
    if (!hit.alert_name || !isFiringOutcome(hit.status)) continue;
    const group = groups.get(hit.alert_name) ?? { name: hit.alert_name, count: 0, lastAt: 0 };
    group.count++;
    group.lastAt = Math.max(group.lastAt, hit.timestamp ?? 0);
    groups.set(hit.alert_name, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

function alertRow(
  alertId: string,
  name: string,
  state: "firing" | "recovered",
  count: number,
  lastAt: number,
  bucket: OverviewBucket,
): OverviewNowRow {
  return {
    kind: "alert",
    key: `alert:${alertId}`,
    id: alertId,
    bucket,
    changedAt: 0,
    alertId,
    name,
    state,
    count,
    lastAt,
  };
}

function anomalyCandidates(input: OverviewNowInput): Candidate[] {
  return [...(input.anomalies ?? [])]
    .filter((anomaly) => anomaly.anomalyCount > 0)
    .sort((a, b) => b.at - a.at)
    .map((anomaly, index) => ({
      row: {
        kind: "anomaly",
        key: `anomaly:${anomaly.configId}`,
        id: anomaly.configId,
        bucket: "anomaly",
        changedAt: 0,
        configId: anomaly.configId,
        name: anomaly.name,
        stream: anomaly.stream,
        anomalyCount: anomaly.anomalyCount,
        at: anomaly.at,
      },
      rank: index,
    }));
}

// A row keeps its place while its bucket holds; a row new to a bucket enters at the top with `changedAt` now.
function ordered(
  candidates: Candidate[],
  prev: OverviewNowState | null,
  nowUs: number,
): OverviewNowRow[] {
  const before = new Map((prev?.rows ?? []).map((row, index) => [row.key, { row, index }]));
  return BUCKETS.flatMap((bucket) => {
    const inBucket = candidates.filter((c) => c.row.bucket === bucket);
    const stays = (c: Candidate) => before.get(c.row.key)?.row.bucket === bucket;
    const entering = inBucket
      .filter((c) => !stays(c))
      .sort((a, b) => a.rank - b.rank)
      .map((c) => ({ ...c.row, changedAt: nowUs }));
    const kept = inBucket
      .filter(stays)
      .sort((a, b) => before.get(a.row.key)!.index - before.get(b.row.key)!.index)
      .map((c) => ({ ...c.row, changedAt: before.get(c.row.key)!.row.changedAt }));
    return [...entering, ...kept] as OverviewNowRow[];
  });
}

/** A service's sparkline over the effective window, gaps as `null`, with its baseline level; null without a trend row. */
export function trendPoints(
  trend: ServicesTrendResponse | null,
  service: string,
  signal: ServiceSignal,
): { points: (number | null)[]; baseline: number | null } | null {
  const found = trend?.services.find((item) => item.service === service);
  if (!trend || !found || trend.step_micros <= 0) return null;
  const byStep = new Map(found.series.map((point) => [point.timestamp, point]));
  const points: (number | null)[] = [];
  // The engine evaluates the series on a step-aligned grid that need not start at the baseline start.
  const origin = trend.series_start ?? trend.baseline_window.start_time;
  const first =
    origin + Math.ceil((trend.window.start_time - origin) / trend.step_micros) * trend.step_micros;
  for (let at = first; at <= trend.data_until; at += trend.step_micros) {
    const point = byStep.get(at);
    if (!point) points.push(null);
    else if (signal === "latency") points.push(nsToMs(point.p99_latency_ns));
    else points.push(point.requests > 0 ? (point.failed / point.requests) * 100 : null);
  }
  const baseline =
    signal === "latency"
      ? nsToMs(found.baseline?.p99_latency_ns)
      : (found.baseline?.error_rate ?? null);
  return { points, baseline };
}
