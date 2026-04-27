<script setup lang="ts">
import { ToggleGroupRoot } from 'reka-ui'
import type { ToggleGroupProps, ToggleGroupEmits } from './ToggleGroup.types'

const props = withDefaults(defineProps<ToggleGroupProps>(), {
  label: undefined,
  modelValue: undefined,
})

const emit = defineEmits<ToggleGroupEmits>()
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="modelValue"
    :aria-label="label"
    class="tw:inline-flex tw:items-center tw:rounded-[7px] tw:border tw:border-toggle-group-border tw:bg-toggle-group-bg tw:p-[2px] tw:gap-[1px]"
    @update:model-value="$event != null && $event !== '' && emit('update:modelValue', $event as string)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
