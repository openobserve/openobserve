<template>
  <div
    class="skeleton-box"
    :class="[
      `skeleton-${variant}`,
      rounded && 'skeleton-rounded',
      circle && 'skeleton-circle'
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

<style scoped lang="scss">
/* Flat base colour + sliding ::after overlay.
   The base is always solid (no moving gradient), the shimmer is a separate
   translucent gloss that physically slides left→right via translateX.
   ease-in-out on translateX is intentional — it mimics real light reflection. */
.skeleton-box {
  background-color: var(--color-skeleton-base, #f5f5f5);
  position: relative;
  overflow: hidden;
  border-radius: 4px;
}

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

/* Variant-specific styles */
.skeleton-text {
  border-radius: 3px;
}

.skeleton-title {
  border-radius: 4px;
}

.skeleton-button {
  border-radius: 6px;
}

.skeleton-avatar {
  border-radius: 50%;
}

.skeleton-image {
  border-radius: 8px;
}

/* Shape modifiers */
.skeleton-rounded {
  border-radius: 8px;
}

.skeleton-circle {
  border-radius: 50%;
  aspect-ratio: 1;
}

/* Multiple lines support for text variant */
.skeleton-text.skeleton-multiline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-text.skeleton-multiline::before {
  content: '';
  display: block;
  height: 14px;
  background: inherit;
  border-radius: inherit;
  animation: inherit;
  background-size: inherit;
}

.skeleton-text.skeleton-multiline.skeleton-lines-3::after {
  content: '';
  display: block;
  height: 14px;
  width: 60%;
  background: inherit;
  border-radius: inherit;
  animation: inherit;
  background-size: inherit;
}
</style>