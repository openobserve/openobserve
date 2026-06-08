<script setup lang="ts">
import type { OTabsProps, OTabsEmits, OTabsSlots } from './OTabs.types'
import { computed, provide, reactive, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'
import { TabsRoot, TabsList } from 'reka-ui'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const scrollRef = ref<HTMLElement | null>(null)
const tablistRef = ref<HTMLElement | null>(null)

function handleFocusin(event: FocusEvent): void {
  const target = event.target as HTMLElement
  if (target.getAttribute('role') !== 'tab') return
  // Scroll into view: arrow keys move focus without activating, so modelValue watch doesn't fire
  const el = scrollRef.value
  if (!el) return
  const tabRect = target.getBoundingClientRect()
  const containerRect = el.getBoundingClientRect()
  if (tabRect.left < containerRect.left) {
    el.scrollBy({ left: tabRect.left - containerRect.left - 8, behavior: 'smooth' })
  } else if (tabRect.right > containerRect.right) {
    el.scrollBy({ left: tabRect.right - containerRect.right + 8, behavior: 'smooth' })
  }
}

const props = withDefaults(defineProps<OTabsProps>(), {
  orientation: 'horizontal',
  align: 'left',
  dense: false,
  bordered: false,
})

const emit = defineEmits<OTabsEmits>()

defineSlots<OTabsSlots>()

const isVertical = computed(() => props.orientation === 'vertical')

/** Called by ORouteTab and forwarded from TabsRoot's update:modelValue */
function onTabClick(name: string | number): void {
  emit('update:modelValue', name)
  emit('change', name)
}

/** Provide context to OTab / ORouteTab descendants */
const context = computed<TabsContext>(() => ({
  modelValue: props.modelValue,
  onTabClick,
  isVertical: isVertical.value,
  dense: props.dense,
}))

provide(TABS_CONTEXT_KEY, context)

// ── Sliding active indicator (horizontal only) ────────────────────────────
// A single underline positioned over the active tab. On selection it animates
// (translateX + width) from the previous tab to the new one. It lives inside
// the scrolling tablist, so its offset-based coordinates stay correct while the
// tabs scroll.
const indicator = reactive({ left: 0, width: 0, visible: false })
// Suppress the transition on first paint so the bar doesn't slide in from the
// left edge on initial mount — only later selections animate.
const indicatorReady = ref(false)

function updateIndicator(): void {
  if (isVertical.value) return
  const list = tablistRef.value
  if (!list) return
  const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (!active) {
    indicator.visible = false
    return
  }
  indicator.left = active.offsetLeft
  indicator.width = active.offsetWidth
  indicator.visible = true
}

// ── Scroll arrows (horizontal only) ───────────────────────────────────────
const hasOverflow = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateScrollState(): void {
  const el = scrollRef.value
  if (!el) {
    hasOverflow.value = false
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  hasOverflow.value = el.scrollWidth > el.clientWidth + 1
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  // Tab geometry can shift on resize (wrap/overflow) — keep the bar aligned.
  updateIndicator()
}

function scrollTabs(direction: 1 | -1): void {
  const el = scrollRef.value
  if (!el) return
  el.scrollBy({ left: direction * 200, behavior: 'smooth' })
}

let ro: ResizeObserver | null = null

onMounted(() => {
  if (isVertical.value) return
  const el = scrollRef.value
  if (!el) return
  el.addEventListener('scroll', updateScrollState, { passive: true })
  ro = new ResizeObserver(updateScrollState)
  ro.observe(el)
  if (tablistRef.value) ro.observe(tablistRef.value)
  nextTick(() => {
    updateScrollState()
    // Enable the slide animation only after the bar is placed once.
    requestAnimationFrame(() => { indicatorReady.value = true })
  })
})

onUnmounted(() => {
  scrollRef.value?.removeEventListener('scroll', updateScrollState)
  ro?.disconnect()
})

// Auto-scroll to reveal the active tab when modelValue changes
watch(() => props.modelValue, async () => {
  if (isVertical.value) return
  await nextTick()
  // Slide the shared underline to the newly active tab.
  updateIndicator()
  const el = scrollRef.value
  if (!el) return
  const activeTab = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (!activeTab) return
  const tabRect = activeTab.getBoundingClientRect()
  const containerRect = el.getBoundingClientRect()
  if (tabRect.left < containerRect.left) {
    el.scrollBy({ left: tabRect.left - containerRect.left - 8, behavior: 'smooth' })
  } else if (tabRect.right > containerRect.right) {
    el.scrollBy({ left: tabRect.right - containerRect.right + 8, behavior: 'smooth' })
  }
})

// ── CSS classes ────────────────────────────────────────────────────────────
const alignClasses: Record<NonNullable<OTabsProps['align']>, string> = {
  left:    'tw:justify-start',
  center:  'tw:justify-center',
  right:   'tw:justify-end',
  justify: 'tw:justify-stretch',
}
</script>

<template>
  <!-- Vertical: TabsRoot wraps the layout; TabsList as-child on the tablist div -->
  <TabsRoot
    v-if="isVertical"
    :model-value="modelValue"
    :orientation="orientation"
    activation-mode="manual"
    as="div"
    @update:model-value="(v) => onTabClick(v as string | number)"
  >
    <TabsList as-child :loop="true">
      <div
        ref="tablistRef"
        :class="['o-tabs tw:flex tw:flex-col tw:gap-0.5 tw:relative tw:p-1', alignClasses[align], { 'tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]': bordered }]"
      >
        <slot />
      </div>
    </TabsList>
  </TabsRoot>

  <!-- Horizontal: TabsRoot as-child on the outer flex wrapper; TabsList as-child on the tablist div -->
  <TabsRoot
    v-else
    :model-value="modelValue"
    :orientation="orientation"
    activation-mode="manual"
    as-child
    @update:model-value="(v) => onTabClick(v as string | number)"
  >
    <div :class="['tw:flex tw:flex-row tw:items-stretch', { 'tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]': bordered }]">
      <!-- Left arrow -->
      <button
        v-show="hasOverflow"
        :disabled="!canScrollLeft"
        type="button"
        aria-hidden="true"
        tabindex="-1"
        class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:cursor-pointer tw:text-tabs-active-text tw:enabled:hover:text-tabs-indicator tw:disabled:opacity-30 tw:disabled:cursor-default tw:border-b-2 tw:border-transparent tw:bg-transparent tw:outline-none"
        @click="scrollTabs(-1)"
      >
        <OIcon name="chevron-left" size="md" />
      </button>

      <!-- Overflow-hidden scroll container -->
      <div
        ref="scrollRef"
        class="tw:flex-1 tw:overflow-x-hidden tw:relative tw:py-[3px]"
      >
        <TabsList as-child :loop="true">
          <div
            ref="tablistRef"
            :class="['o-tabs tw:flex tw:flex-row tw:relative tw:px-[3px]', alignClasses[align]]"
            @focusin="handleFocusin"
          >
            <!-- Single shared underline — slides (translateX + width) to the
                 active tab instead of each tab drawing its own border. -->
            <span
              v-show="indicator.visible"
              aria-hidden="true"
              data-test="otabs-active-indicator"
              class="tw:absolute tw:bottom-0 tw:left-0 tw:h-0.5 tw:rounded-full tw:bg-tabs-indicator tw:pointer-events-none tw:z-10"
              :class="indicatorReady ? 'tw:transition-[transform,width] tw:duration-300 tw:ease-out' : ''"
              :style="{
                transform: `translateX(${indicator.left}px)`,
                width: `${indicator.width}px`,
              }"
            />
            <slot />
          </div>
        </TabsList>
      </div>

      <!-- Right arrow -->
      <button
        v-show="hasOverflow"
        :disabled="!canScrollRight"
        type="button"
        aria-hidden="true"
        tabindex="-1"
        class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:cursor-pointer tw:text-tabs-active-text tw:enabled:hover:text-tabs-indicator tw:disabled:opacity-30 tw:disabled:cursor-default tw:border-b-2 tw:border-transparent tw:bg-transparent tw:outline-none"
        @click="scrollTabs(1)"
      >
        <OIcon name="chevron-right" size="md" />
      </button>
    </div>
  </TabsRoot>
</template>
