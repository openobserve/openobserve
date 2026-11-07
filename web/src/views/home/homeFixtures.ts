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

type Row<K extends OverviewNowRow["kind"]> = Extract<OverviewNowRow, { kind: K }>;

/** Now rows for Home specs; times in microseconds. */
export function serviceRow(service: string, over: Partial<Row<"service">> = {}): OverviewNowRow {
  return {
    kind: "service",
    key: `service:${service}`,
    id: service,
    bucket: "critical",
    changedAt: 1_000,
    service,
    errorRate: 12,
    requests: 400,
    p99Ms: 900,
    p99Ratio: 2.4,
    baselineErrorRate: 1,
    baselineHours: 24,
    signal: "errors",
    coverage: "covered",
    partial: false,
    ...over,
  };
}

export function incidentRow(id: string, over: Partial<Row<"incident">> = {}): OverviewNowRow {
  return {
    kind: "incident",
    key: `incident:${id}`,
    id,
    bucket: "critical",
    changedAt: 1_000,
    title: `Incident ${id}`,
    severity: "P1",
    status: "open",
    alertCount: 1,
    ...over,
  };
}

export function alertRow(id: string, over: Partial<Row<"alert">> = {}): OverviewNowRow {
  return {
    kind: "alert",
    key: `alert:${id}`,
    id,
    bucket: "degraded",
    changedAt: 1_000,
    alertId: id,
    name: `alert ${id}`,
    state: "firing",
    count: 1,
    lastAt: 5_000_000,
    ...over,
  };
}

export function anomalyRow(id: string, over: Partial<Row<"anomaly">> = {}): OverviewNowRow {
  return {
    kind: "anomaly",
    key: `anomaly:${id}`,
    id,
    bucket: "anomaly",
    changedAt: 1_000,
    configId: id,
    name: `anomaly ${id}`,
    stream: "default",
    anomalyCount: 3,
    at: 1_000,
    ...over,
  };
}
