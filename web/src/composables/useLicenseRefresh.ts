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

import { getCurrentScope, onScopeDispose } from "vue";
import { useStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import { configFullQuery } from "@/services/config.queries";
import licenseServer from "@/services/license_server";
import { licenseQuery } from "@/services/license_server.queries";
import type { RefreshBody, RefreshResult } from "@/ts/interfaces/licenseRefresh";
import { LICENSE_REFRESH_SETTLE_MS } from "@/utils/licenseWaivers";

export function useLicenseRefresh() {
  const store = useStore();

  const reloadLicenseState = async () => {
    const org = store.state.selectedOrganization?.identifier;
    try {
      await queryClient.invalidateQueries({
        queryKey: licenseQuery().queryKey,
        exact: true,
        refetchType: "none",
      });
      await queryClient.fetchQuery(licenseQuery());
      if (!org) return;
      await queryClient.invalidateQueries({
        queryKey: configFullQuery(org).queryKey,
        exact: true,
        refetchType: "none",
      });
      store.dispatch("setConfig", await queryClient.fetchQuery(configFullQuery(org)));
    } catch (error) {
      console.error("Error reloading license state:", error);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // Repeated clicks must collapse into one delayed state reload.
  const scheduleReload = (onSettled?: () => Promise<void> | void) => {
    clearTimer();
    timer = setTimeout(async () => {
      timer = undefined;
      await reloadLicenseState();
      await onSettled?.();
    }, LICENSE_REFRESH_SETTLE_MS);
  };

  if (getCurrentScope()) onScopeDispose(clearTimer);

  const runRefresh = async (
    rotate: boolean,
    onSettled?: () => Promise<void> | void,
  ): Promise<RefreshResult> => {
    try {
      const response = await (rotate
        ? licenseServer.rotate_key()
        : licenseServer.refresh_license_limits());
      scheduleReload(onSettled);
      return { ok: true, body: response.data, status: response.status };
    } catch (error) {
      const e = error as { response?: { status?: number; data?: RefreshBody } };
      if (e.response?.status === 409) scheduleReload(onSettled);
      return { ok: false, body: e.response?.data, status: e.response?.status };
    }
  };
  const refreshLicenseLimits = (onSettled?: () => Promise<void> | void) =>
    runRefresh(false, onSettled);
  const rotateInstanceKey = (onSettled?: () => Promise<void> | void) => runRefresh(true, onSettled);

  return { refreshLicenseLimits, rotateInstanceKey, reloadLicenseState, scheduleReload };
}
