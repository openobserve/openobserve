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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { updateOrgSettingsMutation } from "@/services/organizations.queries";

/** Turning on usage reporting, one flow for every Usage tab that offers the button. */
export function useUsageReporting() {
  const { t } = useI18nTyped();
  const store = useStore();
  const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

  const enabled = computed<boolean>(
    () => !!store.state?.organizationData?.organizationSettings?.usage_stream_enabled,
  );
  /** The confirm dialog is open. */
  const confirming = ref(false);
  const enabling = ref(false);

  const updateOrgSettings = useMutation(() => updateOrgSettingsMutation(orgId.value));

  /** Sends only the opt-in: the backend writes every field it gets, so this page's older copy of the rest would undo newer changes. */
  const enable = async () => {
    confirming.value = false;
    if (enabling.value) return;
    enabling.value = true;
    try {
      await updateOrgSettings.mutateAsync({ usage_stream_enabled: true });
      store.dispatch("setOrganizationSettings", {
        ...(store.state?.organizationData?.organizationSettings ?? {}),
        usage_stream_enabled: true,
      });
      toast({
        variant: "success",
        message: t("billing.usageTrends.enablePending"),
        timeout: 5000,
      });
    } catch (e: any) {
      toast({
        variant: "error",
        // The server's reason when it gives one, not the request library's "status code" text.
        message: raw(e?.response?.data?.message) || t("billing.failedToEnableUsageReporting"),
        timeout: 5000,
      });
    } finally {
      enabling.value = false;
    }
  };

  return { enabled, confirming, enabling, enable };
}
