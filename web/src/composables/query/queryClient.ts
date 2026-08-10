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

import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { QueryClient, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { purgeAllPersisted, purgePersistedOrg } from "./persisters";
import { tierOptions } from "./tiers";
import type { PersistTarget, TierName } from "./tiers";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Defaults exist only so a query without a tier is not wildly wrong —
      // every real query picks a tier from `tiers.ts`.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount: number, err: any) => {
        const status = err?.response?.status;
        // 4xx are the caller's fault; retrying just multiplies the error toast.
        if (status === 400 || status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      // Off by default: this console is often left open on a wall display and
      // several endpoints are expensive. Cheap volatile lists opt back in via
      // their tier.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

/**
 * Called on org switch with the org being left. Drops that org's *persisted*
 * entries only — the in-memory ones stay.
 *
 * Keeping memory is safe because every key is rooted at ["org", id], so one
 * org's data can never be served to another, and gcTime collects it anyway.
 * The payoff is that switching back to a recent org inside its staleTime costs
 * no requests at all.
 *
 * Disk is different: localStorage is a ~5 MB budget shared with the whole app,
 * so persisting every org visited would eventually hit quota (silently — the
 * storage wrapper swallows it), and the previous tenant's stream, folder and
 * function names would sit on a possibly shared machine.
 */
export const purgeOrgQueries = (org: string): void => {
  if (!org) return;
  void purgePersistedOrg(org);
};

/** Called on logout: nothing from the previous session may survive. */
export const purgeAllQueries = (): void => {
  queryClient.clear();
  void purgeAllPersisted();
};

// ── Key helpers ─────────────────────────────────────────────────────────────

/** Org segment for reads that are not org-scoped (app config, build info). */
export const GLOBAL_SCOPE = "__global__";

/**
 * Build a filter object with a stable field order. TanStack hashes keys with a
 * deterministic stringify, so ordering does not affect correctness — it keeps
 * DevTools readable and stops key shapes drifting between call sites.
 */
export const stableFilters = <T extends Record<string, unknown>>(filters: T): T => {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === undefined || value === "" || value === null) continue;
    out[key] = value;
  }
  return out as T;
};

/**
 * Round a relative time range to a bucket so it can be part of a cache key.
 *
 * A range computed from `Date.now()` is different on every mount, so a key
 * containing the raw timestamps can never hit. Bucketing means remounting
 * inside the bucket reuses the key, while a real range change still forks it.
 * The request still carries the caller's exact timestamps; only the key rounds.
 */
export const quantizeRange = (
  startTime: number,
  endTime: number,
  bucketMs = 60_000,
): { start: number; end: number } => {
  // Micro-second epochs are the norm in this app; detect and scale the bucket.
  const bucket = String(Math.trunc(endTime)).length > 14 ? bucketMs * 1000 : bucketMs;
  return {
    start: Math.floor(startTime / bucket) * bucket,
    end: Math.floor(endTime / bucket) * bucket,
  };
};

// ── defineQuery ─────────────────────────────────────────────────────────────

type KeySegments = readonly unknown[];

export interface QueryDefinition<TArgs extends unknown[], TData> {
  /**
   * Key segments *after* `["org", org]`. A function when the key is
   * parameterised — it receives the same arguments as `fetch`, minus the org.
   */
  key: KeySegments | ((...args: TArgs) => KeySegments);
  fetch: (org: string, ...args: TArgs) => Promise<TData>;
  tier: TierName;
  /** Force persistence off (secrets) or on. Defaults to the tier's policy. */
  persist?: PersistTarget;
  /**
   * Prefix that `invalidate()` drops. Defaults to the first key segment, which
   * is right for a static key; a parameterised key should state it, so that
   * sibling queries in the same domain are dropped together.
   */
  scope?: KeySegments;
}

/**
 * Declare a cached read next to the endpoint it calls.
 *
 * The full key is `["org", org, ...key]`, so the org-switch and logout purges
 * find it without the declaration doing anything, and `scope` is the prefix that
 * invalidation drops.
 *
 *   export const foldersQuery = defineQuery({
 *     key:   (type: string) => ["folders", type],
 *     fetch: (org, type: string) => common.list_Folders(org, type).then(r => r.data.list),
 *     tier:  "ORG_CONFIG",
 *     scope: ["folders"],
 *   });
 *
 * Then `foldersQuery.get(org, "dashboards")` to read, `.refresh(...)` behind a
 * refresh button or after a write, and `.invalidate(org)` from a mutation.
 */
export function defineQuery<TArgs extends unknown[] = [], TData = unknown>(
  def: QueryDefinition<TArgs, TData>,
) {
  const segments = (...args: TArgs): KeySegments =>
    typeof def.key === "function" ? def.key(...args) : def.key;

  const fullKey = (org: string, ...args: TArgs) => ["org", org, ...segments(...args)] as const;

  const scopeKey = (org: string) => {
    const prefix = def.scope ?? (typeof def.key === "function" ? [] : def.key.slice(0, 1));
    return ["org", org, ...prefix] as const;
  };

  const options = (org: string, ...args: TArgs) => ({
    queryKey: fullKey(org, ...args),
    queryFn: () => def.fetch(org, ...args),
    ...tierOptions(def.tier, { persist: def.persist }),
  });

  return {
    /** Marks the object as a query for test helpers that automock a service. */
    __isQuery: true as const,

    /** Cached read — no request while the entry is fresh. */
    get: (org: string, ...args: TArgs): Promise<TData> =>
      queryClient.fetchQuery(options(org, ...args)),

    /** Bypasses staleTime: refresh buttons, post-write reloads, explicit search. */
    refresh: (org: string, ...args: TArgs): Promise<TData> =>
      queryClient.fetchQuery({ ...options(org, ...args), staleTime: 0 }),

    /**
     * Stale-while-revalidate, for imperative loaders.
     *
     * `get()` on a stale entry waits for the network — the cached value is
     * still in the cache, but the page blanks and spins until the response
     * lands. This hands the cached value back first and revalidates behind it:
     *
     *   const { cached, fresh } = thingQuery.swr(org);
     *   if (cached) rows.value = shape(cached);
     *   else loading.value = true;
     *   rows.value = shape(await fresh);
     *   loading.value = false;
     *
     * `fresh` respects the tier, so a still-fresh entry resolves from cache
     * with no request and the second assignment is a no-op repaint.
     */
    swr: (org: string, ...args: TArgs): { cached: TData | undefined; fresh: Promise<TData> } => ({
      cached: queryClient.getQueryData<TData>(fullKey(org, ...args)),
      fresh: queryClient.fetchQuery(options(org, ...args)),
    }),

    /**
     * Rewrite every cached entry under the scope, in place, with no request.
     *
     * For deletes: the row has to disappear from the pages the user is *not*
     * looking at too, or the next cached paint brings it back. `invalidate`
     * cannot do this — it keeps the data, and keeping it is the problem.
     */
    patchAll: (org: string, update: (data: TData) => TData) =>
      queryClient.setQueriesData({ queryKey: scopeKey(org) }, (old: unknown) =>
        old === undefined ? old : update(old as TData),
      ),

    /**
     * The cached value, or undefined — no request either way.
     *
     * For loaders whose response handler has side effects (opens a dialog,
     * fires a second request) and so cannot be run twice: they still read once,
     * but can skip the spinner when there is something already on screen.
     * `swr()` starts its refetch eagerly, so it is the wrong tool for a peek.
     */
    peek: (org: string, ...args: TArgs): TData | undefined =>
      queryClient.getQueryData<TData>(fullKey(org, ...args)),

    /** Drop this query's scope so the next read goes to the server. */
    invalidate: (org: string) => queryClient.invalidateQueries({ queryKey: scopeKey(org) }),

    /**
     * Drop inactive entries outright. Use after a delete — invalidation alone
     * leaves the deleted entity cached and ready to serve the next reader.
     */
    remove: (org: string) =>
      queryClient.removeQueries({ queryKey: scopeKey(org), type: "inactive" }),

    /** Seed a value the caller already applied optimistically. */
    prime: (org: string, data: TData, ...args: TArgs) =>
      queryClient.setQueryData(fullKey(org, ...args), data),

    /** Reactive form, for a `setup()` that wants isPending / isFetching. */
    use: (
      argsFn: () => TArgs,
      opts: {
        enabled?: MaybeRefOrGetter<boolean>;
        refetchInterval?: MaybeRefOrGetter<number | false>;
      } = {},
    ) => {
      const store = useStore();
      const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
      return useQuery(
        {
          queryKey: computed(() => fullKey(org.value, ...argsFn())),
          queryFn: () => def.fetch(org.value, ...argsFn()),
          enabled: computed(() => !!org.value && (toValue(opts.enabled) ?? true)),
          refetchInterval: opts.refetchInterval as never,
          ...tierOptions(def.tier, { persist: def.persist }),
        },
        queryClient,
      );
    },

    /** Warm an entry without rendering it — next-page prefetch, hover prefetch. */
    prefetch: (org: string, ...args: TArgs): void => {
      void queryClient.prefetchQuery(options(org, ...args));
    },

    /** The raw options, for one-off client calls. */
    options,
    key: fullKey,
  };
}

/**
 * A read that is not org-scoped — `/config`, the org list itself, the license.
 * Same declaration, minus the org argument: the key is rooted at
 * `["org", GLOBAL_SCOPE, ...]` so the logout purge still reaches it, while the
 * org-switch purge deliberately does not.
 */
export function defineGlobalQuery<TArgs extends unknown[] = [], TData = unknown>(
  def: Omit<QueryDefinition<TArgs, TData>, "fetch"> & { fetch: (...args: TArgs) => Promise<TData> },
) {
  const q = defineQuery<TArgs, TData>({
    ...def,
    fetch: (_org: string, ...args: TArgs) => def.fetch(...args),
  });
  return {
    __isQuery: true as const,
    get: (...args: TArgs) => q.get(GLOBAL_SCOPE, ...args),
    refresh: (...args: TArgs) => q.refresh(GLOBAL_SCOPE, ...args),
    invalidate: () => q.invalidate(GLOBAL_SCOPE),
    remove: () => q.remove(GLOBAL_SCOPE),
    prime: (data: TData, ...args: TArgs) => q.prime(GLOBAL_SCOPE, data, ...args),
    prefetch: (...args: TArgs) => q.prefetch(GLOBAL_SCOPE, ...args),
    options: (...args: TArgs) => q.options(GLOBAL_SCOPE, ...args),
    key: (...args: TArgs) => q.key(GLOBAL_SCOPE, ...args),
  };
}
