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
    ref="catalogContainerRef"
    class="services-catalog h-full! flex flex-col bg-[var(--o2-card-bg-solid)] card-container px-[0.625rem] relative overflow-hidden"
  >
    <!-- Toolbar: stream selector + filter + chips + legend -->
    <div class="flex items-center gap-2 py-[0.625rem]">
      <!-- Stream selector -->
      <div
        data-test="services-catalog-stream-selector"
        class="w-[11rem] flex-shrink-0"
      >
        <OSelect
          :model-value="streamFilter"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-[auto] flex-shrink-0 rounded"
          :disabled="availableStreams.length === 0"
          @update:model-value="onStreamFilterChange"
        />
        <OTooltip v-if="availableStreams.length === 0" :content="t('traces.servicesCatalog.noStreamsDetected')" />
      </div>

      <!-- Search input -->
      <div>
        <OSearchInput
          v-model="filterText"
          :placeholder="t('traces.servicesCatalog.filterPlaceholder')"
          clearable
          :debounce="300"
          class="w-[14rem]!"
          data-test="services-catalog-filter-input"
        />
      </div>

      <!-- Entity-type filter: Services / Datastores / Queues / External / RPC.
           Mirrors the Streams page type tabs; defaults to Services. -->
      <OToggleGroup
        v-if="!isLoading && services.length > 0"
        :model-value="typeFilter"
        data-test="services-catalog-type-filter"
        @update:model-value="(v) => onTypeFilterChange(v as string)"
      >
        <OToggleGroupItem
          v-for="cat in visibleTypeFilters"
          :key="cat"
          :value="cat"
          size="sm"
          :class="tabStatusClass(cat)"
          :data-test="`services-catalog-type-${cat}`"
        >
          {{ t(`traces.servicesCatalog.types.${cat}`) }}
          <span class="opacity-60">{{ categoryCounts[cat] }}</span>
          <!-- Unhealthy count in a filled circle, colored by the tab's worst
               status. The solid circle reads as "N problems", distinct from the
               plain total to its left. Hover explains it. -->
          <span
            v-if="categoryUnhealthyCounts[cat] > 0"
            class="inline-flex items-center justify-center min-w-[1.05rem] h-[1.05rem] px-[0.25rem] rounded-full text-[0.65rem] font-semibold leading-none text-white"
            :style="{ backgroundColor: tabStatusColorVar(cat) }"
            :data-test="`services-catalog-type-unhealthy-${cat}`"
          >
            {{ categoryUnhealthyCounts[cat] }}
            <OTooltip
              :content="
                t('traces.servicesCatalog.unhealthyTooltip', {
                  count: categoryUnhealthyCounts[cat],
                  status: t(
                    `traces.servicesCatalog.status.${categoryWorstStatus[cat]}`,
                  ),
                })
              "
            />
          </span>
        </OToggleGroupItem>
      </OToggleGroup>

      <template v-if="!isLoading && services.length > 0">
        <!-- Entity count is already shown per-tab in the type filter, so no
             separate total pill here — only the health-status pills below. -->
        <template v-if="statusCounts.critical > 0">
          <div
            class="inline-flex items-center gap-[0.375rem] px-[0.625rem] py-[0.25rem] rounded text-[0.75rem] font-medium bg-[color-mix(in_srgb,var(--o2-service-health-critical)_12%,transparent)] text-[var(--o2-service-health-critical)]"
            data-test="services-catalog-pill-critical"
          >
            <span>{{ statusCounts.critical }}</span>
            <span>{{ t("traces.servicesCatalog.status.critical") }}</span>
            <OTooltip>
              <template #content>
                {{ t("traces.servicesCatalog.status.critical") }}: &gt; 10%
                {{ t("traces.servicesCatalog.legend.title").toLowerCase() }}
              </template>
            </OTooltip>
          </div>
        </template>
        <template v-if="statusCounts.warning > 0">
          <div
            class="inline-flex items-center gap-[0.375rem] px-[0.625rem] py-[0.25rem] rounded text-[0.75rem] font-medium bg-[color-mix(in_srgb,var(--o2-service-health-warning)_12%,transparent)] text-[var(--o2-service-health-warning)]"
            data-test="services-catalog-pill-warning"
          >
            <span>{{ statusCounts.warning }}</span>
            <span>{{ t("traces.servicesCatalog.status.warning") }}</span>
            <OTooltip>
              <template #content>
                {{ t("traces.servicesCatalog.status.warning") }}: 5 – 10%
                {{ t("traces.servicesCatalog.legend.title").toLowerCase() }}
              </template>
            </OTooltip>
          </div>
        </template>
        <template v-if="statusCounts.degraded > 0">
          <div
            class="inline-flex items-center gap-[0.375rem] px-[0.625rem] py-[0.25rem] rounded text-[0.75rem] font-medium bg-[color-mix(in_srgb,var(--o2-service-health-degraded)_12%,transparent)] text-[var(--o2-service-health-degraded)]"
            data-test="services-catalog-pill-degraded"
          >
            <span>{{ statusCounts.degraded }}</span>
            <span>{{ t("traces.servicesCatalog.status.degraded") }}</span>
            <OTooltip>
              <template #content>
                {{ t("traces.servicesCatalog.status.degraded") }}: 1 – 5%
                {{ t("traces.servicesCatalog.legend.title").toLowerCase() }}
              </template>
            </OTooltip>
          </div>
        </template>
      </template>

      <!-- pagination controls -->
      <div
        v-if="services.length > 0"
        class="flex items-center justify-end px-[0.5rem] py-[0.25rem] ml-auto"
        data-test="services-catalog-pagination-bar"
      >
        <OSelect
          v-model="rowsPerPage"
          :options="rowsPerPageOptions"
          class="select-pagination mr-[0.25rem] mt-0!"
          size="sm"
          data-test="services-catalog-records-per-page"
          @update:model-value="changeRowsPerPage"
        />
        <OPagination
          v-model="currentPage"
          :max="totalPages"
          class="float-right paginator-section mt-0!"
          data-test="services-catalog-pagination"
          @update:model-value="changePage"
        />
      </div>
      <!-- Status legend -->
      <!-- <div
        class="ml-auto flex items-center gap-3 px-[0.625rem] py-[0.325rem] rounded border border-[var(--o2-border-color)]"
        data-test="services-catalog-status-legend"
      >
        <span
          class="text-[0.7rem] font-bold text-[var(--o2-text-4)] whitespace-nowrap"
        >
          {{ t("traces.servicesCatalog.legend.title") }}
        </span>
        <div class="flex items-center gap-[0.875rem]">
          <div
            class="flex items-center gap-[0.375rem]"
            data-test="services-catalog-legend-healthy"
          >
            <span class="sc-legend-dot sc-legend-dot--healthy" />
            <span
              class="text-[0.7rem] font-semibold text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.healthy") }}</span
            >
            <span
              class="text-[0.65rem] opacity-55 text-[var(--o2-text-4)]"
              >&lt;&nbsp;1%</span
            >
          </div>
          <div
            class="flex items-center gap-[0.375rem]"
            data-test="services-catalog-legend-degraded"
          >
            <span class="sc-legend-dot sc-legend-dot--degraded" />
            <span
              class="text-[0.7rem] font-semibold text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.degraded") }}</span
            >
            <span
              class="text-[0.65rem] opacity-55 text-[var(--o2-text-4)]"
              >1&nbsp;–&nbsp;5%</span
            >
          </div>
          <div
            class="flex items-center gap-[0.375rem]"
            data-test="services-catalog-legend-warning"
          >
            <span class="sc-legend-dot sc-legend-dot--warning" />
            <span
              class="text-[0.7rem] font-semibold text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.warning") }}</span
            >
            <span
              class="text-[0.65rem] opacity-55 text-[var(--o2-text-4)]"
              >5&nbsp;–&nbsp;10%</span
            >
          </div>
          <div
            class="flex items-center gap-[0.375rem]"
            data-test="services-catalog-legend-critical"
          >
            <span class="sc-legend-dot sc-legend-dot--critical" />
            <span
              class="text-[0.7rem] font-semibold text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.critical") }}</span
            >
            <span
              class="text-[0.65rem] opacity-55 text-[var(--o2-text-4)]"
              >&gt;&nbsp;10%</span
            >
          </div>
        </div>
      </div> -->
    </div>

    <!-- Empty state (shown when not loading and no data) -->
    <div
      v-if="!isLoading && services.length === 0"
      class="flex flex-col items-center justify-center flex-1"
      data-test="services-catalog-empty"
    >
      <ServicesCatalogNoDataState />
    </div>

    <!-- Table -->
    <div
      v-else
      class="w-full h-auto! overflow-x-auto relative flex-1"
    >
      <TenstackTable
        class="h-auto!"
        :rows="paginatedServices"
        :columns="tableColumns"
        :loading="isLoading"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        :row-height="38"
        :enable-column-reorder="true"
        :enable-row-expand="false"
        :enable-text-highlight="false"
        :enable-status-bar="false"
        :default-columns="false"
        data-test="services-catalog-table"
        @click:dataRow="handleRowClick"
        @sort-change="handleSortChange"
      >
        <!-- Status badge -->
        <template #cell-status="{ item }">
          <OTag
            type="serviceStatus"
            :value="item.status"
            :data-test="`services-catalog-status-${item.service_name}`"
          >
            {{ t(`traces.servicesCatalog.status.${item.status}`) }}
          </OTag>
        </template>

        <!-- Service name via TraceServiceCell -->
        <template #cell-service_name="{ item }">
          <TraceServiceCell
            :item="item"
            class="cursor-pointer"
            :data-test="`services-catalog-service-link-${item.service_name}`"
            @click.stop="handleRowClick(item)"
          />
        </template>

        <!-- Error rate with progress bar -->
        <template #cell-error_rate="{ item }">
          <ServiceCatalogBarCell
            :value="item.error_rate"
            :max="columnMaxes.error_rate"
            :label="formatPercent(item.error_rate)"
            :variant="item.error_rate > 10 ? 'danger' : item.error_rate > 5 ? 'warning' : 'default'"
            :data-test="`services-catalog-error-rate-${item.service_name}`"
          />
        </template>

        <!-- Request / error count columns -->
        <template #cell-total_requests="{ item }">
          <span :data-test="`services-catalog-requests-${item.service_name}`">
            {{ formatLargeNumber(item.total_requests) }}
            <OTooltip :content="item.total_requests.toLocaleString()" />
          </span>
        </template>

        <template #cell-error_count="{ item }">
          <span :data-test="`services-catalog-errors-${item.service_name}`">
            {{ formatLargeNumber(item.error_count) }}
            <OTooltip :content="item.error_count.toLocaleString()" />
          </span>
        </template>

        <!-- Latency / duration columns -->
        <template #cell-p50_latency_ns="{ item }">
          <ServiceCatalogBarCell
            :value="item.p50_latency_ns"
            :max="columnMaxes.p50_latency_ns"
            :label="formatLat(item.p50_latency_ns)"
            :tooltip="item.p50_latency_ns.toLocaleString() + ' ns'"
          />
        </template>

        <template #cell-p95_latency_ns="{ item }">
          <ServiceCatalogBarCell
            :value="item.p95_latency_ns"
            :max="columnMaxes.p95_latency_ns"
            :label="formatLat(item.p95_latency_ns)"
            :tooltip="item.p95_latency_ns.toLocaleString() + ' ns'"
          />
        </template>

        <template #cell-p99_latency_ns="{ item }">
          <ServiceCatalogBarCell
            :value="item.p99_latency_ns"
            :max="columnMaxes.p99_latency_ns"
            :label="formatLat(item.p99_latency_ns)"
            :tooltip="item.p99_latency_ns.toLocaleString() + ' ns'"
            :variant="item.p99_latency_ns > P99_WARN_NS ? 'warning' : 'default'"
          />
        </template>

        <template #cell-avg_duration_ns="{ item }">
          <ServiceCatalogBarCell
            :value="item.avg_duration_ns"
            :max="columnMaxes.avg_duration_ns"
            :label="formatLat(item.avg_duration_ns)"
            :tooltip="item.avg_duration_ns.toLocaleString() + ' ns'"
          />
        </template>

        <template #cell-max_duration_ns="{ item }">
          <ServiceCatalogBarCell
            :value="item.max_duration_ns"
            :max="columnMaxes.max_duration_ns"
            :label="formatLat(item.max_duration_ns)"
            :tooltip="item.max_duration_ns.toLocaleString() + ' ns'"
          />
        </template>

        <!-- Cell actions overlay -->
        <template #cell-actions="{ row, column, active }">
          <CellActions
            v-if="active && !column.columnDef.meta?.disableCellAction"
            :column="column"
            :row="row"
            :selected-stream-fields="searchObj.data.stream.selectedStreamFields"
            :hide-search-term-actions="false"
            :hide-ai="true"
            @copy="qCopyToClipboard(String(row[column.id]))"
            @add-search-term="addSearchTerm"
          />
        </template>

        <template #empty />
      </TenstackTable>
    </div>

    <!-- Service node side panel -->
    <ServiceGraphNodeSidePanel
      v-if="selectedServiceRow"
      :selected-node="selectedServiceNode"
      :graph-data="emptyGraphData"
      :time-range="timeRange"
      :visible="showSidePanel"
      :stream-filter="streamFilter"
      :container-el="catalogContainerRef"
      data-test="services-catalog-node-side-panel"
      @close="handleCloseSidePanel"
      @view-traces="viewTraces"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { copyToClipboard as qCopyToClipboard } from "@/utils/clipboard";
import TenstackTable from "@/components/TenstackTable.vue";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import TraceServiceCell from "./components/TraceServiceCell.vue";
import ServiceCatalogBarCell from "./components/ServiceCatalogBarCell.vue";
import ServiceGraphNodeSidePanel from "./ServiceGraphNodeSidePanel.vue";
import useTraces from "@/composables/useTraces";
import useStreams from "@/composables/useStreams";
import useHttpStreaming from "@/composables/useStreamingSearch";
import streamService from "@/services/stream";
import { formatLatency } from "@/utils/traces/treeTooltipHelpers";
import {
  b64EncodeUnicode,
  generateTraceContext,
  formatLargeNumber,
  formatTimeWithSuffix,
} from "@/utils/zincutils";
import { getEffectiveTimeRange } from "@/utils/date";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ServicesCatalogNoDataState from "./ServicesCatalogNoDataState.vue";

const { t } = useI18n();
const store = useStore();
const catalogContainerRef = ref<HTMLElement | null>(null);
const { searchObj } = useTraces();
const { getStreams } = useStreams();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();

const emit = defineEmits<{
  "view-traces": [data: string | Record<string, any>];
  "request:stream-change": [stream: string];
}>();

// p99 > 1 second triggers the orange highlight
const P99_WARN_NS = 1_000_000_000;

// Stream filter — synced from traces page selected stream
const tracesStream = searchObj.data.stream?.selectedStream?.value || "";
const storedStreamFilter = localStorage.getItem("servicesCatalog_streamFilter");
const streamFilter = ref(tracesStream || storedStreamFilter || "default");
const availableStreams = ref<string[]>([]);

interface ServiceRow {
  service_name: string;
  status: "healthy" | "degraded" | "warning" | "critical";
  total_requests: number;
  error_count: number;
  error_rate: number;
  avg_duration_ns: number;
  max_duration_ns: number;
  p50_latency_ns: number;
  p95_latency_ns: number;
  p99_latency_ns: number;
  infer_service_name?: string;
  infer_service_system?: string;
  infer_service_type?: string;
  /** 1 when this entity emits its own spans (a real instrumented service). */
  is_real_service?: number;
}

// Entity categories mirror the trace-inference taxonomy (infer_service_type).
// Instrumented services have no infer_service_type; inferred dependencies carry
// one of database/queue/external/rpc. A row always resolves to exactly one of
// these concrete categories.
type EntityCategory = "service" | "datastore" | "queue" | "external" | "rpc";
// The type-filter selector additionally offers "all" (every category mixed).
// "all" is a filter value only — a row is never classified as "all".
type TypeFilter = "all" | EntityCategory;
const CATEGORY_ORDER: EntityCategory[] = [
  "service",
  "datastore",
  "queue",
  "external",
  "rpc",
];
// Tab order in the type filter: All first, then each concrete category.
const TYPE_FILTER_ORDER: TypeFilter[] = ["all", ...CATEGORY_ORDER];

/**
 * Map a row to a catalog category.
 *
 * Collision rule (data-proven): an entity that emits its own spans
 * (`is_real_service`) is a Service, even if it was ALSO inferred as external/rpc
 * because something called it over HTTP/gRPC — that inference is a false
 * positive. Only genuine, uninstrumented dependencies keep their inferred type.
 * RPC targets are always redundant with a real service→service edge, so they map
 * to service too (never a distinct RPC bucket). This mirrors the Service Graph.
 */
function categoryOf(row: ServiceRow): EntityCategory {
  if (row.is_real_service) return "service";
  switch ((row.infer_service_type ?? "").toLowerCase()) {
    case "database":
      return "datastore";
    case "queue":
      return "queue";
    case "external":
      return "external";
    case "rpc":
      return "rpc";
    default:
      return "service";
  }
}

/**
 * A phantom rpc dependency is an rpc-typed entity that is NOT a real service
 * (e.g. "oteldemo.CurrencyService"). Every such rpc call is already represented
 * by a real service→service edge, so it is dropped entirely — matching the
 * Service Graph, which suppresses rpc. Real services that happen to carry an
 * rpc inference are kept (is_real_service wins in categoryOf).
 */
function isPhantomRpc(row: ServiceRow): boolean {
  return (
    !row.is_real_service &&
    (row.infer_service_type ?? "").toLowerCase() === "rpc"
  );
}

const isLoading = ref(false);
const services = ref<ServiceRow[]>([]);
const filterText = ref("");
const typeFilter = ref<TypeFilter>("service");
const currentPage = ref(1);
const rowsPerPage = ref(25);
const rowsPerPageOptions = [10, 25, 50, 100];
const sortBy = ref<string>("status");
const sortOrder = ref<"asc" | "desc">("desc");
/**
 * Tri-state cache for whether the current stream's schema contains the `infer_service_name` column.
 *
 * - `null`  — not yet checked for the current stream; triggers a schema API call on next load.
 * - `true`  — column exists; queries will use `infer_service_name` for service grouping.
 * - `false` — column absent; queries will fall back to `service_name` only.
 *
 * The value is reset to `null` whenever the stream filter changes so that the next
 * `loadServicesCatalog()` call re-validates against the new stream's schema.
 */
const hasInferColumns = ref<boolean | null>(null);

const totalPages = computed(() =>
  filteredServices.value.length && rowsPerPage.value
    ? Math.max(1, Math.ceil(filteredServices.value.length / rowsPerPage.value))
    : 1,
);

const paginatedServices = computed(() => {
  const all = sortedServices.value;
  if (!all.length) return [];
  const start = (currentPage.value - 1) * rowsPerPage.value;
  return all.slice(start, start + rowsPerPage.value);
});

function changePage(page: number) {
  currentPage.value = page;
}

function changeRowsPerPage(val: number) {
  rowsPerPage.value = val;
  currentPage.value = 1;
}

function handleSortChange(field: string, order: "asc" | "desc") {
  sortBy.value = field;
  sortOrder.value = order;
  currentPage.value = 1;
}

const selectedServiceRow = ref<ServiceRow | null>(null);
const showSidePanel = ref(false);

const selectedServiceNode = computed(() =>
  selectedServiceRow.value
    ? {
        id: selectedServiceRow.value.service_name,
        name: selectedServiceRow.value.service_name,
        service_type: selectedServiceRow.value.infer_service_type,
      }
    : null,
);

const emptyGraphData = { nodes: [], edges: [] };

const timeRange = computed(() => ({
  startTime: searchObj.data.datetime.startTime,
  endTime: searchObj.data.datetime.endTime,
}));

let currentTraceId: string | null = null;

const tableColumns = computed(() => [
  {
    id: "service_name",
    header: t("traces.servicesCatalog.columns.serviceName"),
    accessorKey: "service_name",
    enableSorting: true,
    size: 260,
    meta: { slot: true, align: "left", sortable: true },
  },
  {
    id: "status",
    header: t("traces.servicesCatalog.columns.status"),
    accessorKey: "status",
    size: 90,
    enableSorting: true,
    sortingFn: (rowA: any, rowB: any) => {
      const order = { healthy: 0, degraded: 1, warning: 2, critical: 3 };
      return (
        (order[rowA.original.status as keyof typeof order] ?? 0) -
        (order[rowB.original.status as keyof typeof order] ?? 0)
      );
    },
    meta: {
      slot: true,
      align: "left",
      disableCellAction: true,
      sortable: true,
    },
  },
  {
    id: "total_requests",
    header: t("traces.servicesCatalog.columns.requests"),
    accessorKey: "total_requests",
    size: 110,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "error_count",
    header: t("traces.servicesCatalog.columns.errors"),
    accessorKey: "error_count",
    size: 90,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "error_rate",
    header: t("traces.servicesCatalog.columns.errorRate"),
    accessorKey: "error_rate",
    size: 110,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "p50_latency_ns",
    header: t("traces.servicesCatalog.columns.p50Latency"),
    accessorKey: "p50_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "p95_latency_ns",
    header: t("traces.servicesCatalog.columns.p95Latency"),
    accessorKey: "p95_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "p99_latency_ns",
    header: t("traces.servicesCatalog.columns.p99Latency"),
    accessorKey: "p99_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "avg_duration_ns",
    header: t("traces.servicesCatalog.columns.avgDuration"),
    accessorKey: "avg_duration_ns",
    size: 120,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
  {
    id: "max_duration_ns",
    header: t("traces.servicesCatalog.columns.maxDuration"),
    accessorKey: "max_duration_ns",
    size: 120,
    enableSorting: true,
    meta: { slot: true, align: "right", sortable: true },
  },
]);

// Health pill counts are scoped to the active type tab so they reflect the
// currently filtered set (e.g. "1 Degraded" among Datastores), not all entities.
const statusCounts = computed(() => ({
  critical: typeFilteredServices.value.filter((s) => s.status === "critical")
    .length,
  warning: typeFilteredServices.value.filter((s) => s.status === "warning")
    .length,
  degraded: typeFilteredServices.value.filter((s) => s.status === "degraded")
    .length,
}));

function colMax(key: keyof ServiceRow): number {
  const vals = filteredServices.value.map((s) => (s[key] as number) ?? 0);
  return vals.length ? Math.max(...vals) : 1;
}

const columnMaxes = computed(() => ({
  error_rate: colMax("error_rate"),
  p50_latency_ns: colMax("p50_latency_ns"),
  p95_latency_ns: colMax("p95_latency_ns"),
  p99_latency_ns: colMax("p99_latency_ns"),
  avg_duration_ns: colMax("avg_duration_ns"),
  max_duration_ns: colMax("max_duration_ns"),
}));

// Rows matching the active type tab, before the text filter is applied.
// "all" passes everything through; otherwise match the concrete category.
// Used both for the table and to compute the search-pill "N of M" totals.
const typeFilteredServices = computed(() =>
  typeFilter.value === "all"
    ? services.value
    : services.value.filter((s) => categoryOf(s) === typeFilter.value),
);

const filteredServices = computed(() => {
  const byType = typeFilteredServices.value;
  if (!filterText?.value?.trim()) return byType;
  const q = filterText.value?.trim().toLowerCase();
  return byType.filter((s) => s.service_name.toLowerCase().includes(q));
});

// Count of entities per category, plus the "all" total, for the tab badges.
const categoryCounts = computed<Record<TypeFilter, number>>(() => {
  const counts: Record<TypeFilter, number> = {
    all: services.value.length,
    service: 0,
    datastore: 0,
    queue: 0,
    external: 0,
    rpc: 0,
  };
  for (const s of services.value) counts[categoryOf(s)]++;
  return counts;
});

// Show "all" + Services always (so the default tab never disappears), plus any
// concrete category that has at least one entity.
const visibleTypeFilters = computed(() =>
  TYPE_FILTER_ORDER.filter(
    (c) => c === "all" || c === "service" || categoryCounts.value[c] > 0,
  ),
);

/** Rows belonging to a type-filter tab ("all" spans everything). */
function rowsForFilter(filter: TypeFilter): ServiceRow[] {
  return filter === "all"
    ? services.value
    : services.value.filter((s) => categoryOf(s) === filter);
}

// Worst health status present in each tab's entities. Drives the tab's color
// accent so an unhealthy bucket is visible without opening it. "critical" wins
// over "warning" over "degraded"; "healthy" means no accent.
const UNHEALTHY_RANK: Record<string, number> = {
  degraded: 1,
  warning: 2,
  critical: 3,
};
const categoryWorstStatus = computed<Record<TypeFilter, string>>(() => {
  const worst: Record<TypeFilter, string> = {
    all: "healthy",
    service: "healthy",
    datastore: "healthy",
    queue: "healthy",
    external: "healthy",
    rpc: "healthy",
  };
  for (const filter of TYPE_FILTER_ORDER) {
    for (const s of rowsForFilter(filter)) {
      if ((UNHEALTHY_RANK[s.status] ?? 0) > (UNHEALTHY_RANK[worst[filter]] ?? 0)) {
        worst[filter] = s.status;
      }
    }
  }
  return worst;
});

// Count of non-healthy (degraded/warning/critical) entities per tab, shown in
// brackets next to the tab's total (e.g. "Datastores 2 (1)").
const categoryUnhealthyCounts = computed<Record<TypeFilter, number>>(() => {
  const counts: Record<TypeFilter, number> = {
    all: 0,
    service: 0,
    datastore: 0,
    queue: 0,
    external: 0,
    rpc: 0,
  };
  for (const filter of TYPE_FILTER_ORDER) {
    counts[filter] = rowsForFilter(filter).filter(
      (s) => (UNHEALTHY_RANK[s.status] ?? 0) > 0,
    ).length;
  }
  return counts;
});

// Tailwind text-color class for a tab's worst status; empty when healthy.
function tabStatusClass(filter: TypeFilter): string {
  switch (categoryWorstStatus.value[filter]) {
    case "critical":
      return "text-[var(--o2-service-health-critical)]";
    case "warning":
      return "text-[var(--o2-service-health-warning)]";
    case "degraded":
      return "text-[var(--o2-service-health-degraded)]";
    default:
      return "";
  }
}

// CSS color (var reference) for a tab's worst-status badge fill; empty when
// healthy. Used as the filled-circle background for the unhealthy count.
function tabStatusColorVar(filter: TypeFilter): string {
  switch (categoryWorstStatus.value[filter]) {
    case "critical":
      return "var(--o2-service-health-critical)";
    case "warning":
      return "var(--o2-service-health-warning)";
    case "degraded":
      return "var(--o2-service-health-degraded)";
    default:
      return "";
  }
}

function onTypeFilterChange(value: string) {
  typeFilter.value = value as TypeFilter;
  currentPage.value = 1;
}

// If the active type tab disappears (e.g. after switching to a stream with no
// datastores), fall back to Services so the table never shows an orphaned empty
// state for a hidden tab.
watch(visibleTypeFilters, (tabs) => {
  if (!tabs.includes(typeFilter.value)) {
    typeFilter.value = "service";
    currentPage.value = 1;
  }
});

const statusOrder: Record<string, number> = {
  healthy: 0,
  degraded: 1,
  warning: 2,
  critical: 3,
};

const sortedServices = computed(() => {
  const arr = [...filteredServices.value];
  if (!sortBy.value) return arr;

  return arr.sort((a, b) => {
    let result: number;

    if (sortBy.value === "status") {
      result = (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
    } else {
      const va = a[sortBy.value as keyof ServiceRow];
      const vb = b[sortBy.value as keyof ServiceRow];
      if (typeof va === "number" && typeof vb === "number") {
        result = va - vb;
      } else {
        result = String(va ?? "").localeCompare(String(vb ?? ""));
      }
    }

    return sortOrder.value === "desc" ? -result : result;
  });
});

function deriveStatus(
  errorRate: number,
): "healthy" | "degraded" | "warning" | "critical" {
  if (errorRate > 10) return "critical";
  if (errorRate > 5) return "warning";
  if (errorRate > 1) return "degraded";
  return "healthy";
}

function statusBadgeClass(status: string): string {
  if (status === "critical") return "text-(--o2-service-health-critical)";
  if (status === "warning") return "text-(--o2-service-health-warning)";
  if (status === "degraded") return "text-(--o2-service-health-degraded)";
  return "text-(--o2-service-health-healthy)";
}

function errorRateClass(rate: number): string {
  if (rate > 10) return "text-red-500 font-medium";
  if (rate > 5) return "text-orange-500";
  if (rate > 1) return "text-yellow-500";
  return "";
}

function formatPercent(value: number): string {
  return value.toFixed(2) + "%";
}

function formatLat(us: number): string {
  return formatTimeWithSuffix(us);
}

function addSearchTerm(
  field: string,
  fieldValue: string | number | boolean,
  action: string,
) {
  const operator = action === "include" ? "=" : "!=";
  if (fieldValue === null || fieldValue === "" || fieldValue === "null") {
    const isOp = action === "include" ? "is" : "is not";
    searchObj.data.stream.addToFilter = `${field} ${isOp} null`;
  } else {
    searchObj.data.stream.addToFilter = `${field} ${operator} '${String(fieldValue).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
}

function handleRowClick(row: ServiceRow) {
  if (selectedServiceRow.value?.service_name === row.service_name) {
    showSidePanel.value = false;
    selectedServiceRow.value = null;
  } else {
    selectedServiceRow.value = row;
    showSidePanel.value = true;
  }
}

function handleCloseSidePanel() {
  showSidePanel.value = false;
  selectedServiceRow.value = null;
}

function viewTraces(data: string | Record<string, any>) {
  emit("view-traces", data);
}

function getTimeRange(): { start_time: number; end_time: number } {
  const { startTime, endTime } = getEffectiveTimeRange(searchObj.data.datetime);
  return { start_time: startTime, end_time: endTime };
}

// Load trace streams using the same method as the Traces search page
const loadAvailableStreams = async () => {
  try {
    const res = await getStreams("traces", false, false);
    if (res?.list?.length > 0) {
      availableStreams.value = res.list.map((stream: any) => stream.name);
    }
  } catch (e) {
    console.error("Error loading trace streams:", e);
  }
};

const onStreamFilterChange = (stream: string) => {
  emit("request:stream-change", stream);
};

async function loadServicesCatalog() {
  const streamName = streamFilter.value?.replaceAll('"', "");
  if (!streamName) return;

  if (
    availableStreams.value.length &&
    !availableStreams.value.includes(streamName)
  ) {
    return;
  }

  if (currentTraceId) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: currentTraceId,
      org_id: searchObj.organizationIdentifier,
    });
  }

  isLoading.value = true;
  services.value = [];

  const { start_time, end_time } = getTimeRange();

  // Check stream schema for infer_service_name column (cache result per stream)
  if (hasInferColumns.value === null) {
    try {
      const org = searchObj.organizationIdentifier;
      const schemaResponse = await streamService.schema(
        org,
        streamName,
        "traces",
      );
      const schemaFields =
        schemaResponse.data?.schema || schemaResponse.data?.fields || [];
      hasInferColumns.value = schemaFields.some(
        (f: any) => f.name === "infer_service_name",
      );
    } catch {
      // If schema check fails, default to false (use service_name only)
      hasInferColumns.value = false;
    }
  }

  // Build SQL: use infer_service_name when the column exists in the schema
  const useInfer = hasInferColumns.value;
  const sql = useInfer
    ? `SELECT
  COALESCE(NULLIF(infer_service_name, ''), service_name) AS service_name,
  MAX(infer_service_name) AS _infer_service_name,
  MAX(infer_service_system) AS _infer_service_system,
  MAX(infer_service_type) AS _infer_service_type,
  MAX(CASE WHEN service_name IS NOT NULL AND (infer_service_name IS NULL OR infer_service_name = '') THEN 1 ELSE 0 END) AS _is_real_service,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
  CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) / CAST(COUNT(*) AS DOUBLE) * 100 AS error_rate,
  AVG(duration) AS avg_duration_ns,
  MAX(duration) AS max_duration_ns,
  approx_percentile_cont(duration, 0.5) AS p50_latency_ns,
  approx_percentile_cont(duration, 0.95) AS p95_latency_ns,
  approx_percentile_cont(duration, 0.99) AS p99_latency_ns
FROM "${streamName}"
GROUP BY COALESCE(NULLIF(infer_service_name, ''), service_name)
ORDER BY total_requests DESC`
    : `SELECT
  service_name,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
  CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) / CAST(COUNT(*) AS DOUBLE) * 100 AS error_rate,
  AVG(duration) AS avg_duration_ns,
  MAX(duration) AS max_duration_ns,
  approx_percentile_cont(duration, 0.5) AS p50_latency_ns,
  approx_percentile_cont(duration, 0.95) AS p95_latency_ns,
  approx_percentile_cont(duration, 0.99) AS p99_latency_ns
FROM "${streamName}"
GROUP BY service_name
ORDER BY total_requests DESC`;

  currentTraceId = generateTraceContext().traceId;

  await fetchQueryDataWithHttpStream(
    {
      queryReq: {
        query: {
          sql: b64EncodeUnicode(sql),
          start_time,
          end_time,
          from: 0,
          size: -1,
        },
        encoding: "base64",
      },
      type: "search",
      pageType: "traces",
      searchType: "ui",
      traceId: currentTraceId,
      org_id: searchObj.organizationIdentifier,
    },
    {
      data: (_payload: any, response: any) => {
        if (
          response.type === "search_response_hits" ||
          response.type === "search_response_metadata"
        ) {
          const hits: any[] = response.content?.results?.hits ?? [];
          const serviceMap = new Map(
            services.value.map((s) => [s.service_name, s]),
          );
          for (const hit of hits) {
            const name = hit.service_name ?? "";
            serviceMap.set(name, {
              service_name: name,
              total_requests: hit.total_requests ?? 0,
              error_count: hit.error_count ?? 0,
              error_rate: hit.error_rate ?? 0,
              avg_duration_ns: hit.avg_duration_ns ?? 0,
              max_duration_ns: hit.max_duration_ns ?? 0,
              p50_latency_ns: hit.p50_latency_ns ?? 0,
              p95_latency_ns: hit.p95_latency_ns ?? 0,
              p99_latency_ns: hit.p99_latency_ns ?? 0,
              status: deriveStatus(hit.error_rate ?? 0),
              is_real_service: hit._is_real_service ?? 0,
              infer_service_name: hit._infer_service_name ?? undefined,
              infer_service_system: hit._infer_service_system ?? undefined,
              infer_service_type: hit._infer_service_type ?? undefined,
            });
          }
          // Drop phantom rpc dependencies (redundant with real service edges),
          // matching the Service Graph's rpc suppression.
          services.value = Array.from(serviceMap.values()).filter(
            (s) => !isPhantomRpc(s),
          );
        }
      },
      error: (_payload: any, _response: any) => {
        isLoading.value = false;
      },
      complete: (_payload: any, _response: any) => {
        isLoading.value = false;
      },
      reset: (_payload: any, _response: any) => {
        services.value = [];
        isLoading.value = false;
      },
    },
  );
}

// Expose for parent ref access
defineExpose({ loadServicesCatalog, streamFilter });

// Keep streamFilter in sync when Traces/Spans tab changes the global stream
watch(
  () => searchObj.data.stream.selectedStream.value,
  (newStream) => {
    if (newStream && newStream !== streamFilter.value) {
      streamFilter.value = newStream;
      localStorage.setItem("servicesCatalog_streamFilter", newStream);
      hasInferColumns.value = null;
      loadServicesCatalog();
    }
  },
);

watch(
  () => [
    streamFilter.value,
    searchObj.data.datetime.startTime,
    searchObj.data.datetime.endTime,
    searchObj.data.datetime.relativeTimePeriod,
  ],
  () => {
    if (searchObj.meta.searchMode === "services-catalog") {
      loadServicesCatalog();
    }
  },
);

onMounted(async () => {
  await loadAvailableStreams();
  loadServicesCatalog();
});

onUnmounted(() => {
  if (currentTraceId) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: currentTraceId,
      org_id: searchObj.organizationIdentifier,
    });
  }
});
</script>
