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
import queryHistory, { type QueryHistoryEntry } from "./query_history";
import { queryHistoryKeys } from "./query_history.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

export const queryHistoryQuery = (org: string, starred: boolean, q: string) =>
  queryOptions({
    queryKey: queryHistoryKeys.list(org, starred, q),
    queryFn: async (): Promise<QueryHistoryEntry[]> => {
      const res = await queryHistory.list(org, {
        ...(starred ? { starred: true } : {}),
        ...(q ? { q } : {}),
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: MEDIUM_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

// A failed record is logged by the caller and never toasted: it must not
// disturb the run it belongs to.
export const recordQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: { query: string; context: Record<string, any> }) =>
      queryHistory.record(org, body),
    meta: { invalidates: [queryHistoryKeys.all(org)], silentError: true },
  });

export const starQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; starred: boolean }) =>
      queryHistory.star(org, vars.id, vars.starred),
    meta: { invalidates: [queryHistoryKeys.all(org)] },
  });

export const deleteQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => queryHistory.remove(org, id),
    meta: { invalidates: [queryHistoryKeys.all(org)] },
  });
