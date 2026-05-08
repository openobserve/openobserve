<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  SelectProps,
  SelectEmits,
  SelectSlots,
  SelectValue as SelectPrimitiveValue,
  SelectModelValue,
} from "./OSelect.types";
import { SELECT_VALUE_MAP_KEY } from "./OSelect.types";
import OSelectItem from "./OSelectItem.vue";
import {
  ListboxFilter,
  ListboxItem,
  ListboxItemIndicator,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "reka-ui";
import { computed, provide, ref, useSlots } from "vue";

type NormalizedOption = {
  label: string;
  value: SelectPrimitiveValue;
  disabled: boolean;
};

const DEFAULT_OPTION_LABEL = "label";
const DEFAULT_OPTION_VALUE = "value";
const DEFAULT_OPTION_DISABLED = "disabled";

const props = withDefaults(defineProps<SelectProps>(), {
  size: "md",
  disabled: false,
  clearable: false,
  error: false,
  multiple: false,
  searchable: false,
  searchPlaceholder: "Search...",
  emptyText: "No options found",
  optionLabel: DEFAULT_OPTION_LABEL,
  optionValue: DEFAULT_OPTION_VALUE,
  optionDisabled: DEFAULT_OPTION_DISABLED,
});

const emit = defineEmits<SelectEmits>();
const slots = useSlots();

defineSlots<SelectSlots>();

// Value map populated by OSelectItem children to preserve original types
// (Reka UI requires string values; this lets us recover number originals)
const valueMap = new Map<string, SelectPrimitiveValue>();
provide(SELECT_VALUE_MAP_KEY, valueMap);

const isPrimitiveSelectValue = (
  value: unknown,
): value is SelectPrimitiveValue =>
  ["string", "number", "boolean"].includes(typeof value);

function normalizeOption(raw: unknown): NormalizedOption | null {
  if (isPrimitiveSelectValue(raw)) {
    return {
      label: String(raw),
      value: raw,
      disabled: false,
    };
  }

  if (!raw || typeof raw !== "object") return null;

  const option = raw as Record<string, unknown>;
  const rawLabel = option[props.optionLabel];
  const rawValue = option[props.optionValue];
  if (!isPrimitiveSelectValue(rawValue)) return null;

  return {
    label:
      rawLabel === undefined || rawLabel === null
        ? String(rawValue)
        : String(rawLabel),
    value: rawValue,
    disabled: Boolean(option[props.optionDisabled]),
  };
}

const normalizedOptions = computed<NormalizedOption[]>(() => {
  if (!props.options?.length) return [];
  return props.options
    .map((raw) => normalizeOption(raw))
    .filter((opt): opt is NormalizedOption => opt !== null);
});

const searchTerm = ref("");
const popoverOpen = ref(false);

const filteredOptions = computed(() => {
  if (!props.searchable) return normalizedOptions.value;
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) return normalizedOptions.value;
  return normalizedOptions.value.filter((opt) =>
    opt.label.toLowerCase().includes(term),
  );
});

const listboxModeEnabled = computed(
  () =>
    !!props.options?.length &&
    !slots.default &&
    (props.multiple ||
      props.searchable ||
      props.optionLabel !== DEFAULT_OPTION_LABEL ||
      props.optionValue !== DEFAULT_OPTION_VALUE ||
      props.optionDisabled !== DEFAULT_OPTION_DISABLED),
);

const selectedValues = computed<SelectPrimitiveValue[]>(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue;
  if (props.modelValue === undefined) return [];
  return [props.modelValue];
});

const hasSelection = computed(() => selectedValues.value.length > 0);

const selectedLabels = computed(() => {
  return selectedValues.value
    .map((selectedValue) => {
      const option = normalizedOptions.value.find(
        (opt) => opt.value === selectedValue,
      );
      return option?.label ?? String(selectedValue);
    })
    .filter(Boolean);
});

const triggerDisplayLabel = computed(() => {
  if (!hasSelection.value) return "";
  if (props.multiple) return selectedLabels.value.join(", ");
  return selectedLabels.value[0] ?? "";
});

// ── Validation ─────────────────────────────────────────────────────────────
const ruleError = ref<string | null>(null);

function runRules(val: SelectModelValue): void {
  if (!props.rules?.length) return;
  for (const rule of props.rules) {
    const result = rule(val);
    if (result !== true) {
      ruleError.value = result;
      return;
    }
  }
  ruleError.value = null;
}

// ── Error state ────────────────────────────────────────────────────────────
const effectiveError = computed(
  () =>
    props.errorMessage || (props.error ? " " : null) || ruleError.value || null,
);
const hasError = computed(() => !!effectiveError.value);

const stringValue = computed(() =>
  !Array.isArray(props.modelValue) && props.modelValue !== undefined
    ? String(props.modelValue)
    : undefined,
);

function handleUpdate(value: string) {
  // Recover the original type: prefer props.options, then the slot-item registry
  const opt = normalizedOptions.value.find((o) => String(o.value) === value);
  let resolved: SelectPrimitiveValue;
  if (opt !== undefined) {
    resolved = opt.value;
  } else if (valueMap.has(value)) {
    resolved = valueMap.get(value)!;
  } else {
    resolved = value;
  }
  runRules(resolved);
  emit("update:modelValue", resolved);
}

function resolveListboxValue(value: unknown): SelectModelValue {
  if (props.multiple) {
    if (!Array.isArray(value)) {
      return value === undefined || value === null ? [] : [String(value)];
    }
    return value.map((item) => {
      const key = String(item);
      return valueMap.get(key) ?? key;
    });
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (first === undefined || first === null) return undefined;
    const key = String(first);
    return valueMap.get(key) ?? key;
  }

  if (value === undefined || value === null) return undefined;
  const key = String(value);
  return valueMap.get(key) ?? key;
}

function handleListboxUpdate(value: unknown) {
  const resolved = resolveListboxValue(value);
  runRules(resolved);
  emit("update:modelValue", resolved);

  if (!props.multiple) {
    popoverOpen.value = false;
  }
}

const listboxStringModelValue = computed<string | string[]>(() => {
  const resolved = props.multiple
    ? selectedValues.value.map((value) => String(value))
    : selectedValues.value[0] !== undefined
      ? String(selectedValues.value[0])
      : "";
  return resolved;
});

function handleClear() {
  const clearedValue: SelectModelValue = props.multiple ? [] : undefined;
  runRules(clearedValue);
  emit("update:modelValue", clearedValue);
  emit("clear");
}

const heightClasses: Record<NonNullable<SelectProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-sm",
  md: "tw:h-10 tw:text-sm",
};

const fieldWidthClass = computed(() => {
  switch (props.width) {
    case "xs":
      return "tw:w-[var(--spacing-field-width-xs)]";
    case "sm":
      return "tw:w-[var(--spacing-field-width-sm)]";
    case "md":
      return "tw:w-[var(--spacing-field-width-md)]";
    case "lg":
      return "tw:w-[var(--spacing-field-width-lg)]";
    default:
      return "tw:w-full";
  }
});
</script>

<template>
  <div :class="['tw:flex tw:flex-col tw:gap-1', fieldWidthClass]">
    <!-- Label -->
    <label
      v-if="label"
      :for="id"
      class="tw:text-xs tw:font-medium tw:text-select-label tw:leading-none"
    >
      {{ label }}
    </label>

    <template v-if="listboxModeEnabled">
      <PopoverRoot v-model:open="popoverOpen">
        <div class="tw:relative tw:flex tw:items-center">
          <PopoverTrigger as-child>
            <button
              type="button"
              :id="id"
              :name="name"
              :disabled="disabled"
              :class="[
                'tw:flex tw:items-center tw:w-full tw:rounded-md tw:border tw:ps-3',
                'tw:bg-select-bg',
                hasError
                  ? 'tw:border-select-border-error'
                  : 'tw:border-select-border tw:hover:border-select-border-hover',
                'tw:focus:outline-none tw:focus:border-select-border-focus',
                'tw:focus:ring-2 tw:focus:ring-select-focus-ring',
                'tw:transition-colors tw:duration-150',
                'tw:disabled:bg-select-disabled-bg tw:disabled:opacity-60 tw:disabled:cursor-not-allowed',
                clearable && hasSelection ? 'tw:pe-7' : 'tw:pe-8',
                heightClasses[size ?? 'md'],
              ]"
            >
              <slot name="trigger" :value="modelValue">
                <span
                  :class="[
                    'tw:flex-1 tw:text-start tw:truncate',
                    hasSelection
                      ? 'tw:text-select-text'
                      : 'tw:text-select-placeholder',
                  ]"
                >
                  {{ hasSelection ? triggerDisplayLabel : placeholder }}
                </span>
              </slot>

              <span
                aria-hidden="true"
                class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:pe-2 tw:text-select-icon"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  class="tw:size-4"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
            </button>
          </PopoverTrigger>

          <button
            v-if="clearable && hasSelection"
            type="button"
            tabindex="-1"
            aria-label="Clear selection"
            :class="[
              'tw:absolute tw:end-7 tw:flex tw:items-center tw:justify-center',
              'tw:text-input-clear-btn tw:hover:text-input-clear-btn-hover',
              'tw:transition-colors tw:size-4',
            ]"
            @click.stop="handleClear"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-3.5"
              aria-hidden="true"
            >
              <path
                d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </div>

        <PopoverPortal>
          <PopoverContent
            :side-offset="4"
            align="start"
            :class="[
              'tw:z-50 tw:min-w-(--reka-popover-trigger-width)',
              'tw:max-h-72 tw:overflow-hidden',
              'tw:rounded-md tw:border tw:shadow-md',
              'tw:bg-select-content-bg tw:border-select-content-border',
              'tw:p-1',
            ]"
          >
            <ListboxRoot
              :model-value="listboxStringModelValue"
              :multiple="multiple"
              :disabled="disabled"
              @update:model-value="handleListboxUpdate"
            >
              <ListboxFilter
                v-if="searchable"
                v-model="searchTerm"
                class="tw:w-full tw:h-9 tw:px-3 tw:mb-1 tw:rounded-md tw:border tw:bg-input-bg tw:border-input-border tw:text-input-text tw:placeholder:text-input-placeholder tw:outline-none tw:focus:ring-2 tw:focus:ring-input-focus-ring"
                :placeholder="searchPlaceholder"
              />

              <div class="tw:max-h-60 tw:overflow-auto">
                <div
                  v-if="filteredOptions.length === 0"
                  class="tw:px-3 tw:py-2 tw:text-sm tw:text-select-placeholder"
                >
                  {{ emptyText }}
                </div>

                <ListboxItem
                  v-for="opt in filteredOptions"
                  v-else
                  :key="String(opt.value)"
                  :value="String(opt.value)"
                  :disabled="opt.disabled"
                  :class="[
                    'tw:relative tw:flex tw:items-center tw:w-full',
                    'tw:ps-8 tw:pe-3 tw:py-1.5 tw:text-sm',
                    'tw:text-select-item-text tw:rounded-sm',
                    'tw:cursor-pointer tw:select-none tw:outline-none',
                    'tw:transition-colors tw:duration-100',
                    'tw:data-highlighted:bg-select-item-hover-bg',
                    'tw:data-[state=checked]:bg-select-item-selected-bg tw:data-[state=checked]:text-select-item-selected-text',
                    'tw:data-disabled:text-select-item-disabled tw:data-disabled:cursor-not-allowed tw:data-disabled:pointer-events-none',
                  ]"
                >
                  <ListboxItemIndicator
                    class="tw:absolute tw:start-2 tw:flex tw:items-center tw:justify-center"
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
                  </ListboxItemIndicator>
                  <span class="tw:truncate">{{ opt.label }}</span>
                </ListboxItem>
              </div>
            </ListboxRoot>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </template>

    <SelectRoot
      v-else
      :model-value="stringValue"
      :disabled="disabled"
      :name="name"
      @update:model-value="handleUpdate"
    >
      <div class="tw:relative tw:flex tw:items-center">
        <SelectTrigger
          :id="id"
          :class="[
            'tw:flex tw:items-center tw:w-full tw:rounded-md tw:border tw:ps-3',
            'tw:bg-select-bg',
            hasError
              ? 'tw:border-select-border-error'
              : 'tw:border-select-border tw:hover:border-select-border-hover',
            'tw:focus:outline-none tw:focus:border-select-border-focus',
            'tw:focus:ring-2 tw:focus:ring-select-focus-ring',
            'tw:transition-colors tw:duration-150',
            'tw:data-disabled:bg-select-disabled-bg tw:data-disabled:opacity-60 tw:data-disabled:cursor-not-allowed',
            clearable && hasSelection ? 'tw:pe-7' : 'tw:pe-8',
            heightClasses[size ?? 'md'],
          ]"
        >
          <SelectValue
            :placeholder="placeholder"
            :class="[
              'tw:flex-1 tw:text-start tw:truncate',
              hasSelection
                ? 'tw:text-select-text'
                : 'tw:text-select-placeholder',
            ]"
          >
            <slot name="trigger" :value="modelValue" />
          </SelectValue>

          <span
            aria-hidden="true"
            class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:pe-2 tw:text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-4"
            >
              <path
                fill-rule="evenodd"
                d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </SelectTrigger>

        <button
          v-if="clearable && hasSelection"
          type="button"
          tabindex="-1"
          aria-label="Clear selection"
          :class="[
            'tw:absolute tw:end-7 tw:flex tw:items-center tw:justify-center',
            'tw:text-input-clear-btn tw:hover:text-input-clear-btn-hover',
            'tw:transition-colors tw:size-4',
          ]"
          @click.stop="handleClear"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-3.5"
            aria-hidden="true"
          >
            <path
              d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
            />
          </svg>
        </button>
      </div>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :class="[
            'tw:z-50 tw:min-w-(--reka-select-trigger-width)',
            'tw:max-h-60 tw:overflow-hidden',
            'tw:rounded-md tw:border tw:shadow-md',
            'tw:bg-select-content-bg tw:border-select-content-border',
            'tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out',
            'tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0',
            'tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95',
            'tw:data-[side=bottom]:slide-in-from-top-2',
            'tw:data-[side=top]:slide-in-from-bottom-2',
          ]"
        >
          <SelectScrollUpButton
            class="tw:flex tw:items-center tw:justify-center tw:h-6 tw:text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollUpButton>

          <SelectViewport class="tw:p-1">
            <template v-if="normalizedOptions.length && !slots.default">
              <OSelectItem
                v-for="opt in normalizedOptions"
                :key="String(opt.value)"
                :value="opt.value"
                :label="opt.label"
                :disabled="opt.disabled"
              />
            </template>

            <slot />
          </SelectViewport>

          <SelectScrollDownButton
            class="tw:flex tw:items-center tw:justify-center tw:h-6 tw:text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <!-- Error message -->
    <span
      v-if="effectiveError && effectiveError.trim()"
      class="tw:text-xs tw:text-select-error-text tw:leading-none"
      role="alert"
    >
      {{ effectiveError }}
    </span>
  </div>
</template>
