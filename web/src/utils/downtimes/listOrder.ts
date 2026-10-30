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

import type { DowntimeListItem, DowntimeStatus } from "@/services/downtimes";

/** Live rows first, then the finished ones from the most to the least complete. */
const STATUS_ORDER: Record<DowntimeStatus, number> = {
  active: 0,
  scheduled: 1,
  ended: 2,
  ended_early: 3,
  cancelled: 4,
};

/** The list's stat filters, read from `?status=` on load and on every later URL change. */
export const STAT_KEYS = [
  "active",
  "scheduled",
  "recurring",
  "ended",
  "ended_early",
  "cancelled",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** The stat filter a `?status=` value names, or null for anything else. */
export const statKeyOf = (value: unknown): StatKey | null =>
  STAT_KEYS.find((key) => key === value) ?? null;

type Row = Pick<DowntimeListItem, "id" | "status" | "schedule" | "current_window" | "next_window">;

/** An edit of a finished row changes nothing, so it is duplicated instead. */
export const isEditable = (row: Pick<DowntimeListItem, "status">): boolean =>
  row.status === "active" || row.status === "scheduled";

/** Only a finished row can be deleted. */
export const isFinished = (row: Pick<DowntimeListItem, "status">): boolean => !isEditable(row);

/** The window that places the row: the running one, else the next, else the schedule start. */
const startOf = (row: Row): number =>
  row.current_window?.start ?? row.next_window?.start ?? row.schedule.starts_at;

/** Status, then start, then id, so a row keeps its place across refetches. */
export function sortDowntimeRows<T extends Row>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      startOf(a) - startOf(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
