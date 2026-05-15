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
    class="services-catalog tw:h-full! tw:flex tw:flex-col tw:bg-[var(--o2-card-bg-solid)] card-container tw:px-[0.625rem] tw:relative tw:overflow-hidden"
  >
    <!-- Toolbar: stream selector + filter + chips + legend -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:py-[0.625rem]">
      <!-- Stream selector -->
      <div
        data-test="services-catalog-stream-selector"
        class="tw:w-[11rem] tw:flex-shrink-0"
      >
        <OSelect
          v-model="streamFilter"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          :disabled="availableStreams.length === 0"
          @update:model-value="onStreamFilterChange"
        />
        <OTooltip v-if="availableStreams.length === 0" :content="t('traces.servicesCatalog.noStreamsDetected')" />
      </div>

      <!-- Search input -->
      <div data-test="services-catalog-filter-input">
        <OInput
          v-model="filterText"
          :placeholder="t('traces.servicesCatalog.filterPlaceholder')"
          clearable
          :debounce="300"
          class="tw:w-[14rem]!"
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" size="1rem" name="search" />
          </template>
        </OInput>
      </div>

      <template v-if="!isLoading && services.length > 0">
        <!-- Combined pill: total count + colored status dots with counts -->
        <div
          class="tw:flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:text-[var(--o2-text-4)] tw:bg-[var(--o2-tag-grey-1)]"
          data-test="services-catalog-status-pill"
        >
          <template v-if="filterText">
            {{ filteredServices.length }}/{{ services.length }}
          </template>
          <template v-else> {{ services.length }} </template>
          {{
            services.length === 1
              ? t("traces.servicesCatalog.serviceLabel")
              : t("traces.servicesCatalog.servicesLabel")
          }}
        </div>

        <template v-if="statusCounts.critical > 0">
          <div
            class="tw:inline-flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:font-medium tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_12%,transparent)] tw:text-[var(--o2-service-health-critical)]"
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
            class="tw:inline-flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:font-medium tw:bg-[color-mix(in_srgb,var(--o2-service-health-warning)_12%,transparent)] tw:text-[var(--o2-service-health-warning)]"
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
            class="tw:inline-flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:font-medium tw:bg-[color-mix(in_srgb,var(--o2-service-health-degraded)_12%,transparent)] tw:text-[var(--o2-service-health-degraded)]"
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
        class="row items-center tw:justify-end tw:px-[0.5rem] tw:py-[0.25rem] tw:ml-auto"
        data-test="services-catalog-pagination-bar"
      >
        <OSelect
          v-model="rowsPerPage"
          :options="rowsPerPageOptions"
          class="select-pagination tw:mr-[0.25rem] tw:mt-0!"
          size="sm"
          data-test="services-catalog-records-per-page"
          @update:model-value="changeRowsPerPage"
        />
        <q-pagination
          v-model="currentPage"
          :max="totalPages"
          :input="false"
          direction-links
          :boundary-numbers="false"
          :max-pages="5"
          :ellipses="false"
          icon-first="skip_previous"
          icon-last="skip_next"
          icon-prev="fast_rewind"
          icon-next="fast_forward"
          class="float-right paginator-section tw:mt-0!"
          data-test="services-catalog-pagination"
          @update:model-value="changePage"
        />
      </div>
      <!-- Status legend -->
      <!-- <div
        class="tw:ml-auto tw:flex tw:items-center tw:gap-3 tw:px-[0.625rem] tw:py-[0.325rem] tw:rounded tw:border tw:border-[var(--o2-border-color)]"
        data-test="services-catalog-status-legend"
      >
        <span
          class="tw:text-[0.7rem] tw:font-bold tw:text-[var(--o2-text-4)] tw:whitespace-nowrap"
        >
          {{ t("traces.servicesCatalog.legend.title") }}
        </span>
        <div class="tw:flex tw:items-center tw:gap-[0.875rem]">
          <div
            class="tw:flex tw:items-center tw:gap-[0.375rem]"
            data-test="services-catalog-legend-healthy"
          >
            <span class="sc-legend-dot sc-legend-dot--healthy" />
            <span
              class="tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.healthy") }}</span
            >
            <span
              class="tw:text-[0.65rem] tw:opacity-55 tw:text-[var(--o2-text-4)]"
              >&lt;&nbsp;1%</span
            >
          </div>
          <div
            class="tw:flex tw:items-center tw:gap-[0.375rem]"
            data-test="services-catalog-legend-degraded"
          >
            <span class="sc-legend-dot sc-legend-dot--degraded" />
            <span
              class="tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.degraded") }}</span
            >
            <span
              class="tw:text-[0.65rem] tw:opacity-55 tw:text-[var(--o2-text-4)]"
              >1&nbsp;–&nbsp;5%</span
            >
          </div>
          <div
            class="tw:flex tw:items-center tw:gap-[0.375rem]"
            data-test="services-catalog-legend-warning"
          >
            <span class="sc-legend-dot sc-legend-dot--warning" />
            <span
              class="tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.warning") }}</span
            >
            <span
              class="tw:text-[0.65rem] tw:opacity-55 tw:text-[var(--o2-text-4)]"
              >5&nbsp;–&nbsp;10%</span
            >
          </div>
          <div
            class="tw:flex tw:items-center tw:gap-[0.375rem]"
            data-test="services-catalog-legend-critical"
          >
            <span class="sc-legend-dot sc-legend-dot--critical" />
            <span
              class="tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-2)]"
              >{{ t("traces.servicesCatalog.status.critical") }}</span
            >
            <span
              class="tw:text-[0.65rem] tw:opacity-55 tw:text-[var(--o2-text-4)]"
              >&gt;&nbsp;10%</span
            >
          </div>
        </div>
      </div> -->
    </div>

    <!-- Empty state (shown when not loading and no data) -->
    <div
      v-if="!isLoading && services.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-[var(--o2-text-secondary)]"
      data-test="services-catalog-empty"
    >
      <q-icon name="layers" size="3rem" class="tw:mb-3 tw:opacity-40" />
      <p class="tw:text-[0.9rem]">
        {{ t("traces.servicesCatalog.noServicesFound") }}
      </p>
    </div>

    <!-- Table -->
    <div
      v-else
      class="tw:w-full tw:h-auto! tw:overflow-x-auto tw:relative tw:flex-1"
    >
      <TenstackTable
        class="tw:h-auto!"
        :rows="paginatedServices"
        :columns="tableColumns"
        :loading="isLoading"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        :row-height="28"
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
          <span
            class="tw:rounded tw:py-[0.125rem] tw:inline-flex tw:items-center tw:w-fit tw:text-[0.75rem] tw:font-semibold"
            :class="statusBadgeClass(item.status)"
            :data-test="`services-catalog-status-${item.service_name}`"
          >
            {{ t(`traces.servicesCatalog.status.${item.status}`) }}
          </span>
        </template>

        <!-- Service name via TraceServiceCell -->
        <template #cell-service_name="{ item }">
          <TraceServiceCell
            :item="item"
            class="tw:cursor-pointer"
            :data-test="`services-catalog-service-link-${item.service_name}`"
            @click.stop="handleRowClick(item)"
          />
        </template>

        <!-- Error rate with color coding -->
        <template #cell-error_rate="{ item }">
          <span
            :class="errorRateClass(item.error_rate)"
            :data-test="`services-catalog-error-rate-${item.service_name}`"
          >
            {{ formatPercent(item.error_rate) }}
          </span>
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
          <span>
            {{ formatLat(item.p50_latency_ns) }}
            <OTooltip :content="item.p50_latency_ns.toLocaleString() + ' ns'" />
          </span>
        </template>

        <template #cell-p95_latency_ns="{ item }">
          <span>
            {{ formatLat(item.p95_latency_ns) }}
            <OTooltip :content="item.p95_latency_ns.toLocaleString() + ' ns'" />
          </span>
        </template>

        <template #cell-p99_latency_ns="{ item }">
          <span
            :class="
              item.p99_latency_ns > P99_WARN_NS ? 'tw:text-orange-500' : ''
            "
          >
            {{ formatLat(item.p99_latency_ns) }}
            <OTooltip :content="item.p99_latency_ns.toLocaleString() + ' ns'" />
          </span>
        </template>

        <template #cell-avg_duration_ns="{ item }">
          <span>
            {{ formatLat(item.avg_duration_ns) }}
            <OTooltip :content="item.avg_duration_ns.toLocaleString() + ' ns'" />
          </span>
        </template>

        <template #cell-max_duration_ns="{ item }">
          <span>
            {{ formatLat(item.max_duration_ns) }}
            <OTooltip :content="item.max_duration_ns.toLocaleString() + ' ns'" />
          </span>
        </template>

        <!-- Loading banner: shown above rows while a next page is fetching -->
        <template #loading-banner>
          <div
            class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
          >
            <OSpinner size="xs" class="tw:mx-[0.25rem]" />
            <span
              class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
            >
              {{ t("traces.servicesCatalog.loading") }}
            </span>
          </div>
        </template>

        <!-- Loading row: shown when no rows exist yet (first fetch) -->
        <template #loading>
          <div
            data-test="services-catalog-loading"
            class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
          >
            <OSpinner size="xs" class="tw:mr-[0.25rem]" />
            <span
              class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
            >
              {{ t("traces.servicesCatalog.loading") }}
            </span>
          </div>
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
import { copyToClipboard as qCopyToClipboard } from "quasar";
import TenstackTable from "@/components/TenstackTable.vue";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import TraceServiceCell from "./components/TraceServiceCell.vue";
import ServiceGraphNodeSidePanel from "./ServiceGraphNodeSidePanel.vue";
import useTraces from "@/composables/useTraces";
import useStreams from "@/composables/useStreams";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { formatLatency } from "@/utils/traces/treeTooltipHelpers";
import {
  b64EncodeUnicode,
  generateTraceContext,
  formatLargeNumber,
  formatTimeWithSuffix,
} from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

const { t } = useI18n();
const store = useStore();
const catalogContainerRef = ref<HTMLElement | null>(null);
const { searchObj } = useTraces();
const { getStreams } = useStreams();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();

const emit = defineEmits<{
  "view-traces": [serviceName: string];
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
}

const isLoading = ref(false);
const services = ref<ServiceRow[]>([]);
const filterText = ref("");
const currentPage = ref(1);
const rowsPerPage = ref(25);
const rowsPerPageOptions = [10, 25, 50, 100];
const sortBy = ref<string>("status");
const sortOrder = ref<"asc" | "desc">("desc");

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
    size: 200,
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
    id: "error_rate",
    header: t("traces.servicesCatalog.columns.errorRate"),
    accessorKey: "error_rate",
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

const statusCounts = computed(() => ({
  critical: services.value.filter((s) => s.status === "critical").length,
  warning: services.value.filter((s) => s.status === "warning").length,
  degraded: services.value.filter((s) => s.status === "degraded").length,
}));

const filteredServices = computed(() => {
  if (!filterText?.value?.trim()) return services.value;
  const q = filterText.value?.trim().toLowerCase();
  return services.value.filter((s) => s.service_name.toLowerCase().includes(q));
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
  if (status === "critical") return "o2-status-badge--error";
  if (status === "warning") return "o2-status-badge--warning";
  if (status === "degraded") return "o2-status-badge--degraded";
  return "o2-status-badge--success";
}

function errorRateClass(rate: number): string {
  if (rate > 10) return "tw:text-red-500 tw:font-medium";
  if (rate > 5) return "tw:text-orange-500";
  if (rate > 1) return "tw:text-yellow-500";
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
  const serviceName =
    typeof data === "string" ? data : (data?.serviceName ?? "");
  emit("view-traces", serviceName);
}

function getTimeRange(): { start_time: number; end_time: number } {
  if (searchObj.data.datetime.type === "relative") {
    const relTime = getConsumableRelativeTime(
      searchObj.data.datetime.relativeTimePeriod,
    );
    return {
      start_time: relTime.startTime,
      end_time: relTime.endTime,
    };
  }
  const dt = cloneDeep(searchObj.data.datetime);
  return {
    start_time: dt.startTime,
    end_time: dt.endTime,
  };
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
  streamFilter.value = stream;
  localStorage.setItem("servicesCatalog_streamFilter", stream);
  loadServicesCatalog();
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

  const sql = `SELECT
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
            });
          }
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

<style lang="scss" scoped>
@import "@/styles/pagination.scss";

:deep(.services-catalog-table-container) {
  .container {
    border-radius: 0 !important;
  }
}

// Table status badges — use service-health colors for consistency with ServiceGraph
.o2-status-badge--success {
  color: var(--o2-service-health-healthy);
}
.o2-status-badge--degraded {
  color: var(--o2-service-health-degraded);
}
.o2-status-badge--warning {
  color: var(--o2-service-health-warning);
}
.o2-status-badge--error {
  color: var(--o2-service-health-critical);
}
</style>
