<script setup lang="ts">
import type { OTabPanelProps, OTabPanelSlots, TabPanelPadding, TabPanelLayout } from './OTabPanel.types'
import { computed, inject, type ComputedRef } from 'vue'
import { TAB_PANELS_CONTEXT_KEY } from './OTabPanels.types'
import type { TabPanelsContext } from './OTabPanels.types'

const props = withDefaults(defineProps<OTabPanelProps>(), {
  padding: 'none',
  layout: 'block',
  stretch: false,
})

defineSlots<OTabPanelSlots>()

const context = inject<ComputedRef<TabPanelsContext>>(TAB_PANELS_CONTEXT_KEY)

const isActive = computed<boolean>(() => context?.value.modelValue === props.name)
const keepAlive = computed<boolean>(() => context?.value.keepAlive ?? false)
const animated = computed<boolean>(() => context?.value.animated ?? false)

const paddingClasses: Record<TabPanelPadding, string> = {
  none: 'tw:p-0',
  sm:   'tw:p-2',
  md:   'tw:p-4',
}

const layoutClasses: Record<TabPanelLayout, string> = {
  block:     '',
  'flex-col': 'tw:flex tw:flex-col',
  'flex-row': 'tw:flex tw:flex-row',
}

const panelClasses = computed<string[]>(() => {
  const classes: string[] = ['o-tab-panel', paddingClasses[props.padding]]
  const layout = layoutClasses[props.layout]
  if (layout) classes.push(layout)
  if (props.stretch) classes.push('tw:h-full')
  return classes
})
</script>

<template>
  <!--
    keepAlive=false (default): unmount inactive panels entirely (v-if).
    keepAlive=true: keep DOM alive, just hide with v-show.
    animated: wrap visible panel in CSS <Transition>.
  -->
  <template v-if="keepAlive">
    <Transition v-if="animated" name="o-tab-panel">
      <div v-show="isActive" role="tabpanel" :id="`tab-panel-${props.name}`" :aria-labelledby="`tab-${props.name}`" tabindex="0" :class="panelClasses">
        <slot />
      </div>
    </Transition>
    <div v-else v-show="isActive" role="tabpanel" :id="`tab-panel-${props.name}`" :aria-labelledby="`tab-${props.name}`" tabindex="0" :class="panelClasses">
      <slot />
    </div>
  </template>
  <template v-else>
    <Transition v-if="animated && isActive" name="o-tab-panel">
      <div role="tabpanel" :id="`tab-panel-${props.name}`" :aria-labelledby="`tab-${props.name}`" tabindex="0" :class="panelClasses">
        <slot />
      </div>
    </Transition>
    <div v-else-if="isActive" role="tabpanel" :id="`tab-panel-${props.name}`" :aria-labelledby="`tab-${props.name}`" tabindex="0" :class="panelClasses">
      <slot />
    </div>
  </template>
</template>
