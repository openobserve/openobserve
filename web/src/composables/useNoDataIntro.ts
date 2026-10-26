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

import { computed, type MaybeRefOrGetter, ref, toValue, watch } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";

/**
 * Whether a data page shows its no-data intro: set by the first settled answer and kept for the
 * mount (the content area remounts on an org switch). The first-data watcher refreshes the
 * stream lists a moment before it reports the record, so following `hasUserData` live would
 * unmount it mid-confirmation; the page sets it to false itself once the watcher reports.
 * A stale cached "no data" is not settled while it refetches, or an org whose data arrived
 * since would keep the intro for the whole visit.
 */
export function useNoDataIntro(org: MaybeRefOrGetter<string>) {
  const { hasUserData, isFetching } = useOrgHasUserData(org);
  const showIntro = ref<boolean>();
  watch(
    [hasUserData, isFetching],
    ([has, fetching]) => {
      if (showIntro.value === undefined && has !== undefined && !fetching) showIntro.value = !has;
    },
    { immediate: true },
  );
  return showIntro;
}

/**
 * Where a "set up" button goes. Onboarding (cloud only) serves an org with no data at all;
 * it sends an org with data back to Home, so every other case keeps the ingestion route.
 */
export function useSetupTarget(orgSource?: MaybeRefOrGetter<string>) {
  const store = useStore();
  // A caller that must not read while hidden passes an org that is empty then.
  const org = () =>
    orgSource === undefined
      ? (store.state.selectedOrganization?.identifier ?? "")
      : toValue(orgSource);
  const { hasUserData, isFetching } = useOrgHasUserData(org);
  const onboarding = computed(
    () => config.isCloud === "true" && hasUserData.value === false && !isFetching.value,
  );
  // A null choice opens onboarding's first step.
  const target = (choice: OnboardingChoiceId | "agent" | null, route: string) =>
    onboarding.value
      ? {
          name: "onboarding",
          params: { path: choice ? [choice] : [] },
          query: { org_identifier: org() },
        }
      : { name: route, query: { org_identifier: org() } };
  return { onboarding, target };
}
