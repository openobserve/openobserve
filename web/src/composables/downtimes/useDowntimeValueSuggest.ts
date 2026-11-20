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

import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import type { QueryClient } from "@tanstack/vue-query";
import type { DimensionCondition } from "@/services/downtimes";
import { downtimeValuesQuery } from "@/services/downtimes.queries";
import { LABELLED_DIMENSION } from "@/composables/downtimes/useDowntimeValueLabels";
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

  // Display names of service values seen in any answer, so a chip keeps its name after the list closes.
  const labels = shallowRef(new Map<string, string>());
  // Another org may name the same key differently.
  watch(orgId, () => (labels.value = new Map()));

  const fetchValues = async (key: string, search: string) => {
    const org = orgId.value;
    // The row being edited is not one of its own narrowing pairs.
    const pairs = andEqPairs(condition.value).filter((p) => p.key !== key && p.value !== "");
    const data = await queryClient.fetchQuery(
      downtimeValuesQuery(org, key, needle(search), pairs, folder.value),
    );
    // An answer for an org the user has since left must not write into the new org's state.
    const current = org === orgId.value;
    if (current && key === LABELLED_DIMENSION) rememberLabels(data.values);
    return { data, current };
  };

  function rememberLabels(values: Array<{ value: string; label?: string | null }>) {
    const named = values.filter((v) => v.label && labels.value.get(v.value) !== v.label);
    if (!named.length) return;
    const next = new Map(labels.value);
    for (const v of named) next.set(v.value, v.label!);
    labels.value = next;
  }

  const loadValues = async (key: string, search: string): Promise<string[]> => {
    if (!orgId.value || !key) return [];
    const { data, current } = await fetchValues(key, search);
    if (current) partial.value = Boolean(data.partial);
    return data.values.map((v) => v.value);
  };

  let check = 0;
  async function checkSeen() {
    const run = ++check;
    const org = orgId.value;
    const missing = new Set<string>();
    const typed = pairsOf(condition.value).filter(
      (p) => p.key && p.value.trim() && !p.value.trim().endsWith("*"),
    );
    if (orgId.value) {
      await Promise.all(
        typed.map(async (p) => {
          try {
            const { data } = await fetchValues(p.key, p.value);
            const exact = p.value.trim().toLowerCase();
            if (!data.values.some((v) => v.value === exact)) missing.add(pairKey(p.key, p.value));
          } catch {
            // No answer is not evidence the value is unknown.
          }
        }),
      );
    }
    if (run === check && org === orgId.value) notSeen.value = missing;
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

  /** The display name of a stored service value, once an answer has named it. */
  const labelOf = (key: string, value: string): string | undefined =>
    key === LABELLED_DIMENSION ? labels.value.get(value.trim()) : undefined;

  return { loadValues, partial, isNotSeen, labelOf };
}
