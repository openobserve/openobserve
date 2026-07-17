<template>
  <div
    class="skeleton-box bg-skeleton-base relative overflow-hidden rounded-sm after:content-[''] after:absolute after:inset-0 after:[background:linear-gradient(90deg,transparent_0%,transparent_30%,var(--color-skeleton-shimmer)_50%,transparent_70%,transparent_100%)] after:[animation:o2-skeleton-shimmer_1.8s_ease-in-out_infinite]"
    :class="[
      variantClass,
      rounded && 'rounded-lg',
      circle && 'rounded-full aspect-square'
    ]"
    :style="{
      width: width,
      height: height,
      borderRadius: customRadius
    }"
  ></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from 'vuex'

interface Props {
  // Size props
  width?: string
  height?: string

  // Variant presets
  variant?: 'text' | 'title' | 'button' | 'avatar' | 'image' | 'custom'

  // Shape props
  rounded?: boolean
  circle?: boolean
  customRadius?: string

  // Text-specific props (when variant is 'text')
  lines?: number
}

const props = withDefaults(defineProps<Props>(), {
  width: '100px',
  height: '16px',
  variant: 'custom',
  rounded: false,
  circle: false,
  lines: 1
})

const store = useStore()

const variantClass = computed(() => {
  switch (props.variant) {
    case 'text':    return 'rounded-sm'
    case 'title':   return 'rounded-sm'
    case 'button':  return 'rounded-md'
    case 'avatar':  return 'rounded-full'
    case 'image':   return 'rounded-lg'
    default:        return ''
  }
})

// Computed styles based on variant
const computedWidth = computed(() => {
  switch (props.variant) {
    case 'text':
      return props.width
    case 'title':
      return props.width || '200px'
    case 'button':
      return props.width || '80px'
    case 'avatar':
      return props.width || '40px'
    case 'image':
      return props.width || '100px'
    default:
      return props.width
  }
})

const computedHeight = computed(() => {
  switch (props.variant) {
    case 'text':
      return props.height || '14px'
    case 'title':
      return props.height || '24px'
    case 'button':
      return props.height || '32px'
    case 'avatar':
      return props.height || '40px'
    case 'image':
      return props.height || '100px'
    default:
      return props.height
  }
})
</script>
