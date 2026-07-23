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
  <ODrawer
    bleed
    :open="visible"
    :width="60"
    :seamless="true"
    :portal-target="containerEl"
    :title="selectedNode?.name || selectedNode?.label || selectedNode?.id"
    data-test="service-graph-side-panel"
    @update:open="
      (v) => {
        if (!v) handleClose();
      }
    "
  >
    <template #header-right>
      <div class="flex items-center gap-2">
        <OTag type="serviceStatus" :value="serviceHealth.status" data-test="service-health-badge">{{
          serviceHealth.text
        }}</OTag>
        <ODropdown side="bottom" align="start">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              data-test="service-graph-node-panel-view-related-btn"
            >
              {{ t("traces.serviceGraphNodeSidePanel.viewRelated") }}
              <OIcon name="arrow-drop-down" size="sm" />
            </OButton>
          </template>
          <ODropdownItem
            @select="viewRelatedLogs"
            data-test="service-graph-node-panel-view-related-logs-btn"
            >{{ t("traces.serviceGraphNodeSidePanel.logs") }}</ODropdownItem
          >
          <ODropdownItem
            @select="viewRelatedTraces"
            data-test="service-graph-node-panel-view-related-traces-btn"
            >{{ t("traces.serviceGraphNodeSidePanel.traces") }}</ODropdownItem
          >
        </ODropdown>
      </div>
    </template>

    <!-- Content Scrollable Area -->
    <!-- No horizontal padding here: sections that need an inset (charts, chip row, tab labels)
           add px-page-edge themselves, so dividers and tables can bleed to the edges naturally. -->
    <div
      class="panel-content bg-surface-base flex-1 overflow-x-hidden overflow-y-auto py-2.5 dark:bg-[color-mix(in_srgb,var(--color-grey-950)_85%,var(--color-indigo-900))]"
    >
      <!-- RED Charts Section -->
      <div
        v-if="streamFilter !== 'all' && dashboardData"
        class="panel-section red-charts-section mb-0! flex flex-col p-0"
        data-test="service-graph-side-panel-red-charts"
      >
        <!-- DataZoom filter chips + View in Traces button -->
        <div
          v-if="filterChips.length"
          class="px-page-edge flex flex-wrap items-center gap-2 py-[0.3rem]"
          data-test="service-graph-side-panel-filter-chips"
        >
          <!-- Filter chip pills -->
          <div
            v-for="chip in filterChips"
            :key="chip.key"
            class="rounded-default border-border-default text-2xs text-text-body inline-flex items-center gap-1 border px-2 py-[0.325rem] leading-none"
            :data-test="`service-graph-filter-chip-${chip.key}`"
            :class="chip.type === 'duration' ? 'text-latency-p95' : 'text-status-error-text'"
          >
            <!-- Duration chip icon -->
            <OIcon
              v-if="chip.type === 'duration'"
              name="schedule"
              size="xs"
              class="text-latency-p95"
            />
            <!-- Error chip icon -->
            <OIcon
              v-else-if="chip.type === 'error'"
              name="warning"
              size="xs"
              class="text-status-error-text"
            />
            <span
              :class="chip.type === 'duration' ? 'text-latency-p95' : 'text-status-error-text'"
              >{{ chip.label }}</span
            >
            <OButton
              variant="ghost"
              size="icon-chip"
              class="ml-0.5"
              :data-test="`service-graph-filter-chip-remove-${chip.key}`"
              @click="removeLocalRangeFilter(chip.key)"
            >
              <OIcon name="close" size="xs" />
            </OButton>
          </div>

          <!-- Spacer -->
          <div class="flex-1" />

          <!-- View in Traces button -->
          <OButton
            variant="ghost-primary"
            size="sm"
            data-test="service-graph-side-panel-view-in-traces-btn"
            @click="viewInTraces"
          >
            <template #icon-left>
              <OIcon name="search" size="xs" />
            </template>
            {{ t("traces.serviceGraphNodeSidePanel.viewTraces") }}
          </OButton>
        </div>
        <div class="charts-wrapper min-h-[10.875rem] w-full py-0!">
          <div class="charts-container w-full">
            <RenderDashboardCharts
              ref="dashboardChartsRef"
              :viewOnly="true"
              :frame="false"
              :dashboardData="dashboardData || {}"
              :currentTimeObj="currentTimeObj"
              :allowAlertCreation="false"
              searchType="dashboards"
              @updated:dataZoom="onDataZoom"
            />
          </div>
        </div>
      </div>

      <!-- Full-bleed divider: panel has no horizontal padding, so w-full reaches both edges -->
      <OSeparator v-if="streamFilter !== 'all' && dashboardData" class="my-1.5!" />
      <!-- Tabs: Operations / Nodes / Pods -->
      <template v-if="streamFilter !== 'all'">
        <!-- Row spans full width so the bottom border bleeds; px-page-edge keeps the tab labels inset -->
        <div
          class="border-b-card-glass-border px-page-edge mb-0 flex items-end border-b"
          data-test="service-graph-node-panel-tabs-row"
        >
          <OTabs
            v-model="activeTab"
            dense
            align="left"
            class="w-[calc(100%-2rem)]! flex-1 font-bold"
            data-test="service-graph-node-panel-tabs"
          >
            <OTab
              name="operations"
              :label="t('traces.serviceGraphNodeSidePanel.operations')"
              class="capitalize"
              data-test="service-graph-node-panel-tab-operations"
            />
            <!-- Agent behavior (loops/failures) — only for agent nodes on
                   enterprise builds. See Agent Signals design §4b. -->
            <OTab
              v-if="showBehaviorTab"
              name="behavior"
              :label="t('aiObservability.behavior.node.tabLabel')"
              class="capitalize"
              data-test="service-graph-node-panel-tab-behavior"
            />
            <OTab
              v-for="cfg in activeResourceTabConfigs"
              :key="cfg.id"
              :name="cfg.id"
              :label="cfg.label"
              class="capitalize"
              :data-test="`service-graph-node-panel-tab-${cfg.id}`"
            />
            <OTab
              v-if="!isInferred"
              name="metrics"
              :label="t('traces.serviceGraphNodeSidePanel.metrics')"
              class="capitalize"
              data-test="service-graph-node-panel-tab-metrics"
            />
          </OTabs>

          <!-- Resource tabs dropdown — shows/hides individual OTEL resource tabs -->
          <!-- Hidden for inferred services (they have fixed tabs from the registry) -->
          <ODropdown
            v-if="!isInferred && availableResourceTabConfigs.length > 0"
            side="bottom"
            align="end"
          >
            <template #trigger>
              <OButton
                variant="ghost"
                size="icon-sm"
                data-test="service-graph-node-panel-workload-fields-btn"
              >
                <OIcon name="tune" size="sm" />
                <OTooltip :content="t('common.resources')" />
              </OButton>
            </template>
            <div class="min-w-48!" data-test="service-graph-node-panel-workload-fields-menu">
              <template v-for="env in detectedEnvironments" :key="env.key">
                <div
                  class="text-muted-foreground px-3 py-1.5! pb-0 text-xs tracking-wide uppercase"
                >
                  {{ env.label }}
                </div>
                <ODropdownItem
                  v-for="cfg in availableResourceTabConfigs.filter(
                    (c) => c.environment === env.key,
                  )"
                  :key="cfg.id"
                  :data-test="`service-graph-node-panel-workload-field-${cfg.id}`"
                  class="h-7.5! min-h-7.5! px-[0.325rem]!"
                  @select="
                    (e) => {
                      e.preventDefault();
                      toggleWorkloadField(cfg.id);
                    }
                  "
                >
                  <template #icon-left>
                    <span @click.stop>
                      <OCheckbox v-model="selectedWorkloadFields" :value="cfg.id" size="xs" />
                    </span>
                  </template>
                  <span class="text-xs">
                    {{ cfg.label }}
                    <OTooltip :content="cfg.groupField" />
                  </span>
                </ODropdownItem>
              </template>
            </div>
          </ODropdown>
        </div>
        <OTabPanels v-model="activeTab" animated>
          <!-- Operations Tab -->
          <OTabPanel
            name="operations"
            class="panel-section mb-0! p-0!"
            data-test="service-graph-side-panel-recent-operations"
          >
            <div
              v-if="recentOperations.length === 0 && !loadingOperations"
              class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
            >
              {{ t("traces.serviceGraphNodeSidePanel.noOperationsFound") }}
            </div>
            <div
              v-else-if="recentOperations.length > 0 || loadingOperations"
              class="svc-panel-table overflow-hidden"
              data-test="service-graph-side-panel-operations-table"
            >
              <TenstackTable
                :columns="operationsTableColumns"
                :rows="sortedOperationsTableRows"
                :sort-by="sortBy"
                :sort-order="sortOrderProp"
                :loading="loadingOperations"
                :default-columns="false"
                :enable-column-reorder="false"
                :enable-row-expand="false"
                :enable-text-highlight="false"
                :enable-status-bar="false"
                :enable-ai-context-button="false"
                :row-height="38"
                @sort-change="handleSortChange"
                @click:data-row="
                  (row: any) =>
                    navigateToTraces({
                      operationName: row.operation,
                      callerService: isInferred ? row.caller : undefined,
                    })
                "
              >
                <template #cell-errors="{ item }">
                  <span
                    :class="
                      item.errors > 0 ? 'font-semibold text-[var(--color-status-negative)]' : ''
                    "
                    >{{ item.errors }}</span
                  >
                </template>
                <template #cell-p99="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p99"
                    :max="rowMaxes(sortedOperationsTableRows, ['p99']).p99"
                    :label="formatOperationLatency(item.p99)"
                    variant="warning"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p95="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p95"
                    :max="rowMaxes(sortedOperationsTableRows, ['p95']).p95"
                    :label="formatOperationLatency(item.p95)"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p75="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p75"
                    :max="rowMaxes(sortedOperationsTableRows, ['p75']).p75"
                    :label="formatOperationLatency(item.p75)"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-actions="{ row, column, active }">
                  <OButton
                    v-if="active"
                    variant="ghost"
                    size="icon"
                    class="absolute! right-1! ml-1"
                    data-test="service-graph-side-panel-view-traces-btn"
                    @click.stop="
                      navigateToTraces({
                        operationName: row.operation,
                        callerService: isInferred ? row.caller : undefined,
                        errorsOnly: column.id === 'errors',
                        minDurationMicros: isDurationColumn(column.id) ? row[column.id] : undefined,
                      })
                    "
                  >
                    <OIcon name="search" size="xs" />
                    <OTooltip :content="t('traces.serviceGraphNodeSidePanel.viewInTraces')" />
                  </OButton>
                </template>
                <template #empty>
                  <div
                    class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
                  >
                    {{ t("traces.serviceGraphNodeSidePanel.noOperationsFound") }}
                  </div>
                </template>
              </TenstackTable>
            </div>
          </OTabPanel>

          <!-- Behavior Tab (agent nodes, enterprise) -->
          <OTabPanel
            v-if="showBehaviorTab"
            name="behavior"
            class="panel-section mb-0! p-0!"
            data-test="service-graph-side-panel-behavior"
          >
            <AgentNodeBehaviorTab
              :agent-name="behaviorAgentName"
              :source-stream="streamFilter"
              :start-time="timeRange.startTime"
              :end-time="timeRange.endTime"
            />
          </OTabPanel>

          <!-- Nodes Tab -->
          <!-- Dynamic OTEL resource tabs (Pods, Nodes, Hosts, Containers, Functions, ECS Tasks…) -->
          <OTabPanel
            v-for="cfg in activeResourceTabConfigs"
            :key="cfg.id"
            :name="cfg.id"
            class="panel-section mb-3 p-0!"
            :data-test="`service-graph-side-panel-${cfg.id}`"
          >
            <div
              v-if="!resourceTabData[cfg.id]?.length && !resourceTabLoading[cfg.id]"
              class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
            >
              {{
                t("traces.serviceGraphNodeSidePanel.noResourceDataFound", {
                  resource: cfg.label.toLowerCase(),
                })
              }}
            </div>
            <div
              v-else-if="resourceTabData[cfg.id]?.length > 0 || resourceTabLoading[cfg.id]"
              class="svc-panel-table overflow-hidden"
              :data-test="`service-graph-side-panel-${cfg.id}-table`"
            >
              <TenstackTable
                :columns="buildEntityTableColumns(cfg.colId, cfg.colLabel)"
                :rows="sortResourceRows(buildResourceTableRows(cfg))"
                :sort-by="sortBy"
                :sort-order="sortOrderProp"
                :loading="resourceTabLoading[cfg.id]"
                :default-columns="false"
                :enable-column-reorder="false"
                :enable-row-expand="false"
                :enable-text-highlight="false"
                :enable-status-bar="false"
                :enable-ai-context-button="false"
                :row-height="38"
                @sort-change="handleSortChange"
                @click:data-row="
                  (row: any) =>
                    navigateToTraces({
                      resourceFilter: cfg.fields
                        ? { fields: cfg.fields, value: row[cfg.colId] }
                        : { field: cfg.groupField, value: row[cfg.colId] },
                    })
                "
              >
                <template #cell-actions="{ row, column, active }">
                  <OButton
                    v-if="active"
                    variant="ghost"
                    size="icon"
                    class="bg-table-row-hover-bg! rounded-default absolute! right-1! ml-1 shadow-[-0.5rem_0_0.5rem_var(--color-table-row-hover-bg)]"
                    :data-test="`service-graph-side-panel-${cfg.id}-view-traces-btn`"
                    @click.stop="
                      navigateToTraces({
                        resourceFilter: cfg.fields
                          ? { fields: cfg.fields, value: row[cfg.colId] }
                          : { field: cfg.groupField, value: row[cfg.colId] },
                        errorsOnly: column.id === 'errors',
                        minDurationMicros: isDurationColumn(column.id) ? row[column.id] : undefined,
                      })
                    "
                  >
                    <OIcon name="search" size="xs" />
                    <OTooltip :content="t('traces.serviceGraphNodeSidePanel.viewInTraces')" />
                  </OButton>
                </template>
                <template #cell-errors="{ item }">
                  <span
                    :class="
                      item.errors > 0 ? 'font-semibold text-[var(--color-status-negative)]' : ''
                    "
                    >{{ item.errors }}</span
                  >
                </template>
                <template #cell-p99="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p99"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p99']).p99"
                    :label="formatOperationLatency(item.p99)"
                    variant="warning"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p95="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p95"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p95']).p95"
                    :label="formatOperationLatency(item.p95)"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p75="{ item }">
                  <ServiceCatalogBarCell
                    :value="item.p75"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p75']).p75"
                    :label="formatOperationLatency(item.p75)"
                    align="right"
                    inline
                  />
                </template>
                <template #empty>
                  <div
                    class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
                  >
                    {{
                      t("traces.serviceGraphNodeSidePanel.noResourceDataFound", {
                        resource: cfg.label.toLowerCase(),
                      })
                    }}
                  </div>
                </template>
              </TenstackTable>
            </div>
          </OTabPanel>

          <!-- Metrics Tab -->
          <OTabPanel
            v-if="!isInferred"
            name="metrics"
            class="panel-section mb-0! h-full! p-0!"
            data-test="service-graph-side-panel-metrics"
          >
            <!-- Loading state — shimmer skeletons standing in for the metric charts -->
            <div
              v-if="metricsCorrelationLoading"
              class="px-page-edge flex flex-col gap-3 py-4"
              data-test="service-graph-side-panel-metrics-loading"
            >
              <OSkeleton type="text" class="h-4 w-40!" />
              <OSkeleton type="rect" class="h-40 w-full!" />
              <OSkeleton type="rect" class="h-40 w-full!" />
            </div>

            <!-- Error state -->
            <div
              v-else-if="metricsCorrelationError"
              class="text-text-secondary flex flex-col items-center gap-3 py-6 text-center text-sm"
              data-test="service-graph-side-panel-metrics-error"
            >
              <span>{{ metricsCorrelationError }}</span>
              <OButton
                variant="ghost-primary"
                size="sm"
                data-test="service-graph-side-panel-metrics-retry-btn"
                @click="fetchMetricsCorrelation(true)"
                >{{ t("traces.serviceGraphNodeSidePanel.retry") }}</OButton
              >
            </div>

            <!-- Metrics dashboard -->
            <TelemetryCorrelationDashboard
              v-else-if="metricsCorrelationData"
              mode="embedded-tabs"
              external-active-tab="metrics"
              :service-name="metricsCorrelationData.serviceName"
              :matched-dimensions="metricsCorrelationData.matchedDimensions"
              :additional-dimensions="metricsCorrelationData.additionalDimensions"
              :matched-set-id="metricsCorrelationData.matchedSetId"
              :chip-dimensions="metricsCorrelationData.chipDimensions"
              :source-event="metricsCorrelationData.sourceEvent"
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

            <!-- Empty state — standard OEmptyState -->
            <OEmptyState
              v-else-if="metricsCorrelationLoaded"
              size="inline"
              icon="insights"
              :title="t('traces.serviceGraphNodeSidePanel.noMetricsAvailable')"
              hide-action
              class="py-16"
              data-test="service-graph-side-panel-metrics-empty"
            />
          </OTabPanel>
        </OTabPanels>
      </template>
    </div>
  </ODrawer>

  <!-- Telemetry Correlation Dialog (reuses the same component as "show related" on logs page) -->
  <TelemetryCorrelationDashboard
    v-if="showTelemetryDialog && correlationData"
    mode="dialog"
    :service-name="correlationData.serviceName"
    :matched-dimensions="correlationData.matchedDimensions"
    :additional-dimensions="correlationData.additionalDimensions"
    :matched-set-id="correlationData.matchedSetId"
    :chip-dimensions="correlationData.chipDimensions"
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { defineComponent, computed, ref, watch, defineAsyncComponent, type PropType } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
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
import { buildChipDimensionsFromFilters } from "@/services/service_streams";
import { buildWorkloadChipDimensions } from "@/composables/useMetricSubjectButtons";
import { normalizeSeverity } from "@/utils/sourceEventSeverity";
import DeployedCode from "@/components/icons/DeployedCode.vue";
import { useI18n } from "vue-i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ServiceCatalogBarCell from "./components/ServiceCatalogBarCell.vue";
import config from "@/aws-exports";

const TelemetryCorrelationDashboard = defineAsyncComponent(
  () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
);

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TenstackTable = defineAsyncComponent(() => import("@/components/TenstackTable.vue"));

// Agent-scoped behavior signals shown on agent nodes (enterprise). Async so the
// enterprise chunk only loads when an agent node's Behavior tab is opened.
const AgentNodeBehaviorTab = defineAsyncComponent(
  () => import("@/enterprise/views/AIObservability/AgentNodeBehaviorTab.vue"),
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
  /** Fallback field chain for inferred service tabs. When set, the GROUP BY
   *  expression is COALESCE(NULLIF(fields[0], ''), NULLIF(fields[1], ''), …).
   *  When absent, groupField is used directly (existing OTEL resource tabs). */
  fields?: string[];
}

// ---------------------------------------------------------------------------
// Inferred Service Tabs — one entry per dependency type, with field fallback
// chains that generate COALESCE expressions for both SELECT/GROUP BY and
// the downstream filter clause.
// ---------------------------------------------------------------------------
/**
 * Describes a resource tab rendered for an inferred service in the node detail panel.
 *
 * Each tab exposes a group of related span attributes (e.g. host info, database names)
 * organised as a table. Because OTel semantic conventions have evolved across
 * generations, a single conceptual attribute may map to several field names
 * (e.g. host → `server_address`, `net_peer_name`, `net_peer_ip`, `network_peer_address`).
 *
 * The `fields` array defines a **fallback chain** — the first field found in the
 * stream schema is used as both the GROUP BY column and the link target for View
 * Traces drill-down. If multiple fields exist, they are assembled into a
 * `COALESCE(NULLIF(f1, ''), NULLIF(f2, ''), ...)` expression so that rows with
 * different generations of the same attribute still aggregate together.
 */
export interface InferredServiceTab {
  /** Unique tab identifier, e.g. "hosts", "databases", "queries" */
  id: string;
  /** User-facing tab label, e.g. "Hosts", "Databases", "Queries" */
  label: string;
  /** Column header shown in the resource table, e.g. "Host", "Database", "DB Operation" */
  colLabel: string;
  /**
   * Fallback-ordered field names for the attribute column, evaluated against the
   * stream schema at runtime. The first field present in the schema wins as the
   * primary GROUP BY column; additional matching fields contribute to a COALESCE
   * expression for unified aggregation.
   */
  fields: string[];
}

/**
 * Registry of inferred-service resource tabs, keyed by `service_type`.
 *
 * Each entry defines the resource breakdowns available for that service type.
 * At runtime, tabs are filtered against the target stream's schema so that
 * only tabs whose `fields` intersect the schema are shown to the user.
 *
 * OTel semantic convention coverage:
 * | Service Type | Tabs          | Attribute Generations                                     |
 * |-------------|---------------|-----------------------------------------------------------|
 * | database    | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | Databases     | db_namespace, db_name (stabilised OTel DB)                |
 * |             | Queries       | db_operations (OTel DB operations)                        |
 * | queue       | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | Destinations  | messaging_destination_name, messaging_destination         |
 * | rpc         | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | RPC Services  | rpc_service, rpc_method                                   |
 * | http        | Hosts         | server_address, net_peer_*, network_peer_address          |
 *
 * When adding a new dependency type, add its entry here — the panel will
 * automatically render the appropriate resource tabs.
 */
const INFERRED_SERVICE_TABS: Record<string, InferredServiceTab[]> = {
  database: [
    {
      id: "hosts",
      label: "Hosts",
      colLabel: "Host",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "databases",
      label: "Databases",
      colLabel: "Database",
      fields: ["db_namespace", "db_name"],
    },
    {
      id: "queries",
      label: "Queries",
      colLabel: "DB Operation",
      fields: ["db_operations"],
    },
  ],
  queue: [
    {
      id: "hosts",
      label: "Hosts",
      colLabel: "Host",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "destinations",
      label: "Destinations",
      colLabel: "Destination",
      fields: ["messaging_destination_name", "messaging_destination"],
    },
  ],
  rpc: [
    {
      id: "hosts",
      label: "Hosts",
      colLabel: "Host",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "rpc_services",
      label: "RPC Services",
      colLabel: "RPC Service",
      fields: ["rpc_service"],
    },
  ],
  external: [
    {
      id: "hosts",
      label: "Hosts",
      colLabel: "Host",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "urls",
      label: "URLs",
      colLabel: "URL",
      fields: ["http_url", "url_full"],
    },
  ],
};

/** Build a COALESCE expression from a fallback field chain.
 *  e.g. ["server_address", "net_peer_name"]
 *    → "COALESCE(NULLIF(server_address, ''), NULLIF(net_peer_name, ''))" */
const buildCoalesceExpr = (fields: string[]): string =>
  fields.map((f) => `NULLIF(${f}, '')`).join(", ");

/** Build a WHERE clause fragment to exclude rows where all fallback fields are null.
 *  e.g. ["server_address", "net_peer_name"]
 *    → "(server_address IS NOT NULL OR net_peer_name IS NOT NULL)" */
const buildNullCheck = (fields: string[]): string =>
  fields.map((f) => `${f} IS NOT NULL`).join(" OR ");

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
    OTag,
    OSeparator,
    OSkeleton,
    OEmptyState,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OButton,
    ODropdown,
    ODropdownItem,
    ODrawer,
    TelemetryCorrelationDashboard,
    TenstackTable,
    RenderDashboardCharts,
    OTooltip,
    OCheckbox,
    OIcon,
    ServiceCatalogBarCell,
    AgentNodeBehaviorTab,
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
    containerEl: {
      type: Object as PropType<HTMLElement | null>,
      default: null,
    },
  },
  emits: ["close", "view-traces"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const { getStream } = useStreams();

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
      const name = props.selectedNode.name || props.selectedNode.label || props.selectedNode.id;
      return escapeSingleQuotes(name);
    };

    // Shared cache of stream schema field names — populated by resolveStreamSchema,
    // consumed by serviceNameField (model column resolution), resolveWorkloadFields
    // and inferredTabConfigs. Declared here (ahead of serviceNameField) so the
    // computed can read it without a temporal-dead-zone error at mount.
    const streamFieldSet = ref<Set<string>>(new Set());

    /**
     * Returns the SQL expression for the node's identity column, used in WHERE
     * clauses (`{expr} = 'name'`). A node falls into one of three families, keyed
     * by `service_type`:
     *
     * - **Instrumented service** (`service_type` absent) → `service_name`.
     * - **Inferred dependency** (`database`/`queue`/`rpc`/`external`) → discovered
     *   from span peer attributes, keyed by `infer_service_name`.
     * - **GenAI entity** (`agent`/`tool`/`model`) → derived from `gen_ai_*` columns.
     *   `agent`/`tool` have a single column. `model` may land in either
     *   `gen_ai_request_model` or `gen_ai_response_model` depending on the vendor
     *   (Langfuse/OpenInference populate only response), so it resolves to a
     *   COALESCE over whichever of the two the stream schema actually has —
     *   referencing a missing column is a hard "field not found" error.
     *
     * All call sites use this only as `WHERE {expr} = '...'`, so a COALESCE(...)
     * expression is valid everywhere it is interpolated.
     */
    const GENAI_NAME_FIELD: Record<string, string> = {
      agent: "gen_ai_agent_name",
      tool: "gen_ai_tool_name",
    };

    // Depth of the parent-chain climb used to attribute a tool/model span to its
    // OWNING agent. Must match the backend (processor.rs AGENT_INHERIT_DEPTH):
    // the agent name usually lives on an ANCESTOR span (real Google ADK nests
    // generate_content(agent)→chat→execute_tool), not on the tool/LLM span
    // itself, so the caller shown in this panel must climb the same way the graph
    // edge does — otherwise the panel says the app called the tool while the
    // graph correctly says the agent did.
    const AGENT_INHERIT_DEPTH = 4;

    // The nearest-ancestor-agent-or-service caller expression + chained ancestor
    // LEFT JOINs, aliased to child `c` (p1 on c, p2 on p1, …). Mirrors query-4.
    const genAiCallerClimb = (streamName: string) => {
      const parts = ["c.gen_ai_agent_name"];
      for (let k = 1; k <= AGENT_INHERIT_DEPTH; k++) parts.push(`p${k}.gen_ai_agent_name`);
      parts.push("c.service_name");
      const callerExpr = `COALESCE(${parts.join(", ")})`;
      const joins = Array.from({ length: AGENT_INHERIT_DEPTH }, (_, i) => {
        const k = i + 1;
        const prev = k === 1 ? "c" : `p${k - 1}`;
        return `LEFT JOIN "${streamName}" AS p${k} ON ${prev}.reference_parent_span_id = p${k}.span_id AND ${prev}.trace_id = p${k}.trace_id`;
      }).join(" ");
      return { callerExpr, joins };
    };

    /**
     * The node's identity column expression, with every column prefixed by
     * `alias` (e.g. `"c."` inside a self-join, `""` for a single-table query).
     * The prefix is applied AT CONSTRUCTION from the known column names — callers
     * never post-process the string, so there is no place for a column name to
     * be missed. See `serviceNameField` for the family rules.
     */
    const identityField = (alias = ""): string => {
      const st = props.selectedNode?.service_type;
      if (!st) return `${alias}service_name`;
      if (st === "model") {
        // Prefer request.model, fall back to response.model; only include a
        // column the schema has. If neither is known yet (schema unresolved),
        // default to request.model — the query re-runs reactively once the
        // schema fetch settles.
        const fs = streamFieldSet.value;
        const hasReq = fs.has("gen_ai_request_model");
        const hasResp = fs.has("gen_ai_response_model");
        if (hasReq && hasResp)
          return `COALESCE(${alias}gen_ai_request_model, ${alias}gen_ai_response_model)`;
        if (hasResp && !hasReq) return `${alias}gen_ai_response_model`;
        return `${alias}gen_ai_request_model`;
      }
      return `${alias}${GENAI_NAME_FIELD[st] ?? "infer_service_name"}`;
    };

    // Single-table identity expression (unaliased) — used everywhere the query
    // is a plain `FROM "{stream}"` with no join.
    const serviceNameField = computed(() => identityField());

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

      const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));
      const serviceFilter = `${serviceNameField.value} = '${serviceName}'`;

      convertedDashboard.tabs[0].panels.forEach((panel: any, index: number) => {
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
        (panelTitle === "Duration" || panelTitle === "Rate" || panelTitle === "Errors")
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
            label: t("traces.serviceGraphNodeSidePanel.durationRange", {
              start: formatTimeWithSuffix(f.start),
              end: formatTimeWithSuffix(f.end),
            }),
          });
        } else if (f.panelTitle === "Errors") {
          chips.push({
            key,
            type: "error",
            label: t("traces.serviceGraphNodeSidePanel.statusError"),
          });
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
          maxDurationMicros = f.end ?? undefined;
        }
      });

      navigateToTraces({ errorsOnly, minDurationMicros, maxDurationMicros });
    };

    // Metric group definitions — controls which category tabs and default selections
    // appear in the metrics dashboard. Uses K8S_METRIC_GROUP_DEFINITIONS for OTel
    // semantic defaults; overrides the pods icon with the project-specific component.
    const metricGroupResources = ref<MetricGroupDefinition[]>(
      K8S_METRIC_GROUP_DEFINITIONS.map((g) => (g.id === "pods" ? { ...g, icon: DeployedCode } : g)),
    );

    // Semantic groups — fetched once for chip deduplication
    const orgSemanticGroups = ref<FieldAlias[]>([]);
    const loadOrgSemanticGroups = async () => {
      if (orgSemanticGroups.value.length > 0) return;
      try {
        const org = store.state.selectedOrganization.identifier;
        const resp = await getSemanticGroups(org);
        orgSemanticGroups.value = resp.data || [];
      } catch {
        // non-fatal: chips won't be deduplicated but will still show
      }
    };

    // Metrics Correlation State
    const showTelemetryDialog = ref(false);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      matchedSetId?: string;
      chipDimensions?: Record<string, string>;
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
      matchedSetId?: string;
      chipDimensions?: Record<string, string>;
      sourceEvent?: {
        timestamp?: number | string;
        severity?: string;
        message?: string;
      };
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
        await loadOrgSemanticGroups();
        const serviceName =
          props.selectedNode.name || props.selectedNode.label || props.selectedNode.id;

        // Send service name directly to _correlate
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const data = correlateResponse.data;
        if (!data) {
          correlationError.value = t("traces.serviceGraphNodeSidePanel.noCorrelatedStreams");
          correlationData.value = null;
          return;
        }

        correlationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          matchedSetId: data.matched_set_id,
          chipDimensions: buildChipDimensionsFromFilters(data, orgSemanticGroups.value),
          // No source row available here — subject chips will be added by metricsCorrelationData path
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          correlationError.value = t("traces.serviceGraphNodeSidePanel.enterpriseFeature");
        } else {
          correlationError.value =
            err.message || t("traces.serviceGraphNodeSidePanel.failedToLoadStreams");
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
              sql: `SELECT * FROM "${streamName}" WHERE ${serviceNameField.value} = '${serviceName}' ORDER BY _timestamp DESC`,
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

        const spanSeverity = (() => {
          if (!latestSpan) return undefined;
          const ss =
            typeof latestSpan.span_status === "string"
              ? latestSpan.span_status.toUpperCase()
              : null;
          if (ss === "ERROR") return "ERROR";
          return normalizeSeverity(latestSpan.severity_text ?? latestSpan.severity) ?? undefined;
        })();

        metricsCorrelationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          matchedSetId: data.matched_set_id,
          chipDimensions: {
            ...buildChipDimensionsFromFilters(data, orgSemanticGroups.value),
            ...buildWorkloadChipDimensions(
              data.matched_set_id,
              orgSemanticGroups.value,
              latestSpan ?? undefined,
            ),
          },
          sourceEvent: latestSpan
            ? {
                timestamp: latestSpan.start_time ?? latestSpan._timestamp,
                severity: spanSeverity,
                message: latestSpan.operation_name,
              }
            : undefined,
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          metricsCorrelationError.value = t("traces.serviceGraphNodeSidePanel.enterpriseFeature");
        } else {
          metricsCorrelationError.value =
            err.message || t("traces.serviceGraphNodeSidePanel.failedToLoadMetrics");
        }
        metricsCorrelationData.value = null;
      } finally {
        metricsCorrelationLoading.value = false;
        metricsCorrelationLoaded.value = true;
      }
    };

    // Reload RED charts when node, time range, stream, visibility — or the
    // resolved identity column — changes. `serviceNameField` is in the deps
    // because for a model node it depends on the stream schema (request vs
    // response model column); the schema fetch settles AFTER the first render,
    // so without re-running here the charts fire once with the wrong/absent
    // column and error with "field not found".
    watch(
      () =>
        [
          props.selectedNode?.id,
          props.timeRange,
          props.streamFilter,
          props.visible,
          serviceNameField.value,
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

    // Dynamic resource tabs state
    const resourceTabData = ref<Record<string, ResourceRow[]>>({});
    const resourceTabLoading = ref<Record<string, boolean>>({});
    // Resource groups from getDimensionAnalytics that match the current stream schema
    // (after platform-priority filtering — see resolveWorkloadFields)
    const availableResourceTabConfigs = ref<ResourceTabConfig[]>([]);
    // IDs of alias entries the user has checked in the dropdown
    const selectedWorkloadFields = ref<string[]>([]);

    const schemaResolved = ref(false);

    /** Fetch the trace stream schema and populate streamFieldSet.
     *  Idempotent — skips if already resolved for the current stream.
     *  Uses useStreams().getStream() which caches the schema in the Vuex store
     *  so other components benefit from the cached data. */
    const resolveStreamSchema = async () => {
      if (
        !props.visible ||
        props.streamFilter === "all" ||
        !props.streamFilter ||
        schemaResolved.value
      )
        return;

      try {
        const stream = await getStream(props.streamFilter, "traces", true);
        const schemaFields: { name: string; type: string }[] = stream?.schema || [];
        streamFieldSet.value = new Set(schemaFields.map((f) => f.name));
        schemaResolved.value = true;
      } catch (err) {
        console.error("[ServiceGraphNodeSidePanel] Failed to resolve stream schema:", err);
        streamFieldSet.value = new Set();
      }
    };

    // Inferred service tabs — built from INFERRED_SERVICE_TABS registry when
    // the selected node has a service_type (database/queue/rpc/external).
    // Each tab's fallback field chain is filtered to only include fields that
    // actually exist in the stream schema. Tabs with zero surviving fields are
    // dropped entirely.
    const inferredTabConfigs = computed<ResourceTabConfig[]>(() => {
      const st = props.selectedNode?.service_type as string | undefined;
      if (!st) return [];
      const tabs = INFERRED_SERVICE_TABS[st];
      if (!tabs?.length) return [];
      const fieldSet = streamFieldSet.value;
      // If schema hasn't resolved yet, return empty — tabs appear once the
      // schema fetch completes (reactive via streamFieldSet).
      if (!schemaResolved.value) return [];
      const resolved: ResourceTabConfig[] = [];
      for (const t of tabs) {
        const present = t.fields.filter((f) => fieldSet.has(f));
        if (present.length === 0) continue;
        resolved.push({
          id: t.id,
          label: t.label,
          groupField: `COALESCE(${buildCoalesceExpr(present)})`,
          colLabel: t.colLabel,
          colId: t.id,
          environment: "",
          isDefault: true,
          fields: present,
        });
      }
      return resolved;
    });

    /** Whether the selected node is an inferred service (uninstrumented dependency). */
    const isInferred = computed(() => !!props.selectedNode?.service_type);

    // The clicked agent's display name (same value the graph node is keyed by
    // and that AgentSignalDetailPanel filters on — see design §4b id-vs-name).
    const behaviorAgentName = computed<string>(
      () => props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id || "",
    );

    // The Behavior tab (loop/failure signals) shows only for agent nodes on
    // enterprise builds, and only when a concrete stream is selected (the
    // signals stream is per-source-stream). The AgentNodeBehaviorTab itself
    // degrades gracefully to a "feature off" hint if the rollup is disabled.
    const showBehaviorTab = computed(
      () =>
        config.isEnterprise === "true" &&
        props.selectedNode?.service_type === "agent" &&
        props.streamFilter !== "all" &&
        !!props.streamFilter,
    );

    // Tabs actually shown. For inferred services use the registry tabs;
    // for instrumented services use the user-selected OTEL resource tabs.
    const activeResourceTabConfigs = computed(() =>
      isInferred.value
        ? inferredTabConfigs.value
        : availableResourceTabConfigs.value.filter((c) =>
            selectedWorkloadFields.value.includes(c.id),
          ),
    );
    // Deduped list of environments detected from visible resource groups
    const detectedEnvironments = computed<{ key: string; label: string }[]>(() => {
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
    });

    // Workload Field Discovery State
    const resolvedWorkloadFields = ref<{ field: string; alias: FieldAlias }[]>([]);

    // Toggle a workload field id in the selected set — invoked when the user
    // selects the surrounding ODropdownItem (in addition to clicking the
    // OCheckbox directly).
    const toggleWorkloadField = (id: string) => {
      const current = selectedWorkloadFields.value;
      selectedWorkloadFields.value = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
    };

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
      const totalRequests = props.selectedNode.value || props.selectedNode.requests || 0;

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
        p50Latency = Math.max(...incomingEdges.map((edge: any) => edge.p50_latency_ns || 0));
        p95Latency = Math.max(...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0));
        p99Latency = Math.max(...incomingEdges.map((edge: any) => edge.p99_latency_ns || 0));
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
        p50Latency: incomingEdges.length > 0 ? formatLatency(p50Latency) : "N/A",
        p95Latency: incomingEdges.length > 0 ? formatLatency(p95Latency) : "N/A",
        p99Latency: incomingEdges.length > 0 ? formatLatency(p99Latency) : "N/A",
      };
    });

    // Computed: Service Health
    const serviceHealth = computed(() => {
      if (!props.selectedNode) {
        return {
          status: "unknown",
          text: t("traces.serviceGraphNodeSidePanel.unknown"),
        };
      }

      // Use node's own error_rate directly
      const errorRate = props.selectedNode.error_rate || 0;

      if (errorRate > 10) {
        return {
          status: "critical",
          text: t("traces.serviceGraphNodeSidePanel.critical"),
        };
      } else if (errorRate > 5) {
        return {
          status: "degraded",
          text: t("traces.serviceGraphNodeSidePanel.degraded"),
        };
      } else {
        return {
          status: "healthy",
          text: t("traces.serviceGraphNodeSidePanel.healthy"),
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
    const sortOrder = ref<"asc" | "desc" | "">("");

    // The table's sort-order prop only accepts "asc" | "desc" | undefined; our
    // internal "" cleared-sentinel maps to undefined for the binding.
    const sortOrderProp = computed<"asc" | "desc" | undefined>(() =>
      sortOrder.value === "" ? undefined : sortOrder.value,
    );

    // 3-state sort cycle to match other O2 tables (OTable): asc → desc → cleared.
    // TenstackTable itself only toggles asc/desc, so we drive the cycle from our
    // own state and ignore its computed order — clearing restores the default order.
    function handleSortChange(field: string) {
      if (sortBy.value !== field) {
        sortBy.value = field;
        sortOrder.value = "asc";
      } else if (sortOrder.value === "asc") {
        sortOrder.value = "desc";
      } else {
        sortBy.value = "";
        sortOrder.value = "";
      }
    }

    const compareRows = (a: any, b: any, field: string): number => {
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
    const buildEntityTableColumns = (entityId: string, entityHeader: string) => [
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
        header: t("traces.serviceGraphNodeSidePanel.requests"),
        size: 130,
        enableSorting: true,
        meta: { sortable: true, align: "right" },
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: t("traces.serviceGraphNodeSidePanel.errors"),
        size: 110,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: "P99",
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: "P95",
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: "P75",
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
    ];

    // Computed: Operations table columns
    const operationsTableColumns = computed(() => {
      const cols = buildEntityTableColumns(
        "operation",
        t("traces.serviceGraphNodeSidePanel.operation"),
      );
      if (isInferred.value) {
        cols.unshift({
          id: "caller",
          accessorKey: "caller",
          header: t("traces.serviceGraphNodeSidePanel.caller"),
          size: 180,
          enableSorting: true,
          meta: { slot: false, sortable: true },
        });
      }
      return cols;
    });

    // Computed: Operations table rows
    const operationsTableRows = computed(() =>
      recentOperations.value.map((op) => ({
        operation: op.name,
        caller: op.callerService || "",
        requests: op.requestCount,
        errors: op.errorCount,
        p99: op.p99Latency,
        p95: op.p95Latency,
        p75: op.p75Latency,
        p50: op.p50Latency,
      })),
    );

    // Fetch aggregated operations (grouped by operation_name with percentiles).
    // For inferred services we also GROUP BY service_name so the caller is visible.
    const fetchAggregatedOperations = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all") return;

      loadingOperations.value = true;
      recentOperations.value = [];

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const st = props.selectedNode?.service_type;
        // A tool/model node's caller is its OWNING AGENT, which usually sits on an
        // ancestor span — resolve it with the same parent-chain climb the graph
        // edge uses (else the panel would show the host app as the caller, in
        // conflict with the graph). Genuinely-inferred deps (database/queue/…)
        // keep the raw service_name as caller. Instrumented services show none.
        const isGenAiChild = st === "tool" || st === "model";
        const isInf = isInferred.value;

        const metrics = `count(*) as request_count, count(*) FILTER (WHERE ${isGenAiChild ? "c." : ""}span_status = 'ERROR') as error_count, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.50) as p50_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.75) as p75_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.95) as p95_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.99) as p99_latency`;

        let sql: string;
        if (isGenAiChild) {
          const { callerExpr, joins } = genAiCallerClimb(streamName);
          // The identity field, built already aliased to the child table `c`
          // (no post-processing of the expression string).
          const childField = identityField("c.");
          sql = `SELECT ${callerExpr} as caller_service, c.operation_name, ${metrics} FROM "${streamName}" AS c ${joins} WHERE ${childField} = '${serviceName}' GROUP BY ${callerExpr}, c.operation_name`;
        } else {
          const selectCols = isInf
            ? "service_name as caller_service, operation_name"
            : "operation_name";
          const groupCols = isInf ? "service_name, operation_name" : "operation_name";
          sql = `SELECT ${selectCols}, ${metrics} FROM "${streamName}" WHERE ${serviceNameField.value} = '${serviceName}' GROUP BY ${groupCols}`;
        }

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
            callerService: op.caller_service || undefined,
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
      if (!props.selectedNode || !props.visible || props.streamFilter === "all") return;

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
                sql: `SELECT operation_name, duration, start_time FROM "${streamName}" WHERE ${serviceNameField.value} = '${serviceName}' AND span_status = 'ERROR' ORDER BY start_time DESC`,
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
                sql: `SELECT operation_name, duration FROM "${streamName}" WHERE ${serviceNameField.value} = '${serviceName}' ORDER BY duration DESC`,
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
            timestampDisplay: s.start_time ? formatSpanTimestamp(s.start_time) : "",
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
        // Re-fetch once the schema resolves the model column (request vs
        // response) — otherwise a model node's operations query fires with the
        // wrong column and returns "No operations found".
        serviceNameField.value,
      ],
      () => {
        if (props.visible && props.selectedNode && props.streamFilter !== "all") {
          fetchOperations();
        }
      },
      { immediate: true },
    );

    // Generic fetch for any OTEL resource tab config (supports both instrumented
    // and inferred service tabs; inferred tabs use a COALESCE field chain).
    const fetchResourceData = async (config: ResourceTabConfig) => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all") return;

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

        // For inferred tabs with fallback fields, the null-check must span all
        // fields in the chain; for instrumented tabs a simple IS NOT NULL works.
        const nullClause = config.fields
          ? `(${buildNullCheck(config.fields)})`
          : `${groupField} IS NOT NULL`;

        const sql = `SELECT ${groupField} as ${alias}, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE ${serviceNameField.value} = '${serviceName}' AND ${nullClause} GROUP BY ${alias} ORDER BY request_count DESC`;

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
      if (!props.visible || props.streamFilter === "all" || !props.streamFilter) return;

      // Ensure the stream schema is resolved (shared with inferred tab resolution)
      await resolveStreamSchema();
      if (streamFieldSet.value.size === 0) return;

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

        // Filter for service_ fields, intersect with semantic groups, deduplicate by alias.id
        const seen = new Set<string>();
        const matched: { field: string; alias: FieldAlias }[] = [];
        const schemaFields = [...streamFieldSet.value]; // already resolved above
        for (const fieldName of schemaFields) {
          if (!fieldName.startsWith("service_")) continue;
          const alias = fieldToAliasMap.get(fieldName);
          if (!alias || seen.has(alias.id)) continue;
          seen.add(alias.id);
          matched.push({ field: fieldName, alias });
        }
        resolvedWorkloadFields.value = matched;

        // Fetch org-wide dimension analytics to discover all available resource groups
        const analyticsResp = await getDimensionAnalytics(org);
        const allGroups: FoundGroup[] = analyticsResp.data?.available_groups ?? [];

        // Filter to groups whose traces (or spans) alias exists in this stream's schema
        const schemaMatchedGroups = allGroups.filter((g) => {
          const field = g.aliases["traces"] ?? g.aliases["spans"];
          return field && streamFieldSet.value.has(field);
        });

        // Apply ENV_SEGMENTS priority
        // If any primary-platform groups (k8s / aws / azure / gcp) are present
        // in this stream, show ONLY those. Otherwise fall back to generic groups.
        const platformGroups = schemaMatchedGroups.filter((g) => groupEnvKey(g.group_id) !== null);
        const visibleGroups = platformGroups.length > 0 ? platformGroups : schemaMatchedGroups;

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
        console.error("[ServiceGraphNodeSidePanel] Failed to resolve workload fields:", err);
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
      () => [props.visible, props.selectedNode?.id, props.streamFilter, activeTab.value],
      () => {
        if (!props.visible || !props.selectedNode || props.streamFilter === "all") return;
        const config = activeResourceTabConfigs.value.find((c) => c.id === activeTab.value);
        if (config && !resourceTabData.value[config.id]?.length) {
          fetchResourceData(config);
        }
        if (activeTab.value === "metrics") fetchMetricsCorrelation();
      },
    );

    // Trigger workload field discovery when the panel becomes visible with a valid stream.
    // For inferred services, resolve the stream schema so inferredTabConfigs can filter
    // fallback field chains to only those present in the schema.
    watch(
      () => [props.visible, props.selectedNode?.id, props.streamFilter],
      ([visible]) => {
        if (visible && props.selectedNode && props.streamFilter !== "all") {
          if (isInferred.value) {
            resolveStreamSchema();
          } else {
            resolveWorkloadFields();
          }
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
        schemaResolved.value = false;
        streamFieldSet.value = new Set();
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
      /** When the service is inferred, this is the caller's service_name. */
      callerService?: string;
      /** @deprecated use resourceFilter instead */
      nodeName?: string;
      /** @deprecated use resourceFilter instead */
      podName?: string;
      /** Generic OTEL resource filter. Use `field` for a single field,
       *  or `fields` for a fallback chain (OR clause in the filter). */
      resourceFilter?: { field?: string; fields?: string[]; value: string };
      errorsOnly?: boolean;
      minDurationMicros?: number;
      maxDurationMicros?: number;
      mode?: "spans" | "traces";
    }) => {
      emit("view-traces", {
        stream: props.streamFilter,
        serviceName:
          props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id,
        serviceType: props.selectedNode?.service_type,
        operationName: params.operationName,
        callerService: params.callerService,
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
      let filterQuery = `${serviceNameField.value}='${serviceName}'`;

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
          toast({
            variant: "warning",
            message: t("traces.noLogsAvailableForService"),
          });
          return;
        }
      } catch {
        toast({
          variant: "warning",
          message: t("traces.noLogsAvailableForService"),
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
        toast({
          variant: "warning",
          message: correlationError.value,
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

    const isDurationColumn = (column: string) => {
      return ["p99", "p95", "p75"].includes(column);
    };

    function rowMaxes(rows: any[], fields: string[]): Record<string, number> {
      const result: Record<string, number> = {};
      for (const f of fields) {
        result[f] = rows.reduce((m, r) => Math.max(m, r[f] ?? 0), 0) || 1;
      }
      return result;
    }

    return {
      t,
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      isInferred,
      showBehaviorTab,
      behaviorAgentName,
      serviceNameField,
      streamFieldSet,
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
      toggleWorkloadField,
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
      sortOrderProp,
      handleSortChange,
      sortResourceRows,
      formatOperationLatency,
      isDurationColumn,
      rowMaxes,
    };
  },
});
</script>

<style scoped>
/* keep(scrollbar): ::-webkit-scrollbar pseudo-elements have no utility form.
   This panel has both a light treatment (default values) and a dark
   indigo-tinted "glass" treatment (under `.dark &`). Keep the light rules — do
   not make it always-dark. */
.panel-content::-webkit-scrollbar {
  width: 0.5rem;
}

.panel-content::-webkit-scrollbar-track {
  background: var(--color-surface-panel);
}

.panel-content::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 0.25rem;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: var(--color-grey-300);
}

.dark .panel-content::-webkit-scrollbar-track {
  background: color-mix(in srgb, var(--color-grey-900) 70%, var(--color-indigo-900));
}

.dark .panel-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-grey-800) 80%, var(--color-indigo-900));
}

.dark .panel-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-grey-700) 80%, var(--color-indigo-900));
}

.panel-section:last-child {
  margin-bottom: 0;
}

/* The panel itself scrolls, so these short summary tables should render at their
   natural height without their own scrollbars. Let the inner scroll container
   grow to content and hide its scrollbars. */
.svc-panel-table :deep(.o2-scroll-container) {
  overflow: hidden;
  height: auto;
  max-height: none;
}

/* Align the first column's content with the tab labels above (page-edge + the
   tab's own 0.5rem px-2) while the header band and rows still bleed to the edge. */
.svc-panel-table :deep(tr > th:first-child),
.svc-panel-table :deep(tr > td:first-child) {
  padding-left: calc(var(--spacing-page-edge) + 0.5rem);
}

/* Numeric columns reserve a fixed right-hand slot: the value sits just left of
   it, and the per-cell "view in traces" button lives in that slot on hover — so
   there's no overlap and no shift. Headers get the same reserve so their text /
   sort-icon stay aligned with the values. */
.svc-panel-table :deep(td[class~="text-right!"]) > div,
.svc-panel-table :deep(th[class~="text-right!"]) {
  padding-right: 1.75rem;
}
</style>
