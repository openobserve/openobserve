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

export type ServiceHealthStatus = "healthy" | "degraded" | "warning" | "critical";

/** Health tier for an error-rate percentage, matching the legend: Healthy < 1%, Degraded 1–5%, Warning >5–10%, Critical > 10%. */
export function serviceHealthFromErrorRate(errorRate: number): ServiceHealthStatus {
  if (errorRate > 10) return "critical";
  if (errorRate > 5) return "warning";
  if (errorRate >= 1) return "degraded";
  return "healthy";
}

/** A service node's error-rate percentage: its reported `error_rate`, else errors over requests. */
export function serviceNodeErrorRate(node: {
  error_rate?: number | null;
  errors?: number | null;
  requests?: number | null;
  value?: number | null;
}): number {
  if (typeof node.error_rate === "number") return node.error_rate;
  // Graph View chart nodes carry the request count as `value`, not `requests`.
  const requests = node.requests || node.value || 0;
  return requests > 0 ? ((node.errors ?? 0) / requests) * 100 : 0;
}
