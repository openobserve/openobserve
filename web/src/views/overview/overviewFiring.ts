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

import { compareTriage, rowsInState, type FiringRow } from "@/utils/alerts/firingAlerts";

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
  return rowsInState([...rows], "firing").sort(
    (a, b) => LEVEL_RANK[firingLevel(a)] - LEVEL_RANK[firingLevel(b)] || compareTriage(a, b),
  );
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
