<!-- Copyright 2026 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

<template>
  <OEmptyState
    v-if="modelValue.length === 0"
    size="inline"
    icon="swap-horiz"
    :title="t('dashboard.valueMappingEmptyTitle')"
    :description="t('dashboard.valueMappingEmptyDescription')"
    :data-test="`${dataTestPrefix}-empty`"
  />
  <draggable
    v-else
    :model-value="modelValue"
    :options="dragOptions"
    @update:model-value="emit('update:modelValue', $event)"
    @mousedown.stop="() => {}"
    :data-test="`${dataTestPrefix}-drag`"
  >
    <div v-for="(mapping, index) in modelValue" :key="index" class="mb-2 flex items-start gap-2">
      <div class="cursor-move p-2">
        <OIcon
          name="drag-indicator"
          size="sm"
          :data-test="`${dataTestPrefix}-drag-handle-${index}`"
        />
      </div>
      <div
        class="rounded-default border-border-default flex flex-1 flex-col gap-2 border px-2.5 py-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
            >{{ t("dashboard.valueMappingIfValue") }}</span
          >
          <div class="w-44 shrink-0">
            <OSelect
              :model-value="mapping.type"
              :options="mappingTypes"
              class="w-full"
              :data-test="`${dataTestPrefix}-type-select-${index}`"
              @update:model-value="update(index, { type: $event })"
            />
          </div>
          <div v-if="mapping.type === 'range'" class="flex w-52 shrink-0 gap-2">
            <div class="min-w-0 flex-1">
              <OInput
                :model-value="mapping.from"
                :placeholder="t('dashboard.valueMappingFrom')"
                class="w-full"
                :data-test="`${dataTestPrefix}-from-input-${index}`"
                @update:model-value="update(index, { from: $event })"
              />
            </div>
            <div class="min-w-0 flex-1">
              <OInput
                :model-value="mapping.to"
                :placeholder="t('dashboard.valueMappingTo')"
                class="w-full"
                :data-test="`${dataTestPrefix}-to-input-${index}`"
                @update:model-value="update(index, { to: $event })"
              />
            </div>
          </div>
          <div v-else-if="mapping.type === 'regex'" class="w-52 shrink-0">
            <OInput
              :model-value="mapping.pattern"
              :placeholder="t('dashboard.valueMappingRegex')"
              :error="!!patternErrors[index]"
              :error-message="patternErrors[index]"
              class="w-full"
              :data-test="`${dataTestPrefix}-pattern-input-${index}`"
              @update:model-value="update(index, { pattern: $event })"
            />
          </div>
          <div v-else class="w-52 shrink-0">
            <OInput
              :model-value="mapping.value"
              :placeholder="t('dashboard.valueMappingValue')"
              class="w-full"
              :data-test="`${dataTestPrefix}-value-input-${index}`"
              @update:model-value="update(index, { value: $event })"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
            >{{ t("dashboard.valueMappingDisplayValue") }}</span
          >
          <div class="w-98 shrink-0">
            <OInput
              :model-value="mapping.text"
              :placeholder="t('dashboard.valueMappingDisplayPlaceholder')"
              class="w-full"
              :data-test="`${dataTestPrefix}-text-input-${index}`"
              @update:model-value="update(index, { text: $event })"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
            >{{ t("dashboard.textColor") }}</span
          >
          <ColorSwatchPicker
            :model-value="mapping.textColor"
            :swatches="TEXT_SWATCHES"
            :data-test="`${dataTestPrefix}-text-color-${index}`"
            @update:model-value="update(index, { textColor: $event })"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
            >{{ t("dashboard.bgColor") }}</span
          >
          <ColorSwatchPicker
            :model-value="mapping.color"
            :swatches="BG_SWATCHES"
            :data-test="`${dataTestPrefix}-bg-color-${index}`"
            @update:model-value="update(index, { color: $event })"
          />
        </div>
      </div>
      <OButton
        variant="ghost"
        size="icon-xs"
        icon-left="close"
        :title="t('common.remove')"
        class="shrink-0"
        :data-test="`${dataTestPrefix}-delete-btn-${index}`"
        @click="emit('remove', index)"
      />
    </div>
  </draggable>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VueDraggableNext as draggable } from "vue-draggable-next";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { TEXT_SWATCHES, BG_SWATCHES } from "@/composables/dashboard/useColumnFormatting";

/** `patternErrors` is keyed by row index; a row is deleted through the `remove` emit, never `update:modelValue`. */
const props = withDefaults(
  defineProps<{
    modelValue: any[];
    patternErrors?: Record<number, I18nText>;
    dataTestPrefix?: string;
  }>(),
  { patternErrors: () => ({}), dataTestPrefix: "dashboard-addpanel-config-value-mapping" },
);

const emit = defineEmits<{ "update:modelValue": [value: any[]]; remove: [index: number] }>();

const { t } = useI18nTyped();

const dragOptions = { animation: 200 };

const mappingTypes = computed(() => [
  { label: t("dashboard.valueMappingTypeValue"), value: "value" },
  { label: t("dashboard.valueMappingTypeRange"), value: "range" },
  { label: t("dashboard.valueMappingTypeRegex"), value: "regex" },
  { label: t("dashboard.valueMappingTypeGt"), value: "gt" },
  { label: t("dashboard.valueMappingTypeLt"), value: "lt" },
  { label: t("dashboard.valueMappingTypeGte"), value: "gte" },
  { label: t("dashboard.valueMappingTypeLte"), value: "lte" },
]);

const update = (index: number, change: Record<string, unknown>) =>
  emit(
    "update:modelValue",
    props.modelValue.map((mapping, i) => (i === index ? { ...mapping, ...change } : mapping)),
  );
</script>
