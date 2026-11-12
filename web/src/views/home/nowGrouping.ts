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

import type { OverviewBucket, OverviewNowRow } from "@/composables/contextProviders/types";
import type { Incident } from "@/services/incidents";

/** An alert that fired this many times in the window and is back to OK is flapping. */
export const FLAP_MIN_FIRES = 2;

/** Incident dimensions that name the service, as the alert coverage rule reads them. */
const SERVICE_DIMENSIONS = ["service_name", "service", "service.name"];

const BUCKET_RANK: Record<OverviewBucket, number> = {
  critical: 0,
  degraded: 1,
  anomaly: 2,
  recovered: 3,
};

/** One row Home shows, with what grouping learned about it. */
export interface HomeNowRow {
  row: OverviewNowRow;
  /** The service the row is about; null when its source names none. */
  service: string | null;
  /** How many rows of the same subject this one stands for. */
  repeats: number;
  /** It fired and recovered inside the window, or it came back after it resolved. */
  flapping: boolean;
}

/** Home's Now list and Problems with no alert, split from one snapshot. */
export interface HomeNowSplit {
  now: HomeNowRow[];
  problems: HomeNowRow[];
}

/** The service an incident's dimensions name, else null. */
export function incidentService(incident: Pick<Incident, "group_values">): string | null {
  const values = incident.group_values ?? {};
  for (const key of SERVICE_DIMENSIONS) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** Collapses repeats of one subject, then keeps a service's rows together, the most urgent service first. */
export function groupNowRows(
  rows: readonly OverviewNowRow[],
  serviceOfIncident: (id: string) => string | null,
): HomeNowRow[] {
  const bySubject = new Map<string, OverviewNowRow[]>();
  for (const row of rows) {
    const key = subjectOf(row, serviceOfIncident);
    bySubject.set(key, [...(bySubject.get(key) ?? []), row]);
  }
  const collapsed = [...bySubject.values()].map((same) => collapse(same, serviceOfIncident));
  const groups = new Map<string, HomeNowRow[]>();
  collapsed.forEach((item, index) => {
    const key = item.service === null ? `row:${index}` : `service:${item.service}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.values()]
    .map((members) => [...members].sort((a, b) => rankOf(a) - rankOf(b)))
    .sort((a, b) => rankOf(a[0]) - rankOf(b[0]))
    .flat();
}

/** Problems with no alert are the open service rows no alert matches; Now keeps the other rows that need you. */
export function splitNowRows(rows: readonly HomeNowRow[]): HomeNowSplit {
  const problems = rows.filter(isProblem);
  return { now: rows.filter((item) => !isProblem(item) && needsYou(item)), problems };
}

/** A recovered row needs you only while it keeps flapping. */
export function needsYou(item: HomeNowRow): boolean {
  return item.row.bucket !== "recovered" || item.flapping;
}

function isProblem(item: HomeNowRow): boolean {
  const row = item.row;
  return row.kind === "service" && row.coverage === "none" && row.bucket !== "recovered";
}

function rankOf(item: HomeNowRow): number {
  return BUCKET_RANK[item.row.bucket];
}

function serviceOf(row: OverviewNowRow, serviceOfIncident: (id: string) => string | null) {
  if (row.kind === "service") return row.service;
  if (row.kind === "incident") return serviceOfIncident(row.id);
  return null;
}

function subjectOf(row: OverviewNowRow, serviceOfIncident: (id: string) => string | null): string {
  if (row.kind === "incident") return `incident:${serviceOfIncident(row.id) ?? ""}:${row.title}`;
  if (row.kind === "alert") return `alert:${row.name}`;
  if (row.kind === "anomaly") return `anomaly:${row.name}`;
  return row.key;
}

// Rows arrive bucket-ordered, so the first of a subject is its most urgent one.
function collapse(
  same: OverviewNowRow[],
  serviceOfIncident: (id: string) => string | null,
): HomeNowRow {
  const head = same[0];
  const reopened =
    same.some((row) => row.bucket === "recovered") &&
    same.some((row) => row.bucket !== "recovered");
  const refired =
    head.kind === "alert" && head.state === "recovered" && head.count >= FLAP_MIN_FIRES;
  return {
    row: head,
    service: serviceOf(head, serviceOfIncident),
    repeats: same.length,
    flapping: reopened || refired,
  };
}
