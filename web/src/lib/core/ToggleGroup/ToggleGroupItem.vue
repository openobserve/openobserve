<script setup lang="ts">
import { ToggleGroupItem as ToggleGroupItemPrimitive } from 'reka-ui'
import type { ToggleGroupItemProps } from './ToggleGroup.types'

withDefaults(defineProps<ToggleGroupItemProps>(), {
  disabled: false,
})
</script>

<template>
  <ToggleGroupItemPrimitive
    :value="value"
    :disabled="disabled"
    :class="[
      'tw:inline-flex tw:items-center tw:justify-center tw:gap-1',
      'tw:h-6 tw:px-2 tw:text-[11px] tw:font-medium tw:rounded-[5px]',
      'tw:whitespace-nowrap tw:transition-colors tw:duration-150',
      'tw:outline-none tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500/40',
      'tw:cursor-pointer',
      'tw:text-toggle-group-item-text',
      'tw:data-[state=on]:bg-toggle-group-item-active-bg tw:data-[state=on]:text-toggle-group-item-active-text tw:data-[state=on]:shadow-sm',
      'tw:data-[disabled]:text-toggle-group-item-disabled-text tw:data-[disabled]:cursor-not-allowed',
      'tw:hover:text-toggle-group-item-hover-text tw:hover:bg-toggle-group-item-active-bg/60',
    ]"
  >
    <slot />
  </ToggleGroupItemPrimitive>
</template>
