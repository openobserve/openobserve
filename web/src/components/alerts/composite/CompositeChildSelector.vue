<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { type CompositeChildOption, letterFor } from "./expression";

const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    options?: CompositeChildOption[];
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

const byId = computed(() => new Map(props.options.map((option) => [option.alert_id, option])));
const count = computed(() => props.modelValue.length);
const atCap = computed(() => count.value >= props.max);

const optionsFor = (currentId: string) =>
  props.options
    .filter(
      (option) => option.alert_id === currentId || !props.modelValue.includes(option.alert_id),
    )
    .map((option) => ({
      label: raw(option.name ?? option.alert_id),
      value: option.alert_id,
    }));

const replace = (index: number, newId: string): void => {
  const next = [...props.modelValue];
  next[index] = newId;
  emit("update:modelValue", next);
};

const removeAt = (index: number): void => {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, i) => i !== index),
  );
};

const add = (): void => {
  if (atCap.value) return;
  const free = props.options.find((option) => !props.modelValue.includes(option.alert_id));
  if (!free) return;
  emit("update:modelValue", [...props.modelValue, free.alert_id]);
};

const childLink = (child: CompositeChildOption): string =>
  `/web/alerts/detail/${child.alert_id}?folder=${encodeURIComponent(child.folder_id ?? "default")}`;
</script>

<template>
  <section class="flex flex-col gap-2" data-test="alerts-composite-child-selector">
    <div class="flex items-center justify-between gap-3">
      <OButton
        variant="outline"
        size="xs"
        icon-left="add"
        :disabled="atCap"
        data-test="alerts-composite-child-add"
        @click="add"
      >
        {{ t("alerts.composite.addAlert") }}
      </OButton>
      <OTag
        data-test="alerts-composite-child-cap"
        :variant="atCap ? 'warning-soft' : 'default-soft'"
        size="sm"
        :label="t('alerts.composite.childCap', { count, max })"
      />
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-for="(id, index) in modelValue"
        :key="`${id}-${index}`"
        class="border-border-default rounded-default flex items-center gap-2 border p-2"
        :data-test="`alerts-composite-selected-child-${id}`"
      >
        <span
          class="bg-theme-accent-soft text-theme-accent rounded-default flex h-7 w-7 shrink-0 items-center justify-center font-bold"
        >
          {{ raw(letterFor(index)) }}
        </span>

        <OSelect
          v-if="byId.has(id)"
          :model-value="id"
          :options="optionsFor(id)"
          :searchable="true"
          :placeholder="t('alerts.composite.searchChildren')"
          class="min-w-0 flex-1"
          :data-test="`alerts-composite-child-select-${id}`"
          @update:model-value="replace(index, $event as string)"
        />
        <span v-else class="min-w-0 flex-1 truncate font-mono text-xs" :title="id">
          {{ raw(id) }}
        </span>

        <OTag
          v-if="byId.get(id)?.alert_type"
          type="alertType"
          :value="byId.get(id)!.alert_type!"
          size="xs"
          :data-test="`alerts-composite-child-type-${id}`"
        />
        <OTag
          v-if="byId.has(id)"
          type="alertLevel"
          :value="byId.get(id)!.level ?? 'nodata'"
          size="xs"
          :data-test="`alerts-composite-child-level-${id}`"
        />

        <a
          v-if="byId.has(id)"
          :href="childLink(byId.get(id)!)"
          target="_blank"
          rel="noopener"
          class="text-text-secondary hover:text-link-primary flex h-7 w-7 shrink-0 items-center justify-center"
          :aria-label="t('alerts.composite.openChild', { name: byId.get(id)!.name ?? id })"
          :data-test="`alerts-composite-child-open-${id}`"
        >
          <OIcon name="open-in-new" size="sm" />
        </a>
        <OButton
          variant="ghost-destructive"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('alerts.composite.removeChild', { name: byId.get(id)?.name ?? id })"
          :data-test="`alerts-composite-child-remove-${id}`"
          @click="removeAt(index)"
        />
      </div>

      <div
        v-if="count === 0"
        class="text-text-secondary py-4 text-center text-xs"
        data-test="alerts-composite-child-empty"
      >
        {{ t("alerts.composite.noChildren") }}
      </div>
    </div>
  </section>
</template>
