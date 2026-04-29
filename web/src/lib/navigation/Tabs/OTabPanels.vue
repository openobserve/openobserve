<script setup lang="ts">
import type { OTabPanelsProps, OTabPanelsEmits, OTabPanelsSlots, TabPanelsContext, TabPanelsScroll } from './OTabPanels.types'
import { TAB_PANELS_CONTEXT_KEY } from './OTabPanels.types'
import { computed, provide } from 'vue'

const props = withDefaults(defineProps<OTabPanelsProps>(), {
  animated: false,
  keepAlive: false,
  grow: false,
  scroll: 'none',
})

defineEmits<OTabPanelsEmits>()
defineSlots<OTabPanelsSlots>()

/** Share active panel name and options with all OTabPanel descendants */
const context = computed<TabPanelsContext>(() => ({
  modelValue: props.modelValue,
  keepAlive: props.keepAlive,
  animated: props.animated,
}))

provide(TAB_PANELS_CONTEXT_KEY, context)

const scrollClasses: Record<TabPanelsScroll, string> = {
  none: 'tw:overflow-hidden',
  auto: 'tw:overflow-auto',
  y:    'tw:overflow-y-auto',
}

const rootClasses = computed<string[]>(() => {
  const classes: string[] = ['o-tab-panels', scrollClasses[props.scroll]]
  if (props.animated) classes.push('o-tab-panels--animated')
  if (props.grow) classes.push('tw:flex-1')
  return classes
})
</script>

<template>
  <div :class="rootClasses">
    <slot />
  </div>
</template>
