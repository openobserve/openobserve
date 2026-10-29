<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw } from "@/types/i18n";
import QueryFilterBar from "@/components/filterBar/QueryFilterBar.vue";
import { useFilterHint } from "@/composables/metrics/useFilterHint";
import { labelFilterKey, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";
import {
  emptyFilterGroup,
  escapePromRegexLiteral,
  splitPromRegexLiterals,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";

defineOptions({ name: "LabelFilterBar" });

/** The PromQL selector builder throws on anything else, so an invalid name never becomes a filter. */
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const TO_OPERATOR: Record<string, FilterOperatorId> = {
  "=": "eq",
  "!=": "neq",
  "=~": "regex",
  "!~": "not_regex",
};

// `is any of` is written as an anchored alternation, so a plain one reads back as a list.
const LIST_OPERATOR: Record<string, FilterOperatorId> = { "=~": "in", "!~": "not_in" };

const props = defineProps<{
  filters: LabelFilter[];
  labelNames: string[];
  labelNamesLoading: boolean;
  schemaLoading: boolean;
  /** Best-effort value suggestions; may resolve empty or reject. */
  loadValues: (label: string) => Promise<string[]>;
}>();

const emit = defineEmits<{
  (e: "add", filter: LabelFilter): void;
  (e: "remove", filter: LabelFilter): void;
  /** An edited chip, swapped in place. */
  (e: "replace", previous: LabelFilter, next: LabelFilter): void;
  (e: "clear-all"): void;
  /** Each open — lets the parent lazily fetch label names. */
  (e: "focus-picker"): void;
}>();

const focused = ref(false);

const fields = computed<FilterField[]>(() =>
  props.labelNames.map((name) => ({ name, type: "string" })),
);

const tree = computed<FilterGroup>(() => ({
  ...emptyFilterGroup(),
  items: props.filters.map((filter) => {
    const listOperator = LIST_OPERATOR[filter.operator ?? "="];
    const list = listOperator ? splitPromRegexLiterals(filter.value) : null;
    return {
      kind: "condition",
      id: labelFilterKey(filter),
      connector: "AND",
      field: String(filter.label),
      operator: list ? listOperator! : (TO_OPERATOR[filter.operator ?? "="] ?? "eq"),
      values: list ?? [filter.value],
    };
  }),
}));

const { placeholder: filterHint } = useFilterHint(
  computed(() => props.labelNames ?? []),
  computed(() => !focused.value && !props.filters.length),
);

const loadValues = (label: string) => props.loadValues(label);

// A list matcher has no PromQL operator of its own, so `in` becomes an anchored alternation.
const toLabelFilter = (condition: FilterCondition): LabelFilter | null => {
  if (!LABEL_NAME_RE.test(condition.field)) return null;
  const label = raw(condition.field);
  const [first = ""] = condition.values;
  switch (condition.operator) {
    case "neq":
      return { label, operator: "!=", value: first };
    case "regex":
      return { label, operator: "=~", value: first };
    case "not_regex":
      return { label, operator: "!~", value: first };
    case "in":
    case "not_in":
      return {
        label,
        operator: condition.operator === "in" ? "=~" : "!~",
        value: condition.values.map(escapePromRegexLiteral).join("|"),
      };
    default:
      return { label, operator: "=", value: first };
  }
};

const conditionsOf = (items: FilterNode[]): FilterCondition[] =>
  items.flatMap((item) => {
    if (item.kind === "condition") return [item];
    return item.kind === "group" ? conditionsOf(item.items) : [];
  });

function onChange(next: FilterGroup) {
  const nextFilters = conditionsOf(next.items)
    .map(toLabelFilter)
    .filter((filter): filter is LabelFilter => filter !== null);
  if (!nextFilters.length && props.filters.length > 1) {
    emit("clear-all");
    return;
  }
  const nextKeys = new Set(nextFilters.map(labelFilterKey));
  const currentKeys = new Set(props.filters.map(labelFilterKey));
  const removed = props.filters.filter((filter) => !nextKeys.has(labelFilterKey(filter)));
  const added = nextFilters.filter((filter) => !currentKeys.has(labelFilterKey(filter)));
  if (removed.length === 1 && added.length === 1 && nextFilters.length === props.filters.length) {
    emit("replace", removed[0], added[0]);
    return;
  }
  removed.forEach((filter) => emit("remove", filter));
  added.forEach((filter) => emit("add", filter));
}

// Every open, not just the first, so a list that was cleared or failed can reload.
function onFocus() {
  focused.value = true;
  emit("focus-picker");
}
</script>

<template>
  <div class="min-w-0 flex-1" @focusout="focused = false">
    <QueryFilterBar
      :model-value="tree"
      :fields="fields"
      dialect="promql"
      allow-custom-fields
      :load-values="loadValues"
      :fields-loading="labelNamesLoading || schemaLoading"
      :placeholder="raw(filterHint)"
      size="sm"
      appearance="plain"
      data-test="metrics-explorer-label"
      @update:model-value="onChange"
      @focus="onFocus"
    />
  </div>
</template>
