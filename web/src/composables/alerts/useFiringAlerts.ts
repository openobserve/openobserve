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
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FiringRow, FiringState } from "@/utils/alerts/firingAlerts";

export const FIRING_POLL_MS = 30_000;
// Failed is never searched: its rows are always also in Firing, Acknowledged or Muted.
const LOOKUP_STATES: FiringState[] = ["acked", "muted", "recovered"];

/** The Firing tab's reads: always polled, whatever the chip and however empty the list. */
export function useFiringAlerts(
  state: Ref<FiringState>,
  selectedId: Ref<string | null> = ref(null),
) {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const client = useQueryClient();

  const firing = useQuery(() =>
    Object.assign(firingAlertsQuery(orgId.value, "firing"), {
      enabled: !!orgId.value,
      refetchInterval: FIRING_POLL_MS,
      refetchIntervalInBackground: true,
    }),
  );
  // Disabled on Firing so two observers of one key cannot poll out of step.
  const other = useQuery(() =>
    Object.assign(firingAlertsQuery(orgId.value, state.value), {
      enabled: !!orgId.value && state.value !== "firing",
      refetchInterval: FIRING_POLL_MS,
      refetchIntervalInBackground: true,
    }),
  );
  const active = computed(() => (state.value === "firing" ? firing : other));

  const page = computed(() => active.value.data.value);
  const rows = computed(() => page.value?.list ?? []);
  const counts = computed(() => (page.value ?? firing.data.value)?.counts ?? null);
  const lastRecovered = computed(() => (page.value ?? firing.data.value)?.last_recovered ?? null);
  const truncated = computed(() => !!page.value && page.value.total > page.value.list.length);
  const total = computed(() => page.value?.total ?? 0);
  const loading = computed(() => active.value.isPending.value && !page.value);
  const fetching = computed(() => active.value.isFetching.value);
  const updatedAt = computed(() => active.value.dataUpdatedAt.value);
  const error = computed<any>(() => active.value.error.value);
  const refreshFailed = computed(() => !!error.value && !!page.value);
  const forbidden = computed(
    () => !page.value && (error.value?.status === 403 || error.value?.response?.status === 403),
  );

  const byId = (list?: FiringRow[]) => list?.find((row) => row.alert_id === selectedId.value);
  const listedRow = computed(() => byId(rows.value) ?? byId(firing.data.value?.list));
  // staleTime 0: a fresh-looking cached list can predate the ack or mute that moved the row here.
  const lookups = LOOKUP_STATES.map((view) =>
    useQuery(() =>
      Object.assign(firingAlertsQuery(orgId.value, view), {
        enabled: !!page.value && !!selectedId.value && !listedRow.value && view !== state.value,
        staleTime: 0,
        refetchInterval: FIRING_POLL_MS,
        refetchIntervalInBackground: true,
      }),
    ),
  );
  const foundRow = computed(
    () =>
      listedRow.value ?? lookups.map((read) => byId(read.data.value?.list)).find(Boolean) ?? null,
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
    await Promise.all([firing.refetch(), state.value === "firing" ? null : other.refetch()]);
  };

  // A row also leaves Firing by being acked or muted, so only the Recovered list proves a recovery.
  const toastRecovered = async (org: string, left: string[]) => {
    const recovered = await client
      .fetchQuery({ ...firingAlertsQuery(org, "recovered"), staleTime: 0 })
      .catch(() => null);
    if (!recovered) return;
    const names = recovered.list.filter((row) => left.includes(row.alert_id)).map((r) => r.name);
    if (!names.length) return;
    const count = names.length;
    toast({
      variant: "success",
      message:
        count === 1
          ? t("toastMessages.alerts.firing.oneRecovered", { name: raw(names[0]) })
          : t("toastMessages.alerts.firing.manyRecovered", { count }),
    });
  };

  let seen: { org: string; ids: Set<string> } | null = null;
  watch(
    firing.dataUpdatedAt,
    () => {
      const list = firing.data.value?.list;
      if (!list) return;
      const org = orgId.value;
      const ids = new Set(list.map((row) => row.alert_id));
      const prior = seen?.org === org ? seen.ids : null;
      seen = { org, ids };
      const left = [...(prior ?? [])].filter((id) => !ids.has(id));
      if (left.length) void toastRecovered(org, left);
    },
    { immediate: true },
  );

  return {
    rows,
    counts,
    lastRecovered,
    truncated,
    total,
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
