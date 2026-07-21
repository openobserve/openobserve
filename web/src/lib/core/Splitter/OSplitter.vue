<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div
    ref="containerRef"
    :class="[
      'o-splitter',
      horizontal ? 'o-splitter--horizontal' : 'o-splitter--vertical',
      'flex relative',
      horizontal ? 'flex-col' : 'flex-row'
    ]"
  >
    <!-- Before slot -->
    <div
      :class="[
        'o-splitter__before',
        'overflow-hidden shrink-0 relative',
        horizontal ? 'w-full' : 'h-full',
        beforeClass
      ]"
      :style="beforeStyle"
    >
      <slot name="before" />
    </div>

    <!-- Separator -->
    <div
      v-if="separator !== false"
      :class="[
        horizontal ? 'o-splitter__separator--horizontal' : 'o-splitter__separator--vertical',
        'select-none',
        'relative',
        'z-10',
        'focus:outline-2 focus:outline-accent focus:-outline-offset-2',
        disable ? 'cursor-default! opacity-50 pointer-events-none' : '',
        horizontal ? 'h-px w-full cursor-row-resize' : 'h-full cursor-col-resize',
        separatorClass
      ]"
      :style="[separatorStyle]"
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
        'overflow-hidden flex-1 relative z-0 shrink-0',
        horizontal ? 'w-full' : 'h-full'
      ]"
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
  limits: () => [0, 0],
  unit: '%',
  disable: false,
  separator: true,
  separatorClass: '',
  separatorStyle: () => ({}),
  beforeClass: '',
})

const emit = defineEmits<OSplitterEmits>()

const containerRef = ref<HTMLElement | null>(null)

// Determine min/max values from limits prop
const minValue = computed(() => props.limits?.[0] ||  (props.unit ==='%' ? 0 : 0))
const maxValue = computed(() => props.limits?.[1] || (props.unit ==='%' ? 100 : 1000))

// Setup resizer composable with faster throttling for smoother movement
const { value: currentValue, onMouseDown } = useResizer({
  direction: !props.horizontal ? 'horizontal' : 'vertical',
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
    ? { height: size }
    : { width: size }
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
/* keep(complex-state): `.field-list-separator` is a public modifier on
   this component's separator element — it can ONLY arrive through the
   `separatorClass` prop (plugins/logs/Index.vue and
   dashboards/PanelEditor/PanelEditor.vue x2 pass it), so no consumer's scope can
   reach the element and the hover affordance has to be declared here. The ::after
   pseudo-element has no markup of its own to carry utilities. Migrated from
   styles/utilities.css (W2.b). */
.field-list-separator::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 0.125rem;
  background-color: transparent;
  transition: background-color 0.3s;
}

.field-list-separator:hover::after {
  background-color: var(--color-accent);
}
</style>
