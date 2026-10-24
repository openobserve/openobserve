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
import { orgKey } from "@/composables/query/keys";
import {
  FIELD_VALUES_LOOKBACK_MINUTES,
  getFieldValuesForSuggestion,
  requestFieldValues,
  type StreamContext,
} from "@/composables/fieldValueStore";
import type { ConditionValueSuggest } from "@/components/alerts/conditionOperators";

export const VALUE_SUGGEST_DEBOUNCE_MS = 250;

/** A typed `err*` asks for values containing `err`. */
const needle = (typed: string) => typed.trim().replace(/\*$/, "").toLowerCase();

// A stream nobody has searched has nothing stored, so an empty cache falls through to the server.
const loadValues = async (ctx: StreamContext, field: string, keyword: string) => {
  if (!keyword) {
    const stored = await getFieldValuesForSuggestion(ctx, field);
    if (stored.length) return stored;
  }
  return requestFieldValues(ctx, field, { keyword: keyword || undefined });
};

/** The provider behind every value box of the alert condition builder. */
export function useAlertValueSuggest(
  orgId: Ref<string>,
  streamType: Ref<string>,
  streamName: Ref<string>,
): ConditionValueSuggest {
  const { t } = useI18nTyped();
  return (column, prefix) => {
    const debounced = ref(needle(prefix()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(prefix, (next) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        debounced.value = needle(next);
      }, VALUE_SUGGEST_DEBOUNCE_MS);
    });
    onScopeDispose(() => clearTimeout(timer));

    const ctx = (): StreamContext => ({
      org: orgId.value,
      streamType: streamType.value,
      streamName: streamName.value,
    });

    const query = useQuery(() => ({
      queryKey: orgKey(
        orgId.value,
        "alerts",
        "valueSuggest",
        streamType.value,
        streamName.value,
        column(),
        debounced.value,
      ),
      queryFn: () => loadValues(ctx(), column(), debounced.value),
      enabled: !!orgId.value && !!streamType.value && !!streamName.value && !!column(),
    }));

    const options = computed(() =>
      (query.data.value ?? []).map((value) => ({ label: raw(value), value })),
    );

    // Only a settled answer for exactly what is typed may say the value is unknown.
    const notSeen = computed(() => {
      const typed = prefix().trim().toLowerCase();
      const data = query.data.value;
      if (!typed || typed.endsWith("*") || !data) return false;
      if (debounced.value !== needle(typed) || query.isFetching.value) return false;
      return !data.some((value) => value.toLowerCase() === typed);
    });

    const hint = computed(() =>
      notSeen.value
        ? t("alerts.queryConfig.valueNotSeen", { minutes: FIELD_VALUES_LOOKBACK_MINUTES })
        : undefined,
    );

    return { options, hint };
  };
}
