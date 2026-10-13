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

import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { downtimeValuesQuery } from "@/services/downtimes.queries";
import type { ConditionValueSuggest } from "@/components/alerts/conditionOperators";

export const VALUE_SUGGEST_DEBOUNCE_MS = 250;

/** A typed `pay*` asks for values starting with `pay`. */
const needle = (typed: string) => typed.trim().replace(/\*$/, "").toLowerCase();

/** The provider behind every value box of the downtime condition. */
export function useDowntimeValueSuggest(
  orgId: Ref<string>,
  folder: Ref<string | undefined>,
): ConditionValueSuggest {
  const { t } = useI18nTyped();
  return (column, prefix, siblingPairs) => {
    const debounced = ref(needle(prefix()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(prefix, (next) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        debounced.value = needle(next);
      }, VALUE_SUGGEST_DEBOUNCE_MS);
    });
    onScopeDispose(() => clearTimeout(timer));

    const query = useQuery(() =>
      Object.assign(
        downtimeValuesQuery(orgId.value, column(), debounced.value, siblingPairs(), folder.value),
        { enabled: !!orgId.value && !!column() },
      ),
    );

    const options = computed(() =>
      (query.data.value?.values ?? []).map((v) => ({ label: raw(v.value), value: v.value })),
    );

    // Only a settled answer for exactly what is typed may say the value is unknown.
    const notSeen = computed(() => {
      const typed = prefix().trim().toLowerCase();
      const data = query.data.value;
      if (!typed || typed.endsWith("*") || !data) return false;
      if (debounced.value !== needle(typed) || query.isFetching.value) return false;
      if (query.isPlaceholderData.value) return false;
      return !data.values.some((v) => v.value === typed);
    });

    const hint = computed(() => {
      const notes = [
        notSeen.value ? t("alerts.downtimes.resources.notSeen") : null,
        query.data.value?.partial ? t("alerts.downtimes.resources.partial") : null,
      ].filter((n) => n !== null);
      return notes.length ? raw(notes.join(" ")) : undefined;
    });

    return { options, hint };
  };
}
