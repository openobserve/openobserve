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
    <!-- Virtualizer outer: establishes the full scrollable height -->
    <div
      :style="{ position: 'relative', height: totalSize + 'px', width: '100%' }"
    >
      <!-- SVG connector overlay — positions derived from span data, no DOM queries -->
      <svg
        v-if="connectorLines.length > 0"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
          overflow: 'visible',
        }"
      >
        <template v-for="(connector, idx) in connectorLines" :key="idx">
          <line
            :x1="connector.x1"
            :y1="connector.y1"
            :x2="connector.x1"
            :y2="connector.y2"
            stroke="var(--o2-border-color)"
            stroke-width="1.5"
            opacity="0.6"
          />
          <line
            v-for="(child, ci) in connector.children"
            :key="ci"
            :x1="connector.x1"
            :y1="child.y"
            :x2="child.x"
            :y2="child.y"
            stroke="var(--o2-border-color)"
            stroke-width="1.5"
            opacity="0.6"
          />
        </template>
      </svg>

      <div
        v-for="virtualRow in virtualRows"
        :key="virtualRow.key"
        class="span-row-item"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`,
          height: (spanDimensions?.height ?? 30) + 'px',
        }"
      >
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
              (spans as any[])[virtualRow.index].spanId === selectedSpanId,
          }"
          :data-test="`trace-tree-span-container-${(spans as any[])[virtualRow.index].spanId}`"
        >
          <div :style="{ width: leftWidth + 'px' }" class="tw:pl-[0.375rem]">
            <div
              :style="{
                height: '100%',
                margin: `0 0 0 ${
                  (spans as any[])[virtualRow.index].hasChildSpans
                    ? (spans as any[])[virtualRow.index].style.left
                    : parseInt(
                          (spans as any[])[virtualRow.index].style.left,
                        ) +
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
              >
                <div
                  class="absolute view-logs-container"
                  :data-test="`trace-tree-span-view-logs-container-${(spans as any[])[virtualRow.index].spanId}`"
                >
                  <q-btn
                    class="q-mx-xs view-span-logs"
                    :class="
                      store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'
                    "
                    size="0.625rem"
                    icon="search"
                    dense
                    no-caps
                    :title="t('traces.viewLogs')"
                    @click.stop="
                      viewSpanLogs((spans as any[])[virtualRow.index])
                    "
                    :data-test="`trace-tree-span-view-logs-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  >
                  </q-btn>
                </div>
                <div
                  v-if="(spans as any[])[virtualRow.index].hasChildSpans"
                  class="span-count-box cursor-pointer tw:border-[var(--o2-border-color)]!"
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
                    class="ellipsis q-pl-xs cursor-pointer span-name-section tw:flex tw:items-center"
                    :data-test="`trace-tree-span-select-btn-${(spans as any[])[virtualRow.index].spanId}`"
                  >
                    <div
                      class="ellipsis flex items-center span-name-section-content"
                    >
                      <img
                        :src="
                          spanServiceIconUrlMap.get(
                            `${(spans as any[])[virtualRow.index].serviceName}/${(spans as any[])[virtualRow.index].style?.color ?? ''}`,
                          )
                        "
                        class="q-mr-xs tw:shrink-0 tw:w-[1.125rem] tw:h-[1.125rem] tw:inline-block"
                        aria-hidden="true"
                        alt=""
                        :data-test="`trace-tree-span-service-icon-${(spans as any[])[virtualRow.index].spanId}`"
                      />
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
                      <q-icon
                        v-if="(spans as any[])[virtualRow.index].spanKind"
                        :name="
                          getKindIcon(
                            (spans as any[])[
                              virtualRow.index
                            ].spanKind.toUpperCase(),
                          )
                        "
                        size="0.875rem"
                        class="text-grey-6 q-mr-xs"
                        :title="(spans as any[])[virtualRow.index].spanKind"
                        :data-test="`trace-tree-span-kind-icon-${(spans as any[])[virtualRow.index].spanId}`"
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
                        :title="
                          getSpanTech((spans as any[])[virtualRow.index])
                        "
                        class="q-mr-xs tw:shrink-0 tw:w-[0.875rem] tw:h-[0.875rem] tw:inline-block tw:opacity-60"
                        aria-hidden="true"
                        alt=""
                        :data-test="`trace-tree-span-tech-icon-${(spans as any[])[virtualRow.index].spanId}`"
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
                      style="margin-top: -4px; margin-bottom: 2px; line-height: 1"
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
                      {{
                        getHttpStatus((spans as any[])[virtualRow.index])
                      }}
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
} from "vue";
import useTraces from "@/composables/useTraces";
import { useStore } from "vuex";
import SpanBlock from "./SpanBlock.vue";
import { useI18n } from "vue-i18n";
import { formatTokens, formatCost, isLLMTrace } from "@/utils/llmUtils";
import {
  getServiceIconDataUrl,
  getSpanTechIconDataUrl,
} from "@/utils/traces/convertTraceData";
import { getKindIcon } from "@/composables/traces/useTraceProcessing";
import { useVirtualizer } from "@tanstack/vue-virtual";

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
    // DOM Element reference to the parent scroll container
    scrollContainer: {
      default: null,
    },
  },
  emits: [
    "toggleCollapse",
    "selectSpan",
    "update-current-index",
    "search-result",
  ],
  setup(props, { emit }) {
    const { buildQueryDetails, navigateToLogs } = useTraces();
    const store = useStore();
    const { t } = useI18n();

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

    // ── Actions ──────────────────────────────────────────────────────────────
    function toggleSpanCollapse(spanId: number | string) {
      emit("toggleCollapse", spanId);
    }

    const selectSpan = (spanId: string) => {
      emit("selectSpan", spanId);
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

    // Scroll to the current match using the virtualizer instead of querySelector.
    // This works even when the target row is outside the rendered viewport.
    const scrollToMatch = () => {
      if (searchResults.value.length === 0 || currentIndex.value === null)
        return;
      const targetSpanId = searchResults.value[currentIndex.value];
      const spanIndex = (props.spans as any[]).findIndex(
        (s: any) => s.spanId === targetSpanId || s.span_id === targetSpanId,
      );
      if (spanIndex !== -1) {
        rowVirtualizer.value.scrollToIndex(spanIndex, { align: "center" });
      }
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

    // ── SVG Connectors (math-based, no DOM queries) ──────────────────────────
    const connectorLines = computed(() => {
      const spans = props.spans as any[];
      const rowH = props.spanDimensions?.height ?? 30;
      const gap = props.spanDimensions?.gap ?? 15;
      const colW = props.spanDimensions?.collapseWidth ?? 14;
      const pad = 6;

      type ConnectorGroup = {
        x1: number;
        y1: number;
        y2: number;
        children: { x: number; y: number }[];
      };
      const groups = new Map<string, ConnectorGroup>();
      const spanIndexById = new Map<string, number>();

      for (let i = 0; i < spans.length; i++) {
        spanIndexById.set(spans[i].spanId ?? spans[i].span_id, i);
      }

      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const parentId = span.parentSpanId ?? span.parent_span_id;
        if (!parentId) continue;
        const parentIdx = spanIndexById.get(parentId);
        if (parentIdx === undefined) continue;
        const parent = spans[parentIdx];

        const parentX = pad + gap * (parent.depth ?? 0) + colW / 2;
        const parentY = parentIdx * rowH + rowH / 2;
        const childY = i * rowH + rowH / 2;
        const childDepth = span.depth ?? 0;
        const childX = span.hasChildSpans
          ? pad + gap * childDepth
          : pad + gap * childDepth + colW;

        let group = groups.get(parentId);
        if (!group) {
          group = { x1: parentX, y1: parentY, y2: childY, children: [] };
          groups.set(parentId, group);
        }
        group.y2 = childY;
        group.children.push({ x: childX, y: childY });
      }

      return Array.from(groups.values());
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
      virtualRows,
      totalSize,
      connectorLines,
    };
  },
  components: { SpanBlock },
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

  .view-logs-container {
    visibility: hidden;
  }
}

.span-row {
  position: relative;
  min-height: 1.875rem;

  // Hover highlight via CSS only — no JS spanHoveredIndex needed
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
    visibility: visible !important;
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
