<script setup lang="ts">
import type { ORouteTabProps, ORouteTabSlots } from './ORouteTab.types'
import { inject, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import OTab from './OTab.vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

const props = withDefaults(defineProps<ORouteTabProps>(), {
  disable: false,
})

defineSlots<ORouteTabSlots>()

const router = useRouter()
const route = useRoute()
const context = inject<{ value: TabsContext }>(TABS_CONTEXT_KEY)

/** Sync active tab with route when route matches this tab's name */
function syncWithRoute(): void {
  if (route.name === props.name && context?.value && context.value.modelValue !== props.name) {
    context.value.onTabClick(props.name)
  }
}

onMounted(syncWithRoute)
watch(() => route.name, syncWithRoute)

function handleClick(): void {
  if (props.disable) return
  if (props.to) {
    router.push(props.to)
  }
}
</script>

<template>
  <OTab
    :name="name"
    :label="label"
    :icon="icon"
    :disable="disable"
    @click="handleClick"
  >
    <slot />
  </OTab>
</template>
