<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { provide } from "vue";
import OJsonViewerNode from "./OJsonViewerNode.vue";
import {
  JSON_VIEWER_CONTEXT,
  type JsonViewerEmits,
  type JsonViewerProps,
} from "./OJsonViewer.types";

const props = withDefaults(defineProps<JsonViewerProps>(), {
  expandDepth: 2,
  onInclude: undefined,
  onExclude: undefined,
  dataTest: "o2-json-viewer",
});

const emit = defineEmits<JsonViewerEmits>();

provide(JSON_VIEWER_CONTEXT, {
  get expandDepth() {
    return props.expandDepth;
  },
  get dataTest() {
    return props.dataTest;
  },
  get include() {
    return props.onInclude;
  },
  get exclude() {
    return props.onExclude;
  },
  copied: (path, value) => emit("copy", path, value),
});
</script>

<template>
  <div class="min-w-0 py-1 font-mono text-xs" role="tree" :data-test="dataTest">
    <OJsonViewerNode :name="null" :value="value" path="" :depth="0" last />
  </div>
</template>
