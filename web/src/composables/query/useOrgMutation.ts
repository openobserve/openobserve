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

import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "./queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "./useOrgQuery";

export interface OrgMutationOptions<TVars, TData> {
  mutate: (org: string, vars: TVars) => Promise<TData>;
  /** Key prefixes to refetch. Prefer a root prefix over a precise key. */
  invalidates?: (org: string, vars: TVars) => readonly (readonly unknown[])[];
  /**
   * Key prefixes whose *inactive* entries are dropped outright. Use after a
   * delete: invalidation alone leaves the deleted entity's detail query in the
   * cache, ready to be served to the next reader.
   */
  removes?: (org: string, vars: TVars) => readonly (readonly unknown[])[];
  /** Only for toggles and single-field edits. Anything reshaping a row: invalidate. */
  optimistic?: {
    key: (org: string, vars: TVars) => readonly unknown[];
    update: (old: any, vars: TVars) => any;
  };
  successMessage?: string;
  /** Defaults to the server's message, falling back to a generic error. */
  errorMessage?: (err: any) => string;
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: any, vars: TVars) => void;
}

const defaultErrorMessage = (err: any): string =>
  err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? "Request failed";

/**
 * A write plus its declarative invalidation. Replaces the "mutate, then re-call
 * the page's loader" pattern — the loader call becomes an `invalidates` entry,
 * so only the queries actually mounted refetch.
 */
export function useOrgMutation<TVars = void, TData = unknown>(
  opts: OrgMutationOptions<TVars, TData>,
) {
  const org = useOrgId();

  return useMutation<TData, any, TVars, { previous?: unknown; key?: readonly unknown[] }>(
    {
      mutationFn: (vars: TVars) => opts.mutate(org.value, vars),

      onMutate: async (vars) => {
        if (!opts.optimistic) return {};
        const key = opts.optimistic.key(org.value, vars);
        // Cancel in-flight refetches so a late response cannot overwrite the
        // optimistic value.
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData(key);
        queryClient.setQueryData(key, (old: any) => opts.optimistic!.update(old, vars));
        return { previous, key };
      },

      onError: (err, vars, context) => {
        if (context?.key) queryClient.setQueryData(context.key, context.previous);
        toast({
          variant: "error",
          message: (opts.errorMessage ?? defaultErrorMessage)(err),
        });
        opts.onError?.(err, vars);
      },

      onSuccess: (data, vars) => {
        for (const key of opts.removes?.(org.value, vars) ?? []) {
          queryClient.removeQueries({ queryKey: key, type: "inactive" });
        }
        for (const key of opts.invalidates?.(org.value, vars) ?? []) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        if (opts.successMessage) {
          toast({ variant: "success", message: opts.successMessage });
        }
        opts.onSuccess?.(data, vars);
      },
    },
    queryClient,
  );
}

export default useOrgMutation;
