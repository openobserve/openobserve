<script setup lang="ts">
import type { OTabProps, OTabSlots } from './OTab.types'
import { computed, inject, useAttrs, type ComputedRef } from 'vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'
import { TabsTrigger } from 'reka-ui'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import { iconRegistry } from '@/lib/core/Icon/OIcon.icons'
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'

// Disable auto-attribute inheritance so the consumer's `data-test="..."` lands
// on the inner clickable TabsTrigger (Reka button) instead of the wrapper
// <span class="tw:contents">. e2e tests can then locate and click the tab.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<OTabProps>(), {
  disable: false,
})

defineSlots<OTabSlots>()

const $attrs = useAttrs()
const parentDataTest = computed(() => $attrs['data-test'] as string | undefined)

/**
 * Attrs forwarded to the outer <span> wrapper — everything except data-test.
 * data-test must only land on the inner <TabsTrigger> (the actual clickable
 * button) to avoid a strict-mode locator violation in Playwright (two elements
 * matching the same selector).
 */
const spanAttrs = computed(() => {
   
  const { 'data-test': _dt, ...rest } = $attrs
  return rest
})

const context = inject<ComputedRef<TabsContext>>(TABS_CONTEXT_KEY)

const isActive = computed<boolean>(() => context?.value.modelValue === props.name)
const isDense = computed<boolean>(() => context?.value.dense ?? false)
const isVertical = computed<boolean>(() => context?.value.isVertical ?? false)
const isReorderable = computed<boolean>(() => context?.value.reorderable ?? false)
/** This tab is the one being dragged → dim it. */
const isDragging = computed<boolean>(
  () => isReorderable.value && context?.value.draggingName === props.name,
)
/** Pointer is hovering this tab as a drop target → show an insertion line. */
const isDropTarget = computed<boolean>(
  () =>
    isReorderable.value &&
    context?.value.dropTargetName != null &&
    context.value.dropTargetName === props.name,
)
/** Position class for the insertion line (which edge, and orientation). */
const dropIndicatorClass = computed<string>(() => {
  const before = context?.value.dropBefore ?? true
  if (isVertical.value) {
    return before
      ? 'tw:top-0 tw:left-1 tw:right-1 tw:h-0.5'
      : 'tw:bottom-0 tw:left-1 tw:right-1 tw:h-0.5'
  }
  return before
    ? 'tw:left-0 tw:top-1 tw:bottom-1 tw:w-0.5'
    : 'tw:right-0 tw:top-1 tw:bottom-1 tw:w-0.5'
})

/** True when the icon prop uses Quasar's `img:` prefix (renders as <img>) */
const isImgIcon = computed<boolean>(() => Boolean(props.icon?.startsWith('img:')))
/** The resolved src URL (stripped of `img:` prefix) */
const imgSrc = computed<string>(() => (props.icon?.startsWith('img:') ? props.icon.slice(4) : ''))
/** True when the icon name is registered in the OIcon SVG registry (kebab-case) */
const isOIcon = computed<boolean>(() => Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry))

// ── Classes ────────────────────────────────────────────────────────────────
const baseClasses = computed<string>(() => [
  'o-tab',
  'tw:relative tw:items-center tw:gap-1.5',
  isVertical.value
    ? 'tw:flex tw:justify-start'
    : 'tw:inline-flex tw:justify-center',
  'tw:px-2 tw:font-normal tw:text-sm tw:whitespace-nowrap',
  isVertical.value ? 'tw:rounded-lg' : 'tw:rounded-t-md',
  'tw:outline-none tw:transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow] tw:duration-150',
  'tw:select-none',
  'tw:ring-offset-1 tw:ring-offset-surface-base',
  'tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-tabs-indicator',
].join(' '))

const stateClasses = computed<string>(() => {
  if (props.disable) {
    return [
      'tw:text-tabs-disabled-text tw:cursor-not-allowed tw:opacity-60',
      // Keep the transparent left border so disabled items don't shift width.
      isVertical.value ? 'tw:border-l-2 tw:border-transparent' : '',
    ].join(' ')
  }
  if (isActive.value) {
    // Horizontal tabs: colored text only. The active underline is a single
    // shared bar in OTabs that slides between tabs, so each tab keeps a
    // transparent 2px border (layout parity with inactive) rather than drawing
    // its own colored one.
    // Vertical tabs (side rail): tint bg + primary text + a colored left accent
    // border that reads as the active rail marker.
    return [
      'tw:text-tabs-active-text tw:cursor-pointer',
      isVertical.value
        ? 'tw:bg-tabs-active-bg tw:border-l-2 tw:border-tabs-indicator'
        : 'tw:border-b-2 tw:border-transparent',
    ].join(' ')
  }
  return [
    'tw:text-tabs-inactive-text tw:cursor-pointer',
    isVertical.value
      ? 'tw:enabled:hover:text-tabs-hover-text tw:enabled:hover:bg-tabs-hover-bg'
      : 'tw:enabled:hover:text-tabs-hover-text',
    // Transparent border (left for vertical, bottom for horizontal) keeps inactive
    // items the same size as the active one — no layout shift on activation.
    isVertical.value ? 'tw:border-l-2 tw:border-transparent' : 'tw:border-b-2 tw:border-transparent',
  ].join(' ')
})

const heightClasses = computed<string>(() => {
  if (isVertical.value) {
    return isDense.value ? 'tw:py-1.5' : 'tw:py-2'
  }
  return isDense.value ? 'tw:h-[32px]' : 'tw:h-[40px]'
})
</script>

<template>
  <!--
    Disabled buttons suppress hover events in browsers, so cursor-not-allowed set
    on the button itself never renders. The span wrapper intercepts hover and
    shows the cursor and tooltip even when the inner button is disabled.
  -->
  <span :class="disable ? 'tw:cursor-not-allowed' : 'tw:contents'">
    <!--
      TabsTrigger handles: role="tab", aria-selected, tabindex (via RovingFocusItem),
      disabled, data-state, click/keyboard activation, and aria-controls linkage.
      aria-disabled is passed explicitly for screen-reader compatibility.
      data-test is forwarded so Playwright can reliably target the clickable button —
      `v-bind="$attrs"` forwards the consumer's data-test onto the inner Reka
      button, which is where data-state="active" also lives so the
      `[data-test="X"][data-state="active"]` composite selectors work.
    -->
    <TabsTrigger
      :value="name"
      :disabled="disable"
      :aria-disabled="disable || undefined"
      :id="`tab-${name}`"
      :aria-controls="`tab-panel-${name}`"
      :class="[
        baseClasses,
        stateClasses,
        heightClasses,
        isReorderable ? 'tw:cursor-grab tw:active:cursor-grabbing' : '',
        isDragging ? 'tw:opacity-40' : '',
      ]"
      :draggable="isReorderable || undefined"
      :data-otab-name="name"
      v-bind="$attrs"
    >
      <!-- Insertion line — shows where the dragged tab will land (before/after
           this drop-target tab) so the drop position is visible during drag. -->
      <span
        v-if="isDropTarget"
        aria-hidden="true"
        class="tw:absolute tw:rounded-full tw:bg-primary-600 tw:pointer-events-none tw:z-20"
        :class="dropIndicatorClass"
      />
      <!-- Drag handle — shown only in reorderable mode to signal the tab can be
           dragged to reorder. Purely an affordance; the whole tab is draggable. -->
      <OIcon
        v-if="isReorderable"
        name="drag-indicator"
        size="sm"
        class="o-tab__drag-handle tw:shrink-0 tw:opacity-40 tw:-ml-0.5"
        aria-hidden="true"
      />
      <!--
        If label or icon props are provided, render them (prop-driven mode).
        If neither is set, fall back to the default slot (custom content mode:
        badges, close icons, folder rows, etc.).
      -->
      <template v-if="label || icon">
        <slot name="icon">
          <!-- img: prefix (Quasar compat) → render as <img> -->
          <img
            v-if="icon && isImgIcon"
            :src="imgSrc"
            class="o-tab__icon tw:h-4 tw:w-4 tw:shrink-0 tw:object-contain"
            aria-hidden="true"
            alt=""
          />
          <!-- OIcon registry name (kebab-case SVG icon) -->
          <OIcon
            v-else-if="icon && isOIcon"
            :name="(icon as any)"
            size="sm"
            class="o-tab__icon tw:shrink-0"
          />
          <!-- Fallback: Material icon font glyph (Quasar-compat underscore names) -->
          <span
            v-else-if="icon"
            class="o-tab__icon tw:text-base tw:leading-none tw:shrink-0 material-icons-outlined"
          >{{ icon }}</span>
        </slot>
        <span v-if="label" class="o-tab__label tw:truncate">{{ label }}</span>
      </template>
      <slot v-else />
    </TabsTrigger>
    <OTooltip v-if="tooltip" :content="tooltip" />
  </span>
</template>
