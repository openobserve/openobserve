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
/* Base Skeleton Animation */
.skeleton-box {
  background: linear-gradient(90deg, 
    transparent, 
    rgba(255, 255, 255, 0.15), 
    transparent
  );
  background-size: 200% 100%;
  animation: skeleton-wave 1.5s ease-in-out infinite;
  position: relative;
  overflow: hidden;
  border-radius: 4px;
}

/* Theme-based skeleton colors */
:deep(.dark-stream-container) .skeleton-box,
:deep(.dark-tile-content) .skeleton-box,
:deep(.chart-container-dark) .skeleton-box,
:deep(.o2-quasar-table-dark) .skeleton-box {
  background: linear-gradient(90deg, 
    rgba(255, 255, 255, 0.02), 
    rgba(255, 255, 255, 0.08), 
    rgba(255, 255, 255, 0.02)
  );
  background-size: 200% 100%;
}

:deep(.light-stream-container) .skeleton-box,
:deep(.light-tile-content) .skeleton-box,
:deep(.chart-container-light) .skeleton-box,
:deep(.o2-quasar-table-light) .skeleton-box {
  background: linear-gradient(90deg, 
    rgba(0, 0, 0, 0.02), 
    rgba(0, 0, 0, 0.08), 
    rgba(0, 0, 0, 0.02)
  );
  background-size: 200% 100%;
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

/* Wave animation */
@keyframes skeleton-wave {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
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