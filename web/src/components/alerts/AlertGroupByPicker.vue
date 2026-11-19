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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    modelValue: readonly string[];
    /** The stream's fields or labels, already in ranking order; nothing is ticked for being ranked. */
    options: readonly SelectOptionInput[];
    dataTest?: string;
  }>(),
  { dataTest: "alert-group-by-picker" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string[]): void }>();
const { t } = useI18nTyped();

const onPick = (value: SelectModelValue) =>
  emit(
    "update:modelValue",
    (Array.isArray(value) ? value : []).map(String).filter((label) => label.trim()),
  );
</script>

<template>
  <OSelect
    :model-value="[...modelValue]"
    :options="options"
    multiple
    searchable
    :max-visible-chips="3"
    :aria-label="t('alerts.groupBy')"
    :placeholder="t('alerts.placeholders.selectColumn')"
    class="max-w-full min-w-50"
    :data-test="dataTest"
    @update:model-value="onPick"
  />
</template>
