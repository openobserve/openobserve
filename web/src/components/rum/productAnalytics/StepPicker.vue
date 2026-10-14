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
  <OSelect
    :model-value="value"
    :options="options"
    :placeholder="placeholder"
    :loading="loading"
    :disabled="disabled"
    :clearable="clearable"
    :error-message="failed ? t('rum.analytics.picker.loadFailed') : undefined"
    icon-key="icon"
    searchable
    :search-debounce="300"
    size="sm"
    :data-test="dataTest"
    @open="load"
    @search="onSearch"
    @update:model-value="onPick"
  >
    <template #empty>
      <span v-if="failed" :data-test="`${dataTest}-empty-error`">{{
        t("rum.analytics.picker.loadFailed")
      }}</span>
      <span v-else>{{ t("components.select.noOptionsFound") }}</span>
    </template>
    <template v-if="noCustom" #after-options>
      <span class="text-text-secondary px-3 py-2 text-xs" :data-test="`${dataTest}-no-custom`">{{
        t("rum.analytics.picker.noCustom")
      }}</span>
    </template>
  </OSelect>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import useStepOptions, { decode, encode } from "@/composables/rum/useStepOptions";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepKind, StepRef } from "@/utils/rum/productAnalyticsQueries";

const props = withDefaults(
  defineProps<{
    modelValue: StepRef | null;
    placeholder: I18nText;
    events: NamedEvent[];
    dataTest: string;
    kinds?: StepKind[];
    disabled?: boolean;
    clearable?: boolean;
  }>(),
  { kinds: () => ["e", "p", "c"], disabled: false, clearable: false },
);
const emit = defineEmits<{ "update:modelValue": [StepRef | null] }>();
const { t } = useI18nTyped();
const { options, loading, failed, noCustom, load, onSearch } = useStepOptions({
  events: () => props.events,
  kinds: () => props.kinds,
  modelValue: () => props.modelValue,
});

const value = computed(() => (props.modelValue ? encode(props.modelValue) : null));

const onPick = (v: unknown) => {
  if (typeof v !== "string" || v.startsWith("header:")) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", decode(v));
};
</script>
