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

import { computed, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { alertsListQuery } from "@/services/alerts.queries";
import { incidentsQuery } from "@/services/incidents.queries";
import type { Incident } from "@/services/incidents";
import { isFiringOutcome, shouldShowRunOutcome } from "@/utils/alerts/runOutcome";

const INCIDENT_PAGE = 20;
const CLUSTER_KEYS = ["k8s_cluster", "k8s_cluster_name", "cluster"];

export interface FiringAlert {
  id: string;
  name: string;
  // µs, when the alert last triggered.
  lastTriggeredAt: number | null;
}

const clusterOfIncident = (incident: Incident): string | null => {
  const values = incident.group_values ?? {};
  const key = CLUSTER_KEYS.find((k) => values[k]);
  return key ? values[key] : null;
};

/** Org-wide firing alerts and open incidents; an incident that names another cluster is dropped, none can be proven to belong to this one. */
export function useOverviewSignals(cluster: Ref<string | null>, refreshNonce: Ref<number>) {
  const store = useStore();
  const orgId = useOrgId();
  const incidentsAccess = useLockedAffordance("incidents");
  const incidentsEnabled = computed(
    () => incidentsAccess.value.allowed && store.state.zoConfig?.incidents_enabled === true,
  );

  const alerts = useQuery(() =>
    Object.assign(alertsListQuery(orgId.value, ""), { enabled: !!orgId.value }),
  );
  const incidents = useQuery(() =>
    Object.assign(incidentsQuery(orgId.value, "open", INCIDENT_PAGE, 0), {
      enabled: !!orgId.value && incidentsEnabled.value,
    }),
  );

  watch(refreshNonce, () => {
    void alerts.refetch();
    if (incidentsEnabled.value) void incidents.refetch();
  });

  const firingAlerts = computed<FiringAlert[]>(() =>
    (alerts.data.value ?? [])
      .filter(
        (a: any) =>
          shouldShowRunOutcome(a.enabled, a.last_outcome) && isFiringOutcome(a.last_outcome),
      )
      .map((a: any) => ({
        id: String(a.alert_id ?? a.name),
        name: String(a.name ?? ""),
        lastTriggeredAt: a.last_triggered_at ?? null,
      })),
  );

  const openIncidents = computed<Incident[]>(() =>
    (incidents.data.value?.incidents ?? []).filter((i) => {
      const named = clusterOfIncident(i);
      return named == null || cluster.value == null || named === cluster.value;
    }),
  );

  return {
    alertsLoading: computed(() => alerts.isPending.value),
    alertsAvailable: computed(() => !alerts.isError.value),
    firingAlerts,
    incidentsEnabled,
    incidentsLoading: computed(() => incidentsEnabled.value && incidents.isPending.value),
    incidentsAvailable: computed(() => incidentsEnabled.value && !incidents.isError.value),
    openIncidents,
  };
}
