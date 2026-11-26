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

import { healthScalar } from "./healthScalar";
import type { DbmRowMetrics } from "./instanceMetrics";

/** Connections at or past this share of the limit are an error; the last slots are reserved for superusers. */
export const SATURATION_DANGER = 0.9;
/** Below this cache hit share, most reads go to disk. */
export const CACHE_HIT_POOR = 0.9;

export type DbmHealthIssueId = "connections" | "cache" | "deadlocks";
export interface DbmHealthIssue {
  id: DbmHealthIssueId;
  severity: "error" | "warning";
}

/** What is wrong on an instance; the cell labels these and the Health sort ranks by them. */
export const healthIssues = (metrics: DbmRowMetrics): DbmHealthIssue[] => {
  const { cacheHitRatio, deadlocks, saturation } = metrics;
  const out: DbmHealthIssue[] = [];
  if (saturation.ratio !== null && saturation.ratio >= SATURATION_DANGER) {
    out.push({ id: "connections", severity: "error" });
  }
  if (cacheHitRatio !== null && cacheHitRatio < CACHE_HIT_POOR) {
    out.push({ id: "cache", severity: "warning" });
  }
  if (deadlocks !== null && deadlocks > 0) out.push({ id: "deadlocks", severity: "error" });
  return out;
};

/** True when at least one metric with a threshold was measured, so "no issues" means something. */
export const hasThresholdedReading = (metrics: DbmRowMetrics): boolean =>
  metrics.saturation.ratio !== null || metrics.cacheHitRatio !== null || metrics.deadlocks !== null;

/** Sort key, descending = needs attention first: no reading, error, warning, healthy. */
export const healthColumnSortValue = (metrics?: DbmRowMetrics): number => {
  if (!metrics || healthScalar(metrics).state === "absent") return 1000;
  const issues = healthIssues(metrics);
  const severity = issues.some((i) => i.severity === "error") ? 2 : issues.length ? 1 : 0;
  const ratio = metrics.saturation.ratio ?? 0;
  return severity * 100 + Math.min(issues.length, 9) * 10 + ratio / (1 + ratio);
};
