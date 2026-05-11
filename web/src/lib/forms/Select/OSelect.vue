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
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  useSlots,
  watch,
  watchEffect,
} from "vue";

type NormalizedOption = {
  label: string;
  value: SelectPrimitiveValue;
  disabled: boolean;
  header: boolean;
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
  searchDebounce: 0,
  hideSelected: false,
  creatable: false,
  searchPlaceholder: "Search...",
  labelKey: DEFAULT_OPTION_LABEL,
  valueKey: DEFAULT_OPTION_VALUE,
  // Intentionally no default — when undefined, the chip count is computed
  // from the live trigger width. Pass a number to force a fixed cap.
});

const emit = defineEmits<SelectEmits>();
const slots = useSlots();

defineSlots<SelectSlots>();

// Dev-time warning: slot-based options with multiple/searchable require listbox
// mode, but listboxModeEnabled requires options prop. Guide the developer early.
if (import.meta.env.DEV) {
  watchEffect(() => {
    if (slots.default && (props.multiple || props.searchable)) {
      console.warn(
        "[OSelect] Slot-based options (OSelectItem/OSelectGroup) do not support " +
          "`multiple`, `searchable`, or `useInput`. Pass options via the `options` prop instead.",
      );
    }
  });
}

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
      header: false,
    };
  }

  if (!raw || typeof raw !== "object") return null;

  const option = raw as Record<string, unknown>;
  const rawLabel = option[props.labelKey];

  // Group header: items with header:true or isTab:true are non-selectable labels
  const isHeader = Boolean(option["header"]) || Boolean(option["isTab"]);
  if (isHeader) {
    return {
      label:
        rawLabel === undefined || rawLabel === null ? "" : String(rawLabel),
      value: `__header__${String(rawLabel)}`,
      disabled: true,
      header: true,
    };
  }

  const rawValue = option[props.valueKey];
  if (!isPrimitiveSelectValue(rawValue)) return null;

  return {
    label:
      rawLabel === undefined || rawLabel === null
        ? String(rawValue)
        : String(rawLabel),
    value: rawValue,
    disabled: Boolean(option[DEFAULT_OPTION_DISABLED]),
    header: false,
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
const filterDebounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const inputEnabled = computed(() => props.searchable);

const filteredOptions = computed(() => {
  if (!inputEnabled.value) return normalizedOptions.value;
  const term = searchTerm.value.trim().toLowerCase();
  let options = normalizedOptions.value;

  if (props.hideSelected && props.multiple && selectedValues.value.length > 0) {
    options = options.filter(
      (opt) => opt.header || !selectedValues.value.includes(opt.value),
    );
    // Drop headers that no longer have any following non-header items
    options = options.filter((opt, i) => {
      if (!opt.header) return true;
      const next = options[i + 1];
      return next !== undefined && !next.header;
    });
  }

  if (!term) return options;
  // Keep headers visible if any of their following non-header items match
  const result: NormalizedOption[] = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt.header) {
      // Include the header only if at least one subsequent non-header item matches
      let j = i + 1;
      while (j < options.length && !options[j].header) {
        if (options[j].label.toLowerCase().includes(term)) {
          result.push(opt);
          break;
        }
        j++;
      }
    } else {
      if (opt.label.toLowerCase().includes(term)) {
        result.push(opt);
      }
    }
  }
  return result;
});

const listboxModeEnabled = computed(
  () =>
    !slots.default &&
    (props.multiple ||
      props.searchable ||
      props.creatable ||
      (!!props.options?.length &&
        (props.labelKey !== DEFAULT_OPTION_LABEL ||
          props.valueKey !== DEFAULT_OPTION_VALUE))),
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

watch(searchTerm, (value) => {
  if (!inputEnabled.value) return;
  if ((props.searchDebounce ?? 0) > 0) {
    if (filterDebounceTimer.value) clearTimeout(filterDebounceTimer.value);
    filterDebounceTimer.value = setTimeout(
      () => emit("search", value),
      props.searchDebounce,
    );
    return;
  }
  emit("search", value);
});

// ── Error state ────────────────────────────────────────────────────────────
const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
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
  emit("update:modelValue", clearedValue);
  emit("clear");
  searchTerm.value = "";
}

function handleCreateFromInput() {
  if (!props.creatable) return;
  const term = searchTerm.value.trim();
  if (!term) return;

  const hasExisting = normalizedOptions.value.some(
    (opt) => opt.label === term || String(opt.value) === term,
  );
  if (hasExisting) return;

  emit("create", term);
}

onBeforeUnmount(() => {
  if (filterDebounceTimer.value) clearTimeout(filterDebounceTimer.value);
});

// ── Virtual scroll (listbox mode) ─────────────────────────────────────────
// Items are virtualised whenever the listbox has more than 50 entries, keeping
// DOM nodes minimal even for 20 000+ option datasets.
const listboxScrollEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: filteredOptions.value.length,
    getScrollElement: () => listboxScrollEl.value,
    estimateSize: () => 36,
    overscan: 8,
  })),
);

// md was h-10 (40px); reduced to h-9 (36px) so the trigger matches the
// compact OInput density and the in-dropdown search filter.
const heightClasses: Record<NonNullable<SelectProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-sm",
  md: "tw:h-9 tw:text-sm",
};

// Open-state tracking. Reka's PopoverTrigger / SelectTrigger expose
// `data-state="open"`, but Vue can't reach across components with a
// CSS group selector without extra wiring — track a ref instead and
// bind the chevron's rotation class to it.
const selectOpen = ref(false);

const isOpen = computed(() =>
  listboxModeEnabled.value ? popoverOpen.value : selectOpen.value,
);

// ── Chip overflow (width-aware) ──────────────────────────────────────────
// In multi-select mode, fit as many chips as the trigger width allows; the
// rest collapse into a "+N more" indicator. When `maxVisibleChips` is set,
// that becomes a hard upper bound; otherwise the count is computed live
// from the trigger's measured width via ResizeObserver.

/** The outer wrapper around the trigger. Measured to size the chip row. */
const triggerWrapperRef = ref<HTMLElement | null>(null);
const triggerWidth = ref(0);
let triggerResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!triggerWrapperRef.value) return;
  triggerWidth.value = triggerWrapperRef.value.clientWidth;
  triggerResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      triggerWidth.value = entry.contentRect.width;
    }
  });
  triggerResizeObserver.observe(triggerWrapperRef.value);
});

onBeforeUnmount(() => {
  triggerResizeObserver?.disconnect();
  triggerResizeObserver = null;
});

/**
 * Estimate a chip's rendered width in pixels from its label.
 * Chip styling: `tw:px-2 tw:py-0.5 tw:text-xs` (12px font), max-w-40 = 160px.
 * Roughly 6.5px per character at 12px font + 16px horizontal padding.
 */
function estimateChipWidth(label: string): number {
  const labelW = Math.min(Math.ceil(label.length * 6.5), 144); // cap to 160-16 padding
  return labelW + 16; // px-2 each side
}

// Space reserved inside the trigger for non-chip content: left ps-3 padding,
// trailing chevron icon, optional clear button. Approximated; the
// ResizeObserver makes minor mis-estimates self-correct on the next layout.
const reservedTriggerSpace = computed(() => {
  let reserved = 12 + 32; // ps-3 (12px) + chevron + its padding (~32px)
  if (props.clearable && hasSelection.value) reserved += 32; // clear btn + gap
  return reserved;
});

const overflowChipEstimatedWidth = 70; // "+N more" pill width approximation
const chipGap = 4; // tw:gap-1 between chips

/**
 * Number of chips that actually fit in the current trigger width. If
 * `maxVisibleChips` is set on the prop, it caps the result. Always returns
 * at least 1 so the user can see something is selected.
 */
const dynamicMaxChips = computed(() => {
  const total = selectedLabels.value.length;
  if (total === 0) return 0;

  // No measurement yet (SSR / pre-mount) — fall back to the prop or a safe
  // default so we don't render nothing.
  if (triggerWidth.value === 0) {
    return Math.min(props.maxVisibleChips ?? 3, total);
  }

  const available = Math.max(0, triggerWidth.value - reservedTriggerSpace.value);
  let used = 0;
  let count = 0;

  for (let i = 0; i < total; i++) {
    const chipW = estimateChipWidth(selectedLabels.value[i]);
    const remaining = total - i - 1;
    // If there'll be hidden chips after this one, reserve space for the
    // "+N more" pill so it can still fit on the row.
    const overflowReserve =
      remaining > 0 ? overflowChipEstimatedWidth + chipGap : 0;
    const needed = chipW + (i > 0 ? chipGap : 0) + overflowReserve;
    if (used + needed > available) break;
    used += chipW + (i > 0 ? chipGap : 0);
    count++;
  }

  const fit = Math.max(1, count);
  // Honour an explicit cap when provided.
  if (props.maxVisibleChips !== undefined) {
    return Math.min(fit, props.maxVisibleChips);
  }
  return fit;
});

const visibleSelectedLabels = computed(() =>
  selectedLabels.value.slice(0, dynamicMaxChips.value),
);
const overflowSelectedCount = computed(() =>
  Math.max(0, selectedLabels.value.length - dynamicMaxChips.value),
);

// Trigger right-padding: leave more space when the clear button is visible,
// so the arrow + clear no longer overlap (was `pe-7` which sat directly on
// the arrow icon).
const triggerEndPadding = computed(() =>
  props.clearable && hasSelection.value ? "tw:pe-14" : "tw:pe-9",
);

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
      <PopoverRoot
        v-model:open="popoverOpen"
        @update:open="(v) => emit(v ? 'open' : 'close')"
      >
        <div
          ref="triggerWrapperRef"
          class="tw:relative tw:flex tw:items-center"
        >
          <PopoverTrigger
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
              triggerEndPadding,
              heightClasses[size ?? 'md'],
            ]"
          >
            <slot name="trigger" :value="modelValue">
              <template v-if="multiple && selectedLabels.length > 0">
                <div
                  class="tw:flex-1 tw:flex tw:flex-nowrap tw:items-center tw:gap-1 tw:overflow-hidden tw:pe-2"
                >
                  <slot
                    v-for="(labelText, idx) in visibleSelectedLabels"
                    name="chip"
                    :label="labelText"
                    :value="selectedValues[idx]"
                  >
                    <span
                      :key="labelText"
                      class="tw:inline-flex tw:items-center tw:rounded tw:px-2 tw:py-0.5 tw:text-xs tw:bg-select-item-selected-bg tw:text-select-item-selected-text tw:max-w-40 tw:truncate tw:shrink-0"
                    >
                      {{ labelText }}
                    </span>
                  </slot>
                  <span
                    v-if="overflowSelectedCount > 0"
                    class="tw:inline-flex tw:items-center tw:rounded tw:px-2 tw:py-0.5 tw:text-xs tw:bg-select-item-hover-bg tw:text-select-text tw:shrink-0"
                    data-test="o-select-overflow-chip"
                  >
                    +{{ overflowSelectedCount }} more
                  </span>
                </div>
              </template>
              <span
                v-else
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
              :class="[
                'tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:pe-2 tw:text-select-icon',
                'tw:transition-transform tw:duration-150',
                isOpen ? 'tw:rotate-180' : '',
              ]"
            >
              <!-- chevron-down — rotates 180° when the popover is open -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="tw:size-4"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </PopoverTrigger>

          <button
            v-if="clearable && hasSelection"
            type="button"
            tabindex="-1"
            aria-label="Clear selection"
            :class="[
              'tw:absolute tw:end-8 tw:flex tw:items-center tw:justify-center',
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
            :trap-focus="false"
            :disable-outside-pointer-events="false"
            :class="[
              'tw:z-[10001] tw:min-w-(--reka-popover-trigger-width)',
              'tw:max-h-72 tw:overflow-hidden',
              'tw:rounded-md tw:border tw:shadow-md',
              'tw:bg-select-content-bg tw:border-select-content-border',
              'tw:p-1',
            ]"
            :style="dropdownStyle"
          >
            <ListboxRoot
              :model-value="listboxStringModelValue"
              :multiple="multiple"
              :disabled="disabled"
              @update:model-value="handleListboxUpdate"
            >
              <ListboxFilter
                v-if="inputEnabled"
                v-model="searchTerm"
                auto-focus
                :class="[
                  'tw:w-full tw:px-3 tw:mb-1 tw:rounded-md tw:border',
                  'tw:bg-input-bg tw:border-input-border tw:text-input-text',
                  'tw:placeholder:text-input-placeholder tw:outline-none',
                  'tw:focus:ring-2 tw:focus:ring-input-focus-ring',
                  heightClasses[size ?? 'md'],
                ]"
                :placeholder="searchPlaceholder"
                @keydown.enter="handleCreateFromInput"
              />
              <!-- Virtual scroll container -->
              <div ref="listboxScrollEl" class="tw:max-h-60 tw:overflow-auto">
                <div
                  v-if="filteredOptions.length === 0"
                  class="tw:px-3 tw:py-2 tw:text-sm tw:text-select-placeholder"
                >
                  <slot name="empty">No options found</slot>
                </div>

                <!-- Virtualised list — spacer div with absolutely positioned rows -->
                <div
                  v-if="filteredOptions.length > 0"
                  :style="{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: 'relative',
                  }"
                >
                  <div
                    v-for="vRow in virtualizer.getVirtualItems()"
                    :key="vRow.key"
                    :style="{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }"
                  >
                    <!-- Group header — non-interactive label. Virtualisation
                         renders each row as a sibling, so a real ListboxGroup
                         can't wrap its items. Render a plain styled header
                         instead of misusing ListboxGroup/Label ARIA roles. -->
                    <div
                      v-if="filteredOptions[vRow.index].header"
                      :class="[
                        'tw:flex tw:w-full tw:h-full tw:px-3 tw:py-1 tw:text-xs tw:font-semibold',
                        'tw:text-select-placeholder tw:bg-select-content-bg tw:uppercase tw:tracking-wide',
                        'tw:select-none tw:pointer-events-none',
                      ]"
                    >
                      {{ filteredOptions[vRow.index].label }}
                    </div>

                    <!-- Regular item -->
                    <ListboxItem
                      v-else
                      :value="String(filteredOptions[vRow.index].value)"
                      :disabled="filteredOptions[vRow.index].disabled"
                      :class="[
                        'tw:relative tw:flex tw:items-center tw:w-full tw:h-full tw:gap-2',
                        'tw:ps-3 tw:pe-3 tw:text-sm',
                        'tw:text-select-item-text tw:rounded-sm',
                        'tw:cursor-pointer tw:select-none tw:outline-none',
                        'tw:transition-colors tw:duration-100',
                        'tw:data-highlighted:bg-select-item-hover-bg',
                        multiple
                          ? ''
                          : 'tw:data-[state=checked]:bg-select-item-selected-bg tw:data-[state=checked]:text-select-item-selected-text',
                        'tw:data-disabled:text-select-item-disabled tw:data-disabled:cursor-not-allowed tw:data-disabled:pointer-events-none',
                      ]"
                    >
                      <!-- Multi-select: always-visible checkbox indicator -->
                      <template v-if="multiple">
                        <span
                          :class="[
                            'tw:flex tw:items-center tw:justify-center tw:shrink-0',
                            'tw:size-3.5 tw:rounded-sm tw:border tw:transition-colors',
                            selectedValues.includes(
                              filteredOptions[vRow.index].value,
                            )
                              ? 'tw:bg-checkbox-checked-bg tw:border-checkbox-checked-border'
                              : 'tw:bg-checkbox-bg tw:border-checkbox-border',
                          ]"
                          aria-hidden="true"
                        >
                          <svg
                            v-if="
                              selectedValues.includes(
                                filteredOptions[vRow.index].value,
                              )
                            "
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="tw:size-full tw:p-0.5 tw:text-checkbox-checked-fg"
                          >
                            <polyline points="2,6 5,9 10,3" />
                          </svg>
                        </span>
                      </template>

                      <!-- Single-select: checkmark indicator (shown only when checked) -->
                      <ListboxItemIndicator
                        v-else
                        class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:size-3.5"
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
                      <span class="tw:truncate">{{
                        filteredOptions[vRow.index].label
                      }}</span>
                    </ListboxItem>
                  </div>
                </div>
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
      @update:open="
        (v) => {
          selectOpen = v;
          emit(v ? 'open' : 'close');
        }
      "
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
            triggerEndPadding,
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
            :class="[
              'tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:pe-2 tw:text-select-icon',
              'tw:transition-transform tw:duration-150',
              isOpen ? 'tw:rotate-180' : '',
            ]"
          >
            <!-- chevron-down — rotates 180° when the dropdown is open -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-4"
            >
              <path
                fill-rule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
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
            'tw:absolute tw:end-8 tw:flex tw:items-center tw:justify-center',
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
            'tw:z-[10001] tw:min-w-(--reka-select-trigger-width)',
            'tw:max-h-60 tw:overflow-hidden',
            'tw:rounded-md tw:border tw:shadow-md',
            'tw:bg-select-content-bg tw:border-select-content-border',
            'tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out',
            'tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0',
            'tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95',
            'tw:data-[side=bottom]:slide-in-from-top-2',
            'tw:data-[side=top]:slide-in-from-bottom-2',
          ]"
          :style="dropdownStyle"
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
    <!-- Help text -->
    <span
      v-else-if="helpText"
      class="tw:text-xs tw:text-input-help-text tw:leading-none"
    >
      {{ helpText }}
    </span>
  </div>
</template>
