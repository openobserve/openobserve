<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="flex wrap justify-start items-center bg-surface-base"
    :class="defocusSpan ? 'opacity-30' : ''"
    :style="{
      zIndex: 2,
    }"
    :id="span.spanId"
    data-test="span-block-container"
  >
    <div
      class="flex justify-between items-end cursor-pointer span-block relative-position bg-surface-base w-full pb-1.5"
      :style="{
        height: spanDimensions.height + 'px',
      }"
      ref="spanBlock"
      @click="selectSpan(span.spanId)"
      @mouseover="onSpanHover"
      data-test="span-block"
    >
      <div
        class="cursor-pointer flex items-center flex-nowrap position-relative w-full overflow-hidden"
        :class="defocusSpan ? 'opacity-30' : ''"
        @click="selectSpan(span.spanId)"
        data-test="span-block-select-trigger"
      >
        <div
          :style="{
            height: spanDimensions.barHeight + 'px',
            width: spanWidth + '%',
            left: leftPosition + '%',
          }"
          class="flex justify-start items-center flex-nowrap relative"
          ref="spanMarkerRef"
          data-test="span-marker"
        >
          <div
            class="w-[calc(100%-0.375rem)] h-full rounded-default"
            :style="{
              backgroundColor: span.style?.color || DEFAULT_SPAN_COLOR,
            }"
          />
        </div>
        <div
          :style="{
            ...durationStyle,
            zIndex: 1,
          }"
          class="text-xs flex items-center absolute transition-all duration-500 ease-[ease]"
          data-test="span-block-duration"
        >
          <div>
            {{ formatTimeWithSuffix(span.durationUs) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import useTraces from "@/composables/useTraces";
import { getImageURL, formatTimeWithSuffix } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

// TODO(design-tokens): fallback bar colour for a span the trace colour allocator
// never assigned. No semantic token fits — it is a categorical "unassigned span"
// slate-purple, not a status/surface/accent role. Needs e.g.
// --color-trace-span-unassigned; this const is then the only site to change.
const DEFAULT_SPAN_COLOR = "#58508d";

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
    spanData: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["toggleCollapse", "selectSpan", "hover", "view-logs"],
  setup(props, { emit }) {
    const store = useStore();
    const { searchObj } = useTraces();
    const spanBlock: any = ref(null);
    const spanBlockWidth = ref(0);
    let _resizeObserver: ResizeObserver | null = null;
    let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onePixelPercent = ref(0);
    const defocusSpan = computed(() => {
      if (!searchObj.data.traceDetails.selectedSpanId) return false;
      return searchObj.data.traceDetails.selectedSpanId !== props.span.spanId;
    });

    const durationStyle = ref({});
    const { t } = useI18n();

    const leftPosition = ref(0);

    const spanWidth = ref(0);

    const selectSpan = (spanId: string) => {
      emit("selectSpan", spanId);
    };

    const spanMarkerRef = ref(null);

    const getLeftPosition = () => {
      const left = props.span.startTimeUs - props.baseTracePosition["startTimeUs"];

      return (left / props.baseTracePosition?.durationUs) * 100;
    };

    const getSpanWidth = () => {
      return Number(
        ((props.span?.durationUs / props.baseTracePosition?.durationUs) * 100).toFixed(2),
      );
    };

    onMounted(async () => {
      durationStyle.value = getDurationStyle();

      // NOTE: do NOT scroll the pre-selected span into view here. Rows are
      // virtualized, so a SpanBlock remounts every time it scrolls into the
      // viewport — doing scrollIntoView on each mount snapped the view back to
      // the URL's span_id and fought the user's scroll. Centering the
      // pre-selected span is owned by TraceTree (virtualizer scrollToIndex).

      if (spanBlock.value) {
        _resizeObserver = new ResizeObserver(() => {
          if (_debounceTimer) clearTimeout(_debounceTimer);
          _debounceTimer = setTimeout(() => onResize(), 300);
        });
        _resizeObserver.observe(spanBlock.value);
      }
    });

    watch(
      () => props.span.startTimeUs,
      () => {
        leftPosition.value = getLeftPosition();
      },
      {
        immediate: true,
      },
    );

    watch(
      () => props.baseTracePosition,
      () => {
        leftPosition.value = getLeftPosition();
      },
      {
        immediate: true,
        deep: true,
      },
    );

    watch(
      () => props.span?.durationUs + props.baseTracePosition?.durationUs,
      () => {
        spanWidth.value = getSpanWidth();
      },
      {
        immediate: true,
      },
    );

    watch(
      () => spanBlockWidth.value + leftPosition.value + spanWidth.value,
      () => {
        durationStyle.value = getDurationStyle();
      },
    );

    const getDurationStyle = () => {
      const style: any = {
        top: "10px",
      };

      const onePercent = Number((spanBlockWidth.value / 100).toFixed(2));
      const labelWidth = 60;
      if ((leftPosition.value + spanWidth.value) * onePercent + labelWidth > spanBlockWidth.value) {
        style.right = 0;
        style.top = "-0.3125rem";
      } else if (leftPosition.value > 50) {
        style.left = leftPosition.value * onePercent - labelWidth + "px";
      } else {
        const left = leftPosition.value + (Math.floor(spanWidth.value) ? spanWidth.value : 1);

        style.left =
          (left * onePercent - leftPosition.value * onePercent < 19
            ? leftPosition.value * onePercent + 19
            : left * onePercent) + "px";
      }

      return style;
    };

    const onResize = () => {
      spanBlockWidth.value = spanBlock.value.clientWidth;
    };

    onBeforeUnmount(() => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _resizeObserver?.disconnect();
    });

    const onSpanHover = () => {
      emit("hover");
    };

    return {
      t,
      formatTimeWithSuffix,
      selectSpan,
      getImageURL,
      leftPosition,
      spanWidth,
      getDurationStyle,
      spanBlock,
      onResize,
      onePixelPercent,
      spanMarkerRef,
      defocusSpan,
      store,
      onSpanHover,
      durationStyle,
      searchObj,
      DEFAULT_SPAN_COLOR,
    };
  },
});
</script>
