<template>
  <BaseEdge
    :id="id"
    :style="{ ...style, cursor: 'pointer', strokeDasharray: 'none' }"
    :path="path[0]"
    :marker-end="markerEnd"
    type="smoothstep"
  />
  <EdgeLabelRenderer>
    <!-- Delete button removed - use keyboard delete instead -->
  </EdgeLabelRenderer>
</template>

<script setup>
import { BaseEdge, getBezierPath,EdgeLabelRenderer,useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'


const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  sourceX: {
    type: Number,
    required: true,
  },
  sourceY: {
    type: Number,
    required: true,
  },
  targetX: {
    type: Number,
    required: true,
  },
  targetY: {
    type: Number,
    required: true,
  },
  sourcePosition: {
    type: String,
    required: true,
  },
  targetPosition: {
    type: String,
    required: true,
  },
  data: {
    type: Object,
    required: false,
  },
  markerEnd: {
    type: String,
    required: false,
  },
  style: {
    type: Object,
    required: false,
  },
  isInView: {
    type: Boolean,
    required: false,
    default: false,
  },
})
useVueFlow()

const path = computed(() => getBezierPath(props))

// Edge click handling moved to PipelineFlow.vue using VueFlow events
// These handlers are no longer used but kept for backwards compatibility
</script>

<script>
export default {
  inheritAttrs: false,
}
</script>





