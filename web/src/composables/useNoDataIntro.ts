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

import { computed, type MaybeRefOrGetter, onScopeDispose, ref, toValue, watch } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { cadenceAt } from "@/composables/firstEvent/firstEventBudget";
import { queryClient } from "@/composables/query/queryClient";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import { streamKeys } from "@/services/stream.querykeys";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";

/**
 * Whether the Logs page shows its intro: only while the org has no logs stream of any kind, so an
 * org with only O2's own or synthetics streams can still search. Only ever turned off for the mount.
 * With the restricted-routes flag on, the page ends it when FirstDataPanel reports; with it off this
 * re-reads the logs list on the first-event budget, paused while the tab is hidden.
 */
export function useNoDataIntro(org: MaybeRefOrGetter<string>) {
  const store = useStore();
  const { hasLogsStream, isFetching } = useOrgHasUserData(org);
  const showIntro = ref<boolean>();
  const pageWatches = () => store.state.zoConfig?.restricted_routes_on_empty_data === true;
  watch(
    [hasLogsStream, isFetching],
    ([has, fetching]) => {
      if (fetching) return;
      if (showIntro.value === undefined) {
        if (has !== undefined) showIntro.value = !has;
        // only a list that shows a stream ends it: a failed read (a 401 at session expiry) is not data
      } else if (showIntro.value && has === true && !pageWatches()) {
        showIntro.value = false;
      }
    },
    { immediate: true },
  );

  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  const hidden = () => document.visibilityState === "hidden";
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: streamKeys.nameList(toValue(org), "logs"),
      exact: true,
    });
  const poll = () => {
    clearTimeout(timer);
    timer = undefined;
    const next = cadenceAt(Date.now() - startedAt);
    if (!polling || next === null || hidden()) return;
    timer = setTimeout(() => {
      if (!hidden()) refresh();
      poll();
    }, next);
  };
  // back from the terminal the user sent data from: read at once, then resume the cadence
  const onVisibilityChange = () => {
    if (hidden() || !polling || timer !== undefined) return;
    refresh();
    poll();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  watch(
    () => showIntro.value === true && !pageWatches(),
    (on) => {
      polling = on;
      poll();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    polling = false;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });
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
  // A null choice opens onboarding's first step; a row opens that row of the choice.
  const target = (choice: OnboardingChoiceId | "agent" | null, route: string, row?: string) =>
    onboarding.value
      ? {
          name: "onboarding",
          params: { path: choice ? (row ? [choice, row] : [choice]) : [] },
          query: { org_identifier: org() },
        }
      : { name: route, query: { org_identifier: org() } };
  return { onboarding, target };
}
