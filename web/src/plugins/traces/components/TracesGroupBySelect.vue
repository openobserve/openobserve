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
  <span
    class="rounded-default inline-flex h-6 shrink-0 items-center gap-0.5 border ps-2 pe-0.5"
    :class="
      modelValue ? 'border-accent bg-accent/10' : 'border-button-outline-border border-dashed'
    "
    data-test="traces-group-by-chip-wrap"
  >
    <OSelect
      :model-value="modelValue || null"
      :options="options"
      :aria-label="triggerLabel"
      appearance="inline"
      size="xs"
      :searchable="true"
      data-test="traces-group-by-chip"
      @update:model-value="pick"
    >
      <template #trigger>
        <span class="flex min-w-0 items-center gap-1" data-test="traces-group-by-chip-value">
          <template v-if="modelValue">
            <span
              class="max-w-56 truncate"
              :title="modelValue"
              data-test="traces-group-by-chip-field"
            >
              {{ t("traces.groups.grouped", { field: raw(modelValue) }) }}
            </span>
            <span
              v-if="countLabel"
              class="hidden shrink-0 @min-[67rem]/results:inline"
              data-test="traces-group-by-chip-count"
            >
              · {{ countLabel }}
            </span>
          </template>
          <template v-else>{{ t("traces.groups.label") }}</template>
        </span>
      </template>
    </OSelect>
    <OButton
      v-if="modelValue"
      variant="ghost-neutral"
      size="icon"
      class="size-5!"
      :aria-label="t('traces.groups.clear')"
      data-test="traces-group-by-clear"
      @click.stop="emit('update:modelValue', '')"
    >
      <OIcon name="close" size="xs" />
    </OButton>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { formatLargeNumber } from "@/utils/zincutils";
import { GROUPS_LIMIT } from "@/utils/traces/tracesGroups";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    fields: string[];
    /** Groups found, or null until they load. */
    count?: number | null;
  }>(),
  { count: null },
);

const emit = defineEmits<{
  "update:modelValue": [field: string];
}>();

const { t } = useI18nTyped();

const options = computed(() => props.fields.map((field) => ({ label: raw(field), value: field })));

// Above the row limit the count comes from approx_distinct, as the table footer marks.
const countLabel = computed(() => {
  if (!props.modelValue || props.count === null) return "";
  const shown = `${props.count > GROUPS_LIMIT ? "~" : ""}${formatLargeNumber(props.count)}`;
  return t("traces.groups.count", { count: shown }, props.count);
});

const triggerLabel = computed(() => {
  if (!props.modelValue) return t("traces.groups.label");
  const grouped = t("traces.groups.grouped", { field: raw(props.modelValue) });
  return countLabel.value ? `${grouped} · ${countLabel.value}` : grouped;
});

const pick = (value: unknown) => {
  const field = typeof value === "string" ? value : "";
  if (field && field !== props.modelValue) emit("update:modelValue", field);
};
</script>
