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
  <div class="inline-flex w-56 shrink-0" data-test="traces-group-by-select-wrap">
    <!-- First child, so the tooltip binds to the wrapper, not to the select that takes no pointer events. -->
    <OTooltip v-if="sqlMode" :content="t('traces.groups.sqlModeDisabled')" />
    <OSelect
      :model-value="shown"
      :options="options"
      :label="t('traces.groups.label')"
      label-position="inside"
      size="sm"
      :searchable="true"
      :disabled="sqlMode"
      :class="{ 'pointer-events-none': sqlMode }"
      data-test="traces-group-by-select"
      @update:model-value="pick"
    >
      <template #trigger>
        <span class="truncate text-xs leading-4" data-test="traces-group-by-select-value">{{
          shown === NONE ? t("traces.groups.none") : shown
        }}</span>
      </template>
    </OSelect>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  modelValue: string;
  sqlMode: boolean;
  fields: string[];
}>();

const emit = defineEmits<{
  "update:modelValue": [field: string];
}>();

const { t } = useI18nTyped();

// OSelect reads "" as nothing picked (OSelect.vue selectedValues), while a null option is a real pick.
const NONE = null;

const options = computed(() => [
  { label: t("traces.groups.none"), value: NONE },
  ...props.fields.map((field) => ({ label: raw(field), value: field })),
]);

const shown = computed(() => (props.sqlMode || !props.modelValue ? NONE : props.modelValue));

const pick = (value: unknown) => {
  const field = typeof value === "string" ? value : "";
  if (field !== props.modelValue) emit("update:modelValue", field);
};
</script>
