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

import { ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import {
  ORG_DEFAULT_DESTINATION_KEY,
  orgDefaultDestinationOf,
} from "@/composables/alerts/useEmailMeDestination";
import alertsService from "@/services/alerts";
import { alertKeys } from "@/services/alerts.querykeys";
import { settingQuery } from "@/services/settings.queries";

/** Past this the lookup counts as failed, so a slow server never holds the delete. */
export const LEAVER_LOOKUP_TIMEOUT_MS = 5000;

export interface LeaverAlert {
  alert_id: string;
  name: string;
  folder_id?: string;
}

/** The alerts that only notify a user being removed, and an opt-in move of them to the org default. */
export function useLeaverAlerts() {
  const alerts = ref<LeaverAlert[]>([]);
  const defaultDestination = ref<string | null>(null);
  const moveToDefault = ref(false);
  const loading = ref(false);
  // A slower answer for an earlier user must not overwrite the current one.
  let request = 0;

  const reset = () => {
    request += 1;
    alerts.value = [];
    defaultDestination.value = null;
    moveToDefault.value = false;
    loading.value = false;
  };

  const load = async (org: string, email: string) => {
    reset();
    const mine = request;
    loading.value = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LEAVER_LOOKUP_TIMEOUT_MS);
    });
    const settled = await Promise.race([
      Promise.allSettled([
        alertsService.list_by_sole_recipient(org, email),
        queryClient.fetchQuery(settingQuery(org, ORG_DEFAULT_DESTINATION_KEY)),
      ]),
      timedOut,
    ]);
    clearTimeout(timer);
    if (mine !== request) return;
    loading.value = false;
    if (!settled) return;
    const [list, setting] = settled;
    // A failed query hides the list; the delete itself never depends on it.
    alerts.value = list.status === "fulfilled" ? (list.value?.data?.list ?? []) : [];
    defaultDestination.value =
      setting.status === "fulfilled" ? orgDefaultDestinationOf(setting.value) : null;
  };

  const moveOne = async (org: string, alert: LeaverAlert, target: string) => {
    const full = (await alertsService.get_by_alert_id(org, alert.alert_id, alert.folder_id)).data;
    const previous: string[] = Array.isArray(full.destinations) ? full.destinations : [];
    full.destinations = [target];
    if (Array.isArray(full.recovery_destinations) && full.recovery_destinations.length) {
      const swapped = full.recovery_destinations.map((name: string) =>
        previous.includes(name) ? target : name,
      );
      full.recovery_destinations = [...new Set(swapped)];
    }
    await alertsService.update_by_alert_id(org, full, alert.folder_id);
  };

  /** Moves every listed alert when opted in; resolves to how many moves failed. */
  const moveIfChosen = async (org: string): Promise<number> => {
    const target = defaultDestination.value;
    const chosen = moveToDefault.value && target ? alerts.value : [];
    let failed = 0;
    for (const alert of chosen) {
      try {
        await moveOne(org, alert, target as string);
      } catch {
        failed += 1;
      }
    }
    if (chosen.length) await queryClient.invalidateQueries({ queryKey: alertKeys.all(org) });
    return failed;
  };

  return { alerts, defaultDestination, moveToDefault, loading, load, moveIfChosen, reset };
}
