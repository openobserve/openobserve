<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  DateTimeRangeTimezoneEmits,
  DateTimeRangeTimezoneProps,
} from "./ODateTimeRangeTimezone.types";
import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(defineProps<DateTimeRangeTimezoneProps>(), {
  disabled: false,
});
const emit = defineEmits<DateTimeRangeTimezoneEmits>();

const { t } = useI18nTyped();

const open = ref(false);
const search = ref("");

function tzLabel(tz: string): I18nText {
  return tz === "" ? t("common.browserTime") : raw(tz);
}

const filtered = computed((): string[] => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.options;
  return props.options.filter((tz) => tzLabel(tz).toLowerCase().includes(term));
});

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

function select(tz: string) {
  emit("update:modelValue", tz);
  search.value = "";
  open.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      class="rounded-default border-datepicker-inner-border bg-datepicker-bg text-datepicker-text text-compact flex h-7 w-full items-center justify-between gap-2 border px-2 outline-none disabled:cursor-not-allowed disabled:opacity-50"
      data-test="datetimerange-timezone-trigger"
      @click="toggle"
    >
      <span class="truncate">{{ tzLabel(modelValue) }}</span>
      <OIcon
        name="expand-more"
        size="xs"
        :class="[
          'text-select-icon shrink-0 transition-transform duration-150',
          open ? 'rotate-180' : '',
        ]"
      />
    </button>
    <div
      v-if="open && !disabled"
      class="rounded-default border-select-content-border bg-select-content-bg overflow-hidden border"
    >
      <div class="border-select-content-border flex h-7 items-center gap-2 border-b px-3">
        <OIcon name="search" size="xs" class="text-text-secondary shrink-0" />
        <input
          v-model="search"
          type="text"
          :placeholder="t('components.dateTimeRange.searchTimezonePlaceholder')"
          autofocus
          class="text-text-body placeholder:text-text-secondary text-compact min-w-0 flex-1 border-0 bg-transparent outline-none"
          data-test="datetimerange-timezone-search"
        />
      </div>
      <div class="max-h-40 overflow-y-auto p-1">
        <button
          v-for="tz in filtered"
          :key="tz"
          type="button"
          :aria-pressed="modelValue === tz"
          :class="[
            'rounded-default text-compact flex min-h-7 w-full items-center gap-2 px-2 text-start max-md:min-h-9',
            'focus-visible:ring-datepicker-focus-ring outline-none focus-visible:ring-2',
            'transition-colors duration-(--duration-control) ease-(--ease-control)',
            modelValue === tz
              ? 'bg-select-item-selected-bg text-select-item-selected-text'
              : 'text-select-item-text hover:bg-select-item-hover-bg',
          ]"
          @click="select(tz)"
        >
          <OTruncatedText class="min-w-0 flex-1">{{ tzLabel(tz) }}</OTruncatedText>
          <OIcon v-if="modelValue === tz" name="check" size="sm" class="shrink-0" />
        </button>
        <div v-if="filtered.length === 0" class="text-text-secondary text-compact py-4 text-center">
          {{ t("components.dateTimeRange.noTimezonesFound") }}
        </div>
      </div>
    </div>
  </div>
</template>
