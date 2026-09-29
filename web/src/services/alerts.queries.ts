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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { quantizeRange } from "@/composables/query/queryClient";
import alerts from "./alerts";
import type { AlertHistoryQuery } from "./alerts";
import { alertKeys } from "./alerts.querykeys";
import { anomalyKeys } from "./anomaly_detection.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

export const alertsListQuery = (
  org: string,
  folderId: string,
  query?: string,
  alertType?: string,
) =>
  queryOptions({
    queryKey: alertKeys.list(org, folderId, query, alertType),
    queryFn: async (): Promise<any[]> =>
      (
        await alerts.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          org,
          folderId,
          query ?? "",
          alertType ?? "",
        )
      ).data?.list ?? [],
    staleTime: LIVE_STALE_TIME,
  });

/**
 * The dependency graph's alert read: every folder, with the destination and
 * template refs the default path omits. Cached so the graph shares one entry
 * across the alert, destination and template pages instead of re-downloading
 * the org's full alert list per page.
 */
export const alertDependenciesQuery = (org: string) =>
  queryOptions({
    queryKey: alertKeys.dependencies(org),
    queryFn: async (): Promise<any[]> => {
      const res = await alerts.listByFolderId(
        1,
        0,
        "name",
        false,
        "",
        org,
        undefined,
        undefined,
        undefined,
        true,
      );
      return res.data?.list ?? res.data ?? [];
    },
    staleTime: LIVE_STALE_TIME,
  });

export const alertDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: alertKeys.detail(org, id),
    queryFn: async () => (await alerts.get_by_alert_id(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const alertHistoryQuery = (org: string, query: AlertHistoryQuery) => {
  // Callers anchor start/end to a raw `now`, so without quantizing, every open
  // mints a new key and the cache never hits.
  const start = Number(query.start_time);
  const end = Number(query.end_time);
  const q: AlertHistoryQuery = { ...query };
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const bucketed = quantizeRange(start, end);
    q.start_time = bucketed.start;
    q.end_time = bucketed.end;
  }
  return queryOptions({
    queryKey: alertKeys.history(org, q),
    // Only the key buckets: a bucketed `end` would hide every evaluation from the current minute.
    queryFn: async () => (await alerts.getHistory(org, query)).data ?? {},
    staleTime: LIVE_STALE_TIME,
  });
};

// ── Writes ──────────────────────────────────────────────────────────────────

/** Create or update, chosen by the caller; the scope is `alertKeys.all` because the folder a row lands in is rarely the one on screen. */
export const saveAlertMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (vars: { payload: any; folderId?: string }) =>
      isUpdate()
        ? alerts.update_by_alert_id(org, vars.payload, vars.folderId)
        : alerts.create_by_alert_id(org, vars.payload, vars.folderId),
    // Callers compose their own per-row or per-batch outcome messages.
    meta: { invalidates: [alertKeys.all(org)], silentError: true },
  });

/** An anomaly clone also lands in the anomaly configs Overview reads from its own scope. */
export const cloneAnomalyAlertMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: {
      alertId: string;
      data: { name?: string; folder_id?: string; stream_type?: string; stream_name?: string };
      folderId?: string;
    }) => alerts.clone_by_id(org, vars.alertId, vars.data, vars.folderId),
    meta: { invalidates: [alertKeys.all(org), anomalyKeys.all(org)], silentError: true },
  });

/** Only the anomaly scope drops: the caller patches the list row, since refetching a folder for one cell would lose the scroll. */
export const retrainAnomalyMutation = (org: string) =>
  mutationOptions({
    mutationFn: (alertId: string) => alerts.retrain_by_id(org, alertId),
    meta: { invalidates: [anomalyKeys.all(org)], silentError: true },
  });

/** Drops nothing: the caller patches the row, since refetching the whole folder for one cell would take the scroll with it. */
export const toggleAlertStateMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { alertId: string; enabled: boolean; folderId?: string }) =>
      alerts.toggle_state_by_alert_id(org, vars.alertId, vars.enabled, vars.folderId),
    // No `silentError`: the list's toggle chain renders no failure of its own, so the central toast is the report.
    meta: {},
  });

/** Same write for an anomaly row, which Overview also renders from its own scope. */
export const toggleAnomalyAlertStateMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { alertId: string; enabled: boolean; folderId?: string }) =>
      alerts.toggle_state_by_alert_id(org, vars.alertId, vars.enabled, vars.folderId),
    meta: { invalidates: [anomalyKeys.all(org)] },
  });
