<script setup>
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'
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
  markerEnd: {
    type: String,
    required: false,
  },
  style: {
    type: Object,
    required: false,
  },
})

const { removeEdges, getSelectedEdges, addSelectedEdges, removeSelectedEdges } = useVueFlow()

const path = computed(() => getBezierPath(props))

let clickTimeout = null

// Edge click handling moved to PipelineFlow.vue using VueFlow events
// These handlers are no longer used but kept for backwards compatibility
</script>

<script>
export default {
  inheritAttrs: false,
}
</script>

<template>
  <!-- You can use the `BaseEdge` component to create your own custom edge more easily -->
  <BaseEdge 
    :id="id" 
    :style="{ ...style, cursor: 'pointer', strokeDasharray: 'none' }" 
    :path="path[0]" 
    :marker-end="markerEnd"
  />

  <!-- Use the `EdgeLabelRenderer` to escape the SVG world of edges and render your own custom label in a `<div>` ctx -->
  <EdgeLabelRenderer>
    <!-- Edge delete button removed - use keyboard delete instead -->
  </EdgeLabelRenderer>
</template>

<style scoped lang="scss">
/* Edge button styles removed - using keyboard deletion instead */
</style>
