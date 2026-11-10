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
import { useMutation } from "@tanstack/vue-query";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped } from "@/types/i18n";
import { errorMessage, httpStatus } from "@/services/alert_calibration";
import { requestAlertCalibrationRunMutation } from "@/services/alert_calibration.queries";

// A refused run stays refused for the session; the server has no read that says so up front.
const deniedOrgs = ref<ReadonlySet<string>>(new Set());

/** Tests only: the memory outlives a component. */
export const resetRunDenials = (): void => {
  deniedOrgs.value = new Set();
};

/** A run lands in the digest stream later, so a request only says it was queued. */
export function useRequestAlertCalibrationRun() {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const run = useMutation(() => requestAlertCalibrationRunMutation(orgId.value));
  const denied = computed(() => deniedOrgs.value.has(orgId.value));

  async function runNow() {
    const org = orgId.value;
    try {
      await run.mutateAsync();
      toast({
        message: t("alertCalibration.runRequested"),
        variant: "success",
      });
    } catch (error) {
      if (httpStatus(error) === 403) {
        deniedOrgs.value = new Set([...deniedOrgs.value, org]);
        toast({ message: t("alertCalibration.runDenied"), variant: "error" });
        return;
      }
      toast({
        message: t("alertCalibration.runFailed", { message: raw(errorMessage(error)) }),
        variant: "error",
      });
    }
  }

  return { pending: run.isPending, denied, runNow };
}
