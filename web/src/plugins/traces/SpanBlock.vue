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
    class="flex justify-between align-center cursor-pointer span-block"
    :style="{
      top: styleObj.top,
      position: styleObj.position,
      height: spanDimensions.height + 'px',
      width: '100%',
    }"
    :class="!isSpanSelected ? 'defocus' : ''"
    @click="selectSpan"
  >
    <div :style="{ position: 'relative', width: '100%', overflow: 'hidden' }">
      <div
        class="flex items-center justify-between"
        :style="{
          paddingLeft: styleObj.left,
          height: spanDimensions.textHeight + 'px',
        }"
      >
        <template v-for="depth in span.depth" :key="depth">
          <div
            class="vertical-connector light-grey"
            :style="{
              left: `${
                spanDimensions.gap * depth -
                (spanDimensions.gap - spanDimensions.collapseWidth / 2)
              }px`,
              top: '0',
              position: 'absolute',
              width: '1px',
              height: '60px',
            }"
          />
        </template>
        <div
          class="horizontal-connector light-grey"
          :style="{
            left: `${
              parseInt(styleObj.left) -
              (spanDimensions.gap - spanDimensions.collapseWidth / 2)
            }px`,
            top: spanDimensions.textHeight / 2 + 'px',
            position: 'absolute',
            width: spanDimensions.gap - spanDimensions.collapseWidth / 2 + 'px',
            height: '1px',
          }"
        ></div>
        <div
          class="dot-connector"
          :style="{
            left: `${
              parseInt(styleObj.left) -
              (spanDimensions.gap - spanDimensions.collapseWidth / 2) -
              spanDimensions.dotConnectorWidth / 2
            }px`,
            top:
              spanDimensions.textHeight / 2 -
              spanDimensions.dotConnectorHeight / 2 +
              'px',
            position: 'absolute',
            width: spanDimensions.dotConnectorWidth + 'px',
            height: spanDimensions.dotConnectorHeight + 'px',
            backgroundColor: '#c2c2c2',
          }"
        ></div>
        <div
          v-if="span.hasChildSpans && isCollapsed"
          class="vertical-connector light-grey"
          :style="{
            left: `${
              parseInt(styleObj.left) + spanDimensions.collapseWidth / 2
            }px`,
            top:
              spanDimensions.textHeight / 2 +
              spanDimensions.collapseHeight / 2 +
              'px',
            position: 'absolute',
            width: '1px',
            height: '40px',
          }"
        ></div>
        <div class="flex items-center justify-start">
          <div
            v-if="span.hasChildSpans"
            :style="{
              width: spanDimensions.collapseWidth + 'px',
              height: spanDimensions.collapseHeight + 'px',
            }"
            class="flex justify-center items-center collapse-container"
            @click.stop="toggleSpanCollapse"
          >
            <q-icon
              dense
              round
              flat
              :name="'img:' + getImageURL('images/common/down-solid.svg')"
              class="collapse-btn"
              :style="{ rotate: isCollapsed ? '0deg' : '270deg' }"
            />
          </div>
          <div class="text-blue-grey-6" :style="{ paddingLeft: '4px' }">
            {{ span.operationName }}
          </div>
        </div>
        <div class="text-blue-grey-6">
          {{ formatTimeWithSuffix(span.durationMs) }}
        </div>
      </div>
      <div
        :style="{
          width: '100%',
          backgroundColor: '#f8f8f8',
          position: 'absolute',
          bottom: '0',
        }"
        class="cursor-pointer"
        :class="!isSpanSelected ? 'defocus' : ''"
        @click="selectSpan"
      >
        <div
          :class="`bg-${span?.style?.color}`"
          :style="{
            width:
              (span?.durationMs / baseTracePosition?.durationMs) * 100 + '%',
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
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import useTraces from "@/composables/useTraces";
import { emit } from "process";
import { getImageURL } from "@/utils/zincutils";

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
    showCollapse: {
      type: Boolean,
      default: true,
    },
    isCollapsed: {
      type: Boolean,
      default: false,
    },
    spanDimensions: {
      type: Object,
      default: () => {},
    },
  },
  emits: ["toggleCollapse"],
  setup(props, { emit }) {
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
    const toggleSpanCollapse = () => {
      emit("toggleCollapse", props.span.spanId);
    };
    return {
      formatTimeWithSuffix,
      selectSpan,
      isSpanSelected,
      toggleSpanCollapse,
      getImageURL,
    };
  },
});
</script>

<style scoped lang="scss">
.defocus {
  opacity: 0.3;
}

.collapse-btn {
  background-color: #ffffff;
  opacity: 0.4;
}

.collapse-container {
  border: 1px solid #ececec;
}

.light-grey {
  background-color: #ececec;
}
</style>
