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
  <div
    class="rounded-default flex p-0"
    :class="depth > 0 ? 'bg-brand-indigo/5 ps-1.25' : ''"
    :data-test="
      depth > 0 ? `dashboard-variable-filter-group-${testKey}` : 'dashboard-variable-filter-group'
    "
  >
    <div class="flex flex-row flex-wrap items-center gap-y-1">
      <div
        v-for="(node, index) in group.conditions"
        :key="index"
        class="me-2.5 inline-flex min-h-8.75 items-center gap-2"
      >
        <OFormSelect
          v-if="node.filterType === 'group' && index > 0"
          :name="`${childPath(index)}.logicalOperator`"
          :options="logicalOperatorOptions"
          :searchable="false"
          size="sm"
          class="w-fit max-w-32"
          :data-test="`dashboard-variable-filter-logical-operator-${childKey(index)}`"
        />
        <VariableFilterGroup
          v-if="node.filterType === 'group'"
          :group="node"
          :path="childPath(index)"
          :test-key="childKey(index)"
          :depth="depth + 1"
          :field-options="fieldOptions"
          :operator-options="operatorOptions"
          :value-items="valueItems"
          :promql="promql"
          :show-errors="showErrors"
          @remove="removeAt(index)"
        />
        <VariableFilterCondition
          v-else
          :condition="node"
          :path="childPath(index)"
          :test-key="childKey(index)"
          :is-first="index === 0"
          :field-options="fieldOptions"
          :operator-options="operatorOptions"
          :value-items="valueItems"
          :promql="promql"
          :has-error="showErrors && getFilterConditionIssues(node, promqlOperators).length > 0"
          @remove="removeAt(index)"
        />
      </div>
      <ODropdown v-model:open="showAddMenu">
        <template #trigger>
          <OButton
            variant="outline"
            :aria-label="t('common.addCondition')"
            size="icon-chip"
            icon-left="add"
            :data-test="
              depth > 0
                ? `dashboard-variable-filter-group-${testKey}-add`
                : 'dashboard-add-filter-btn'
            "
          />
        </template>
        <ODropdownItem data-test="dashboard-variable-filter-add-condition" @select="addCondition">
          {{ t("common.addCondition") }}
        </ODropdownItem>
        <ODropdownItem
          v-if="!promql"
          data-test="dashboard-variable-filter-add-group"
          @select="addGroup"
        >
          {{ t("common.addGroup") }}
        </ODropdownItem>
      </ODropdown>
    </div>
    <div
      v-if="depth > 0"
      class="border-border-default ms-2 flex items-center justify-between border-s ps-1.5"
    >
      <OButton
        variant="ghost"
        :aria-label="t('common.remove')"
        size="icon-chip"
        class="!w-4"
        :data-test="`dashboard-variable-filter-group-${testKey}-remove`"
        @click="emit('remove')"
      >
        <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { SelectOption, SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import type { ComboboxOption } from "@/lib/forms/Combobox/OCombobox.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { PROMQL_FILTER_OPERATORS } from "@/utils/dashboard/variables/queryVariableUtils";
import {
  createFilterCondition,
  createFilterGroup,
  getFilterConditionIssues,
  type VariableFilterGroup,
} from "@/utils/dashboard/variables/variableFilterGroupUtils";
import VariableFilterCondition from "./VariableFilterCondition.vue";

defineOptions({ name: "VariableFilterGroup" });

const props = defineProps<{
  group: VariableFilterGroup;
  /** Form path of this group, e.g. `query_data.filter_group`. */
  path: string;
  /** Index path joined with "-", used in data-test ids; empty for the top group. */
  testKey: string;
  depth: number;
  fieldOptions: SelectOptionInput[];
  operatorOptions: SelectOption[];
  valueItems: ComboboxOption[];
  promql: boolean;
  showErrors: boolean;
}>();

const emit = defineEmits<{
  (e: "remove"): void;
}>();

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null) as any;
const showAddMenu = ref(false);

const promqlOperators = computed(() => (props.promql ? PROMQL_FILTER_OPERATORS : undefined));
const logicalOperatorOptions = computed<SelectOption[]>(() => [
  { label: raw("AND"), value: "AND" },
  { label: raw("OR"), value: "OR", disabled: props.promql },
]);

const childPath = (index: number) => `${props.path}.conditions[${index}]`;
const childKey = (index: number) => (props.testKey ? `${props.testKey}-${index}` : `${index}`);

const addCondition = () => {
  form?.pushFieldValue(`${props.path}.conditions`, createFilterCondition());
  showAddMenu.value = false;
};

const addGroup = () => {
  form?.pushFieldValue(`${props.path}.conditions`, createFilterGroup());
  showAddMenu.value = false;
};

const removeAt = (index: number) => {
  form?.removeFieldValue(`${props.path}.conditions`, index);
};
</script>
