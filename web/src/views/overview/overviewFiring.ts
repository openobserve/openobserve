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

import { isFiringNow, type FiringRow } from "@/utils/alerts/firingAlerts";

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 1440;

/** The alert list row; the server also sends the rule's configured level. */
export type HomeAlertRow = FiringRow & { level?: string | null };

export type FiringLevel = "critical" | "warning" | "other";

export const firingLevel = (row: HomeAlertRow): FiringLevel => {
  const level = (row.level ?? "").toLowerCase();
  return level === "critical" || level === "warning" ? level : "other";
};

const LEVEL_RANK: Record<FiringLevel, number> = { critical: 0, warning: 1, other: 2 };

/** What the Firing view lists (acked and muted ones left out), most severe first. */
export function firingNow(rows: readonly HomeAlertRow[]): HomeAlertRow[] {
  return rows
    .filter(isUnackedFiring)
    .sort((a, b) => LEVEL_RANK[firingLevel(a)] - LEVEL_RANK[firingLevel(b)] || compareTriage(a, b));
}

export function firingByLevel(rows: readonly HomeAlertRow[]): Record<FiringLevel, number> {
  const counts: Record<FiringLevel, number> = { critical: 0, warning: 0, other: 0 };
  for (const row of rows) counts[firingLevel(row)] += 1;
  return counts;
}

/** History rows carry only the alert's name, so a name two folders share opens no alert rather than the wrong one. */
export function alertsByName(rows: readonly HomeAlertRow[]): Map<string, HomeAlertRow> {
  const seen = new Map<string, HomeAlertRow | null>();
  for (const row of rows) seen.set(row.name, seen.has(row.name) ? null : row);
  const unique = new Map<string, HomeAlertRow>();
  for (const [name, row] of seen) if (row) unique.set(name, row);
  return unique;
}

/** Live alerts whose latest notification was not delivered. */
export function undeliveredCount(rows: readonly FiringRow[]): number {
  return rows.filter(isNotDelivered).length;
}

/** Firing for, from `firing_started_at` only; `last_outcome_since` resets on a failed delivery. */
export function firingForLabel(startedAtMicros: number | undefined, nowMs: number): string {
  return startedAtMicros === undefined ? "—" : durationLabel(nowMs - startedAtMicros / 1000);
}

function durationLabel(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / MINUTE_MS);
  if (minutes < 1) return "<1m";
  if (minutes < HOUR_MINUTES) return `${minutes}m`;
  if (minutes < DAY_MINUTES) {
    const rest = String(minutes % HOUR_MINUTES).padStart(2, "0");
    return `${Math.floor(minutes / HOUR_MINUTES)}h ${rest}m`;
  }
  const hours = Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES);
  return `${Math.floor(minutes / DAY_MINUTES)}d ${hours}h`;
}

function isNotDelivered(row: FiringRow): boolean {
  return row.enabled !== false && row.last_outcome === "notify_failed";
}

// Partly acked stays actionable: a page keeps paging while any group is unacked.
function isFullyAcked(row: FiringRow): boolean {
  const acked = row.ack?.groups_acked ?? 0;
  if (acked <= 0) return false;
  if (row.groups_firing == null) return true;
  return row.groups_firing_is_lower_bound !== true && acked >= row.groups_firing;
}

function isUnackedFiring(row: FiringRow): boolean {
  return isFiringNow(row) && !isFullyAcked(row) && row.active_downtime == null;
}

function compare<T extends number | string>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOptional(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return compare(a, b);
}

/** Not delivered, then P1..P5 with unset last, then the earliest firing with unknown last. */
function compareTriage(a: FiringRow, b: FiringRow): number {
  return (
    Number(isNotDelivered(b)) - Number(isNotDelivered(a)) ||
    compareOptional(a.priority, b.priority) ||
    compareOptional(a.firing_started_at, b.firing_started_at) ||
    compare(a.name, b.name) ||
    compare(a.folder_name, b.folder_name) ||
    compare(a.alert_id, b.alert_id)
  );
}
