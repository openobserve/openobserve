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

import http from "./http";
import type { TimeQueryParams } from "@/utils/dashboard/urlTimeParams";

export type HistorySource = "logs" | "traces" | "metrics" | "dbm" | "profiles";
export type HistoryStatus = "ok" | "error";

/** The window a run used; start and end are microseconds. */
export interface HistoryTime {
  type: "relative" | "absolute";
  period?: string;
  start_time: number;
  end_time: number;
}

/** What a page stores to restore a run; the backend never reads it. */
export interface HistoryContext {
  page?: Record<string, string>;
  time?: HistoryTime;
  error?: string;
  warning?: string;
  time_range?: TimeQueryParams;
  step?: string | null;
  chart_type?: string;
  metrics_data?: string;
}

export interface QueryHistoryEntry {
  id: string;
  source: HistorySource;
  query: string;
  query_key: string | null;
  streams: string[];
  context: HistoryContext;
  status: HistoryStatus;
  starred: boolean;
  run_count: number;
  /** First run, microseconds since the epoch. */
  created_at: number;
  /** Latest run, microseconds since the epoch. */
  updated_at: number;
}

export interface QueryHistoryRecordBody {
  source: HistorySource;
  query: string;
  query_key: string;
  streams: string[];
  status: HistoryStatus;
  context: HistoryContext;
}

export interface QueryHistoryListParams {
  /** One source or a comma-separated list. */
  source?: string;
  status?: HistoryStatus;
  stream?: string;
  q?: string;
  starred?: boolean;
  ran_from?: number;
  ran_to?: number;
  limit?: number;
  offset?: number;
  /** Answer `{ count }` for the filters instead of the entries. */
  count_only?: boolean;
}

export interface QueryHistoryClearParams {
  source?: string;
  include_starred?: boolean;
}

const base = (org: string) => `/api/${org}/query_history`;
const entry = (org: string, id: string) => `${base(org)}/${encodeURIComponent(id)}`;

const queryHistory = {
  record: (org: string, body: QueryHistoryRecordBody) => http().post(base(org), body),
  list: (org: string, params: QueryHistoryListParams) => http().get(base(org), { params }),
  count: (org: string, params: QueryHistoryListParams) =>
    http().get<{ count: number }>(base(org), { params: { ...params, count_only: true } }),
  star: (org: string, id: string, starred: boolean) => http().patch(entry(org, id), { starred }),
  remove: (org: string, id: string) => http().delete(entry(org, id)),
  clear: (org: string, params: QueryHistoryClearParams) =>
    http().delete<{ deleted: number }>(base(org), { params }),
};

export default queryHistory;
