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

import { computed, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";

import { ruleCount } from "@/composables/useOrgResources";
import { kvKeysQuery, setKvMutation } from "@/services/kv.queries";
import { orgSummaryQuery } from "@/services/organizations.queries";

/** Org flag beside the other `starter_pack_*` keys; once set, packs never show again. */
export const PACKS_RETIRED_KEY = "starter_pack_retired";

const LIMIT = 10;

// One write per org per page, however many pack surfaces watch the counts.
const written = new Set<string>();

export const resetPackGate = () => written.clear();

/** Packs are for onboarding only: an org past both counts, or flagged once, is done with them. */
export const packsRetired = (flag: string | null | undefined, summary: any): boolean => {
  if (flag === "1") return true;
  if (!summary) return false;
  // NaN from a missing count compares false, so an unknown answer keeps packs showing.
  return Number(summary.total_dashboards) > LIMIT && ruleCount(summary.alerts) > LIMIT;
};

/** The one gate every pack surface reads: chip, Home section, banner and Data sources row. */
export function usePackGate(org: string, enabled: () => boolean = () => true) {
  const summary = useQuery(() => ({ ...orgSummaryQuery(org), enabled: enabled() }));
  // The key list answers 200 for a missing flag where a single-key read logs a 404.
  const flag = useQuery(() => ({
    ...kvKeysQuery(org, PACKS_RETIRED_KEY),
    enabled: enabled(),
    // The backend prefix match is a LIKE, so a longer key can come back too.
    select: (keys: string[]) => (keys.includes(PACKS_RETIRED_KEY) ? "1" : null),
  }));
  const setKv = useMutation(() => setKvMutation(org));

  const retired = computed(() => packsRetired(flag.data.value, summary.data.value));
  // An unread flag may already be set, so the write waits for the read to answer.
  const crossed = computed(
    () =>
      flag.data.value !== undefined &&
      flag.data.value !== "1" &&
      packsRetired(null, summary.data.value),
  );

  watch(
    crossed,
    (now) => {
      if (!now || written.has(org)) return;
      written.add(org);
      // A user who cannot write the flag still has packs hidden by the counts themselves.
      setKv.mutateAsync({ key: PACKS_RETIRED_KEY, value: "1" }).catch(() => {});
    },
    { immediate: true },
  );

  // A failed read leaves status "error", not "pending", so packs still show when a count cannot load.
  const loading = computed(() => summary.isPending.value || flag.isPending.value);
  return { visible: computed(() => !loading.value && !retired.value), retired };
}
