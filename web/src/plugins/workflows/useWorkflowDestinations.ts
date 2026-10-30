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

import { computed, ref } from "vue";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { queryClient } from "@/composables/query/queryClient";
import type { Destination } from "@/ts/interfaces/alert";

/**
 * Shared, load-once lookup of the org's PIPELINE destinations, keyed by name.
 *
 * A workflow node stores only the destination's name, so the read-only run view has
 * to resolve it. There is no single-record endpoint that can do that: `get_by_name`
 * hits `/alerts/destinations/{name}` with no `module` parameter and 404s on a
 * pipeline destination. The list endpoint is the only one that accepts `module`.
 *
 * It reads the shared pipeline-destinations query, so stepping through a run's
 * nodes issues one call, the list expires on the destinations tier, and a
 * destination save anywhere in the app refreshes it.
 */
const byName = ref<Record<string, Destination>>({});
const loadedOrg = ref<string | null>(null);
const loadFailed = ref(false);
let inflight: Promise<void> | null = null;

const fetchDestinations = async (org: string) => {
  try {
    const list = await queryClient.fetchQuery(destinationsQuery(org, "pipeline"));
    const map: Record<string, Destination> = {};
    for (const d of list || []) map[d.name] = d;
    byName.value = map;
    loadedOrg.value = org;
    loadFailed.value = false;
  } catch {
    // Leave the cache empty and record the failure — callers must not report
    // "no longer exists" when the truth is that the lookup never completed.
    byName.value = {};
    loadedOrg.value = org;
    loadFailed.value = true;
  } finally {
    inflight = null;
  }
};

/** Loads the destination map; the query cache decides whether that costs a request. */
export const ensureWorkflowDestinations = (org: string): Promise<void> => {
  if (!inflight) inflight = fetchDestinations(org);
  return inflight;
};

/** Drops the cache so the next ensure() refetches (org switch, or a fresh run view). */
export const resetWorkflowDestinations = () => {
  byName.value = {};
  loadedOrg.value = null;
  loadFailed.value = false;
  inflight = null;
};

/**
 * True once a lookup has COMPLETED successfully — distinct from "the map is empty",
 * which is also what a failed call and an org with no destinations both look like.
 * Only a caller that sees this can tell "not found" apart from "not known yet".
 */
const loaded = computed(() => loadedOrg.value !== null && !loadFailed.value);

export const useWorkflowDestinations = () => ({
  destinationsByName: byName,
  destinationsLoaded: loaded,
  ensureWorkflowDestinations,
  resetWorkflowDestinations,
});
