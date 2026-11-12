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

import type { OverviewNowRow } from "@/composables/contextProviders/types";
import type { Incident } from "@/services/incidents";
import type { ServicesTrendResponse } from "@/services/service_graph";

import type { OverviewAlertItem, OverviewTopology } from "./useHomeNow";

/** What Home already loaded, as the Needs Attention empty state reads it. */
export interface HealthInput {
  incidents: { open: Incident[]; acknowledged: Incident[] } | null;
  trend: ServicesTrendResponse | null;
  topology: OverviewTopology | null;
  /** Every row the Now list built, drawn or not. */
  rows: readonly OverviewNowRow[];
  alertList: readonly OverviewAlertItem[] | null;
  failed: boolean;
  denied: boolean;
}

export type HealthState = "failed" | "nothingMonitored" | "allClear";

/** All clear only when every source loaded, something is watched and nothing is open; null while something is open. */
export function healthState(input: HealthInput): HealthState | null {
  if (input.failed) return "failed";
  const degraded = input.trend
    ? input.trend.degraded_total > 0
    : input.rows.some((row) => row.kind === "service" && row.bucket !== "recovered");
  // Any row Now still lists, an anomaly included, is open even when no count names it.
  const open =
    degraded ||
    (input.incidents?.open.length ?? 0) + (input.incidents?.acknowledged.length ?? 0) > 0 ||
    input.rows.some((row) => row.bucket !== "recovered");
  if (open || input.denied) return null;
  const services = input.trend
    ? input.trend.total_services > 0
    : (input.topology?.nodes.length ?? 0) > 0;
  return services || (input.alertList?.length ?? 0) > 0 ? "allClear" : "nothingMonitored";
}
