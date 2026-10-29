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

<!-- Same chip row as the Metrics LabelFilterEditor; the profiles API only accepts "=", so there is no operator choice. -->
<template>
  <div class="flex min-w-0 flex-wrap items-center gap-2" data-test="profiles-label-filters">
    <span class="flex items-center text-sm whitespace-nowrap">
      {{ t("panel.labelFilters") }}
    </span>

    <component
      :is="item.filter ? OButtonGroup : 'div'"
      v-for="item in items"
      :key="item.id"
      v-bind="item.filter ? { radius: 'sm', divided: true } : {}"
      :class="
        item.filter
          ? 'border-border-default bg-surface-panel overflow-hidden border [&>*:not(:first-child)]:!border-s'
          : 'flex'
      "
      :data-test="item.filter ? `profiles-filter-chip-${item.filter.key}` : undefined"
    >
      <ODropdown
        :open="editingIndex === item.index"
        @update:open="(open: boolean) => setEditing(item.index, open)"
      >
        <template #trigger>
          <OButton
            v-if="item.filter"
            variant="ghost"
            size="chip-12"
            class="!ps-1 !pe-1"
            :data-test="`profiles-filter-edit-${item.filter.key}`"
          >
            <span class="leading-normal font-normal whitespace-nowrap">
              <span class="text-promql-label">{{ item.filter.key }}</span>
              <span class="text-text-secondary px-1">{{ item.filter.op }}</span>
              <span class="text-promql-string">{{ item.filter.value }}</span>
            </span>
            <template #icon-right><OIcon name="arrow-drop-down" size="sm" /></template>
          </OButton>
          <OButton
            v-else
            variant="outline"
            size="icon-chip"
            :aria-label="t('metrics.labelFilterEditor.addLabelFilter')"
            data-test="profiles-add-filter"
          >
            <OIcon name="add" size="sm" />
            <OTooltip :content="t('metrics.labelFilterEditor.addLabelFilter')" side="top" />
          </OButton>
        </template>
        <div v-if="editingIndex === item.index" class="p-3">
          <div class="w-86 [&_.o-input-label]:text-xs [&_.o-input-label]:font-normal">
            <OSelect
              v-model="draftKey"
              :options="labelOptions"
              :label="t('metrics.labelFilterEditor.label')"
              class="mb-1.5"
              searchable
              clearable
              data-test="profiles-tag-key-select"
            >
              <template #empty>
                <span class="text-text-secondary px-3 py-2">{{
                  t("metrics.labelFilterEditor.noLabelsFound")
                }}</span>
              </template>
            </OSelect>
            <OSelect
              :model-value="draftValue"
              :options="valueOptions"
              :label="t('metrics.labelFilterEditor.value')"
              :disabled="!draftKey"
              :loading="valuesLoading"
              searchable
              clearable
              data-test="profiles-tag-value-select"
              @update:model-value="selectValue"
            >
              <template #empty>
                <span class="text-text-secondary px-3 py-2">{{
                  draftKey
                    ? t("metrics.labelFilterEditor.noValuesFound")
                    : t("metrics.labelFilterEditor.selectLabelFirst")
                }}</span>
              </template>
            </OSelect>
          </div>
        </div>
      </ODropdown>
      <OButton
        v-if="item.filter"
        variant="ghost"
        size="icon-chip"
        class="!w-4"
        :aria-label="t('profiles.removeFilter', { key: item.filter.key, value: item.filter.value })"
        :data-test="`profiles-filter-remove-${item.filter.key}`"
        @click="emit('remove', item.filter)"
      >
        <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
      </OButton>
    </component>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ProfileFilter } from "@/services/profiles";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  filters: ProfileFilter[];
  labelOptions: { label: I18nText; value: string }[];
  valueOptions: { label: I18nText; value: string }[];
  valuesLoading: boolean;
}>();
const emit = defineEmits<{
  apply: [];
  remove: [filter: ProfileFilter];
}>();
/** Index of the chip whose menu is open; -1 is the add button, null is closed. */
const editingIndex = defineModel<number | null>("editingIndex", { default: null });
const draftKey = defineModel<string | null>("draftKey", { default: null });
const draftValue = defineModel<string | null>("draftValue", { default: null });

const { t } = useI18nTyped();

const items = computed(() => [
  ...props.filters.map((filter, index) => ({
    id: `${filter.key}=${filter.value}`,
    index,
    filter,
  })),
  { id: "add", index: -1, filter: null },
]);

const setEditing = (index: number, open: boolean) => {
  if (open) {
    editingIndex.value = index;
    draftKey.value = index >= 0 ? props.filters[index].key : null;
  } else if (editingIndex.value === index) {
    editingIndex.value = null;
    draftKey.value = null;
  }
};

const selectValue = (value: unknown) => {
  // A defineModel ref still reads the old prop until the parent re-renders.
  const next = typeof value === "string" && value ? value : null;
  draftValue.value = next;
  if (next) emit("apply");
};
</script>
