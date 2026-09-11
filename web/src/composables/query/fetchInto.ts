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

import type { Ref } from "vue";
import { queryClient } from "./queryClient";

/**
 * Read a query into refs a component already owns.
 *
 * **Prefer `useQuery`.** This exists for call sites that cannot use it yet —
 * Options API components, and imperative flows that sequence a read against
 * toasts or a second request. Unlike `useQuery`, what it writes is a *snapshot*:
 * an invalidation elsewhere will not repaint it. Every remaining caller is a
 * candidate for conversion, not a pattern to copy.
 *
 * It deliberately takes a plain options object rather than wrapping the query,
 * so the declaration in `<domain>.queries.ts` is still the single unit and this
 * stays a consumer-side convenience:
 *
 *   fetchInto(pipelinesQuery(org), { apply: (rows) => (list.value = rows), loading, fetching });
 *
 * `loading` is the cold-read skeleton (nothing on screen yet); `fetching` is any
 * request in flight, including one with rows already painted.
 */
// `T` defaults to `any` because it is only inferable from `apply`, a
// contravariant position — without the default every call site would infer
// `unknown` and fail at the apply callback.
export async function fetchInto<T = any>(
  // Structurally whatever `queryOptions()` returned: `queryFn` is optional in
  // that type, so requiring it here would reject every real caller.
  options: { queryKey: readonly unknown[]; [k: string]: any },
  opts: {
    apply: (data: T) => void;
    loading?: Ref<boolean>;
    fetching?: Ref<boolean>;
    force?: boolean;
  },
): Promise<T> {
  // Paint what is already in hand first — including on a forced refresh — so the
  // rows on screen never disappear while the request runs.
  const cached = queryClient.getQueryData<T>(options.queryKey);
  if (cached !== undefined) opts.apply(cached);

  if (opts.loading) opts.loading.value = cached === undefined;
  if (opts.fetching) opts.fetching.value = true;

  try {
    // Force by invalidating, not by spreading `staleTime: 0` into fetchQuery —
    // query.fetch() stores the passed options, so the 0 would become the
    // entry's standing freshness policy for every later observer.
    if (opts.force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const fresh = await queryClient.fetchQuery(options as any);
    opts.apply(fresh as T);
    return fresh as T;
  } finally {
    if (opts.loading) opts.loading.value = false;
    if (opts.fetching) opts.fetching.value = false;
  }
}

export default fetchInto;
