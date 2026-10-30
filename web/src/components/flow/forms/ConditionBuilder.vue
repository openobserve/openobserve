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

<template>
  <div data-test="condition-builder" class="flex w-full flex-col gap-1">
    <FilterBuilder
      ref="builderRef"
      :profile="profile"
      :model-value="conditionGroup"
      :fields="filterFields"
      :load-values="loadValues"
      data-test="condition-builder"
      @update:model-value="onChange"
      @update:valid="valid = $event"
    />
    <div
      v-if="showIncomplete"
      class="text-input-error-text text-xs"
      role="alert"
      data-test="add-condition-error"
    >
      {{ t("pipeline.fillAllConditionFields") }}
    </div>
    <div
      v-for="w in columnWarnings"
      :key="w.column"
      class="text-status-warning-text text-xs"
      data-test="condition-builder-unknown-column-warning"
    >
      {{ t("flow.condition.unknownColumn", { column: w.column }) }}
      <template v-if="w.suggestion">
        {{ t("flow.condition.unknownColumnSuggestion", { suggestion: w.suggestion }) }}
      </template>
    </div>
    <slot name="guidelines" />
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, shallowRef } from "vue";
import { cloneDeep } from "lodash-es";
import { useI18nTyped } from "@/types/i18n";
import { getUUID } from "@/utils/zincutils";
import { toFilterFieldType, type FilterField } from "@/utils/query/filterBar";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import type { FilterIssue } from "@/components/filterBar/filterProfiles";
import { findUnresolvableColumns } from "./conditionColumnCheck";

interface FieldOption {
  label?: unknown;
  value?: unknown;
  type?: string;
}

const props = withDefaults(
  defineProps<{
    fields?: FieldOption[];
    /** The saved rule, in any engine version; it is written back unchanged until edited. */
    initialConditions?: unknown;
    profile?: "pipeline" | "workflow";
    normalizeColumnNames?: boolean;
    optional?: boolean;
    loadValues?: (field: string, search: string) => Promise<string[]>;
  }>(),
  {
    fields: () => [],
    initialConditions: undefined,
    loadValues: undefined,
    profile: "pipeline",
    normalizeColumnNames: false,
    optional: false,
  },
);

const { t } = useI18nTyped();
const builderRef = ref<InstanceType<typeof FilterBuilder> | null>(null);
const conditionGroup = shallowRef<unknown>(props.initialConditions ?? null);
const valid = ref(true);
const issues = ref<FilterIssue[]>([]);

const filterFields = computed<FilterField[]>(() =>
  props.fields
    .filter((field) => field?.value !== undefined && field.value !== "")
    .map((field) => ({
      name: String(field.value),
      label: String(field.label ?? field.value),
      type: toFilterFieldType(field.type),
    })),
);

const showIncomplete = computed(() => issues.value.some((issue) => issue.nodeId !== null));

const columnWarnings = computed(() =>
  props.normalizeColumnNames && props.fields.length
    ? findUnresolvableColumns(conditionGroup.value, props.fields)
    : [],
);

const onChange = (next: unknown) => {
  conditionGroup.value = next;
  if (issues.value.length) issues.value = builderRef.value?.validate() ?? [];
};

// The backend treats an empty-column rule as "match everything", so an unset rule saves as that.
const passthroughGroup = () => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: getUUID(),
  conditions: [
    {
      filterType: "condition",
      column: "",
      operator: "=",
      value: "",
      values: [],
      logicalOperator: "AND",
      id: getUUID(),
    },
  ],
});

const normalizeColumns = (node: any): void => {
  if (!node || typeof node !== "object") return;
  if (typeof node.column === "string" && node.column.includes(".")) {
    node.column = node.column.replace(/\./g, "_");
  }
  if (Array.isArray(node.conditions)) node.conditions.forEach(normalizeColumns);
};

const isV2Tree = (value: unknown): boolean =>
  Boolean(value) && typeof value === "object" && (value as any).filterType === "group";

/** Validates and returns `{ version, conditions }`; null when a required rule is not complete. */
const submit = async () => {
  issues.value = builderRef.value?.validate() ?? [];
  const complete = valid.value;
  if (!complete && !props.optional) return null;
  const saved = conditionGroup.value;
  // An unedited V0/V1 rule goes back as stored with no version, which the backend reads as V1.
  if (saved && !isV2Tree(saved) && !(Array.isArray(saved) && !saved.length)) {
    return props.optional ? { conditions: saved, complete } : { conditions: saved };
  }
  const empty = !isV2Tree(saved) || (saved as any).conditions?.length === 0;
  let conditions: any = empty ? passthroughGroup() : saved;
  if (props.normalizeColumnNames) {
    conditions = cloneDeep(conditions);
    normalizeColumns(conditions);
  }
  return props.optional ? { version: 2, conditions, complete } : { version: 2, conditions };
};

defineExpose({ submit, conditionGroup });
</script>
