// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { QueryClient } from "@tanstack/vue-query";
import type { DimensionCondition } from "@/services/downtimes";
import { downtimeValuesQuery } from "@/services/downtimes.queries";
import { andEqPairs } from "@/utils/downtimes/conditionBridge";

export const NOT_SEEN_DEBOUNCE_MS = 250;

/** A typed `pay*` asks for values starting with `pay`. */
const needle = (typed: string) => typed.trim().replace(/\*$/, "").toLowerCase();

const pairsOf = (cond: DimensionCondition | null): Array<{ key: string; value: string }> => {
  if (!cond) return [];
  if (cond.type === "pair") return [{ key: cond.key, value: cond.value }];
  return (cond.items ?? []).flatMap(pairsOf);
};

const pairKey = (key: string, value: string) => `${key}\u0000${value}`;

/** Value suggestions for the downtime condition, narrowed by the `=` pairs on the other rows. */
export function useDowntimeValueSuggest(
  queryClient: QueryClient,
  orgId: Ref<string>,
  folder: Ref<string | undefined>,
  condition: Ref<DimensionCondition | null>,
) {
  // The last answer missed a source, so the list may be short.
  const partial = ref(false);

  // Pairs whose exact value the values API did not return for their key.
  const notSeen = ref(new Set<string>());

  const fetchValues = async (key: string, search: string) => {
    // The row being edited is not one of its own narrowing pairs.
    const pairs = andEqPairs(condition.value).filter((p) => p.key !== key && p.value !== "");
    return queryClient.fetchQuery(
      downtimeValuesQuery(orgId.value, key, needle(search), pairs, folder.value),
    );
  };

  const loadValues = async (key: string, search: string): Promise<string[]> => {
    if (!orgId.value || !key) return [];
    const data = await fetchValues(key, search);
    partial.value = Boolean(data.partial);
    return data.values.map((v) => v.value);
  };

  let check = 0;
  async function checkSeen() {
    const run = ++check;
    const missing = new Set<string>();
    const typed = pairsOf(condition.value).filter(
      (p) => p.key && p.value.trim() && !p.value.trim().endsWith("*"),
    );
    if (orgId.value) {
      await Promise.all(
        typed.map(async (p) => {
          try {
            const data = await fetchValues(p.key, p.value);
            const exact = p.value.trim().toLowerCase();
            if (!data.values.some((v) => v.value === exact)) missing.add(pairKey(p.key, p.value));
          } catch {
            // No answer is not evidence the value is unknown.
          }
        }),
      );
    }
    if (run === check) notSeen.value = missing;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [condition, orgId, folder],
    () => {
      clearTimeout(timer);
      timer = setTimeout(checkSeen, NOT_SEEN_DEBOUNCE_MS);
    },
    { deep: true, immediate: true },
  );
  onScopeDispose(() => clearTimeout(timer));

  /** Whether a chip's exact value has not been seen in recent data for its key. */
  const isNotSeen = (key: string, values: string[]): boolean =>
    values.some((value) => notSeen.value.has(pairKey(key, value)));

  return { loadValues, partial, isNotSeen };
}
