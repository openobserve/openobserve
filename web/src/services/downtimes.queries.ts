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
import downtimes from "./downtimes";
import type {
  DowntimeDetail,
  DowntimeListResponse,
  DowntimeRequest,
  PreviewRequest,
  PreviewResponse,
  ResourcesRequest,
  ResourcesResponse,
} from "./downtimes";
import { downtimeKeys } from "./downtimes.querykeys";
import { alertKeys } from "./alerts.querykeys";
import { anomalyKeys } from "./anomaly_detection.querykeys";
import { syntheticsKeys } from "./synthetics.querykeys";
import { sloKeys } from "./slos.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

/** The API caps an org at 500 downtimes, so one page holds the whole list. */
export const DOWNTIME_LIST_PAGE_SIZE = 500;

const EMPTY_LIST: DowntimeListResponse = {
  items: [],
  total: 0,
  counts: { active: 0, scheduled: 0, recurring: 0, ended: 0, cancelled: 0 },
};

export const downtimesListQuery = (org: string) =>
  queryOptions({
    queryKey: downtimeKeys.list(org),
    queryFn: async (): Promise<DowntimeListResponse> => {
      const data = (await downtimes.list(org, { page: 1, page_size: DOWNTIME_LIST_PAGE_SIZE }))
        .data;
      return { ...EMPTY_LIST, ...data, items: data?.items ?? [] };
    },
    staleTime: LIVE_STALE_TIME,
  });

export const downtimeDetailQuery = (org: string, id: string, folder?: string) =>
  queryOptions({
    queryKey: downtimeKeys.detail(org, id),
    queryFn: async (): Promise<DowntimeDetail> => (await downtimes.get(org, id, folder)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const downtimePreviewQuery = (org: string, body: PreviewRequest, folder?: string) =>
  queryOptions({
    queryKey: downtimeKeys.preview(org, { body, folder }),
    queryFn: async (): Promise<PreviewResponse> =>
      (await downtimes.preview(org, body, folder)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const downtimeResourcesQuery = (org: string, body: ResourcesRequest, folder?: string) =>
  queryOptions({
    queryKey: downtimeKeys.resources(org, { body, folder }),
    queryFn: async (): Promise<ResourcesResponse> =>
      (await downtimes.resources(org, body, folder)).data,
    staleTime: LIVE_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** A downtime changes the Muted chip on every list it can cover. */
const mutedListKeys = (org: string) => [
  downtimeKeys.all(org),
  alertKeys.all(org),
  anomalyKeys.all(org),
  syntheticsKeys.all(org),
  sloKeys.all(org),
];

export const saveDowntimeMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id?: string; body: DowntimeRequest }) =>
      vars.id ? downtimes.update(org, vars.id, vars.body) : downtimes.create(org, vars.body),
    meta: { invalidates: mutedListKeys(org), silentError: true },
  });

export const quickMuteMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: DowntimeRequest) => (await downtimes.create(org, body)).data,
    meta: { invalidates: mutedListKeys(org), silentError: true },
  });

export const cancelDowntimeMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; folder?: string }) =>
      downtimes.cancel(org, vars.id, vars.folder),
    meta: { invalidates: mutedListKeys(org), silentError: true },
  });

export const deleteDowntimeMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; folder?: string }) =>
      downtimes.remove(org, vars.id, vars.folder),
    meta: {
      invalidates: [downtimeKeys.all(org)],
      removes: [downtimeKeys.all(org)],
      silentError: true,
    },
  });

export const moveDowntimesMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { ids: string[]; dstFolderId: string; folder?: string }) =>
      downtimes.move(org, vars.ids, vars.dstFolderId, vars.folder),
    meta: { invalidates: [downtimeKeys.all(org)], silentError: true },
  });
