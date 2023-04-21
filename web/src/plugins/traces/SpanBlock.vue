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
  <div
    class="flex justify-between align-center q-pb-xs cursor-pointer span-block"
    :style="styleObj"
    :class="!isSpanSelected ? 'defocus' : ''"
    @click="selectSpan"
  >
    <div class="text-bold">{{ span.operationName }}</div>
    <div>{{ formatTimeWithSuffix(span.durationMs) }}</div>
  </div>
  <div
    :style="{ width: '100%', backgroundColor: '#ececec' }"
    class="q-mb-md cursor-pointer"
    :class="!isSpanSelected ? 'defocus' : ''"
    @click="selectSpan"
  >
    <div
      :style="{
        width: (span?.durationMs / baseTracePosition?.durationMs) * 100 + '%',
        backgroundColor: '#6c83ee',
        height: '10px',
        borderRadius: '2px',
        left:
          ((span.startTimeMs - baseTracePosition['startTimeMs']) /
            baseTracePosition?.durationMs) *
            100 +
          '%',
        position: 'relative',
      }"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import useTraces from "@/composables/useTraces";

export default defineComponent({
  name: "SpanBlock",
  props: {
    span: {
      type: Object,
      default: () => null,
    },
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    depth: {
      type: Number,
      default: 0,
    },
    styleObj: {
      type: Object,
      default: () => {},
    },
  },
  setup(props) {
    const { searchObj } = useTraces();
    function formatTimeWithSuffix(ns: number) {
      if (ns < 10000) {
        return `${ns} ms`;
      } else {
        return `${(ns / 1000).toFixed(2)} s`;
      }
    }
    const isSpanSelected = computed(() => {
      if (!searchObj.data.traceDetails.selectedSpanId) return true;
      return searchObj.data.traceDetails.selectedSpanId === props.span.spanId;
    });
    const selectSpan = () => {
      searchObj.data.traceDetails.showSpanDetails = true;
      searchObj.data.traceDetails.selectedSpanId = props.span.spanId;
    };
    return {
      formatTimeWithSuffix,
      selectSpan,
      isSpanSelected,
    };
  },
});
</script>

<style scoped lang="scss">
.defocus {
  opacity: 0.3;
}
</style>
