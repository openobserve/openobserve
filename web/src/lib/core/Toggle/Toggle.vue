<script setup lang="ts">
import { Toggle as TogglePrimitive } from 'reka-ui'
import type { ToggleProps } from './Toggle.types'

const props = withDefaults(defineProps<ToggleProps>(), {
  size: 'default',
  disabled: false,
})

const emit = defineEmits<{ 'update:pressed': [value: boolean] }>()
</script>

<template>
  <TogglePrimitive
    :pressed="pressed"
    :disabled="disabled"
    :class="[
      'tw:inline-flex tw:items-center tw:justify-center tw:gap-1.5',
      'tw:rounded-md tw:font-medium tw:transition-colors tw:duration-150',
      'tw:outline-none tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500/40',
      'tw:border tw:border-transparent',
      'tw:cursor-pointer tw:select-none',
      size === 'sm'
        ? 'tw:h-7 tw:px-2.5 tw:text-xs'
        : 'tw:h-8 tw:px-3 tw:text-sm',
      pressed
        ? 'tw:bg-primary-50 tw:text-primary-700 tw:border-primary-200 dark:tw:bg-primary-950 dark:tw:text-primary-400 dark:tw:border-primary-800/60'
        : disabled
          ? 'tw:text-grey-400 tw:cursor-not-allowed tw:opacity-50'
          : 'tw:text-grey-600 tw:hover:bg-grey-100 tw:hover:text-grey-800 dark:tw:text-grey-400 dark:tw:hover:bg-grey-800 dark:tw:hover:text-grey-200',
    ]"
    @update:pressed="emit('update:pressed', $event)"
  >
    <slot />
  </TogglePrimitive>
</template>
