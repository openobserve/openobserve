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
import {
  computed,
  nextTick,
  ref,
  useAttrs,
  useId,
  useSlots,
  watch,
} from "vue";
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
  labelPosition: "outside",
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

// Container ref — used only by the imperative `clear()` method to reach the
// native <input> rendered by reka-ui's ComboboxInput.
const rootEl = ref<HTMLElement | null>(null);

// ── Filtered options ────────────────────────────────────────────────────────
// Apply optional regex-based needle extraction (same logic as CommonAutoComplete).
const filteredOptions = computed<ComboboxOption[]>(() => {
  const val = internalValue.value;
  if (!val) return props.items ?? [];

  let needle = val;

  if (props.searchRegex) {
    const regex = new RegExp(props.searchRegex, "gi");
    const match = regex.exec(val);
    if (!match) return props.items ?? [];
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

// ── Imperative reset ────────────────────────────────────────────────────────
// Opt-in API for consumers that need to deterministically clear the combobox
// in the same tick as a commit (e.g. CrossLinkDialog adds the picked value as
// a chip and immediately resets the input). The v-model write alone is
// insufficient because Vue's pre-flush watcher dedupes synchronous
// "" → "X" → "" round-trips, AND reka-ui's ComboboxInput keeps a separate
// internal search-term state that can survive the v-model reset.
//
// Behaviour parity with reka-ui's defaults is preserved for every other
// consumer — they continue to receive the standard select-shows-value flow
// because they never call this method.
async function clear() {
  internalValue.value = "";
  emit("update:modelValue", "");
  // Two ticks: let our reactive update flush, then let reka-ui's internal
  // writes (filterSearch reset, etc.) settle before we touch the DOM.
  await nextTick();
  await nextTick();
  const el = rootEl.value?.querySelector("input") ?? null;
  if (el && el.value !== "") {
    el.value = "";
    // Synthetic input event so reka-ui's internal filterSearch also resets.
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

defineExpose({ clear });

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
  // Cancel any pending debounce so the typed value doesn't overwrite the selection
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  internalValue.value = replaced;
  emit("update:modelValue", replaced);
  emit("select", replaced);
}

// ── Sizes ────────────────────────────────────────────────────────────────────
const heightClass = computed(() => {
  if (props.labelPosition === "inside" && (props.label || slots.label)) {
    return props.size === "sm" ? "tw:h-10 tw:text-sm tw:pt-4" : "tw:h-10 tw:text-sm tw:pt-4";
  }
  return props.size === "sm" ? "tw:h-8 tw:text-sm" : "tw:h-8 tw:text-sm";
});

// ── Error ────────────────────────────────────────────────────────────────────
const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined,
);
const hasInsideLabel = computed(
  () => props.labelPosition === "inside" && (Boolean(slots.label) || Boolean(props.label)),
);
</script>

<template>
  <div
    ref="rootEl"
    v-bind="$attrs"
    class="tw:flex tw:flex-col tw:gap-1 tw:w-full"
    :data-test="parentDataTest"
  >
    <!-- Label (outside) -->
    <label
      v-if="(hasLabel || $slots.tooltip) && labelPosition !== 'inside'"
      :for="inputId"
      :class="[
        'o-input-label tw:text-sm tw:font-semibold tw:leading-tight tw:flex tw:items-center tw:gap-1',
        disabled && 'o-input-label--disabled',
      ]"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="tw:select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help"
      ><slot name="tooltip" /></OIcon>
    </label>

    <ComboboxRoot
      :model-value="internalValue"
      :ignore-filter="true"
      :open-on-click="true"
      :open-on-focus="true"
      :disabled="disabled"
      @update:model-value="onSelect"
    >
      <ComboboxAnchor class="tw:relative tw:flex tw:items-center tw:w-full">
        <!-- Inside label -->
        <span
          v-if="hasInsideLabel"
          class="tw:absolute tw:top-1 tw:start-3 tw:text-[10px] tw:leading-none tw:text-input-placeholder tw:select-none tw:pointer-events-none tw:z-10"
        >
          <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true">&nbsp;*</span>
        </span>
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
            'tw:z-10001 tw:min-w-(--reka-combobox-trigger-width) tw:max-w-(--reka-combobox-trigger-width) tw:w-(--reka-combobox-trigger-width)',
            'tw:max-h-60 tw:overflow-hidden',
            'tw:rounded-md tw:border tw:shadow-lg',
            'tw:bg-select-content-bg tw:border-select-content-border',
            'tw:p-1',
            // Clip-path reveal: unveiled at full size from its trigger edge (no
            // scale/squish). Wipes down by default; top-placed wipes up. Soft
            // ease-out-expo in (200ms), quick wipe out (140ms).
            'tw:data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'tw:data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
            'tw:data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'tw:data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
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
              :data-test-value="option.value"
              :data-test-label="option.label"
              :class="[
                'tw:relative tw:flex tw:items-start tw:gap-2 tw:w-full',
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
              <span class="tw:flex-1 tw:wrap-break-word tw:whitespace-normal tw:min-w-0">{{ option.label }}</span>
              <ComboboxItemIndicator
                class="tw:absolute tw:end-2 tw:top-1/2 tw:-translate-y-1/2 tw:flex tw:items-center tw:justify-center tw:size-3.5"
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
