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

import { MutationCache, QueryClient } from "@tanstack/vue-query";
import { purgeAllPersisted, purgePersistedOrg } from "./persisters";
import { DEFAULT_STALE_TIME } from "./cachePolicy";
// Type-only: erased at build time. This module must not pull UI or i18n into its
// runtime graph — the unit-test setup imports it eagerly, so a runtime edge here
// evaluates that module before a spec's `vi.mock` can replace it.
import type { I18nText } from "@/types/i18n";

type MutationNotifier = (variant: "success" | "error", message: I18nText) => void;

let notifyMutation: MutationNotifier = () => {};

/**
 * Wired once in `main.ts`, so the toast implementation stays out of this file's
 * import graph (see the note on the type-only import above). Unwired, mutation
 * feedback is simply silent — which is what a unit test wants by default.
 */
export const setMutationNotifier = (fn: MutationNotifier): void => {
  notifyMutation = fn;
};

/** `raw()` from @/types/i18n, inlined to avoid importing that module at runtime. */
const asText = (value: string): I18nText => value as unknown as I18nText;

/**
 * What a write declares about itself, next to the endpoint it calls.
 *
 * TanStack passes the mutation through to the cache-level callbacks below, so
 * this is read once, centrally — a component never invalidates anything by hand
 * and never repeats the success/error toast.
 */
declare module "@tanstack/query-core" {
  interface Register {
    mutationMeta: {
      /** Scopes to refetch. Prefer a domain's `all` key over a precise one. */
      invalidates?: readonly (readonly unknown[])[];
      /**
       * Scopes whose *inactive* entries are dropped outright. Use after a
       * delete: invalidation alone leaves the deleted entity's detail query
       * cached and ready to serve the next reader.
       */
      removes?: readonly (readonly unknown[])[];
      successMessage?: I18nText;
      /**
       * Set when the call site renders the failure itself — a field error, or a
       * toast with an action button. Suppresses the default error toast only;
       * `invalidates`/`removes` are unaffected (they never run on error).
       */
      silentError?: boolean;
    };
  }
}

// Server-authored text: it has no translation key, so it passes through as-is.
const serverMessage = (err: any): I18nText =>
  asText(
    err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? "Request failed",
  );

export const queryClient = new QueryClient({
  /**
   * Declarative invalidation, applied to every mutation that opts in by
   * declaring `meta`. A mutation with no `meta` is untouched, which is what
   * makes the migration to this incremental.
   */
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _onMutateResult, mutation) => {
      const meta = mutation.meta;
      if (!meta) return;
      for (const key of meta.removes ?? []) {
        queryClient.removeQueries({ queryKey: key, type: "inactive" });
      }
      for (const key of meta.invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (meta.successMessage) {
        notifyMutation("success", meta.successMessage);
      }
    },
    onError: (err: any, _vars, _onMutateResult, mutation) => {
      const meta = mutation.meta;
      if (!meta || meta.silentError) return;
      // 403s are surfaced by the shared http interceptor, not per call site.
      if (err?.response?.status === 403) return;
      notifyMutation("error", serverMessage(err));
    },
  }),
  defaultOptions: {
    queries: {
      // The common freshness window. A declaration only states staleTime when
      // it is genuinely different — see cachePolicy.ts.
      staleTime: DEFAULT_STALE_TIME,
      retry: (failureCount: number, err: any) => {
        const status = err?.response?.status;
        // 4xx are the caller's fault; 501 is a disabled feature — both permanent.
        if (status === 400 || status === 401 || status === 403 || status === 404 || status === 501)
          return false;
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

// The key convention now lives in `keys.ts` — re-exported so the ~40 existing
// importers of `GLOBAL_SCOPE` need no edit.
export { GLOBAL_SCOPE, orgKey, globalKey } from "./keys";

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
