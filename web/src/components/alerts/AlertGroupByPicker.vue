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
import { computed, onBeforeUnmount, ref } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type {
  SelectModelValue,
  SelectOptionInput,
  SelectProps,
} from "@/lib/forms/Select/OSelect.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    modelValue: readonly string[];
    /** The stream's fields or labels, already in ranking order; nothing is ticked for being ranked. */
    options: readonly SelectOptionInput[];
    /** What an empty pick reads as; step 1 says the alert is not split. */
    placeholder?: I18nText;
    size?: SelectProps["size"];
    dropdownStyle?: SelectProps["dropdownStyle"];
    dataTest?: string;
  }>(),
  {
    placeholder: undefined,
    size: undefined,
    dropdownStyle: undefined,
    dataTest: "alert-group-by-picker",
  },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string[]): void }>();
const { t } = useI18nTyped();

// A pick re-renders the form around the picker, so picks wait for the list to close.
const draft = ref<string[] | null>(null);
const shown = computed(() => draft.value ?? [...props.modelValue]);
const labels = (value: SelectModelValue) =>
  (Array.isArray(value) ? value : []).map(String).filter((label) => label.trim());

const onOpen = () => {
  draft.value = [...props.modelValue];
};
const onPick = (value: SelectModelValue) => {
  if (draft.value) draft.value = labels(value);
  else emit("update:modelValue", labels(value));
};
const onClose = () => {
  const picked = draft.value;
  draft.value = null;
  if (picked && picked.join("\n") !== props.modelValue.join("\n"))
    emit("update:modelValue", picked);
};
onBeforeUnmount(onClose);
</script>

<template>
  <OSelect
    :model-value="shown"
    :options="options"
    multiple
    searchable
    :max-visible-chips="3"
    :aria-label="t('alerts.groupBy')"
    :placeholder="placeholder ?? t('alerts.placeholders.selectColumn')"
    :size="size"
    :dropdown-style="dropdownStyle"
    class="max-w-full min-w-50"
    :data-test="dataTest"
    @update:model-value="onPick"
    @open="onOpen"
    @close="onClose"
  />
</template>
