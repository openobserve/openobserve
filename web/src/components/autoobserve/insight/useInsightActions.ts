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

import { onScopeDispose, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { useOrgId } from "@/composables/query";
import { openAlertReview } from "@/components/alert_calibration/reviewAlert";
import type { DismissTarget } from "@/components/alert_calibration/dismissals";
import type { InsightCta, InsightParts } from "./insightCopy";

export function useInsightActions() {
  const router = useRouter();
  const orgId = useOrgId();
  const pendingId = ref<string | null>(null);
  const dismissTarget = shallowRef<DismissTarget | null>(null);
  const dismissOpen = ref(false);
  let live = true;
  onScopeDispose(() => {
    live = false;
  });

  async function run(id: string, cta: InsightCta) {
    if (cta.target.type === "route") {
      void router.push(cta.target.to);
      return;
    }
    if (pendingId.value) return;
    pendingId.value = id;
    try {
      await openAlertReview(
        router,
        orgId.value,
        cta.target.action,
        { alert_name: cta.target.alertName, finding_id: cta.target.findingId },
        () => live,
      );
    } finally {
      pendingId.value = null;
    }
  }

  // The dialog stays mounted after it closes, so the toast's Undo still has its reopen.
  function dismiss(parts: InsightParts) {
    if (!parts.dismissable) return;
    dismissTarget.value = parts.dismissable;
    dismissOpen.value = true;
  }

  return { run, dismiss, pendingId, dismissTarget, dismissOpen };
}
