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

import { ref } from "vue";
import type { RowRailTone } from "@/lib/core/Table/OTable.types";
import type { ReportRunHit } from "@/services/reports";
import type { I18nKey } from "@/types/i18n";

/** How long past its due time a run may start before the list calls it overdue. */
export const OVERDUE_GRACE_MS = 15 * 60_000;

/** Range presets shared by the per-report and the org-wide history tables. */
export const REPORT_HISTORY_RANGES = [
  { value: "24h", labelKey: "reports.history.range24h", ms: 24 * 60 * 60_000 },
  { value: "7d", labelKey: "reports.history.range7d", ms: 7 * 24 * 60 * 60_000 },
  { value: "30d", labelKey: "reports.history.range30d", ms: 30 * 24 * 60 * 60_000 },
] as const satisfies readonly { value: string; labelKey: I18nKey; ms: number }[];

export type ReportHistoryRange = (typeof REPORT_HISTORY_RANGES)[number]["value"] | "custom";

/** Values of the `reportRunStatus` badge group. */
export type ReportRunChip =
  "succeeded" | "partial" | "cached" | "error" | "skipped" | "overdue" | "never" | "paused";

/** The last-run fields the list and get endpoints return. */
export interface ReportLastRun {
  enabled?: boolean;
  last_run_at?: number | null;
  last_run_status?: string | null;
  next_run_at?: number | null;
}

/** The list endpoints carry `is_cached`; a full report carries its destinations instead. */
export function isCachedReport(report: { is_cached?: boolean; destinations?: unknown[] }): boolean {
  if (typeof report.is_cached === "boolean") return report.is_cached;
  return !report.destinations?.length;
}

/** Microsecond epoch of now; the API speaks µs throughout. */
const nowMicros = () => Date.now() * 1000;

/** The scheduler keeps the old due time while it retries a failed run, so a failed run is never overdue. */
export function isOverdue(report: ReportLastRun, now = nowMicros()): boolean {
  if (report.enabled === false || !report.next_run_at) return false;
  if (report.last_run_status === "error") return false;
  return now > report.next_run_at + OVERDUE_GRACE_MS * 1000;
}

/** The chip a report list row shows in its Last run column. */
export function lastRunChip(
  report: ReportLastRun,
  isCached: boolean,
  now = nowMicros(),
): ReportRunChip {
  if (isOverdue(report, now)) return "overdue";
  switch (report.last_run_status) {
    case "succeeded":
      return isCached ? "cached" : "succeeded";
    case "error":
      return "error";
    case "skipped":
      return "skipped";
    default:
      return "never";
  }
}

/** The chip one history row shows. */
export function runChip(hit: Pick<ReportRunHit, "status" | "is_cached" | "is_partial">): string {
  if (hit.status === "succeeded") {
    if (hit.is_cached) return "cached";
    return hit.is_partial ? "partial" : "succeeded";
  }
  return hit.status;
}

/** Row rail: failed red, skipped amber, sent green, cache warm neutral. */
export function runRailTone(hit: Pick<ReportRunHit, "status" | "is_cached">): RowRailTone | null {
  if (hit.status === "error") return "error";
  if (hit.status === "skipped") return "warning";
  if (hit.status === "succeeded") return hit.is_cached ? "neutral" : "success";
  return null;
}

/** Microseconds to whole seconds, or null when unknown. */
export function microsToSeconds(us: number | null | undefined): number | null {
  if (us === null || us === undefined) return null;
  return Math.max(0, Math.round(us / 1_000_000));
}

/** How long a Run now row is shown before the stream copy must have taken over. */
export const MANUAL_RUN_TTL_MS = 5 * 60_000;

interface ManualRun {
  org: string;
  hit: ReportRunHit;
  rememberedAt: number;
}

/** Runs started with Run now, shown at the top of history until the stream copy is searchable. */
const manualRuns = ref<ManualRun[]>([]);

export function rememberManualRun(org: string, hit: ReportRunHit, now = Date.now()) {
  manualRuns.value = [
    { org, hit, rememberedAt: now },
    ...manualRuns.value.filter(
      (r) => now - r.rememberedAt < MANUAL_RUN_TTL_MS && r.hit.timestamp !== hit.timestamp,
    ),
  ];
}

/** Recent manual runs in `org` for one report (or every report) that the server has not returned. */
export function pendingManualRuns(
  org: string,
  reportId: string | undefined,
  served: ReportRunHit[],
  now = Date.now(),
): ReportRunHit[] {
  const seen = new Set(served.map((r) => `${r.report_id}:${r.timestamp}`));
  return manualRuns.value
    .filter(
      (r) =>
        r.org === org &&
        now - r.rememberedAt < MANUAL_RUN_TTL_MS &&
        (!reportId || r.hit.report_id === reportId) &&
        !seen.has(`${r.hit.report_id}:${r.hit.timestamp}`),
    )
    .map((r) => r.hit);
}

/** Identifies a run in the URL; retries break the tie when two attempts share a microsecond. */
export function runKey(hit: Pick<ReportRunHit, "timestamp" | "retries">): string {
  return hit.retries ? `${hit.timestamp}-${hit.retries}` : String(hit.timestamp);
}
