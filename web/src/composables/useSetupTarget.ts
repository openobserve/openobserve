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
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";
import { onboardingFlowOn } from "@/utils/firstRunFlow";

/**
 * Where a "set up" button goes. Onboarding (cloud only, when the deployment runs it) serves an org
 * with no data at all; it sends an org with data back to Home, so every other case keeps the
 * ingestion route.
 */
export function useSetupTarget(orgSource?: MaybeRefOrGetter<string>) {
  const store = useStore();
  // A caller that must not read while hidden passes an org that is empty then.
  const org = () =>
    orgSource === undefined
      ? (store.state.selectedOrganization?.identifier ?? "")
      : toValue(orgSource);
  const { hasUserData, isFetching } = useOrgHasUserData(org);
  // A cached answer may be stale while it refetches, so it counts only once settled; the last settled
  // answer holds through a re-read, so a card clicked mid-read still opens onboarding.
  let settled = false;
  const onboarding = computed(() => {
    if (!isFetching.value) settled = config.isCloud === "true" && hasUserData.value === false;
    return settled && onboardingFlowOn(store.state.zoConfig);
  });
  const target = (choice: OnboardingChoiceId, route: string) =>
    onboarding.value
      ? { name: "onboarding", params: { path: [choice] }, query: { org_identifier: org() } }
      : { name: route, query: { org_identifier: org() } };
  return { target };
}
