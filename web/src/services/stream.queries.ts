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
import stream from "./stream";
import type { StreamPageParams } from "./stream";
import { streamKeys } from "./stream.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

export const STREAM_PROBE_PAGE = 20;

export const streamNameListQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: streamKeys.nameList(org, type),
    // `schema: false` deliberately — schemas are fetched per stream on demand.
    queryFn: async (): Promise<any[]> => (await stream.nameList(org, type, false)).data.list ?? [],
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
