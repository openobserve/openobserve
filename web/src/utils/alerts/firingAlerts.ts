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

import type { ActiveDowntime } from "@/services/downtimes";
import type { AckAlertRequest, AlertListAck } from "@/ts/interfaces/alert";

export type FiringState = "firing" | "acked" | "muted" | "failed";
export type FiringStateTag = "firing" | "notify_failed" | "acknowledged" | "muted";

export type FiringCounts = Record<FiringState, number>;

export interface FiringRow {
  alert_id: string;
  folder_id: string;
  folder_name: string;
  name: string;
  alert_type: string;
  enabled?: boolean;
  stream_name?: string;
  priority?: number;
  last_outcome?: string;
  firing_started_at?: number;
  groups_firing?: number;
  groups_firing_is_lower_bound?: boolean;
  ack?: AlertListAck;
  active_downtime?: ActiveDowntime | null;
  /** Sent only with `include_dependencies=true`. */
  destinations?: string[];
  condition?: { aggregation?: { multi_alert?: boolean }; promql_multi_alert?: boolean };
  incident?: { id: string; title?: string; status: string };
}

export interface FiringPage {
  list: FiringRow[];
  /** The run state could not be read, so every row's live fields are blank. */
  status_unavailable?: boolean;
}

export interface FiringFilters {
  search: string;
  /** "all", "unset", or a priority id "1".."5". */
  priority: string;
  /** "all", or a folder name. */
  folder: string;
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 1440;

export const durationLabel = (elapsedMs: number): string => {
  const minutes = Math.floor(elapsedMs / MINUTE_MS);
  if (minutes < 1) return "<1m";
  if (minutes < HOUR_MINUTES) return `${minutes}m`;
  if (minutes < DAY_MINUTES) {
    const rest = String(minutes % HOUR_MINUTES).padStart(2, "0");
    return `${Math.floor(minutes / HOUR_MINUTES)}h ${rest}m`;
  }
  const hours = Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES);
  return `${Math.floor(minutes / DAY_MINUTES)}d ${hours}h`;
};

/** Firing for, from `firing_started_at` only; `last_outcome_since` resets on a failed delivery. */
export const firingForLabel = (startedAtMicros: number | undefined, nowMs: number): string =>
  startedAtMicros === undefined ? "—" : durationLabel(nowMs - startedAtMicros / 1000);

// Disabling keeps the stored firing on purpose, so the list is what hides it.
const isLive = (row: FiringRow): boolean => row.enabled !== false;

/** The list's open-firing rule: an errored run during a firing observed no recovery. */
export const isFiringNow = (row: FiringRow): boolean =>
  isLive(row) &&
  (row.last_outcome === "firing" ||
    row.last_outcome === "notify_failed" ||
    row.firing_started_at != null ||
    (row.last_outcome === "error" && (row.groups_firing ?? 0) > 0));

const isNotDelivered = (row: FiringRow): boolean =>
  isLive(row) && row.last_outcome === "notify_failed";

// Partly acked stays actionable: a page keeps paging while any group is unacked.
const isFullyAcked = (row: FiringRow): boolean => {
  const acked = row.ack?.groups_acked ?? 0;
  if (acked <= 0) return false;
  if (row.groups_firing == null) return true;
  return row.groups_firing_is_lower_bound !== true && acked >= row.groups_firing;
};

/** Which views a row belongs to; they overlap, so a row can be in several. */
export const isInState = (row: FiringRow, state: FiringState): boolean => {
  const muted = row.active_downtime != null;
  switch (state) {
    case "firing":
      return isFiringNow(row) && !isFullyAcked(row) && !muted;
    case "acked":
      return isFiringNow(row) && isFullyAcked(row);
    case "muted":
      return isFiringNow(row) && muted;
    case "failed":
      return isNotDelivered(row);
  }
};

export const countStates = (rows: FiringRow[]): FiringCounts => {
  const count = (state: FiringState) => rows.filter((row) => isInState(row, state)).length;
  return {
    firing: count("firing"),
    acked: count("acked"),
    muted: count("muted"),
    failed: count("failed"),
  };
};

const compare = <T extends number | string>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

const compareOptional = (a: number | null | undefined, b: number | null | undefined): number => {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return compare(a, b);
};

/** Not delivered, then P1..P5 with unset last, then the earliest firing with unknown last. */
export const compareTriage = (a: FiringRow, b: FiringRow): number =>
  Number(isNotDelivered(b)) - Number(isNotDelivered(a)) ||
  compareOptional(a.priority, b.priority) ||
  compareOptional(a.firing_started_at, b.firing_started_at) ||
  compare(a.name, b.name) ||
  compare(a.folder_name, b.folder_name) ||
  compare(a.alert_id, b.alert_id);

/** One view's rows in triage order. */
export const rowsInState = (rows: FiringRow[], state: FiringState): FiringRow[] =>
  rows.filter((row) => isInState(row, state)).sort(compareTriage);

// Views overlap, so the chip decides the word: an acked failed delivery is listed under both.
export const stateTag = (row: FiringRow, state: FiringState): FiringStateTag => {
  if (state === "muted") return "muted";
  if (state === "acked") return "acknowledged";
  return isNotDelivered(row) ? "notify_failed" : "firing";
};

const isMultiAlert = (row: FiringRow): boolean =>
  !!row.condition?.promql_multi_alert || !!row.condition?.aggregation?.multi_alert;

/** Whether an ack can change anything; a multi-alert stays open while a firing group is unacked. */
export const canAcknowledge = (row: FiringRow): boolean => {
  if (row.alert_type === "anomaly_detection") return false;
  if (!row.ack) return true;
  if (!isMultiAlert(row) || row.groups_firing == null) return false;
  return !!row.groups_firing_is_lower_bound || row.ack.groups_acked < row.groups_firing;
};

export const ackBody = (row: FiringRow): AckAlertRequest => {
  if (isMultiAlert(row)) return { all_groups: true };
  return row.firing_started_at == null
    ? { group_key: "" }
    : { group_key: "", firing_started_at: row.firing_started_at };
};

const matchesPriority = (row: FiringRow, priority: string): boolean => {
  if (priority === "all") return true;
  if (priority === "unset") return row.priority === undefined || row.priority === null;
  return String(row.priority) === priority;
};

export const filterRows = (rows: FiringRow[], filters: FiringFilters): FiringRow[] => {
  const term = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      matchesPriority(row, filters.priority) &&
      (filters.folder === "all" || row.folder_name === filters.folder) &&
      (!term ||
        row.name.toLowerCase().includes(term) ||
        (row.stream_name ?? "").toLowerCase().includes(term)),
  );
};
