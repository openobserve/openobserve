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

import type { FetchQueryOptions, QueryKey } from "@tanstack/vue-query";
import { queryClient } from "./queryClient";

/// What a declared query's `queryFn` resolves to; a `skipToken` contributes nothing.
type QueryData<O> = O extends { queryFn?: infer F }
  ? F extends (...args: never[]) => infer R
    ? Awaited<R>
    : never
  : never;

/// Cache-first read of a declared query; `force` expires the entry first, so a refresh costs one request, not two.
export async function readQuery<O extends { queryKey: QueryKey; queryFn?: unknown }>(
  options: O,
  force = false,
): Promise<QueryData<O>> {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  // vue-query's `queryOptions()` result is a ref-friendly superset that only the overloads accept, not `FetchQueryOptions` itself.
  return queryClient.fetchQuery(options as unknown as FetchQueryOptions<QueryData<O>>);
}

export default readQuery;
