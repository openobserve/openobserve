<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { ComboboxProps, ComboboxEmits, ComboboxSlots } from "./OCombobox.types";
import type { ComboboxOption } from "./OCombobox.types";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from "reka-ui";
import { computed, ref, useAttrs, useId, useSlots, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<ComboboxProps>(), {
  items: () => [],
  disabled: false,
  size: "md",
  error: false,
  debounce: 0,
  valueReplaceFn: (option: ComboboxOption) => option.value,
});

const emit = defineEmits<ComboboxEmits>();
defineSlots<ComboboxSlots>();

const slots = useSlots();
const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);

// ── Internal input value ────────────────────────────────────────────────────
// ComboboxRoot manages its own internal "filter" value. We sync it with
// modelValue so the control works as a controlled component.
const internalValue = ref(props.modelValue ?? "");

watch(
  () => props.modelValue,
  (v) => {
    internalValue.value = v ?? "";
  },
);

// ── Filtered options ────────────────────────────────────────────────────────
// Apply optional regex-based needle extraction (same logic as CommonAutoComplete).
const filteredOptions = computed<ComboboxOption[]>(() => {
  const val = internalValue.value;
  if (!val) return props.items ?? [];

  let needle = val;

  if (props.searchRegex) {
    const regex = new RegExp(props.searchRegex, "gi");
    const match = regex.exec(val);
    if (!match) return [];
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        needle = match[i];
        break;
      }
    }
  }

  const lower = needle.toLowerCase();
  return (props.items ?? []).filter((opt) =>
    opt.label.toLowerCase().includes(lower),
  );
});

// ── Event handlers ──────────────────────────────────────────────────────────
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInputChange(val: string) {
  internalValue.value = val;
  if (props.debounce > 0) {
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => emit("update:modelValue", val), props.debounce);
  } else {
    emit("update:modelValue", val);
  }
}

function onSelect(optionValue: string) {
  const option = props.items?.find((o) => o.value === optionValue);
  if (!option) return;
  const replaced = props.valueReplaceFn(option);
  internalValue.value = replaced;
  emit("update:modelValue", replaced);
  emit("select", replaced);
}

// ── Sizes ────────────────────────────────────────────────────────────────────
const heightClass = computed(() =>
  props.size === "sm" ? "tw:h-8 tw:text-sm" : "tw:h-8 tw:text-sm",
);

// ── Error ────────────────────────────────────────────────────────────────────
const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined,
);
</script>

<template>
  <div
    v-bind="$attrs"
    class="tw:flex tw:flex-col tw:gap-1 tw:w-full"
    :data-test="parentDataTest"
  >
    <!-- Label -->
    <label
      v-if="hasLabel || $slots.tooltip"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-select-label tw:leading-none tw:flex tw:items-center tw:gap-1"
    >
      <slot name="label">{{ label }}</slot>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help tw:text-input-label"
      ><slot name="tooltip" /></OIcon>
    </label>

    <ComboboxRoot
      :model-value="internalValue"
      :filter-function="() => filteredOptions.map((o) => o.value)"
      :disabled="disabled"
      ignore-diacritics
      @update:model-value="onSelect"
    >
      <ComboboxAnchor class="tw:relative tw:flex tw:items-center tw:w-full">
        <ComboboxInput
          :id="inputId"
          :name="name"
          :placeholder="placeholder"
          :disabled="disabled"
          auto-complete="off"
          :class="[
            'tw:w-full tw:rounded-md tw:border tw:ps-3 tw:pe-3',
            'tw:bg-input-bg tw:text-input-text',
            'tw:placeholder:text-input-placeholder',
            'tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-150',
            hasError
              ? 'tw:border-input-border-error'
              : 'tw:border-input-border tw:hover:border-input-border-hover',
            'tw:focus:border-input-border-focus tw:focus:ring-2 tw:focus:ring-input-focus-ring',
            'tw:disabled:bg-input-disabled-bg tw:disabled:cursor-not-allowed tw:disabled:text-input-disabled-text',
            heightClass,
          ]"
          :data-test="parentDataTest ? `${parentDataTest}-input` : undefined"
          @update:model-value="onInputChange"
        />
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="4"
          :class="[
            'tw:z-[10001] tw:min-w-(--reka-combobox-trigger-width)',
            'tw:max-h-60 tw:overflow-hidden',
            'tw:rounded-md tw:border tw:shadow-lg',
            'tw:bg-select-content-bg tw:border-select-content-border',
            'tw:p-1',
            'tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out',
            'tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0',
            'tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95',
            'tw:data-[side=bottom]:slide-in-from-top-2',
            'tw:data-[side=top]:slide-in-from-bottom-2',
          ]"
        >
          <ComboboxViewport class="tw:max-h-56 tw:overflow-y-auto">
            <ComboboxEmpty
              class="tw:py-2 tw:px-3 tw:text-sm tw:text-select-placeholder tw:text-center"
            >
              No options found
            </ComboboxEmpty>

            <ComboboxItem
              v-for="option in filteredOptions"
              :key="option.value"
              :value="option.value"
              :class="[
                'tw:relative tw:flex tw:items-center tw:gap-2 tw:w-full',
                'tw:ps-3 tw:pe-8 tw:py-1.5 tw:text-sm',
                'tw:text-select-item-text tw:rounded-sm',
                'tw:cursor-pointer tw:select-none tw:outline-none',
                'tw:transition-colors tw:duration-100',
                'tw:data-highlighted:bg-select-item-hover-bg',
                'tw:data-[state=checked]:bg-select-item-selected-bg tw:data-[state=checked]:text-select-item-selected-text',
                'tw:data-disabled:text-select-item-disabled tw:data-disabled:cursor-not-allowed',
              ]"
              :data-test="parentDataTest ? `${parentDataTest}-option` : undefined"
            >
              <span class="tw:flex-1 tw:truncate">{{ option.label }}</span>
              <ComboboxItemIndicator
                class="tw:absolute tw:end-2 tw:flex tw:items-center tw:justify-center tw:size-3.5"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  class="tw:size-3.5"
                  aria-hidden="true"
                >
                  <path
                    fill-rule="evenodd"
                    d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </ComboboxItemIndicator>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>

    <!-- Error message -->
    <span
      v-if="effectiveError && effectiveError.trim()"
      class="tw:text-xs tw:text-input-error-text tw:leading-none"
      role="alert"
    >
      {{ effectiveError }}
    </span>
    <!-- Help text -->
    <span
      v-else-if="helpText"
      class="tw:text-xs tw:text-input-help-text tw:leading-none"
    >
      {{ helpText }}
    </span>
  </div>
</template>
