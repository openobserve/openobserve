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

import { computed, ref, shallowRef, watch, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { firingAlertsQuery } from "@/services/alerts.queries";
import {
  countStates,
  rowsInState,
  type FiringRow,
  type FiringState,
} from "@/utils/alerts/firingAlerts";

export const FIRING_CLOCK_MS = 30_000;

/** The Firing tab's one read: every view, count and drawer row comes from the same rows. */
export function useFiringAlerts(
  state: Ref<FiringState>,
  selectedId: Ref<string | null> = ref(null),
) {
  const orgId = useOrgId();

  const read = useQuery(() =>
    Object.assign(firingAlertsQuery(orgId.value), { enabled: !!orgId.value }),
  );

  const page = computed(() => read.data.value);
  const allRows = computed(() => page.value?.list ?? []);
  const statusUnavailable = computed(() => !!page.value?.status_unavailable);
  const rows = computed(() => rowsInState(allRows.value, state.value));
  const counts = computed(() =>
    page.value && !statusUnavailable.value ? countStates(allRows.value) : null,
  );
  const loading = computed(() => read.isPending.value && !page.value);
  const fetching = computed(() => read.isFetching.value);
  const updatedAt = computed(() => read.dataUpdatedAt.value);
  const error = computed<any>(() => read.error.value);
  const refreshFailed = computed(() => !!error.value && !!page.value);
  const forbidden = computed(
    () => !page.value && (error.value?.status === 403 || error.value?.response?.status === 403),
  );

  const foundRow = computed(
    () => allRows.value.find((row) => row.alert_id === selectedId.value) ?? null,
  );
  const lastRow = shallowRef<FiringRow | null>(null);
  watch(
    foundRow,
    (row) => {
      if (row) lastRow.value = row;
    },
    { immediate: true },
  );
  const selectedRow = computed(
    () => foundRow.value ?? (lastRow.value?.alert_id === selectedId.value ? lastRow.value : null),
  );

  const refresh = async () => {
    await read.refetch();
  };

  return {
    rows,
    counts,
    statusUnavailable,
    loading,
    fetching,
    updatedAt,
    error,
    refreshFailed,
    forbidden,
    selectedRow,
    refresh,
  };
}
