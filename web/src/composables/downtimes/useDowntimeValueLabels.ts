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

import { computed, type ComputedRef, type Ref } from "vue";
import { useQueries } from "@tanstack/vue-query";
import { downtimeValuesQuery } from "@/services/downtimes.queries";
import type { DimensionCondition } from "@/services/downtimes";
import { andEqPairs } from "@/utils/downtimes/conditionBridge";
import type { ValueLabelFn } from "@/utils/downtimes/targetSummary";

/** The only dimension whose values carry a display name. */
export const LABELLED_DIMENSION = "service";

/** Display names for the `service=` pairs of a condition, read from the same values endpoint as the condition rows. */
export function useDowntimeValueLabels(
  orgId: Ref<string>,
  folder: Ref<string | undefined>,
  condition: () => DimensionCondition | null | undefined,
): ComputedRef<ValueLabelFn> {
  const services = computed(() => [
    ...new Set(
      andEqPairs(condition() ?? null)
        .filter((p) => p.key === LABELLED_DIMENSION && p.value.trim())
        .map((p) => p.value.trim()),
    ),
  ]);

  // Same prefix shape as the condition row's box, so a single-pair condition reuses its cached answer.
  const answers = useQueries({
    queries: () =>
      services.value.map((value) => ({
        ...downtimeValuesQuery(
          orgId.value,
          LABELLED_DIMENSION,
          value.toLowerCase(),
          [],
          folder.value,
        ),
        enabled: !!orgId.value,
      })),
  });

  const labels = computed(() => {
    const byValue = new Map<string, string>();
    for (const answer of answers.value) {
      for (const v of answer.data?.values ?? []) {
        // A label equal to its value names nothing, and would switch the pair to labelled wording.
        if (v.label && v.label !== v.value) byValue.set(v.value, v.label);
      }
    }
    return byValue;
  });

  return computed<ValueLabelFn>(() => {
    const byValue = labels.value;
    return (key, value) => (key === LABELLED_DIMENSION ? byValue.get(value.trim()) : undefined);
  });
}
