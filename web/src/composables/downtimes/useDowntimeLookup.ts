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

import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { downtimesListQuery } from "@/services/downtimes.queries";
import type { DowntimeListItem } from "@/services/downtimes";

/** Names and windows of downtimes by id, for surfaces that only carry `muted_by_downtime_id`. */
export function useDowntimeLookup(needed: MaybeRefOrGetter<boolean>) {
  type StoreState = {
    zoConfig?: Record<string, unknown>;
    selectedOrganization?: { identifier?: string };
  };
  const store = useStore() as { state?: StoreState } | undefined;
  // Read directly rather than through useOrgId, so a storeless mount stays inert.
  const orgId = computed(() => store?.state?.selectedOrganization?.identifier ?? "");

  const downtimesEnabled = computed(
    () =>
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store?.state?.zoConfig?.downtimes_enabled === true,
  );

  const list = useQuery(() =>
    Object.assign(downtimesListQuery(orgId.value), {
      enabled: !!orgId.value && downtimesEnabled.value && toValue(needed),
    }),
  );

  const byId = computed(
    () => new Map((list.data.value?.items ?? []).map((d) => [d.id, d] as const)),
  );

  const downtimeOf = (id: string | null | undefined): DowntimeListItem | undefined =>
    id ? byId.value.get(id) : undefined;

  /** The downtime's name, or its id when the list is not readable. */
  const nameOf = (id: string) => downtimeOf(id)?.name ?? id;

  return { downtimesEnabled, downtimeOf, nameOf };
}
