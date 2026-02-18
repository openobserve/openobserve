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
  <div>
    <div
      class="flex justify-start items-center tw:px-3 tw:bg-[var(--o2-hover-accent)] tw:h-[2rem] tw:border tw:border-solid tw:border-t-[var(--o2-border-color)]"
      data-test="trace-details-sidebar-header"
    >
    <div
      :title="span.operation_name"
      :style="{ width: 'calc(100% - 24px)' }"
      class="q-pb-none ellipsis flex items-center"
      data-test="trace-details-sidebar-header-operation-name"
    >
      <!-- Observation Type Badge (for LLM spans) -->
      <q-badge
        v-if="isLLMSpan"
        :label="span._o2_llm_observation_type?.charAt(0) + span._o2_llm_observation_type?.slice(1).toLowerCase()"
        :color="getObservationTypeColor(span._o2_llm_observation_type)"
        class="q-mr-xs observation-type-badge"
        data-test="trace-details-sidebar-observation-badge"
      />

      <span class="ellipsis">{{ span.operation_name }}</span>
    </div>

    <q-btn
      dense
      icon="cancel"
      class="align-right no-border q-pa-xs"
      size="xs"
      @click="closeSidebar"
      data-test="trace-details-sidebar-header-close-btn"
    ></q-btn>
  </div>
  <div
    class="trace-details-toolbar-container"
    data-test="trace-details-sidebar-header-toolbar"
  >
    <!-- Row 1: Trace Details -->
    <div class="flex items-center justify-between q-pa-xs tw:gap-2" style="overflow-x: auto; flex-wrap: nowrap;">
      <div class="flex items-center tw:gap-2" style="flex-wrap: nowrap;">
        <!-- Service Badge -->
        <q-chip
          dense
          square
          class="toolbar-chip service-chip"
          :title="span.service_name"
          data-test="trace-details-sidebar-header-toolbar-service"
        >
          <q-icon name="cloud_queue" size="12px" class="q-mr-xs" />
          <span class="chip-label">Service</span>
          <span class="chip-value" data-test="trace-details-sidebar-header-toolbar-service-name">
            {{ span.service_name }}
          </span>
        </q-chip>

        <!-- Duration Badge -->
        <q-chip
          dense
          square
          class="toolbar-chip duration-chip"
          :title="getDuration"
          data-test="trace-details-sidebar-header-toolbar-duration"
        >
          <q-icon name="schedule" size="12px" class="q-mr-xs" />
          <span class="chip-label">Duration</span>
          <span class="chip-value">{{ getDuration }}</span>
        </q-chip>

        <!-- TTFT Badge -->
        <q-chip
          v-if="getTTFT"
          dense
          square
          class="toolbar-chip ttft-chip"
          :title="getTTFT"
          data-test="trace-details-sidebar-header-toolbar-ttft"
        >
          <q-icon name="speed" size="12px" class="q-mr-xs" />
          <span class="chip-label">TTFT</span>
          <span class="chip-value">{{ getTTFT }}</span>
        </q-chip>

        <!-- Start Time Badge -->
        <q-chip
          dense
          square
          class="toolbar-chip time-chip"
          :title="getStartTime"
          data-test="trace-details-sidebar-header-toolbar-start-time"
        >
          <q-icon name="access_time" size="12px" class="q-mr-xs" />
          <span class="chip-label">Start</span>
          <span class="chip-value">{{ getStartTime }}</span>
        </q-chip>
      </div>

      <div class="flex items-center tw:gap-2">
        <!-- Span ID Badge -->
        <q-chip
          dense
          square
          clickable
          class="toolbar-chip span-id-chip"
          :title="`Span ID: ${span.span_id}`"
          @click="copySpanId"
          data-test="trace-details-sidebar-header-toolbar-span-id"
        >
          <q-icon name="tag" size="12px" class="q-mr-xs" />
          <span class="chip-value">{{ span.span_id }}</span>
          <q-icon
            name="content_copy"
            size="10px"
            class="q-ml-xs copy-icon"
            data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"
          />
        </q-chip>

        <!-- View Logs Button -->
        <q-btn
          v-if="parentMode === 'standalone'"
          class="view-logs-btn o2-secondary-button"
          dense
          unelevated
          no-caps
          size="sm"
          :title="t('traces.viewLogs')"
          @click.stop="viewSpanLogs"
          data-test="trace-details-sidebar-header-toolbar-view-logs-btn"
        >
          View Logs
        </q-btn>
      </div>
    </div>

    <!-- Row 2: LLM Metrics (conditional) -->
    <div
      v-if="isLLMSpan && llmMetrics"
      class="flex items-center justify-between q-pa-xs tw:gap-2 llm-metrics-row"
      style="overflow-x: auto; flex-wrap: nowrap; border-top: 1px solid #e9ecef;"
    >
      <div class="flex items-center tw:gap-2" style="flex-wrap: nowrap;">
        <!-- Model Chip -->
        <q-chip
          dense
          square
          class="llm-chip model-chip"
          icon="psychology"
          :title="span._o2_llm_model_name"
        >
          <span class="chip-value text-bold">{{ span._o2_llm_model_name }}</span>
        </q-chip>

        <!-- Token Usage Group -->
        <div class="tokens-group">
          <!-- Input Tokens -->
          <q-chip
            dense
            square
            class="llm-chip token-chip input-token-chip"
            title="Input Tokens"
          >
            <q-icon name="arrow_upward" size="10px" class="q-mr-xs" />
            <span class="chip-label">In</span>
            <span class="chip-value">{{ llmMetrics.usage.input }}</span>
          </q-chip>

          <!-- Output Tokens -->
          <q-chip
            dense
            square
            class="llm-chip token-chip output-token-chip"
            title="Output Tokens"
          >
            <q-icon name="arrow_downward" size="10px" class="q-mr-xs" />
            <span class="chip-label">Out</span>
            <span class="chip-value">{{ llmMetrics.usage.output }}</span>
          </q-chip>
        </div>

        <!-- Cost Chip -->
        <q-chip
          dense
          square
          class="llm-chip cost-chip"
          icon="attach_money"
          title="Total Cost"
        >
          <span class="chip-value text-bold">${{ Number(llmMetrics.cost.total).toFixed(5) }}</span>
        </q-chip>
      </div>

      <div class="flex items-center tw:gap-2">
        <!-- Provider Badge -->
        <q-badge
          v-if="span._o2_llm_provider_name"
          :label="span._o2_llm_provider_name"
          class="provider-badge"
        />
      </div>
    </div>
  </div>

  <q-tabs
    v-model="activeTab"
    dense
    inline-label
    align="left"
    class="text-bold q-mx-sm span_details_tabs"
    data-test="trace-details-sidebar-tabs"
  >
    <!-- LLM Preview Tab (conditional - shown first for LLM traces) -->
    <q-tab
      v-if="isLLMSpan"
      name="preview"
      label="Preview"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-preview"
    />

    <q-tab
      name="tags"
      :label="t('common.tags')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-tags"
    />
    <q-tab
      name="process"
      :label="t('common.process')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-process"
    />
    <q-tab
      name="events"
      :label="t('common.events')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-events"
    />
    <q-tab
      name="exceptions"
      :label="t('common.exceptions')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-exceptions"
    />
    <q-tab
      name="links"
      :label="t('common.links')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-links"
    />
    <q-tab
      name="attributes"
      :label="t('common.attributes')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-attributes"
    />
    <!-- Correlation Tabs (only visible when service streams enabled and enterprise license) -->
    <q-tab
      v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
      name="correlated-logs"
      :label="t('correlation.correlatedLogs')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-correlated-logs"
    />
    <q-tab
      v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
      name="correlated-metrics"
      :label="t('correlation.correlatedMetrics')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-correlated-metrics"
    />
  </q-tabs>
  <q-separator style="width: 100%" />
  <q-tab-panels
    v-model="activeTab"
    class="span_details_tab-panels"
  >
    <!-- LLM Preview Tab Panel -->
    <q-tab-panel v-if="isLLMSpan" name="preview" class="llm-preview-panel q-pa-md">
      <div class="llm-preview-container">
        <!-- Input and Output Side by Side -->
        <div class="flex q-col-gutter-md io-container" :class="{ 'io-container-dark': isDarkMode }" ref="ioContainerRef">
          <!-- Input Section -->
          <div class="col-6 io-section">
            <div class="section-label text-bold q-mb-xs flex items-center justify-between">
              <div>Input</div>
              <div class="flex items-center gap-xs">
                <q-btn
                  outline
                  class="q-px-sm q-ml-sm"
                  size="sm"
                  no-caps
                  :icon="isFullscreen ? 'fullscreen_exit' : 'fullscreen'"
                  :title="isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'"
                  @click="toggleFullscreen"
                />
                <q-btn
                  flat
                  dense
                  size="sm"
                  icon="content_copy"
                  title="Copy input"
                  @click="copyContent(span._o2_llm_input, 'input')"
                  :disable="!hasContent(span._o2_llm_input)"
                />
              </div>
            </div>
            <div class="llm-content-box">
              <div v-if="!hasContent(span._o2_llm_input)" class="no-data-message">
                No data available
              </div>
              <LLMContentRenderer
                v-else
                :content="span._o2_llm_input"
                :observation-type="span._o2_llm_observation_type"
                content-type="input"
                :span="span"
                view-mode="formatted"
              />
            </div>
          </div>

          <!-- Output Section -->
          <div class="col-6 io-section">
            <div class="section-label text-bold q-mb-xs flex items-center justify-between">
              <div>Output</div>
              <div class="flex items-center gap-xs">
                <q-btn
                  outline
                  class="q-px-sm q-ml-sm"
                  size="sm"
                  no-caps
                  :icon="isFullscreen ? 'fullscreen_exit' : 'fullscreen'"
                  :title="isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'"
                  @click="toggleFullscreen"
                />
                <q-btn
                  flat
                  dense
                  size="sm"
                  icon="content_copy"
                  title="Copy output"
                  @click="copyContent(span._o2_llm_output, 'output')"
                  :disable="!hasContent(span._o2_llm_output)"
                />
              </div>
            </div>
            <div class="llm-content-box">
              <div v-if="!hasContent(span._o2_llm_output)" class="no-data-message">
                No data available
              </div>
              <LLMContentRenderer
                v-else
                :content="span._o2_llm_output"
                :observation-type="span._o2_llm_observation_type"
                content-type="output"
                :span="span"
                view-mode="formatted"
              />
            </div>
          </div>
        </div>

        <!-- Model Parameters (collapsible) -->
        <q-expansion-item
          v-if="span._o2_llm_model_parameters"
          label="Model Parameters"
          class="q-mt-md"
        >
          <pre class="model-params-json q-pa-sm">{{ formatModelParams(span._o2_llm_model_parameters) }}</pre>
        </q-expansion-item>
      </div>
    </q-tab-panel>

    <q-tab-panel name="tags">
      <q-table
        ref="qTable"
        data-test="schema-log-stream-field-mapping-table"
        :rows="getTagRows"
        :columns="tagColumns"
        :row-key="(row) => 'tr_' + row.name"
        :rows-per-page-options="[0]"
        class="q-table trace-detail-tab-table o2-quasar-table o2-row-md o2-schema-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        id="schemaFieldList"
        dense
      >
        <template v-slot:body-cell="props">
          <q-td
            class="text-left tw:text-[0.85rem]! cell-with-max-height"
            :class="
              props.col.name === 'field' ? 'tw:text-[var(--o2-json-key)]' : ''
            "
          >
            <div class="cell-content">
              <span
                v-if="props.col.name === 'value'"
                v-html="
                  highlightTextMatch(props.row[props.col.name], searchQuery)
                "
              />
              <span v-else>
                {{ props.row[props.col.name] }}
              </span>
            </div>
          </q-td>
        </template>
      </q-table>
    </q-tab-panel>
    <q-tab-panel name="process">
      <q-table
        ref="qTable"
        data-test="trace-details-sidebar-process-table"
        :rows="getProcessRows"
        :columns="processColumns"
        :row-key="(row) => 'tr_' + row.name"
        :rows-per-page-options="[0]"
        class="q-table o2-quasar-table trace-detail-tab-table o2-row-md o2-schema-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        dense
      >
        <template v-slot:body-cell="props">
          <q-td
            class="text-left tw:text-[0.85rem]! cell-with-max-height"
            :class="
              props.col.name === 'field' ? 'tw:text-[var(--o2-json-key)]' : ''
            "
          >
            <div class="cell-content">
              <span
                v-if="props.col.name === 'value'"
                v-html="
                  highlightTextMatch(props.row[props.col.name], searchQuery)
                "
              />
              <span v-else>
                {{ props.row[props.col.name] }}
              </span>
            </div>
          </q-td>
        </template>
      </q-table>
    </q-tab-panel>
    <q-tab-panel name="attributes">
      <pre
        class="attr-text tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        v-html="highlightedAttributes"
        data-test="trace-details-sidebar-attributes-table"
      ></pre>
    </q-tab-panel>
    <q-tab-panel name="events">
      <q-table
        v-if="spanDetails.events.length"
        ref="qTable"
        data-test="trace-details-sidebar-events-table"
        :rows="spanDetails.events"
        :columns="eventColumns"
        row-key="name"
        :rows-per-page-options="[0]"
        class="q-table o2-quasar-table trace-detail-tab-table o2-row-md o2-schema-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        dense
      >
        <template v-slot:body="props">
          <q-tr
            :data-test="`trace-event-details-${
              props.row[store.state.zoConfig.timestamp_column]
            }`"
            :key="props.key"
            @click="expandEvent(props.rowIndex)"
            style="cursor: pointer"
            class="pointer"
          >
            <q-td
              v-for="(column, columnIndex) in eventColumns"
              :key="props.rowIndex + '-' + column.name"
              class="field_list text-left"
              style="cursor: pointer"
              :style="
                columnIndex > 0
                  ? { whiteSpace: 'normal', wordBreak: 'break-word' }
                  : {}
              "
            >
              <div class="flex row items-center no-wrap">
                <q-btn
                  v-if="column.name === '@timestamp'"
                  :icon="
                    expandedEvents[props.rowIndex.toString()]
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  @click.stop="expandEvent(props.rowIndex)"
                ></q-btn>
                <span
                  v-if="column.name !== '@timestamp'"
                  v-html="
                    highlightTextMatch(column.prop(props.row), searchQuery)
                  "
                />
                <span v-else> {{ column.prop(props.row) }}</span>
              </div>
            </q-td>
          </q-tr>
          <q-tr v-if="expandedEvents[props.rowIndex.toString()]">
            <q-td colspan="2">
              <pre
                class="log_json_content"
                v-html="highlightedJSON(props.row)"
              />
            </q-td>
          </q-tr>
        </template>
      </q-table>
      <div
        v-else
        class="full-width text-center tw:flex tw:items-center tw:justify-center q-pt-lg text-bold tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        data-test="trace-details-sidebar-no-events"
      >
        No events present for this span
      </div>
    </q-tab-panel>
    <q-tab-panel name="exceptions">
      <q-table
        v-if="getExceptionEvents.length"
        ref="qTable"
        data-test="trace-details-sidebar-exceptions-table"
        :rows="getExceptionEvents"
        :columns="exceptionEventColumns"
        row-key="name"
        :rows-per-page-options="[0]"
        class="q-table o2-quasar-table  trace-detail-tab-table o2-row-md o2-schema-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        dense
      >
        <template v-slot:body="props">
          <q-tr
            :data-test="`trace-event-detail-${
              props.row[store.state.zoConfig.timestamp_column]
            }`"
            :key="props.key"
            @click="expandEvent(props.rowIndex)"
            style="cursor: pointer"
            class="pointer"
          >
            <q-td
              v-for="column in exceptionEventColumns"
              :key="props.rowIndex + '-' + column.name"
              class="field_list text-left"
              style="cursor: pointer"
            >
              <div class="flex row items-center no-wrap">
                <q-btn
                  v-if="column.name === '@timestamp'"
                  :icon="
                    expandedEvents[props.rowIndex.toString()]
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  @click.stop="expandEvent(props.rowIndex)"
                  :data-test="`trace-details-sidebar-exceptions-table-expand-btn-${props.rowIndex}`"
                ></q-btn>
                <span
                  v-if="column.name !== '@timestamp'"
                  v-html="
                    highlightTextMatch(column.prop(props.row), searchQuery)
                  "
                />
                <span v-else> {{ column.prop(props.row) }}</span>
              </div>
            </q-td>
          </q-tr>
          <q-tr
            v-if="expandedEvents[props.rowIndex.toString()]"
            :data-test="`trace-details-sidebar-exceptions-table-expanded-row-${props.rowIndex}`"
          >
            <q-td colspan="2" style="font-size: 12px; font-family: monospace">
              <div class="q-pl-sm">
                <div>
                  <span>Type: </span>
                  <span>"{{ props.row["exception.type"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Message: </span>
                  <span>"{{ props.row["exception.message"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Escaped: </span>
                  <span>"{{ props.row["exception.escaped"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Stacktrace: </span>
                  <div
                    class="q-px-sm q-mt-xs"
                    style="border: 1px solid #c1c1c1; border-radius: 4px"
                  >
                    <pre
                      style="font-size: 12px; text-wrap: wrap"
                      class="q-mt-xs"
                      >{{
                        formatStackTrace(props.row["exception.stacktrace"])
                      }}</pre
                    >
                  </div>
                </div>
              </div>
            </q-td>
          </q-tr>
        </template>
      </q-table>
      <div
        v-else
        class="full-width tw:flex tw:items-center tw:justify-center text-center q-pt-lg text-bold tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        data-test="trace-details-sidebar-no-exceptions"
      >
        No exceptions present for this span
      </div>
    </q-tab-panel>

    <q-tab-panel name="links">
      <div v-if="spanLinks.length">
        <q-virtual-scroll
          type="table"
          ref="searchTableRef"
          style="max-height: 20rem"
          :items="spanLinks"
          class="tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
          data-test="trace-details-sidebar-links-table"
        >
          <template v-slot:before>
            <thead
              class="thead-sticky text-left tw:bg-[var(--o2-hover-accent)] o2-quasar-table"
            >
              <tr>
                <th
                  v-for="(col, index) in linkColumns"
                  :key="'result_' + index"
                  class="table-header"
                  :data-test="`trace-events-table-th-${col.label}`"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
          </template>

          <template v-slot="{ item: row, index }">
            <tr
              :data-test="`trace-event-detail-link-${index}`"
              :key="'expand_' + index"
              @click="openReferenceTrace('span', row)"
              style="cursor: pointer"
              class="pointer"
            >
              <td
                v-for="column in linkColumns"
                :key="index + '-' + column.name"
                class="field_list"
                style="cursor: pointer"
              >
                <div class="flex row items-center no-wrap">
                  {{ column.prop(row) }}
                </div>
              </td>
            </tr>
          </template>
        </q-virtual-scroll>
      </div>
      <div
        v-else
        class="full-width tw:flex tw:items-center tw:justify-center text-center q-pt-lg text-bold tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
        data-test="trace-details-sidebar-no-links"
      >
        No links present for this span
      </div>
    </q-tab-panel>

    <!-- Correlated Logs Tab Panel -->
    <q-tab-panel name="correlated-logs" class="q-pa-none full-height">
      <CorrelatedLogsTable
        v-if="correlationProps"
        :service-name="correlationProps.serviceName"
        :matched-dimensions="correlationProps.matchedDimensions"
        :additional-dimensions="correlationProps.additionalDimensions"
        :log-streams="correlationProps.logStreams"
        :source-stream="correlationProps.sourceStream"
        :source-type="correlationProps.sourceType"
        :available-dimensions="correlationProps.availableDimensions"
        :fts-fields="correlationProps.ftsFields"
        :time-range="correlationProps.timeRange"
        :hide-view-related-button="true"
        :hide-search-term-actions="false"
        :hide-dimension-filters="true"
        :hide-reset-filters-button="true"
      />
      <!-- Loading/Empty state when no data -->
      <div
        v-else
        class="tw:flex tw:items-center tw:justify-center tw:py-20 tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
      >
        <div class="tw:text-center">
          <q-spinner-hourglass
            v-if="correlationLoading"
            color="primary"
            size="3rem"
            class="tw:mb-4"
          />
          <div
            v-else-if="correlationError"
            class="tw:text-base tw:text-red-500"
          >
            {{ correlationError }}
          </div>
          <div v-else class="tw:text-base tw:text-gray-500">
            {{ t("correlation.clickToLoadLogs") }}
          </div>
        </div>
      </div>
    </q-tab-panel>

    <!-- Correlated Metrics Tab Panel -->
    <q-tab-panel name="correlated-metrics" class="q-pa-none full-height">
      <TelemetryCorrelationDashboard
        v-if="correlationProps"
        mode="embedded-tabs"
        external-active-tab="metrics"
        :service-name="correlationProps.serviceName"
        :matched-dimensions="correlationProps.matchedDimensions"
        :additional-dimensions="correlationProps.additionalDimensions"
        :metric-streams="correlationProps.metricStreams"
        :log-streams="correlationProps.logStreams"
        :trace-streams="correlationProps.traceStreams"
        :source-stream="correlationProps.sourceStream"
        :source-type="correlationProps.sourceType"
        :available-dimensions="correlationProps.availableDimensions"
        :fts-fields="correlationProps.ftsFields"
        :time-range="correlationProps.timeRange"
        :hide-dimension-filters="true"
        @close="activeTab = 'tags'"
      />
      <!-- Loading/Empty state when no data -->
      <div
        v-else
        class="tw:flex tw:items-center tw:justify-center tw:py-20 tab-content-dynamic-height"
        :class="isLLMSpan && llmMetrics ? 'tab-content-with-llm-metrics' : 'tab-content-without-llm-metrics'"
      >
        <div class="tw:text-center">
          <q-spinner-hourglass
            v-if="correlationLoading"
            color="primary"
            size="3rem"
            class="tw:mb-4"
          />
          <div
            v-else-if="correlationError"
            class="tw:text-base tw:text-red-500"
          >
            {{ correlationError }}
          </div>
          <div v-else class="tw:text-base tw:text-gray-500">
            {{ t("correlation.clickToLoadMetrics") }}
          </div>
        </div>
      </div>
    </q-tab-panel>
  </q-tab-panels>
  </div>
</template>

<script lang="ts">
import { cloneDeep } from "lodash-es";
import { date, useQuasar, type QTableProps, copyToClipboard } from "quasar";
import { defineComponent, onBeforeMount, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import { formatTimeWithSuffix, convertTimeFromNsToUs } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import { useRouter } from "vue-router";
import { onMounted, onUnmounted, defineAsyncComponent, nextTick } from "vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import CorrelatedLogsTable from "@/plugins/correlation/CorrelatedLogsTable.vue";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";
import config from "@/aws-exports";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import {
  isLLMTrace,
  parseUsageDetails,
  parseCostDetails,
  getObservationTypeColor,
  formatModelParameters,
} from "@/utils/llmUtils";

export default defineComponent({
  name: "TraceDetailsSidebar",
  props: {
    span: {
      type: Object,
      default: () => null,
    },
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    searchQuery: {
      type: String,
      default: "",
    },
    streamName: {
      type: String,
      default: "",
    },
    serviceStreamsEnabled: {
      type: Boolean,
      default: false,
    },
    parentMode: {
      type: String,
      default: "standalone",
    },
  },
  components: {
    LogsHighLighting,
    LLMContentRenderer,
    CorrelatedLogsTable,
    TelemetryCorrelationDashboard: defineAsyncComponent(
      () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
    ),
  },
  emits: [
    "close",
    "view-logs",
    "select-span",
    "open-trace",
    "show-correlation",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    // Check if this is an LLM span to set default tab
    const isLLMSpan = computed(() => isLLMTrace(props.span));
    const activeTab = ref(isLLMSpan.value ? "preview" : "tags");
    const tags: Ref<{ [key: string]: string }> = ref({});
    const processes: Ref<{ [key: string]: string }> = ref({});

    // Ref for fullscreen container (parent container with both Input and Output)
    const ioContainerRef = ref<HTMLElement | null>(null);

    // Track fullscreen state
    const isFullscreen = ref(false);

    const closeSidebar = () => {
      emit("close");
    };
    const spanDetails: any = ref({
      attrs: {},
      events: [],
    });
    const pagination: any = ref({
      rowsPerPage: 0,
    });
    const q = useQuasar();
    const { buildQueryDetails, navigateToLogs } = useTraces();
    const router = useRouter();

    // JSON syntax highlighting colors - using CSS variables for theme-aware colors
    const themeColors = {
      key: "var(--o2-json-key)",
      stringValue: "var(--o2-json-string)",
      numberValue: "var(--o2-json-number)",
      booleanValue: "var(--o2-json-boolean)",
      nullValue: "var(--o2-json-null)",
      objectValue: "var(--o2-json-object)",
    };

    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const highlightTextMatch = (text: string, query: string): string => {
      if (!query) return escapeHtml(text);
      try {
        // Escape special regex characters
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escapedQuery})`, "gi");
        return escapeHtml(text).replace(
          regex,
          (match) => `<span class="highlight">${match}</span>`,
        );
      } catch (e) {
        return escapeHtml(text);
      }
    };

    const highlightedJSON = (value) => {
      const colors = themeColors;
      const attrs = value;
      const query = props.searchQuery;

      const formatValue = (value: any): string => {
        if (value === null) {
          return `<span style="color: ${colors.nullValue};">${highlightTextMatch("null", query)}</span>`;
        } else if (typeof value === "boolean") {
          return `<span style="color: ${colors.booleanValue};">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "number") {
          return `<span style="color: ${colors.numberValue};">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "string") {
          return `<span style="color: ${colors.stringValue};">"${highlightTextMatch(value, query)}"</span>`;
        } else if (typeof value === "object") {
          return `<span style="color: ${colors.objectValue};">"${highlightTextMatch(JSON.stringify(value), query)}"</span>`;
        }
        return highlightTextMatch(String(value), query);
      };

      const lines: string[] = [];
      lines.push('<span style="color: #9ca3af;">{</span>');

      const entries = Object.entries(attrs);
      entries.forEach(([key, value], index) => {
        const keyHtml = `<span style="color: ${colors.key};">"${escapeHtml(key)}"</span>`;
        const valueHtml = formatValue(value);
        const comma =
          index < entries.length - 1
            ? '<span style="color: #9ca3af;">,</span>'
            : "";
        lines.push(
          `  ${keyHtml}<span style="color: #9ca3af;">:</span> ${valueHtml}${comma}`,
        );
      });

      lines.push('<span style="color: #9ca3af;">}</span>');
      return lines.join("\n");
    };

    const highlightedAttributes = computed(() => {
      const colors = themeColors;
      const attrs = spanDetails.value.attrs;
      // remove llm input and output
      delete attrs._o2_llm_input;
      delete attrs._o2_llm_output;
      const query = props.searchQuery;

      const formatValue = (value: any): string => {
        if (value === null) {
          return `<span style="color: ${colors.nullValue};">${highlightTextMatch("null", query)}</span>`;
        } else if (typeof value === "boolean") {
          return `<span style="color: ${colors.booleanValue};">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "number") {
          return `<span style="color: ${colors.numberValue};">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "string") {
          return `<span style="color: ${colors.stringValue};">"${highlightTextMatch(value, query)}"</span>`;
        } else if (typeof value === "object") {
          return `<span style="color: ${colors.objectValue};">"${highlightTextMatch(JSON.stringify(value), query)}"</span>`;
        }
        return highlightTextMatch(String(value), query);
      };

      const lines: string[] = [];
      lines.push('<span style="color: #9ca3af;">{</span>');

      const entries = Object.entries(attrs);
      entries.forEach(([key, value], index) => {
        const keyHtml = `<span style="color: ${colors.key};">"${escapeHtml(key)}"</span>`;
        const valueHtml = formatValue(value);
        const comma =
          index < entries.length - 1
            ? '<span style="color: #9ca3af;">,</span>'
            : "";
        lines.push(
          `  ${keyHtml}<span style="color: #9ca3af;">:</span> ${valueHtml}${comma}`,
        );
      });

      lines.push('<span style="color: #9ca3af;">}</span>');
      return lines.join("\n");
    });

    watch(
      () => props.span,
      () => {
        tags.value = {};
        processes.value = {};
        spanDetails.value = getFormattedSpanDetails();
      },
      {
        deep: true,
      },
    );

    const tagColumns = [
      {
        name: "field",
        label: "Field",
        field: "field",
        align: "left" as const,
        headerClasses: "tw:text-left!",
      },
      {
        name: "value",
        label: "Value",
        field: "value",
        align: "left" as const,
        headerClasses: "tw:text-left!",
      },
    ];

    const getTagRows = computed(() => {
      return Object.entries(tags.value).map(([key, value]) => ({
        field: key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
    });

    const processColumns = [
      {
        name: "field",
        label: "Field",
        field: "field",
        align: "left" as const,
        headerClasses: "tw:text-left!",
      },
      {
        name: "value",
        label: "Value",
        field: "value",
        align: "left" as const,
        headerClasses: "tw:text-left!",
      },
    ];

    const getProcessRows = computed(() => {
      return Object.entries(processes.value).map(([key, value]) => ({
        field: key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
    });

    const getDuration = computed(() =>
      formatTimeWithSuffix(props.span.duration),
    );

    const getTTFT = computed(() => {
      // Only calculate for LLM spans with completion_start_time
      if (!props.span._o2_llm_completion_start_time || !props.span.start_time) {
        return null;
      }
      // completion_start_time is in microseconds
      // start_time is in nanoseconds, convert to microseconds
      const completionStartTime = props.span._o2_llm_completion_start_time;
      const spanStartTimeUs = props.span.start_time / 1000;
      const ttftUs = completionStartTime - spanStartTimeUs;
      return formatTimeWithSuffix(ttftUs);
    });

    onBeforeMount(() => {
      spanDetails.value = getFormattedSpanDetails();
    });

    const store = useStore();

    // Get current theme from store
    const isDarkMode = computed(() => store.state.theme === "dark");

    const expandedEvents: any = ref({});
    const eventColumns = ref([
      {
        name: "@timestamp",
        field: "@timestamp",
        prop: (row: any) =>
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000000),
            "MMM DD, YYYY HH:mm:ss.SSS Z",
          ),
        label: "Timestamp",
        align: "left" as const,
        sortable: true,
      },
      {
        name: "source",
        field: "source",
        prop: (row: any) => JSON.stringify(row),
        label: "source",
        align: "left" as const,
        sortable: true,
      },
    ]);

    const exceptionEventColumns = ref([
      {
        name: "@timestamp",
        field: "@timestamp",
        prop: (row: any) =>
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000000),
            "MMM DD, YYYY HH:mm:ss.SSS Z",
          ),
        label: "Timestamp",
        align: "left" as const,
        sortable: true,
      },
      {
        name: "type",
        field: "exception.type",
        prop: (row: any) => row["exception.type"],
        label: "Type",
        align: "left" as const,
        sortable: true,
      },
    ]);

    const linkColumns = ref([
      {
        name: "traceId",
        prop: (row: any) => (row.context ? row?.context?.traceId : ""),
        label: "TraceId",
        align: "left",
        sortable: true,
      },
      {
        name: "spanId",
        prop: (row: any) => (row.context ? row?.context?.spanId : ""),
        label: "spanId",
        align: "left",
        sortable: true,
      },
    ]);

    const getExceptionEvents = computed(() => {
      return spanDetails.value.events.filter(
        (event: any) => event.name === "exception",
      );
    });

    const expandEvent = (index: number) => {
      if (expandedEvents.value[index.toString()])
        delete expandedEvents.value[index.toString()];
      else expandedEvents.value[index.toString()] = true;
    };

    const getSpanKind = (id: number) => {
      const spanKindMapping: { [key: number]: string } = {
        1: "Server",
        2: "Client",
        3: "Producer",
        4: "Consumer",
        5: "Internal",
      };
      return spanKindMapping[id] || id;
    };

    const getFormattedSpanDetails = () => {
      const spanDetails: { attrs: any; events: any[] } = {
        attrs: {},
        events: [],
      };

      spanDetails.attrs = cloneDeep(props.span);

      if (spanDetails.attrs.events) delete spanDetails.attrs.events;

      spanDetails.attrs.duration = spanDetails.attrs.duration + "us";
      spanDetails.attrs[store.state.zoConfig.timestamp_column] =
        date.formatDate(
          Math.floor(
            spanDetails.attrs[store.state.zoConfig.timestamp_column] / 1000,
          ),
          "MMM DD, YYYY HH:mm:ss.SSS Z",
        );
      spanDetails.attrs.span_kind = getSpanKind(spanDetails.attrs.span_kind);

      try {
        spanDetails.events = JSON.parse(props.span.events || "[]").map(
          (event: any) => event,
        );
      } catch (_e: any) {
        console.log(_e);
        spanDetails.events = [];
      }

      return spanDetails;
    };

    const span_details = new Set([
      "span_id",
      "trace_id",
      "operation_name",
      store.state.zoConfig.timestamp_column,
      "start_time",
      "end_time",
      "duration",
      "busy_ns",
      "idle_ns",
      "events",
    ]);

    watch(
      () => props.span,
      () => {
        tags.value = {};
        processes.value = {};
        Object.keys(props.span).forEach((key: string) => {
          if (!span_details.has(key)) {
            tags.value[key] = props.span[key];
          }
        });

        processes.value["service_name"] = props.span["service_name"];
        processes.value["service_service_instance"] =
          props.span["service_service_instance"];
        processes.value["service_service_version"] =
          props.span["service_service_version"];
      },
      {
        deep: true,
        immediate: true,
      },
    );
    function formatStackTrace(trace: any) {
      // Split the trace into lines
      const lines = trace.split("\n");

      // Process each line
      const formattedLines = lines.map((line: string) => {
        // Apply formatting rules
        // For example, indent lines that contain file paths
        if (line.trim().startsWith("/")) {
          return "" + line; // Indent the line
        }
        return line;
      });

      // Reassemble the formatted trace
      return formattedLines.join("\n");
    }

    const viewSpanLogs = () => {
      const queryDetails = buildQueryDetails(props.span);
      navigateToLogs(queryDetails);
    };

    const getStartTime = computed(() => {
      return formatTimeWithSuffix(
        convertTimeFromNsToUs(props.span.start_time) -
          (props.baseTracePosition?.startTimeUs || 0),
      );
    });

    const copySpanId = () => {
      copyToClipboard(props.span?.span_id || "");

      q?.notify?.({
        type: "positive",
        message: "Span ID copied to clipboard",
        timeout: 2000,
      });
    };

    const openReferenceTrace = (type: string, link: any) => {
      if (link && link.context) {
        const query = {
          stream: router.currentRoute.value.query.stream,
          trace_id: link.context.traceId,
          span_id: link.context.spanId,
          from: convertTimeFromNsToUs(props.span.start_time) - 3600000000,
          to: convertTimeFromNsToUs(props.span.end_time) + 3600000000,
          org_identifier: store.state.selectedOrganization.identifier,
        };

        if (query.trace_id === props.span.trace_id) {
          emit("select-span", link.context.spanId);
          return;
        }

        router.push({
          name: "traceDetails",
          query,
        });

        emit("open-trace");
      }
    };

    const spanLinks = computed(() => {
      try {
        const parsedLinks =
          typeof props.span.links === "string"
            ? JSON.parse(props.span.links)
            : props.span.links;

        return parsedLinks || [];
      } catch (e) {
        console.log("Error parsing span links:", e);
        // Return sample data even on error for testing
        return [];
      }
    });

    // Correlation state
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationProps = ref<any>(null);
    const { findRelatedTelemetry } = useServiceCorrelation();

    /**
     * Extract dimensions from span attributes for correlation
     * Maps trace span attributes to semantic dimension names
     */
    const extractSpanDimensions = (span: any): Record<string, string> => {
      const dimensions: Record<string, string> = {};

      // Direct service name
      if (span.service_name) {
        dimensions["service-name"] = span.service_name;
      }

      // Common trace attributes that map to dimensions
      const attributeMappings: Record<string, string> = {
        // Kubernetes attributes
        k8s_namespace_name: "k8s-namespace",
        "k8s.namespace.name": "k8s-namespace",
        k8s_deployment_name: "k8s-deployment",
        "k8s.deployment.name": "k8s-deployment",
        k8s_pod_name: "k8s-pod",
        "k8s.pod.name": "k8s-pod",
        k8s_container_name: "k8s-container",
        "k8s.container.name": "k8s-container",
        k8s_statefulset_name: "k8s-statefulset",
        "k8s.statefulset.name": "k8s-statefulset",
        k8s_daemonset_name: "k8s-daemonset",
        "k8s.daemonset.name": "k8s-daemonset",
        k8s_replicaset_name: "k8s-replicaset",
        "k8s.replicaset.name": "k8s-replicaset",
        k8s_job_name: "k8s-job",
        "k8s.job.name": "k8s-job",
        k8s_cronjob_name: "k8s-cronjob",
        "k8s.cronjob.name": "k8s-cronjob",
        k8s_node_name: "k8s-node",
        "k8s.node.name": "k8s-node",
        k8s_cluster_name: "k8s-cluster",
        "k8s.cluster.name": "k8s-cluster",
        // Host attributes
        host_name: "host-name",
        "host.name": "host-name",
        // Cloud attributes
        cloud_region: "cloud-region",
        "cloud.region": "cloud-region",
        cloud_availability_zone: "cloud-availability-zone",
        "cloud.availability_zone": "cloud-availability-zone",
        // Container attributes
        container_name: "container-name",
        "container.name": "container-name",
        container_id: "container-id",
        "container.id": "container-id",
      };

      // Check all span attributes
      for (const [attrName, dimName] of Object.entries(attributeMappings)) {
        if (span[attrName] && !dimensions[dimName]) {
          dimensions[dimName] = String(span[attrName]);
        }
      }

      return dimensions;
    };

    /**
     * Load correlation data for this span (called when user clicks on correlation tabs)
     */
    const loadCorrelation = async () => {
      // Skip if already loaded or loading
      if (correlationProps.value || correlationLoading.value) {
        return;
      }

      // Gate correlation feature behind enterprise check to avoid 403 errors
      if (config.isEnterprise !== "true") {
        correlationError.value =
          "Correlation feature requires enterprise license";
        return;
      }

      if (!props.span || !props.streamName) {
        console.warn(
          "[TraceDetailsSidebar] Cannot load correlation: missing span or stream name",
        );
        correlationError.value = "Missing span or stream name";
        return;
      }

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        // Build telemetry context from span
        const context: TelemetryContext = {
          timestamp: convertTimeFromNsToUs(props.span.start_time) * 1000, // Convert to nanoseconds
          fields: { ...props.span },
          streamName: props.streamName,
        };

        // Extract dimensions from span attributes
        const spanDimensions = extractSpanDimensions(props.span);
        // Merge span dimensions into context fields for semantic extraction
        Object.assign(context.fields, spanDimensions);

        console.log("[TraceDetailsSidebar] Correlation context:", {
          streamName: props.streamName,
          serviceName: props.span.service_name,
          dimensions: spanDimensions,
        });

        // Find related telemetry
        const result = await findRelatedTelemetry(
          context,
          "traces",
          5, // 5 minute time window
          props.streamName,
        );

        if (result && result.correlationData) {
          const correlationData = result.correlationData;

          // Calculate time range (span start/end with buffer)
          const spanStartUs = convertTimeFromNsToUs(props.span.start_time);
          const spanEndUs = convertTimeFromNsToUs(props.span.end_time);
          const bufferUs = 5 * 60 * 1000000; // 5 minutes buffer

          // Build availableDimensions from raw span attributes (actual field names)
          // This is critical for log queries to use the correct field names (e.g., k8s_pod_name)
          // Filter to only include string values that are correlation-relevant
          const rawSpanDimensions: Record<string, string> = {};
          for (const [key, value] of Object.entries(props.span)) {
            if (typeof value !== "string" || !value) continue;
            if (key.startsWith("_")) continue; // Skip internal fields

            // Include known correlation-relevant dimensions
            const isRelevant =
              key.startsWith("k8s_") ||
              key.startsWith("k8s.") ||
              key.startsWith("host") ||
              key.startsWith("container") ||
              key.startsWith("pod") ||
              key.startsWith("namespace") ||
              key.startsWith("deployment") ||
              key.startsWith("service") ||
              key.startsWith("node") ||
              key.startsWith("os_") ||
              key === "version" ||
              key === "region" ||
              key === "cluster" ||
              key === "environment" ||
              key === "env";

            if (isRelevant) {
              rawSpanDimensions[key] = value;
            }
          }

          // Use filters from logStreams[0] as matchedDimensions — these contain
          // the correct field names for the log stream (e.g., k8s_namespace_name)
          // instead of semantic IDs (k8s-namespace) or trace field names
          // (service_k8s_namespace_name). Same fix as 9127b6172 for incidents.
          const logFilters =
            correlationData.related_streams.logs?.[0]?.filters || {};
          const actualMatchedDimensions =
            Object.keys(logFilters).length > 0
              ? logFilters
              : correlationData.matched_dimensions;

          correlationProps.value = {
            serviceName: correlationData.service_name,
            matchedDimensions: actualMatchedDimensions,
            additionalDimensions: {},
            metricStreams: correlationData.related_streams.metrics,
            logStreams: correlationData.related_streams.logs,
            traceStreams: correlationData.related_streams.traces,
            sourceStream: props.streamName,
            sourceType: "traces",
            // Use log stream filters and log record as availableDimensions for field name resolution and traceId extraction
            availableDimensions: { ...logFilters, ...context.fields },
            ftsFields: [],
            timeRange: {
              startTime: spanStartUs - bufferUs,
              endTime: spanEndUs + bufferUs,
            },
          };
        } else {
          correlationError.value =
            "No related services found for this trace span";
        }
      } catch (err: any) {
        console.error("[TraceDetailsSidebar] Correlation failed:", err);
        correlationError.value =
          err.message || "Failed to load correlation data";
      } finally {
        correlationLoading.value = false;
      }
    };

    // Clear correlation when span changes
    watch(
      () => props.span,
      () => {
        correlationProps.value = null;
        correlationError.value = null;

        // If we're already on a correlation tab, reload the data for the new span
        if (
          activeTab.value === "correlated-logs" ||
          activeTab.value === "correlated-metrics"
        ) {
          loadCorrelation();
        }
      },
      { deep: true },
    );

    // Load correlation data when user clicks on correlation tabs
    watch(activeTab, (newTab) => {
      if (newTab === "correlated-logs" || newTab === "correlated-metrics") {
        loadCorrelation();
      }
    });

    // LLM-related computed properties
    const llmMetrics = computed(() => {
      if (!isLLMSpan.value) return null;
      const usage = parseUsageDetails(props.span);
      const cost = parseCostDetails(props.span);
      return {
        usage: usage,
        cost: cost,
      };
    });

    // Copy LLM content to clipboard
    const copyContent = (content: any, type: 'input' | 'output') => {
      try {
        // Convert content to string
        let textToCopy = '';
        if (typeof content === 'string') {
          textToCopy = content;
        } else if (content) {
          // Pretty-print JSON objects/arrays
          textToCopy = JSON.stringify(content, null, 2);
        }

        // Copy to clipboard
        copyToClipboard(textToCopy)
          .then(() => {
            q.notify({
              type: 'positive',
              message: `${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard`,
              position: 'top',
              timeout: 2000,
            });
          })
          .catch(() => {
            q.notify({
              type: 'negative',
              message: 'Failed to copy to clipboard',
              position: 'top',
              timeout: 2000,
            });
          });
      } catch (error) {
        q.notify({
          type: 'negative',
          message: 'Failed to copy content',
          position: 'top',
          timeout: 2000,
        });
      }
    };

    // Helper function to check if content exists
    const hasContent = (content: any) => {
      // Check for null, undefined
      if (content === null || content === undefined) return false;

      // Check for empty or "null" string (case insensitive)
      if (typeof content === 'string') {
        const trimmed = content.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'null') return false;
      }

      // Check for empty arrays
      if (Array.isArray(content) && content.length === 0) return false;

      // Check for empty objects (but not arrays or objects with properties)
      if (typeof content === 'object' && !Array.isArray(content) && Object.keys(content).length === 0) return false;

      // Check if JSON stringified content is null/empty
      try {
        const stringified = JSON.stringify(content);
        if (stringified === 'null' || stringified === '{}' || stringified === '[]') return false;
      } catch (e) {
        // If stringify fails, continue with other checks
      }

      return true;
    };

    // Toggle fullscreen for both Input and Output side by side
    const toggleFullscreen = () => {
      if (ioContainerRef.value) {
        q.fullscreen.toggle(ioContainerRef.value)
          .then(() => {
            // Check if this specific element is now fullscreen
            nextTick(() => {
              isFullscreen.value = document.fullscreenElement === ioContainerRef.value;
            });
          })
          .catch((err: any) => {
            console.error('Failed to toggle fullscreen:', err);
          });
      }
    };

    // Listen for fullscreen changes (e.g., when user presses Escape)
    onMounted(() => {
      const handleFullscreenChange = () => {
        // Check if the IO container is in fullscreen
        isFullscreen.value = document.fullscreenElement === ioContainerRef.value;
      };

      // Listen to fullscreen change events
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.addEventListener('mozfullscreenchange', handleFullscreenChange);
      document.addEventListener('MSFullscreenChange', handleFullscreenChange);

      // Cleanup listeners on unmount
      onUnmounted(() => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
        document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      });
    });

    // Format model parameters for display
    const formatModelParams = (params: any) => {
      return formatModelParameters(params);
    };

    return {
      t,
      activeTab,
      closeSidebar,
      eventColumns,
      expandedEvents,
      expandEvent,
      pagination,
      spanDetails,
      store,
      tags,
      processes,
      formatStackTrace,
      getExceptionEvents,
      exceptionEventColumns,
      getDuration,
      getTTFT,
      viewSpanLogs,
      getStartTime,
      copySpanId,
      openReferenceTrace,
      spanLinks,
      linkColumns,
      getTagRows,
      tagColumns,
      processColumns,
      getProcessRows,
      highlightedAttributes,
      highlightTextMatch,
      highlightedJSON,
      // Correlation
      correlationLoading,
      correlationError,
      correlationProps,
      config,
      // LLM
      isLLMSpan,
      llmMetrics,
      copyContent,
      formatModelParams,
      getObservationTypeColor,
      hasContent,
      ioContainerRef,
      isFullscreen,
      toggleFullscreen,
      isDarkMode,
    };
  },
});
</script>

<style scoped lang="scss">
.span_details_tab-panels {
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    table-layout: fixed;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(0.625rem);
    border-radius: 0.5rem;
    border: 0.125rem solid rgba(255, 255, 255, 0.3);
    overflow: hidden;
  }

  th,
  td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    text-align: left;
    padding: 4px !important;
    font-size: 13px;
    word-break: break-word;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 600px;
  }

  td span {
    display: inline-block;
    width: 100%;
    word-break: break-word;
    word-wrap: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }

  th:last-child,
  td:last-child {
    border-right: none;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tbody tr:first-child td:first-child {
    border-top-left-radius: 0.5rem;
  }

  tbody tr:first-child td:last-child {
    border-top-right-radius: 0.5rem;
  }

  tbody tr:last-child td:first-child {
    border-bottom-left-radius: 0.5rem;
  }

  tbody tr:last-child td:last-child {
    border-bottom-right-radius: 0.5rem;
  }
}

.span_details_tab-panels table.q-table {
  background: rgba(240, 240, 245, 0.8);
  backdrop-filter: blur(0.625rem);
  border: 0.125rem solid rgba(100, 100, 120, 0.5);
}
.attr-text {
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.table-header {
  // text-transform: capitalize;

  .table-head-chip {
    padding: 0px;

    .q-chip__content {
      margin-right: 0.5rem;
      font-size: 0.75rem;
      color: $dark;
    }

    .q-chip__icon--remove {
      height: 1rem;
      width: 1rem;
      opacity: 1;
      margin: 0;

      &:hover {
        opacity: 0.7;
      }
    }

    .q-table th.sortable {
      cursor: pointer;
      text-transform: capitalize;
      font-weight: bold;
    }
  }

  &.isClosable {
    padding-right: 26px;
    position: relative;

    .q-table-col-close {
      transform: translateX(26px);
      position: absolute;
      margin-top: 2px;
      color: grey;
      transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
    }
  }

  .q-table th.sortable {
    cursor: pointer;
    text-transform: capitalize;
    font-weight: bold;
  }

  .log_json_content {
    white-space: pre-wrap;
  }
}
.q-table__top {
  padding-left: 0;
  padding-top: 0;
}

.q-table thead tr,
.q-table tbody td,
.q-table th,
.q-table td {
  height: 25px;
  padding: 0px 5px;
  font-size: 0.75rem;
}

.q-table__bottom {
  width: 100%;
}

.q-table__bottom {
  min-height: 40px;
  padding-top: 0;
  padding-bottom: 0;
}

.q-td {
  overflow: hidden;
  min-width: 100px;

  .expanded {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-all;
  }
}

// Cell with max-height and scroll
.cell-with-max-height {
  vertical-align: top;

  .cell-content {
    max-height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
    display: block;
    word-break: break-word;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
}

.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
}

.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}

.field_list {
  padding: 0px;
  margin-bottom: 0.125rem;
  position: relative;
  overflow: visible;
  cursor: default;
}
.span_details_tab-panels {
  height: calc(100% - 6rem);
  overflow-y: auto;
  overflow-x: hidden;
}

.header_bg {
}

// LLM-specific styles
// Observation Type Badge
.observation-type-badge {
  text-transform: none !important;
}

// Trace Details Toolbar - Modern Styling
.trace-details-toolbar-container {
  background: rgba(248, 249, 250, 0.5);
  // border-bottom: 1px solid #e9ecef;
  white-space: nowrap;

  .toolbar-chip {
    font-size: 11px;
    height: 22px;
    padding: 0 6px;
    background: white;
    border: 1px solid #dee2e6;
    transition: all 0.2s ease;
    flex-shrink: 0;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .chip-label {
      color: #6c757d;
      font-size: 10px;
      font-weight: 500;
      margin-right: 3px;
    }

    .chip-value {
      color: #212529;
      font-weight: 600;
      font-size: 10px;
    }

    &.service-chip {
      border-left: 3px solid #0d6efd;
      .q-icon {
        color: #0d6efd;
      }
    }

    &.duration-chip {
      border-left: 3px solid #6610f2;
      .q-icon {
        color: #6610f2;
      }
    }

    &.ttft-chip {
      border-left: 3px solid #6f42c1;
      .q-icon {
        color: #6f42c1;
      }
    }

    &.time-chip {
      border-left: 3px solid #d63384;
      .q-icon {
        color: #d63384;
      }
    }

    &.span-id-chip {
      border-left: 3px solid #20c997;
      cursor: pointer;

      .q-icon {
        color: #20c997;
      }

      .copy-icon {
        opacity: 0.6;
        transition: opacity 0.2s;
      }

      &:hover .copy-icon {
        opacity: 1;
      }
    }
  }

  .view-logs-btn {
    height: 24px;
    font-size: 10px;
    font-weight: 600;
    padding: 0 10px;
    border-radius: 4px;
    text-transform: none;
    flex-shrink: 0;
  }

  // Scrollbar styling for horizontal scroll
  > div::-webkit-scrollbar {
    height: 4px;
  }

  > div::-webkit-scrollbar-track {
    background: transparent;
  }

  > div::-webkit-scrollbar-thumb {
    background: #cbd5e0;
    border-radius: 2px;
  }

  > div::-webkit-scrollbar-thumb:hover {
    background: #a0aec0;
  }
}

// LLM Chips - Modern Styling (now integrated into toolbar)
.trace-details-toolbar-container {
  .llm-chip {
    font-size: 10px;
    height: 20px;
    padding: 0 6px;
    background: white;
    border: 1px solid #dee2e6;
    transition: all 0.2s ease;
    flex-shrink: 0;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
    }

    .chip-value {
      font-size: 10px;
      font-weight: 500;
    }

    &.model-chip {
      border-left: 3px solid #ab47bc;

      .q-icon {
        color: #7b1fa2;
      }

      .chip-value {
        color: #4a148c;
        font-weight: 600;
      }
    }

    &.token-chip {
      min-width: 60px;
      justify-content: center;

      .chip-label {
        font-size: 9px;
        font-weight: 500;
        margin-right: 2px;
      }

      &.input-token-chip {
        border-left: 3px solid #42a5f5;

        .q-icon, .chip-label, .chip-value {
          color: #1565c0;
        }
      }

      &.output-token-chip {
        border-left: 3px solid #66bb6a;

        .q-icon, .chip-label, .chip-value {
          color: #2e7d32;
        }
      }
    }

    &.cost-chip {
      border-left: 3px solid #ef6c00;

      .q-icon {
        color: #ef6c00;
      }

      .chip-value {
        color: #e65100;
        font-weight: 600;
      }
    }
  }

  .tokens-group {
    display: inline-flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .provider-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }

  .llm-metrics-row {
    // Scrollbar styling for horizontal scroll
    &::-webkit-scrollbar {
      height: 4px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: #cbd5e0;
      border-radius: 2px;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: #a0aec0;
    }
  }
}

// Dark Mode Styles
body.body--dark {
  .trace-details-toolbar-container {
    background: rgba(45, 55, 72, 0.5);
    border-bottom-color: #4a5568;

    .llm-metrics-row {
      border-top-color: #4a5568 !important;
    }

    .toolbar-chip {
      background: #1a202c;
      border-color: #4a5568;
      color: #e2e8f0;

      .chip-label {
        color: #a0aec0;
      }

      .chip-value {
        color: #e2e8f0;
      }

      &:hover {
        background: #2d3748;
      }
    }
  }

  .trace-details-toolbar-container {
    .llm-chip {
      background: #1a202c;
      border-color: #4a5568;

      .chip-value {
        color: #e2e8f0;
      }

      &.model-chip {
        border-left: 3px solid #ab47bc;

        .q-icon {
          color: #ce93d8;
        }

        .chip-value {
          color: #e9d8fd;
        }
      }

      &.token-chip {
        &.input-token-chip {
          border-left: 3px solid #42a5f5;

          .q-icon, .chip-label, .chip-value {
            color: #90cdf4;
          }
        }

        &.output-token-chip {
          border-left: 3px solid #66bb6a;

          .q-icon, .chip-label, .chip-value {
            color: #9ae6b4;
          }
        }
      }

      &.cost-chip {
        border-left: 3px solid #ef6c00;

        .q-icon {
          color: #ffcc80;
        }

        .chip-value {
          color: #fed7aa;
        }
      }
    }


    .provider-badge {
      background: linear-gradient(135deg, #2b6cb0 0%, #2c5282 100%);
    }
  }
}

.llm-preview-panel {
  overflow: hidden; // Prevent scroll at panel level

  .section-label {
    color: var(--o2-text-primary);
    font-size: 14px;
    margin-bottom: 0.5rem;
  }

  .io-container {
    display: flex;
    gap: 0.5rem;
    width: calc(100vw - 350px);
    height: calc(100vh - 296px); // Fixed height for the container (with 2-row toolbar for LLM spans)
    max-height: calc(100vh - 296px);
    align-items: stretch; // Ensure equal heights
    overflow: hidden; // Prevent scroll at outer level
  }

  .io-section {
    flex: 0 0 calc(50% - 0.4rem); // Fixed 50% width minus half the gap
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .llm-content-box {
    flex: 1; // Take all available space
    height: 100%; // Take full height of parent
    max-height: calc(100vh - 338px); // Container height minus label/button height (with 2-row toolbar)
    border: 1px solid var(--o2-border-color);
    border-radius: 4px;
    padding: 0.75rem;
    overflow-y: auto; // Enable scroll inside the box
    overflow-x: hidden;
    background-color: var(--o2-code-bg);

    // Enhance hover visibility for code/text content (exclude VueJsonPretty)
    ::v-deep {
      .plain-text-content {
        &:hover {
          background-color: rgba(0, 0, 0, 0.04) !important;
        }
      }

      // Don't apply hover to VueJsonPretty elements
      .vjs-tree {
        * {
          &:hover {
            background-color: transparent !important;
          }
        }
      }
    }
  }

  // No data message styling
  .no-data-message {
    color: var(--o2-text-secondary);
    font-style: italic;
    text-align: center;
    padding: 2rem;
    font-size: 14px;
  }

  // Fullscreen styles for the entire IO container (both Input and Output side by side)
  .io-container:fullscreen {
    background-color: #f5f5f5;
    padding-bottom: 1rem;
    height: 100vh; // Full viewport height in fullscreen
    max-height: 100vh;
    display: flex;
    gap: 0.5rem;
    align-items: stretch;

    .io-section {
      flex: 1; // Equal split in fullscreen
      display: flex;
      flex-direction: column;

      .section-label {
        background: #f5f5f5;
        border-radius: 4px;
      }

      .llm-content-box {
        height: calc(100vh - 80px); // Full height minus header in fullscreen
        max-height: unset; // Remove max-height constraint in fullscreen
        min-height: unset;
      }
    }
  }

  // Dark mode fullscreen
  .io-container-dark:fullscreen {
    background: #1e1e1e; // Dark background for dark mode

    .io-section .section-label {
      background: #1e1e1e;
      color: #e0e0e0; // Ensure text is visible in dark mode
    }
  }

  // Dark mode hover visibility
  .io-container-dark .llm-content-box {
    ::v-deep {
      .plain-text-content {
        &:hover {
          background-color: rgba(255, 255, 255, 0.05) !important;
        }
      }

      // Don't apply hover to VueJsonPretty elements in dark mode
      .vjs-tree {
        * {
          &:hover {
            background-color: transparent !important;
          }
        }
      }
    }
  }

  .model-params-json {
    background-color: var(--o2-code-bg);
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    font-family: monospace;
    font-size: 12px;
    margin: 0;
  }
}
</style>

<style lang="scss">
.span_details_tabs {
  .q-tab__indicator {
    display: none;
  }
  .q-tab--active {
    border-bottom: 1px solid var(--q-primary);
  }
}

.span_details_tab-panels {
  .q-tab-panel {
    padding: 8px 8px 8px 8px;
  }
}

.view-span-logs-btn {
  .q-btn__content {
    display: flex;
    align-items: center;
    font-size: 12px;

    .q-icon {
      margin-right: 2px !important;
      font-size: 14px;
      margin-bottom: 1px;
    }
  }
}
.highlight {
  background-color: yellow; /* Adjust background color as desired */
}
</style>

<style lang="scss">
// Dark theme support for glassmorphic tables
.body--dark {
  .span_details_tab-panels {
    table {
      // background: rgba(255, 255, 255, 0.05);
      // border: 0.125rem solid rgba(255, 255, 255, 0.3);
    }

    th,
    td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      border-right: 1px solid rgba(255, 255, 255, 0.15);
    }
  }
}

// Light theme support for glassmorphic tables
.body--light {
  .span_details_tab-panels {
    table {
      // background: rgba(240, 240, 245, 0.8);
      // border: 0.125rem solid rgba(100, 100, 120, 0.5);
    }

    th,
    td {
      border-bottom: 1px solid rgba(100, 100, 120, 0.2);
      border-right: 1px solid rgba(100, 100, 120, 0.3);
    }
  }
}
.tab-content-with-llm-metrics {
  height: calc(100vh - 312px);
}
.tab-content-without-llm-metrics {
  height: calc(100vh - 276px);
}
.trace-detail-tab-table{
  th{
    background-color: #f5f5f5 !important;
  }
    td{
      padding: 0px !important;
    }
}

.body--dark {
  .trace-detail-tab-table{
    th{
      background-color: #424242 !important;
    }
    td{
      background-color: red;
    }
  }
}
</style>
