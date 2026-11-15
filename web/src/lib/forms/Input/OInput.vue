<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { InputProps, InputEmits, InputSlots, InputSize, FieldWidth } from "./OInput.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";
import { splitControlAttrs, warnIfUnlabelled } from "@/lib/forms/controlAttrs";
import { useI18nTyped } from "@/types/i18n";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from "vue";

const { t } = useI18nTyped();

// The consumer's data-test lands on the root; inner parts derive `<data-test>-field`, `-clear`, `-info` from it.
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Without a label the icon is aria-hidden and unreachable by assistive tech; the tooltip's own content never gets a name otherwise.
const tooltipIconLabel = computed(() =>
  props.label
    ? t("components.input.moreInfoAbout", { field: props.label })
    : t("components.input.moreInfo"),
);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const split = computed(() => splitControlAttrs($attrs, { forwardRole: true }));
const wrapperAttrs = computed(() => split.value.wrapperAttrs);
const controlAttrs = computed(() => split.value.controlAttrs);
onMounted(() =>
  warnIfUnlabelled(
    "OInput",
    Boolean(props.label || props.placeholder || $attrs["aria-label"] || $attrs["aria-labelledby"]),
    inputId.value,
  ),
);

const props = withDefaults(defineProps<InputProps>(), {
  type: "text",
  size: "md",
  width: "full",
  disabled: false,
  readonly: false,
  clearable: false,
  copyable: false,
  mono: false,
  autofocus: false,
});

const emit = defineEmits<InputEmits>();

defineSlots<InputSlots>();

const isDisabled = useLockedDisabled(() => props.disabled);

// useId() must run at setup top level: inside a computed each re-evaluation mints a new id and breaks <label for>.
const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | null>(null);
const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

function handleBlur(event: FocusEvent) {
  // Flush a pending debounced emit, or tabbing away right after typing loses the value.
  if (debounceTimer.value) {
    clearTimeout(debounceTimer.value);
    debounceTimer.value = null;
    emit("update:modelValue", normalizeByModifiers((event.target as HTMLInputElement).value));
  }
  emit("blur", event);
}

// A bound errorMessage alone must not surface the error, or every pre-filled message shows on mount.
const effectiveError = computed(() => {
  if (!props.error) return null;
  return props.errorMessage || " ";
});
const hasError = computed(() => !!effectiveError.value);

const errorId = computed(() => `${inputId.value}-error`);
const describedBy = computed(() => {
  const ids = String($attrs["aria-describedby"] ?? "")
    .split(/\s+/)
    .filter(Boolean);
  // An external error slot has no built-in message node to reference.
  if (effectiveError.value?.trim()) ids.push(errorId.value);
  return [...new Set(ids)].join(" ") || undefined;
});

// The toggle swaps the RENDERED type only, so a revealed field still reports itself as a password.
const revealed = ref(false);
const canReveal = computed(() => props.type === "password");
const effectiveType = computed(() => (canReveal.value && revealed.value ? "text" : props.type));
watch(canReveal, (allowed) => {
  if (!allowed) revealed.value = false;
});

const fieldWidthClass = computed(() => WIDTH_CLASSES[props.width ?? "full"]);

const hasValue = computed(
  () => props.modelValue !== "" && props.modelValue !== undefined && props.modelValue !== null,
);
const showClear = computed(() => props.clearable && hasValue.value && !isDisabled.value);
const showCopy = computed(() => props.copyable && hasValue.value);

const charCount = computed(() => {
  if (!props.maxlength) return 0;
  const val = props.modelValue;
  return val !== undefined && val !== null ? String(val).length : 0;
});

// Every mask is a digit-extracting formatter, so only use one on purely numeric content.
function applyMask(raw: string): string {
  if (!props.mask) return raw;

  const digits = raw.replace(/\D/g, "");

  if (props.mask === "time") {
    return [digits.slice(0, 2), digits.slice(2, 4)].filter(Boolean).join(":");
  }

  if (props.mask === "fulltime") {
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join(":");
  }

  if (props.mask === "DD-MM-YYYY") {
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("-");
  }

  return raw;
}

function normalizeByModifiers(value: string): string | number {
  let normalized = value;

  if (props.modelModifiers?.trim) {
    normalized = normalized.trim();
  }

  if (props.modelModifiers?.number) {
    if (normalized === "") return "";
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? normalized : parsed;
  }

  return normalized;
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  let val = target.value;

  if (props.mask) {
    val = applyMask(val);
    if (val !== target.value) {
      target.value = val;
    }
  }

  const emitValue = () => emit("update:modelValue", normalizeByModifiers(val));

  if ((props.debounce ?? 0) > 0) {
    if (debounceTimer.value) clearTimeout(debounceTimer.value);
    debounceTimer.value = setTimeout(emitValue, props.debounce);
    return;
  }

  emitValue();
}

function handleClear() {
  if (debounceTimer.value) clearTimeout(debounceTimer.value);
  emit("update:modelValue", "");
  emit("clear");
  inputRef.value?.focus();
}

onBeforeUnmount(() => {
  if (debounceTimer.value) clearTimeout(debounceTimer.value);
});

/** Focus the underlying input programmatically. */
function focus() {
  inputRef.value?.focus();
}

defineExpose({ focus });

const leadingPadding = computed(() => (props.icon || props.prefix ? "ps-2" : "ps-3"));
const trailingPadding = computed(() =>
  props.suffix || props.clearable || canReveal.value || props.copyable ? "pe-2" : "pe-3",
);

const wrapperClasses = computed(() => [
  "flex items-stretch w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "bg-input-bg",
  SIZE_CLASSES[props.size ?? "md"],
  // The accent edge carries the 3:1 focus indicator, so the halo outside it can stay soft.
  hasError.value
    ? "border-input-border-error focus-within:ring-3 focus-within:ring-control-error-halo"
    : "border-input-border hover:not-focus-within:border-input-border-hover focus-within:border-control-border-focus focus-within:ring-3 focus-within:ring-control-focus-halo",
  isDisabled.value
    ? "bg-input-disabled-bg border-input-disabled-border cursor-not-allowed border-dashed"
    : "",
  props.readonly ? "border-input-border bg-input-bg" : "",
]);
</script>

<script lang="ts">
const SIZE_CLASSES: Record<InputSize, string> = {
  xs: "h-control-xs text-xs",
  sm: "h-control-sm text-compact",
  md: "h-control-md text-compact",
  lg: "h-control-lg text-sm",
};
const WIDTH_CLASSES: Record<FieldWidth, string> = {
  s: "w-field-width-s",
  m: "w-field-width-m",
  l: "w-field-width-l",
  full: "w-full",
};
</script>

<template>
  <div v-bind="wrapperAttrs" :class="['flex flex-col gap-1', fieldWidthClass]">
    <label
      v-if="label || $slots.tooltip"
      :for="inputId"
      :class="[
        'o-input-label text-compact flex items-center gap-1 leading-tight',
        isDisabled
          ? 'text-input-label-text-disabled font-normal'
          : 'text-input-label-text font-medium',
      ]"
    >
      {{ label }}<span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :label="tooltipIconLabel"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
        ><slot name="tooltip"
      /></OIcon>
    </label>

    <div :class="wrapperClasses">
      <span
        v-if="icon || $slots.icon"
        class="text-input-addon-text flex shrink-0 items-center ps-2 select-none"
      >
        <slot name="icon"><OIcon v-if="icon" :name="icon" size="sm" /></slot>
      </span>

      <span
        v-if="prefix"
        class="text-input-addon-text flex shrink-0 items-center select-none"
        :class="icon || $slots.icon ? 'ps-1.5' : 'ps-3'"
      >
        {{ prefix }}
      </span>

      <input
        :id="inputId"
        ref="inputRef"
        :data-test="parentDataTest ? `${parentDataTest}-field` : undefined"
        :value="String(modelValue ?? '')"
        :type="effectiveType"
        :name="name"
        :placeholder="placeholder"
        :disabled="isDisabled"
        :readonly="readonly"
        :aria-required="required || undefined"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :min="min"
        :max="max"
        :step="step"
        :autocomplete="autocomplete"
        :tabindex="inputTabindex"
        :aria-invalid="hasError || undefined"
        v-bind="controlAttrs"
        :aria-describedby="describedBy"
        :class="[
          'h-full min-w-0 flex-1 rounded-[inherit] bg-transparent outline-none',
          'text-input-text placeholder:text-input-placeholder',
          'disabled:text-input-disabled-text disabled:cursor-not-allowed',
          mono && 'font-mono',
          $slots.icon ? 'ps-2' : leadingPadding,
          $slots['icon-end'] ? 'pe-2' : trailingPadding,
        ]"
        @input="handleInput"
        @blur="handleBlur"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
        @keypress="emit('keypress', $event)"
        @paste="emit('paste', $event)"
      />

      <span
        v-if="$slots['icon-end']"
        class="text-input-addon-text flex shrink-0 items-center pe-2 select-none"
      >
        <slot name="icon-end" />
      </span>

      <!-- tabindex -1: reveal and clear are conveniences, not steps in the form's tab order. -->
      <button
        v-if="canReveal"
        type="button"
        tabindex="-1"
        :aria-pressed="revealed"
        :aria-label="revealed ? t('components.input.hideValue') : t('components.input.showValue')"
        :data-test="parentDataTest ? `${parentDataTest}-reveal` : undefined"
        class="text-input-clear-btn hover:text-input-clear-btn-hover flex items-center pe-2 transition-colors"
        @click="revealed = !revealed"
      >
        <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="sm" />
      </button>

      <button
        v-if="showClear"
        type="button"
        tabindex="-1"
        :aria-label="t('components.input.clear')"
        :data-test="parentDataTest ? `${parentDataTest}-clear` : undefined"
        class="text-input-clear-btn hover:text-input-clear-btn-hover flex items-center pe-2 transition-colors"
        @click="handleClear"
      >
        <OIcon name="close" size="sm" />
      </button>

      <span v-if="suffix" class="text-input-addon-text flex shrink-0 items-center pe-3 select-none">
        {{ suffix }}
      </span>

      <span v-if="showCopy" class="flex shrink-0 items-center pe-1">
        <OCopyButton
          :value="() => String(modelValue ?? '')"
          size="xs"
          :data-test="parentDataTest ? `${parentDataTest}-copy` : undefined"
        />
      </span>
    </div>

    <!-- A " " error means the message renders elsewhere (OFormInput #error); it must not open this row. -->
    <div
      v-if="(effectiveError && effectiveError.trim()) || helpText || maxlength"
      class="flex items-center justify-between gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        :id="errorId"
        :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
        :data-test-error-text="effectiveError"
        class="text-input-error-text text-xs leading-snug"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span v-else-if="helpText" class="text-input-hint text-xs leading-snug">
        {{ helpText }}
      </span>
      <span v-else class="flex-1" />

      <span
        v-if="maxlength"
        :class="[
          'shrink-0 text-xs leading-none tabular-nums',
          charCount > maxlength ? 'text-input-error-text' : 'text-input-hint',
        ]"
      >
        {{ charCount }}/{{ maxlength }}
      </span>
    </div>
  </div>
</template>
