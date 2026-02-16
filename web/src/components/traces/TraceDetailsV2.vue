<!--
  TraceDetailsV2 - Modern Trace Details View (Based on Design)
  Matches the provided HTML/screenshot design
-->
<template>
  <div class="trace-details-v2 tw:flex tw:h-screen tw:overflow-hidden">
    <!-- Main Content -->
    <main class="tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden tw:bg-white">
      <!-- Header -->
      <header
        class="tw:h-14 tw:border-b tw:border-[var(--o2-border)] tw:flex! tw:items-center tw:justify-between tw:px-6 tw:bg-[var(--o2-surface)]"
      >
        <div class="tw:flex tw:items-center tw:space-x-4">
          <button
            v-if="showBackButton"
            @click="handleBack"
            class="tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)]"
          >
            <q-icon name="arrow_back" size="20px" />
          </button>
          <div class="tw:flex tw:flex-col">
            <div
              class="tw:text-base tw:font-semibold tw:leading-tight tw:text-[var(--o2-text-primary)]"
            >
              {{ traceMetadata?.root_operation || "Loading..." }}
            </div>
            <div
              class="tw:flex tw:items-center tw:space-x-2 tw:text-[11px] tw:text-[var(--o2-text-secondary)]"
            >
              <span class="tw:text-primary tw:font-medium">{{
                traceMetadata?.root_service
              }}</span>
              <span>•</span>
              <span>{{ formatTimestamp(traceMetadata?.start_time || 0) }}</span>
              <span>•</span>
              <span
                >Trace ID:
                <span class="tw:text-[var(--o2-text-primary)] tw:font-mono">{{
                  traceId
                }}</span></span
              >
            </div>
          </div>
        </div>
        <div class="tw:flex tw:items-center tw:space-x-3">
          <div
            class="tw:flex tw:items-center tw:space-x-1 tw:px-3 tw:py-1 tw:bg-white tw:border tw:border-[var(--o2-border)] tw:rounded tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-secondary)]"
          >
            <q-icon name="warning" size="14px" color="amber" />
            <span>0 anomalous spans</span>
          </div>
          <div
            class="tw:flex tw:items-center tw:space-x-1 tw:px-3 tw:py-1 tw:bg-white tw:border tw:border-[var(--o2-border)] tw:rounded tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-secondary)]"
          >
            <q-icon
              name="error_outline"
              size="14px"
              :color="traceMetadata?.has_errors ? 'negative' : undefined"
            />
            <span>{{ traceMetadata?.error_spans || 0 }} errors</span>
          </div>
          <div class="tw:h-6 tw:w-[1px] tw:bg-[var(--o2-border)] tw:mx-2"></div>
          <button
            class="tw:p-1.5 hover:tw:bg-slate-200 tw:rounded tw:text-[var(--o2-text-secondary)]"
          >
            <q-icon name="share" size="18px" />
          </button>
          <button
            class="tw:p-1.5 hover:tw:bg-slate-200 tw:rounded tw:text-[var(--o2-text-secondary)]"
            @click="handleBack"
          >
            <q-icon name="close" size="18px" />
          </button>
        </div>
      </header>

      <!-- Tabs & Search Bar -->
      <div
        class="tw:px-6 tw:py-0 tw:border-b tw:border-[var(--o2-border)] tw:flex tw:items-center tw:justify-between tw:bg-white"
      >
        <div class="tw:flex tw:items-center tw:space-x-4">
          <AppTabs
            :tabs="tabs"
            :active-tab="activeTab"
            @update:active-tab="activeTab = $event"
          />
        </div>
        <div class="tw:flex tw:items-center tw:space-x-2 o2-input">
          <q-input
            v-model="searchText"
            outlined
            dense
            placeholder="Find spans..."
            class="tw:w-64 tw:text-[12px]!"
          >
            <template v-slot:prepend>
              <q-icon name="search" size="14px" />
            </template>
          </q-input>
          <div
            class="tw:flex tw:text-[11px] tw:font-bold tw:tracking-wider tw:space-x-4 tw:ml-6 tw:uppercase"
          >
            <div class="tw:flex tw:flex-col tw:items-end">
              <span class="tw:text-[var(--o2-text-secondary)] tw:text-[9px]"
                >Trace duration</span
              >
              <span class="tw:text-[var(--o2-text-primary)]">{{
                formatDuration(traceMetadata?.duration_ms || 0)
              }}</span>
            </div>
            <div class="tw:flex tw:flex-col tw:items-end">
              <span class="tw:text-[var(--o2-text-secondary)] tw:text-[9px]"
                >Backend duration</span
              >
              <span class="tw:text-[var(--o2-text-primary)]">{{
                formatDuration((traceMetadata?.duration_ms || 0) * 0.96)
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="tw:flex-1 tw:flex tw:overflow-hidden">
        <!-- Waterfall View -->
        <div
          class="tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden tw:border-r tw:border-[var(--o2-border)]"
        >
          <div class="tw:flex-1 tw:overflow-auto tw:bg-white">
            <!-- Table Header -->
            <div
              class="tw:grid tw:grid-cols-12 tw:gap-0 tw:sticky tw:top-0 tw:bg-[var(--o2-surface)] tw:z-10 tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:tracking-widest tw:border-b tw:border-[var(--o2-border)] tw:py-2 tw:px-6"
            >
              <div class="tw:col-span-4">Span / Operation</div>
              <div class="tw:col-span-2">Service</div>
              <div class="tw:col-span-1">Duration</div>
              <div class="tw:col-span-5 tw:relative">
                <div class="tw:flex tw:justify-between">
                  <span>0ms</span>
                  <span>{{
                    formatDuration((traceMetadata?.duration_ms || 0) * 0.25)
                  }}</span>
                  <span>{{
                    formatDuration((traceMetadata?.duration_ms || 0) * 0.5)
                  }}</span>
                  <span>{{
                    formatDuration((traceMetadata?.duration_ms || 0) * 0.75)
                  }}</span>
                  <span>{{
                    formatDuration(traceMetadata?.duration_ms || 0)
                  }}</span>
                </div>
              </div>
            </div>

            <!-- Span Rows -->
            <div class="tw:py-0">
              <TraceTreeRow
                v-for="span in flattenedSpans"
                :key="span.span_id"
                :span="span"
                :is-selected="span.span_id === selectedSpanId"
                :is-expanded="expandedSpanIds.has(span.span_id)"
                @span-clicked="handleSpanSelect"
                @toggle-expand="handleSpanToggle"
              />
            </div>
          </div>

          <!-- Bottom Panel - Span Details -->
          <div
            v-if="selectedSpan"
            class="tw:h-[380px] tw:border-t tw:border-[var(--o2-border)] tw:flex tw:flex-col tw:bg-white"
          >
            <!-- Tabs -->
            <div
              class="tw:px-6 tw:py-0 tw:border-b tw:border-[var(--o2-border)] tw:flex tw:items-center tw:space-x-6 tw:text-xs tw:font-bold tw:uppercase tw:tracking-wider"
            >
              <span
                v-for="tab in detailTabs"
                :key="tab.value"
                @click="activeDetailTab = tab.value"
                class="tw:py-3 tw:cursor-pointer tw:border-b-2"
                :class="
                  activeDetailTab === tab.value
                    ? 'tw:text-primary tw:border-primary'
                    : 'tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)] tw:border-transparent'
                "
              >
                {{ tab.label }}
              </span>
            </div>

            <!-- Content -->
            <div class="tw:flex-1 tw:flex tw:overflow-hidden">
              <!-- Left: Attributes & JSON -->
              <div
                class="tw:flex-1 tw:p-6 tw:overflow-auto tw:text-xs tw:space-y-6"
              >
                <div>
                  <div
                    class="tw:text-[var(--o2-text-secondary)] tw:uppercase tw:text-[10px] tw:font-bold tw:tracking-widest tw:mb-4"
                  >
                    Attributes
                  </div>
                  <div class="tw:grid tw:grid-cols-2 tw:gap-y-3 tw:gap-x-12">
                    <div
                      v-for="[key, value] in Object.entries(
                        selectedSpan.attributes || {},
                      ).slice(0, 6)"
                      :key="key"
                      class="tw:flex tw:justify-between tw:border-b tw:border-[var(--o2-border)] tw:pb-1.5"
                    >
                      <span class="tw:text-[var(--o2-text-secondary)]">{{
                        key
                      }}</span>
                      <span
                        class="tw:text-[var(--o2-text-primary)] tw:font-mono tw:font-medium tw:truncate tw:ml-4"
                        >{{ value }}</span
                      >
                    </div>
                  </div>
                </div>

                <div class="tw:pt-2">
                  <div
                    class="tw:text-[var(--o2-text-secondary)] tw:uppercase tw:text-[10px] tw:font-bold tw:tracking-widest tw:mb-3"
                  >
                    JSON Representation
                  </div>
                  <pre
                    class="tw:bg-[var(--o2-surface)] tw:p-4 tw:rounded-lg tw:text-[11px] tw:text-indigo-700 tw:font-mono tw:overflow-auto tw:max-h-44 tw:border tw:border-[var(--o2-border)]"
                    >{{ JSON.stringify(selectedSpan, null, 2) }}</pre
                  >
                </div>
              </div>

              <!-- Right: Charts & Summary -->
              <div
                class="tw:w-80 tw:border-l tw:border-[var(--o2-border)] tw:bg-[var(--o2-surface)] tw:p-5 tw:overflow-auto"
              >
                <SpanAnalyticsPanel
                  :trace-metadata="traceMetadata"
                  :service-breakdown="serviceBreakdown"
                  @span-clicked="handleSpanSelect"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Right Sidebar - Quick Filter -->
        <aside
          class="tw:w-72 tw:flex-shrink-0 tw:bg-[var(--o2-surface)] tw:p-5 tw:overflow-auto tw:border-l tw:border-[var(--o2-border)]"
        >
          <QuickFilterPanel
            :services="availableServices"
            :active-filters="activeFilters"
            :span-count="filteredSpanCount"
            @filter-changed="handleFilterChange"
            @filter-reset="handleFilterReset"
          />
        </aside>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent } from "vue";
import {
  type Span,
  type EnrichedSpan,
  type SpanFilter,
} from "@/types/traces/span.types";
import { type TraceMetadata } from "@/types/traces/trace.types";
import {
  useTraceProcessing,
  formatDuration,
  formatTimestamp,
} from "@/composables/traces/useTraceProcessing";

// Component imports
import AppTabs from "@/components/common/AppTabs.vue";

// Async component imports
const TraceTreeRow = defineAsyncComponent(() => import("./TraceTreeRow.vue"));
const QuickFilterPanel = defineAsyncComponent(
  () => import("./QuickFilterPanel.vue"),
);
const SpanAnalyticsPanel = defineAsyncComponent(
  () => import("./SpanAnalyticsPanel.vue"),
);

// Props
interface Props {
  traceId: string;
  spans: Span[];
  showBackButton?: boolean;
  isLoading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showBackButton: false,
  isLoading: false,
});

// Emits
const emit = defineEmits<{
  back: [];
  spanSelected: [spanId: string];
}>();

// State
const selectedSpanId = ref<string | null>(null);
const expandedSpanIds = ref<Set<string>>(new Set());
const activeTab = ref("waterfall");
const activeDetailTab = ref("span-details");
const searchText = ref("");
const activeFilters = ref<SpanFilter>({
  services: [],
  statuses: [],
  kinds: [],
  errorOnly: false,
  searchText: "",
});

// Tabs
const tabs = [
  { label: "Waterfall", value: "waterfall" },
  { label: "Flame Graph", value: "flame-graph" },
  { label: "Spans", value: "spans" },
  { label: "Map", value: "map" },
];

const detailTabs = [
  { label: "Span Details", value: "span-details" },
  { label: "Infrastructure", value: "infrastructure" },
  { label: "Metrics", value: "metrics" },
  { label: "Logs", value: "logs" },
];

// Composables
const spanList = ref(props.spans);
const {
  spanTree: computedSpanTree,
  flatSpans,
  calculateMetadata,
  calculateServiceBreakdown,
  filterSpans,
} = useTraceProcessing(spanList);

// Watch for span changes
watch(
  () => props.spans,
  (newSpans) => {
    spanList.value = newSpans;
    // Auto-expand all spans by default
    expandedSpanIds.value = new Set(newSpans.map((s) => s.span_id));
  },
  { deep: true, immediate: true },
);

// Computed
const spanTree = computed(() => computedSpanTree.value);

const traceMetadata = computed<TraceMetadata | null>(() => {
  if (spanTree.value.length === 0) return null;
  try {
    return calculateMetadata(props.traceId, spanTree.value);
  } catch (e) {
    console.error("Error calculating trace metadata:", e);
    return null;
  }
});

const serviceBreakdown = computed(() => {
  if (!traceMetadata.value) return [];
  return calculateServiceBreakdown(traceMetadata.value);
});

const availableServices = computed(() => {
  return traceMetadata.value?.services || [];
});

const filteredSpans = computed(() => {
  return filterSpans(flatSpans.value, activeFilters.value);
});

const filteredSpanCount = computed(() => filteredSpans.value.length);

const flattenedSpans = computed(() => {
  const result: EnrichedSpan[] = [];

  const traverse = (span: EnrichedSpan) => {
    result.push(span);
    if (expandedSpanIds.value.has(span.span_id) && span.children.length > 0) {
      span.children.forEach(traverse);
    }
  };

  spanTree.value.forEach(traverse);
  return result;
});

const selectedSpan = computed(() => {
  if (!selectedSpanId.value) return null;
  return (
    flatSpans.value.find((s) => s.span_id === selectedSpanId.value) || null
  );
});

// Methods
const handleBack = () => {
  emit("back");
};

const handleSpanSelect = (spanId: string) => {
  selectedSpanId.value = spanId;
  emit("spanSelected", spanId);
};

const handleSpanToggle = (spanId: string) => {
  if (expandedSpanIds.value.has(spanId)) {
    expandedSpanIds.value.delete(spanId);
  } else {
    expandedSpanIds.value.add(spanId);
  }
  // Force reactivity
  expandedSpanIds.value = new Set(expandedSpanIds.value);
};

const handleFilterChange = (filter: SpanFilter) => {
  activeFilters.value = { ...activeFilters.value, ...filter };
};

const handleFilterReset = () => {
  activeFilters.value = {
    services: [],
    statuses: [],
    kinds: [],
    errorOnly: false,
    searchText: "",
  };
};
</script>

<style scoped lang="scss">
.trace-details-v2 {
  font-family:
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  background: var(--o2-background, #ffffff);
  color: var(--o2-text-primary, #1a1a1a);
}
</style>
