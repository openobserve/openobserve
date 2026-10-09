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

import { keepPreviousData, mutationOptions, queryOptions } from "@tanstack/vue-query";
import downtimes from "./downtimes";
import destination from "./alert_destination";
import template from "./alert_templates";
import type {
  DowntimeDetail,
  DowntimeListItem,
  DowntimeListResponse,
  DowntimeRequest,
  ExtendDowntimeRequest,
  ExtendDowntimeResponse,
  PreviewRequest,
  PreviewResponse,
  ResourcesRequest,
  ResourcesResponse,
  ValuesResponse,
} from "./downtimes";
import { downtimeKeys } from "./downtimes.querykeys";
import { alertKeys } from "./alerts.querykeys";
import { anomalyKeys } from "./anomaly_detection.querykeys";
import { syntheticsKeys } from "./synthetics.querykeys";
import { sloKeys } from "./slos.querykeys";
import { announcementKeys } from "./announcements.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import {
  downtimeVariables,
  isEmailDestination,
  renderDowntimeTemplate,
  templateNameFor,
  testRequestFor,
  type TestDestination,
} from "@/utils/downtimes/notifyTest";

export interface DowntimeTestResult {
  destination: string;
  ok: boolean;
  unsupported?: boolean;
  error?: string;
}

/** The API caps an org at 500 downtimes, so one page holds the whole list. */
export const DOWNTIME_LIST_PAGE_SIZE = 500;

const EMPTY_LIST: DowntimeListResponse = {
  items: [],
  total: 0,
  counts: { active: 0, scheduled: 0, recurring: 0, ended: 0, cancelled: 0, ended_early: 0 },
};

/** The nearest future window start or end among the rows, in microseconds; the instant a status flips. */
export const nextListBoundary = (
  items: readonly DowntimeListItem[],
  nowMicros: number,
): number | undefined => {
  const edges = items
    .filter((row) => row.status !== "cancelled")
    .flatMap((row) => [row.next_window?.start, row.current_window?.end])
    .filter((at): at is number => typeof at === "number" && at > nowMicros);
  return edges.length ? Math.min(...edges) : undefined;
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

export interface ValuePair {
  key: string;
  value: string;
}

/** Order-free, so the same pairs in another row order hit the same cache entry. */
export const pairsHash = (pairs: ValuePair[]): string =>
  JSON.stringify(
    [...pairs]
      .map((p) => [p.key, p.value])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
  );

/** Suggested values of one dimension, narrowed by the `=` pairs typed so far. */
export const downtimeValuesQuery = (
  org: string,
  key: string,
  prefix: string,
  pairs: ValuePair[],
  folder?: string,
) =>
  queryOptions({
    queryKey: downtimeKeys.values(org, key, prefix, pairsHash(pairs), folder),
    queryFn: async (): Promise<ValuesResponse> =>
      (
        await downtimes.values(
          org,
          {
            key,
            prefix,
            condition: pairs.length
              ? {
                  type: "group",
                  op: "and",
                  items: pairs.map((p) => ({
                    type: "pair",
                    key: p.key,
                    operator: "=",
                    value: p.value,
                  })),
                }
              : null,
          },
          folder,
        )
      ).data,
    staleTime: LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
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
    meta: { invalidates: [...mutedListKeys(org), announcementKeys.all(org)], silentError: true },
  });

/** The banner refetches too, so its countdown re-arms on the new end. */
export const extendDowntimeMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: {
      id: string;
      body: ExtendDowntimeRequest;
      folder?: string;
    }): Promise<ExtendDowntimeResponse> =>
      (await downtimes.extend(org, vars.id, vars.body, vars.folder)).data,
    meta: { invalidates: [...mutedListKeys(org), announcementKeys.all(org)], silentError: true },
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

const templateBody = async (org: string, name: string): Promise<string> =>
  String(
    (await template.get_by_name({ org_identifier: org, template_name: name })).data?.body ?? "",
  );

const sendTestTo = async (
  org: string,
  dest: TestDestination,
  variables: Record<string, string>,
): Promise<DowntimeTestResult> => {
  try {
    const own = dest.template ? await templateBody(org, dest.template).catch(() => "") : "";
    const name = templateNameFor(dest, own);
    const body = name === dest.template ? own : await templateBody(org, name);
    const escape = isEmailDestination(dest) ? "html" : "json";
    const request = testRequestFor(dest, renderDowntimeTemplate(body, variables, escape));
    if (!request) return { destination: dest.name, ok: false, unsupported: true };
    const res = (await destination.test({ org_identifier: org, data: request })).data;
    return { destination: dest.name, ok: !!res?.success, error: res?.error ?? undefined };
  } catch (err: any) {
    return {
      destination: dest.name,
      ok: false,
      error: err?.response?.data?.message ?? err?.message,
    };
  }
};

export const sendDowntimeTestMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: {
      downtime: DowntimeDetail;
      destinations: TestDestination[];
      url: string;
    }): Promise<DowntimeTestResult[]> => {
      const d = vars.downtime;
      const window = d.current_window ??
        d.next_window ?? { start: d.schedule.starts_at, end: d.schedule.ends_at ?? 0 };
      const variables = downtimeVariables(d, window, vars.url);
      return Promise.all(vars.destinations.map((dest) => sendTestTo(org, dest, variables)));
    },
    meta: { silentError: true },
  });
