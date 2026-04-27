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
    class="services-catalog tw:h-full! tw:flex tw:flex-col tw:bg-[var(--o2-card-bg-solid)] card-container tw:px-[0.625rem]"
  >
    <!-- Toolbar: filter + export -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:py-[0.625rem]">
      <!-- Search input -->
      <div data-test="services-catalog-filter-input">
        <q-input
          v-model="filterText"
          :placeholder="t('traces.servicesCatalog.filterPlaceholder')"
          borderless
          dense
          clearable
          debounce="300"
          class="no-border tw:w-[14rem]! tw:h-[36px] tw:rounded tw:border tw:border-[var(--o2-border-color)]!"
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" size="1rem" name="search" />
          </template>
        </q-input>
      </div>
      <span
        v-if="!isLoading && services.length > 0"
        class="tw:text-[0.75rem] tw:text-[var(--o2-text-secondary)]"
        data-test="services-catalog-service-count"
      >
        {{ filteredServices.length }}
        {{ filteredServices.length === 1 ? "service" : "services" }}
      </span>
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
        :rows="filteredServices"
        :columns="tableColumns"
        :loading="isLoading"
        :row-height="28"
        :enable-column-reorder="true"
        :enable-row-expand="false"
        :enable-text-highlight="false"
        :enable-status-bar="false"
        :default-columns="false"
        data-test="services-catalog-table"
      >
        <!-- Status badge -->
        <template #cell-status="{ item }">
          <q-badge
            :color="statusColor(item.status)"
            :label="t(`traces.servicesCatalog.status.${item.status}`)"
            class="tw:text-[0.65rem] tw:px-[0.5rem]! tw:py-[0.25rem]!"
            :data-test="`services-catalog-status-${item.service_name}`"
          />
        </template>

        <!-- Service name via TraceServiceCell -->
        <template #cell-service_name="{ item }">
          <TraceServiceCell
            :item="item"
            class="tw:cursor-pointer"
            :data-test="`services-catalog-service-link-${item.service_name}`"
            @click="viewTraces(item.service_name)"
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

        <!-- Latency columns -->
        <template #cell-p50_latency_ns="{ item }">
          {{ formatLat(item.p50_latency_ns) }}
        </template>

        <template #cell-p95_latency_ns="{ item }">
          {{ formatLat(item.p95_latency_ns) }}
        </template>

        <template #cell-p99_latency_ns="{ item }">
          <span
            :class="
              item.p99_latency_ns > P99_WARN_NS ? 'tw:text-orange-500' : ''
            "
          >
            {{ formatLat(item.p99_latency_ns) }}
          </span>
        </template>

        <template #cell-avg_latency_ns="{ item }">
          {{ formatLat(item.avg_latency_ns) }}
        </template>

        <!-- Last seen -->
        <template #cell-last_seen_ts="{ item }">
          <span
            :class="
              isStale(item.last_seen_ts)
                ? 'tw:text-amber-500'
                : 'tw:text-[var(--o2-text-secondary)]'
            "
          >
            {{ formatLastSeen(item.last_seen_ts) }}
          </span>
        </template>

        <!-- Loading banner: shown above rows while a next page is fetching -->
        <template #loading-banner>
          <div
            class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
          >
            <q-spinner-hourglass
              color="primary"
              size="1.25rem"
              class="tw:mx-[0.25rem]"
            />
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
            <q-spinner-hourglass
              color="primary"
              size="1.25rem"
              class="tw:mr-[0.25rem]"
            />
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
import useTraces from "@/composables/useTraces";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { formatLatency } from "@/utils/traces/treeTooltipHelpers";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";

const { t } = useI18n();
const store = useStore();
const { searchObj } = useTraces();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();

const emit = defineEmits<{
  "view-traces": [serviceName: string];
}>();

// p99 > 1 second triggers the orange highlight
const P99_WARN_NS = 1_000_000_000;

interface ServiceRow {
  service_name: string;
  status: "healthy" | "warning" | "degraded";
  total_requests: number;
  error_count: number;
  error_rate: number;
  avg_latency_ns: number;
  p50_latency_ns: number;
  p95_latency_ns: number;
  p99_latency_ns: number;
  operation_count: number;
  last_seen_ts: number;
}

const isLoading = ref(false);
const services = ref<ServiceRow[]>([]);
const filterText = ref("");

let currentTraceId: string | null = null;

const tableColumns = computed(() => [
  {
    id: "service_name",
    header: t("traces.servicesCatalog.columns.serviceName"),
    accessorKey: "service_name",
    enableSorting: true,
    size: 200,
    meta: { slot: true, align: "left" },
  },
  {
    id: "status",
    header: t("traces.servicesCatalog.columns.status"),
    accessorKey: "status",
    size: 90,
    enableSorting: false,
    meta: { slot: true, align: "left" },
  },
  {
    id: "total_requests",
    header: t("traces.servicesCatalog.columns.requests"),
    accessorKey: "total_requests",
    size: 110,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "error_rate",
    header: t("traces.servicesCatalog.columns.errorRate"),
    accessorKey: "error_rate",
    size: 110,
    enableSorting: true,
    meta: { slot: true, align: "right" },
  },
  {
    id: "error_count",
    header: t("traces.servicesCatalog.columns.errors"),
    accessorKey: "error_count",
    size: 90,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "p50_latency_ns",
    header: t("traces.servicesCatalog.columns.p50Latency"),
    accessorKey: "p50_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right" },
  },
  {
    id: "p95_latency_ns",
    header: t("traces.servicesCatalog.columns.p95Latency"),
    accessorKey: "p95_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right" },
  },
  {
    id: "p99_latency_ns",
    header: t("traces.servicesCatalog.columns.p99Latency"),
    accessorKey: "p99_latency_ns",
    size: 100,
    enableSorting: true,
    meta: { slot: true, align: "right" },
  },
  {
    id: "avg_latency_ns",
    header: t("traces.servicesCatalog.columns.avgLatency"),
    accessorKey: "avg_latency_ns",
    size: 110,
    enableSorting: true,
    meta: { slot: true, align: "right" },
  },
  {
    id: "operation_count",
    header: t("traces.servicesCatalog.columns.operations"),
    accessorKey: "operation_count",
    size: 110,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "last_seen_ts",
    header: t("traces.servicesCatalog.columns.lastSeen"),
    accessorKey: "last_seen_ts",
    size: 110,
    enableSorting: true,
    meta: { slot: true, align: "left" },
  },
]);

const filteredServices = computed(() => {
  if (!filterText.value.trim()) return services.value;
  const q = filterText.value.trim().toLowerCase();
  return services.value.filter((s) => s.service_name.toLowerCase().includes(q));
});

function deriveStatus(errorRate: number): "healthy" | "warning" | "degraded" {
  if (errorRate >= 5) return "degraded";
  if (errorRate >= 1) return "warning";
  return "healthy";
}

function statusColor(status: string): string {
  if (status === "degraded") return "negative";
  if (status === "warning") return "warning";
  return "positive";
}

function errorRateClass(rate: number): string {
  if (rate >= 5) return "tw:text-red-500 tw:font-medium";
  if (rate >= 1) return "tw:text-orange-500";
  return "";
}

function formatPercent(value: number): string {
  return value.toFixed(2) + "%";
}

function formatLat(ns: number): string {
  return formatLatency(ns);
}

function formatLastSeen(ts: number): string {
  if (!ts) return "—";
  const diffMs = Date.now() - ts / 1000;
  if (diffMs < 60_000) return t("traces.servicesCatalog.justNow");
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60)
    return t("traces.servicesCatalog.minutesAgo", { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("traces.servicesCatalog.hoursAgo", { n: diffHr });
  return t("traces.servicesCatalog.daysAgo", {
    n: Math.floor(diffHr / 24),
  });
}

// Services not sending data for >5min are considered stale
function isStale(ts: number): boolean {
  if (!ts) return false;
  return Date.now() - ts / 1000 > 5 * 60_000;
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

function viewTraces(serviceName: string) {
  emit("view-traces", serviceName);
}

function getTimeRange(): { start_time: number; end_time: number } {
  if (searchObj.data.datetime.type === "relative") {
    const t = getConsumableRelativeTime(
      searchObj.data.datetime.relativeTimePeriod,
    );
    return {
      start_time: t.startTime,
      end_time: t.endTime,
    };
  }
  const dt = cloneDeep(searchObj.data.datetime);
  return {
    start_time: dt.startTime,
    end_time: dt.endTime,
  };
}

async function loadServicesCatalog() {
  const streamName = searchObj.data.stream.selectedStream.value;
  if (!streamName) return;

  // Cancel any in-flight query
  if (currentTraceId) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: currentTraceId,
      org_id: searchObj.organizationIdentifier,
    });
  }

  isLoading.value = true;
  services.value = [];

  const { start_time, end_time } = getTimeRange();
  const tsCol = store.state.zoConfig.timestamp_column || "_timestamp";

  const sql = `SELECT
  service_name,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
  CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) / CAST(COUNT(*) AS DOUBLE) * 100 AS error_rate,
  AVG(duration) AS avg_latency_ns,
  approx_percentile_cont(duration, 0.5) AS p50_latency_ns,
  approx_percentile_cont(duration, 0.95) AS p95_latency_ns,
  approx_percentile_cont(duration, 0.99) AS p99_latency_ns,
  COUNT(DISTINCT operation_name) AS operation_count,
  MAX(${tsCol}) AS last_seen_ts
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
          size: 1000,
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
          for (const hit of hits) {
            let _services = services.value;
            _services.push({
              service_name: hit.service_name ?? "",
              total_requests: hit.total_requests ?? 0,
              error_count: hit.error_count ?? 0,
              error_rate: hit.error_rate ?? 0,
              avg_latency_ns: hit.avg_latency_ns ?? 0,
              p50_latency_ns: hit.p50_latency_ns ?? 0,
              p95_latency_ns: hit.p95_latency_ns ?? 0,
              p99_latency_ns: hit.p99_latency_ns ?? 0,
              operation_count: hit.operation_count ?? 0,
              last_seen_ts: hit.last_seen_ts ?? 0,
              status: deriveStatus(hit.error_rate ?? 0),
            });
            services.value = [..._services];
          }
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
defineExpose({ loadServicesCatalog });

watch(
  () => [
    searchObj.data.stream.selectedStream.value,
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

onMounted(() => {
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
:deep(.services-catalog-table-container) {
  .container {
    border-radius: 0 !important;
  }
}
</style>
