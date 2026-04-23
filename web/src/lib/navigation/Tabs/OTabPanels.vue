<script setup lang="ts">
import type { OTabPanelsProps, OTabPanelsEmits, OTabPanelsSlots, TabPanelsContext } from './OTabPanels.types'
import { TAB_PANELS_CONTEXT_KEY } from './OTabPanels.types'
import { computed, provide } from 'vue'

const props = withDefaults(defineProps<OTabPanelsProps>(), {
  animated: false,
  keepAlive: false,
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
</script>

<template>
  <div
    class="o-tab-panels tw:overflow-hidden"
    :class="{ 'o-tab-panels--animated': animated }"
  >
    <slot />
  </div>
</template>
