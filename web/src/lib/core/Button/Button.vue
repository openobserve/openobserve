<script setup lang="ts">
import type { ButtonProps, ButtonEmits, ButtonSlots } from './Button.types'
import { computed } from 'vue'

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
})

const emit = defineEmits<ButtonEmits>()

defineSlots<ButtonSlots>()

// Variant class map — every entry is a full token-based class string
const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: [
    'tw:bg-button-primary tw:text-button-primary-foreground',
    'tw:enabled:hover:bg-button-primary-hover',
    'tw:enabled:active:bg-button-primary-active',
    'tw:focus-visible:ring-4 tw:focus-visible:ring-button-primary-focus-ring',
    'tw:disabled:bg-button-primary-disabled tw:disabled:text-button-primary-foreground',
  ].join(' '),
  secondary: [
    'tw:bg-button-secondary tw:text-button-secondary-foreground',
    'tw:enabled:hover:bg-button-secondary-hover',
    'tw:enabled:active:bg-button-secondary-active',
    'tw:focus-visible:ring-4 tw:focus-visible:ring-button-secondary-focus-ring',
    'tw:disabled:bg-button-secondary-disabled tw:disabled:text-text-disabled',
  ].join(' '),
  outline: [
    'tw:bg-transparent tw:text-button-outline-text tw:border tw:border-button-outline-border',
    'tw:enabled:hover:bg-button-outline-hover-bg tw:enabled:hover:border-button-outline-hover-border',
    'tw:enabled:active:bg-button-outline-active-bg',
    'tw:focus-visible:ring-4 tw:focus-visible:ring-button-outline-focus-ring',
    'tw:disabled:opacity-50',
  ].join(' '),
  ghost: [
    'tw:bg-transparent tw:text-button-ghost-text tw:border-0',
    'tw:enabled:hover:bg-button-ghost-hover-bg',
    'tw:enabled:active:bg-button-ghost-active-bg',
    'tw:focus-visible:ring-4 tw:focus-visible:ring-button-ghost-focus-ring',
    'tw:disabled:text-text-disabled',
  ].join(' '),
  destructive: [
    'tw:bg-button-destructive tw:text-button-destructive-foreground',
    'tw:enabled:hover:bg-button-destructive-hover',
    'tw:enabled:active:bg-button-destructive-hover',
    'tw:focus-visible:ring-4 tw:focus-visible:ring-error-700',
    'tw:disabled:bg-button-destructive-disabled',
  ].join(' '),
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm:   'tw:h-8 tw:ps-3 tw:pe-3 tw:text-sm tw:gap-1.5 tw:rounded-md',
  md:   'tw:h-10 tw:ps-4 tw:pe-4 tw:text-sm tw:gap-2 tw:rounded-lg',
  lg:   'tw:h-12 tw:ps-6 tw:pe-6 tw:text-base tw:gap-3 tw:rounded-lg',
  icon: 'tw:size-9 tw:p-0 tw:rounded-lg',
}

const classes = computed<string[]>(() => [
  // Base — layout, typography, interaction
  'tw:inline-flex tw:items-center tw:justify-center tw:whitespace-nowrap',
  'tw:font-medium tw:transition-colors tw:duration-150',
  'tw:outline-none tw:focus-visible:outline-none',
  'tw:disabled:cursor-not-allowed tw:enabled:cursor-pointer',
  // Variant + size
  variantClasses[props.variant],
  sizeClasses[props.size],
])

function handleClick(event: MouseEvent): void {
  if (props.disabled || props.loading) return
  emit('click', event)
}
</script>

<template>
  <button
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot name="icon-left" />
    <slot />
    <slot name="icon-right" />
  </button>
</template>
