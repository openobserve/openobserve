<script setup lang="ts">
import type { OTabsProps, OTabsEmits, OTabsSlots } from './OTabs.types'
import { computed, provide, ref } from 'vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

const props = withDefaults(defineProps<OTabsProps>(), {
  orientation: 'horizontal',
  align: 'left',
  dense: false,
})

const emit = defineEmits<OTabsEmits>()

defineSlots<OTabsSlots>()

const isVertical = computed(() => props.orientation === 'vertical')

/** Called by OTab children when clicked */
function onTabClick(name: string | number): void {
  emit('update:modelValue', name)
  emit('change', name)
}

/** Provide context to all OTab descendants */
const context = computed<TabsContext>(() => ({
  modelValue: props.modelValue,
  onTabClick,
  isVertical: isVertical.value,
  dense: props.dense,
}))

provide(TABS_CONTEXT_KEY, context)

// ── Keyboard navigation ────────────────────────────────────────────────────
/** Ref to the tablist element so we can query tabs from it */
const tablistRef = ref<HTMLElement | null>(null)

function getFocusableTabs(): HTMLElement[] {
  if (!tablistRef.value) return []
  return Array.from(
    tablistRef.value.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')
  )
}

function handleKeydown(event: KeyboardEvent): void {
  const tabs = getFocusableTabs()
  if (tabs.length === 0) return

  const current = document.activeElement as HTMLElement
  const currentIndex = tabs.indexOf(current)

  const forward = isVertical.value ? 'ArrowDown' : 'ArrowRight'
  const backward = isVertical.value ? 'ArrowUp' : 'ArrowLeft'

  if (event.key === forward) {
    event.preventDefault()
    const next = tabs[(currentIndex + 1) % tabs.length]
    next?.focus()
  } else if (event.key === backward) {
    event.preventDefault()
    const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
    prev?.focus()
  } else if (event.key === 'Home') {
    event.preventDefault()
    tabs[0]?.focus()
  } else if (event.key === 'End') {
    event.preventDefault()
    tabs[tabs.length - 1]?.focus()
  }
}

// ── CSS classes ────────────────────────────────────────────────────────────
const alignClasses: Record<NonNullable<OTabsProps['align']>, string> = {
  left:    'tw:justify-start',
  center:  'tw:justify-center',
  right:   'tw:justify-end',
  justify: 'tw:justify-stretch',
}

const wrapperClasses = computed<string[]>(() => [
  'o-tabs',
  isVertical.value
    ? 'tw:flex-col'
    : 'tw:flex-row tw:flex-wrap',
  alignClasses[props.align],
])
</script>

<template>
  <div
    ref="tablistRef"
    role="tablist"
    :aria-orientation="orientation"
    :class="['tw:flex', wrapperClasses]"
    @keydown="handleKeydown"
  >
    <slot />
  </div>
</template>
