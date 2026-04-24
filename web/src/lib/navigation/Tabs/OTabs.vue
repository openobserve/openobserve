<script setup lang="ts">
import type { OTabsProps, OTabsEmits, OTabsSlots } from './OTabs.types'
import { computed, provide, ref } from 'vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

// ── Focus ring tracking ────────────────────────────────────────────────────
const focusedTabEl = ref<HTMLElement | null>(null)

const focusRingStyle = computed<Record<string, string> | null>(() => {
  if (!focusedTabEl.value || !tablistRef.value) return null
  const tabRect = focusedTabEl.value.getBoundingClientRect()
  const parentRect = tablistRef.value.getBoundingClientRect()
  return {
    left: `${tabRect.left - parentRect.left}px`,
    top: `${tabRect.top - parentRect.top}px`,
    width: `${tabRect.width}px`,
    height: `${tabRect.height}px`,
  }
})

function handleFocusin(event: FocusEvent): void {
  const target = event.target as HTMLElement
  if (target.getAttribute('role') === 'tab' && target.matches(':focus-visible')) {
    focusedTabEl.value = target
  }
}

function handleFocusout(event: FocusEvent): void {
  const related = event.relatedTarget as HTMLElement | null
  if (!tablistRef.value?.contains(related)) {
    focusedTabEl.value = null
  }
}

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
    :class="['tw:flex tw:relative', wrapperClasses]"
    @keydown="handleKeydown"
    @focusin="handleFocusin"
    @focusout="handleFocusout"
  >
    <slot />
    <div
      v-if="focusRingStyle"
      aria-hidden="true"
      :style="focusRingStyle"
      class="tw:absolute tw:pointer-events-none tw:rounded tw:ring-2 tw:ring-inset tw:ring-tabs-focus-ring tw:transition-all tw:duration-200 tw:ease-in-out"
    />
  </div>
</template>
