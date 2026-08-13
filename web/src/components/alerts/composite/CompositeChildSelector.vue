<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { raw, useI18nTyped } from "@/types/i18n";

interface ChildOption {
  alert_id: string;
  name?: string;
  alert_type?: string;
  folder_id?: string;
  folder_name?: string;
  enabled?: boolean;
  level?: string | null;
  stale?: boolean;
  accessible: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    options?: ChildOption[];
    max?: number;
  }>(),
  {
    modelValue: () => [],
    options: () => [],
    max: 10,
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string[]): void;
}>();

const { t } = useI18nTyped();
const search = ref("");

const selected = computed(() => new Set(props.modelValue));
const selectedOptions = computed(() =>
  props.modelValue
    .map((id) => props.options.find((option) => option.alert_id === id))
    .filter((option): option is ChildOption => option !== undefined),
);
const filteredOptions = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  if (!needle) return props.options;
  return props.options.filter((option) =>
    [option.name, option.alert_type, option.folder_name, option.folder_id]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  );
});

const isUnavailable = (option: ChildOption): boolean =>
  !option.accessible ||
  (!selected.value.has(option.alert_id) && props.modelValue.length >= props.max);

const toggle = (option: ChildOption): void => {
  if (isUnavailable(option)) return;
  if (selected.value.has(option.alert_id)) {
    emit(
      "update:modelValue",
      props.modelValue.filter((id) => id !== option.alert_id),
    );
    return;
  }
  emit("update:modelValue", [...props.modelValue, option.alert_id]);
};

const optionLabel = (option: ChildOption) =>
  t("alerts.composite.childOptionLabel", {
    name: option.name ?? option.alert_id,
    folder: option.folder_name ?? option.folder_id ?? t("alerts.composite.unknownFolder"),
  });
</script>

<template>
  <section class="flex min-h-0 flex-col gap-3" data-test="alerts-composite-child-selector">
    <div class="flex items-center justify-between gap-3">
      <OSearchInput
        v-model="search"
        data-test="alerts-composite-child-search"
        :placeholder="t('alerts.composite.searchChildren')"
      />
      <OBadge
        data-test="alerts-composite-child-cap"
        :variant="modelValue.length >= max ? 'warning-soft' : 'default-soft'"
        size="sm"
      >
        {{ t("alerts.composite.childCap", { count: modelValue.length, max }) }}
      </OBadge>
    </div>

    <div v-if="selectedOptions.length" class="flex flex-wrap gap-2">
      <OBadge
        v-for="option in selectedOptions"
        :key="option.alert_id"
        variant="primary-soft"
        shape="rounded"
        :title="option.name ?? option.alert_id"
        :data-child-id="option.alert_id"
        :data-test="`alerts-composite-selected-child-${option.alert_id}`"
      >
        {{ raw(option.name ?? option.alert_id) }}
      </OBadge>
    </div>

    <div class="border-border-default rounded-surface flex min-h-0 flex-col gap-1 border p-2">
      <OButton
        v-for="option in filteredOptions"
        :key="option.alert_id"
        variant="ghost"
        size="sm"
        class="justify-start!"
        :active="selected.has(option.alert_id)"
        :disabled="isUnavailable(option)"
        :aria-label="optionLabel(option)"
        :data-test="`alerts-composite-child-option-${option.alert_id}`"
        @click="toggle(option)"
        @keydown.enter.prevent="toggle(option)"
      >
        <span class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate" :title="option.name ?? option.alert_id">
            {{ raw(option.name ?? option.alert_id) }}
          </span>
          <span class="text-text-secondary flex shrink-0 items-center gap-2 text-xs">
            <span>{{ raw(option.folder_name ?? option.folder_id) }}</span>
            <span>{{ raw(option.alert_type) }}</span>
          </span>
        </span>
      </OButton>
    </div>
  </section>
</template>
