<script setup lang="ts">
import type { OTabPanelProps, OTabPanelSlots } from './OTabPanel.types'
import { computed, inject } from 'vue'
import { TAB_PANELS_CONTEXT_KEY } from './OTabPanels.types'
import type { TabPanelsContext } from './OTabPanels.types'

const props = defineProps<OTabPanelProps>()

defineSlots<OTabPanelSlots>()

const context = inject<{ value: TabPanelsContext }>(TAB_PANELS_CONTEXT_KEY)

const isActive = computed<boolean>(() => context?.value.modelValue === props.name)
const keepAlive = computed<boolean>(() => context?.value.keepAlive ?? false)
const animated = computed<boolean>(() => context?.value.animated ?? false)
</script>

<template>
  <!--
    keepAlive=false (default): unmount inactive panels entirely (v-if).
    keepAlive=true: keep DOM alive, just hide with v-show.
    animated: wrap visible panel in CSS <Transition>.
  -->
  <template v-if="keepAlive">
    <Transition v-if="animated" name="o-tab-panel">
      <div v-show="isActive" role="tabpanel" class="o-tab-panel">
        <slot />
      </div>
    </Transition>
    <div v-else v-show="isActive" role="tabpanel" class="o-tab-panel">
      <slot />
    </div>
  </template>
  <template v-else>
    <Transition v-if="animated && isActive" name="o-tab-panel">
      <div role="tabpanel" class="o-tab-panel">
        <slot />
      </div>
    </Transition>
    <div v-else-if="isActive" role="tabpanel" class="o-tab-panel">
      <slot />
    </div>
  </template>
</template>
