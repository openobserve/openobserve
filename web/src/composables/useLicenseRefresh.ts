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
import { toast } from "@/lib/feedback/Toast/useToast";
import { configFullQuery } from "@/services/config.queries";
import licenseServer from "@/services/license_server";
import { licenseQuery } from "@/services/license_server.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { LICENSE_REFRESH_SETTLE_MS } from "@/utils/licenseWaivers";

export function useLicenseRefresh() {
  const { t } = useI18nTyped();
  const store = useStore();

  const reloadLicenseState = async () => {
    const org = store.state.selectedOrganization?.identifier;
    try {
      await queryClient.invalidateQueries({
        queryKey: licenseQuery().queryKey,
        exact: true,
        refetchType: "none",
      });
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

  // Clears the pending timer so repeated clicks collapse into one reload.
  const scheduleReload = (onSettled?: () => Promise<void> | void) => {
    clearTimer();
    timer = setTimeout(async () => {
      timer = undefined;
      await reloadLicenseState();
      await onSettled?.();
    }, LICENSE_REFRESH_SETTLE_MS);
  };

  if (getCurrentScope()) onScopeDispose(clearTimer);

  const refreshLicenseLimits = async (onSettled?: () => Promise<void> | void): Promise<boolean> => {
    try {
      await licenseServer.refresh_license_limits();
      toast({ variant: "success", message: t("about.license_refresh_success") });
      scheduleReload(onSettled);
      return true;
    } catch (error) {
      const e = error as { response?: { status?: number; data?: { message?: string } } };
      console.error("Error refreshing license:", error);
      const message =
        e?.response?.status === 403
          ? t("about.refresh_needs_permission")
          : raw(
              t("about.failed_to_refresh_license") +
                " : " +
                (e?.response?.data?.message || t("settings.licensePage.unexpectedError")),
            );
      toast({ variant: "error", message });
      return false;
    }
  };

  return { refreshLicenseLimits, reloadLicenseState, scheduleReload };
}
