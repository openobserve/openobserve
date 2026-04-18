// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Input — headless-first text input replacing q-input.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (same file, :root / .body--dark)
 * Layer 3 – Component  : CSS --o2-input-* custom properties (this file, .o2-input scope)
 *
 * To theme a single instance, override a Layer-3 token on the element:
 *   <O2Input style="--o2-input-height: 2rem" />
 *
 * Props mirror Quasar q-input for drop-in replacement.
 * Variant "borderless" matches Quasar's `borderless` prop behaviour.
 */

import { computed, nextTick, onMounted, ref, useAttrs, useSlots, watch } from 'vue'

defineOptions({ inheritAttrs: false })

export interface O2InputProps {
  modelValue?: string | number | null
  /** Vue v-model modifiers forwarded by the compiler */
  modelModifiers?: { number?: boolean; trim?: boolean }
  label?: string
  placeholder?: string
  hint?: string
  /** Force error state externally */
  error?: boolean
  errorMessage?: string
  type?: 'text' | 'password' | 'number' | 'email' | 'textarea' | 'search' | 'url'
  disabled?: boolean
  readonly?: boolean
  clearable?: boolean
  loading?: boolean
  maxlength?: number
  /** Show character counter — requires maxlength */
  counter?: boolean
  /** Auto-resize textarea height to content */
  autogrow?: boolean
  /** Validation functions — return true or an error string */
  rules?: Array<(val: unknown) => true | string>
  /**
   * When to run validation:
   *   true       – on each keystroke after first blur
   *   'ondemand' – only when validate() is called explicitly
   */
  lazyRules?: boolean | 'ondemand'
  /** Suppress the bottom padding reserved for error/hint */
  hideBottomSpace?: boolean
  /** Hide the error icon next to the error message */
  noErrorIcon?: boolean
  /** Debounce input event by N milliseconds */
  debounce?: number | string
  /** Stack label above the control (always true when label is present) */
  stackLabel?: boolean
  dense?: boolean
  autofocus?: boolean
  tabindex?: number | string
  /**
   * Visual variant:
   *   outlined  – thin border, transparent bg (default)
   *   borderless – no border; used in toolbars / inline contexts
   *   filled    – subtle filled background, no border
   */
  variant?: 'outlined' | 'borderless' | 'filled'
}

const props = withDefaults(defineProps<O2InputProps>(), {
  type: 'text',
  dense: true,
  variant: 'outlined',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
  change: [event: Event]
}>()

const attrs = useAttrs()
const slots = useSlots()
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const isFocused = ref(false)
const isDirty = ref(false)
const internalError = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ─── Validation ──────────────────────────────────────────────────────────────

const runValidation = (value: unknown): boolean => {
  if (!props.rules?.length) {
    internalError.value = null
    return true
  }
  for (const rule of props.rules) {
    const result = rule(value)
    if (result !== true) {
      internalError.value = result
      return false
    }
  }
  internalError.value = null
  return true
}

/** Call from a parent q-form-equivalent to trigger validation */
const validate = (): boolean => {
  isDirty.value = true
  return runValidation(props.modelValue)
}

/** Reset validation state */
const resetValidation = (): void => {
  isDirty.value = false
  internalError.value = null
}

defineExpose({ validate, resetValidation, focus: () => inputRef.value?.focus() })

// ─── Computed state ───────────────────────────────────────────────────────────

const errorText = computed<string>(() => {
  if (props.error) return props.errorMessage ?? ''
  if (isDirty.value) return internalError.value ?? ''
  return ''
})

const hasError = computed(() => !!(props.error || (isDirty.value && internalError.value)))

const showBottom = computed(() => {
  if (props.hideBottomSpace) return hasError.value || !!props.hint || !!slots.hint
  return true
})

const nativeValue = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined) return ''
  return String(props.modelValue)
})

const hasValue = computed(
  () => props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== '',
)

// Split $attrs: root div gets class/style/data-test; native input gets the rest
const rootBindings = computed(() => {
  const { class: cls, style, 'data-test': dt } = attrs as Record<string, unknown>
  return { class: cls, style, 'data-test': dt }
})

const nativeBindings = computed(() => {
  const skip = new Set(['class', 'style', 'data-test'])
  return Object.fromEntries(
    Object.entries(attrs as Record<string, unknown>).filter(([k]) => !skip.has(k)),
  )
})

const rootClasses = computed(() => [
  'o2-input',
  `o2-input--${props.variant}`,
  {
    'o2-input--error': hasError.value,
    'o2-input--disabled': props.disabled,
    'o2-input--focused': isFocused.value,
    'o2-input--loading': props.loading,
    'o2-input--has-label': !!props.label,
    'o2-input--textarea': props.type === 'textarea',
  },
  rootBindings.value.class,
])

// ─── Auto-grow (textarea) ─────────────────────────────────────────────────────

const adjustHeight = async () => {
  if (props.type !== 'textarea' || !props.autogrow || !inputRef.value) return
  await nextTick()
  const el = inputRef.value as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

watch(() => props.modelValue, () => {
  if (props.autogrow) adjustHeight()
})

onMounted(() => {
  if (props.autofocus) inputRef.value?.focus()
  if (props.autogrow) adjustHeight()
})

// ─── Event handlers ───────────────────────────────────────────────────────────

const applyModifiers = (raw: string): string | number | null => {
  if (props.modelModifiers?.number) {
    const n = parseFloat(raw)
    return isNaN(n) ? null : n
  }
  if (props.modelModifiers?.trim) return raw.trim()
  return raw
}

const handleInput = (event: Event) => {
  const raw = (event.target as HTMLInputElement).value
  const value = applyModifiers(raw)

  const dispatch = () => {
    emit('update:modelValue', value)
    if (isDirty.value) runValidation(value)
  }

  if (props.debounce) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(dispatch, Number(props.debounce))
  } else {
    dispatch()
  }
}

const handleBlur = (event: FocusEvent) => {
  isFocused.value = false
  if (props.lazyRules && props.lazyRules !== 'ondemand') {
    isDirty.value = true
    runValidation(props.modelValue)
  }
  emit('blur', event)
}

const handleFocus = (event: FocusEvent) => {
  isFocused.value = true
  emit('focus', event)
}

const handleClear = () => {
  emit('update:modelValue', props.modelModifiers?.number ? null : '')
  nextTick(() => inputRef.value?.focus())
}
</script>

<template>
  <div
    :class="rootClasses"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
  >
    <!-- Label -->
    <label v-if="label" class="o2-input__label">{{ label }}</label>

    <!-- Visible control box -->
    <div class="o2-input__control">
      <!-- Prepend slot (icons, prefixes) -->
      <div v-if="$slots.prepend" class="o2-input__adornment o2-input__adornment--pre">
        <slot name="prepend" />
      </div>

      <!-- Native input / textarea -->
      <component
        :is="type === 'textarea' ? 'textarea' : 'input'"
        ref="inputRef"
        class="o2-input__native"
        :value="nativeValue"
        :type="type !== 'textarea' ? type : undefined"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :maxlength="maxlength"
        :tabindex="tabindex"
        v-bind="nativeBindings"
        @input="handleInput"
        @blur="handleBlur"
        @focus="handleFocus"
        @keydown="($event: KeyboardEvent) => emit('keydown', $event)"
        @keyup="($event: KeyboardEvent) => emit('keyup', $event)"
        @change="($event: Event) => emit('change', $event)"
      />

      <!-- Loading spinner -->
      <span v-if="loading" class="o2-input__spinner" aria-hidden="true" />

      <!-- Clear button -->
      <button
        v-if="clearable && hasValue && !disabled && !readonly"
        class="o2-input__clear"
        type="button"
        tabindex="-1"
        aria-label="Clear"
        @click.stop="handleClear"
      >
        <svg
          viewBox="0 0 10 10"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M1 1l8 8M9 1L1 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <!-- Append slot (icons, suffixes) -->
      <div v-if="$slots.append" class="o2-input__adornment o2-input__adornment--app">
        <slot name="append" />
      </div>
    </div>

    <!-- Bottom: error · hint · counter -->
    <div v-if="showBottom" class="o2-input__bottom">
      <span v-if="hasError" class="o2-input__error-text" role="alert">
        <svg
          v-if="!noErrorIcon"
          class="o2-input__error-icon"
          viewBox="0 0 12 12"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
          <path
            d="M6 3.5v3M6 8.2v.3"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        {{ errorText }}
      </span>
      <span v-else-if="$slots.hint" class="o2-input__hint-text">
        <slot name="hint" />
      </span>
      <span v-else-if="hint" class="o2-input__hint-text">{{ hint }}</span>

      <span v-if="counter && maxlength" class="o2-input__counter">
        {{ nativeValue.length }}/{{ maxlength }}
      </span>
    </div>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Input styles — global (non-scoped) using BEM under .o2-input namespace.
// All visual values are CSS custom properties so consumers can override per-instance.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────
// Composed from Layer 2 semantic tokens (--o2-*) defined in _variables.scss.
// Override a single instance:  <O2Input style="--o2-input-height: 2rem" />
// Override globally:           .o2-input { --o2-input-height: 2rem; }
// ─────────────────────────────────────────────────────────────────────────────

.o2-input {
  // Geometry
  --o2-input-height: 1.75rem; // 28px — Datadog-style dense default
  --o2-input-font-size: 0.8125rem; // 13px
  --o2-input-font-family: inherit;
  --o2-input-pad-x: 0.5rem; // 8px horizontal padding
  --o2-input-pad-y: 0; // vertical padding inside control
  --o2-input-radius: 0.25rem; // 4px
  --o2-input-gap: 0.25rem; // gap between adornments and input

  // Colors (mapped from semantic layer)
  --o2-input-bg: transparent;
  --o2-input-text: var(--o2-text-primary);
  --o2-input-placeholder: var(--o2-text-muted);
  --o2-input-border: var(--o2-border-input);
  --o2-input-border-focus: var(--o2-primary-color);
  --o2-input-border-error: var(--o2-status-error-text);
  --o2-input-shadow-focus: none; // set to a ring value to add focus glow

  // Label (Layer 3 — label-specific)
  --o2-input-label-size: 0.6875rem; // 11px
  --o2-input-label-weight: 500;
  --o2-input-label-color: var(--o2-input-label-text-color);
  --o2-input-label-gap: 0.1875rem; // 3px below label

  // Adornments
  --o2-input-adornment-color: var(--o2-text-muted);

  // Bottom area
  --o2-input-bottom-size: 0.6875rem; // 11px
  --o2-input-bottom-min-h: 1.125rem; // 18px
  --o2-input-bottom-gap: 0.1875rem; // 3px above bottom row
  --o2-input-error-color: var(--o2-status-error-text);
  --o2-input-hint-color: var(--o2-text-muted);

  // ─── Structure ────────────────────────────────────────────────────────────
  display: inline-flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-input-font-size);
  font-family: var(--o2-input-font-family);

  // ─── Label ────────────────────────────────────────────────────────────────
  &__label {
    display: block;
    font-size: var(--o2-input-label-size);
    font-weight: var(--o2-input-label-weight);
    color: var(--o2-input-label-color);
    margin-bottom: var(--o2-input-label-gap);
    line-height: 1;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // ─── Control (visible box) ────────────────────────────────────────────────
  &__control {
    display: flex;
    align-items: center;
    min-height: var(--o2-input-height);
    gap: var(--o2-input-gap);
    padding: var(--o2-input-pad-y) var(--o2-input-pad-x);
    border: 1px solid var(--o2-input-border);
    border-radius: var(--o2-input-radius);
    background: var(--o2-input-bg);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
    overflow: hidden;
  }

  // ─── Native input/textarea ────────────────────────────────────────────────
  &__native {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--o2-input-text);
    font-size: var(--o2-input-font-size);
    font-family: var(--o2-input-font-family);
    line-height: 1.5;
    height: 100%;

    &::placeholder {
      color: var(--o2-input-placeholder);
      opacity: 1;
    }

    // Hide browser number spin buttons
    &[type='number'] {
      -moz-appearance: textfield;

      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    }

    // Hide browser search cancel button
    &[type='search']::-webkit-search-cancel-button {
      -webkit-appearance: none;
    }

    // Hide MS password reveal
    &[type='password']::-ms-reveal,
    &[type='password']::-ms-clear {
      display: none;
    }
  }

  // Textarea overrides
  &--textarea &__native {
    resize: vertical;
    padding: 0.25rem 0;
    min-height: 4.5rem;
  }

  &--textarea &__control {
    align-items: flex-start;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
  }

  // ─── Adornments ───────────────────────────────────────────────────────────
  &__adornment {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--o2-input-adornment-color);

    // Normalise icon sizes from Quasar q-icon, SVG, or img
    .q-icon,
    svg,
    img {
      display: block;
      width: 1rem;
      height: 1rem;
      font-size: 1rem;
    }
  }

  // ─── Loading spinner ──────────────────────────────────────────────────────
  &__spinner {
    display: inline-block;
    flex-shrink: 0;
    width: 0.875rem;
    height: 0.875rem;
    border: 1.5px solid var(--o2-border);
    border-top-color: var(--o2-primary-color);
    border-radius: 50%;
    animation: o2-spin 0.7s linear infinite;
  }

  @keyframes o2-spin {
    to {
      transform: rotate(360deg);
    }
  }

  // ─── Clear button ─────────────────────────────────────────────────────────
  &__clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    flex-shrink: 0;
    border: none;
    border-radius: 0.125rem;
    background: transparent;
    color: var(--o2-input-adornment-color);
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.12s;

    &:hover {
      opacity: 1;
    }
  }

  // ─── Bottom row ───────────────────────────────────────────────────────────
  &__bottom {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    min-height: var(--o2-input-bottom-min-h);
    padding-top: var(--o2-input-bottom-gap);
    font-size: var(--o2-input-bottom-size);
    line-height: 1.3;
  }

  &__error-text {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--o2-input-error-color);
  }

  &__error-icon {
    flex-shrink: 0;
    color: var(--o2-input-error-color);
  }

  &__hint-text {
    color: var(--o2-input-hint-color);
  }

  &__counter {
    margin-left: auto;
    color: var(--o2-input-hint-color);
    font-variant-numeric: tabular-nums;
  }

  // ─── Focus state ──────────────────────────────────────────────────────────
  &--focused &__control {
    border-color: var(--o2-input-border-focus);
    box-shadow: var(--o2-input-shadow-focus);
  }

  // ─── Error state ──────────────────────────────────────────────────────────
  &--error &__control {
    border-color: var(--o2-input-border-error);
  }

  // ─── Disabled state ───────────────────────────────────────────────────────
  &--disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── Variant: outlined (default) ──────────────────────────────────────────
  // No extra rules — base styles already produce an outlined input.

  // ─── Variant: borderless ──────────────────────────────────────────────────
  // Matches Quasar's `borderless` prop: no visible border at rest.
  &--borderless &__control {
    border-color: var(--o2-border);
    background: transparent;
  }

  &--borderless.o2-input--focused &__control {
    border-color: var(--o2-input-border-focus);
  }

  &--borderless.o2-input--error &__control {
    border-color: var(--o2-input-border-error);
  }

  // ─── Variant: filled ──────────────────────────────────────────────────────
  &--filled &__control {
    border-color: transparent;
    background: var(--o2-secondary-background);
  }

  &--filled.o2-input--focused &__control {
    background: var(--o2-secondary-background);
    border-color: var(--o2-input-border-focus);
  }

  &--filled.o2-input--error &__control {
    border-color: var(--o2-input-border-error);
  }
}
</style>
