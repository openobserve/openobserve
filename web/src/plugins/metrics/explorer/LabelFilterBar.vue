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
import { computed, ref, shallowRef, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import QueryFilterBar from "@/components/filterBar/QueryFilterBar.vue";
import {
  compileLabelFilters,
  filterGroupsOf,
  MAX_FILTER_BRANCHES,
  type LabelMatchOp,
} from "@/components/promql/labelBoolean";
import { useFilterHint } from "@/composables/metrics/useFilterHint";
import { labelFilterKey, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";
import {
  emptyFilterGroup,
  escapePromRegexLiteral,
  splitPromRegexLiterals,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
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
  /** Changes when the sample `loadValues` draws from does; an open value step then reloads. */
  valueScope?: string;
}>();

const emit = defineEmits<{
  (e: "add", filter: LabelFilter): void;
  (e: "remove", filter: LabelFilter): void;
  /** An edited chip, swapped in place. */
  (e: "replace", previous: LabelFilter, next: LabelFilter): void;
  (e: "negate-group", group: number, negate: boolean): void;
  (e: "clear-all"): void;
  /** Each open — lets the parent lazily fetch label names. */
  (e: "focus-picker"): void;
}>();

const { t } = useI18nTyped();

const focused = ref(false);
const capError = ref("");

const fields = computed<FilterField[]>(() =>
  props.labelNames.map((name) => ({ name, type: "string" })),
);

const toCondition = (filter: LabelFilter): FilterCondition => {
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
};

/** The group number behind each group node, so a chip edit stays in its group. */
const groupNumbers = new Map<string, number>();

const toTree = (filters: LabelFilter[]): FilterGroup => {
  const base = filters.filter((filter) => (filter.group ?? 0) <= 0).map(toCondition);
  const groups = filterGroupsOf(filters).map(({ group, negate, members }) => {
    const id = `label-group-${group}`;
    groupNumbers.set(id, group);
    const node: FilterGroup = {
      kind: "group",
      id,
      connector: "AND",
      items: members.map(toCondition),
    };
    if (negate) node.negate = true;
    return node;
  });
  return { ...emptyFilterGroup(), items: [...base, ...groups] };
};

// What the filters mean, whatever their order: the grid keeps its own, so the echo of an edit must not rebuild.
const signature = (filters: LabelFilter[]) =>
  filters
    .map((filter) => `${labelFilterKey(filter)}\u0000${filter.negate ? 1 : 0}`)
    .sort()
    .join("\u0001");

// Held here, not derived from `filters`: a group is local until its first filter lands.
const tree = shallowRef<FilterGroup>(toTree(props.filters));
let lastSignature = signature(props.filters);

watch(
  () => props.filters,
  (filters) => {
    capError.value = "";
    const next = signature(filters);
    if (next === lastSignature) return;
    lastSignature = next;
    tree.value = toTree(filters);
  },
);

const { placeholder: filterHint } = useFilterHint(
  computed(() => props.labelNames ?? []),
  computed(() => !focused.value && !props.filters.length),
);

// A new loader is what tells the open value step its sample moved, so it reloads.
const loadValues = computed(() => {
  void props.valueScope;
  return (label: string) => props.loadValues(label);
});

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

const filtersOf = (root: FilterGroup): { filters: LabelFilter[]; conditions: number } => {
  const filters: LabelFilter[] = [];
  let conditions = 0;
  const known = root.items.map((item) => groupNumbers.get(item.id) ?? 0);
  let nextGroup = Math.max(0, ...known);
  const collect = (item: FilterGroup["items"][number], grouped: Partial<LabelFilter>) => {
    if (item.kind !== "condition") return;
    conditions++;
    const filter = toLabelFilter(item);
    if (filter) filters.push({ ...filter, ...grouped });
  };
  for (const item of root.items) {
    if (item.kind !== "group") {
      collect(item, {});
      continue;
    }
    const group = groupNumbers.get(item.id) ?? ++nextGroup;
    groupNumbers.set(item.id, group);
    item.items.forEach((child) =>
      collect(child, { group, ...(item.negate ? { negate: true } : {}) }),
    );
  }
  return { filters, conditions };
};

// A query past the cap cannot render, so only a removal may land while over it.
const refusedCount = (filters: LabelFilter[]): number => {
  if (filters.length < props.filters.length) return 0;
  const compiled = compileLabelFilters(
    filters.map((filter) => ({
      ...filter,
      label: String(filter.label),
      op: (filter.operator ?? "=") as LabelMatchOp,
    })),
  );
  return compiled.ok ? 0 : compiled.branchCount;
};

function emitChanges(nextFilters: LabelFilter[]) {
  const wasNegated = new Map(filterGroupsOf(props.filters).map((g) => [g.group, g.negate]));
  for (const { group, negate } of filterGroupsOf(nextFilters)) {
    if (wasNegated.has(group) && wasNegated.get(group) !== negate) {
      emit("negate-group", group, negate);
    }
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

function onChange(next: FilterGroup) {
  const { filters: nextFilters, conditions } = filtersOf(next);
  const refused = refusedCount(nextFilters);
  if (refused) {
    capError.value = t("metrics.labelGroups.tooManyBranches", {
      count: refused,
      max: MAX_FILTER_BRANCHES,
    });
    tree.value = toTree(props.filters);
    return;
  }
  capError.value = "";
  // A chip whose label PromQL cannot name never becomes a filter, so it leaves the bar.
  tree.value = conditions === nextFilters.length ? next : toTree(nextFilters);
  lastSignature = signature(nextFilters);
  if (!nextFilters.length && props.filters.length > 1) {
    emit("clear-all");
    return;
  }
  emitChanges(nextFilters);
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
    <span
      v-if="capError"
      class="text-status-error-text text-xs"
      role="alert"
      data-test="metrics-explorer-label-too-many-branches"
      >{{ capError }}</span
    >
  </div>
</template>
