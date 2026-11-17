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
  <div class="w-64 shrink-0" data-recent-searches-avoid>
    <span aria-live="polite" class="sr-only">{{ announcement }}</span>
    <OSelect
      ref="selectRef"
      data-test="logs-drilldown-stream-select"
      :aria-label="t('search.selectStream')"
      :model-value="modelValue"
      :options="selectOptions"
      :placeholder="t('search.selectStream')"
      size="sm"
      pin-selected-in-groups
      :search-debounce="150"
      class="w-full"
      @update:model-value="onSelect"
      @open="pickerOpen = true"
      @close="onClose"
      @search="onSearch"
      @header-action="onHeaderAction"
    >
      <template #empty>{{ t("search.noResult") }}</template>
    </OSelect>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import { useStreamPickerOptions, type PickerStream } from "@/composables/useStreamPickerOptions";

const props = defineProps<{
  streams: readonly PickerStream[];
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [stream: string];
}>();

const { t } = useI18nTyped();

const selectRef = ref<InstanceType<typeof OSelect> | null>(null);
const pickerOpen = ref(false);
const pickerSearch = ref("");

const { options, onHeaderAction, announcement } = useStreamPickerOptions({
  streams: () => props.streams,
  selected: computed(() => (props.modelValue ? [props.modelValue] : [])),
  open: pickerOpen,
  search: pickerSearch,
});

const selectOptions = computed<SelectOption[]>(() =>
  options.value.map((option) => ({ ...option })),
);

// A debounced search can land after the popover closed and would stick until the next open.
const onSearch = (term: string) => {
  if (pickerOpen.value) pickerSearch.value = term;
};

const onClose = () => {
  pickerOpen.value = false;
  pickerSearch.value = "";
};

const onSelect = (value: SelectModelValue) => {
  if (typeof value === "string" && value && value !== props.modelValue) {
    emit("update:modelValue", value);
  }
};

const open = () => selectRef.value?.focus();

defineExpose({ open });
</script>
