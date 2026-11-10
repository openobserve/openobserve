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
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { writeSyntheticPrefill } from "@/utils/synthetics/syntheticPrefill";
import { loadReviewContext, openBulkReview } from "./bulk/useBulkReview";
import type { DismissTarget } from "@/components/alert_calibration/dismissals";
import type { InsightCta, InsightParts } from "./insightCopy";
import { resolveDraft } from "./targets/alertDraft";
import { destinationHandoff } from "./targets/editTargets";
import type { ReviewChangeTarget } from "../decisions/appliedChanges";

export function useInsightActions() {
  const router = useRouter();
  const orgId = useOrgId();
  const pendingId = ref<string | null>(null);
  const dismissTarget = shallowRef<DismissTarget | null>(null);
  const dismissOpen = ref(false);
  const reviewTarget = shallowRef<ReviewChangeTarget | null>(null);
  const reviewOpen = ref(false);
  let live = true;
  onScopeDispose(() => {
    live = false;
  });

  async function run(id: string, cta: InsightCta) {
    if (cta.locked) return;
    if (cta.target.type === "route") {
      void router.push(cta.target.to);
      return;
    }
    // Nothing is created here: the dialog and the review list each end in the user's own Add.
    if (cta.target.type === "create_alert" && !cta.target.draft) {
      requestAlertCreation(cta.target.prefill, { folder: cta.target.folder });
      return;
    }
    if (cta.target.type === "synthetic") {
      writeSyntheticPrefill(cta.target.prefill);
      void router.push({
        name: "synthetics-add",
        query: { org_identifier: orgId.value, type: "http", prefill: "autoobserve" },
      });
      return;
    }
    if (cta.target.type === "review_change") {
      reviewTarget.value = cta.target.change;
      reviewOpen.value = true;
      return;
    }
    if (cta.target.type === "bulk") {
      openBulkReview(cta.target.request);
      void loadReviewContext(orgId.value);
      return;
    }
    if (pendingId.value) return;
    pendingId.value = id;
    const org = orgId.value;
    // An answer that lands after an org switch would open org A's draft or alert inside org B.
    const current = () => live && orgId.value === org;
    try {
      if (cta.target.type === "create_alert" && cta.target.draft) {
        const { draft, prefill, folder } = cta.target;
        const built = await resolveDraft(org, draft, prefill);
        if (current()) requestAlertCreation(built.prefill, { folder }, built.rebuild);
        return;
      }
      if (cta.target.type === "destinations") {
        const { alertId, alertName, destinations } = cta.target;
        const route = await destinationHandoff(alertId, destinations, {
          alertName,
          isCurrent: current,
        });
        if (route && current()) void router.push(route);
        return;
      }
      if (cta.target.type !== "review_alert") return;
      await openAlertReview(
        router,
        org,
        cta.target.action,
        { alert_name: cta.target.alertName, finding_id: cta.target.findingId },
        current,
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

  return { run, dismiss, pendingId, dismissTarget, dismissOpen, reviewTarget, reviewOpen };
}
