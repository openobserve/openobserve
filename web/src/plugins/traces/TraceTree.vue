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
  <div v-bind="$attrs" :style="isSidebarOpen && { width: leftWidth + 'px' }">
    <!-- Virtualizer outer: sets the full scrollable height -->
    <div :style="{ position: 'relative', height: totalSize + 'px', width: '100%' }">
      <div
        v-for="virtualRow in virtualRows"
        :key="getVirtualRowKey(virtualRow)"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`,
          height: (spanDimensions?.height ?? 30) + 'px',
        }"
      >
        <!-- CSS tree connector lines (no DOM queries needed — derived from span.depth) -->
        <template v-if="(spans as any[])[virtualRow.index]?.depth > 0">
          <!-- Vertical segment at the parent badge column -->
          <template
            v-for="depth in (spans as any[])[virtualRow.index]?.depth"
            :key="virtualRow.key + depth"
          >
            <div
              v-if="
                depth === 1 ||
                ancestorSiblingMap.get(
                  `${virtualRow.index}-${(spans as any[])[virtualRow.index]?.depth - depth + 1}`,
                )
              "
              data-test="vertical-segment"
              :data-left="parseInt((spans as any[])[virtualRow.index].style.left)"
              :data-depth="depth"
              class="border-card-glass-border pointer-events-none absolute top-0 z-1 border-l"
              :style="{
                left:
                  parseInt((spans as any[])[virtualRow.index].style.left) -
                  (spanDimensions?.gap ?? 15) * (depth - 1) +
                  'px',
                height: nextSiblingMap[virtualRow.index as number]
                  ? spanDimensions.height + 'px'
                  : depth === 1
                    ? spanDimensions.height / 2 + 'px'
                    : spanDimensions.height + 'px',
              }"
            />
          </template>
          <!-- Horizontal stub from parent column to this badge -->
          <div
            data-test="horizontal-segment"
            class="border-card-glass-border pointer-events-none absolute top-1/2 z-1 border-t"
            :style="{
              left: parseInt((spans as any[])[virtualRow.index].style.left) + 'px',
              width: (spans as any[])[virtualRow.index].hasChildSpans
                ? (spanDimensions?.gap ?? 15) / 2 + 'px'
                : (spanDimensions?.gap ?? 15) + 5 + 'px',
            }"
          />
        </template>

        <!-- Span row -->
        <div
          :style="{
            position: 'relative',
            width: '100%',
            flexWrap: 'nowrap',
            height: '100%',
          }"
          class="span-row relative flex min-h-7.5"
          :class="{
            'span-row-selected': (spans as any[])[virtualRow.index].spanId === highlightedSpanId,
          }"
          @mouseleave="onUnhoverSpan"
          :data-test="`trace-tree-span-container-${(spans as any[])[virtualRow.index].spanId}`"
        >
          <div :style="{ width: leftWidth + 'px' }" class="pl-1.5">
            <div
              :style="{
                height: '100%',
                margin: `0 0 0 ${
                  (spans as any[])[virtualRow.index].hasChildSpans
                    ? (spans as any[])[virtualRow.index].style.left
                    : parseInt((spans as any[])[virtualRow.index].style.left) +
                      spanDimensions.collapseWidth +
                      'px'
                }`,
              }"
              class="flex flex-col items-start justify-start truncate"
              :title="(spans as any[])[virtualRow.index].operationName"
            >
              <div
                class="relative-position operation-name-container bg-surface-base flex h-7.5 w-full cursor-pointer flex-nowrap items-center overflow-visible"
                :data-test="`trace-tree-span-operation-name-container-${(spans as any[])[virtualRow.index].spanId}`"
                @click="selectSpan((spans as any[])[virtualRow.index].spanId)"
                @mouseenter="onHoverSpan((spans as any[])[virtualRow.index].spanId)"
              >
                <div
                  v-if="(spans as any[])[virtualRow.index].hasChildSpans"
                  class="span-count-box text-2xs border-card-glass-border! hover:bg-interactive-hover-bg relative mr-1 flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full border px-1 py-0 font-semibold transition-colors duration-200"
                  :style="{
                    color: (spans as any[])[virtualRow.index].style.color,
                  }"
                  @click.stop="toggleSpanCollapse((spans as any[])[virtualRow.index].spanId)"
                  :data-test="`trace-tree-span-badge-collapse-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  :title="
                    collapseMapping[(spans as any[])[virtualRow.index].spanId]
                      ? t('traces.traceTree.clickToExpand')
                      : t('traces.traceTree.clickToCollapse')
                  "
                >
                  {{ getChildCount((spans as any[])[virtualRow.index]) }}
                  <div
                    v-if="collapseMapping[(spans as any[])[virtualRow.index].spanId]"
                    data-test="vertical-segment"
                    class="border-card-glass-border pointer-events-none absolute -bottom-1.5 left-2 z-1 h-1.25 border-l"
                  />
                </div>

                <div
                  v-else
                  class="mr-1 h-1.5 w-1.5 shrink-0 self-center rounded-full"
                  :style="{
                    backgroundColor: (spans as any[])[virtualRow.index].style.color,
                  }"
                ></div>

                <div
                  class="flex justify-between"
                  :class="
                    (spans as any[])[virtualRow.index].hasChildSpans
                      ? 'w-full'
                      : 'w-[calc(100%-0.6rem)]!'
                  "
                >
                  <div
                    class="w-[calc(100%-2rem)]! cursor-pointer truncate pl-1"
                    :class="
                      isLLMTrace((spans as any[])[virtualRow.index])
                        ? 'flex-col items-start'
                        : 'flex items-center'
                    "
                    :data-test="`trace-tree-span-select-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  >
                    <div class="span-name-section-content flex items-center truncate">
                      <OIcon
                        v-if="(spans as any[])[virtualRow.index].spanStatus === 'ERROR'"
                        name="error"
                        size="sm"
                        class="text-status-error-text! mr-1"
                        :title="t('traces.traceTree.errorSpan')"
                        :data-test="`trace-tree-span-error-icon-${(spans as any[])[virtualRow.index].spanId}`"
                      />
                      <span
                        class="mr-2 text-sm font-bold font-medium"
                        :class="{
                          'bg-table-highlight-bg text-table-highlight-text font-bold':
                            isHighlighted((spans as any[])[virtualRow.index].spanId),
                          'bg-table-highlight-bg text-status-error-text font-bold':
                            currentSelectedValue === (spans as any[])[virtualRow.index].spanId,
                        }"
                        :data-test="`trace-tree-span-service-name-${(spans as any[])[virtualRow.index].spanId}`"
                      >
                        {{ (spans as any[])[virtualRow.index].resolvedIdentity }}
                      </span>
                      <SpanKindBadge
                        v-if="(spans as any[])[virtualRow.index]?.spanKind"
                        :kind="(spans as any[])[virtualRow.index]?.spanKind"
                        class="mr-1"
                      />

                      <img
                        v-if="getSpanTechIcon((spans as any[])[virtualRow.index])"
                        :src="getSpanTechIcon((spans as any[])[virtualRow.index])"
                        :title="getSpanTech((spans as any[])[virtualRow.index])"
                        class="mr-1 inline-block h-3.5 w-3.5 shrink-0 opacity-60"
                        aria-hidden="true"
                        alt=""
                        :data-test="`trace-tree-span-tech-icon-${(spans as any[])[virtualRow.index].spanId}`"
                      />
                      <span
                        class="text-text-secondary text-sm"
                        :data-test="`trace-tree-span-operation-name-${(spans as any[])[virtualRow.index].spanId}`"
                        >{{ (spans as any[])[virtualRow.index].operationName }}</span
                      >
                    </div>
                    <!-- LLM Metrics -->
                    <div
                      v-if="isLLMTrace((spans as any[])[virtualRow.index])"
                      class="text-status-error-text! mt-[-0.125rem] mb-0.5 flex items-center text-xs leading-none"
                    >
                      <span
                        v-if="(spans as any[])[virtualRow.index].genAiUsage?.total > 0"
                        class="mr-2"
                      >
                        <OIcon name="functions" size="xs" />
                        {{ formatTokens((spans as any[])[virtualRow.index].genAiUsage.total) }}
                      </span>
                      <span v-if="(spans as any[])[virtualRow.index].genAiCost?.total > 0">
                        <OIcon name="attach-money" size="xs" />
                        {{ formatCost((spans as any[])[virtualRow.index].genAiCost.total) }}
                      </span>
                    </div>
                  </div>

                  <div class="sticky right-0 flex items-center gap-1">
                    <!-- Hidden at rest, not merely invisible: `invisible` would keep
                         the box in layout and reserve a permanent gutter to the left
                         of the badges, which is the thing this arrangement exists to
                         avoid. `hidden` gives the operation name the full width until
                         the row is hovered, and the button then takes its 1.5rem from
                         the already-truncating name — never from the badges, which
                         stay pinned to the right edge. The cost is that the text's
                         truncation point shifts on hover; the reflow is one row wide.

                         It sits before the status badge because it used to sit *on
                         top of* it: the old `.view-logs-container` was an absolute
                         overlay pinned to `right-0`, so hovering a row covered both
                         the HTTP status and the event count — and the event count is
                         the honest fallback for spans whose markers cannot be drawn,
                         so hover hid the one channel that is always true. -->
                    <div
                      class="view-span-logs hidden"
                      :data-test="`trace-tree-span-view-logs-container-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      <OButton
                        variant="outline"
                        size="icon"
                        :title="t('traces.viewLogs')"
                        @click.stop="viewSpanLogs((spans as any[])[virtualRow.index])"
                        :data-test="`trace-tree-span-view-logs-btn-${(spans as any[])[virtualRow.index].spanId}`"
                      >
                        <OIcon name="search" size="xs" />
                      </OButton>
                    </div>
                    <span
                      v-if="getHttpStatusVars((spans as any[])[virtualRow.index])"
                      class="rounded-default mr-1 px-1 py-[0.4rem] text-xs leading-none font-semibold whitespace-nowrap"
                      :style="{
                        backgroundColor: getHttpStatusVars((spans as any[])[virtualRow.index])?.bg,
                        color: getHttpStatusVars((spans as any[])[virtualRow.index])?.text,
                      }"
                      :title="
                        t('traces.traceTree.httpStatus', {
                          status: getHttpStatus((spans as any[])[virtualRow.index]),
                        })
                      "
                      :data-test="`trace-tree-span-http-status-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      {{ getHttpStatus((spans as any[])[virtualRow.index]) }}
                    </span>
                    <!-- Honest fallback for the event markers: a marker can only
                         be drawn for an event that positions inside the trace
                         window, and a sub-pixel span has nowhere to draw one at
                         all. This count is always true.

                         Two tallies, each with its own glyph: the badge's icon
                         counts every event, the trailing segment counts the
                         subset that failed. Severity therefore still travels on
                         a non-colour channel — the glyph, and the icon's own
                         `label`, which is what a screen reader reads — rather
                         than on the error variant's red alone. -->
                    <OBadge
                      v-if="getEventSummary((spans as any[])[virtualRow.index]).total > 0"
                      size="xs"
                      shape="square"
                      :variant="
                        getEventSummary((spans as any[])[virtualRow.index]).errors > 0
                          ? 'error-outline'
                          : 'default-outline'
                      "
                      icon="event-note"
                      class="mr-1 rounded!"
                      :title="getEventCountLabel((spans as any[])[virtualRow.index])"
                      data-test="span-event-count-badge"
                      :data-test-span="`trace-tree-span-event-count-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      {{ getEventSummary((spans as any[])[virtualRow.index]).total }}
                      <template
                        v-if="getEventSummary((spans as any[])[virtualRow.index]).errors > 0"
                        #trailing
                      >
                        <span class="flex items-center gap-0.5" data-test="span-event-error-count">
                          <OIcon
                            name="error"
                            size="xs"
                            :label="getEventErrorLabel((spans as any[])[virtualRow.index])"
                          />
                          {{ getEventSummary((spans as any[])[virtualRow.index]).errors }}
                        </span>
                      </template>
                    </OBadge>
                  </div>
                </div>
              </div>
              <div
                class="span-background-wrapper relative grow"
                :style="{
                  backgroundColor: (spans as any[])[virtualRow.index].style.backgroundColor,
                  borderLeft: `0.1875rem solid ${(spans as any[])[virtualRow.index].style.color}`,
                  marginLeft: (spans as any[])[virtualRow.index].hasChildSpans ? '0.875rem' : '0',
                  width: '100%',
                }"
                :data-test="`trace-tree-span-background-${(spans as any[])[virtualRow.index].spanId}`"
              />
            </div>
          </div>
          <div v-if="!isSidebarOpen" :style="{ width: `calc(100% - ${leftWidth}px)` }">
            <SpanBlock
              :span="(spans as any[])[virtualRow.index]"
              :depth="depth"
              :baseTracePosition="baseTracePosition"
              :styleObj="{
                position: 'absolute',
                top: (spans as any[])[virtualRow.index].style.top,
                left: (spans as any[])[virtualRow.index].style.left,
                height: '3.75rem',
              }"
              :spanDimensions="spanDimensions"
              :isCollapsed="collapseMapping[(spans as any[])[virtualRow.index].spanId]"
              :spanData="spanMap[(spans as any[])[virtualRow.index].spanId]"
              @toggle-collapse="toggleSpanCollapse"
              @select-span="selectSpan"
              @select-span-event="selectSpanEvent"
              @view-logs="viewSpanLogs((spans as any[])[virtualRow.index])"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  nextTick,
  ref,
  watch,
  computed,
  onMounted,
  onBeforeUnmount,
  type PropType,
} from "vue";
import useTraces from "@/composables/useTraces";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import SpanBlock from "./SpanBlock.vue";
import { summarizeSpanEvents } from "@/composables/traces/useSpanEvents";
import SpanKindBadge from "./components/SpanKindBadge.vue";
import { useI18nTyped } from "@/types/i18n";

import { formatTokens, formatCost, isLLMTrace } from "@/utils/llmUtils";
import { getServiceIconDataUrl, getSpanTechIconDataUrl } from "@/utils/traces/convertTraceData";
import { getKindIcon } from "@/composables/traces/useTraceProcessing";
import { useVirtualizer, type VirtualItem } from "@tanstack/vue-virtual";
import { useRouter } from "vue-router";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import config from "@/aws-exports";

export default defineComponent({
  name: "TraceTree",
  inheritAttrs: false,
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
      type: Object as PropType<{
        height: number;
        collapseWidth: number;
        gap: number;
      }>,
      default: () => {},
    },
    spanMap: {
      type: Object,
      default: () => ({}),
    },
    leftWidth: {
      type: Number,
      default: 0,
    },
    searchQuery: {
      type: String,
      default: "",
    },
    spanList: {
      type: Array,
      default: () => [],
    },
    selectedSpanId: {
      type: String,
      default: "",
    },
    hoveredSpanId: {
      type: String,
      default: "",
    },
    isSidebarOpen: {
      type: Boolean,
      default: false,
    },
    scrollContainer: {
      // DOM Element ref from parent — no runtime type check needed
      default: null,
    },
  },
  emits: [
    "toggleCollapse",
    "selectSpan",
    "selectSpanEvent",
    "hoverSpan",
    "unhoverSpan",
    "update-current-index",
    "search-result",
    "view-correlated-logs",
  ],
  setup(props, { emit }) {
    const { buildQueryDetails, navigateToLogs } = useTraces();
    const store = useStore();
    const { isDark } = useTheme();

    const { t } = useI18nTyped();
    useRouter();

    // As there are some UX issues, disabling it for now
    const enableHoverSelection = false;

    // ── Virtualizer ──────────────────────────────────────────────────────────
    const rowVirtualizer = useVirtualizer(
      computed(() => ({
        count: (props.spans as any[]).length,
        getScrollElement: () => props.scrollContainer,
        estimateSize: () => props.spanDimensions?.height ?? 30,
        overscan: 10,
      })),
    );

    const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
    const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

    const getVirtualRowKey = (row: VirtualItem): string | number => row.key as string | number;

    const highlightedSpanId = computed(() => props.hoveredSpanId || props.selectedSpanId);

    onMounted(() => {
      if (props.selectedSpanId) {
        scrollToSpan(props.selectedSpanId as string, 300);
      }
    });

    onBeforeUnmount(() => {
      // Drop any queued scroll so it can't fire against a torn-down virtualizer
      // (the tree can remount since searchObj is a module-level singleton).
      cancelScroll();
    });

    // ── CSS connector helpers (pre-computed, O(n) total) ────────────────────
    // nextSiblingMap[i] = true when spans[i] has a next sibling at the same
    // depth with no shallower span in between. Built in a single RTL scan so
    // the template reads O(1) instead of O(n) per row per depth level.
    const nextSiblingMap = computed((): boolean[] => {
      const spans = props.spans as any[];
      const result = new Array<boolean>(spans.length).fill(false);
      // lastSeenAtDepth[d] = index of the most-recently-seen span at depth d
      // (undefined once a shallower span has been encountered)
      const lastSeenAtDepth: (number | undefined)[] = [];

      for (let i = spans.length - 1; i >= 0; i--) {
        const d: number = spans[i]?.depth ?? 0;
        result[i] = lastSeenAtDepth[d] !== undefined;
        // Invalidate all deeper entries — they belong to a subtree we've passed
        for (let j = d + 1; j < lastSeenAtDepth.length; j++) {
          lastSeenAtDepth[j] = undefined;
        }
        lastSeenAtDepth[d] = i;
      }
      return result;
    });

    // ancestorSiblingMap key: `${spanIndex}-${ancestorTreeDepth}` → true when
    // the ancestor of spans[spanIndex] at tree depth ancestorTreeDepth has a
    // next sibling. Built in a single LTR scan using an ancestor index stack.
    const ancestorSiblingMap = computed((): Map<string, boolean> => {
      const spans = props.spans as any[];
      const ns = nextSiblingMap.value;
      const map = new Map<string, boolean>();
      // ancestorStack[d] = index of the most-recent span seen at tree depth d
      const ancestorStack: (number | undefined)[] = [];

      for (let i = 0; i < spans.length; i++) {
        const d: number = spans[i]?.depth ?? 0;
        // Self entry (depthOffset = 0)
        map.set(`${i}-${d}`, ns[i]);
        // Ancestor entries for each ancestor depth level
        for (let td = 0; td < d; td++) {
          const ancestorIdx = ancestorStack[td];
          if (ancestorIdx !== undefined) {
            map.set(`${i}-${td}`, ns[ancestorIdx]);
          }
        }
        // Update stack: clear deeper entries, record self at depth d
        for (let j = d + 1; j < ancestorStack.length; j++) {
          ancestorStack[j] = undefined;
        }
        ancestorStack[d] = i;
      }
      return map;
    });

    // ── Actions ──────────────────────────────────────────────────────────────
    function toggleSpanCollapse(spanId: number | string) {
      emit("toggleCollapse", spanId);
    }
    const selectSpan = (spanId: string) => {
      emit("selectSpan", spanId);
    };

    const selectSpanEvent = (payload: { spanId: string; eventIndex: number }) => {
      emit("selectSpanEvent", payload);
    };
    const onHoverSpan = (spanId: string) => {
      if (enableHoverSelection) emit("hoverSpan", spanId);
    };
    const onUnhoverSpan = () => {
      if (enableHoverSelection) emit("unhoverSpan");
    };

    const viewSpanLogs = (span: any) => {
      if (config.isEnterprise === "true") {
        emit("view-correlated-logs", span);
        return;
      }
      const queryDetails = buildQueryDetails(span);
      navigateToLogs(queryDetails);
    };

    const getChildCount = (span: any): number => {
      if (!span.spans || !Array.isArray(span.spans)) return 0;
      return span.spans.length;
    };

    // ── Search ───────────────────────────────────────────────────────────────
    const searchResults = ref<any[]>([]);
    const currentIndex = ref<number | null>(null);
    const currentSelectedValue = computed(() => {
      if (
        currentIndex.value === -1 ||
        currentIndex.value === null ||
        searchResults.value.length === 0
      ) {
        return null;
      }
      return searchResults.value[currentIndex.value];
    });

    const findMatches = (spanList: any, searchQuery: any) => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return [];
      return spanList
        .map((span: any) => {
          const matches = Object.entries(span).some(([key, value]) => {
            if (typeof value === "string" || typeof value === "number") {
              if (key === "duration") {
                const formattedDuration = `${value}us`;
                return (
                  String(value).toLowerCase().includes(query) ||
                  formattedDuration.toLowerCase().includes(query)
                );
              }
              return String(value).toLowerCase().includes(query);
            }
            return false;
          });
          return matches ? span.span_id : -1;
        })
        .filter((index: any) => index !== -1);
    };

    // Tracks the pending scrollToSpan setTimeout so a newer scroll or an
    // explicit cancel can clear an in-flight one. Non-reactive — never used in
    // the template.
    let pendingScrollTimeout: ReturnType<typeof setTimeout> | null = null;

    const scrollToSpan = (spanId: string, delay: number = 0) => {
      const spanIndex = (props.spans as any[]).findIndex(
        (s: any) => s.spanId === spanId || s.span_id === spanId,
      );

      if (spanIndex !== -1) {
        // Clear any previously queued scroll so only the latest one runs.
        if (pendingScrollTimeout !== null) {
          clearTimeout(pendingScrollTimeout);
        }
        pendingScrollTimeout = setTimeout(() => {
          pendingScrollTimeout = null;
          rowVirtualizer.value.scrollToIndex(spanIndex, { align: "center" });
        }, delay);
      }
    };

    // Cancels any pending and in-flight programmatic scroll. Called when the
    // selection is cleared (e.g. sidebar close) so the virtualizer stops
    // forcing the previously-selected span back into view while the user
    // scrolls manually.
    const cancelScroll = () => {
      if (pendingScrollTimeout !== null) {
        clearTimeout(pendingScrollTimeout);
        pendingScrollTimeout = null;
      }
      // TanStack's scrollToIndex runs a requestAnimationFrame retry loop that
      // keeps re-scrolling until the target offset is reached; the loop only
      // bails when its captured `currentScrollToIndex` no longer matches the
      // instance's. Resetting it to null (the value the library inits it to)
      // makes the next frame bail. There is no public API for this, so guard
      // the access in case the internal field is renamed in a future
      // @tanstack/virtual-core release.
      const virtualizer = rowVirtualizer.value as any;
      if (virtualizer && "currentScrollToIndex" in virtualizer) {
        virtualizer.currentScrollToIndex = null;
      }
    };

    const scrollToMatch = () => {
      if (searchResults.value.length === 0 || currentIndex.value === null) return;
      scrollToSpan(searchResults.value[currentIndex.value]);
    };

    const updateSearch = () => {
      if (props.searchQuery?.trim()) {
        searchResults.value = findMatches(props.spanList, props.searchQuery);
        currentIndex.value = 0;
        nextTick(() => {
          scrollToMatch();
        });
      } else {
        searchResults.value = [];
        currentIndex.value = null;
      }
    };

    const isHighlighted = (path: any) => {
      if (Array.isArray(path)) {
        return searchResults.value.some(
          (resultPath: any) => resultPath.join(",") === path.join(","),
        );
      }
      return searchResults.value.includes(path);
    };

    const nextMatch = () => {
      if (currentIndex.value !== null && currentIndex.value < searchResults.value.length - 1) {
        currentIndex.value++;
        nextTick(() => {
          scrollToMatch();
        });
      }
    };

    const prevMatch = () => {
      if (currentIndex.value !== null && currentIndex.value > 0) {
        currentIndex.value--;
        nextTick(() => {
          scrollToMatch();
        });
      }
    };

    watch(
      () => props.searchQuery,
      () => {
        updateSearch();
      },
    );
    watch(currentIndex, (newValue) => {
      emit("update-current-index", newValue);
    });
    watch(searchResults, (newValue) => {
      emit("search-result", newValue.length);
    });

    // ── Icon maps ────────────────────────────────────────────────────────────
    const spanServiceIconUrlMap = computed(() => {
      const cache = new Map<string, string>();
      for (const span of props.spans as any[]) {
        const key = `${span.serviceName}/${span.style?.color ?? ""}`;
        if (!cache.has(key)) {
          cache.set(
            key,
            getServiceIconDataUrl(span.serviceName, isDark.value, span.style?.color ?? "#9e9e9e"),
          );
        }
      }
      return cache;
    });

    const getSpanTech = (span: any): string | undefined => {
      const attrs = span || {};
      return (
        attrs["db_system"] ||
        attrs["messaging_system"] ||
        attrs["rpc_system"] ||
        (span.spanKind?.toUpperCase() === "CLIENT" && attrs["http_url"] ? "http" : null) ||
        undefined
      );
    };

    // Resolve the tech icon URL for a span; undefined when no tech/icon.
    const getSpanTechIcon = (span: any): string | undefined => {
      const tech = getSpanTech(span);
      return tech ? spanTechIconUrlMap.value.get(tech) : undefined;
    };

    const spanTechIconUrlMap = computed(() => {
      const map = new Map<string, string>();
      for (const span of props.spans as any[]) {
        const tech = getSpanTech(span);
        if (tech && !map.has(tech)) {
          const url = getSpanTechIconDataUrl(tech, isDark.value);
          if (url) map.set(tech, url);
        }
      }
      return map;
    });

    // ── HTTP status helpers ──────────────────────────────────────────────────
    const getHttpStatus = (span: any): number | null => {
      const spanData = props.spanMap[span.spanId] || {};
      const code = spanData["http_status_code"] ?? null;
      return code !== null ? Number(code) : null;
    };

    const getHttpStatusVars = (span: any): { text: string; bg: string } | null => {
      const code = getHttpStatus(span);
      if (code === null || code < 200) return null;
      if (code < 300)
        return {
          text: "var(--color-status-success-text)",
          bg: "var(--color-status-success-bg)",
        };
      if (code < 400)
        return {
          text: "var(--color-status-info-text)",
          bg: "var(--color-status-info-bg)",
        };
      if (code < 500)
        return {
          text: "var(--color-status-warning-text)",
          bg: "var(--color-status-warning-bg)",
        };
      return {
        text: "var(--color-status-error-text)",
        bg: "var(--color-status-error-bg)",
      };
    };

    interface SpanEventSummary {
      total: number;
      errors: number;
    }

    /** Shared result for a span the trace carries no event payload for. */
    const NO_SPAN_EVENTS: SpanEventSummary = Object.freeze({ total: 0, errors: 0 });

    /**
     * Every span's event tally, computed once per `spanMap`.
     *
     * The badge reads this five or six times per row — `v-if`, `:class`,
     * `:title`, the text, and the label helper — and the row list is virtualized,
     * so it re-renders on every scroll tick. Summarizing on demand meant
     * re-running `JSON.parse` over the raw events payload 150+ times per frame
     * for a screenful of rows. Keying the whole map off `spanMap` collapses that
     * to one parse per span per trace.
     */
    const eventSummaryMap = computed<Record<string, SpanEventSummary>>(() => {
      const timestampField = store.state.zoConfig?.timestamp_column;
      const summaries: Record<string, SpanEventSummary> = {};

      for (const [spanId, spanData] of Object.entries(props.spanMap ?? {})) {
        summaries[spanId] = summarizeSpanEvents((spanData as any)?.events, timestampField);
      }

      return summaries;
    });

    const getEventSummary = (span: any): SpanEventSummary =>
      eventSummaryMap.value[span.spanId] ?? NO_SPAN_EVENTS;

    /**
     * The badge is the honest fallback: markers can only show events that
     * position inside the trace window, and 10.3% of spans in the `default`
     * stream render narrower than one pixel. The badge shows the two tallies
     * as icon-and-number pairs, so this full sentence is what its tooltip says.
     */
    const getEventCountLabel = (span: any): string => {
      const { total, errors } = getEventSummary(span);
      if (!errors)
        return total === 1
          ? t("traces.spanEventCount", { count: total })
          : t("traces.spanEventCountPlural", { count: total });
      return errors === 1
        ? t("traces.spanEventCountWithErrors", { count: total, errors })
        : t("traces.spanEventCountWithErrorsPlural", { count: total, errors });
    };

    /**
     * The error icon's accessible name. Without it the error tally reaches a
     * screen reader as a bare number beside a red glyph — severity by colour
     * alone, which is the defect the badge exists to fix.
     */
    const getEventErrorLabel = (span: any): string => {
      const { errors } = getEventSummary(span);
      return errors === 1
        ? t("traces.spanEventErrorCount", { errors })
        : t("traces.spanEventErrorCountPlural", { errors });
    };

    return {
      toggleSpanCollapse,
      selectSpan,
      selectSpanEvent,
      onHoverSpan,
      onUnhoverSpan,
      highlightedSpanId,
      store,
      viewSpanLogs,
      t,
      searchResults,
      getVirtualRowKey,
      currentIndex,
      updateSearch,
      nextMatch,
      prevMatch,
      isHighlighted,
      currentSelectedValue,
      scrollToSpan,
      cancelScroll,
      scrollToMatch,
      findMatches,
      getChildCount,
      getEventSummary,
      getEventCountLabel,
      getEventErrorLabel,
      formatTokens,
      formatCost,
      isLLMTrace,
      spanServiceIconUrlMap,
      spanTechIconUrlMap,
      getSpanTech,
      getSpanTechIcon,
      getKindIcon,
      getHttpStatus,
      getHttpStatusVars,
      // virtualizer
      virtualRows,
      totalSize,
      nextSiblingMap,
      ancestorSiblingMap,
    };
  },
  components: { SpanBlock, SpanKindBadge, OBadge, OButton, OIcon },
});
</script>

<style scoped>
/* keep(complex-state): span-row hover/selected ::before overlay tints plus
   parent-state child reveal chains target descendants and pseudo-overlays that
   Tailwind utilities can't express. The overlay is always present (transparent
   at rest) so its background-color can transition — matching OTable row hover
   (transition-colors duration-150) instead of snapping in abruptly. */
.span-row::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: transparent;
  pointer-events: none;
  z-index: 999;
  transition: background-color 150ms ease;
}

.span-row:hover::before {
  background-color: color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.span-row:hover .operation-name-container {
  background-color: transparent !important;
}

.span-row:hover .view-span-logs {
  display: flex;
}

.span-row.span-row-selected::before {
  background-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
}

.span-row.span-row-selected .operation-name-container {
  background-color: transparent !important;
}

.span-row > * {
  position: relative;
  z-index: 2;
}
</style>
