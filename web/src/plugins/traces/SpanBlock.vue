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
    class="wrap bg-surface-base flex items-center justify-start"
    :class="defocusSpan ? 'opacity-30' : ''"
    :style="{
      zIndex: 2,
    }"
    :id="span.spanId"
    data-test="span-block-container"
  >
    <div
      class="span-block relative-position bg-surface-base flex w-full cursor-pointer items-end justify-between pb-1.5"
      :style="{
        height: spanDimensions.height + 'px',
      }"
      ref="spanBlock"
      @click="selectSpan(span.spanId)"
      @mouseover="onSpanHover"
      data-test="span-block"
    >
      <div
        class="position-relative flex w-full cursor-pointer flex-nowrap items-center overflow-hidden"
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
          class="relative flex flex-nowrap items-center justify-start"
          ref="spanMarkerRef"
          data-test="span-marker"
        >
          <div
            class="rounded-default h-full w-full"
            :style="{
              backgroundColor: span.style?.color || DEFAULT_SPAN_COLOR,
            }"
          />
        </div>
        <button
          v-for="cluster in eventClusters"
          :key="cluster.key"
          type="button"
          class="ring-surface-base absolute top-1/2 h-1.5 w-0.5 -translate-x-1/2 -translate-y-1/2 p-0 ring-1 before:absolute before:top-1/2 before:left-1/2 before:h-4 before:w-2.5 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
          :class="SEVERITY_MARKER_CLASS[cluster.severity]"
          :style="{
            left: cluster.left + '%',
            zIndex: 3,
          }"
          :title="clusterLabel(cluster)"
          :aria-label="clusterAriaLabel(cluster)"
          :data-event-severity="cluster.severity"
          :data-event-count="cluster.events.length"
          data-test="span-event-marker"
          @click.stop="selectSpanEvent(cluster)"
        />
        <div
          :style="{
            ...durationStyle,
            zIndex: 1,
          }"
          class="absolute flex items-center text-xs transition-all duration-500 ease-[ease]"
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
import { useI18nTyped } from "@/types/i18n";
import {
  useSpanEventMarkers,
  clusterSpanEventMarkers,
  truncateEventName,
  SEVERITY_MARKER_CLASS,
  type SpanEventMarker,
  type SpanEventCluster,
} from "@/composables/traces/useSpanEvents";

// TODO(design-tokens): fallback bar colour for a span the trace colour allocator
// never assigned. No semantic token fits — it is a categorical "unassigned span"
// slate-purple, not a status/surface/accent role. Needs e.g.
// --color-trace-span-unassigned; this const is then the only site to change.
const DEFAULT_SPAN_COLOR = "#58508d";

/**
 * Gap, in pixels, between the bar's right edge and its duration label.
 *
 * This used to be subtracted from the bar fill's own width
 * (`calc(100% - 6px)`) — originally `21px`, reserving room for an inline
 * expand chevron that was removed in Oct 2024. Subtracting it from the fill
 * made every bar render 6px shorter than the span it represents and clamped
 * sub-6px spans to zero width. It belongs to the label, not the bar.
 */
const BAR_LABEL_GUTTER_PX = 6;

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
  emits: ["toggleCollapse", "selectSpan", "hover", "view-logs", "selectSpanEvent"],
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
    const { t } = useI18nTyped();

    const leftPosition = ref(0);

    const spanWidth = ref(0);

    const selectSpan = (spanId: string) => {
      emit("selectSpan", spanId);
    };

    /**
     * Selecting a span hides the waterfall timeline entirely — only the
     * operation-name tree remains — so a marker click destroys the view the
     * marker lived in. Carry the event index along so the sidebar can
     * re-establish the same picture on its own mini-timeline.
     */
    const selectSpanEvent = (cluster: SpanEventCluster) => {
      emit("selectSpan", props.span.spanId);
      emit("selectSpanEvent", {
        spanId: props.span.spanId,
        eventIndex: cluster.events[0].index,
      });
    };

    // Span events are plotted against the whole trace, matching the coordinate
    // space the span bar and duration label already use.
    const eventMarkers = useSpanEventMarkers(
      () => props.spanData?.events,
      () => ({
        startUs: props.baseTracePosition?.startTimeUs,
        durationUs: props.baseTracePosition?.durationUs,
      }),
      () => store.state.zoConfig?.timestamp_column,
    );

    const eventMarkerLabel = (marker: SpanEventMarker) =>
      marker.severity === "error"
        ? t("traces.exceptionMarkerTooltip", { type: truncateEventName(marker.exceptionType) })
        : t("traces.eventMarkerTooltip", {
            name: truncateEventName(marker.name) || t("traces.spanEventFallback"),
          });

    // Clusters re-derive whenever the row is resized, so the bucket width
    // tracks the timeline the user is actually looking at.
    const eventClusters = computed(() =>
      clusterSpanEventMarkers(eventMarkers.value, spanBlockWidth.value),
    );

    const clusterLabel = (cluster: SpanEventCluster) =>
      cluster.events.length > 1
        ? t("traces.eventClusterTooltip", { count: cluster.events.length })
        : eventMarkerLabel(cluster.events[0]);

    const clusterAriaLabel = (cluster: SpanEventCluster) => {
      if (cluster.events.length === 1) return eventMarkerLabel(cluster.events[0]);
      const errors = cluster.events.filter((event) => event.severity === "error").length;
      const count = cluster.events.length;
      return errors === 1
        ? t("traces.eventClusterAriaLabel", { count, errors })
        : t("traces.eventClusterAriaLabelPlural", { count, errors });
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
        top: "0.625rem",
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
            : left * onePercent + BAR_LABEL_GUTTER_PX) + "px";
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
      selectSpanEvent,
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
      eventClusters,
      clusterLabel,
      clusterAriaLabel,
      SEVERITY_MARKER_CLASS,
    };
  },
});
</script>
