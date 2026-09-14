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
import anomaly_detection from "./anomaly_detection";
import { anomalyKeys } from "./anomaly_detection.querykeys";

export const anomalyConfigsQuery = (org: string) =>
  queryOptions({
    queryKey: anomalyKeys.list(org),
    queryFn: async (): Promise<any[]> => (await anomaly_detection.list(org)).data ?? [],
    refetchOnWindowFocus: true,
  });

export const anomalyHistoryQuery = (org: string, limit: number) =>
  queryOptions({
    queryKey: anomalyKeys.history(org, limit),
    queryFn: async () => (await anomaly_detection.getAllHistory(org, limit)).data,
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** Create or update, chosen by the caller; drops only the anomaly scope — the alerts list refreshes through its own `update:list` handshake. */
export const saveAnomalyConfigMutation = (org: string, id: () => string | undefined) =>
  mutationOptions({
    // `folderId` only reaches create: update addresses an existing row by id.
    mutationFn: (vars: { payload: object; folderId?: string }) => {
      const anomalyId = id();
      return anomalyId
        ? anomaly_detection.update(org, anomalyId, vars.payload)
        : anomaly_detection.create(org, vars.payload, vars.folderId);
    },
    // The form composes create-vs-update wording and renders failures inline.
    meta: { invalidates: [anomalyKeys.all(org)], silentError: true },
  });

/** Training state is part of the config row Overview renders. */
export const triggerAnomalyTrainingMutation = (org: string) =>
  mutationOptions({
    mutationFn: (anomalyId: string) => anomaly_detection.triggerTraining(org, anomalyId),
    meta: { invalidates: [anomalyKeys.all(org)], silentError: true },
  });
