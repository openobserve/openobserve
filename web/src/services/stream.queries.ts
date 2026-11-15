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

import { hashKey, mutationOptions, queryOptions, type QueryClient } from "@tanstack/vue-query";
import stream from "./stream";
import type { StreamPageParams } from "./stream";
import { streamKeys } from "./stream.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";

export const STREAM_PROBE_PAGE = 20;

/** How old a read one caller just made may be and still answer another caller's first read. */
export const SHARED_READ_MS = 2_000;

// The header's data probe reads each list under its own key as a page loads; the page's list shares that read.
const probeRead = (client: QueryClient, org: string, type: string) =>
  client.getQueryCache().find<any[]>({ queryKey: streamKeys.hasDataProbe(org, type), exact: true });

const recentProbeData = (org: string, type: string) => {
  const state = probeRead(queryClient, org, type)?.state;
  if (state?.status !== "success" || Date.now() - state.dataUpdatedAt > SHARED_READ_MS) return;
  return state;
};

export const streamNameListQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: streamKeys.nameList(org, type),
    queryFn: ({ client, queryKey }): Promise<any[]> => {
      // `schema: false` deliberately — schemas are fetched per stream on demand.
      const own = () => stream.nameList(org, type, false).then((res) => res.data.list ?? []);
      const probe = probeRead(client, org, type);
      const inFlight =
        probe?.state.fetchStatus === "fetching" &&
        probe.queryHash !== hashKey(queryKey) &&
        // A refresh or a write invalidates the entry, and those ask the server themselves.
        !client.getQueryState(queryKey)?.isInvalidated
          ? probe.promise
          : undefined;
      return inFlight ? inFlight.then((list) => list ?? [], own) : own();
    },
    // Seeds only a new entry, so a refresh of the page's list still reaches the server.
    initialData: () => recentProbeData(org, type)?.data,
    initialDataUpdatedAt: () => recentProbeData(org, type)?.dataUpdatedAt,
    staleTime: MEDIUM_STALE_TIME,
  });

export const streamPageQuery = (org: string, type: string, params: StreamPageParams) =>
  queryOptions({
    queryKey: streamKeys.page(org, type, params),
    queryFn: async (): Promise<{ list: any[]; total: number }> => {
      const res = await stream.nameList(
        org,
        type,
        false,
        params.offset,
        params.limit,
        params.keyword ?? "",
        params.sort ?? "",
        params.asc ?? false,
      );
      return { list: res.data.list ?? [], total: res.data.total ?? 0 };
    },
    staleTime: MEDIUM_STALE_TIME,
  });

/** A bounded first-event probe: one row for a type's total, or a 20-row page of a keyword match; always re-read because it is a poll. */
export const streamProbeQuery = (org: string, type: string, keyword?: string, offset = 0) => {
  const params: StreamPageParams = keyword
    ? { offset, limit: STREAM_PROBE_PAGE, keyword }
    : { offset: 0, limit: 1 };
  return queryOptions({
    queryKey: streamKeys.page(org, type, params),
    queryFn: async (): Promise<{ list: any[]; total: number }> => {
      const res = await stream.nameList(
        org,
        type,
        false,
        params.offset,
        params.limit,
        params.keyword ?? "",
      );
      return { list: res.data.list ?? [], total: res.data.total ?? 0 };
    },
    staleTime: 0,
    retry: false,
  });
};

/** Resolves to the payload, not the axios envelope, so the cache never holds an XHR object; `useStreams` keeps its own copy on purpose. */
export const streamSchemaQuery = (org: string, streamName: string, type: string) =>
  queryOptions({
    queryKey: streamKeys.schema(org, type, streamName),
    queryFn: async (): Promise<any> => (await stream.schema(org, streamName, type)).data,
    staleTime: MEDIUM_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** `streamKeys.all` is the scope: a stream write can touch the name lists, the paged list and every cached schema. */
export const createStreamMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { name: string; type: string; payload: any }) =>
      stream.createStream(org, vars.name, vars.type, vars.payload),
    // The dialog renders the failure against its own fields.
    meta: { invalidates: [streamKeys.all(org)], silentError: true },
  });

export const updateStreamSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { name: string; type: string; settings: any }) =>
      stream.updateSettings(org, vars.name, vars.type, vars.settings),
    meta: { invalidates: [streamKeys.all(org)], silentError: true },
  });

export const deleteStreamFieldsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { name: string; type: string; fields: [] }) =>
      stream.deleteFields(org, vars.name, vars.type, vars.fields),
    meta: { invalidates: [streamKeys.all(org)], silentError: true },
  });
