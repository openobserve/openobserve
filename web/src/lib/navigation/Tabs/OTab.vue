<script setup lang="ts">
import type { OTabProps, OTabSlots } from './OTab.types'
import { computed, inject } from 'vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

const props = withDefaults(defineProps<OTabProps>(), {
  disable: false,
})

defineSlots<OTabSlots>()

const context = inject<{ value: TabsContext }>(TABS_CONTEXT_KEY)

const isActive = computed<boolean>(() => context?.value.modelValue === props.name)
const isDense = computed<boolean>(() => context?.value.dense ?? false)
const isVertical = computed<boolean>(() => context?.value.isVertical ?? false)

function handleClick(): void {
  if (props.disable) return
  context?.value.onTabClick(props.name)
}

// ── Classes ────────────────────────────────────────────────────────────────
const baseClasses = [
  'o-tab',
  'tw:relative tw:inline-flex tw:items-center tw:justify-center tw:gap-1.5',
  'tw:px-4 tw:font-medium tw:text-sm tw:whitespace-nowrap',
  'tw:outline-none tw:transition-colors tw:duration-150',
  'tw:select-none',
  'tw:focus-visible:outline-none',
  'tw:focus-visible:ring-2 tw:focus-visible:ring-tabs-focus-ring tw:focus-visible:ring-inset',
].join(' ')

const stateClasses = computed<string>(() => {
  if (props.disable) {
    return [
      'tw:text-tabs-disabled-text tw:cursor-not-allowed tw:opacity-60',
    ].join(' ')
  }
  if (isActive.value) {
    return [
      'tw:text-tabs-active-text tw:cursor-pointer',
      // Indicator: bottom border (horizontal) or right border (vertical)
      isVertical.value
        ? 'tw:border-e-2 tw:border-tabs-indicator'
        : 'tw:border-b-2 tw:border-tabs-indicator',
    ].join(' ')
  }
  return [
    'tw:text-tabs-inactive-text tw:cursor-pointer',
    'tw:enabled:hover:text-tabs-hover-text tw:enabled:hover:bg-tabs-hover-bg',
    // Transparent placeholder border so layout doesn't shift on activation
    isVertical.value
      ? 'tw:border-e-2 tw:border-transparent'
      : 'tw:border-b-2 tw:border-transparent',
  ].join(' ')
})

const heightClasses = computed<string>(() => {
  if (isVertical.value) {
    return isDense.value ? 'tw:py-1.5' : 'tw:py-2'
  }
  return isDense.value ? 'tw:h-[32px]' : 'tw:h-[40px]'
})
</script>

<template>
  <button
    role="tab"
    type="button"
    :aria-selected="isActive"
    :aria-disabled="disable || undefined"
    :disabled="disable || undefined"
    :tabindex="isActive ? 0 : -1"
    :class="[baseClasses, stateClasses, heightClasses]"
    @click="handleClick"
  >
    <!--
      If label or icon props are provided, render them (prop-driven mode).
      If neither is set, fall back to the default slot (custom content mode:
      badges, close icons, folder rows, etc.).
    -->
    <template v-if="label || icon">
      <slot name="icon">
        <span v-if="icon" class="o-tab__icon tw:text-base tw:leading-none material-icons">{{ icon }}</span>
      </slot>
      <span v-if="label" class="o-tab__label">{{ label }}</span>
    </template>
    <slot v-else />
  </button>
</template>
