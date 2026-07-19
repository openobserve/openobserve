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
    class="services-catalog h-full! flex flex-col bg-card-glass-bg px-2.5 relative overflow-hidden"
  >
    <!-- Toolbar: stream selector (width-matched to the rail below) + search
         (width-matched to the table below) + status pills. The stream selector
         sits exactly above the 230px left rail; the search + pills group starts
         exactly at the table's left edge (no gap between the two columns), so
         the toolbar columns line up with the body columns. -->
    <div class="flex items-center py-2.5">
      <!-- Stream selector — same 230px width as the left rail below it. -->
      <div
        data-test="services-catalog-stream-selector"
        class="flex-shrink-0 w-rail"
      >
        <OSelect
          :model-value="streamFilter"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-full rounded-default"
          :disabled="availableStreams.length === 0"
          @update:model-value="onStreamFilterChange"
        />
        <OTooltip v-if="availableStreams.length === 0" :content="t('traces.servicesCatalog.noStreamsDetected')" />
      </div>

      <!-- Search + pills group — occupies the table's column (everything right
           of the rail). A left pad adds breathing room after the stream
           selector while the column's outer edge still aligns to the table. -->
      <div class="flex-1 min-w-0 flex items-center gap-2 pl-2">
      <!-- Search input — grows to fill, aligning to the table below. -->
      <div class="flex-1 min-w-0">
        <OSearchInput
          v-model="filterText"
          :placeholder="t('traces.servicesCatalog.filterPlaceholder')"
          clearable
          :debounce="300"
          class="w-full!"
          data-test="services-catalog-filter-input"
        />
      </div>

      <!-- Health-status pills, kept grouped on the right (search flexes to fill
           the gap). Entity totals are shown per-tab in the type rail, so no
           separate total pill here. -->
      <div
        v-if="!isLoading && services.length > 0"
        class="flex items-center gap-2 flex-shrink-0"
        data-test="services-catalog-status-pills"
      >
        <template v-if="statusCounts.critical > 0">
          <div
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-default text-xs font-medium bg-[color-mix(in_srgb,var(--color-service-health-critical)_12%,transparent)] text-service-health-critical"
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
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-default text-xs font-medium bg-[color-mix(in_srgb,var(--color-service-health-warning)_12%,transparent)] text-service-health-warning"
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
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-default text-xs font-medium bg-[color-mix(in_srgb,var(--color-service-health-degraded)_12%,transparent)] text-service-health-degraded"
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
      </div>
      </div>
      <!-- Status legend -->
      <!-- <div
        class="ml-auto flex items-center gap-3 px-2.5 py-[0.325rem] rounded-default border border-card-glass-border"
        data-test="services-catalog-status-legend"
      >
        <span
          class="text-2xs font-bold text-text-heading whitespace-nowrap"
        >
          {{ t("traces.servicesCatalog.legend.title") }}
        </span>
        <div class="flex items-center gap-3.5">
          <div
            class="flex items-center gap-1.5"
            data-test="services-catalog-legend-healthy"
          >
            <span class="sc-legend-dot sc-legend-dot--healthy" />
            <span
              class="text-2xs font-semibold text-text-secondary"
              >{{ t("traces.servicesCatalog.status.healthy") }}</span
            >
            <span
              class="text-3xs opacity-55 text-text-label"
              >&lt;&nbsp;1%</span
            >
          </div>
          <div
            class="flex items-center gap-1.5"
            data-test="services-catalog-legend-degraded"
          >
            <span class="sc-legend-dot sc-legend-dot--degraded" />
            <span
              class="text-2xs font-semibold text-text-secondary"
              >{{ t("traces.servicesCatalog.status.degraded") }}</span
            >
            <span
              class="text-3xs opacity-55 text-text-label"
              >1&nbsp;–&nbsp;5%</span
            >
          </div>
          <div
            class="flex items-center gap-1.5"
            data-test="services-catalog-legend-warning"
          >
            <span class="sc-legend-dot sc-legend-dot--warning" />
            <span
              class="text-2xs font-semibold text-text-secondary"
              >{{ t("traces.servicesCatalog.status.warning") }}</span
            >
            <span
              class="text-3xs opacity-55 text-text-label"
              >5&nbsp;–&nbsp;10%</span
            >
          </div>
          <div
            class="flex items-center gap-1.5"
            data-test="services-catalog-legend-critical"
          >
            <span class="sc-legend-dot sc-legend-dot--critical" />
            <span
              class="text-2xs font-semibold text-text-secondary"
              >{{ t("traces.servicesCatalog.status.critical") }}</span
            >
            <span
              class="text-3xs opacity-55 text-text-label"
              >&gt;&nbsp;10%</span
            >
          </div>
        </div>
      </div> -->

      <!-- Column-visibility toggle + refresh — pinned to the right end of the
           filter bar so the catalog matches the other list pages (column
           toggle, then refresh). Wrapped in a real element with ml-2 because
           OTableColumnToggle's root is a reka-ui DropdownMenuRoot that renders
           no DOM node, so a fallthrough class on it would be dropped. -->
      <div class="flex items-center gap-2 shrink-0 ml-2">
        <OTableColumnToggle
          :columns="tableColumns"
          :column-visibility="columnVisibility"
          @update:column-visibility="setColumnVisibility"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isLoading"
          data-test="services-catalog-refresh-btn"
          @click="loadServicesCatalog"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
      </div>
    </div>

    <!-- Body: left rail (entity-type filter) + table — mirrors the Dashboards
         folder-rail + table layout (panel bg + vertical separator, 230px). -->
    <div class="flex flex-1 min-h-0">
      <!-- Left rail: the entity-type filter. Panel background + right border
           match FolderList.vue so the rail reads like the app's other left
           rails. The stream selector lives in the top toolbar alongside the
           search. -->
      <div
        class="w-rail shrink-0 h-full bg-surface-panel border-r border-border-default flex flex-col gap-2 py-2 px-1.5"
      >
        <!-- Entity-type filter: All / Services / Datastores / Queues /
             External / RPC. A vertical nav rail — same OTabs pattern as the
             Dashboards folder list, so the active row shows the tint + primary
             text the app's other left rails use. Row = label left, total +
             unhealthy badge right. -->
        <div
          v-if="!isLoading && services.length > 0"
          class="catalog-type-filter overflow-y-auto"
        >
          <OTabs
            orientation="vertical"
            dense
            :model-value="typeFilter"
            data-test="services-catalog-type-filter"
            @update:model-value="(v) => onTypeFilterChange(v as string)"
          >
            <OTab
              v-for="cat in visibleTypeFilters"
              :key="cat"
              :name="cat"
              class="min-h-7"
              :data-test="`services-catalog-type-${cat}`"
            >
              <div
                class="w-full flex items-center justify-between flex-nowrap gap-2"
              >
                <span class="flex-1 min-w-0 truncate text-left">{{
                  t(`traces.servicesCatalog.types.${cat}`)
                }}</span>
                <span class="flex items-center gap-1 shrink-0">
                  <span class="text-text-tertiary tabular-nums">{{
                    categoryCounts[cat]
                  }}</span>
                  <!-- Unhealthy count in a filled circle, colored by the tab's
                       worst status. Reads as "N problems", distinct from the
                       plain total to its left. Hover explains it. -->
                  <span
                    v-if="categoryUnhealthyCounts[cat] > 0"
                    class="inline-flex items-center justify-center min-w-[1.05rem] h-[1.05rem] px-1 rounded-full text-3xs font-semibold leading-none text-white"
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
                </span>
              </div>
            </OTab>
          </OTabs>
        </div>
      </div>

      <!-- Empty state (shown when not loading and no data) -->
      <div
        v-if="!isLoading && services.length === 0"
        class="flex flex-col items-center justify-center flex-1"
        data-test="services-catalog-empty"
      >
        <ServicesCatalogNoDataState
          @jump-to-stream-data="
            (from, to) => emit('jump-to-stream-data', from, to)
          "
        />
      </div>

      <!-- Table — shared OTable (same component as the Dashboards list), so the
           header, rows, in-frame toolbar and footer (count + "Showing X–Y of N"
           + records-per-page + pager) all match. OTable owns pagination, so we
           feed it the full sorted list and it paginates internally. -->
      <div v-else class="flex-1 min-w-0 h-full">
        <div class="h-full bg-card-glass-bg">
          <OTable
            ref="oTableRef"
            :data="sortedServices"
            :columns="tableColumns"
            :column-visibility="columnVisibility"
            row-key="service_name"
            :loading="isLoading"
            :frame="false"
            :default-columns="false"
            :show-global-filter="false"
            :sort-by="sortBy"
            :sort-order="sortOrder"
            sorting="server"
            pagination="client"
            :page-size="rowsPerPage"
            :page-size-options="rowsPerPageOptions"
            :footer-title="t('traces.servicesCatalog.footerTitle')"
            table-id="services-catalog"
            data-test="services-catalog-table"
            @row-click="(row) => handleRowClick(row)"
            @sort-change="(p) => handleSortChange(p.column, p.order)"
          >
            <!-- Status badge -->
            <template #cell-status="{ row }">
              <OTag
                type="serviceStatus"
                :value="row.status"
                :data-test="`services-catalog-status-${row.service_name}`"
              >
                {{ t(`traces.servicesCatalog.status.${row.status}`) }}
              </OTag>
            </template>

            <!-- Service name via TraceServiceCell -->
            <template #cell-service_name="{ row }">
              <TraceServiceCell
                :item="row"
                class="cursor-pointer"
                :data-test="`services-catalog-service-link-${row.service_name}`"
                @click.stop="handleRowClick(row)"
              />
            </template>

            <!-- Error rate with progress bar -->
            <template #cell-error_rate="{ row }">
              <ServiceCatalogBarCell
                :value="row.error_rate"
                :max="columnMaxes.error_rate"
                :label="formatPercent(row.error_rate)"
                :variant="row.error_rate > 10 ? 'danger' : row.error_rate > 5 ? 'warning' : 'default'"
                :data-test="`services-catalog-error-rate-${row.service_name}`"
              />
            </template>

            <!-- Request / error count columns -->
            <template #cell-total_requests="{ row }">
              <span :data-test="`services-catalog-requests-${row.service_name}`">
                {{ formatLargeNumber(row.total_requests) }}
                <OTooltip :content="row.total_requests.toLocaleString()" />
              </span>
            </template>

            <template #cell-error_count="{ row }">
              <span :data-test="`services-catalog-errors-${row.service_name}`">
                {{ formatLargeNumber(row.error_count) }}
                <OTooltip :content="row.error_count.toLocaleString()" />
              </span>
            </template>

            <!-- Latency / duration columns -->
            <template #cell-p50_latency_ns="{ row }">
              <ServiceCatalogBarCell
                :value="row.p50_latency_ns"
                :max="columnMaxes.p50_latency_ns"
                :label="formatLat(row.p50_latency_ns)"
                :tooltip="row.p50_latency_ns.toLocaleString() + ' ns'"
              />
            </template>

            <template #cell-p95_latency_ns="{ row }">
              <ServiceCatalogBarCell
                :value="row.p95_latency_ns"
                :max="columnMaxes.p95_latency_ns"
                :label="formatLat(row.p95_latency_ns)"
                :tooltip="row.p95_latency_ns.toLocaleString() + ' ns'"
              />
            </template>

            <template #cell-p99_latency_ns="{ row }">
              <ServiceCatalogBarCell
                :value="row.p99_latency_ns"
                :max="columnMaxes.p99_latency_ns"
                :label="formatLat(row.p99_latency_ns)"
                :tooltip="row.p99_latency_ns.toLocaleString() + ' ns'"
                :variant="row.p99_latency_ns > P99_WARN_NS ? 'warning' : 'default'"
              />
            </template>

            <template #cell-avg_duration_ns="{ row }">
              <ServiceCatalogBarCell
                :value="row.avg_duration_ns"
                :max="columnMaxes.avg_duration_ns"
                :label="formatLat(row.avg_duration_ns)"
                :tooltip="row.avg_duration_ns.toLocaleString() + ' ns'"
              />
            </template>

            <template #cell-max_duration_ns="{ row }">
              <ServiceCatalogBarCell
                :value="row.max_duration_ns"
                :max="columnMaxes.max_duration_ns"
                :label="formatLat(row.max_duration_ns)"
                :tooltip="row.max_duration_ns.toLocaleString() + ' ns'"
              />
            </template>
          </OTable>
        </div>
      </div>
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
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import TraceServiceCell from "./components/TraceServiceCell.vue";
import ServiceCatalogBarCell from "./components/ServiceCatalogBarCell.vue";
import ServiceGraphNodeSidePanel from "./ServiceGraphNodeSidePanel.vue";
import useTraces from "@/composables/useTraces";
import useStreams from "@/composables/useStreams";
import useHttpStreaming from "@/composables/useStreamingSearch";
import streamService from "@/services/stream";
import { formatLatency } from "@/utils/traces/treeTooltipHelpers";
import { classifyEntity } from "@/utils/traces/serviceClassification";
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
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ServicesCatalogNoDataState from "./ServicesCatalogNoDataState.vue";

const { t } = useI18n();
const store = useStore();
const { columnVisibility, setColumnVisibility } =
  useExternalColumnToggle("services-catalog");
const catalogContainerRef = ref<HTMLElement | null>(null);
const { searchObj } = useTraces();
const { getStreams } = useStreams();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();

const emit = defineEmits<{
  "view-traces": [data: string | Record<string, any>];
  "request:stream-change": [stream: string];
  "jump-to-stream-data": [fromUs: number, toUs: number];
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
 * Map a row to a catalog category using the shared classifier — the single
 * source of truth (mirrored in the Rust backend + the Service Graph). A real
 * service (emits its own spans) stays a Service even if it was ALSO inferred as
 * external/rpc (a collision); genuine dependencies keep their inferred type; rpc
 * is kept as its own category. `classifyEntity`'s `EntityKind` values line up
 * with `EntityCategory` exactly.
 */
function categoryOf(row: ServiceRow): EntityCategory {
  return classifyEntity(
    Boolean(row.is_real_service),
    row.infer_service_type,
  ) as EntityCategory;
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

// OTable owns pagination internally; `currentPage` is retained only as the
// "reset to page 1 on sort/filter change" signal the tests assert against.
//
// OTable server-mode sort is a 3-state cycle (asc → desc → cleared). The catalog
// always shows sorted data, so we collapse it to a simple 2-state toggle:
//   - click a NEW column      → sort it descending (worst-first, matching the
//     default status sort)
//   - click the SAME column   → flip its direction
// We derive the column from OTable's payload but ignore its emitted order (which
// includes the "cleared" step), computing the direction ourselves. When OTable
// emits its clear step (empty column), that means the currently-sorted column
// was clicked again → flip it.
function handleSortChange(field: string, _order: "asc" | "desc") {
  const clickedField = field || sortBy.value;
  if (clickedField === sortBy.value && sortBy.value) {
    // Same column re-clicked → flip direction (2-state toggle).
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    // New column → start descending (worst / highest first).
    sortBy.value = clickedField;
    sortOrder.value = "desc";
  }
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

// OTable column defs. Sorting is `server` mode on the table (it emits
// sort-change; the catalog reorders `sortedServices` itself), so each sortable
// column just sets `sortable: true`. The service-name column is the `flex`
// filler so the table fills its container like the Dashboards name column.
const tableColumns = computed(() => [
  {
    id: "service_name",
    hideable: true,
    header: t("traces.servicesCatalog.columns.serviceName"),
    accessorKey: "service_name",
    sortable: true,
    resizable: true,
    size: 260,
    minSize: 180,
    meta: { align: "left", flex: true },
  },
  {
    id: "status",
    hideable: true,
    header: t("traces.servicesCatalog.columns.status"),
    accessorKey: "status",
    sortable: true,
    resizable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "total_requests",
    hideable: true,
    header: t("traces.servicesCatalog.columns.requests"),
    accessorKey: "total_requests",
    sortable: true,
    resizable: true,
    size: 110,
    meta: { align: "right" },
  },
  {
    id: "error_count",
    hideable: true,
    header: t("traces.servicesCatalog.columns.errors"),
    accessorKey: "error_count",
    sortable: true,
    resizable: true,
    size: 90,
    meta: { align: "right" },
  },
  {
    id: "error_rate",
    hideable: true,
    header: t("traces.servicesCatalog.columns.errorRate"),
    accessorKey: "error_rate",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right" },
  },
  {
    id: "p50_latency_ns",
    hideable: true,
    header: t("traces.servicesCatalog.columns.p50Latency"),
    accessorKey: "p50_latency_ns",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "p95_latency_ns",
    hideable: true,
    header: t("traces.servicesCatalog.columns.p95Latency"),
    accessorKey: "p95_latency_ns",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "p99_latency_ns",
    hideable: true,
    header: t("traces.servicesCatalog.columns.p99Latency"),
    accessorKey: "p99_latency_ns",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "avg_duration_ns",
    hideable: true,
    header: t("traces.servicesCatalog.columns.avgDuration"),
    accessorKey: "avg_duration_ns",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right" },
  },
  {
    id: "max_duration_ns",
    hideable: true,
    header: t("traces.servicesCatalog.columns.maxDuration"),
    accessorKey: "max_duration_ns",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right" },
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

// CSS color (var reference) for a tab's worst-status badge fill; empty when
// healthy. Used as the filled-circle background for the unhealthy count.
function tabStatusColorVar(filter: TypeFilter): string {
  switch (categoryWorstStatus.value[filter]) {
    case "critical":
      return "var(--color-service-health-critical)";
    case "warning":
      return "var(--color-service-health-warning)";
    case "degraded":
      return "var(--color-service-health-degraded)";
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
  if (status === "critical") return "text-service-health-critical";
  if (status === "warning") return "text-service-health-warning";
  if (status === "degraded") return "text-service-health-degraded";
  return "text-service-health-healthy";
}

function errorRateClass(rate: number): string {
  if (rate > 10) return "text-service-health-critical font-medium";
  if (rate > 5) return "text-service-health-degraded";
  if (rate > 1) return "text-service-health-warning";
  return "";
}

function formatPercent(value: number): string {
  return value.toFixed(2) + "%";
}

function formatLat(us: number): string {
  return formatTimeWithSuffix(us);
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
          // RPC entities are kept as their own category (matching the Service
          // Graph and the shared classifier) — never dropped, so a genuine
          // uninstrumented gRPC backend is never hidden.
          services.value = Array.from(serviceMap.values());
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

<style scoped>
/* keep(lib-override:o-tabs): the vertical entity-type rail restyles OTabs' own
   .o-tabs / .o-tabs--vertical / .o-tab DOM (rendered by the OTabs/OTab library
   components) so the active row matches the Dashboards folder-list rail —
   reachable only via :deep. */
.catalog-type-filter :deep(.o-tabs) {
  height: auto !important;
  max-height: none !important;
}

.catalog-type-filter :deep(.o-tabs--vertical) {
  margin: 0;
}

/* Horizontal padding intentionally omitted — OTab's vertical variant derives it
   from --spacing-page-edge so this rail lines up with the page header. */
.catalog-type-filter :deep(.o-tabs--vertical .o-tab) {
  justify-content: flex-start;
  border-radius: 0.5rem;
  font-weight: 500;
  width: 100%;
}
</style>
