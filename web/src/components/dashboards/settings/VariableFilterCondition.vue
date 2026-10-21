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
  <div class="flex items-center gap-2" data-test="dashboard-variable-filter-condition">
    <OFormSelect
      v-if="!isFirst"
      :name="`${path}.logicalOperator`"
      :options="logicalOperatorOptions"
      :searchable="false"
      size="sm"
      class="w-fit max-w-32"
      :data-test="`dashboard-variable-filter-logical-operator-${testKey}`"
    />
    <OButtonGroup
      class="border-border-default bg-surface-panel shrink-0 border border-s-2 [&>*:not(:first-child)]:!border-s"
      :class="hasError ? 'border-s-input-border-error' : 'border-s-text-body'"
      radius="sm"
      :divided="true"
    >
      <ODropdown>
        <template #trigger>
          <OButton
            variant="ghost"
            size="chip-12"
            class="!pe-1"
            icon-right="arrow-drop-down"
            :data-test="`dashboard-variable-filter-condition-${testKey}`"
          >
            <OTruncatedText class="max-w-80 leading-normal font-normal"
              ><span :class="field ? 'text-text-body' : 'text-text-secondary'">{{
                field || t("dashboard.addSettingVariable.selectFieldPlaceholder")
              }}</span
              ><span class="text-text-secondary">{{ ` ${operatorLabel} ` }}</span
              ><span v-if="needsValue" class="text-badge-error-ol-text">{{
                condition.value
              }}</span></OTruncatedText
            >
          </OButton>
        </template>
        <div class="w-80 max-w-[calc(100vw-1.5rem)]">
          <div class="flex flex-col gap-2.5 p-3">
            <OFormSelect
              :name="`${path}.column.field`"
              :label="t('common.field')"
              :options="fieldOptions"
              label-key="name"
              value-key="name"
              searchable
              :placeholder="t('dashboard.addSettingVariable.selectFieldPlaceholder')"
              data-test="dashboard-query-values-filter-name-selector"
            >
              <template #empty>
                <span class="text-text-secondary italic">{{ t("dashboard.noDataFound") }}</span>
              </template>
            </OFormSelect>
            <OFormSelect
              :name="`${path}.operator`"
              :label="t('common.operator')"
              :options="operatorOptions"
              data-test="dashboard-query-values-filter-operator-selector"
            />
            <OFormCombobox
              v-if="needsValue"
              :name="`${path}.value`"
              :label="t('common.value')"
              :items="valueItems"
              search-regex="(?:^|[^$])\$?(\w+)"
              :debounce="1000"
              :placeholder="t('dashboard.addSettingVariable.enterValueCap')"
              :data-test="`dashboard-query-values-filter-value-selector-${testKey}`"
            />
          </div>
        </div>
      </ODropdown>
      <OButton
        variant="ghost"
        size="icon-chip"
        class="!w-4 shrink-0"
        :data-test="`dashboard-variable-adhoc-close-${testKey}`"
        @click="emit('remove')"
      >
        <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
      </OButton>
    </OButtonGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { SelectOption, SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import type { ComboboxOption } from "@/lib/forms/Combobox/OCombobox.types";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  FILTER_OPERATORS_WITHOUT_VALUE,
  type VariableFilterCondition,
} from "@/utils/dashboard/variables/variableFilterGroupUtils";

const props = defineProps<{
  condition: VariableFilterCondition;
  /** Form path of this condition, e.g. `query_data.filter_group.conditions[0]`. */
  path: string;
  /** Index path joined with "-", used in data-test ids. */
  testKey: string;
  isFirst: boolean;
  fieldOptions: SelectOptionInput[];
  operatorOptions: SelectOption[];
  valueItems: ComboboxOption[];
  promql: boolean;
  hasError: boolean;
}>();

const emit = defineEmits<{
  (e: "remove"): void;
}>();

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null) as any;

const field = computed(() => props.condition.column?.field ?? "");
const needsValue = computed(
  () => !FILTER_OPERATORS_WITHOUT_VALUE.includes(String(props.condition.operator ?? "")),
);
const operatorLabel = computed(
  () =>
    props.operatorOptions.find((option) => option.value === props.condition.operator)?.label ??
    raw(props.condition.operator ?? ""),
);

// PromQL label matchers only combine with AND, so OR stays visible but cannot be picked.
const logicalOperatorOptions = computed<SelectOption[]>(() => [
  { label: raw("AND"), value: "AND" },
  { label: raw("OR"), value: "OR", disabled: props.promql },
]);

watch(
  () => props.condition.operator,
  (operator) => {
    if (FILTER_OPERATORS_WITHOUT_VALUE.includes(String(operator ?? "")) && props.condition.value) {
      form?.setFieldValue(`${props.path}.value`, "");
    }
  },
);
</script>
