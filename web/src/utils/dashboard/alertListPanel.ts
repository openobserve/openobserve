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

import { outcomeBucket, shouldShowRunOutcome } from "@/utils/alerts/runOutcome";

export const ALERT_LIST_SORTS = ["name", "time", "state"] as const;
export type AlertListSort = (typeof ALERT_LIST_SORTS)[number];

/** States a user can filter on; `unknown` (never evaluated) only shows while no state is picked. */
export const ALERT_LIST_STATES = ["firing", "error", "pending", "ok", "paused"] as const;
export type AlertListState = (typeof ALERT_LIST_STATES)[number] | "unknown";

export const ALERT_LIST_DEFAULT_MAX = 20;
export const ALERT_LIST_MAX_LIMIT = 1000;

export interface AlertListRow {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  state: AlertListState;
  /** Microseconds, as the alerts API sends it. */
  lastTriggeredAt: number | null;
}

const STATE_RANK: Record<AlertListState, number> = {
  firing: 0,
  error: 1,
  pending: 2,
  ok: 3,
  unknown: 4,
  paused: 5,
};

/** A paused alert keeps its last outcome, so it reads as paused rather than as a stale firing. */
export const alertListState = (alert: any): AlertListState => {
  if (!alert?.enabled) return "paused";
  if (!shouldShowRunOutcome(alert.enabled, alert.last_outcome)) return "unknown";
  const bucket = outcomeBucket(alert.last_outcome);
  return bucket === "other" ? "unknown" : bucket;
};

const toRow = (alert: any): AlertListRow => ({
  id: String(alert?.alert_id ?? alert?.anomaly_id ?? alert?.id ?? ""),
  name: String(alert?.name ?? ""),
  folderId: String(alert?.folder_id ?? ""),
  folderName: String(alert?.folder_name ?? alert?.folder_id ?? ""),
  state: alertListState(alert),
  lastTriggeredAt: Number(alert?.last_triggered_at) > 0 ? Number(alert.last_triggered_at) : null,
});

export const alertListMax = (config: any): number => {
  const max = Number(config?.alert_list_max);
  if (!Number.isFinite(max) || max < 1) return ALERT_LIST_DEFAULT_MAX;
  return Math.min(Math.floor(max), ALERT_LIST_MAX_LIMIT);
};

const byName = (a: AlertListRow, b: AlertListRow) => a.name.localeCompare(b.name);

const SORTERS: Record<AlertListSort, (a: AlertListRow, b: AlertListRow) => number> = {
  name: byName,
  time: (a, b) => (b.lastTriggeredAt ?? -1) - (a.lastTriggeredAt ?? -1) || byName(a, b),
  state: (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || byName(a, b),
};

/** The panel's rows: filtered by folder and state, sorted, then capped at `alert_list_max`. */
export const buildAlertListRows = (alerts: any[], config: any): AlertListRow[] => {
  const folder = typeof config?.alert_list_folder === "string" ? config.alert_list_folder : "";
  const states: string[] = Array.isArray(config?.alert_list_state) ? config.alert_list_state : [];
  const sort: AlertListSort = ALERT_LIST_SORTS.includes(config?.alert_list_sort)
    ? config.alert_list_sort
    : "state";
  return (Array.isArray(alerts) ? alerts : [])
    .map(toRow)
    .filter((row) => row.id && (!folder || row.folderId === folder))
    .filter((row) => !states.length || states.includes(row.state))
    .sort(SORTERS[sort])
    .slice(0, alertListMax(config));
};
