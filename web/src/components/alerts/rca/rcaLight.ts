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

import {
  incidentFiringCounts,
  maxOf,
  minOf,
  type IncidentLive,
  type IncidentUnfoldInput,
} from "@/utils/incidents/incidentUnfold";
import type { RcaImpact, RcaRunItem, RcaSummaryHypothesis } from "@/services/incidents";

/** The live state of this incident's alerts: `incidentLiveSummary`, as the header reads it. */
export type RcaAlertsNow = IncidentLive;

const OPEN_STATUSES = new Set(["likely", "untested"]);

/** Hypotheses beside the root cause that are still open: Likely or not yet tested. */
export const rcaOpenFindings = (hypotheses: RcaSummaryHypothesis[]): RcaSummaryHypothesis[] =>
  hypotheses.filter((hypothesis) => OPEN_STATUSES.has(hypothesis.status));

/** What the Impact fact shows, in the order the spec prefers its sources. */
export type RcaImpactFact =
  | { kind: "services"; services: string[] }
  | { kind: "customer"; short: string; full: string }
  | { kind: "summary"; short: string; full: string }
  | { kind: "none" };

// The report writes Customer Impact as a key-value item or as a table row.
const CUSTOMER_IMPACT = [
  /\*\*Customer Impact\*\*\s*:\s*(.+)$/im,
  /^\|\s*\**Customer Impact\**\s*\|\s*(.+?)\s*\|\s*$/im,
];

const customerImpactRow = (report: string): string | null => {
  for (const pattern of CUSTOMER_IMPACT) {
    const match = pattern.exec(report);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
};

/** The first clause of a sentence: "None — no outage." reads "None". */
const firstClause = (text: string): string =>
  (text.split(/\s+[—–]\s+|\.\s|;\s|:\s/)[0] ?? text).replace(/\.$/, "").trim();

/** Impacted services, else the report's Customer Impact row, else `impact.summary`. */
export function rcaImpactFact(
  report: string,
  impact: RcaImpact | undefined,
  services: string[],
): RcaImpactFact {
  if (services.length > 0) return { kind: "services", services };
  const row = customerImpactRow(report);
  if (row) return { kind: "customer", short: firstClause(row), full: row };
  const summary = impact?.summary?.trim() ?? "";
  return summary
    ? { kind: "summary", short: firstClause(summary), full: summary }
    : { kind: "none" };
}

/** This incident's own firings: how many, of how many alerts, first to last. */
export interface RcaFiringScope {
  firings: number;
  alerts: number;
  firstAt: number;
  lastAt: number;
}

export function rcaFiringScope(triggers: IncidentUnfoldInput["triggers"]): RcaFiringScope | null {
  if (triggers.length === 0) return null;
  const times = triggers.map((trigger) => trigger.alert_fired_at);
  return {
    ...incidentFiringCounts(triggers),
    firstAt: minOf(times),
    lastAt: maxOf(times),
  };
}

/** One entry of the incident's events API, as far as the analysis notice reads it. */
export interface RcaIncidentEvent {
  timestamp: number;
  type: string;
  data?: { reason?: string | null } | null;
}

export type RcaFailReason = "noResponse" | "reanalysisNoStart" | "noStart" | "other";

export interface RcaFailedAnalyses {
  attempts: number;
  /** Microseconds since epoch. */
  lastAt: number;
  /** Most frequent first. */
  reasons: { reason: RcaFailReason; count: number }[];
}

/** Server reasons in plain words; the internal names never reach the page. */
export function rcaFailReason(reason: string | null | undefined): RcaFailReason {
  const text = (reason ?? "").toLowerCase();
  if (text.includes("reanalysis")) return "reanalysisNoStart";
  if (text.includes("service call") || text.includes("timed out")) return "noResponse";
  if (text.includes("spawn") || text.includes("trigger")) return "noStart";
  return "other";
}

// One attempt can log two failures a few milliseconds apart; they count once.
const SAME_ATTEMPT_US = 1_000_000;

const summarise = (
  attempts: number,
  lastAt: number,
  reasons: RcaFailReason[],
): RcaFailedAnalyses => {
  const counts = new Map<RcaFailReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return {
    attempts,
    lastAt,
    reasons: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
};

/** Failed attempts when no analysis ever succeeded; null when one did or none failed. */
export function rcaFailedAnalyses(
  events: RcaIncidentEvent[] | null,
  runs: RcaRunItem[],
): RcaFailedAnalyses | null {
  if (runs.some((run) => run.state === "completed")) return null;
  const sorted = [...(events ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.some((event) => event.type === "ai_analysis_complete")) return null;
  const failed = sorted.filter((event) => event.type === "ai_analysis_failed");
  if (failed.length > 0) {
    // One reason per attempt, its first: later failure events of an attempt follow from it.
    const reasons: RcaFailReason[] = [];
    let open = false;
    let lastFailAt = -Infinity;
    for (const event of sorted) {
      if (event.type === "ai_analysis_begin") open = true;
      if (event.type !== "ai_analysis_failed") continue;
      if (open || event.timestamp - lastFailAt > SAME_ATTEMPT_US) {
        reasons.push(rcaFailReason(event.data?.reason));
      }
      open = false;
      lastFailAt = event.timestamp;
    }
    return summarise(reasons.length, lastFailAt, reasons);
  }
  const failedRuns = runs.filter((run) => run.state === "failed");
  if (failedRuns.length === 0) return null;
  return summarise(
    failedRuns.length,
    maxOf(failedRuns.map((run) => run.ended_at ?? run.started_at)),
    failedRuns.map((run) => rcaFailReason(run.error_reason)),
  );
}
