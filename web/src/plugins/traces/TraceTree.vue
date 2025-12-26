<!-- Copyright 2023 OpenObserve Inc.

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
  <div v-bind="$attrs" ref="rootContainer">
    <template v-for="(span, index) in spans as any[]" :key="span.spanId">
      <div
        :style="{
          position: 'relative',
          width: '100%',
          flexWrap: 'nowrap',
        }"
        class="flex span-row"
        :class="spanHoveredIndex === index ? 'span-row-highlight' : ''"
        :data-test="`trace-tree-span-container-${span.spanId}`"
        @mouseover="() => (spanHoveredIndex = index)"
        @mouseout="() => (spanHoveredIndex = -1)"
      >
        <div :style="{ width: leftWidth + 'px' }" class="tw:pl-[0.375rem]">
          <div
            :style="{
              height: '100%',
              margin: `0 0 0 ${
                span.hasChildSpans
                  ? span.style.left
                  : parseInt(span.style.left) +
                    spanDimensions.collapseWidth +
                    'px'
              }`,
            }"
            class="flex items-start justify-start ellipsis"
            :title="span.operationName"
          >
            <div
              class="flex no-wrap q-pt-sm full-width relative-position operation-name-container"
              :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
              :data-test="`trace-tree-span-operation-name-container-${span.spanId}`"
            >
              <div
                class="absolute view-logs-container"
                :class="spanHoveredIndex === index ? 'show' : ''"
                :data-test="`trace-tree-span-view-logs-container-${span.spanId}`"
              >
                <q-btn
                  class="q-mx-xs view-span-logs"
                  :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
                  size="0.625rem"
                  icon="search"
                  dense
                  no-caps
                  :title="t('traces.viewLogs')"
                  @click.stop="viewSpanLogs(span)"
                  :data-test="`trace-tree-span-view-logs-btn-${span.spanId}`"
                >
                  <!-- <span class="text view-logs-btn-text">View Logs</span> -->
                </q-btn>
              </div>
              <div
                v-if="span.hasChildSpans"
                class="span-count-box cursor-pointer"
                :ref="(el) => setBadgeRef(span.spanId, el)"
                :style="{
                  borderColor: span.style.color,
                  color: span.style.color,
                }"
                @click.stop="toggleSpanCollapse(span.spanId)"
                :data-test="`trace-tree-span-badge-collapse-btn-${span.spanId}`"
                :title="`Click to ${collapseMapping[span.spanId] ? 'expand' : 'collapse'}`"
              >
                {{ getChildCount(span) }}
              </div>

              <div
                v-else
                class="span-leaf-dot"
                :ref="(el) => setBadgeRef(span.spanId, el)"
                :style="{
                  backgroundColor: span.style.color,
                }"
              ></div>

              <div
                class="ellipsis q-pl-xs cursor-pointer span-name-section"
                @click="selectSpan(span.spanId)"
                :data-test="`trace-tree-span-select-btn-${span.spanId}`"
              >
                <q-icon
                  v-if="span.spanStatus === 'ERROR'"
                  name="error"
                  class="text-red-6 q-mr-xs"
                  title="Error Span"
                  :data-test="`trace-tree-span-error-icon-${span.spanId}`"
                />
                <span
                  class="text-subtitle2 text-bold q-mr-sm"
                  :class="{
                    highlighted: isHighlighted(span.spanId),
                    'tw:text-gray-900':
                      store.state.theme === 'dark' &&
                      isHighlighted(span.spanId),
                    'current-match': currentSelectedValue === span.spanId, // Current match class
                  }"
                  :data-test="`trace-tree-span-service-name-${span.spanId}`"
                >
                  {{ span.serviceName }}
                </span>
                <span
                  class="text-body2"
                  :class="
                    store.state.theme === 'dark'
                      ? 'text-grey-5'
                      : 'text-blue-grey-9'
                  "
                  :data-test="`trace-tree-span-operation-name-${span.spanId}`"
                  >{{ span.operationName }}</span
                >
              </div>
            </div>
            <div
              class="span-background-wrapper"
              :style="{
                backgroundColor: span.style.backgroundColor,
                height: `calc(100% - 1.875rem)`,
                borderLeft: `0.1875rem solid ${span.style.color}`,
                marginLeft: span.hasChildSpans ? '0.875rem' : '0',
                width: '100%',
                position: 'relative',
              }"
              :data-test="`trace-tree-span-background-${span.spanId}`"
            ></div>
          </div>
        </div>
        <div :style="{ width: `calc(100% - ${leftWidth}px)` }">
          <span-block
            :span="span"
            :depth="depth"
            :baseTracePosition="baseTracePosition"
            :styleObj="{
              position: 'absolute',
              top: span.style.top,
              left: span.style.left,
              height: '3.75rem',
            }"
            :spanDimensions="spanDimensions"
            :isCollapsed="collapseMapping[span.spanId]"
            :spanData="spanMap[span.spanId]"
            :class="spanHoveredIndex === index ? 'span-block-highlight' : ''"
            @toggle-collapse="toggleSpanCollapse"
            @select-span="selectSpan"
            @view-logs="viewSpanLogs(span)"
          />
        </div>
      </div>
    </template>

    <!-- SVG overlay for connectors -->
    <svg
      v-if="Object.keys(connectorPaths).length > 0"
      class="connector-overlay"
      :style="{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
        overflow: 'visible',
      }"
    >
      <template v-for="(connector, key) in connectorPaths" :key="key">
        <!-- Vertical line -->
        <line
          :x1="connector.x1"
          :y1="connector.y1"
          :x2="connector.x1"
          :y2="connector.y2"
          :stroke="connector.color"
          stroke-width="1.5"
          opacity="0.6"
        />
        <!-- Horizontal lines to children -->
        <template v-for="(child, idx) in connector.children" :key="idx">
          <line
            :x1="connector.x1"
            :y1="child.y"
            :x2="child.x"
            :y2="child.y"
            :stroke="connector.color"
            stroke-width="1.5"
            opacity="0.6"
          />
        </template>
      </template>
    </svg>
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
import { getImageURL } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import { useStore } from "vuex";
import SpanBlock from "./SpanBlock.vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

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
  },
  emits: [
    "toggleCollapse",
    "selectSpan",
    "update-current-index",
    "search-result",
  ],
  setup(props, { emit }) {
    const { searchObj, buildQueryDetails, navigateToLogs } = useTraces();
    const store = useStore();

    const { t } = useI18n();

    const spanHoveredIndex = ref(-1);

    const router = useRouter();

    const badgeRefs = ref<Record<string, HTMLElement>>({});
    const connectorPaths = ref<Record<string, any>>({});
    const rootContainer = ref<HTMLElement | null>(null);

    const setBadgeRef = (spanId: string, el: any) => {
      if (el) {
        badgeRefs.value[spanId] = el;
      }
    };

    function toggleSpanCollapse(spanId: number | string) {
      emit("toggleCollapse", spanId);
    }
    const selectSpan = (spanId: string) => {
      emit("selectSpan", spanId);
    };

    // Main function to view span logs
    const viewSpanLogs = (span: any) => {
      const queryDetails = buildQueryDetails(span);
      navigateToLogs(queryDetails);
    };

    const getChildCount = (span: any): number => {
      if (!span.spans || !Array.isArray(span.spans)) return 0;
      return span.spans.length;
    };

    const getDirectChildren = (span: any) => {
      if (!span.spans || !Array.isArray(span.spans)) return [];
      return span.spans;
    };

    const getChildrenHeight = (span: any): number => {
      if (
        !span.spans ||
        !Array.isArray(span.spans) ||
        !props.collapseMapping[span.spanId]
      ) {
        return 0;
      }

      const countVisibleChildren = (children: any[]): number => {
        let count = 0;
        children.forEach((child: any) => {
          count++;
          if (
            child.spans &&
            child.spans.length > 0 &&
            props.collapseMapping[child.spanId]
          ) {
            count += countVisibleChildren(child.spans);
          }
        });
        return count;
      };

      return countVisibleChildren(span.spans);
    };

    const calculateConnectors = () => {
      if (!rootContainer.value) return;

      const newConnectorPaths: Record<string, any> = {};
      const containerRect = rootContainer.value.getBoundingClientRect();
      if (props.spans && Array.isArray(props.spans)) {
        props.spans.forEach((span: any) => {
          if (span.hasChildSpans && props.collapseMapping[span.spanId]) {
            const parentBadge = badgeRefs.value[span.spanId];
            if (!parentBadge) return;

            const parentRect = parentBadge.getBoundingClientRect();
            const parentX =
              parentRect.left - containerRect.left + parentRect.width / 2;
            const parentY = parentRect.bottom - containerRect.top;

            const children = getDirectChildren(span);
            const childPositions: any[] = [];
            let lastChildY = parentY;

            children.forEach((child: any) => {
              const childBadge = badgeRefs.value[child.spanId];
              if (childBadge) {
                const childRect = childBadge.getBoundingClientRect();
                const childX = childRect.left - containerRect.left;
                const childY =
                  childRect.top - containerRect.top + childRect.height / 2;

                childPositions.push({
                  x: childX,
                  y: childY,
                  isLeaf: !child.hasChildSpans,
                });

                lastChildY = childY;
              }
            });

            if (childPositions.length > 0) {
              newConnectorPaths[span.spanId] = {
                x1: parentX,
                y1: parentY,
                x2: parentX,
                y2: lastChildY,
                color: span.style.color,
                children: childPositions,
              };
            }
          }
        });
      }

      connectorPaths.value = newConnectorPaths;
    };

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
        .map((span: any, index: any) => {
          // Check if any span value matches the query
          const matches = Object.entries(span).some(([key, value]) => {
            if (typeof value === "string" || typeof value === "number") {
              // Special handling for duration
              if (key === "duration") {
                const formattedDuration = `${value}us`; // Format duration with "us"
                return (
                  String(value).toLowerCase().includes(query) ||
                  formattedDuration.toLowerCase().includes(query)
                );
              }
              return String(value).toLowerCase().includes(query);
            }
            return false; // Skip non-string/non-number values
          });
          // Return the index if a match is found, otherwise return -1
          return matches ? span.span_id : -1;
        })
        .filter((index: any) => index !== -1);
    };
    const updateSearch = () => {
      if (props.searchQuery?.trim()) {
        searchResults.value = findMatches(props.spanList, props.searchQuery);
        currentIndex.value = 0; // Reset to first match
        nextTick(() => {
          scrollToMatch(); // Wait for DOM updates before scrolling
        });
      } else {
        searchResults.value = [];
        currentIndex.value = null;
      }
    };

    const isHighlighted = (path: any) => {
      // If the path is an array, join it and compare with resultPath joined
      if (Array.isArray(path)) {
        return searchResults.value.some(
          (resultPath: any) => resultPath.join(",") === path.join(","),
        );
      }

      // If path is a single value (index), compare it directly
      return searchResults.value.includes(path);
    };

    const scrollToMatch = () => {
      if (searchResults.value.length > 0) {
        const matchElement = document.querySelector(`.current-match`);
        if (matchElement) {
          matchElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }
    };

    const nextMatch = () => {
      if (
        currentIndex.value !== null &&
        currentIndex.value < searchResults.value.length - 1
      ) {
        currentIndex.value++;
        nextTick(() => {
          scrollToMatch(); // Wait for DOM updates before scrolling
        });
      }
    };

    const prevMatch = () => {
      if (currentIndex.value !== null && currentIndex.value > 0) {
        currentIndex.value--;
        nextTick(() => {
          scrollToMatch(); // Wait for DOM updates before scrolling
        });
      }
    };

    watch(
      () => props.searchQuery,
      (newValue) => {
        updateSearch();
      },
    );
    watch(currentIndex, (newValue) => {
      emit("update-current-index", newValue);
    });
    watch(searchResults, (newValue) => {
      emit("search-result", newValue.length);
    });

    // Watch for changes that require recalculating connectors
    watch(
      () => [props.spans, props.collapseMapping],
      () => {
        nextTick(() => {
          // Use setTimeout to ensure all refs are set after DOM updates
          setTimeout(() => {
            calculateConnectors();
          }, 0);
        });
      },
      { deep: true },
    );

    onMounted(() => {
      nextTick(() => {
        // Use setTimeout to ensure all refs are set after DOM updates
        setTimeout(() => {
          calculateConnectors();
        }, 0);
      });
    });

    return {
      toggleSpanCollapse,
      getImageURL,
      selectSpan,
      store,
      viewSpanLogs,
      t,
      spanHoveredIndex,
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
      getDirectChildren,
      getChildrenHeight,
      setBadgeRef,
      connectorPaths,
      calculateConnectors,
      rootContainer,
    };
  },
  components: { SpanBlock },
});
</script>

<style scoped lang="scss">
.view-logs-container {
  top: 0.25rem;
  right: 0;
}
.spans-container {
  position: relative;
}

.span-count-box {
  min-width: 1.5rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  border-radius: 0.25rem;
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

.operation-name-container {
  height: 1.875rem;
  overflow: visible;

  .view-logs-container {
    visibility: hidden;
  }
  .view-logs-container {
    &.show {
      visibility: visible !important;
    }
  }
}

.span-row {
  position: relative;
  min-height: 1.875rem;

  &.span-row-highlight {
    &::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1.875rem;
      background-color: rgba(0, 123, 255, 0.2);
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

.span-block-highlight {
  .bg-dark,
  .bg-white {
    background-color: transparent !important;
  }
}
</style>
