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
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import kv from "./kv";
import { kvKeys } from "./kv.querykeys";

export const kvKeysQuery = (org: string, prefix: string) =>
  queryOptions({
    queryKey: kvKeys.list(org, prefix),
    queryFn: async (): Promise<string[]> => (await kv.list(org, prefix)).data ?? [],
    staleTime: LIVE_STALE_TIME,
  });

/** A missing key reads as null; the endpoint answers 404 for it. */
export const kvValueQuery = (org: string, key: string) =>
  queryOptions({
    queryKey: kvKeys.value(org, key),
    queryFn: async (): Promise<string | null> => {
      try {
        return (await kv.get(org, key)).data;
      } catch (error: any) {
        if (error?.response?.status === 404) return null;
        throw error;
      }
    },
    staleTime: LIVE_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const setKvMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { key: string; value: string }) => kv.set(org, vars.key, vars.value),
    meta: { invalidates: [kvKeys.all(org)], silentError: true },
  });

export const deleteKvMutation = (org: string) =>
  mutationOptions({
    mutationFn: (key: string) => kv.delete(org, key),
    meta: { invalidates: [kvKeys.all(org)], silentError: true },
  });
