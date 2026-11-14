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
import { useRcaFollow } from "@/components/ai-assistant/shell/rcaFollow";
import { INCIDENT_PAGE } from "@/components/ai-assistant/shell/threadsBar";
import { incidentsQuery } from "@/services/incidents.queries";
import { alertRcaRuns } from "@/utils/incidents/rcaCell";

/** The alert list's Follow in thread: which alerts fired into an open incident that has a run. */
export function useAlertRcaFollow(
  org: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  // The same first page of open incidents the threads bar reads, so both share one cached read.
  const open = useQuery(
    computed(() => ({
      ...incidentsQuery(toValue(org), "open", INCIDENT_PAGE, 0),
      enabled: toValue(enabled) && !!toValue(org),
    })),
  );
  const runs = computed(() => alertRcaRuns(open.data.value?.incidents ?? []));

  const runFor = (alertId: string) => runs.value.get(alertId) ?? null;

  const followAlert = (alertId: string, invoker: HTMLElement | null = null) => {
    const run = runFor(alertId);
    // The assistant runtime is built on first use, so a list that never follows a run never builds it.
    if (run) useRcaFollow().follow({ org: toValue(org), ...run }, invoker);
  };

  return { runFor, followAlert };
}
