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

import { computed, watch, type ComputedRef, type WatchStopHandle } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { myOrganizationsQuery, type CallerOrganization } from "@/services/organizations.queries";
import { queryString } from "@/utils/slackLink";

export interface SlackLinkOrg {
  org: ComputedRef<string>;
  /** Runs `fn` once, after the org is known or known to be missing (then `org` is ""). */
  whenResolved: (fn: () => void) => void;
  /** The org's name when this page has it, else the identifier. */
  labelOf: (identifier: string) => string;
}

const pickOrg = (orgs: CallerOrganization[] | undefined): string =>
  (orgs?.find((o) => o.type === "default") ?? orgs?.[0])?.identifier ?? "";

/** The org for the self-service Slack calls, which accept any org the caller belongs to. */
export function useSlackLinkOrg(): SlackLinkOrg {
  const route = useRoute();
  const store = useStore();
  // These pages sit outside MainLayout, so a fresh load has no selected org (it is kept in memory only).
  const known = computed<string>(
    () =>
      queryString(route.query.org_identifier) || store.state.selectedOrganization?.identifier || "",
  );
  const mine = useQuery(() => Object.assign(myOrganizationsQuery(), { enabled: !known.value }));
  const org = computed<string>(() => known.value || pickOrg(mine.data.value));
  const settled = computed(() => !!org.value || mine.isError.value || mine.isSuccess.value);

  const whenResolved = (fn: () => void): void => {
    let fired = false;
    let stop: WatchStopHandle | null = null;
    stop = watch(
      settled,
      (done) => {
        if (!done || fired) return;
        fired = true;
        stop?.();
        fn();
      },
      { immediate: true },
    );
    if (fired) stop();
  };

  const labelOf = (identifier: string): string => {
    const loaded: CallerOrganization[] = [
      ...(store.state.organizations ?? []),
      ...(mine.data.value ?? []),
    ];
    return loaded.find((o) => o.identifier === identifier)?.name || identifier;
  };

  return { org, whenResolved, labelOf };
}
