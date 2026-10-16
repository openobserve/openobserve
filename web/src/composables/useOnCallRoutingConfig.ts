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

/**
 * The org's catch-all team, read once and shared.
 *
 * Three components asked for it independently — the card that SETS it, the
 * ownership table that shows it as the last row, and the policy editor, which
 * warns when a ladder ends in `notify_default_team` and nobody is nominated.
 * Two of them render on the Routing screen at the same time, so the same tiny
 * request went out twice and the two copies could disagree the moment one was
 * written: nominating a catch-all left the warning in the drawer still saying
 * there was none, because nothing told it.
 *
 * Sharing is now the query cache's job — org-rooted keys, one in-flight request
 * per key, and a purge on org switch, all of which this file used to hand-roll.
 * The refs below only mirror the entry for templates that read it synchronously.
 *
 * @example
 * const { config, load, refresh } = useOnCallRoutingConfig();
 * onMounted(() => load(orgId.value));      // cache-first
 * await refresh(orgId.value);              // after a write
 */
const config = ref<RoutingConfig | null>(null);
/** True while a read is in flight, so a caller can tell "unset" from "not loaded yet". */
const loading = ref(false);

async function read(orgId: string, force: boolean): Promise<void> {
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
  } catch {
    // Unset is the honest reading of "could not load": neither state claims a
    // catch-all exists, and a failed read must not make one appear or vanish.
    config.value = null;
  } finally {
    loading.value = false;
  }
}

export function useOnCallRoutingConfig() {
  /** Cache-first: inside the tier this resolves without a request. */
  function load(orgId: string): Promise<void> {
    return read(orgId, false);
  }

  /** Re-reads unconditionally. Call after writing the config. */
  function refresh(orgId: string): Promise<void> {
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
