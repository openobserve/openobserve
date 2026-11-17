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

import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { TRACE_ERRORED_SQL } from "@/plugins/traces/llmTraceOutcome";
import { buildAgentTraceFilter } from "@/plugins/traces/llmAgentFilter";
import { traceUsageSum } from "@/plugins/traces/llmAttribution";
import { agentParentsJoin } from "@/plugins/traces/config/llmInsightsPanels";

export const WATCH_WINDOW_US = 3 * 3_600_000_000;
/** The card starts once the new version has this many sessions in its window. */
export const WATCH_MIN_SESSIONS = 5;
/** A change has to be at least this large, relative, to be a regression. */
export const REGRESSION_MIN_CHANGE = 0.1;

/** The newest version and the one before it, for one agent and env. */
export function watchPair(
  variants: GenAiAgentListItem[],
): { next: GenAiAgentListItem; prev: GenAiAgentListItem } | null {
  const versions = variants
    .filter((v) => v.version && v.first_seen != null)
    .sort((a, b) => (b.first_seen ?? 0) - (a.first_seen ?? 0));
  return versions.length >= 2 ? { next: versions[0], prev: versions[1] } : null;
}

export function versionWindowSql(
  stream: string,
  v: GenAiAgentListItem,
  hasParentSpan: boolean,
): string {
  return (
    `SELECT COUNT(*) AS traces, SUM(failed) AS failed, COUNT(DISTINCT session) AS sessions, ` +
    `SUM(cost) AS cost, approx_percentile_cont(duration_us, 0.95) AS p95_us FROM (` +
    `SELECT trace_id, ${TRACE_ERRORED_SQL} AS failed, MAX(gen_ai_conversation_id) AS session, ` +
    `${traceUsageSum("gen_ai_usage_cost")} AS cost, (MAX(end_time) - MIN(start_time)) / 1000 AS duration_us ` +
    `FROM "${stream}"${agentParentsJoin(stream, hasParentSpan)} ` +
    `WHERE ${buildAgentTraceFilter(v, stream)} GROUP BY trace_id)`
  );
}

/** Another org, stream or env with the same agent and version is a different release. */
export function releaseWatchMuteKey(org: string, stream: string, v: GenAiAgentListItem): string {
  return `o2_release_watch_muted:${JSON.stringify([org, stream, v.id ?? v.name, v.env ?? "", v.version ?? ""])}`;
}

/** The failing traces' error messages, for classes the new version introduced. */
export function versionFailuresSql(
  stream: string,
  v: GenAiAgentListItem,
  hasStatusMessage: boolean,
): string {
  if (!hasStatusMessage) return "";
  return (
    `SELECT MAX(CASE WHEN span_status = 'ERROR' THEN status_message END) AS msg FROM "${stream}" ` +
    `WHERE ${buildAgentTraceFilter(v, stream)} GROUP BY trace_id HAVING ${TRACE_ERRORED_SQL} = 1`
  );
}

export interface WindowMeasures {
  traces: number;
  failed: number;
  sessions: number;
  cost: number;
  p95Us: number;
}

export const toMeasures = (row: any): WindowMeasures => ({
  traces: Number(row?.traces) || 0,
  failed: Number(row?.failed) || 0,
  sessions: Number(row?.sessions) || 0,
  cost: Number(row?.cost) || 0,
  p95Us: Number(row?.p95_us) || 0,
});

export type Verdict = "regressed" | "improved" | "nochange" | "indicative";

export interface WatchMetric {
  id: "failureRate" | "costPerSession" | "p95";
  before: number;
  after: number;
  verdict: Verdict;
}

/** Two-proportion z test: is the change in failure rate beyond noise at 95%? */
function proportionsDiffer(f1: number, n1: number, f2: number, n2: number): boolean {
  if (!n1 || !n2) return false;
  const p = (f1 + f2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 && Math.abs(f2 / n2 - f1 / n1) / se >= 1.96;
}

const bigEnough = (before: number, after: number) =>
  before > 0 ? Math.abs(after - before) / before >= REGRESSION_MIN_CHANGE : after > 0;

export function compareWindows(prev: WindowMeasures, next: WindowMeasures): WatchMetric[] {
  const fr = (m: WindowMeasures) => (m.traces ? m.failed / m.traces : 0);
  const frVerdict: Verdict =
    proportionsDiffer(prev.failed, prev.traces, next.failed, next.traces) &&
    bigEnough(fr(prev), fr(next))
      ? fr(next) > fr(prev)
        ? "regressed"
        : "improved"
      : "nochange";
  const cps = (m: WindowMeasures) => (m.sessions ? m.cost / m.sessions : 0);
  // Cost per session has no interval here: it counts only when both arms are large.
  const enough = prev.sessions >= 30 && next.sessions >= 30;
  const cpsVerdict: Verdict = !bigEnough(cps(prev), cps(next))
    ? "nochange"
    : !enough
      ? "indicative"
      : cps(next) > cps(prev)
        ? "regressed"
        : "improved";
  return [
    { id: "failureRate", before: fr(prev) * 100, after: fr(next) * 100, verdict: frVerdict },
    { id: "costPerSession", before: cps(prev), after: cps(next), verdict: cpsVerdict },
    { id: "p95", before: prev.p95Us, after: next.p95Us, verdict: "indicative" },
  ];
}

/** Failure classes in the new version that the previous one never had, most traces first. */
export function introducedClasses(
  prevMsgs: string[],
  nextMsgs: string[],
  classOf: (m: string) => string,
) {
  const before = new Set(prevMsgs.map(classOf));
  const counts = new Map<string, number>();
  for (const m of nextMsgs) {
    const c = classOf(m);
    if (c && !before.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, traces]) => ({ cls, traces }));
}

/** Normalises counts and ids, which vary per trace, so messages group by class. */
export function errorClass(message: string): string {
  const m = (message || "").toLowerCase().trim();
  if (!m) return "";
  return m
    .replace(/[0-9a-f]{8,}/g, "…")
    .replace(/\d+(\.\d+)?/g, (n) => (/^[45]\d\d$/.test(n) ? n : "#"))
    .replace(/\s+/g, " ")
    .slice(0, 80);
}
