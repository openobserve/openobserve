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
  <div
    class="flex justify-between items-center cursor-pointer span-block relative-position"
    :style="{
      width: '100%',
      height: spanDimensions.height + 'px',
    }"
    :class="!isSpanSelected ? 'defocus' : ''"
    ref="spanBlock"
    @click="selectSpan"
  >
    <div
      :style="{
        width: '100%',
        overflow: 'hidden',
      }"
      class="cursor-pointer flex items-center no-wrap position-relative"
      :class="!isSpanSelected ? 'defocus' : ''"
      @click="selectSpan"
    >
      <div
        :style="{
          width: getWidth + '%',
          height: spanDimensions.barHeight + 'px',
          borderRadius: '2px',
          left: getLeftPosition + '%',
          position: 'relative',
          backgroundColor: span.style?.color || '#58508d',
          zIndex: 1,
        }"
      />
      <div
        :style="{
          position: 'absolute',
          ...getDurationStyle,
          transition: 'all 0.5s ease',
          zIndex: 1,
        }"
        class="text-caption"
      >
        {{ formatTimeWithSuffix(span.durationUs) }}
      </div>
      <q-resize-observer debounce="300" @resize="onResize" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import useTraces from "@/composables/useTraces";
import { getImageURL, formatTimeWithSuffix } from "@/utils/zincutils";

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
    const spanBlock: any = ref(null);
    const spanBlockWidth = ref(0);
    const onePixelPercent = ref(0);
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
    const getLeftPosition = computed(() => {
      const left =
        props.span.startTimeMs - props.baseTracePosition["startTimeMs"];

      // if (props.span.startTimeMs < props.baseTracePosition["startTimeMs"]) {
      //   props.baseTracePosition + props.baseTracePosition["durationMs"];
      //   console.log(left);
      // }
      //   return 0;
      // console.log(
      //   props.span.startTimeMs,
      //   props.baseTracePosition["startTimeMs"],
      //   left,
      //   props.baseTracePosition?.durationMs
      // );
      return (left / props.baseTracePosition?.durationMs) * 100;
    });
    const getWidth = computed(() => {
      return Number(
        (
          (props.span?.durationMs / props.baseTracePosition?.durationMs) *
          100
        ).toFixed(2)
      );
    });
    const getDurationStyle = computed(() => {
      const style: any = {
        top: "2px",
      };
      const onePercent = Number((spanBlockWidth.value / 100).toFixed(2));
      const labelWidth = 60;
      if (
        (getLeftPosition.value + getWidth.value) * onePercent + labelWidth >
        spanBlockWidth.value
      ) {
        style.right = 0;
        style.top = "-8px";
      } else if (getLeftPosition.value > 50) {
        style.left = getLeftPosition.value * onePercent - labelWidth + "px";
      } else {
        style.left =
          (getLeftPosition.value + getWidth.value) * onePercent + 10 + "px";
      }
      return style;
    });

    const onResize = () => {
      spanBlockWidth.value = spanBlock.value.clientWidth;
    };

    return {
      formatTimeWithSuffix,
      selectSpan,
      isSpanSelected,
      toggleSpanCollapse,
      getImageURL,
      getLeftPosition,
      getWidth,
      getDurationStyle,
      spanBlock,
      onResize,
      onePixelPercent,
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
