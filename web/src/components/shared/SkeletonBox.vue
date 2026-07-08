<template>
  <div
    class="skeleton-box bg-skeleton-base relative overflow-hidden rounded"
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
    case 'text':    return 'rounded-[3px]'
    case 'title':   return 'rounded'
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

<style>
/* Flat base colour + sliding ::after overlay.
   The base is always solid (no moving gradient), the shimmer is a separate
   translucent gloss that physically slides left→right via translateX.
   ease-in-out on translateX is intentional — it mimics real light reflection. */
.skeleton-box::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent       0%,
    transparent      30%,
    var(--color-skeleton-shimmer, rgba(255, 255, 255, 0.8)) 50%,
    transparent      70%,
    transparent     100%
  );
  animation: skeleton-shimmer 1.8s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
