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

import { readonly, ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import { routingConfigQuery } from "@/services/oncall.queries";
import type { RoutingConfig } from "@/ts/interfaces/oncall";
import { licenseDeniedFeatures } from "@/utils/featureGate";

/** One shared read of the org's catch-all team, so every screen that shows it sees the same value. */
const config = ref<RoutingConfig | null>(null);
/** True while a read is in flight, so a caller can tell "unset" from "not loaded yet". */
const loading = ref(false);

/** Resolves to the missing features when the license refused the read, so the page can lock. */
async function read(orgId: string, force: boolean): Promise<string[] | null> {
  const options = routingConfigQuery(orgId);
  loading.value = true;
  try {
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    config.value = await queryClient.fetchQuery(options);
    return null;
  } catch (err) {
    // Unset is the honest reading of "could not load": neither state claims a
    // catch-all exists, and a failed read must not make one appear or vanish.
    config.value = null;
    return licenseDeniedFeatures(err);
  } finally {
    loading.value = false;
  }
}

export function useOnCallRoutingConfig() {
  /** Cache-first: inside the tier this resolves without a request. */
  function load(orgId: string): Promise<string[] | null> {
    return read(orgId, false);
  }

  /** Re-reads unconditionally. Call after writing the config. */
  function refresh(orgId: string): Promise<string[] | null> {
    return read(orgId, true);
  }

  return { config: readonly(config), loading: readonly(loading), load, refresh };
}

/** Test seam — drops the cached entry, whatever org it was read for, and the mirrored refs. */
export function __resetOnCallRoutingConfig() {
  config.value = null;
  loading.value = false;
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[2] === "oncall" && query.queryKey[3] === "routing",
  });
}
