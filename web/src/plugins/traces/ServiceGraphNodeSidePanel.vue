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
  <transition name="slide">
    <div
      v-if="visible"
      class="service-graph-side-panel"
      data-test="service-graph-side-panel"
    >
      <!-- Header Section (compact with inline health badge) -->
      <div
        class="panel-header tw:py-[0.375rem] tw:px-[0.625rem]"
        data-test="service-graph-side-panel-header"
      >
        <div class="panel-title">
          <h2
            class="service-name"
            data-test="service-graph-side-panel-service-name"
          >
            {{ selectedNode?.name || selectedNode?.label || selectedNode?.id }}
            <span class="health-badge" :class="serviceHealth.status">
              {{ serviceHealth.text }}
            </span>
          </h2>
        </div>
        <div class="panel-header-actions tw:flex tw:items-center tw:gap-2">
          <ODropdown side="bottom" align="start">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                data-test="service-graph-node-panel-view-related-btn"
              >
                View Related
                <q-icon name="arrow_drop_down" size="1rem" />
              </OButton>
            </template>
            <ODropdownItem
              @select="viewRelatedLogs"
              data-test="service-graph-node-panel-view-related-logs-btn"
              >Logs</ODropdownItem
            >
            <ODropdownItem
              @select="viewRelatedTraces"
              data-test="service-graph-node-panel-view-related-traces-btn"
              >Traces</ODropdownItem
            >
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon"
            data-test="service-graph-side-panel-close-btn"
            @click="handleClose"
          >
            <q-icon name="cancel" size="1rem" />
          </OButton>
        </div>
      </div>

      <!-- Content Scrollable Area -->
      <div class="panel-content">
        <!-- RED Charts Section -->
        <div
          v-if="streamFilter !== 'all' && dashboardData"
          class="panel-section red-charts-section tw:flex tw:flex-col tw:mb-0!"
          data-test="service-graph-side-panel-red-charts"
        >
          <!-- DataZoom filter chips + View in Traces button -->
          <div
            v-if="filterChips.length"
            class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-[0.3rem] tw:flex-wrap"
            data-test="service-graph-side-panel-filter-chips"
          >
            <!-- Filter chip pills -->
            <div
              v-for="chip in filterChips"
              :key="chip.key"
              class="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:border tw:border-[var(--o2-border)] tw:px-2 tw:py-[0.325rem] tw:text-[0.7rem] tw:leading-none tw:text-[var(--o2-text-primary)]"
              :data-test="`service-graph-filter-chip-${chip.key}`"
              :class="
                chip.type === 'duration'
                  ? 'tw:text-[var(--o2-latency-p95)]'
                  : 'tw:text-[var(--o2-status-error-text)]'
              "
            >
              <!-- Duration chip icon -->
              <q-icon
                v-if="chip.type === 'duration'"
                name="schedule"
                size="0.8rem"
                class="tw:text-[var(--o2-latency-p95)]"
              />
              <!-- Error chip icon -->
              <q-icon
                v-else-if="chip.type === 'error'"
                name="warning"
                size="0.8rem"
                class="tw:text-[var(--o2-status-error-text)]"
              />
              <span
                :class="
                  chip.type === 'duration'
                    ? 'tw:text-[var(--o2-latency-p95)]'
                    : 'tw:text-[var(--o2-status-error-text)]'
                "
                >{{ chip.label }}</span
              >
              <OButton
                variant="ghost"
                size="icon-chip"
                class="tw:ml-0.5"
                :data-test="`service-graph-filter-chip-remove-${chip.key}`"
                @click="removeLocalRangeFilter(chip.key)"
              >
                <q-icon name="close" size="0.65rem" />
              </OButton>
            </div>

            <!-- Spacer -->
            <div class="tw:flex-1" />

            <!-- View in Traces button -->
            <OButton
              variant="ghost-primary"
              size="sm"
              data-test="service-graph-side-panel-view-in-traces-btn"
              @click="viewInTraces"
            >
              <template #icon-left>
                <q-icon name="search" size="0.8rem" />
              </template>
              View Traces
            </OButton>
          </div>
          <div class="charts-wrapper tw:py-0! tw:min-h-[10.875rem] tw:w-full">
            <div class="charts-container tw:w-full">
              <RenderDashboardCharts
                ref="dashboardChartsRef"
                :viewOnly="true"
                :dashboardData="dashboardData || {}"
                :currentTimeObj="currentTimeObj"
                :allowAlertCreation="false"
                searchType="dashboards"
                @updated:dataZoom="onDataZoom"
              />
            </div>
          </div>
        </div>

        <q-separator class="tw:my-[1rem]!" />
        <!-- Tabs: Operations / Nodes / Pods -->
        <template v-if="streamFilter !== 'all'">
          <div
            class="tw:flex tw:items-end tw:border-b tw:border-b-[var(--o2-border-color)] tw:mx-[0.5rem] tw:mb-[0.375rem]"
            data-test="service-graph-node-panel-tabs-row"
          >
            <OTabs
              v-model="activeTab"
              dense
              align="left"
              class="text-bold tw:flex-1 tw:w-[calc(100%-2rem)]!"
              data-test="service-graph-node-panel-tabs"
            >
              <OTab
                name="operations"
                label="Operations"
                style="text-transform: capitalize"
                data-test="service-graph-node-panel-tab-operations"
              />
              <OTab
                v-for="cfg in activeResourceTabConfigs"
                :key="cfg.id"
                :name="cfg.id"
                :label="cfg.label"
                style="text-transform: capitalize"
                :data-test="`service-graph-node-panel-tab-${cfg.id}`"
              />
              <OTab
                name="metrics"
                label="Metrics"
                style="text-transform: capitalize"
                data-test="service-graph-node-panel-tab-metrics"
              />
            </OTabs>

            <!-- Resource tabs dropdown — shows/hides individual OTEL resource tabs -->
            <ODropdown
              v-if="availableResourceTabConfigs.length > 0"
              side="bottom"
              align="end"
            >
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  data-test="service-graph-node-panel-workload-fields-btn"
                >
                  <q-icon name="tune" size="1.1rem" />
                  <q-tooltip>{{ t("common.resources") }}</q-tooltip>
                </OButton>
              </template>
              <q-list
                dense
                class="tw:min-w-[12rem]!"
                data-test="service-graph-node-panel-workload-fields-menu"
              >
                <template v-for="env in detectedEnvironments" :key="env.key">
                  <q-item-label
                    header
                    class="tw:text-xs tw:pb-0 tw:py-[0.375rem]! tw:uppercase tw:tracking-wide"
                  >
                    {{ env.label }}
                  </q-item-label>
                  <q-item
                    v-for="cfg in availableResourceTabConfigs.filter(
                      (c) => c.environment === env.key,
                    )"
                    :key="cfg.id"
                    tag="label"
                    clickable
                    :data-test="`service-graph-node-panel-workload-field-${cfg.id}`"
                    class="tw:px-[0.325rem]! tw:h-[30px]! tw:min-h-[30px]!"
                  >
                    <q-item-section side class="tw:pr-[0rem]!">
                      <q-checkbox
                        v-model="selectedWorkloadFields"
                        :val="cfg.id"
                        size="xs"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="tw:text-xs">
                        {{ cfg.label }}
                        <q-tooltip>
                          {{ cfg.groupField }}
                        </q-tooltip>
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-list>
            </ODropdown>
          </div>
          <OTabPanels v-model="activeTab" animated>
            <!-- Operations Tab -->
            <OTabPanel
              name="operations"
              class="tw:p-0! panel-section tw:mb-0!"
              data-test="service-graph-side-panel-recent-operations"
            >
              <!-- Loading State -->
              <div
                v-if="loadingOperations"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading operations...</span>
              </div>

              <template v-else>
                <div
                  v-if="recentOperations.length === 0"
                  class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                  style="color: var(--o2-text-secondary)"
                >
                  No operations found
                </div>
                <div
                  v-else
                  class="tw:overflow-hidden tw:rounded"
                  data-test="service-graph-side-panel-operations-table"
                >
                  <TenstackTable
                    :columns="operationsTableColumns"
                    :rows="sortedOperationsTableRows"
                    :sort-by="sortBy"
                    :sort-order="sortOrder"
                    :loading="false"
                    :default-columns="false"
                    :enable-column-reorder="false"
                    :enable-row-expand="false"
                    :enable-text-highlight="false"
                    :enable-status-bar="false"
                    :enable-ai-context-button="false"
                    :row-height="28"
                    @sort-change="handleSortChange"
                    @click:data-row="
                      (row: any) =>
                        navigateToTraces({ operationName: row.operation })
                    "
                  >
                    <template #cell-errors="{ item }">
                      <span
                        :class="
                          item.errors > 0
                            ? 'tw:text-[var(--q-negative)] tw:font-semibold'
                            : ''
                        "
                        >{{ item.errors }}</span
                      >
                    </template>
                    <template #cell-p99="{ item }">
                      <span
                        :class="
                          item.p99 > 0
                            ? 'tw:text-[var(--o2-latency-p99)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p99) }}</span
                      >
                    </template>
                    <template #cell-p95="{ item }">
                      <span
                        :class="
                          item.p95 > 0
                            ? 'tw:text-[var(--o2-latency-p95)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p95) }}</span
                      >
                    </template>
                    <template #cell-p75="{ item }">
                      <span
                        :class="
                          item.p75 > 0
                            ? 'tw:text-[var(--o2-latency-p75)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p75) }}</span
                      >
                    </template>
                    <template #cell-actions="{ row, column, active }">
                      <OButton
                        v-if="active"
                        variant="ghost"
                        size="icon"
                        class="tw:ml-1 tw:absolute! tw:right-2!"
                        data-test="service-graph-side-panel-view-traces-btn"
                        @click.stop="
                          navigateToTraces({
                            operationName: row.operation,
                            errorsOnly: column.id === 'errors',
                            minDurationMicros: row[column.id]
                          })
                        "
                      >
                        <q-icon name="search" size="0.8rem" />
                        <q-tooltip>View in Traces</q-tooltip>
                      </OButton>
                    </template>
                    <template #empty>
                      <div
                        class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                        style="color: var(--o2-text-secondary)"
                      >
                        No operations found
                      </div>
                    </template>
                  </TenstackTable>
                </div>
              </template>
            </OTabPanel>

            <!-- Nodes Tab -->
            <!-- Dynamic OTEL resource tabs (Pods, Nodes, Hosts, Containers, Functions, ECS Tasks…) -->
            <OTabPanel
              v-for="cfg in activeResourceTabConfigs"
              :key="cfg.id"
              :name="cfg.id"
              class="tw:p-0! panel-section"
              :data-test="`service-graph-side-panel-${cfg.id}`"
            >
              <div
                v-if="resourceTabLoading[cfg.id]"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading {{ cfg.label.toLowerCase() }}...</span>
              </div>
              <template v-else>
                <div
                  v-if="!resourceTabData[cfg.id]?.length"
                  class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                  style="color: var(--o2-text-secondary)"
                >
                  No {{ cfg.label.toLowerCase() }} data found
                </div>
                <div
                  v-else
                  class="tw:overflow-hidden tw:rounded"
                  :data-test="`service-graph-side-panel-${cfg.id}-table`"
                >
                  <TenstackTable
                    :columns="buildEntityTableColumns(cfg.colId, cfg.colLabel)"
                    :rows="sortResourceRows(buildResourceTableRows(cfg))"
                    :sort-by="sortBy"
                    :sort-order="sortOrder"
                    :loading="false"
                    :default-columns="false"
                    :enable-column-reorder="false"
                    :enable-row-expand="false"
                    :enable-text-highlight="false"
                    :enable-status-bar="false"
                    :enable-ai-context-button="false"
                    :row-height="28"
                    @sort-change="handleSortChange"
                    @click:data-row="
                      (row: any) =>
                        navigateToTraces({
                          resourceFilter: {
                            field: cfg.groupField,
                            value: row[cfg.colId],
                          },
                        })
                    "
                  >
                    <template #cell-actions="{ row, column, active }">
                      <OButton
                        v-if="active"
                        variant="ghost"
                        size="icon"
                        class="tw:ml-1 tw:absolute! tw:right-2!"
                        :data-test="`service-graph-side-panel-${cfg.id}-view-traces-btn`"
                        @click.stop="
                          navigateToTraces({
                            resourceFilter: {
                              field: cfg.groupField,
                              value: row[cfg.colId],
                            },
                            errorsOnly: column.id === 'errors',
                            minDurationMicros: row[column.id]
                          })
                        "
                      >
                        <q-icon name="search" size="0.8rem" />
                        <q-tooltip>View in Traces</q-tooltip>
                      </OButton>
                    </template>
                    <template #cell-errors="{ item }">
                      <span
                        :class="
                          item.errors > 0
                            ? 'tw:text-[var(--q-negative)] tw:font-semibold'
                            : ''
                        "
                        >{{ item.errors }}</span
                      >
                    </template>
                    <template #cell-p99="{ item }">
                      <span
                        :class="
                          item.p99 > 0
                            ? 'tw:text-[var(--o2-latency-p99)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p99) }}</span
                      >
                    </template>
                    <template #cell-p95="{ item }">
                      <span
                        :class="
                          item.p95 > 0
                            ? 'tw:text-[var(--o2-latency-p95)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p95) }}</span
                      >
                    </template>
                    <template #cell-p75="{ item }">
                      <span
                        :class="
                          item.p75 > 0
                            ? 'tw:text-[var(--o2-latency-p75)]'
                            : ''
                        "
                        >{{ formatOperationLatency(item.p75) }}</span
                      >
                    </template>
                    <template #empty>
                      <div
                        class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                        style="color: var(--o2-text-secondary)"
                      >
                        No {{ cfg.label.toLowerCase() }} data found
                      </div>
                    </template>
                  </TenstackTable>
                </div>
              </template>
            </OTabPanel>

            <!-- Metrics Tab -->
            <OTabPanel
              name="metrics"
              class="tw:p-0! panel-section tw:mb-0! tw:h-full!"
              data-test="service-graph-side-panel-metrics"
            >
              <!-- Loading state -->
              <div
                v-if="metricsCorrelationLoading"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
                data-test="service-graph-side-panel-metrics-loading"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading metrics...</span>
              </div>

              <!-- Error state -->
              <div
                v-else-if="metricsCorrelationError"
                class="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:py-6 tw:text-center tw:text-sm"
                style="color: var(--o2-text-secondary)"
                data-test="service-graph-side-panel-metrics-error"
              >
                <span>{{ metricsCorrelationError }}</span>
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  data-test="service-graph-side-panel-metrics-retry-btn"
                  @click="fetchMetricsCorrelation(true)"
                  >Retry</OButton
                >
              </div>

              <!-- Metrics dashboard -->
              <TelemetryCorrelationDashboard
                v-else-if="metricsCorrelationData"
                mode="embedded-tabs"
                external-active-tab="metrics"
                :service-name="metricsCorrelationData.serviceName"
                :matched-dimensions="metricsCorrelationData.matchedDimensions"
                :additional-dimensions="
                  metricsCorrelationData.additionalDimensions
                "
                :metric-streams="metricsCorrelationData.metricStreams"
                :log-streams="metricsCorrelationData.logStreams"
                :trace-streams="metricsCorrelationData.traceStreams"
                :source-stream="streamFilter"
                source-type="traces"
                :time-range="telemetryTimeRange"
                :hide-dimension-filters="true"
                :metric-group-definitions="metricGroupResources"
                :panelHeight="12"
                :panelWidth="96"
                data-test="service-graph-side-panel-metrics-dashboard"
              />

              <!-- Empty state -->
              <div
                v-else-if="metricsCorrelationLoaded"
                class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                style="color: var(--o2-text-secondary)"
                data-test="service-graph-side-panel-metrics-empty"
              >
                No metrics available for this service.
              </div>
            </OTabPanel>
          </OTabPanels>
        </template>
      </div>
    </div>
  </transition>

  <!-- Telemetry Correlation Dialog (reuses the same component as "show related" on logs page) -->
  <TelemetryCorrelationDashboard
    v-if="showTelemetryDialog && correlationData"
    mode="dialog"
    :service-name="correlationData.serviceName"
    :matched-dimensions="correlationData.matchedDimensions"
    :additional-dimensions="correlationData.additionalDimensions"
    :log-streams="correlationData.logStreams"
    :metric-streams="correlationData.metricStreams"
    :trace-streams="correlationData.traceStreams"
    :time-range="telemetryTimeRange"
    :metric-group-definitions="metricGroupResources"
    @close="showTelemetryDialog = false"
  />
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import {
  defineComponent,
  computed,
  ref,
  watch,
  defineAsyncComponent,
  type PropType,
} from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import streamService from "@/services/stream";
import {
  correlate as correlateStreams,
  getSemanticGroups,
  getDimensionAnalytics,
  type FieldAlias,
  type FoundGroup,
} from "@/services/service_streams";
import { ENV_SEGMENTS, groupEnvKey } from "@/utils/serviceStreamEnvs";
import {
  escapeSingleQuotes,
  deepCopy,
  formatTimeWithSuffix,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics/metrics.json";
import {
  type MetricGroupDefinition,
  K8S_METRIC_GROUP_DEFINITIONS,
} from "@/utils/metrics/metricGrouping";
import DeployedCode from "@/components/icons/DeployedCode.vue";
import { useI18n } from "vue-i18n";

const TelemetryCorrelationDashboard = defineAsyncComponent(
  () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
);

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TenstackTable = defineAsyncComponent(
  () => import("@/components/TenstackTable.vue"),
);

// ---------------------------------------------------------------------------
// OTEL Resource Tab Configuration
// ---------------------------------------------------------------------------
// Resource tabs are derived dynamically from getDimensionAnalytics (org-wide).
//
// Priority logic:
//   - If any ENV_SEGMENTS groups (k8s / aws / azure / gcp) are present in the
//     current stream schema → show ONLY those platform-specific tabs.
//   - Otherwise → show generic fallbacks (host, container, faas, process, cloud).
//
// Within the shown set, DEFAULT_GROUP_IDS determines which tabs are pre-selected.
// ---------------------------------------------------------------------------

export interface ResourceTabConfig {
  id: string; // unique tab name (= FoundGroup.group_id)
  label: string; // display label
  groupField: string; // SQL GROUP BY field (= FoundGroup.aliases["traces"])
  colLabel: string; // header of the first column (entity name)
  colId: string; // row property key for the entity name column
  environment: string; // env key derived from group_id first segment
  isDefault: boolean; // pre-selected when the environment is first detected
}

export interface ResourceRow {
  name: string;
  requestCount: number;
  errorCount: number;
  p50Latency: number;
  p75Latency: number;
  p95Latency: number;
  p99Latency: number;
}

// OTEL semantic field names (OpenObserve format: service_ prefix, dots → underscores)
// that are pre-selected by default when their environment is detected.
// Keyed on the actual stream field, not on the internal group_id, so this stays
// in sync with OTEL semantic conventions regardless of backend group_id naming.
const DEFAULT_GROUP_FIELDS = new Set([
  // Kubernetes
  "service_k8s_pod_name",
  "service_k8s_node_name",
  // Host
  "service_host_name",
  // Container
  "service_container_name",
  // Serverless (FaaS)
  "service_faas_name",
  // AWS ECS
  "service_aws_ecs_task_arn",
  "service_aws_ecs_container_name",
  // Cloud
  "service_cloud_region",
  // Process / runtime
  "service_process_runtime_name",
  "service_process_runtime_version",
  // Service identity
  "service_namespace",
  "service_version",
]);

// Generic environment display labels for non-primary-platform segments.
// Primary platform labels (k8s/aws/azure/gcp) come from the shared ENV_SEGMENTS.
const GENERIC_ENV_LABELS: Record<string, string> = {
  host: "Host",
  container: "Container",
  faas: "Serverless",
  process: "Runtime",
  cloud: "Cloud",
};

/** Gets a display label for any environment key, platform or generic. */
const envLabel = (envKey: string): string =>
  Object.values(ENV_SEGMENTS).find((e) => e.key === envKey)?.label ??
  GENERIC_ENV_LABELS[envKey] ??
  envKey;

export default defineComponent({
  name: "ServiceGraphNodeSidePanel",
  components: {
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OButton,
    ODropdown,
    ODropdownItem,
    TelemetryCorrelationDashboard,
    TenstackTable,
    RenderDashboardCharts,
  },
  props: {
    selectedNode: {
      type: Object as PropType<any>,
      required: true,
    },
    graphData: {
      type: Object as PropType<{ nodes: any[]; edges: any[] }>,
      required: true,
    },
    timeRange: {
      type: Object as PropType<{ startTime: number; endTime: number }>,
      required: true,
    },
    visible: {
      type: Boolean,
      required: true,
    },
    streamFilter: {
      type: String,
      required: true,
    },
  },
  emits: ["close", "view-traces"],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();
    const { t } = useI18n();
    const router = useRouter();

    // RED Charts State
    const dashboardData = ref<any>({});

    // Local datazoom filter map (keyed by panelId)
    const localRangeFilters = ref<
      Map<
        string,
        {
          panelTitle: string;
          start: number | null;
          end: number | null;
          timeStart: number | null;
          timeEnd: number | null;
        }
      >
    >(new Map());
    // Reactivity trigger for Map changes (Vue 3 doesn't track Map.set() automatically)
    const rangeFiltersVersion = ref(0);
    const selectedTimeObj = ref({
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    });

    const currentTimeObj = ref({
      __global: {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      },
    });

    // Returns the escaped service name value for use in SQL WHERE clauses
    const buildServiceName = (): string => {
      if (!props.selectedNode) return "";
      const name =
        props.selectedNode.name ||
        props.selectedNode.label ||
        props.selectedNode.id;
      return escapeSingleQuotes(name);
    };

    const loadDashboard = () => {
      if (!props.selectedNode || props.streamFilter === "all") {
        dashboardData.value = {};
        return;
      }

      const serviceName = buildServiceName();
      const streamName = props.streamFilter;

      selectedTimeObj.value = {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      };

      currentTimeObj.value = {
        __global: {
          start_time: new Date(props.timeRange.startTime),
          end_time: new Date(props.timeRange.endTime),
        },
      };

      const convertedDashboard = convertDashboardSchemaVersion(
        deepCopy(metrics),
      );
      const serviceFilter = `service_name = '${serviceName}'`;

      convertedDashboard.tabs[0].panels.forEach((panel: any, index) => {
        let whereClause: string;

        if (panel.title === "Errors") {
          whereClause = `WHERE span_status = 'ERROR' AND ${serviceFilter}`;
        } else {
          whereClause = `WHERE ${serviceFilter}`;
        }

        panel.layout.h = 10;

        let query = panel.queries[0].query
          .replace("[STREAM_NAME]", () => `"${streamName}"`)
          .replace("[WHERE_CLAUSE]", () => whereClause);

        // Use count(*) instead of approx_distinct(trace_id)
        query = query
          .replace(
            /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
            "count(*) FILTER (WHERE span_status = 'ERROR')",
          )
          .replace(/approx_distinct\(trace_id\)/gi, "count(*)");

        convertedDashboard.tabs[0].panels[index]["queries"][0].query = query;
      });

      dashboardData.value = convertedDashboard;
    };

    const createRangeFilter = (
      data: any,
      start: number | null = null,
      end: number | null = null,
      timeStart: number | null = null,
      timeEnd: number | null = null,
    ) => {
      const panelId = data?.id;
      const panelTitle = data?.title || "Chart";
      if (
        panelId &&
        (panelTitle === "Duration" ||
          panelTitle === "Rate" ||
          panelTitle === "Errors")
      ) {
        localRangeFilters.value.set(panelId, {
          panelTitle,
          start: start != null ? Math.floor(start) : null,
          end: end != null ? Math.floor(end) : null,
          timeStart: timeStart != null ? Math.floor(timeStart) : null,
          timeEnd: timeEnd != null ? Math.floor(timeEnd) : null,
        });
        rangeFiltersVersion.value++;
      }
    };

    const onDataZoom = ({
      start,
      end,
      start1,
      end1,
      data,
    }: {
      start: number;
      end: number;
      start1: number;
      end1: number;
      data: any;
    }) => {
      if (start && end) {
        const panelTitle = data?.title;
        if (panelTitle === "Rate" || panelTitle === "Errors") {
          createRangeFilter(data, -1, -1, start * 1000, end * 1000);
        } else {
          createRangeFilter(data, start1, end1, start * 1000, end * 1000);
        }
        rangeFiltersVersion.value++;
      }
    };

    const removeLocalRangeFilter = (panelId: string) => {
      localRangeFilters.value.delete(panelId);
      rangeFiltersVersion.value++;
    };

    const filterChips = computed(() => {
      // Access rangeFiltersVersion to force reactivity when Map changes
      rangeFiltersVersion.value;
      const chips: {
        key: string;
        label: string;
        type: "duration" | "error";
      }[] = [];
      localRangeFilters.value.forEach((f, key) => {
        if (
          f.panelTitle === "Duration" &&
          f.start !== null &&
          f.end !== null &&
          f.start > 0 &&
          f.end > 0
        ) {
          chips.push({
            key,
            type: "duration",
            label: `Duration: ${formatTimeWithSuffix(f.start)} – ${formatTimeWithSuffix(f.end)}`,
          });
        } else if (f.panelTitle === "Errors") {
          chips.push({ key, type: "error", label: "Status: Error" });
        }
      });
      return chips;
    });

    const viewInTraces = () => {
      let errorsOnly = false;
      let minDurationMicros: number | undefined;
      let maxDurationMicros: number | undefined;

      localRangeFilters.value.forEach((f) => {
        if (f.panelTitle === "Errors") errorsOnly = true;
        if (f.panelTitle === "Duration" && f.start !== null && f.start > 0) {
          minDurationMicros = f.start;
          maxDurationMicros = f.end;
        }
      });

      navigateToTraces({ errorsOnly, minDurationMicros, maxDurationMicros });
    };

    // Metric group definitions — controls which category tabs and default selections
    // appear in the metrics dashboard. Uses K8S_METRIC_GROUP_DEFINITIONS for OTel
    // semantic defaults; overrides the pods icon with the project-specific component.
    const metricGroupResources = ref<MetricGroupDefinition[]>(
      K8S_METRIC_GROUP_DEFINITIONS.map((g) =>
        g.id === "pods" ? { ...g, icon: DeployedCode } : g,
      ),
    );

    // Metrics Correlation State
    const showTelemetryDialog = ref(false);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      logStreams: any[];
      metricStreams: any[];
      traceStreams: any[];
    } | null>(null);

    const telemetryTimeRange = computed(() => ({
      startTime: props.timeRange.startTime,
      endTime: props.timeRange.endTime,
    }));

    // Metrics Tab State (independent from "Show Telemetry" dialog)
    const metricsCorrelationLoading = ref(false);
    const metricsCorrelationError = ref<string | null>(null);
    const metricsCorrelationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      logStreams: any[];
      metricStreams: any[];
      traceStreams: any[];
    } | null>(null);
    const metricsCorrelationLoaded = ref(false);

    const fetchCorrelatedStreams = async (force = false) => {
      if (!props.selectedNode) return;
      if (!force && correlationData.value) return;

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        const serviceName =
          props.selectedNode.name ||
          props.selectedNode.label ||
          props.selectedNode.id;

        // Send service name directly to _correlate
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const data = correlateResponse.data;
        if (!data) {
          correlationError.value = "No correlated streams found.";
          correlationData.value = null;
          return;
        }

        correlationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          correlationError.value =
            "Service Discovery is an enterprise feature.";
        } else {
          correlationError.value =
            err.message || "Failed to load service streams.";
        }
        correlationData.value = null;
      } finally {
        correlationLoading.value = false;
      }
    };

    // Reset correlation data when node changes
    watch(
      () => props.selectedNode?.id,
      () => {
        correlationData.value = null;
        correlationError.value = null;
      },
    );

    // Extract semantic dimensions from a span for richer metric correlation
    const extractSpanDimensions = (
      span: Record<string, any>,
    ): Record<string, string> => {
      const dimensions: Record<string, string> = {};
      if (span.service_name) dimensions["service"] = span.service_name;

      const attributeMappings: Record<string, string> = {
        k8s_namespace_name: "k8s-namespace",
        "k8s.namespace.name": "k8s-namespace",
        k8s_deployment_name: "k8s-deployment",
        "k8s.deployment.name": "k8s-deployment",
        k8s_pod_name: "k8s-pod",
        "k8s.pod.name": "k8s-pod",
        k8s_container_name: "k8s-container",
        "k8s.container.name": "k8s-container",
        k8s_node_name: "k8s-node",
        "k8s.node.name": "k8s-node",
        k8s_cluster_name: "k8s-cluster",
        "k8s.cluster.name": "k8s-cluster",
        host_name: "host-name",
        "host.name": "host-name",
        cloud_region: "cloud-region",
        "cloud.region": "cloud-region",
        cloud_availability_zone: "cloud-availability-zone",
        "cloud.availability_zone": "cloud-availability-zone",
        container_name: "container-name",
        "container.name": "container-name",
      };

      for (const [attr, dim] of Object.entries(attributeMappings)) {
        let service_attr = "service_" + attr;
        if (span[service_attr] && !dimensions[dim]) {
          dimensions[dim] = String(span[service_attr]);
        }
      }
      return dimensions;
    };

    // Fetch the most recent span for this service to extract rich semantic dimensions
    const fetchLatestSpan = async (): Promise<Record<string, any> | null> => {
      const serviceName = buildServiceName();
      const streamName = props.streamFilter || "default";
      const org = store.state.selectedOrganization.identifier;

      try {
        const response = await searchService.search({
          org_identifier: org,
          query: {
            query: {
              sql: `SELECT * FROM "${streamName}" WHERE service_name = '${escapeSingleQuotes(serviceName)}' ORDER BY _timestamp DESC`,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 1,
            },
          },
          page_type: "traces",
        });
        return response.data?.hits?.[0] ?? null;
      } catch {
        return null;
      }
    };

    // Fetch correlated metric streams for the Metrics tab
    const fetchMetricsCorrelation = async (force = false) => {
      if (!props.selectedNode) return;
      if (!force && metricsCorrelationLoaded.value) return;

      metricsCorrelationLoading.value = true;
      metricsCorrelationError.value = null;
      metricsCorrelationData.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        const serviceName = buildServiceName();

        // Fetch latest span to extract richer semantic dimensions
        const latestSpan = await fetchLatestSpan();
        const spanDimensions = {
          service: serviceName,
        };

        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: spanDimensions,
        });

        const data = correlateResponse.data;
        if (!data) {
          metricsCorrelationData.value = null;
          return;
        }

        metricsCorrelationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          metricsCorrelationError.value =
            "Service Discovery is an enterprise feature.";
        } else {
          metricsCorrelationError.value =
            err.message || "Failed to load metrics.";
        }
        metricsCorrelationData.value = null;
      } finally {
        metricsCorrelationLoading.value = false;
        metricsCorrelationLoaded.value = true;
      }
    };

    // Reload RED charts when node, time range, stream, or visibility changes
    watch(
      () =>
        [
          props.selectedNode?.id,
          props.timeRange,
          props.streamFilter,
          props.visible,
        ] as const,
      ([, , , visible]) => {
        if (visible && props.selectedNode) {
          loadDashboard();
        } else if (!visible) {
          dashboardData.value = {};
        }
      },
      { immediate: true, deep: true },
    );

    // Active tab state
    const activeTab = ref<string>("operations");

    // Recent Operations State
    const operationsViewMode = ref<"aggregated" | "spans">("aggregated");
    const recentOperations = ref<any[]>([]);
    const recentSpanData = ref<{ errorSpans: any[]; slowSpans: any[] }>({
      errorSpans: [],
      slowSpans: [],
    });
    const loadingOperations = ref(false);

    // Dynamic resource tabs state (replaces per-resource recentNodes/recentPods/loadingNodes/loadingPods)
    const resourceTabData = ref<Record<string, ResourceRow[]>>({});
    const resourceTabLoading = ref<Record<string, boolean>>({});
    // Resource groups from getDimensionAnalytics that match the current stream schema
    // (after platform-priority filtering — see resolveWorkloadFields)
    const availableResourceTabConfigs = ref<ResourceTabConfig[]>([]);
    // Tabs actually shown = those selected by the user in the dropdown
    const activeResourceTabConfigs = computed(() =>
      availableResourceTabConfigs.value.filter((c) =>
        selectedWorkloadFields.value.includes(c.id),
      ),
    );
    // Deduped list of environments detected from visible resource groups
    const detectedEnvironments = computed<{ key: string; label: string }[]>(
      () => {
        const seen = new Set<string>();
        const envs: { key: string; label: string }[] = [];
        for (const cfg of availableResourceTabConfigs.value) {
          if (!seen.has(cfg.environment)) {
            seen.add(cfg.environment);
            envs.push({
              key: cfg.environment,
              label: envLabel(cfg.environment),
            });
          }
        }
        return envs;
      },
    );

    // Workload Field Discovery State
    const resolvedWorkloadFields = ref<{ field: string; alias: FieldAlias }[]>(
      [],
    );
    // IDs of alias entries the user has checked in the dropdown
    const selectedWorkloadFields = ref<string[]>([]);

    // Computed: Service Metrics
    const serviceMetrics = computed(() => {
      if (!props.selectedNode || !props.graphData) {
        return {
          requestRate: "N/A",
          requestRateValue: "N/A",
          totalRequests: 0,
          incomingRequests: 0,
          outgoingRequests: 0,
          errorRate: "N/A",
          p50Latency: "N/A",
          p95Latency: "N/A",
          p99Latency: "N/A",
        };
      }

      // Get total request count - handle both graph view (uses 'value') and tree view (uses 'requests')
      const totalRequests =
        props.selectedNode.value || props.selectedNode.requests || 0;

      // Calculate incoming requests (sum of all edges TO this node)
      const incomingEdges = props.graphData.edges.filter(
        (edge: any) => edge.to === props.selectedNode.id,
      );
      const incomingRequests = incomingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Calculate outgoing requests (sum of all edges FROM this node)
      const outgoingEdges = props.graphData.edges.filter(
        (edge: any) => edge.from === props.selectedNode.id,
      );
      const outgoingRequests = outgoingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Get errors and calculate error rate
      const errors = props.selectedNode.errors || 0;
      const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

      // Calculate latency percentiles from incoming edges
      let p50Latency = 0;
      let p95Latency = 0;
      let p99Latency = 0;
      if (incomingEdges.length > 0) {
        p50Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p50_latency_ns || 0),
        );
        p95Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0),
        );
        p99Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p99_latency_ns || 0),
        );
      }

      // Format request rate value without unit
      let requestRateValue = "";
      if (totalRequests >= 1000000) {
        requestRateValue = (totalRequests / 1000000).toFixed(1) + "M";
      } else if (totalRequests >= 1000) {
        requestRateValue = (totalRequests / 1000).toFixed(1) + "K";
      } else {
        requestRateValue = totalRequests.toString();
      }

      return {
        requestRate: formatRequestRate(totalRequests),
        requestRateValue: requestRateValue,
        totalRequests: totalRequests,
        incomingRequests: incomingRequests,
        outgoingRequests: outgoingRequests,
        errorRate: errorRate.toFixed(2) + "%",
        p50Latency:
          incomingEdges.length > 0 ? formatLatency(p50Latency) : "N/A",
        p95Latency:
          incomingEdges.length > 0 ? formatLatency(p95Latency) : "N/A",
        p99Latency:
          incomingEdges.length > 0 ? formatLatency(p99Latency) : "N/A",
      };
    });

    // Computed: Service Health
    const serviceHealth = computed(() => {
      if (!props.selectedNode) {
        return {
          status: "unknown",
          text: "Unknown",
          color: "grey",
          icon: "help",
        };
      }

      // Use node's own error_rate directly
      const errorRate = props.selectedNode.error_rate || 0;

      if (errorRate > 10) {
        return {
          status: "critical",
          text: "Critical",
          color: "negative",
          icon: "error",
        };
      } else if (errorRate > 5) {
        return {
          status: "degraded",
          text: "Degraded",
          color: "warning",
          icon: "warning",
        };
      } else {
        return {
          status: "healthy",
          text: "Healthy",
          color: "positive",
          icon: "check_circle",
        };
      }
    });

    // Computed: Check if "All Streams" is selected
    const isAllStreamsSelected = computed(() => {
      return props.streamFilter === "all";
    });

    // Helper: Format Request Rate (with unit)
    const formatRequestRate = (requests: number): string => {
      if (requests >= 1000000) {
        return (requests / 1000000).toFixed(1) + "M req/min";
      }
      if (requests >= 1000) {
        return (requests / 1000).toFixed(1) + "K req/min";
      }
      return requests + " req/min";
    };

    // Helper: Format Number (without unit)
    const formatNumber = (num: number): string => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + "M";
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + "K";
      }
      return num.toString();
    };

    // Helper: Format Latency
    const formatLatency = (nanoseconds: number): string => {
      if (!nanoseconds || nanoseconds === 0) return "N/A";
      const milliseconds = nanoseconds / 1000000;
      if (milliseconds >= 1000) {
        return (milliseconds / 1000).toFixed(2) + "s";
      }
      return milliseconds.toFixed(0) + "ms";
    };

    // Helper: Format Operation Latency (from microseconds)
    const formatOperationLatency = (microseconds: number): string => {
      if (!microseconds || microseconds === 0) return "N/A";
      if (microseconds < 1000) return `${microseconds.toFixed(0)}μs`;
      const milliseconds = microseconds / 1000;
      if (milliseconds < 1000) return `${milliseconds.toFixed(1)}ms`;
      return `${(milliseconds / 1000).toFixed(2)}s`;
    };

    // Helper: Format Span Timestamp (from nanoseconds)
    const formatSpanTimestamp = (nanoseconds: number): string => {
      const date = new Date(nanoseconds / 1000000);
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    // ── Sorting state ──────────────────────────────────────────────────────
    const sortBy = ref<string>("");
    const sortOrder = ref<"asc" | "desc">("");

    function handleSortChange(field: string, order: "asc" | "desc") {
      sortBy.value = field;
      sortOrder.value = order;
    }

    const compareRows = (a: any, b: any, field: string): number => {
      // For latency percentiles, sort by raw underscore-prefixed values
      if (field === "p99" || field === "p95" || field === "p75") {
        return (a[field] ?? 0) - (b[field] ?? 0);
      }
      // For requests, sort by raw _requests value
      if (field === "requests") {
        return (a.requests ?? 0) - (b.requests ?? 0);
      }
      const va = a[field];
      const vb = b[field];
      if (typeof va === "number" && typeof vb === "number") {
        return va - vb;
      }
      return String(va ?? "").localeCompare(String(vb ?? ""));
    };

    const sortedOperationsTableRows = computed(() => {
      const rows = operationsTableRows.value;
      if (!sortBy.value) return rows;
      const order = sortOrder.value;
      return [...rows].sort((a, b) => {
        const result = compareRows(a, b, sortBy.value);
        return order === "desc" ? -result : result;
      });
    });

    const sortResourceRows = (rows: any[]) => {
      if (!sortBy.value) return rows;
      const order = sortOrder.value;
      return [...rows].sort((a, b) => {
        const result = compareRows(a, b, sortBy.value);
        return order === "desc" ? -result : result;
      });
    };

    // Generic helper: builds table columns with a dynamic first (entity) column
    const buildEntityTableColumns = (
      entityId: string,
      entityHeader: string,
    ) => [
      {
        id: entityId,
        accessorKey: entityId,
        header: entityHeader,
        size: 220,
        enableSorting: true,
        meta: { slot: false, sortable: true },
      },
      {
        id: "requests",
        accessorFn: (row: any) => formatNumber(row.requests),
        header: "Requests",
        size: 100,
        enableSorting: true,
        meta: { sortable: true },
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: "Errors",
        size: 80,
        enableSorting: true,
        meta: { slot: true, sortable: true },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: "P99",
        size: 80,
        enableSorting: true,
        meta: { slot: true, sortable: true },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: "P95",
        size: 80,
        enableSorting: true,
        meta: { slot: true, sortable: true },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: "P75",
        size: 80,
        enableSorting: true,
        meta: { slot: true, sortable: true },
      },
    ];

    // Computed: Operations table columns
    const operationsTableColumns = computed(() =>
      buildEntityTableColumns("operation", "Operation"),
    );

    // Computed: Operations table rows
    const operationsTableRows = computed(() =>
      recentOperations.value.map((op) => ({
        operation: op.name,
        requests: op.requestCount,
        errors: op.errorCount,
        p99: op.p99Latency,
        p95: op.p95Latency,
        p75: op.p75Latency,
        p50: op.p50Latency,
      })),
    );

    // Fetch aggregated operations (grouped by operation_name with percentiles)
    const fetchAggregatedOperations = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingOperations.value = true;
      recentOperations.value = [];

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const sql = `SELECT operation_name, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE service_name = '${serviceName}' GROUP BY operation_name`;

        const response = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 100,
            },
          },
          page_type: "traces",
        });

        if (response.data && response.data.hits) {
          recentOperations.value = response.data.hits.map((op: any) => ({
            name: op.operation_name || "unknown",
            requestCount: op.request_count || 0,
            errorCount: op.error_count || 0,
            p50Latency: op.p50_latency || 0,
            p75Latency: op.p75_latency || 0,
            p95Latency: op.p95_latency || 0,
            p99Latency: op.p99_latency || 0,
          }));
        }
      } catch (error) {
        console.error("Failed to fetch aggregated operations:", error);
        recentOperations.value = [];
      } finally {
        loadingOperations.value = false;
      }
    };

    // Fetch recent spans (error spans + slowest spans)
    const fetchRecentSpans = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingOperations.value = true;
      recentSpanData.value = { errorSpans: [], slowSpans: [] };

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const org = store.state.selectedOrganization.identifier;
        const timeParams = {
          start_time: props.timeRange.startTime,
          end_time: props.timeRange.endTime,
          from: 0,
        };

        const [errorRes, slowRes] = await Promise.all([
          searchService.search({
            org_identifier: org,
            query: {
              query: {
                sql: `SELECT operation_name, duration, start_time FROM "${streamName}" WHERE service_name = '${serviceName}' AND span_status = 'ERROR' ORDER BY start_time DESC`,
                ...timeParams,
                size: 5,
              },
            },
            page_type: "traces",
          }),
          searchService.search({
            org_identifier: org,
            query: {
              query: {
                sql: `SELECT operation_name, duration FROM "${streamName}" WHERE service_name = '${serviceName}' ORDER BY duration DESC`,
                ...timeParams,
                size: 20,
              },
            },
            page_type: "traces",
          }),
        ]);

        recentSpanData.value = {
          errorSpans: (errorRes.data?.hits || []).map((s: any) => ({
            name: s.operation_name || "unknown",
            duration: s.duration || 0,
            timestampDisplay: s.start_time
              ? formatSpanTimestamp(s.start_time)
              : "",
          })),
          slowSpans: (slowRes.data?.hits || []).map((s: any) => ({
            name: s.operation_name || "unknown",
            duration: s.duration || 0,
          })),
        };
      } catch (error) {
        console.error("Failed to fetch recent spans:", error);
        recentSpanData.value = { errorSpans: [], slowSpans: [] };
      } finally {
        loadingOperations.value = false;
      }
    };

    // Dispatch fetch based on current view mode
    const fetchOperations = () => {
      if (operationsViewMode.value === "aggregated") {
        fetchAggregatedOperations();
      } else {
        fetchRecentSpans();
      }
    };

    // Watch for panel visibility, node, stream filter, and view mode changes
    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        operationsViewMode.value,
      ],
      () => {
        if (
          props.visible &&
          props.selectedNode &&
          props.streamFilter !== "all"
        ) {
          fetchOperations();
        }
      },
      { immediate: true },
    );

    // Generic fetch for any OTEL resource tab config
    const fetchResourceData = async (config: ResourceTabConfig) => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      resourceTabLoading.value = {
        ...resourceTabLoading.value,
        [config.id]: true,
      };
      resourceTabData.value = { ...resourceTabData.value, [config.id]: [] };

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const groupField = config.groupField;
        const alias = config.colId + "_name";

        const sql = `SELECT ${groupField} as ${alias}, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE service_name = '${serviceName}' AND ${groupField} IS NOT NULL GROUP BY ${groupField} ORDER BY request_count DESC`;

        const response = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 100,
            },
          },
          page_type: "traces",
        });

        if (response.data?.hits) {
          resourceTabData.value = {
            ...resourceTabData.value,
            [config.id]: response.data.hits.map((row: any) => ({
              name: row[alias] || "unknown",
              requestCount: row.request_count || 0,
              errorCount: row.error_count || 0,
              p50Latency: row.p50_latency || 0,
              p75Latency: row.p75_latency || 0,
              p95Latency: row.p95_latency || 0,
              p99Latency: row.p99_latency || 0,
            })),
          };
        }
      } catch (error) {
        console.error(`Failed to fetch ${config.label} data:`, error);
        resourceTabData.value = { ...resourceTabData.value, [config.id]: [] };
      } finally {
        resourceTabLoading.value = {
          ...resourceTabLoading.value,
          [config.id]: false,
        };
      }
    };

    // Discover which workload fields exist in the trace stream and build resource tabs
    // via getDimensionAnalytics. Uses ENV_SEGMENTS priority: if any primary-platform
    // groups (k8s / aws / azure / gcp) match the schema, show only those. Otherwise
    // fall back to generic groups (host, container, faas, process, cloud).
    const resolveWorkloadFields = async () => {
      if (!props.visible || props.streamFilter === "all" || !props.streamFilter)
        return;

      try {
        const org = store.state.selectedOrganization.identifier;

        // Fetch semantic groups and build a reverse lookup map (field → alias)
        const semanticGroupsResponse = await getSemanticGroups(org);
        const fieldToAliasMap = new Map<string, FieldAlias>();
        for (const alias of semanticGroupsResponse.data) {
          for (const field of alias.fields) {
            fieldToAliasMap.set(field, alias);
          }
        }

        // Fetch trace stream schema
        const schemaResponse = await streamService.schema(
          org,
          props.streamFilter,
          "traces",
        );
        const schemaFields: { name: string; type: string }[] =
          schemaResponse.data?.schema || schemaResponse.data?.fields || [];
        const schemaFieldSet = new Set(schemaFields.map((f) => f.name));

        // Filter for service_ fields, intersect with semantic groups, deduplicate by alias.id
        const seen = new Set<string>();
        const matched: { field: string; alias: FieldAlias }[] = [];
        for (const schemaField of schemaFields) {
          if (!schemaField.name.startsWith("service_")) continue;
          const alias = fieldToAliasMap.get(schemaField.name);
          if (!alias || seen.has(alias.id)) continue;
          seen.add(alias.id);
          matched.push({ field: schemaField.name, alias });
        }
        resolvedWorkloadFields.value = matched;

        // Fetch org-wide dimension analytics to discover all available resource groups
        const analyticsResp = await getDimensionAnalytics(org);
        const allGroups: FoundGroup[] =
          analyticsResp.data?.available_groups ?? [];

        // Filter to groups whose traces (or spans) alias exists in this stream's schema
        const schemaMatchedGroups = allGroups.filter((g) => {
          const field = g.aliases["traces"] ?? g.aliases["spans"];
          return field && schemaFieldSet.has(field);
        });

        // Apply ENV_SEGMENTS priority
        // If any primary-platform groups (k8s / aws / azure / gcp) are present
        // in this stream, show ONLY those. Otherwise fall back to generic groups.
        const platformGroups = schemaMatchedGroups.filter(
          (g) => groupEnvKey(g.group_id) !== null,
        );
        const visibleGroups =
          platformGroups.length > 0 ? platformGroups : schemaMatchedGroups;

        // Build ResourceTabConfig from FoundGroup data
        availableResourceTabConfigs.value = visibleGroups.map((g) => {
          const field = g.aliases["traces"] ?? g.aliases["spans"] ?? "";
          const envKey = groupEnvKey(g.group_id) ?? g.group_id.split("-")[0];
          return {
            id: g.group_id,
            label: g.display,
            groupField: field,
            colLabel: g.display,
            colId: g.group_id.replace(/-/g, "_"),
            environment: envKey,
            isDefault: DEFAULT_GROUP_FIELDS.has(field),
          };
        });

        // Smart defaults — pre-select only the important groups
        selectedWorkloadFields.value = availableResourceTabConfigs.value
          .filter((c) => c.isDefault)
          .map((c) => c.id);
      } catch (err) {
        console.error(
          "[ServiceGraphNodeSidePanel] Failed to resolve workload fields:",
          err,
        );
        resolvedWorkloadFields.value = [];
        availableResourceTabConfigs.value = [];
        selectedWorkloadFields.value = [];
      }
    };

    // Build table rows for any resource tab config
    const buildResourceTableRows = (config: ResourceTabConfig) =>
      (resourceTabData.value[config.id] || []).map((row) => ({
        [config.colId]: row.name,
        requests: row.requestCount,
        errors: row.errorCount,
        p99: row.p99Latency,
        p95: row.p95Latency,
        p75: row.p75Latency,
        p50: row.p50Latency,
      }));

    // Lazy-fetch resource tab data / metrics when their tab is activated
    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        activeTab.value,
      ],
      () => {
        if (
          !props.visible ||
          !props.selectedNode ||
          props.streamFilter === "all"
        )
          return;
        const config = activeResourceTabConfigs.value.find(
          (c) => c.id === activeTab.value,
        );
        if (config && !resourceTabData.value[config.id]?.length) {
          fetchResourceData(config);
        }
        if (activeTab.value === "metrics") fetchMetricsCorrelation();
      },
    );

    // Trigger workload field discovery when the panel becomes visible with a valid stream
    watch(
      () => [props.visible, props.selectedNode?.id, props.streamFilter],
      ([visible]) => {
        if (visible && props.selectedNode && props.streamFilter !== "all") {
          resolveWorkloadFields();
        }
      },
      { immediate: true },
    );

    // Reset resource tab data, local filters, and go back to operations tab when node or stream changes
    watch(
      () => [props.selectedNode?.id, props.streamFilter],
      () => {
        resourceTabData.value = {};
        resourceTabLoading.value = {};
        availableResourceTabConfigs.value = [];
        resolvedWorkloadFields.value = [];
        selectedWorkloadFields.value = [];
        metricsCorrelationData.value = null;
        metricsCorrelationError.value = null;
        metricsCorrelationLoaded.value = false;
        activeTab.value = "operations";
        localRangeFilters.value.clear();
        rangeFiltersVersion.value++;
      },
    );

    // Navigate to traces explore page with contextual filters
    const navigateToTraces = (params: {
      operationName?: string;
      /** @deprecated use resourceFilter instead */
      nodeName?: string;
      /** @deprecated use resourceFilter instead */
      podName?: string;
      /** Generic OTEL resource filter: { field: stream field name, value: field value } */
      resourceFilter?: { field: string; value: string };
      errorsOnly?: boolean;
      minDurationMicros?: number;
      maxDurationMicros?: number;
      mode?: "spans" | "traces";
    }) => {
      emit("view-traces", {
        stream: props.streamFilter,
        serviceName:
          props.selectedNode?.name ||
          props.selectedNode?.label ||
          props.selectedNode?.id,
        operationName: params.operationName,
        nodeName: params.nodeName,
        podName: params.podName,
        resourceFilter: params.resourceFilter,
        errorsOnly: params.errorsOnly,
        minDurationMicros: params.minDurationMicros,
        maxDurationMicros: params.maxDurationMicros,
        timeRange: props.timeRange,
        mode: params.mode || "spans",
      });
    };

    // Handlers
    const handleClose = () => {
      emit("close");
    };

    const viewRelatedTraces = () => {
      navigateToTraces({ mode: "traces" });
    };

    const viewRelatedLogs = async () => {
      const serviceName = buildServiceName();
      if (!serviceName) return;

      const org = store.state.selectedOrganization.identifier;

      let streamName: string | undefined;
      let filterQuery = `service_name='${escapeSingleQuotes(serviceName)}'`;

      try {
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const logStreams = correlateResponse.data?.related_streams?.logs || [];
        if (logStreams.length > 0) {
          const firstLogStream = logStreams[0];
          streamName = firstLogStream.stream_name;

          // Build filter from the stream's resolved field names
          const filters: Record<string, string> = firstLogStream.filters || {};
          const filterParts = Object.entries(filters)
            .map(([field, value]) => `${field}='${escapeSingleQuotes(value)}'`)
            .join(" AND ");
          if (filterParts) {
            filterQuery = filterParts;
          }
        } else {
          $q.notify({
            type: "warning",
            message: t("traces.noLogsAvailableForService"),
            timeout: 3000,
            position: "bottom",
          });
          return;
        }
      } catch {
        $q.notify({
          type: "warning",
          message: t("traces.noLogsAvailableForService"),
          timeout: 3000,
          position: "bottom",
        });
        return;
      }

      const queryParams: any = {
        stream_type: "logs",
        from: props.timeRange.startTime,
        to: props.timeRange.endTime,
        sql_mode: "false",
        query: b64EncodeUnicode(filterQuery),
        org_identifier: org,
      };

      if (streamName) {
        queryParams.stream_value = streamName;
      }

      router.push({
        path: "/logs",
        query: queryParams,
      });
    };

    const handleShowTelemetry = async () => {
      await fetchCorrelatedStreams();
      if (correlationData.value) {
        showTelemetryDialog.value = true;
      } else if (correlationError.value) {
        $q.notify({
          type: "warning",
          message: correlationError.value,
          timeout: 3000,
          position: "bottom",
        });
      }
    };

    // Get color class for error rate card
    const getErrorRateClass = (): string => {
      const errorRateStr = serviceMetrics.value.errorRate;
      if (errorRateStr === "N/A") return "status-unknown";

      const errorRate = parseFloat(errorRateStr);
      if (errorRate < 1) return "status-healthy";
      if (errorRate < 5) return "status-warning";
      return "status-critical";
    };

    // Get color class for latency card
    const getLatencyClass = (latencyStr: string): string => {
      if (latencyStr === "N/A") return "status-unknown";

      // Parse latency value (could be "125ms" or "1.5s")
      let latencyMs = 0;
      if (latencyStr.endsWith("ms")) {
        latencyMs = parseFloat(latencyStr);
      } else if (latencyStr.endsWith("s")) {
        latencyMs = parseFloat(latencyStr) * 1000;
      }

      if (latencyMs < 100) return "status-healthy";
      if (latencyMs < 500) return "status-warning";
      return "status-critical";
    };

    return {
      t,
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      formatNumber,
      getErrorRateClass,
      getLatencyClass,
      handleClose,
      viewRelatedTraces,
      viewRelatedLogs,
      handleShowTelemetry,
      // RED Charts
      dashboardData,
      selectedTimeObj,
      currentTimeObj,
      loadDashboard,
      // DataZoom filters
      filterChips,
      onDataZoom,
      removeLocalRangeFilter,
      viewInTraces,
      // Telemetry Correlation
      showTelemetryDialog,
      correlationLoading,
      correlationData,
      telemetryTimeRange,
      // Tabs
      activeTab,
      // Recent Operations
      loadingOperations,
      recentOperations,
      operationsTableColumns,
      operationsTableRows,
      navigateToTraces,
      // Dynamic resource tabs (OTEL platforms)
      availableResourceTabConfigs,
      activeResourceTabConfigs,
      detectedEnvironments,
      resourceTabData,
      resourceTabLoading,
      buildEntityTableColumns,
      buildResourceTableRows,
      // Workload Field Discovery
      resolvedWorkloadFields,
      selectedWorkloadFields,
      // Metrics Tab
      metricsCorrelationLoading,
      metricsCorrelationError,
      metricsCorrelationData,
      metricsCorrelationLoaded,
      fetchMetricsCorrelation,
      metricGroupResources,
      sortedOperationsTableRows,
      sortBy,
      sortOrder,
      handleSortChange,
      sortResourceRows,
      formatOperationLatency,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-side-panel {
  position: absolute;
  right: 0;
  top: 0;
  min-width: 600px;
  width: 60%;
  height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #1a1f2e;
  border-left: 1px solid #2d3548;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

// Light mode support
.body--light .service-graph-side-panel {
  background: #ffffff;
  border-left: 1px solid #e0e0e0;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

// Slide animation
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.slide-enter-to,
.slide-leave-from {
  transform: translateX(0);
}

// Header (compact with inline health badge)
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d3548;
  background: #1a1f2e;
  flex-shrink: 0;

  .panel-title {
    flex: 1;

    .service-name {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      line-height: 1.2; // Reduce line height for compactness
      color: #e4e7eb;
      letter-spacing: normal;
      display: flex;
      align-items: center;
      gap: 10px;

      .health-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px; // Reduced from 6px
        padding: 2px 8px; // Reduced from 4px 10px for more compact badge
        border-radius: 10px; // Slightly reduced from 12px
        font-size: 11px; // Reduced from 12px
        font-weight: 600;
        line-height: 1;

        // Add dot indicator
        &::before {
          content: "●";
          font-size: 10px; // Reduced from 12px
        }

        &.healthy {
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
        }

        &.degraded {
          background: rgba(251, 191, 36, 0.15);
          color: #fbbf24;
        }

        &.critical {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        &.warning {
          background: rgba(249, 115, 22, 0.15);
          color: #f97316;
        }
      }
    }
  }

  .panel-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .telemetry-btn {
    background: linear-gradient(135deg, #3b82f6, #6366f1) !important;
    color: #fff !important;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition: all 0.2s;

    &:hover {
      filter: brightness(1.1);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }
  }
}

.body--light .panel-header {
  border-bottom: 1px solid #e0e0e0;
  background: #f5f5f5;

  .panel-title {
    .service-name {
      color: #202124;
      line-height: 1.2;

      .health-badge {
        &.healthy {
          background: rgba(16, 185, 129, 0.08);
          color: #059669;
        }

        &.degraded {
          background: rgba(251, 191, 36, 0.08);
          color: #d97706;
        }

        &.critical {
          background: rgba(239, 68, 68, 0.08);
          color: #dc2626;
        }

        &.warning {
          background: rgba(249, 115, 22, 0.08);
          color: #ea580c;
        }
      }
    }
  }
}

// Actions Section (moved to content area)
.actions-section {
  display: flex;
  gap: 8px;
  padding: 0;
  margin-bottom: 8px;
  flex-wrap: wrap;

  .action-btn {
    width: 35%;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid #2d3548;
    color: #e4e7eb;
    background: #242938;
    transition: all 0.2s;

    &:hover {
      background: #1a1f2e;
      border-color: #3b82f6;
      transform: translateY(-1px);
    }
  }
}

.view-traces-btn {
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 4px;
  padding: 0px 12px;
  min-width: 90px;
  transition:
    box-shadow 0.3s ease,
    opacity 0.2s ease;
  background: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%);

  &:hover {
    opacity: 0.8;
    box-shadow: 0 0 7px
      color-mix(in srgb, var(--o2-primary-btn-bg), transparent 10%);
  }
}

.body--light .actions-section .action-btn {
  border-color: #e0e0e0;
  color: #333;
  background: #f9f9f9;

  &:hover {
    background: #ffffff;
    border-color: #3b82f6;
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #0f1419;
  padding: 0.625rem;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: #1a1f2e;
  }

  &::-webkit-scrollbar-thumb {
    background: #242938;
    border-radius: 4px;

    &:hover {
      background: #2d3548;
    }
  }
}

.body--light .panel-content {
  background: #ffffff;

  &::-webkit-scrollbar-track {
    background: #f8f9fa;
  }

  &::-webkit-scrollbar-thumb {
    background: #e0e0e0;

    &:hover {
      background: #d0d0d0;
    }
  }
}

.operation-row {
  transition: background 0.15s ease;

  &:hover {
    background: rgba(99, 102, 241, 0.1);

    .operation-link-icon {
      opacity: 1 !important;
    }
  }

  .operation-link-icon {
    opacity: 0;
    color: var(--o2-text-secondary);
    transition: opacity 0.15s ease;
  }
}

.body--light .operation-row:hover {
  background: rgba(99, 102, 241, 0.07);
}

.panel-section {
  padding: 0;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-header-actions {
    display: flex;
    gap: 6px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: #e4e7eb;
  }
}

.body--light .panel-section .section-title {
  color: #202124;
}

.metrics-section {
  // Full-width card for total requests (single line)
  .metric-card-full {
    padding: 10px 12px;
    border-radius: 8px;
    background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
    border: 1px solid #374151;
    margin-bottom: 12px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    &:hover {
      transform: translateY(-2px);
      box-shadow:
        0 6px 12px rgba(0, 0, 0, 0.2),
        0 0 0 1px rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.4);
    }

    .metric-single-line {
      display: flex;
      align-items: center;
      gap: 12px;

      .metric-total {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 6px;
        background: linear-gradient(
          135deg,
          rgba(99, 102, 241, 0.08),
          rgba(99, 102, 241, 0.02)
        );
        border: 1px solid rgba(99, 102, 241, 0.15);

        .total-label {
          font-size: 12px;
          font-weight: 600;
          color: #a5b4fc;
        }

        .total-value {
          font-size: 16px;
          font-weight: 800;
          color: #e0e7ff;
          letter-spacing: -0.02em;
        }

        .total-unit {
          font-size: 10px;
          font-weight: 500;
          color: #a5b4fc;
        }
      }

      .metric-divider {
        width: 1px;
        height: 20px;
        background: #374151;
      }

      .metric-inline {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s ease;
        flex: 1;

        &.incoming {
          color: #a5b4fc;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.1),
            rgba(99, 102, 241, 0.02)
          );
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.15),
              rgba(99, 102, 241, 0.05)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
          }
        }

        &.outgoing {
          color: #a5b4fc;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.1),
            rgba(99, 102, 241, 0.02)
          );
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.15),
              rgba(99, 102, 241, 0.05)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
          }
        }

        .inline-value {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
      }
    }

    // Horizontal divider between top and bottom rows
    .metric-horizontal-divider {
      width: 100%;
      height: 1px;
      background: #374151;
      margin: 10px 0 8px 0;
    }

    // Bottom row for error rate and p95 latency
    .metric-bottom-row {
      display: flex;
      align-items: center;
      gap: 8px;

      .metric-inline-item {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 4px;
        transition: all 0.2s ease;

        // Status-based styling
        &.status-healthy {
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.08),
            rgba(16, 185, 129, 0.02)
          );
          border: 1px solid rgba(16, 185, 129, 0.15);

          .q-icon {
            color: #10b981;
          }

          .metric-value {
            color: #10b981;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(16, 185, 129, 0.12),
              rgba(16, 185, 129, 0.04)
            );
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.15);
          }
        }

        &.status-warning {
          background: linear-gradient(
            135deg,
            rgba(251, 191, 36, 0.08),
            rgba(251, 191, 36, 0.02)
          );
          border: 1px solid rgba(251, 191, 36, 0.15);

          .q-icon {
            color: #fbbf24;
          }

          .metric-value {
            color: #fbbf24;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(251, 191, 36, 0.12),
              rgba(251, 191, 36, 0.04)
            );
            box-shadow: 0 0 6px rgba(251, 191, 36, 0.15);
          }
        }

        &.status-critical {
          background: linear-gradient(
            135deg,
            rgba(239, 68, 68, 0.08),
            rgba(239, 68, 68, 0.02)
          );
          border: 1px solid rgba(239, 68, 68, 0.15);

          .q-icon {
            color: #ef4444;
          }

          .metric-value {
            color: #ef4444;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(239, 68, 68, 0.12),
              rgba(239, 68, 68, 0.04)
            );
            box-shadow: 0 0 6px rgba(239, 68, 68, 0.15);
          }
        }

        &.status-unknown {
          background: linear-gradient(
            135deg,
            rgba(107, 114, 128, 0.08),
            rgba(107, 114, 128, 0.02)
          );
          border: 1px solid rgba(107, 114, 128, 0.15);

          .q-icon {
            color: #6b7280;
          }

          .metric-value {
            color: #9ca3af;
          }
        }

        .metric-label {
          font-size: 11px;
          font-weight: 600;
          color: #9ca3af;
          white-space: nowrap;
        }

        .metric-value {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
      }

      .metric-row-divider {
        width: 1px;
        height: 20px;
        background: #374151;
      }
    }
  }
}

.body--light .metrics-section {
  .metric-card-full {
    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
    border-color: #d1d5db;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    &:hover {
      box-shadow:
        0 6px 12px rgba(0, 0, 0, 0.08),
        0 0 0 1px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .metric-single-line {
      .metric-total {
        background: linear-gradient(
          135deg,
          rgba(99, 102, 241, 0.08),
          rgba(99, 102, 241, 0.03)
        );
        border-color: rgba(99, 102, 241, 0.2);

        .total-label {
          color: #6366f1;
        }

        .total-value {
          color: #4338ca;
        }

        .total-unit {
          color: #6366f1;
        }
      }

      .metric-divider {
        background: #d1d5db;
      }

      .metric-inline {
        &.incoming {
          color: #6366f1;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.08),
            rgba(99, 102, 241, 0.02)
          );
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.12),
              rgba(99, 102, 241, 0.04)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
          }
        }

        &.outgoing {
          color: #6366f1;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.08),
            rgba(99, 102, 241, 0.02)
          );
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.12),
              rgba(99, 102, 241, 0.04)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
          }
        }
      }
    }

    .metric-horizontal-divider {
      background: #d1d5db;
    }

    .metric-bottom-row {
      .metric-inline-item {
        &.status-healthy {
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.06),
            rgba(16, 185, 129, 0.01)
          );
          border-color: rgba(16, 185, 129, 0.2);

          .q-icon {
            color: #059669;
          }

          .metric-value {
            color: #059669;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(16, 185, 129, 0.1),
              rgba(16, 185, 129, 0.03)
            );
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.12);
          }
        }

        &.status-warning {
          background: linear-gradient(
            135deg,
            rgba(217, 119, 6, 0.06),
            rgba(217, 119, 6, 0.01)
          );
          border-color: rgba(217, 119, 6, 0.2);

          .q-icon {
            color: #d97706;
          }

          .metric-value {
            color: #d97706;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(217, 119, 6, 0.1),
              rgba(217, 119, 6, 0.03)
            );
            box-shadow: 0 0 6px rgba(217, 119, 6, 0.12);
          }
        }

        &.status-critical {
          background: linear-gradient(
            135deg,
            rgba(220, 38, 38, 0.06),
            rgba(220, 38, 38, 0.01)
          );
          border-color: rgba(220, 38, 38, 0.2);

          .q-icon {
            color: #dc2626;
          }

          .metric-value {
            color: #dc2626;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(220, 38, 38, 0.1),
              rgba(220, 38, 38, 0.03)
            );
            box-shadow: 0 0 6px rgba(220, 38, 38, 0.12);
          }
        }

        &.status-unknown {
          background: linear-gradient(
            135deg,
            rgba(107, 114, 128, 0.06),
            rgba(107, 114, 128, 0.01)
          );
          border-color: rgba(107, 114, 128, 0.2);

          .q-icon {
            color: #6b7280;
          }

          .metric-value {
            color: #6b7280;
          }
        }

        .metric-label {
          color: rgba(0, 0, 0, 0.6);
        }
      }

      .metric-row-divider {
        background: #d1d5db;
      }
    }
  }
}

// Empty/Loading/Error States
.empty-state,
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.875rem;

  .loading-text,
  .error-text {
    margin-top: 0.75rem;
    font-weight: 400;
  }
}

.body--light {
  .empty-state,
  .loading-state,
  .error-state {
    color: rgba(0, 0, 0, 0.5);
  }
}

.error-state {
  color: #f44336;
  font-weight: 500;
}

.body--light .error-state {
  color: #c62828;
}

.error-state {
  color: var(--q-negative);
}

.red-charts-section {
  :deep(.card-container) {
    box-shadow: none;

    :first-child {
      padding: 0 0.0625rem !important;
    }
  }
}

:deep(
  .metrics-correlation-dashboard .q-splitter--vertical > .q-splitter__separator
) {
  height: 100% !important;
}
</style>

<style lang="scss">
// Dark mode - consistent background
.body--dark {
  .service-graph-side-panel {
    background: #1a1f2e; // Consistent panel background
    color: #e4e7eb;
    border-left: 1px solid rgba(255, 255, 255, 0.08);

    .metric-card {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

// Light mode
.body--light {
  .service-graph-side-panel {
    background: #ffffff;
    color: #333333;
    border-left: 1px solid #e0e0e0;

    .metric-card {
      background: #f9f9f9;
    }
  }
}
</style>
