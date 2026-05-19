<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div
    ref="containerRef"
    :class="[
      'o-splitter',
      horizontal ? 'o-splitter--horizontal' : 'o-splitter--vertical',
      'tw:flex',
      horizontal ? 'tw:flex-row' : 'tw:flex-col'
    ]"
  >
    <!-- Before slot -->
    <div
      :class="[
        'o-splitter__before',
        'tw:overflow-hidden',
        horizontal ? 'tw:h-full' : 'tw:w-full'
      ]"
      :style="beforeStyle"
    >
      <slot name="before" />
    </div>

    <!-- Separator -->
    <div
      v-if="separator !== false"
      :class="[
        'o-splitter__separator',
        horizontal ? 'o-splitter__separator--horizontal' : 'o-splitter__separator--vertical',
        'tw:select-none',
        'tw:transition-colors',
        'hover:tw:bg-[var(--o2-border-input)]',
        'tw:absolute',
        'tw:z-10',
        disable ? 'tw:cursor-not-allowed tw:opacity-50' : '',
        horizontal ? 'tw:w-[4px] tw:h-full tw:cursor-col-resize!' : 'tw:h-[4px] tw:w-full tw:cursor-row-resize!',
        separatorClass
      ]"
      :style="[separatorStyle, separatorPosition]"
      :tabindex="disable ? -1 : 0"
      @mousedown="!disable && onMouseDown($event)"
      @keydown="!disable && handleKeyDown($event)"
      role="separator"
      :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
      :aria-label="`${horizontal ? 'Horizontal' : 'Vertical'} splitter`"
      :aria-valuenow="modelValue"
      :aria-valuemin="limits?.[0] || 0"
      :aria-valuemax="limits?.[1] || 100"
    >
      <slot name="separator" />
    </div>

    <!-- After slot -->
    <div
      :class="[
        'o-splitter__after',
        'tw:overflow-hidden',
        horizontal ? 'tw:h-full' : 'tw:w-full'
      ]"
      :style="afterStyle"
    >
      <slot name="after" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import useResizer from '@/composables/useResizer'
import type { OSplitterProps, OSplitterEmits } from './OSplitter.types'

const props = withDefaults(defineProps<OSplitterProps>(), {
  horizontal: false,
  limits: () => [0, 100],
  unit: '%',
  disable: false,
  separator: true,
  separatorClass: '',
  separatorStyle: () => ({})
})

const emit = defineEmits<OSplitterEmits>()

const containerRef = ref<HTMLElement | null>(null)

// Determine min/max values from limits prop
const minValue = computed(() => props.limits?.[0] || 0)
const maxValue = computed(() => props.limits?.[1] || 100)

// Setup resizer composable with faster throttling for smoother movement
const { value: currentValue, isResizing, onMouseDown } = useResizer({
  direction: props.horizontal ? 'horizontal' : 'vertical',
  initialValue: props.modelValue,
  minValue: minValue.value,
  maxValue: maxValue.value,
  unit: props.unit,
  containerRef,
  throttleMs: 16, // 60fps for smooth movement
  invert: false, // For horizontal splitters, invert the direction
  onResize: (newValue: number) => {
    emit('update:modelValue', newValue)
  }
})

// Computed styles for before/after sections
const beforeStyle = computed(() => {
  const size = `${currentValue.value}${props.unit}`
  return props.horizontal
    ? { width: size }
    : { height: size }
})

const afterStyle = computed(() => {
  const remainingSize = props.unit === '%'
    ? `${100 - currentValue.value}%`
    : `calc(100% - ${currentValue.value}px)`

  return props.horizontal
    ? { width: remainingSize }
    : { height: remainingSize }
})

// Separator absolute positioning
const separatorPosition = computed(() => {
  const position = `${currentValue.value}${props.unit}`
  return props.horizontal
    ? { left: position, top: '0' }
    : { top: position, left: '0' }
})

// Keyboard navigation support
const handleKeyDown = (event: KeyboardEvent) => {
  if (props.disable) return

  const step = props.unit === '%' ? 5 : 20 // 5% or 20px steps
  let newValue = currentValue.value

  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      newValue = Math.max(minValue.value, currentValue.value - step)
      break
    case 'ArrowDown':
    case 'ArrowRight':
      newValue = Math.min(maxValue.value, currentValue.value + step)
      break
    case 'Home':
      newValue = minValue.value
      break
    case 'End':
      newValue = maxValue.value
      break
    default:
      return
  }

  event.preventDefault()
  emit('update:modelValue', newValue)
  nextTick(() => {
    currentValue.value = newValue
  })
}

// Watch for external prop changes
import { watch } from 'vue'
watch(() => props.modelValue, (newValue) => {
  currentValue.value = newValue
}, { immediate: true })
</script>

<style scoped>
.o-splitter {
  position: relative;
}

.o-splitter__separator {
  flex-shrink: 0;
}

.o-splitter__separator:focus {
  outline: 2px solid var(--o2-primary-color);
  outline-offset: -2px;
}

.o-splitter__before,
.o-splitter__after {
  flex-shrink: 0;
  position: relative;
}

/* Global styles for body when resizing */
:global(.no-select) {
  user-select: none !important;
}
</style>