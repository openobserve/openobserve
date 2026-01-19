<!-- Copyright 2025 OpenObserve Inc.

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
  <!-- Dialog Mode -->
  <q-dialog
    v-if="props.mode === 'dialog'"
    v-model="isOpen"
    position="right"
    full-height
    maximized
    transition-show="slide-left"
    transition-hide="slide-right"
    @hide="onClose"
  >
    <q-card class="correlation-dashboard-card">
      <!-- Header -->
      <q-card-section v-if="!isEmbeddedTabs" class="correlation-header tw:flex tw:items-center tw:justify-between tw:py-3 tw:px-4 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <div class="tw:flex tw:items-center tw:gap-3">
          <q-icon name="link" size="md" color="primary" />
          <div class="tw:flex tw:flex-col tw:gap-0">
            <span class="tw:text-lg tw:font-semibold">
              Correlated Streams - {{ serviceName }}
            </span>
            <span class="tw:text-xs tw:opacity-70">
              {{ formatTimeRange(timeRange) }}
            </span>
          </div>
        </div>

        <div class="tw:flex tw:items-center tw:gap-3">
          <q-btn
            flat
            round
            dense
            icon="close"
            @click="isOpen = false"
            data-test="correlation-dashboard-close"
          />
        </div>
      </q-card-section>

      <!-- Dimensions Display - Stable (matched) and Unstable (additional) -->
      <div class="tw:py-2 tw:px-4 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <div class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap">
          <span class="tw:text-xs tw:font-semibold tw:opacity-70">
            {{ t('correlation.filters') }}:
          </span>
          <div
            v-for="(value, key) in pendingDimensions"
            :key="key"
            class="tw:flex tw:items-center tw:gap-2"
          >
            <span
              class="tw:text-xs tw:font-semibold"
              :class="unstableDimensionKeys.has(key) ? 'tw:opacity-60' : 'tw:opacity-100'"
            >
              {{ key }}:
            </span>
            <q-select
              v-model="pendingDimensions[key]"
              :options="getDimensionOptions(key, value)"
              dense
              outlined
              emit-value
              map-options
              @update:model-value="onPendingDimensionChange"
              class="dimension-dropdown"
              borderless
              style="min-width: 120px"
            />
            <q-tooltip v-if="unstableDimensionKeys.has(key)">
              Unstable dimension - changes on pod restart. Default: All values.
            </q-tooltip>
          </div>
          <!-- Apply Button -->
          <q-btn
            flat
            dense
            no-caps
            text-color="light-text"
            :label="t('common.apply')"
            :disable="!hasPendingChanges"
            @click="applyDimensionChanges"
            class="o2-secondary-button tw:ml-2"
            data-test="apply-dimension-filters"
          />
        </div>
      </div>

      <!-- Tabs (only in dialog mode, hidden in embedded-tabs mode) -->
      <q-tabs
        v-if="!isEmbeddedTabs"
        v-model="activeTab"
        dense
        class="tw:px-4 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab name="logs" :label="t('common.logs')" />
        <q-tab name="metrics" :label="t('search.metrics')" />
        <q-tab name="traces" :label="t('menu.traces')" />
      </q-tabs>

      <!-- Tab Panels -->
      <q-tab-panels
        v-model="activeTab"
        animated
        class="correlation-content tw:flex-1 tw:overflow-auto"
      >
        <!-- Logs Tab Panel -->
        <q-tab-panel name="logs" class="tw:p-0">
          <!-- Refresh Button -->
          <div v-if="logsDashboardData" class="tw:p-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:justify-end">
            <q-btn
              flat
              dense
              color="primary"
              icon="refresh"
              :label="t('common.refresh')"
              @click="loadDashboard"
              :loading="loading"
              size="sm"
            />
          </div>

          <!-- Loading State -->
          <div
            v-if="loading"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-spinner-hourglass color="primary" size="3.75rem" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.loading') }}</div>
            <div class="tw:text-xs tw:text-gray-500 tw:mt-2">{{ t('correlation.loadingLogs') }}</div>
          </div>

          <!-- Logs Dashboard -->
          <RenderDashboardCharts
            v-else-if="logsDashboardData"
            :key="logsDashboardRenderKey"
            :dashboardData="logsDashboardData"
            :currentTimeObj="currentTimeObj"
            :viewOnly="true"
            :allowAlertCreation="false"
            searchType="dashboards"
          />

          <!-- No Logs State -->
          <div
            v-else
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="article" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.noLogsFound') }}</div>
            <div class="tw:text-sm tw:text-gray-500 tw:mt-2">
              {{ t('correlation.service', { service: serviceName }) }}
            </div>
          </div>
        </q-tab-panel>

        <!-- Metrics Tab Panel -->
        <q-tab-panel name="metrics" class="tw:p-0">
          <!-- Metrics Selector and Refresh Buttons -->
          <div class="tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:items-center tw:justify-end tw:gap-2">
            <q-btn
              v-if="dashboardData"
              flat
              dense
              color="primary"
              icon="refresh"
              :label="t('common.refresh')"
              @click="loadDashboard"
              :loading="loading"
              size="sm"
            />
            <q-btn
              outline
              dense
              no-caps
              color="primary"
              icon="show_chart"
              :label="t('correlation.metricsSelector', { selected: selectedMetricStreams.length, total: uniqueMetricStreams.length })"
              @click="showMetricSelector = true"
              data-test="metric-selector-button"
            >
              <q-tooltip>{{ t('correlation.metricsTooltip') }}</q-tooltip>
            </q-btn>
          </div>

          <!-- Loading State -->
          <div
            v-if="loading"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-spinner-hourglass color="primary" size="3.75rem" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.loading') }}</div>
            <div class="tw:text-xs tw:text-gray-500 tw:mt-2">
              {{ t('correlation.loadingMetrics', { count: selectedMetricStreams.length }) }}
            </div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="error"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="error_outline" size="3.75rem" color="negative" class="tw:mb-4" />
            <div class="tw:text-base tw:mb-2">{{ t('correlation.failedToLoad') }}</div>
            <div class="tw:text-sm tw:text-gray-500">{{ error }}</div>
            <q-btn
              outline
              color="primary"
              :label="t('correlation.retryButton')"
              class="tw:mt-4"
              @click="loadDashboard"
            />
          </div>

          <!-- Dashboard -->
          <RenderDashboardCharts
            v-else-if="dashboardData"
            ref="dashboardChartsRef"
            :key="dashboardRenderKey"
            :dashboardData="dashboardData"
            :currentTimeObj="currentTimeObj"
            :viewOnly="true"
            :allowAlertCreation="false"
            searchType="dashboards"
          />

          <!-- No Metrics State -->
          <div
            v-else
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="info_outline" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.noMetrics') }}</div>
          </div>
        </q-tab-panel>

        <!-- Traces Tab Panel -->
        <q-tab-panel name="traces" class="tw:p-0">
          <!-- Refresh Button -->
          <div v-if="traceCorrelationMode !== null" class="tw:p-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:justify-end">
            <q-btn
              flat
              dense
              color="primary"
              icon="refresh"
              :label="t('common.refresh')"
              @click="loadCorrelatedTraces"
              :loading="tracesLoading"
              size="sm"
            />
          </div>

          <!-- Loading State -->
          <div
            v-if="tracesLoading"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-spinner-hourglass color="primary" size="3.75rem" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.loadingTraces') }}</div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="tracesError"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="error_outline" size="3.75rem" color="negative" class="tw:mb-4" />
            <div class="tw:text-base tw:mb-2">{{ t('correlation.tracesError') }}</div>
            <div class="tw:text-sm tw:text-gray-500">{{ tracesError }}</div>
            <q-btn
              outline
              color="primary"
              :label="t('correlation.retryButton')"
              class="tw:mt-4"
              @click="loadCorrelatedTraces"
            />
          </div>

          <!-- Direct Trace Correlation - Full Span List -->
          <div v-else-if="traceCorrelationMode === 'direct' && traceSpanList.length > 0" class="tw:h-full">
            <!-- Trace Header -->
            <div class="tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] trace-header-bg">
              <div class="tw:flex tw:items-center tw:gap-3">
                <q-icon name="link" color="positive" size="1.25rem" />
                <div class="tw:flex tw:flex-col">
                  <span class="tw:text-sm tw:font-semibold">{{ t('correlation.directTraceMatch') }}</span>
                  <a
                    href="#"
                    class="tw:text-xs tw:text-blue-500 tw:font-mono tw:underline hover:tw:text-blue-700 tw:cursor-pointer"
                    @click.prevent="openTraceInNewWindow"
                    :title="t('correlation.openTraceInNewWindow')"
                  >
                    {{ extractedTraceId }}
                    <q-icon name="open_in_new" size="xs" class="tw:ml-1" />
                  </a>
                </div>
                <q-chip dense color="primary" text-color="white" class="tw:ml-auto">
                  {{ traceSpanList.length }} {{ t('correlation.spans') }}
                </q-chip>
              </div>
            </div>

            <!-- Span Table -->
            <div class="tw:p-3 tw:overflow-auto" style="max-height: calc(100% - 4rem)">
              <q-table
                :rows="traceSpanList"
                :columns="spanTableColumns"
                row-key="span_id"
                flat
                dense
                :rows-per-page-options="[0]"
                class="trace-span-table"
              >
                <template v-slot:body-cell-service_name="props">
                  <q-td :props="props">
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <div
                        class="tw:w-2 tw:h-2 tw:rounded-full"
                        :style="{ backgroundColor: getServiceColor(props.row.service_name) }"
                      />
                      <span class="tw:font-mono tw:text-xs">{{ props.row.service_name }}</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-operation_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ props.row.operation_name }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-duration="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatDuration(props.row.duration || 0) }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-span_status="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.row.span_status === 'ERROR' ? 'negative' : 'positive'"
                      :label="props.row.span_status || 'OK'"
                    />
                  </q-td>
                </template>
                <template v-slot:body-cell-start_time="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatTimestamp(props.row.start_time) }}</span>
                  </q-td>
                </template>
              </q-table>
            </div>
          </div>

          <!-- Dimension-based Correlation - Traces List -->
          <div v-else-if="traceCorrelationMode === 'dimension-based' && tracesForDimensions.length > 0" class="tw:h-full">
            <!-- Header -->
            <div class="tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] trace-header-bg">
              <div class="tw:flex tw:items-center tw:gap-3">
                <q-icon name="hub" color="primary" size="1.25rem" />
                <div class="tw:flex tw:flex-col">
                  <span class="tw:text-sm tw:font-semibold">{{ t('correlation.dimensionBasedCorrelation') }}</span>
                  <span class="tw:text-xs tw:text-gray-500">{{ t('correlation.tracesFromService', { service: serviceName }) }}</span>
                </div>
                <q-chip dense color="primary" text-color="white" class="tw:ml-auto">
                  {{ tracesForDimensions.length }} {{ t('menu.traces') }}
                </q-chip>
              </div>
            </div>

            <!-- Traces Table -->
            <div class="tw:p-3 tw:overflow-auto" style="max-height: calc(100% - 4rem)">
              <q-table
                :rows="tracesForDimensions"
                :columns="traceListColumns"
                row-key="trace_id"
                flat
                dense
                :rows-per-page-options="[0]"
                class="trace-list-table"
              >
                <template v-slot:body-cell-trace_id="slotProps">
                  <q-td :props="slotProps">
                    <span
                      class="tw:font-mono tw:text-xs tw:text-primary tw:cursor-pointer hover:tw:underline"
                      @click="openTraceInNewWindow(slotProps.row.trace_id)"
                      :title="t('correlation.openTraceInNewWindow')"
                    >
                      {{ slotProps.row.trace_id?.substring(0, 16) }}...
                      <q-icon name="open_in_new" size="0.75rem" class="tw:ml-1" />
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-service_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.service_name) ? props.row.service_name.map((s: any) => s.service_name).join(', ') : props.row.service_name }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-operation_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.operation_name) ? props.row.operation_name[0] : props.row.operation_name }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-duration="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatDuration(props.row.duration || 0) }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-spans="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.spans) ? props.row.spans[0] : props.row.spans }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-errors="props">
                  <q-td :props="props">
                    <q-badge
                      :color="(Array.isArray(props.row.spans) ? props.row.spans[1] : 0) > 0 ? 'negative' : 'grey'"
                      :label="Array.isArray(props.row.spans) ? props.row.spans[1] : 0"
                    />
                  </q-td>
                </template>
                <template v-slot:body-cell-start_time="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatTimestamp(props.row.start_time) }}</span>
                  </q-td>
                </template>
              </q-table>
            </div>
          </div>

          <!-- No Traces Found State -->
          <div
            v-else-if="traceCorrelationMode !== null"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="search_off" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.noTracesFound') }}</div>
            <div class="tw:text-sm tw:text-gray-500 tw:mt-2">
              {{ t('correlation.noTracesDescription', { service: serviceName }) }}
            </div>
          </div>

          <!-- Initial State (waiting for tab to be shown) -->
          <div
            v-else
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="account_tree" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.correlatedTraces') }}</div>
            <div class="tw:text-sm tw:text-gray-500 tw:mt-2">
              {{ t('correlation.correlatedTracesFor', { service: serviceName }) }}
            </div>
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-dialog>

  <!-- Embedded Tabs Mode -->
  <div v-else class="correlation-dashboard-embedded">
    <!-- Dimensions Display - Stable (matched) and Unstable (additional) -->
    <div class="tw:py-2 tw:px-4 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
      <div class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap">
        <span class="tw:text-xs tw:font-semibold tw:opacity-70">
          {{ t('correlation.filters') }}:
        </span>
        <div
          v-for="(value, key) in pendingDimensions"
          :key="key"
          class="tw:flex tw:items-center tw:gap-2"
        >
          <span
            class="tw:text-xs tw:font-semibold"
            :class="unstableDimensionKeys.has(key) ? 'tw:opacity-60' : 'tw:opacity-100'"
          >
            {{ key }}:
          </span>
          <q-select
            v-model="pendingDimensions[key]"
            :options="getDimensionOptions(key, value)"
            dense
            outlined
            emit-value
            map-options
            @update:model-value="onPendingDimensionChange"
            class="dimension-dropdown"
            borderless
            style="min-width: 120px"
          />
          <q-tooltip v-if="unstableDimensionKeys.has(key)">
            Unstable dimension - changes on pod restart. Default: All values.
          </q-tooltip>
        </div>
        <!-- Apply Button -->
        <q-btn
          flat
          dense
          no-caps
          text-color="light-text"
          :label="t('common.apply')"
          :disable="!hasPendingChanges"
          @click="applyDimensionChanges"
          class="o2-secondary-button tw:ml-2"
          data-test="apply-dimension-filters-embedded"
          style="line-height: 2.2rem !important;"
        />
      </div>
    </div>

    <!-- Tab Panels (no tabs in embedded mode, controlled by parent) -->
    <q-card
      v-model="activeTab"
      animated
      class="correlation-content tw:flex-1 tw:overflow-auto"
    >
      <div v-if="activeTab == 'logs'" class="tw:p-0">
        <!-- Refresh Button -->
        <div v-if="logsDashboardData" class="tw:p-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:justify-end">
          <q-btn
            flat
            dense
            color="primary"
            icon="refresh"
            :label="t('common.refresh')"
            @click="loadDashboard"
            :loading="loading"
            size="sm"
          />
        </div>


        <RenderDashboardCharts
          v-if="logsDashboardData"
          :key="logsDashboardRenderKey"
          :dashboardData="logsDashboardData"
          :currentTimeObj="currentTimeObj"
          :viewOnly="true"
          :allowAlertCreation="false"
          searchType="dashboards"
        />
      </div>
     
     
      <div v-if="activeTab == 'metrics'" class="tw:h-full">
          <div class=" tw:p-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:items-center tw:justify-end tw:gap-2">
            <q-btn
              v-if="dashboardData"
              flat
              dense
              color="primary"
              icon="refresh"
              :label="t('common.refresh')"
              @click="loadDashboard"
              :loading="loading"
              size="sm"
            />
            <q-btn
              outline
              dense
              no-caps
              color="primary"
              icon="show_chart"
              :label="`${selectedMetricStreams.length} of ${uniqueMetricStreams.length} Metric(s)`"
              @click="showMetricSelector = true"
            >
              <q-tooltip>{{ t('correlation.metricsTooltip') }}</q-tooltip>
            </q-btn>
          </div>
            <div class="tw:p-0 tw:flex-1 tw:overflow-auto" style="height: calc(100vh - 272px);">
            <RenderDashboardCharts
              v-if="dashboardData"
              :key="dashboardRenderKey"
              :dashboardData="dashboardData"
              :currentTimeObj="currentTimeObj"
              :viewOnly="true"
              :allowAlertCreation="false"
              searchType="dashboards"
            />
      </div>
    </div>

      <div v-if="activeTab == 'traces'" class="tw:h-full">
          <!-- Refresh Button -->
          <div v-if="traceCorrelationMode !== null" class="tw:p-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:flex tw:justify-end">
            <q-btn
              flat
              dense
              color="primary"
              icon="refresh"
              :label="t('common.refresh')"
              @click="loadCorrelatedTraces"
              :loading="tracesLoading"
              size="sm"
            />
          </div>

          <!-- Loading State -->
          <div
            v-if="tracesLoading"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[calc(100vh-272px)] tw:py-20"
          >
            <q-spinner-hourglass color="primary" size="3.75rem" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.loadingTraces') }}</div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="tracesError"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="error_outline" size="3.75rem" color="negative" class="tw:mb-4" />
            <div class="tw:text-base tw:mb-2">{{ t('correlation.tracesError') }}</div>
            <div class="tw:text-sm tw:text-gray-500">{{ tracesError }}</div>
            <q-btn
              outline
              color="primary"
              :label="t('correlation.retryButton')"
              class="tw:mt-4"
              @click="loadCorrelatedTraces"
            />
          </div>

          <!-- Direct Trace Correlation - Full Span List -->
          <div v-else-if="traceCorrelationMode === 'direct' && traceSpanList.length > 0" class="tw:h-full">
            <!-- Trace Header -->
            <div class="tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] trace-header-bg">
              <div class="tw:flex tw:items-center tw:gap-3">
                <q-icon name="link" color="positive" size="1.25rem" />
                <div class="tw:flex tw:flex-col">
                  <span class="tw:text-sm tw:font-semibold">{{ t('correlation.directTraceMatch') }}</span>
                  <a
                    href="#"
                    class="tw:text-xs tw:text-blue-500 tw:font-mono tw:underline hover:tw:text-blue-700 tw:cursor-pointer"
                    @click.prevent="openTraceInNewWindow"
                    :title="t('correlation.openTraceInNewWindow')"
                  >
                    {{ extractedTraceId }}
                    <q-icon name="open_in_new" size="xs" class="tw:ml-1" />
                  </a>
                </div>
                <q-chip dense color="primary" text-color="white" class="tw:ml-auto">
                  {{ traceSpanList.length }} {{ t('correlation.spans') }}
                </q-chip>
              </div>
            </div>

            <!-- Span Table -->
            <div class="tw:p-3 tw:overflow-auto" style="max-height: calc(100% - 4rem)">
              <q-table
                :rows="traceSpanList"
                :columns="spanTableColumns"
                row-key="span_id"
                flat
                dense
                :rows-per-page-options="[0]"
                class="trace-span-table"
              >
                <template v-slot:body-cell-service_name="props">
                  <q-td :props="props">
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <div
                        class="tw:w-2 tw:h-2 tw:rounded-full"
                        :style="{ backgroundColor: getServiceColor(props.row.service_name) }"
                      />
                      <span class="tw:font-mono tw:text-xs">{{ props.row.service_name }}</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-operation_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ props.row.operation_name }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-duration="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatDuration(props.row.duration || 0) }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-span_status="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.row.span_status === 'ERROR' ? 'negative' : 'positive'"
                      :label="props.row.span_status || 'OK'"
                    />
                  </q-td>
                </template>
                <template v-slot:body-cell-start_time="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatTimestamp(props.row.start_time) }}</span>
                  </q-td>
                </template>
              </q-table>
            </div>
          </div>

          <!-- Dimension-based Correlation - Traces List -->
          <div v-else-if="traceCorrelationMode === 'dimension-based' && tracesForDimensions.length > 0" class="tw:h-full">
            <!-- Header -->
            <div class="tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] trace-header-bg">
              <div class="tw:flex tw:items-center tw:gap-3">
                <q-icon name="hub" color="primary" size="1.25rem" />
                <div class="tw:flex tw:flex-col">
                  <span class="tw:text-sm tw:font-semibold">{{ t('correlation.dimensionBasedCorrelation') }}</span>
                  <span class="tw:text-xs tw:text-gray-500">{{ t('correlation.tracesFromService', { service: serviceName }) }}</span>
                </div>
                <q-chip dense color="primary" text-color="white" class="tw:ml-auto">
                  {{ tracesForDimensions.length }} {{ t('menu.traces') }}
                </q-chip>
              </div>
            </div>

            <!-- Traces Table -->
            <div class="tw:p-3 tw:overflow-auto" style="max-height: calc(100vh - 332px)">
              <q-table
                :rows="tracesForDimensions"
                :columns="traceListColumns"
                row-key="trace_id"
                flat
                dense
                :rows-per-page-options="[0]"
                class="trace-list-table"
              >
                <template v-slot:body-cell-trace_id="slotProps">
                  <q-td :props="slotProps">
                    <span
                      class="tw:font-mono tw:text-xs tw:text-primary tw:cursor-pointer hover:tw:underline"
                      @click="openTraceInNewWindow(slotProps.row.trace_id)"
                      :title="t('correlation.openTraceInNewWindow')"
                    >
                      {{ slotProps.row.trace_id?.substring(0, 16) }}...
                      <q-icon name="open_in_new" size="0.75rem" class="tw:ml-1" />
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-service_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.service_name) ? props.row.service_name.map((s: any) => s.service_name).join(', ') : props.row.service_name }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-operation_name="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.operation_name) ? props.row.operation_name[0] : props.row.operation_name }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-duration="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatDuration(props.row.duration || 0) }}</span>
                  </q-td>
                </template>
                <template v-slot:body-cell-spans="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">
                      {{ Array.isArray(props.row.spans) ? props.row.spans[0] : props.row.spans }}
                    </span>
                  </q-td>
                </template>
                <template v-slot:body-cell-errors="props">
                  <q-td :props="props">
                    <q-badge
                      :color="(Array.isArray(props.row.spans) ? props.row.spans[1] : 0) > 0 ? 'negative' : 'grey'"
                      :label="Array.isArray(props.row.spans) ? props.row.spans[1] : 0"
                    />
                  </q-td>
                </template>
                <template v-slot:body-cell-start_time="props">
                  <q-td :props="props">
                    <span class="tw:font-mono tw:text-xs">{{ formatTimestamp(props.row.start_time) }}</span>
                  </q-td>
                </template>
              </q-table>
            </div>
          </div>

          <!-- No Traces Found State -->
          <div
            v-else-if="traceCorrelationMode !== null"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="search_off" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.noTracesFound') }}</div>
            <div class="tw:text-sm tw:text-gray-500 tw:mt-2">
              {{ t('correlation.noTracesDescription', { service: serviceName }) }}
            </div>
          </div>

          <!-- Initial State (waiting for tab to be shown) -->
          <div
            v-else
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          >
            <q-icon name="account_tree" size="3.75rem" color="grey-6" class="tw:mb-4" />
            <div class="tw:text-base">{{ t('correlation.correlatedTraces') }}</div>
            <div class="tw:text-sm tw:text-gray-500 tw:mt-2">
              {{ t('correlation.correlatedTracesFor', { service: serviceName }) }}
            </div>
          </div>
        </div>
    </q-card>
  </div>

  <!-- Metric Stream Selector Dialog -->
  <q-dialog v-model="showMetricSelector">
    <q-card class="metric-selector-dialog">
      <q-card-section class="tw:p-4 tw:border-b">
        <div class="tw:flex tw:items-center tw:justify-between tw:mb-3">
          <div class="tw:text-base tw:font-semibold">{{ t('correlation.selectMetrics') }}</div>
          <q-btn flat round dense icon="close" v-close-popup />
        </div>

        <!-- Search Input -->
        <q-input
          v-model="metricSearchText"
          dense
          outlined
          :placeholder="t('search.searchField')"
          clearable
          class="tw:w-full"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </q-card-section>

      <q-card-section class="tw:p-0 metric-list-container">
        <q-list v-if="filteredMetricStreams.length > 0">
          <q-item
            v-for="stream in filteredMetricStreams"
            :key="stream.stream_name"
            dense
            class="metric-list-item"
          >
            <q-item-section side>
              <q-checkbox
                :model-value="selectedMetricStreams.some(s => s.stream_name === stream.stream_name)"
                @update:model-value="toggleMetricStream(stream)"
                color="primary"
                size="xs"
                dense
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="metric-label">{{ stream.stream_name }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>

        <!-- No results message -->
        <div v-else class="tw:p-4 tw:text-center tw:text-gray-500">
          {{ t('search.noResult') }}
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  watch,
  defineAsyncComponent,
  provide,
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { useMetricsCorrelationDashboard, type MetricsCorrelationConfig } from "@/composables/useMetricsCorrelationDashboard";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import type { StreamInfo } from "@/services/service_streams";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import streamService from "@/services/stream";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";
import LogstashDatasource from "@/components/ingestion/logs/LogstashDatasource.vue";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue")
);

interface TimeRange {
  startTime: number;
  endTime: number;
}

interface Props {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  additionalDimensions?: Record<string, string>; // Unstable dimensions (pod-id, etc.) - shown with _o2_all option
  metricStreams: StreamInfo[];
  logStreams?: StreamInfo[];
  traceStreams?: StreamInfo[];
  timeRange: TimeRange;
  sourceStream?: string; // The original stream user was viewing (e.g., logs stream)
  sourceType?: string; // The type of source stream (logs/metrics/traces)
  availableDimensions?: Record<string, string>; // Actual field names from source (for fallback queries)
  ftsFields?: string[]; // Full text search fields from the source stream (used for trace_id extraction from log body)
  mode?: 'dialog' | 'embedded-tabs'; // Render mode: 'dialog' = full dialog, 'embedded-tabs' = just tabs content for DetailTable
  externalActiveTab?: string; // For embedded-tabs mode, allows parent to control active tab
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'dialog',
  externalActiveTab: 'logs',
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const router = useRouter();
const { t } = useI18n();
const { generateDashboard, generateLogsDashboard } = useMetricsCorrelationDashboard();
const { semanticGroups, loadSemanticGroups } = useServiceCorrelation();

// Check if embedded tabs mode
const isEmbeddedTabs = computed(() => props.mode === 'embedded-tabs');

// Provide selectedTabId for RenderDashboardCharts to use
const selectedTabId = computed(() => {
  // Map our activeTab to dashboard tab IDs
  return activeTab.value === "logs" ? "logs" : "metrics";
});
provide("selectedTabId", selectedTabId);

const isOpen = ref(true);
const loading = ref(false);
const error = ref<string | null>(null);
const dashboardData = ref<any>(null);
const logsDashboardData = ref<any>(null);
const dashboardRenderKey = ref(0);
const initialLoadCompleted = ref(false); // Track if initial load has completed to avoid duplicate loadDashboard calls
const logsDashboardRenderKey = ref(0);
const dashboardChartsRef = ref<any>(null);
const showMetricSelector = ref(false);
const metricSearchText = ref("");

// Trace correlation state
const tracesLoading = ref(false);
const tracesError = ref<string | null>(null);
const extractedTraceId = ref<string | null>(null);
const traceCorrelationMode = ref<'direct' | 'dimension-based' | null>(null);
const traceSpanList = ref<any[]>([]);
const tracesForDimensions = ref<any[]>([]); // Traces found via dimension-based correlation

// Table columns for span list (direct trace correlation)
const spanTableColumns = [
  { name: 'service_name', label: 'Service', field: 'service_name', align: 'left' as const, sortable: true },
  { name: 'operation_name', label: 'Operation', field: 'operation_name', align: 'left' as const, sortable: true },
  { name: 'duration', label: 'Duration', field: 'duration', align: 'left' as const, sortable: true },
  { name: 'span_status', label: 'Status', field: 'span_status', align: 'left' as const, sortable: true },
  { name: 'start_time', label: 'Start Time', field: 'start_time', align: 'left' as const, sortable: true },
];

// Table columns for trace list (dimension-based correlation)
const traceListColumns = [
  { name: 'trace_id', label: 'Trace ID', field: 'trace_id', align: 'left' as const },
  { name: 'service_name', label: 'Service', field: 'service_name', align: 'left' as const },
  { name: 'operation_name', label: 'Operation', field: 'operation_name', align: 'left' as const },
  { name: 'duration', label: 'Duration', field: 'duration', align: 'left' as const, sortable: true },
  { name: 'spans', label: 'Spans', field: 'spans', align: 'left' as const },
  { name: 'errors', label: 'Errors', field: 'errors', align: 'left' as const },
  { name: 'start_time', label: 'Time', field: 'start_time', align: 'left' as const, sortable: true },
];

// Service colors for span visualization
const serviceColors: Record<string, string> = {};
const colorPalette = ["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2", "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffeaa7"];
let colorIndex = 0;

const getServiceColor = (serviceName: string): string => {
  if (!serviceColors[serviceName]) {
    serviceColors[serviceName] = colorPalette[colorIndex % colorPalette.length];
    colorIndex++;
  }
  return serviceColors[serviceName];
};

// Use external tab control in embedded mode, otherwise manage internally
const activeTab = computed({
  get: () => isEmbeddedTabs.value ? props.externalActiveTab : internalActiveTab.value,
  set: (val) => {
    if (!isEmbeddedTabs.value) {
      internalActiveTab.value = val;
    }
  }
});
const internalActiveTab = ref("logs");

// Active dimensions that can be modified
// - matchedDimensions (stable): use actual values from current row
// - additionalDimensions (unstable): use actual values from current row (user can change to "All" if desired)
// Applied dimensions - these are used to generate queries
const activeDimensions = ref<Record<string, string>>({
  ...props.matchedDimensions,
  // Use actual values from additionalDimensions (showing current row values)
  ...(props.additionalDimensions || {})
});

// Pending dimensions - these are edited by the user but not yet applied
const pendingDimensions = ref<Record<string, string>>({
  ...props.matchedDimensions,
  // Use actual values from additionalDimensions (showing current row values)
  ...(props.additionalDimensions || {})
});

// Track if there are pending changes that haven't been applied
const hasPendingChanges = computed(() => {
  const activeKeys = Object.keys(activeDimensions.value);
  const pendingKeys = Object.keys(pendingDimensions.value);

  if (activeKeys.length !== pendingKeys.length) return true;

  for (const key of activeKeys) {
    if (activeDimensions.value[key] !== pendingDimensions.value[key]) {
      return true;
    }
  }
  return false;
});

// Track which dimensions are unstable (for UI styling)
const unstableDimensionKeys = computed(() => new Set(Object.keys(props.additionalDimensions || {})));

// Get unique metric streams by stream_name
const getUniqueStreams = (streams: StreamInfo[]) => {
  const seen = new Set<string>();
  const unique: StreamInfo[] = [];

  for (const stream of streams) {
    if (!seen.has(stream.stream_name)) {
      seen.add(stream.stream_name);
      unique.push(stream);
    }
  }

  return unique;
};

/**
 * Apply SELECT_ALL_VALUE to filters for unstable dimensions
 * This ensures that unstable dimension filters default to wildcard (All values)
 *
 * Strategy: Use semantic groups to map metric field names to dimension IDs.
 * 1. Build a reverse lookup: field_name -> semantic_dimension_id (from semanticGroups)
 * 2. For each filter in the stream, find its semantic dimension ID
 * 3. If that dimension ID is in additionalDimensions (unstable), set filter to SELECT_ALL_VALUE
 *
 * Example:
 * - semanticGroups has: { id: 'k8s-node-id', fields: ['k8s_node_name', 'node_name', ...] }
 * - additionalDimensions has: { 'k8s-node-id': 'node-abc' }
 * - Metric filter has: { k8s_node_name: 'node-xyz' }
 * - k8s_node_name maps to 'k8s-node-id' which is in additionalDimensions -> set to SELECT_ALL_VALUE
 */
const applyUnstableDimensionDefaults = (streams: StreamInfo[]): StreamInfo[] => {
  // Collect ALL unstable dimension IDs from:
  // 1. additionalDimensions (explicitly marked as unstable)
  // 2. matchedDimensions where value is already SELECT_ALL_VALUE (unstable dims with wildcard)
  const unstableDimIds = new Set<string>();

  const additionalDims = props.additionalDimensions || {};
  const matchedDims = props.matchedDimensions || {};

  // Add all keys from additionalDimensions
  for (const key of Object.keys(additionalDims)) {
    unstableDimIds.add(key);
  }

  // Add keys from matchedDimensions that have SELECT_ALL_VALUE (these are unstable)
  for (const [key, value] of Object.entries(matchedDims)) {
    if (value === SELECT_ALL_VALUE) {
      unstableDimIds.add(key);
    }
  }

  if (unstableDimIds.size === 0) {
    return streams;
  }

  // Build reverse lookup: field_name -> semantic_dimension_id
  // Using semanticGroups from useServiceCorrelation()

  const fieldToDimensionId = new Map<string, string>();
  for (const group of semanticGroups.value) {
    for (const field of group.fields) {
      fieldToDimensionId.set(field, group.id);
    }
  }

  const result = streams.map(stream => {
    const updatedFilters = { ...stream.filters };
    const changedKeys: string[] = [];
    const notMatchedKeys: string[] = [];

    // For each filter in the stream, check if it maps to an unstable dimension
    for (const [filterKey, filterValue] of Object.entries(stream.filters)) {
      // Look up the semantic dimension ID for this field name
      const dimensionId = fieldToDimensionId.get(filterKey);

      if (dimensionId && unstableDimIds.has(dimensionId)) {
        // This filter's field maps to an unstable dimension - set to wildcard
        updatedFilters[filterKey] = SELECT_ALL_VALUE;
        changedKeys.push(`${filterKey} (${dimensionId})=${filterValue}`);
      } else if (!dimensionId) {
        notMatchedKeys.push(filterKey);
      }
    }

    return {
      ...stream,
      filters: updatedFilters,
    };
  });

  return result;
};

const uniqueMetricStreams = computed(() => {
  return getUniqueStreams(props.metricStreams);
});

// Selected metric streams (default to first 6 unique streams)
// Apply SELECT_ALL_VALUE defaults for unstable dimensions
const selectedMetricStreams = ref<StreamInfo[]>(
  applyUnstableDimensionDefaults(getUniqueStreams(props.metricStreams).slice(0, 6))
);

// Filter metric streams based on search text
const filteredMetricStreams = computed(() => {
  const streams = uniqueMetricStreams.value;

  if (!metricSearchText.value?.trim()) {
    return streams;
  }

  const searchLower = metricSearchText.value.toLowerCase();
  return streams.filter(stream =>
    stream.stream_name.toLowerCase().includes(searchLower)
  );
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => {
  // props.timeRange is in microseconds (16 digits), just like TracesAnalysisDashboard
  // Date constructor expects milliseconds, so we create Date objects with microseconds
  // (which will be invalid dates, but that's ok - TracesAnalysisDashboard does the same)
  const timeObj = {
    __global: {
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    },
  };

  return timeObj;
});

// Toggle metric stream selection
const toggleMetricStream = (stream: StreamInfo) => {
  const index = selectedMetricStreams.value.findIndex(
    s => s.stream_name === stream.stream_name
  );

  if (index > -1) {
    // Remove stream
    selectedMetricStreams.value = selectedMetricStreams.value.filter(
      s => s.stream_name !== stream.stream_name
    );
  } else {
    // Add stream - apply SELECT_ALL_VALUE defaults for unstable dimensions
    const streamsWithDefaults = applyUnstableDimensionDefaults([stream]);
    selectedMetricStreams.value = [...selectedMetricStreams.value, ...streamsWithDefaults];
  }
};

// Get dropdown options for a dimension
const getDimensionOptions = (key: string, currentValue: string) => {
  // Get the original value - could be from matched (stable) or additional (unstable) dimensions
  const originalValue = props.matchedDimensions[key] || props.additionalDimensions?.[key];
  const isUnstable = unstableDimensionKeys.value.has(key);

  // Create options array
  const options = [
    {
      label: t('correlation.all'),
      value: SELECT_ALL_VALUE,
    },
  ];

  // Add the original value option if it exists and is not already SELECT_ALL_VALUE
  if (originalValue && originalValue !== SELECT_ALL_VALUE) {
    options.push({
      label: isUnstable ? `${originalValue} (current)` : originalValue,
      value: originalValue,
    });
  }

  return options;
};

// Fetch metric schemas for all streams in one call
const fetchMetricSchemas = async (streamNames: string[]) => {
  try {
    // Check if we already have schemas in store
    const cachedMetrics = store.state.streams.metrics || {};
    const missingStreams = streamNames.filter(name => !cachedMetrics[name]?.metrics_meta);

    if (missingStreams.length === 0) {
      return cachedMetrics;
    }

    // Fetch all metric streams with schema in one API call
    const response = await streamService.nameList(
      currentOrgIdentifier.value,
      "metrics",
      true, // fetchSchema = true
      -1,
      -1,
      "",
      "",
      false
    );

    if (response.data?.list) {
      // Build a map of stream name to schema data
      const schemasMap: Record<string, any> = {};
      for (const stream of response.data.list) {
        if (stream.name && stream.metrics_meta) {
          schemasMap[stream.name] = stream;
        }
      }

      // Update store with new schemas
      const updatedMetrics = { ...cachedMetrics, ...schemasMap };
      store.dispatch("streams/setMetricsStreams", updatedMetrics);

      return updatedMetrics;
    }

    return cachedMetrics;
  } catch (err) {
    console.error("[TelemetryCorrelationDashboard] Error fetching schemas:", err);
    return store.state.streams.metrics || {};
  }
};

// Handle pending dimension value change - just updates pending state, doesn't regenerate queries
const onPendingDimensionChange = () => {
  // console.log("[TelemetryCorrelationDashboard] Pending dimension changed:", pendingDimensions.value);
  // No action needed - hasPendingChanges computed will update automatically
};

// Apply pending dimension changes and regenerate dashboard
const applyDimensionChanges = () => {
  // Copy pending to active
  activeDimensions.value = { ...pendingDimensions.value };

  // Build field_name -> dimension_id mapping from semantic groups
  // This is the same approach as applyUnstableDimensionDefaults
  const fieldToDimensionId = new Map<string, string>();
  for (const group of semanticGroups.value) {
    for (const field of group.fields) {
      fieldToDimensionId.set(field, group.id);
    }
  }

  // Update metric stream filters with new dimension values
  // Use semantic groups to map filter field names to dimension IDs
  selectedMetricStreams.value = selectedMetricStreams.value.map(stream => {
    const updatedFilters = { ...stream.filters };
    
    // For each filter in the stream, find its semantic dimension ID
    // and update with the new value from activeDimensions
    for (const [filterKey, _filterValue] of Object.entries(stream.filters)) {
      const dimensionId = fieldToDimensionId.get(filterKey);
      if (dimensionId && activeDimensions.value[dimensionId] !== undefined) {
        const newValue = activeDimensions.value[dimensionId];
        updatedFilters[filterKey] = newValue;
      }
    }

    return {
      ...stream,
      filters: updatedFilters,
    };
  });

  // Note: For logs, the filters are built from config.matchedDimensions in the composable
  // which we're already updating via activeDimensions

  // Reload the dashboard with updated filters
  loadDashboard();
};

const loadDashboard = async () => {
  try {
    loading.value = true;
    error.value = null;

    // Fetch metric schemas for all selected streams
    let metricSchemas: Record<string, any> = {};
    if (selectedMetricStreams.value.length > 0) {
      const streamNames = selectedMetricStreams.value.map(s => s.stream_name);
      metricSchemas = await fetchMetricSchemas(streamNames);
    }

    const config: MetricsCorrelationConfig = {
      serviceName: props.serviceName,
      matchedDimensions: activeDimensions.value,
      metricStreams: selectedMetricStreams.value,
      logStreams: props.logStreams,
      traceStreams: props.traceStreams,
      orgIdentifier: currentOrgIdentifier.value,
      timeRange: props.timeRange,
      sourceStream: props.sourceStream,
      sourceType: props.sourceType,
      availableDimensions: props.availableDimensions,
      metricSchemas: metricSchemas,
    };

    // Generate metrics dashboard JSON (if we have metrics)
    if (selectedMetricStreams.value.length > 0) {
      // selectedMetricStreams.value.forEach(s => {
      //   console.log(`  ${s.stream_name}:`, s.filters);
      // });
      const dashboard = generateDashboard(selectedMetricStreams.value, config);
      dashboardData.value = dashboard;
      dashboardRenderKey.value++;
    } else {
      // console.log("[TelemetryCorrelationDashboard] No metric streams selected, skipping metrics dashboard");
    }

    // Generate logs dashboard JSON
    // If we have correlated log streams from API, use those
    // Otherwise, if coming from logs page, use the source stream with matched dimensions
    const shouldGenerateLogsDashboard =
      (props.logStreams && props.logStreams.length > 0) ||
      (props.sourceType === "logs" && props.sourceStream);

    if (shouldGenerateLogsDashboard) {
      const logsDashboard = generateLogsDashboard(props.logStreams || [], config);
      logsDashboardData.value = logsDashboard;
      logsDashboardRenderKey.value++;
    } else {
      // console.log("[TelemetryCorrelationDashboard] No log streams and not from logs page");
    }
  } catch (err: any) {
    // console.error("[TelemetryCorrelationDashboard] Error loading correlation dashboard:", err);
    error.value = err.message || t('correlation.failedToLoad');
    showErrorNotification(error.value);
  } finally {
    loading.value = false;
  }
};

/**
 * Add new metric panels without re-rendering existing ones
 * This is called when user adds new metrics to avoid reloading all panels
 */
const addMetricPanels = async (addedStreams: StreamInfo[]) => {
  if (!dashboardData.value || !dashboardData.value.tabs?.[0]?.panels) {
    // No existing dashboard, do full load
    loadDashboard();
    return;
  }

  try {
    // Get current panels
    const currentPanels = dashboardData.value.tabs[0].panels;
    const existingCount = currentPanels.length;

    // Fetch schemas for new streams only
    const newStreamNames = addedStreams.map(s => s.stream_name);
    const newSchemas = await fetchMetricSchemas(newStreamNames);

    // Build config for new panels
    const config: MetricsCorrelationConfig = {
      serviceName: props.serviceName,
      matchedDimensions: activeDimensions.value,
      metricStreams: addedStreams,
      logStreams: props.logStreams,
      traceStreams: props.traceStreams,
      orgIdentifier: currentOrgIdentifier.value,
      timeRange: props.timeRange,
      sourceStream: props.sourceStream,
      sourceType: props.sourceType,
      availableDimensions: props.availableDimensions,
      metricSchemas: newSchemas,
    };

    // Generate panels for new streams only
    const newDashboard = generateDashboard(addedStreams, config);
    const newPanels = newDashboard.tabs[0].panels;

    // Update layout positions for new panels to appear after existing ones
    const timestamp = Date.now();
    newPanels.forEach((panel: any, index: number) => {
      const absoluteIndex = existingCount + index;
      // Use completely unique ID with timestamp to avoid collision
      const uniqueId = `${panel.layout.i}_${timestamp}_${absoluteIndex}`;
      panel.layout = {
        x: (absoluteIndex % 3) * 64,
        y: Math.floor(absoluteIndex / 3) * 16,
        w: 64,
        h: 16,
        i: uniqueId,
      };
      // Update panel ID to match
      panel.id = `${panel.id}_${timestamp}`;
    });

    // Create new dashboard object by appending panels
    const updatedDashboard = {
      ...dashboardData.value,
      tabs: [
        {
          ...dashboardData.value.tabs[0],
          panels: [...currentPanels, ...newPanels],
        },
        ...dashboardData.value.tabs.slice(1),
      ],
    };

    dashboardData.value = updatedDashboard;

    // DON'T increment dashboardRenderKey - let Vue's reactivity handle it
    // Since each panel has a unique ID, Vue will only render the new panels

    // Wait for DOM to update, then refresh GridStack to position new panels
    await nextTick();
    if (dashboardChartsRef.value?.refreshGridStack) {
      await dashboardChartsRef.value.refreshGridStack();
    }
  } catch (err: any) {
    console.error("[TelemetryCorrelationDashboard] Error adding metric panels, falling back to full reload:", err);
    loadDashboard();
  }
};

const onClose = () => {
  if (props.mode === 'dialog') {
    isOpen.value = false;
  }
  // Reset initial load flag for next open
  initialLoadCompleted.value = false;
  emit("close");
};

// Helper function to format time range
const formatTimeRange = (range: TimeRange) => {
  // range.startTime and range.endTime are in microseconds (16 digits)
  // Convert to milliseconds by dividing by 1000
  const startDate = new Date(range.startTime / 1000);
  const endDate = new Date(range.endTime / 1000);

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  // Calculate duration in microseconds, then convert to minutes
  const durationMicros = range.endTime - range.startTime;
  const durationMinutes = Math.round(durationMicros / 1000 / 60000);

  return `${formatTime(startDate)} - ${formatTime(endDate)} (${durationMinutes} min)`;
};

// ============= TRACE CORRELATION FUNCTIONS =============

/**
 * Derive all possible field name variations from a base field name
 * For example, "trace_id" -> ["trace_id", "traceId", "traceid", "trace-id", "TraceId", "TRACE_ID", etc.]
 */
const deriveFieldNameVariations = (baseFieldName: string): string[] => {
  const variations = new Set<string>();

  // Add the original
  variations.add(baseFieldName);

  // Normalize to get base words (split by _, -, or camelCase)
  const words = baseFieldName
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase to snake_case
    .replace(/-/g, '_') // kebab to snake
    .toLowerCase()
    .split('_')
    .filter(w => w.length > 0);

  if (words.length > 0) {
    // snake_case: trace_id
    variations.add(words.join('_'));

    // UPPER_SNAKE_CASE: TRACE_ID
    variations.add(words.join('_').toUpperCase());

    // kebab-case: trace-id
    variations.add(words.join('-'));

    // camelCase: traceId
    const camelCase = words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    variations.add(camelCase);

    // PascalCase: TraceId
    const pascalCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    variations.add(pascalCase);

    // lowercase: traceid
    variations.add(words.join(''));

    // UPPERCASE: TRACEID
    variations.add(words.join('').toUpperCase());
  }

  return Array.from(variations);
};

/**
 * Build regex patterns for extracting trace_id from text content
 * Dynamically generates patterns based on the configured field name
 * Supports: hex, alphanumeric, and UUID format trace IDs
 */
const buildTraceIdTextPatterns = (fieldName: string): RegExp[] => {
  const variations = deriveFieldNameVariations(fieldName);
  const patterns: RegExp[] = [];

  // UUID pattern: 8-4-4-4-12 hex with hyphens
  const uuidPattern = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
  // Alphanumeric pattern: 16-64 chars
  const alphanumPattern = '[a-zA-Z0-9]{16,64}';

  for (const variant of variations) {
    // Escape special regex characters in the variant
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // UUID format patterns (must come first as they're more specific)
    // Pattern: [field_name uuid] - e.g., [trace_id 019411a7-30e7-7e8a-a456-426614174000]
    patterns.push(new RegExp(`\\[${escaped}\\s+(${uuidPattern})\\]`, 'i'));

    // Pattern: field_name=uuid or field_name: uuid
    patterns.push(new RegExp(`${escaped}[=:]\\s*["']?(${uuidPattern})["']?`, 'i'));

    // Pattern: "field_name": "uuid" (JSON)
    patterns.push(new RegExp(`"${escaped}"\\s*:\\s*"(${uuidPattern})"`, 'i'));

    // Alphanumeric format patterns
    // Pattern: [field_name abc123] - handles formats like [trace_id 36eFC0BZ5e7PHLMEd1ojvr06I3K]
    patterns.push(new RegExp(`\\[${escaped}\\s+(${alphanumPattern})\\]`, 'i'));

    // Pattern: [field_name abc123-suffix] - handles formats with dash suffix
    patterns.push(new RegExp(`\\[${escaped}\\s+(${alphanumPattern})(?:-[^\\]]*)?\\]`, 'i'));

    // Pattern: field_name=abc123 or field_name: abc123 (possibly with dash suffix)
    patterns.push(new RegExp(`${escaped}[=:]\\s*["']?(${alphanumPattern})(?:-[^"'\\s]*)?["']?`, 'i'));

    // Pattern: "field_name": "abc123" (JSON, possibly with dash suffix)
    patterns.push(new RegExp(`"${escaped}"\\s*:\\s*"(${alphanumPattern})(?:-[^"]*)?\\s*"`, 'i'));
  }

  return patterns;
};

/**
 * Extract trace_id from text content (like log body/message)
 * Uses dynamically generated patterns based on the configured trace_id_field_name
 */
const extractTraceIdFromText = (text: string): string | null => {
  if (!text || typeof text !== 'string') return null;

  // Get the configured field name, default to 'trace_id'
  const configuredFieldName = store.state.organizationData?.organizationSettings?.trace_id_field_name || 'trace_id';

  // Build patterns dynamically from the configured field name
  const patterns = buildTraceIdTextPatterns(configuredFieldName);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && isValidTraceId(match[1])) {
      return match[1];
    }
  }
  return null;
};

/**
 * Extract trace_id from the log record
 * Priority:
 * 1. Use configured trace_id_field_name from org settings (exact match)
 * 2. Scan derived field name variations from the configured name (structured fields)
 * 3. Scan FTS (Full Text Search) fields for embedded trace_id patterns in text content
 * 4. Fallback: Scan ALL string fields for embedded trace_id patterns
 */
const extractTraceIdFromLog = (): string | null => {
  const logRecord = props.availableDimensions;
  if (!logRecord) {
    return null;
  }

  // Get the configured field name, default to 'trace_id'
  const configuredTraceIdField = store.state.organizationData?.organizationSettings?.trace_id_field_name || 'trace_id';

  // 1. First check the exact configured field name
  if (logRecord[configuredTraceIdField]) {
    const value = String(logRecord[configuredTraceIdField]);
    if (isValidTraceId(value)) {
      return value;
    }
  }

  // 2. Derive all field name variations from the configured name and scan them
  const fieldVariations = deriveFieldNameVariations(configuredTraceIdField);
  
  for (const variant of fieldVariations) {
    // Check exact match
    if (logRecord[variant]) {
      const value = String(logRecord[variant]);
      if (isValidTraceId(value)) {
        return value;
      }
    }

    // Check case-insensitive match against all log record keys
    const lowerVariant = variant.toLowerCase();
    for (const [key, val] of Object.entries(logRecord)) {
      if (key.toLowerCase() === lowerVariant && val) {
        const value = String(val);
        if (isValidTraceId(value)) {
          return value;
        }
      }
    }
  }

  // 3. Scan FTS (Full Text Search) fields for embedded trace_id patterns in text content
  // Use FTS fields from props if available, otherwise fall back to default FTS fields from config
  const ftsFieldsToScan = props.ftsFields?.length
    ? props.ftsFields
    : (store.state.zoConfig?.default_fts_keys || ['body', 'message', 'log', 'msg']);

  for (const field of ftsFieldsToScan) {
    // Check exact field name
    if (logRecord[field]) {
      const traceId = extractTraceIdFromText(String(logRecord[field]));
      if (traceId) {
        return traceId;
      }
    }

    // Check case-insensitive
    for (const [key, val] of Object.entries(logRecord)) {
      if (key.toLowerCase() === field.toLowerCase() && val) {
        const traceId = extractTraceIdFromText(String(val));
        if (traceId) {
          return traceId;
        }
      }
    }
  }

  // 4. Fallback: Scan ALL string fields for embedded trace_id patterns
  // This catches cases where trace_id is embedded in non-FTS fields
  const scannedFields = new Set(ftsFieldsToScan.map(f => f.toLowerCase()));

  for (const [key, val] of Object.entries(logRecord)) {
    // Skip fields we already scanned and non-string values
    if (scannedFields.has(key.toLowerCase()) || typeof val !== 'string') continue;

    // Only scan fields that look like they might contain text content
    const value = String(val);
    if (value.length > 50) { // Only scan longer strings that might be log messages
      const traceId = extractTraceIdFromText(value);
      if (traceId) {
        return traceId;
      }
    }
  }

  return null;
};

/**
 * Validate if a string looks like a valid trace ID
 * Supports multiple trace ID formats:
 * - Hex trace IDs: 16-64 hex characters (OpenTelemetry, Jaeger, Zipkin)
 * - Alphanumeric trace IDs: 16-64 alphanumeric characters (some custom systems)
 * - UUID format: 8-4-4-4-12 hex with hyphens (UUID v1, v4, v7, etc.)
 * - AWS X-Ray format: 1-{8 hex}-{24 hex} (e.g., 1-5759e988-bd862e3fe1be46a994272793)
 */
const isValidTraceId = (value: string): boolean => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();

  // Pattern 1: Standard hex trace ID (OpenTelemetry, Jaeger, Zipkin)
  // 16-64 hex characters
  if (/^[a-fA-F0-9]{16,64}$/.test(trimmed)) {
    return true;
  }

  // Pattern 2: Alphanumeric trace ID (some systems use base64-like IDs)
  // 16-64 alphanumeric characters (letters and numbers)
  if (/^[a-zA-Z0-9]{16,64}$/.test(trimmed)) {
    return true;
  }

  // Pattern 3: UUID format (v1, v4, v7, etc.): 8-4-4-4-12 hex with hyphens
  // e.g., 019411a7-30e7-7e8a-a456-426614174000 (UUID v7)
  // e.g., 550e8400-e29b-41d4-a716-446655440000 (UUID v4)
  if (/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(trimmed)) {
    return true;
  }

  // Pattern 4: AWS X-Ray format: 1-{8 hex}-{24 hex}
  if (/^1-[a-fA-F0-9]{8}-[a-fA-F0-9]{24}$/.test(trimmed)) {
    return true;
  }

  return false;
};

/**
 * Fetch full trace details (all spans) for a specific trace_id
 */
const fetchTraceByTraceId = async (traceId: string) => {
  if (!props.traceStreams?.length) {
    return null;
  }

  const streamName = props.traceStreams[0].stream_name;
  
  // Use a wider time range when searching by specific trace_id
  // Since we have an exact trace_id, we can search across a larger window (24 hours before to now)
  // The log timestamp might not match the trace timestamp exactly
  const nowMicros = Date.now() * 1000;
  const oneDayAgoMicros = nowMicros - (24 * 60 * 60 * 1000000); // 24 hours in microseconds

  // Use the wider range: either 24h before now, or props.timeRange.startTime, whichever is earlier
  const searchStartTime = Math.min(oneDayAgoMicros, props.timeRange.startTime);
  const searchEndTime = nowMicros; // Always search up to now

  // First, get trace metadata to find time range
  const traceMetaResponse = await searchService.get_traces({
    org_identifier: currentOrgIdentifier.value,
    start_time: searchStartTime,
    end_time: searchEndTime,
    filter: `trace_id='${traceId}'`,
    size: 1,
    from: 0,
    stream_name: streamName,
  });

  if (!traceMetaResponse.data?.hits?.length) {
    return null;
  }

  const traceMeta = traceMetaResponse.data.hits[0];
  const traceStartTime = Math.floor(traceMeta.start_time / 1000) - 10000;
  const traceEndTime = Math.ceil(traceMeta.end_time / 1000) + 10000;

  // Now fetch all spans for this trace
  const query = {
    query: {
      sql: b64EncodeUnicode(`SELECT * FROM "${streamName}" WHERE trace_id = '${traceId}' ORDER BY start_time`),
      start_time: traceStartTime,
      end_time: traceEndTime,
      from: 0,
      size: 2500,
    },
    encoding: "base64",
  };

  const spansResponse = await searchService.search(
    {
      org_identifier: currentOrgIdentifier.value,
      query: query,
      page_type: "traces",
    },
    "ui"
  );

  return {
    traceMeta,
    spans: spansResponse.data?.hits || [],
  };
};

/**
 * Get service field names from the "service" semantic group
 * Falls back to common field names if semantic groups not loaded yet
 */
const getServiceFieldNames = (): string[] => {
  // Try to find the "service" semantic group
  const serviceGroup = semanticGroups.value.find(
    (group) => group.id === 'service' || group.id?.toLowerCase() === 'service'
  );

  if (serviceGroup && serviceGroup.fields.length > 0) {
    return serviceGroup.fields;
  }

  // Fallback to common service field names if semantic groups not loaded
  return [
    'service_name',
    'service',
    'svc',
    'app',
    'application',
    'app_name',
    'attributes_service_name',
    'resource_service_name',
    'resource_attributes_service_name',
    'service_service_name',
    'job',
  ];
};

/**
 * Find the service field name and value from StreamInfo filters
 * Uses semantic groups to get the list of possible service field names
 */
const findServiceFilter = (filters: Record<string, string> | undefined): { fieldName: string; value: string } | null => {
  if (!filters) return null;

  const serviceFieldNames = getServiceFieldNames();
  for (const fieldName of serviceFieldNames) {
    if (filters[fieldName]) {
      return { fieldName, value: filters[fieldName] };
    }
  }
  return null;
};

/**
 * Fetch traces via dimension-based correlation (service name match)
 */
const fetchTracesByDimensions = async () => {
  if (!props.traceStreams?.length) {
    return [];
  }

  const traceStreamInfo = props.traceStreams[0];
  const streamName = traceStreamInfo.stream_name;

  // Build filter using the service field from the trace stream's filters
  // This uses the exact field name from the trace data (e.g., 'service_name', 'service', etc.)
  const filterParts: string[] = [];

  // Find the service field from StreamInfo filters (using semantic group field names)
  const serviceFilter = findServiceFilter(traceStreamInfo.filters);
  if (serviceFilter) {
    filterParts.push(`${serviceFilter.fieldName}='${serviceFilter.value}'`);
  }

  // Fallback: if no service field in filters, try activeDimensions
  if (filterParts.length === 0) {
    const serviceFieldNames = getServiceFieldNames();
    for (const fieldName of serviceFieldNames) {
      const normalizedKey = fieldName.replace(/-/g, '_');
      if (activeDimensions.value[fieldName]) {
        filterParts.push(`${fieldName}='${activeDimensions.value[fieldName]}'`);
        break;
      } else if (activeDimensions.value[normalizedKey]) {
        filterParts.push(`${normalizedKey}='${activeDimensions.value[normalizedKey]}'`);
        break;
      }
    }
  }

  // Last resort: use the service name from props (FQN) with default field name
  if (filterParts.length === 0 && props.serviceName) {
    filterParts.push(`service_name='${props.serviceName}'`);
  }

  const filter = filterParts.join(' AND ');
  
  const response = await searchService.get_traces({
    org_identifier: currentOrgIdentifier.value,
    start_time: props.timeRange.startTime,
    end_time: props.timeRange.endTime,
    filter: filter,
    size: 50,
    from: 0,
    stream_name: streamName,
  });

  return response.data?.hits || [];
};

/**
 * Format duration in a human-readable way
 */
const formatDuration = (durationNs: number): string => {
  if (durationNs < 1000) {
    return `${durationNs}ns`;
  } else if (durationNs < 1000000) {
    return `${(durationNs / 1000).toFixed(2)}µs`;
  } else if (durationNs < 1000000000) {
    return `${(durationNs / 1000000).toFixed(2)}ms`;
  } else {
    return `${(durationNs / 1000000000).toFixed(2)}s`;
  }
};

/**
 * Format timestamp for display
 */
const formatTimestamp = (timestampMicros: number): string => {
  const date = new Date(timestampMicros / 1000);
  return date.toLocaleString();
};

/**
 * Open traces screen in new window with trace_id filter
 * @param traceIdOrEvent - trace_id string to use, or event object (when called from @click without args)
 */
const openTraceInNewWindow = (traceIdOrEvent?: string | Event) => {
  // Handle case where event object is passed instead of trace_id (e.g., from @click without args)
  const traceId = typeof traceIdOrEvent === 'string' ? traceIdOrEvent : undefined;
  const targetTraceId = traceId || extractedTraceId.value;
  if (!targetTraceId) return;

  const org = store.state.selectedOrganization.identifier;
  const traceStream = props.traceStreams?.[0]?.stream_name || "default";

  // Build the URL with sql_mode and just trace_id filter
  const route = router.resolve({
    name: "traces",
    query: {
      org_identifier: org,
      stream: traceStream,
      sql_mode: "true",
      query: b64EncodeUnicode(`trace_id='${targetTraceId}'`),
      from: props.timeRange.startTime.toString(),
      to: props.timeRange.endTime.toString(),
    },
  });

  // Open in new window/tab
  window.open(route.href, "_blank");
};

/**
 * Load correlated traces
 */
const loadCorrelatedTraces = async () => {
  if (tracesLoading.value) return;

  tracesLoading.value = true;
  tracesError.value = null;
  extractedTraceId.value = null;
  traceCorrelationMode.value = null;
  traceSpanList.value = [];
  tracesForDimensions.value = [];

  try {
    // Step 1: Try to extract trace_id from the log record
    const traceId = extractTraceIdFromLog();

    if (traceId) {
      // Direct trace correlation - fetch full trace
      extractedTraceId.value = traceId;
      traceCorrelationMode.value = 'direct';

      const traceData = await fetchTraceByTraceId(traceId);
      if (traceData && traceData.spans.length > 0) {
        traceSpanList.value = traceData.spans;
      } else {
        // Trace ID found but no spans - fall back to dimension-based
        traceCorrelationMode.value = 'dimension-based';
        tracesForDimensions.value = await fetchTracesByDimensions();
      }
    } else {
      // No trace_id found - use dimension-based correlation
      traceCorrelationMode.value = 'dimension-based';
      tracesForDimensions.value = await fetchTracesByDimensions();
    }
  } catch (err: any) {
    tracesError.value = err.message || "Failed to load traces";
    showErrorNotification(tracesError.value);
  } finally {
    tracesLoading.value = false;
  }
};

// Load traces when traces tab is shown
watch(
  () => activeTab.value,
  (newTab) => {
    if (newTab === 'traces' && traceCorrelationMode.value === null && !tracesLoading.value) {
      loadCorrelatedTraces();
    }
  },
  { immediate: true }
);

// Load dashboard when modal opens
// First load semantic groups (required for metric filter transformation), then load dashboard
watch(
  () => isOpen.value,
  async (newVal) => {
    if (newVal) {
      // Load semantic groups first (required for applyUnstableDimensionDefaults)
      // Note: pendingDimensions and activeDimensions are now managed by the props watcher below
      await loadSemanticGroups();

      // Re-apply defaults now that semantic groups are loaded
      // Check if there are ANY unstable dimensions (either in additionalDimensions OR matchedDimensions with _o2_all_)
      const hasAdditionalDims = Object.keys(props.additionalDimensions || {}).length > 0;
      const hasUnstableInMatched = Object.values(props.matchedDimensions || {}).some(v => v === SELECT_ALL_VALUE);
      if (semanticGroups.value.length > 0 && (hasAdditionalDims || hasUnstableInMatched)) {
        selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      }

      await loadDashboard();
      initialLoadCompleted.value = true;
    }
  },
  { immediate: true }
);

// Reload when selected metric streams change (only after initial load)
watch(
  selectedMetricStreams,
  (newStreams, oldStreams) => {
    // Skip if this is the initial load (already handled by isOpen watcher)
    if (!oldStreams || oldStreams.length === 0 || !initialLoadCompleted.value) {
      return;
    }

    // Check if streams actually changed (by name, not by filters)
    const changed = newStreams.length !== oldStreams.length ||
      newStreams.some((s, i) => s.stream_name !== oldStreams[i]?.stream_name);

    if (!changed) {
      return;
    }

    // Determine which streams were added vs removed
    const oldStreamNames = new Set(oldStreams.map(s => s.stream_name));
    const newStreamNames = new Set(newStreams.map(s => s.stream_name));

    const addedStreams = newStreams.filter(s => !oldStreamNames.has(s.stream_name));
    const removedStreams = oldStreams.filter(s => !newStreamNames.has(s.stream_name));

    if (isOpen.value && newStreams.length > 0) {
      if (removedStreams.length > 0) {
        // If streams were removed, we need full reload to remove panels
        dashboardData.value = null;
        nextTick(() => {
          loadDashboard();
        });
      } else if (addedStreams.length > 0) {
        // If only added, append new panels without regenerating existing ones
        addMetricPanels(addedStreams);
      }
    }
  },
  { deep: true }
);

// Re-apply unstable dimension defaults when additionalDimensions prop changes
// This handles the case where props are updated AFTER initial component mount
// Note: NOT immediate - only reacts to changes after initial load
watch(
  () => props.additionalDimensions,
  (newAdditionalDims, oldAdditionalDims) => {
    // Skip if this is the initial call (no old value) or initial load hasn't completed
    if (!oldAdditionalDims || !initialLoadCompleted.value) {
      return;
    }
    if (newAdditionalDims && Object.keys(newAdditionalDims).length > 0 && semanticGroups.value.length > 0) {
      // Update pendingDimensions with new unstable dimension values from current row
      pendingDimensions.value = {
        ...props.matchedDimensions,
        ...newAdditionalDims
      };

      selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      if (isOpen.value) {
        loadDashboard();
      }
    }
  }
);

// Re-apply unstable dimension defaults when matchedDimensions prop changes
// This handles the case where matchedDimensions contains _o2_all_ values for unstable dims
// Note: NOT immediate - only reacts to changes after initial load
watch(
  () => props.matchedDimensions,
  (newMatchedDims, oldMatchedDims) => {
    // Skip if this is the initial call (no old value) or initial load hasn't completed
    if (!oldMatchedDims || !initialLoadCompleted.value) {
      return;
    }

    // Update pendingDimensions with new matched dimension values from current row
    pendingDimensions.value = {
      ...newMatchedDims,
      ...(props.additionalDimensions || {})
    };

    const hasUnstableInMatched = Object.values(newMatchedDims || {}).some(v => v === SELECT_ALL_VALUE);
    if (hasUnstableInMatched && semanticGroups.value.length > 0) {
      selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      if (isOpen.value) {
        loadDashboard();
      }
    }
  }
);

// Watch all dimension props together to detect any changes
// This ensures filter dropdowns are always in sync with current row data
// Triggers when: component mounts, user switches rows, or props update
watch(
  () => ({
    matched: props.matchedDimensions,
    additional: props.additionalDimensions,
    service: props.serviceName
  }),
  (newProps, oldProps) => {
    // Always update dimensions when props change (including initial mount)
    // This handles: first open, reopen with different row, and navigation between rows
    const newDimensions = {
      ...(newProps.matched || {}),
      ...(newProps.additional || {})
    };

    // Only update if dimensions actually changed
    const dimensionsChanged =
      !oldProps ||
      JSON.stringify(newDimensions) !== JSON.stringify({
        ...(oldProps.matched || {}),
        ...(oldProps.additional || {})
      });

    if (dimensionsChanged) {
      pendingDimensions.value = { ...newDimensions };
      activeDimensions.value = { ...newDimensions };

      console.log('[TelemetryCorrelationDashboard] Updated dimensions from props:', newDimensions);
    }
  },
  { immediate: true, deep: true }
);
</script>

<style lang="scss" scoped>
.correlation-dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 90vw;
  max-width: 87.5rem;
  background: #ffffff !important;

  .correlation-header {
    flex-shrink: 0;
    background: #ffffff !important;
    z-index: 1;
  }

  .correlation-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #f5f5f5 !important;
  }
}

// Metric selector dialog
.metric-selector-dialog {
  min-width: 25rem;
  max-width: 31.25rem;
}

.metric-list-container {
  max-height: 25rem;
  overflow-y: auto;

  .metric-list-item {
    padding: 0.5rem 1rem;
    border-bottom: 0.0625rem solid var(--q-border-color, #e0e0e0);

    &:hover {
      background-color: var(--q-hover-color, rgba(0, 0, 0, 0.04));
    }

    .metric-label {
      font-size: 0.875rem;
      line-height: 1.25rem;
      font-family: monospace;
    }
  }
}

// Embedded mode styling
.correlation-dashboard-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #ffffff !important;

  .correlation-header {
    flex-shrink: 0;
    background: #ffffff !important;
    z-index: 1;
  }

  .correlation-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #f5f5f5 !important;
  }
}

// Dimension dropdown styling
.dimension-dropdown {
  :deep(.q-field__control) {
    min-height: 2rem;
    padding: 0 0.5rem;
  }

  :deep(.q-field__native) {
    font-size: 0.875rem;
    padding: 0.25rem 0;
  }

  :deep(.q-field__append) {
    padding-left: 0.25rem;
  }
}

// Trace header background - light mode
.trace-header-bg {
  background: #ffffff;
}

// Dark mode support
body.body--dark {
  .trace-header-bg {
    background: #1e1e1e;
  }
  .correlation-dashboard-embedded {
    background: #1e1e1e !important;

    .correlation-header {
      background: #1e1e1e !important;
    }

    .correlation-content {
      background: #2a2a2a !important;
    }
  }

  .correlation-dashboard-card {
    background: #1e1e1e !important;

    .correlation-header {
      background: #1e1e1e !important;
    }

    .correlation-content {
      background: #2a2a2a !important;
    }
  }

  .metric-list-item {
    border-bottom-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }
}
</style>
