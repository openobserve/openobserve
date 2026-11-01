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

import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { isFullConfigLoaded } from "@/services/config.queries";

/** Enterprise or cloud plus `alert_calibration_enabled`, the rule of the route guards, the nav gate and the settings item. */
export function useAlertCalibrationEnabled() {
  const store = useStore() as { state?: { zoConfig?: Record<string, unknown> } } | undefined;
  return computed(() => isAlertCalibrationEnabled(store?.state?.zoConfig));
}

/** A cold load passes the route guard before `/config` arrives, so the page leaves once it reads off. */
export function useLeaveIfAlertCalibrationOff(routeName: "general" | "alertList") {
  const store = useStore() as { state?: { zoConfig?: Record<string, unknown> } } | undefined;
  const router = useRouter();
  watch(
    () => isAlertCalibrationOff(store?.state?.zoConfig),
    (off) => {
      if (!off) return;
      const org = router.currentRoute.value.query.org_identifier;
      router.replace({ name: routeName, query: { org_identifier: org } });
    },
    { immediate: true },
  );
}

/** Off only once `/config` has loaded, so a load still in flight never bounces the page. */
export const isAlertCalibrationOff = (zoConfig: Record<string, unknown> | undefined): boolean =>
  isFullConfigLoaded(zoConfig) && !isAlertCalibrationEnabled(zoConfig);

export function isAlertCalibrationEnabled(zoConfig: Record<string, unknown> | undefined): boolean {
  return (
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    zoConfig?.alert_calibration_enabled === true
  );
}
