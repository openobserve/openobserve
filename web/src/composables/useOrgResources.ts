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

import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import { anomalyConfigsQuery } from "@/services/anomaly_detection.queries";
import { orgSummaryQuery } from "@/services/organizations.queries";
import { organizationKeys } from "@/services/organizations.querykeys";
import { featureState } from "@/utils/featureGate";

type Counted = { num_realtime?: number; num_scheduled?: number } | undefined;

// A missing count reads NaN, so an answer of unknown shape never counts as empty.
const rules = (part: Counted) => Number(part?.num_realtime) + Number(part?.num_scheduled);

/** Whether the org has no dashboard, alert, pipeline, function or anomaly config; false until both reads have answered once. */
export function useOrgHasNoResources(
  org: MaybeRefOrGetter<string>,
  wanted: MaybeRefOrGetter<boolean>,
) {
  const store = useStore();
  // Same gate as Overview: the OSS build has no anomaly routes, so an org there has no configs to count.
  const anomalyEnabled = computed(
    () =>
      store.state.zoConfig?.anomaly_detection_enabled === true &&
      featureState(store.state.zoConfig?.features, "anomaly_detection") !== "locked",
  );
  const enabled = () => !!toValue(org) && toValue(wanted);
  const summary = useQuery(() => ({ ...orgSummaryQuery(toValue(org)), enabled: enabled() }));
  const anomalies = useQuery(() => ({
    ...anomalyConfigsQuery(toValue(org)),
    enabled: enabled() && anomalyEnabled.value,
  }));
  // Read from the cached answer, not the status, so a failed refetch keeps the last good one.
  const noAnomalyConfigs = computed(() => {
    if (!anomalyEnabled.value) return true;
    const configs = anomalies.data.value;
    return Array.isArray(configs) && configs.length === 0;
  });
  const noResources = computed(() => {
    const data = summary.data.value;
    if (!data) return false;
    return (
      Number(data.total_dashboards) === 0 &&
      Number(data.total_functions) === 0 &&
      rules(data.alerts) === 0 &&
      rules(data.pipelines) === 0 &&
      noAnomalyConfigs.value
    );
  });
  return { noResources };
}

/** Marks the org summary stale after something adds or removes dashboards or alerts. */
export function refreshOrgResources(org: string) {
  return queryClient.invalidateQueries({ queryKey: organizationKeys.summary(org), exact: true });
}
