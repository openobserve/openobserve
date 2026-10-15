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

export interface QueryHistoryEntry {
  id: string;
  query: string;
  context: Record<string, any>;
  starred: boolean;
  /** Microseconds since the epoch. */
  created_at: number;
}

export interface QueryHistoryListParams {
  starred?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

const base = (org: string) => `/api/${org}/query_history`;
const entry = (org: string, id: string) => `${base(org)}/${encodeURIComponent(id)}`;

const queryHistory = {
  record: (org: string, body: { query: string; context: Record<string, any> }) =>
    http().post(base(org), body),
  list: (org: string, params: QueryHistoryListParams) => http().get(base(org), { params }),
  star: (org: string, id: string, starred: boolean) => http().patch(entry(org, id), { starred }),
  remove: (org: string, id: string) => http().delete(entry(org, id)),
};

export default queryHistory;
