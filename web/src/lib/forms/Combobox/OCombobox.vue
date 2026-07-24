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
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      emit("update:modelValue", val);
    }, props.debounce);
  } else {
    emit("update:modelValue", val);
  }
}

function handleBlur() {
  // Flush any pending debounced emit immediately on blur so that tabbing away —
  // or clicking Save right after typing — does not lose the typed value. Mirrors
  // OInput.handleBlur; without this a debounced combobox silently drops the last
  // typed value when focus leaves before the debounce fires.
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    emit("update:modelValue", internalValue.value);
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
    return props.size === "sm" ? "h-10 text-sm pt-4" : "h-10 text-sm pt-4";
  }
  return props.size === "sm" ? "h-8 text-sm" : "h-8 text-sm";
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
    v-bind="wrapperAttrs"
    class="flex flex-col gap-1 w-full"
    :data-test="parentDataTest"
  >
    <!-- Label (outside) -->
    <label
      v-if="(hasLabel || $slots.tooltip) && labelPosition !== 'inside'"
      :for="inputId"
      :class="[
        'o-input-label text-compact leading-tight flex items-center gap-1',
        disabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text',
      ]"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
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
      <ComboboxAnchor class="relative flex items-center w-full">
        <!-- Inside label -->
        <span
          v-if="hasInsideLabel"
          class="absolute top-1 start-3 text-3xs leading-none text-input-placeholder select-none pointer-events-none z-10"
        >
          <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true">&nbsp;*</span>
        </span>
        <ComboboxInput
          :id="inputId"
          :name="name"
          :placeholder="placeholder"
          :disabled="disabled"
          :tabindex="inputTabindex"
          auto-complete="off"
          :class="[
            'w-full rounded-default border ps-3 pe-3',
            'bg-input-bg text-input-text',
            'placeholder:text-input-placeholder',
            'outline-none transition-[border-color,box-shadow] duration-150',
            hasError
              ? 'border-input-border-error'
              : 'border-input-border hover:border-input-border-hover',
            'focus:border-input-border-focus focus:ring-2 focus:ring-input-focus-ring',
            'disabled:bg-input-disabled-bg disabled:cursor-not-allowed disabled:text-input-disabled-text',
            heightClass,
          ]"
          :data-test="parentDataTest ? `${parentDataTest}-input` : undefined"
          @update:model-value="onInputChange"
          @blur="handleBlur"
        />
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="4"
          :class="[
            'z-10001 min-w-(--reka-combobox-trigger-width) max-w-(--reka-combobox-trigger-width) w-(--reka-combobox-trigger-width)',
            'max-h-60 overflow-hidden',
            'rounded-default border shadow-lg',
            'bg-select-content-bg border-select-content-border',
            'p-1',
            // Clip-path reveal: unveiled at full size from its trigger edge (no
            // scale/squish). Wipes down by default; top-placed wipes up. Soft
            // ease-out-expo in (200ms), quick wipe out (140ms).
            'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
            'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
          ]"
        >
          <ComboboxViewport class="max-h-56 overflow-y-auto">
            <ComboboxEmpty
              class="py-2 px-3 text-sm text-select-placeholder text-center"
            >
              {{ t('components.combobox.noOptionsFound') }}
            </ComboboxEmpty>

            <ComboboxItem
              v-for="option in filteredOptions"
              :key="option.value"
              :value="option.value"
              :data-test-value="option.value"
              :data-test-label="option.label"
              :class="[
                'relative flex items-start gap-2 w-full',
                'ps-3 pe-8 py-1.5 text-sm',
                'text-select-item-text rounded-default',
                'cursor-pointer select-none outline-none',
                'transition-colors duration-100',
                'data-highlighted:bg-select-item-hover-bg',
                'data-[state=checked]:bg-select-item-selected-bg data-[state=checked]:text-select-item-selected-text',
                'data-disabled:text-select-item-disabled data-disabled:cursor-not-allowed',
              ]"
              :data-test="parentDataTest ? `${parentDataTest}-option` : undefined"
            >
              <span class="flex-1 wrap-break-word whitespace-normal min-w-0">{{ option.label }}</span>
              <ComboboxItemIndicator
                class="absolute end-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-3.5"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  class="size-3.5"
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
      class="text-xs text-input-error-text leading-none"
      role="alert"
    >
      {{ effectiveError }}
    </span>
    <!-- Help text -->
    <span
      v-else-if="helpText"
      class="text-xs text-input-help-text leading-none"
    >
      {{ helpText }}
    </span>
  </div>
</template>
