<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="relative-position q-pt-sm" :style="{ height: '100%' }">
    <template v-if="spans?.length">
      <template v-for="span in spans as any[]" :key="span.spanId">
        <span-block
          :span="span"
          :depth="depth"
          :baseTracePosition="baseTracePosition"
          :styleObj="{
            position: 'absolute',
            top: span.style.top,
            left: span.style.left,
            height: '60px',
          }"
          :spanDimensions="spanDimensions"
          :isCollapsed="collapseMapping[span.spanId]"
          @toggle-collapse="toggleSpanCollapse"
        />
      </template>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SpanBlock from "./SpanBlock.vue";

export default defineComponent({
  name: "SpanRenderer",
  props: {
    spans: {
      type: Array,
      default: () => [],
    },
    isCollapsed: {
      type: Boolean,
      default: false,
    },
    collapseMapping: {
      type: Object,
      default: () => {},
    },
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    depth: {
      type: Number,
      default: 0,
    },
    spanDimensions: {
      type: Object,
      default: () => {},
    },
  },
  emits: ["toggleCollapse"],
  setup(props, { emit }) {
    function formatTimeWithSuffix(us: number) {
      if (us >= 1000 * 1000) {
        return `${(us / 1000 / 1000).toFixed(2)}s`;
      }
      return `${(us / 1000).toFixed(2)}ms`;
    }
    function toggleSpanCollapse(spanId: number | string) {
      emit("toggleCollapse", spanId);
    }

    return {
      formatTimeWithSuffix,
      toggleSpanCollapse,
    };
  },
  components: { SpanBlock },
});
</script>

<style scoped lang="scss">
.spans-container {
  position: relative;
}
</style>
