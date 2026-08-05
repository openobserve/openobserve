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

/**
 * Stream name lists — the app's most-shared read (Logs, Traces, Metrics,
 * Dashboards, Alerts, Pipelines, SLOs, Stream Explorer all need it before first
 * paint), hence the localStorage tier.
 *
 * One key per stream type, so a `logs` fetch no longer queues behind an
 * in-flight `traces` fetch the way the single shared promise made it.
 */

import StreamService from "@/services/stream";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";
import { useOrgQuery } from "../useOrgQuery";

export const STREAM_TYPES = [
  "logs",
  "metrics",
  "traces",
  "enrichment_tables",
  "index",
  "metadata",
] as const;

export type StreamType = (typeof STREAM_TYPES)[number];

export interface StreamSummary {
  name: string;
  stream_type: string;
  [extra: string]: unknown;
}

export const streamNameListQueryOptions = (org: string, type: string) => ({
  queryKey: qk.streams.nameList(org, type),
  queryFn: async (): Promise<StreamSummary[]> =>
    // `schema: false` deliberately — schemas are fetched per stream on demand.
    (await StreamService.nameList(org, type, false)).data.list ?? [],
  ...tierOptions("ORG_CONFIG"),
});

export const fetchStreamNameList = (org: string, type: string): Promise<StreamSummary[]> =>
  queryClient.fetchQuery(streamNameListQueryOptions(org, type));

export const invalidateStreams = (org: string, type?: string) =>
  queryClient.invalidateQueries({
    queryKey: type ? qk.streams.nameList(org, type) : qk.streams.root(org),
  });

export interface StreamPageParams {
  offset: number;
  limit: number;
  keyword?: string;
  sort?: string;
  asc?: boolean;
}

export interface StreamPage {
  list: StreamSummary[];
  total: number;
}

const streamPageOptions = (org: string, type: string, p: StreamPageParams) => ({
  queryKey: qk.streams.page(org, type || "all", p as never),
  queryFn: async (): Promise<StreamPage> => {
    const res = await StreamService.nameList(
      org,
      type,
      false,
      p.offset,
      p.limit,
      p.keyword ?? "",
      p.sort ?? "",
      p.asc ?? false,
    );
    return { list: res.data.list ?? [], total: res.data.total ?? 0 };
  },
  ...tierOptions("ENTITY_LIST"),
});

/**
 * One page of the paginated stream list (Log Streams, Stream Explorer). Paging
 * back to a page already visited is a cache hit, so the table does not blank.
 */
export const fetchStreamPage = (
  org: string,
  type: string,
  p: StreamPageParams,
): Promise<StreamPage> => queryClient.fetchQuery(streamPageOptions(org, type, p));

export const refetchStreamPage = (
  org: string,
  type: string,
  p: StreamPageParams,
): Promise<StreamPage> =>
  queryClient.fetchQuery({ ...streamPageOptions(org, type, p), staleTime: 0 });

/** Warm page N+1 so paging forward is a cache hit rather than a request. */
export const prefetchStreamPage = (org: string, type: string, p: StreamPageParams): void => {
  void queryClient.prefetchQuery(streamPageOptions(org, type, p));
};

export const useStreamNameList = (type: StreamType) =>
  useOrgQuery<StreamSummary[]>({
    key: (org) => qk.streams.nameList(org, type),
    fetch: (org) => streamNameListQueryOptions(org, type).queryFn(),
    tier: "ORG_CONFIG",
  });
