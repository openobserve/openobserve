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
    <div
      :style="{ position: 'relative', height: totalSize + 'px', width: '100%' }"
    >
      <div
        v-for="virtualRow in virtualRows"
        :key="virtualRow.key"
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
              :data-left="
                parseInt((spans as any[])[virtualRow.index].style.left)
              "
              :data-depth="depth"
              :style="{
                position: 'absolute',
                left:
                  parseInt((spans as any[])[virtualRow.index].style.left) -
                  (spanDimensions?.gap ?? 15) * (depth - 1) +
                  'px',
                top: '0',
                height: nextSiblingMap[virtualRow.index as number]
                  ? spanDimensions.height + 'px'
                  : depth === 1
                    ? spanDimensions.height / 2 + 'px'
                    : spanDimensions.height + 'px',
                borderLeft: '1.5px solid var(--o2-border-color)',
                pointerEvents: 'none',
                zIndex: 1,
              }"
            />
          </template>
          <!-- Horizontal stub from parent column to this badge -->
          <div
            data-test="horizontal-segment"
            :style="{
              position: 'absolute',
              left:
                parseInt((spans as any[])[virtualRow.index].style.left) + 'px',
              top: '50%',
              width: (spans as any[])[virtualRow.index].hasChildSpans
                ? (spanDimensions?.gap ?? 15) / 2 + 'px'
                : (spanDimensions?.gap ?? 15) + 5 + 'px',
              borderTop: '1.5px solid var(--o2-border-color)',
              pointerEvents: 'none',
              zIndex: 1,
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
          class="flex span-row"
          :class="{
            'span-row-selected':
              (spans as any[])[virtualRow.index].spanId === highlightedSpanId,
          }"
          @mouseleave="onUnhoverSpan"
          :data-test="`trace-tree-span-container-${(spans as any[])[virtualRow.index].spanId}`"
        >
          <div :style="{ width: leftWidth + 'px' }" class="tw:pl-[0.375rem]">
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
              class="flex flex-col items-start justify-start ellipsis"
              :title="(spans as any[])[virtualRow.index].operationName"
            >
              <div
                class="flex no-wrap full-width relative-position operation-name-container tw:cursor-pointer tw:items-center"
                :class="[
                  store.state.theme === 'dark' ? 'bg-dark' : 'bg-white',
                  isLLMTrace((spans as any[])[virtualRow.index])
                    ? ''
                    : 'q-pt-sm',
                ]"
                :data-test="`trace-tree-span-operation-name-container-${(spans as any[])[virtualRow.index].spanId}`"
                @click="selectSpan((spans as any[])[virtualRow.index].spanId)"
                @mouseenter="
                  onHoverSpan((spans as any[])[virtualRow.index].spanId)
                "
              >
                <div
                  class="absolute view-logs-container"
                  :data-test="`trace-tree-span-view-logs-container-${(spans as any[])[virtualRow.index].spanId}`"
                >
                  <div class="tw:mx-1 view-span-logs">
                    <OButton
                      variant="ghost"
                      size="icon"
                      :title="t('traces.viewLogs')"
                      @click.stop="
                        viewSpanLogs((spans as any[])[virtualRow.index])
                      "
                      :data-test="`trace-tree-span-view-logs-btn-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      <q-icon name="search" size="12px" />
                    </OButton>
                  </div>
                </div>
                <div
                  v-if="(spans as any[])[virtualRow.index].hasChildSpans"
                  class="span-count-box cursor-pointer tw:border-[var(--o2-border-color)]! tw:relative"
                  :style="{
                    color: (spans as any[])[virtualRow.index].style.color,
                  }"
                  @click.stop="
                    toggleSpanCollapse(
                      (spans as any[])[virtualRow.index].spanId,
                    )
                  "
                  :data-test="`trace-tree-span-badge-collapse-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  :title="`Click to ${collapseMapping[(spans as any[])[virtualRow.index].spanId] ? 'expand' : 'collapse'}`"
                >
                  {{ getChildCount((spans as any[])[virtualRow.index]) }}
                  <div
                    v-if="
                      collapseMapping[(spans as any[])[virtualRow.index].spanId]
                    "
                    data-test="vertical-segment"
                    :style="{
                      position: 'absolute',
                      left: '0.5rem',
                      bottom: '-6px',
                      height: '5px',
                      borderLeft: '1.5px solid var(--o2-border-color)',
                      pointerEvents: 'none',
                      zIndex: 1,
                    }"
                  />
                </div>

                <div
                  v-else
                  class="span-leaf-dot"
                  :style="{
                    backgroundColor: (spans as any[])[virtualRow.index].style
                      .color,
                  }"
                ></div>

                <div
                  class="tw:flex tw:justify-between"
                  :class="
                    (spans as any[])[virtualRow.index].hasChildSpans
                      ? 'tw:w-full'
                      : 'tw:w-[calc(100%-0.6rem)]!'
                  "
                >
                  <div
                    class="ellipsis q-pl-xs cursor-pointer span-name-section tw:w-[calc(100%-2rem)]!"
                    :class="
                      isLLMTrace((spans as any[])[virtualRow.index])
                        ? 'tw:flex-col tw:items-start'
                        : ' tw:flex tw:items-center'
                    "
                    :data-test="`trace-tree-span-select-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  >
                    <div
                      class="ellipsis flex items-center span-name-section-content"
                    >
                      <q-icon
                        v-if="
                          (spans as any[])[virtualRow.index].spanStatus ===
                          'ERROR'
                        "
                        name="error"
                        class="text-red-6 q-mr-xs"
                        title="Error Span"
                        :data-test="`trace-tree-span-error-icon-${(spans as any[])[virtualRow.index].spanId}`"
                      />
                      <span
                        class="text-subtitle2 text-bold q-mr-sm"
                        :class="{
                          highlighted: isHighlighted(
                            (spans as any[])[virtualRow.index].spanId,
                          ),
                          'tw:text-gray-900':
                            store.state.theme === 'dark' &&
                            isHighlighted(
                              (spans as any[])[virtualRow.index].spanId,
                            ),
                          'current-match':
                            currentSelectedValue ===
                            (spans as any[])[virtualRow.index].spanId,
                        }"
                        :data-test="`trace-tree-span-service-name-${(spans as any[])[virtualRow.index].spanId}`"
                      >
                        {{ (spans as any[])[virtualRow.index].serviceName }}
                      </span>
                      <SpanKindBadge
                        v-if="(spans as any[])[virtualRow.index]?.spanKind"
                        :kind="(spans as any[])[virtualRow.index]?.spanKind"
                      />

                      <img
                        v-if="
                          spanTechIconUrlMap.get(
                            getSpanTech((spans as any[])[virtualRow.index]),
                          )
                        "
                        :src="
                          spanTechIconUrlMap.get(
                            getSpanTech((spans as any[])[virtualRow.index]),
                          )
                        "
                        :title="getSpanTech((spans as any[])[virtualRow.index])"
                        class="q-mr-xs tw:shrink-0 tw:w-[0.875rem] tw:h-[0.875rem] tw:inline-block tw:opacity-60"
                        aria-hidden="true"
                        alt=""
                        :data-test="`trace-tree-span-tech-icon-${(spans as any[])[virtualRow.index].spanId}`"
                      />
                      <span
                        class="text-body2"
                        :class="
                          store.state.theme === 'dark'
                            ? 'text-grey-5'
                            : 'text-blue-grey-9'
                        "
                        :data-test="`trace-tree-span-operation-name-${(spans as any[])[virtualRow.index].spanId}`"
                        >{{
                          (spans as any[])[virtualRow.index].operationName
                        }}</span
                      >
                    </div>
                    <!-- LLM Metrics -->
                    <div
                      v-if="isLLMTrace((spans as any[])[virtualRow.index])"
                      class="flex items-center text-caption text-red-6"
                      style="
                        margin-top: -4px;
                        margin-bottom: 2px;
                        line-height: 1;
                      "
                    >
                      <span
                        v-if="
                          (spans as any[])[virtualRow.index].llm_usage?.total >
                          0
                        "
                        class="q-mr-sm"
                      >
                        <q-icon name="functions" size="10px" />
                        {{
                          formatTokens(
                            (spans as any[])[virtualRow.index].llm_usage.total,
                          )
                        }}
                      </span>
                      <span
                        v-if="
                          (spans as any[])[virtualRow.index].llm_cost?.total > 0
                        "
                      >
                        <q-icon name="attach_money" size="10px" />
                        {{
                          formatCost(
                            (spans as any[])[virtualRow.index].llm_cost.total,
                          )
                        }}
                      </span>
                    </div>
                  </div>

                  <div class="tw:flex tw:items-center tw:sticky tw:right-0">
                    <span
                      v-if="
                        getHttpStatusVars((spans as any[])[virtualRow.index])
                      "
                      class="tw:text-[0.625rem] tw:font-bold tw:leading-none tw:py-[0.4rem] tw:px-1 tw:mr-[0.25rem] tw:rounded tw:whitespace-nowrap"
                      :style="{
                        backgroundColor: getHttpStatusVars(
                          (spans as any[])[virtualRow.index],
                        ).bg,
                        color: getHttpStatusVars(
                          (spans as any[])[virtualRow.index],
                        ).text,
                      }"
                      :title="`HTTP ${getHttpStatus((spans as any[])[virtualRow.index])}`"
                      :data-test="`trace-tree-span-http-status-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      {{ getHttpStatus((spans as any[])[virtualRow.index]) }}
                    </span>
                    <span
                      v-if="
                        getEventCount((spans as any[])[virtualRow.index]) > 0 &&
                        false
                      "
                      class="flex items-center"
                      :style="{
                        fontSize: '0.625rem',
                        lineHeight: 1,
                        gap: '0.125rem',
                        color: 'var(--o2-text-secondary)',
                        whiteSpace: 'nowrap',
                      }"
                      :title="`${getEventCount((spans as any[])[virtualRow.index])} span event${getEventCount((spans as any[])[virtualRow.index]) > 1 ? 's' : ''}`"
                      :data-test="`trace-tree-span-event-count-${(spans as any[])[virtualRow.index].spanId}`"
                    >
                      <q-icon name="event_note" size="0.625rem" />
                      {{ getEventCount((spans as any[])[virtualRow.index]) }}
                    </span>
                  </div>
                </div>
              </div>
              <div
                class="span-background-wrapper"
                :style="{
                  backgroundColor: (spans as any[])[virtualRow.index].style
                    .backgroundColor,
                  borderLeft: `0.1875rem solid ${(spans as any[])[virtualRow.index].style.color}`,
                  marginLeft: (spans as any[])[virtualRow.index].hasChildSpans
                    ? '0.875rem'
                    : '0',
                  width: '100%',
                }"
                :data-test="`trace-tree-span-background-${(spans as any[])[virtualRow.index].spanId}`"
              />
            </div>
          </div>
          <div
            v-if="!isSidebarOpen"
            :style="{ width: `calc(100% - ${leftWidth}px)` }"
          >
            <span-block
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
              :isCollapsed="
                collapseMapping[(spans as any[])[virtualRow.index].spanId]
              "
              :spanData="spanMap[(spans as any[])[virtualRow.index].spanId]"
              @toggle-collapse="toggleSpanCollapse"
              @select-span="selectSpan"
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
} from "vue";
import useTraces from "@/composables/useTraces";
import { useStore } from "vuex";
import SpanBlock from "./SpanBlock.vue";
import SpanKindBadge from "./components/SpanKindBadge.vue";
import { useI18n } from "vue-i18n";

import { formatTokens, formatCost, isLLMTrace } from "@/utils/llmUtils";
import {
  getServiceIconDataUrl,
  getSpanTechIconDataUrl,
} from "@/utils/traces/convertTraceData";
import { getKindIcon } from "@/composables/traces/useTraceProcessing";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";

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
      type: Object,
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
    "hoverSpan",
    "unhoverSpan",
    "update-current-index",
    "search-result",
  ],
  setup(props, { emit }) {
    const { buildQueryDetails, navigateToLogs } = useTraces();
    const store = useStore();

    const { t } = useI18n();
    const router = useRouter();

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

    const highlightedSpanId = computed(
      () => props.hoveredSpanId || props.selectedSpanId,
    );

    onMounted(() => {
      if (props.selectedSpanId) {
        scrollToSpan(props.selectedSpanId as string, 300);
      }
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
    const onHoverSpan = (spanId: string) => {
      emit("hoverSpan", spanId);
    };
    const onUnhoverSpan = () => {
      emit("unhoverSpan");
    };

    const viewSpanLogs = (span: any) => {
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

    const scrollToSpan = (spanId: string, delay: number = 0) => {
      const spanIndex = (props.spans as any[]).findIndex(
        (s: any) => s.spanId === spanId || s.span_id === spanId,
      );

      if (spanIndex !== -1) {
        setTimeout(() => {
          rowVirtualizer.value.scrollToIndex(spanIndex, { align: "center" });
        }, delay);
      }
    };

    const scrollToMatch = () => {
      if (searchResults.value.length === 0 || currentIndex.value === null)
        return;
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
      if (
        currentIndex.value !== null &&
        currentIndex.value < searchResults.value.length - 1
      ) {
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
      const isDark = store.state.theme === "dark";
      const cache = new Map<string, string>();
      for (const span of props.spans as any[]) {
        const key = `${span.serviceName}/${span.style?.color ?? ""}`;
        if (!cache.has(key)) {
          cache.set(
            key,
            getServiceIconDataUrl(
              span.serviceName,
              isDark,
              span.style?.color ?? "#9e9e9e",
            ),
          );
        }
      }
      return cache;
    });

    const getSpanTech = (span: any): string | null => {
      const attrs = span || {};
      return (
        attrs["db_system"] ||
        attrs["messaging_system"] ||
        attrs["rpc_system"] ||
        (span.spanKind?.toUpperCase() === "CLIENT" && attrs["http_url"]
          ? "http"
          : null) ||
        null
      );
    };

    const spanTechIconUrlMap = computed(() => {
      const isDark = store.state.theme === "dark";
      const map = new Map<string, string>();
      for (const span of props.spans as any[]) {
        const tech = getSpanTech(span);
        if (tech && !map.has(tech)) {
          const url = getSpanTechIconDataUrl(tech, isDark);
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

    const getHttpStatusVars = (
      span: any,
    ): { text: string; bg: string } | null => {
      const code = getHttpStatus(span);
      if (code === null || code < 200) return null;
      if (code < 300)
        return {
          text: "var(--o2-status-success-text)",
          bg: "var(--o2-status-success-bg)",
        };
      if (code < 400)
        return {
          text: "var(--o2-status-info-text)",
          bg: "var(--o2-status-info-bg)",
        };
      if (code < 500)
        return {
          text: "var(--o2-status-warning-text)",
          bg: "var(--o2-status-warning-bg)",
        };
      return {
        text: "var(--o2-status-error-text)",
        bg: "var(--o2-status-error-bg)",
      };
    };

    const getEventCount = (span: any): number => {
      return props.spanMap[span.spanId]?.events?.length ?? 0;
    };

    return {
      toggleSpanCollapse,
      selectSpan,
      onHoverSpan,
      onUnhoverSpan,
      highlightedSpanId,
      store,
      viewSpanLogs,
      t,
      searchResults,
      currentIndex,
      updateSearch,
      nextMatch,
      prevMatch,
      isHighlighted,
      currentSelectedValue,
      scrollToSpan,
      scrollToMatch,
      findMatches,
      getChildCount,
      formatTokens,
      formatCost,
      isLLMTrace,
      spanServiceIconUrlMap,
      spanTechIconUrlMap,
      getSpanTech,
      getKindIcon,
      getHttpStatus,
      getHttpStatusVars,
      getEventCount,
      // virtualizer
      virtualRows,
      totalSize,
      nextSiblingMap,
      ancestorSiblingMap,
    };
  },
  components: { SpanBlock, SpanKindBadge, OButton },
});
</script>

<style scoped lang="scss">
.view-logs-container {
  top: 0.25rem;
  right: 0;
  visibility: hidden;
}

.span-count-box {
  min-width: 1.2rem;
  height: 1.2rem;
  padding: 0 0.25rem;
  border-radius: 50%;
  border: 0.0625rem solid;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  margin-right: 0.25rem;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
}

.bg-dark .span-count-box:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.span-leaf-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  margin-right: 0.25rem;
  flex-shrink: 0;
  align-self: center;
}

.span-name-section {
  padding-left: 0.25rem;
}

.span-name-section-content {
  display: block;
}

.span-background-wrapper {
  flex-grow: 1;
  position: relative;
}

.operation-name-container {
  height: 1.875rem;
  overflow: visible;
}

.span-row {
  position: relative;
  min-height: 1.875rem;

  // Hover highlight via CSS — no JS required
  &:hover::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background-color: rgba(0, 123, 255, 0.2);
    pointer-events: none;
    z-index: 999;
  }

  &:hover .operation-name-container {
    background-color: transparent !important;
  }

  &:hover .view-logs-container {
    visibility: visible;
  }

  &.span-row-selected {
    &::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      background-color: rgba(0, 123, 255, 0.35);
      pointer-events: none;
      z-index: 999;
    }

    .operation-name-container {
      background-color: transparent !important;
    }
  }

  > * {
    position: relative;
    z-index: 2;
  }
}
</style>
<style lang="scss">
.view-logs-btn-text {
  visibility: visible;
}
.view-span-logs {
  background-color: inherit;
  .view-logs-btn-text {
    visibility: hidden;
    width: 0;
    transition: width 0.3s ease-in;
  }
  &:hover .view-logs-btn-text {
    visibility: visible;
    width: auto;
  }
}
.border-right {
  border-right: 0.0625rem solid rgb(236, 236, 236);
}
.highlighted {
  background-color: yellow;
  font-weight: bold;
}
.current-match {
  background-color: yellow;
  color: red;
  font-weight: bold;
}
</style>
