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
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { PrefillTimeRange } from "@/utils/alerts/alertPrefill";
import { buildPrefillFromTraces } from "@/utils/alerts/prefill/fromTraces";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";

type ServiceRow = Extract<OverviewNowRow, { kind: "service" }>;

/** Roles that may read but never create; Home shows them Create alert disabled. */
const READ_ONLY_ROLES: ReadonlySet<string> = new Set(["viewer"]);

/** A traces alert on the row's own signal, seeded with the figure Home already shows. */
export function serviceAlertPrefill(
  row: ServiceRow,
  streamName: string,
  datetime: PrefillTimeRange,
): AlertPrefill {
  const filter = sqlEquals("service_name", row.service);
  if (row.signal === "latency") {
    const seed = row.p99Ms === null ? null : row.p99Ms * 1000;
    return buildPrefillFromTraces(
      { streamName, filter, view: "spans", metric: "duration", percentile: 0.99, datetime },
      seed,
    );
  }
  return buildPrefillFromTraces(
    { streamName, filter, view: "spans", metric: "error_ratio", datetime },
    row.errorRate,
  );
}

/** False for a read-only role, so Create alert is shown disabled with who to ask. */
export function canCreateAlerts(role: string | null | undefined): boolean {
  return !READ_ONLY_ROLES.has(String(role ?? "").toLowerCase());
}
