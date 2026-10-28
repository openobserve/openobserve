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

import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import type {
  OrgOverview,
  OverviewAlertsData,
  OverviewSection,
  OverviewStreamTypeSummary,
  OverviewTopStream,
} from "@/ts/interfaces/overview";

export type OverviewView = "loading" | "error" | "forbidden" | "locked" | "empty" | "ok";

export const TOP_STREAMS_LIMIT = 5;

export function sectionView(
  section: OverviewSection<unknown> | null | undefined,
  opts: { pending: boolean; failed: boolean; forbidden?: boolean },
): OverviewView {
  if (opts.pending) return "loading";
  if (opts.forbidden) return "forbidden";
  if (opts.failed || !section) return "error";
  if (section.status === "ok") return section.data ? "ok" : "error";
  return section.status;
}

export type LimitLevel = "ok" | "warning" | "critical" | "over";

// 70 and 90 match the license limit card on the About page, so one number has one colour
export function limitLevel(percent: number): LimitLevel {
  if (percent >= 100) return "over";
  if (percent > 90) return "critical";
  if (percent > 70) return "warning";
  return "ok";
}

export function percentVariant(percent: number): ProgressBarVariant {
  const level = limitLevel(percent);
  if (level === "ok") return "default";
  return level === "warning" ? "warning" : "danger";
}

// a rule whose notification failed still fired
export function firingCount(alerts: OverviewAlertsData | undefined): number {
  return (alerts?.by_state.firing ?? 0) + (alerts?.by_state.notify_failed ?? 0);
}

export function overviewHasProblem(overview: OrgOverview): boolean {
  return (
    firingCount(overview.alerts.data) > 0 ||
    (overview.alerts.data?.failed_evaluation ?? 0) > 0 ||
    (overview.pipelines.data?.errored ?? 0) > 0
  );
}

export function percentToFraction(percent: number): number {
  return Math.min(1, Math.max(0, percent / 100));
}

export interface TopStreamRow extends OverviewTopStream {
  stream_type: string;
}

export function mergeTopStreams(
  byType: OverviewStreamTypeSummary[],
  limit = TOP_STREAMS_LIMIT,
): TopStreamRow[] {
  return byType
    .flatMap((type) => type.top.map((s) => ({ ...s, stream_type: type.stream_type })))
    .sort((a, b) => b.storage_size_mb - a.storage_size_mb)
    .slice(0, limit);
}

export function sizeShare(sizeMb: number, rows: TopStreamRow[]): number {
  const max = Math.max(0, ...rows.map((r) => r.storage_size_mb));
  return max > 0 ? sizeMb / max : 0;
}
