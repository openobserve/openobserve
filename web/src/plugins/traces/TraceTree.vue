<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <div class="q-pl-xs q-pt-sm">
    <template v-for="span in spans as any[]" :key="span.spanId">
      <div :style="{ position: 'relative', width: '100%', overflow: 'hidden' }">
        <div
          :style="{
            height: spanDimensions.textHeight - 8 + 'px',
            margin: `4px 0px 4px ${
              span.hasChildSpans
                ? span.style.left
                : parseInt(span.style.left) +
                  spanDimensions.collapseWidth +
                  'px'
            }`,
          }"
          class="flex items-center no-wrap justify-start ellipsis"
          :title="span.operationName"
        >
          <div
            v-if="span.hasChildSpans"
            :style="{
              width: spanDimensions.collapseWidth + 'px',
              height: spanDimensions.collapseHeight + 'px',
            }"
            class="flex justify-center items-center collapse-container cursor-pointer"
            @click.stop="toggleSpanCollapse(span.spanId)"
          >
            <q-icon
              dense
              round
              flat
              name="expand_more"
              class="collapse-btn"
              :style="{
                rotate: collapseMapping[span.spanId] ? '0deg' : '270deg',
              }"
            />
          </div>
          <div
            class=" ellipsis q-ml-xs"
            :style="{
              paddingLeft: '4px',
              borderLeft: `3px solid ${span.style.color}`,
            }"
          >
            {{ span.operationName }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { getImageURL } from "@/utils/zincutils";
import { computed } from "vue";

export default defineComponent({
  name: "TraceTree",
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
    function formatTimeWithSuffix(ns: number) {
      if (ns < 10000) {
        return `${ns} ms`;
      } else {
        return `${(ns / 1000).toFixed(2)} s`;
      }
    }
    function toggleSpanCollapse(spanId: number | string) {
      emit("toggleCollapse", spanId);
    }

    return {
      formatTimeWithSuffix,
      toggleSpanCollapse,
      getImageURL,
    };
  },
});
</script>

<style scoped lang="scss">
.spans-container {
  position: relative;
}

.collapse-btn {
  width: 10px;
  height: 10px;
}
</style>
