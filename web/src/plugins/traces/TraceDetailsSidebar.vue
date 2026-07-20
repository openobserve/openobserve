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
  <div class="flex flex-col h-full">
    <div
      class="flex justify-start items-center pl-3 pr-2 h-[2rem] border-b border-solid border-b-[var(--o2-border-color)] bg-surface-panel"
      data-test="trace-details-sidebar-header"
    >
      <div
        :title="span.operation_name"
        :style="{ width: 'calc(100% - 24px)' }"
        class="pb-0 pl-[0.25rem] truncate flex items-center"
        data-test="trace-details-sidebar-header-operation-name"
      >
        <!-- Status Code Badge -->
        <span
          v-if="hasSpanError"
          class="inline-flex items-center"
          data-test="trace-details-sidebar-header-toolbar-status-code"
        >
          <OIcon
            name="error"
            size="sm"
            class="mr-1 text-[var(--o2-status-error-text)]!"
          />
        </span>
        <!-- Observation Type Badge (for LLM spans) -->
        <OTag
          v-if="isLLMSpan"
          type="observationType"
          :value="span.gen_ai_operation_name"
          class="mr-1 normal-case!"
          data-test="trace-details-sidebar-observation-badge"
        >{{ span.gen_ai_operation_name?.charAt(0) + span.gen_ai_operation_name?.slice(1).toLowerCase() }}</OTag>

        <span class="truncate">{{ span.operation_name }}</span>
      </div>

      <OButton
        variant="ghost"
        size="icon"
        @click="closeSidebar"
        data-test="trace-details-sidebar-header-close-btn"
      >
        <OIcon name="close" size="xs" />
      </OButton>
    </div>
    <div
      class="trace-details-toolbar-container bg-[rgba(248,249,250,0.5)] whitespace-nowrap"
      data-test="trace-details-sidebar-header-toolbar"
    >
      <!-- Row 1: Trace Details -->
      <div
        class="flex items-center justify-between p-1"
        style="overflow-x: auto; flex-wrap: nowrap"
      >
        <div class="flex items-center" style="flex-wrap: nowrap">
          <!-- Service Badge -->
          <OTag
            type="metricChip"
            class="toolbar-chip service-chip mr-[0.325rem]"
            :title="span.service_name"
            data-test="trace-details-sidebar-header-toolbar-service"
          >
            <template #icon>
              <img
                :src="serviceIconUrl"
                class="w-[0.875rem] h-[0.875rem] shrink-0"
                aria-hidden="true"
                alt=""
              />
            </template>
            <span class="chip-label">{{ t('traces.traceDetailsSidebar.service') }}</span>
            <span
              class="chip-value"
              data-test="trace-details-sidebar-header-toolbar-service-name"
            >
              {{ span.service_name }}
            </span>
          </OTag>

          <!-- Duration Badge -->
          <OTag
            type="metricChip"
            class="toolbar-chip duration-chip mr-[0.325rem]"
            :title="getDuration"
            data-test="trace-details-sidebar-header-toolbar-duration"
          >
            <template #icon><OIcon name="schedule" size="xs" /></template>
            <span class="chip-label">{{ t('traces.traceDetailsSidebar.duration') }}</span>
            <span class="chip-value">{{ getDuration }}</span>
          </OTag>

          <!-- TTFT Badge -->
          <OTag
            v-if="getTTFT"
            type="metricChip"
            class="toolbar-chip ttft-chip mr-[0.325rem]"
            :title="getTTFT"
            data-test="trace-details-sidebar-header-toolbar-ttft"
          >
            <template #icon><OIcon name="speed" size="xs" /></template>
            <span class="chip-label">TTFT</span>
            <span class="chip-value">{{ getTTFT }}</span>
          </OTag>

          <!-- Start Time Badge -->
          <OTag
            type="metricChip"
            class="toolbar-chip time-chip mr-[0.325rem]"
            :title="getStartTime"
            data-test="trace-details-sidebar-header-toolbar-start-time"
          >
            <template #icon><OIcon name="access-time" size="xs" /></template>
            <span class="chip-label">{{ t('traces.traceDetailsSidebar.start') }}</span>
            <span class="chip-value">{{ getStartTime }}</span>
          </OTag>

          <!-- Resend Count Badge -->
          <OTag
            v-if="spanHttpResendCount"
            type="metricChip"
            class="toolbar-chip resend-chip mr-[0.325rem]"
            :title="t('traces.traceDetailsSidebar.requestResent', { count: spanHttpResendCount })"
            data-test="trace-details-sidebar-header-toolbar-resend-count"
          >
            <template #icon><OIcon name="replay" size="xs" /></template>
            <span class="chip-label">{{ t('traces.traceDetailsSidebar.resends') }}</span>
            <span class="chip-value">{{ spanHttpResendCount }}</span>
          </OTag>
        </div>

        <div class="flex items-center">
          <!-- Span ID Badge -->
          <OTag
            type="metricChip"
            clickable
            class="toolbar-chip span-id-chip mr-[0.325rem]"
            :title="t('traces.traceDetailsSidebar.spanIdTitle', { id: span.span_id })"
            @click="copySpanId"
            data-test="trace-details-sidebar-header-toolbar-span-id"
          >
            <template #icon><OIcon name="tag" size="xs" /></template>
            <span class="chip-value">{{ span.span_id }}</span>
            <OIcon
              name="content-copy"
              size="xs"
              class="ml-1 copy-icon"
              data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"
            />
          </OTag>

          <!-- View Logs Button -->
          <span v-if="parentMode === 'standalone'" class="shrink-0">
            <!-- Single button with wrapper for tooltip functionality -->
            <span
              class="inline-block"
              tabindex="0"
            >
              <OButton
                variant="outline"
                size="xs"
                class="h-full text-[0.75rem]!"
                :disabled="isViewLogsDisabled"
                :loading="config.isEnterprise === 'true' && correlationLoading"
                @click.stop="viewSpanLogs"
                data-test="trace-details-sidebar-header-toolbar-view-logs-btn"
              >
                {{ t('traces.viewLogs') }}
              </OButton>
              <OTooltip :content="viewLogsTooltipContent" />
            </span>
          </span>
        </div>
      </div>

      <!-- Row 2: LLM Metrics (conditional) -->
      <div
        v-if="isLLMSpan && llmMetrics && span.gen_ai_response_model"
        class="flex items-center justify-between p-1 llm-metrics-row"
        style="
          overflow-x: auto;
          flex-wrap: nowrap;
          border-top: 1px solid #e9ecef;
        "
      >
        <div class="flex items-center" style="flex-wrap: nowrap">
          <!-- Model Chip -->
          <OTag
            type="metricChip"
            icon="psychology"
            class="llm-chip model-chip"
            :title="span.gen_ai_response_model"
          >
            <span class="chip-value font-bold">{{ span.gen_ai_response_model }}</span>
          </OTag>

          <!-- Token Usage Group -->
          <div class="tokens-group">
            <!-- Input Tokens -->
            <OTag
              type="metricChip"
              class="llm-chip token-chip input-token-chip"
              :title="t('traces.traceDetailsSidebar.inputTokens')"
            >
              <template #icon><OIcon name="arrow-upward" size="xs" /></template>
              <span class="chip-label">{{ t('traces.traceDetailsSidebar.in') }}</span>
              <span class="chip-value">{{ llmMetrics.usage.input }}</span>
            </OTag>

            <!-- Output Tokens -->
            <OTag
              type="metricChip"
              class="llm-chip token-chip output-token-chip"
              :title="t('traces.traceDetailsSidebar.outputTokens')"
            >
              <template #icon><OIcon name="arrow-downward" size="xs" /></template>
              <span class="chip-label">{{ t('traces.traceDetailsSidebar.out') }}</span>
              <span class="chip-value">{{ llmMetrics.usage.output }}</span>
            </OTag>
          </div>

          <!-- Cost Chip -->
          <OTag
            type="metricChip"
            icon="attach-money"
            class="llm-chip cost-chip"
            :title="t('traces.traceDetailsSidebar.totalCost')"
          >
            <span class="chip-value font-bold"
              >${{ Number(llmMetrics.cost.total).toFixed(5) }}</span
            >
          </OTag>
        </div>

        <div class="flex items-center">
          <!-- Provider Badge -->
          <OTag
            v-if="span.gen_ai_provider_name"
            type="metricChip"
            class="provider-badge"
          >{{ span.gen_ai_provider_name }}</OTag>
        </div>
      </div>
    </div>

    <div class="font-bold mx-2 span_details_tabs ">
      <OTabs
        v-model="activeTab"
        dense
        align="left"
        data-test="trace-details-sidebar-tabs"
      >
        <!-- LLM Preview Tab (conditional - shown first for LLM traces) -->
        <OTab
          v-if="isLLMSpan"
          name="preview"
          :label="t('traces.traceDetailsSidebar.preview')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-preview"
                    class="font-normal!"

        />

        <OTab
          name="attributes"
          :label="t('common.attributes')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-attributes"
          class="font-normal!"
        />
        <OTab
          name="error"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-error"
          class="font-normal! gap-1!"
        >
          {{ t('common.error') }}
          <OTag
            v-if="hasExceptionEvents.length"
            type="countChip"
            value="error"
            class="ml-0"
            data-test="trace-details-sidebar-tabs-error-count"
          >{{ hasExceptionEvents.length }}</OTag>
        </OTab>
        <OTab
          v-if="hasDbSpan"
          name="database"
          :label="t('common.db')"
          style="text-transform: capitalize"
          class="font-normal!"
          data-test="trace-details-sidebar-tabs-database"
        />
        <OTab
          name="events"
          :label="t('common.events')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-events"
                    class="font-normal!"

        />
        <OTab
          name="links"
          :label="t('common.links')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-links"
          class="font-normal!"

        />
        <!-- Correlation Tabs (only visible when service streams enabled and enterprise license) -->
        <OTab
          v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
          name="correlated-logs"
          :label="t('correlation.correlatedLogs')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-correlated-logs"
          class="font-normal!"

        />
        <OTab
          v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
          name="correlated-metrics"
          :label="t('correlation.correlatedMetrics')"
          style="text-transform: capitalize"
          data-test="trace-details-sidebar-tabs-correlated-metrics"
          class="font-normal!"
        />
      </OTabs>
    </div>
    <OSeparator class="w-full" />
    <div class="span_details_tab-panels h-[calc(100%-6rem)] overflow-hidden p-2">
      <OTabPanels v-model="activeTab"
grow
class="h-full overflow-y-auto">
        <!-- LLM Preview Tab Panel -->
        <OTabPanel
          v-if="isLLMSpan"
          name="preview"
          class="llm-preview-panel p-3"
        >
          <div class="llm-preview-container overflow-hidden overflow-x-auto w-full h-full!">
            <!-- Input and Output Side by Side -->
            <div
              class="flex io-container w-full! h-full!"
              :class="{ 'io-container-dark': isDarkMode }"
              ref="ioContainerRef"
            >
              <!-- Input Section -->
              <div class="w-1/2 io-section pr-[0.5rem]">
                <div
                  class="section-label font-bold mb-1 flex items-center justify-between"
                >
                  <div>{{ t('traces.traceDetailsSidebar.input') }}</div>
                  <div class="flex items-center gap-1">
                    <OButton
                      variant="outline"
                      size="icon"
                      :title="
                        isFullscreen ? t('traces.traceDetailsSidebar.exitFullscreen') : t('traces.traceDetailsSidebar.enterFullscreen')
                      "
                      @click="toggleFullscreen"
                    >
                      <OIcon
                        :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
                        size="xs"
                      />
                    </OButton>
                    <OButton
                      variant="outline"
                      size="icon"
                      :title="t('traces.traceDetailsSidebar.copyInput')"
                      @click="copyContent(span.gen_ai_input_messages, 'input')"
                      :disabled="!hasContent(span.gen_ai_input_messages)"
                    >
                      <OIcon name="content-copy" size="xs" />
                    </OButton>
                  </div>
                </div>
                <div class="llm-content-box">
                  <!-- System Instructions (when available) -->
                  <div v-if="parsedSystemInstructions" class="mb-3">
                    <OCollapsible
                      v-model="sysInstrOpen"
                      icon="settings"
                      :label="t('traces.traceDetailsSidebar.systemInstructions')"
                    >
                      <div class="p-2 bg-[var(--o2-code-bg)]">
                        <LLMContentRenderer
                          :content="JSON.stringify([{ role: 'system', content: parsedSystemInstructions }])"
                          :observation-type="span.gen_ai_operation_name"
                          content-type="input"
                          view-mode="formatted"
                        />
                      </div>
                    </OCollapsible>
                  </div>
                  <div
                    v-if="!hasContent(span.gen_ai_input_messages) && !parsedSystemInstructions"
                    class="no-data-message"
                  >
                    {{ t('traces.traceDetailsSidebar.noDataAvailable') }}
</div>
                  <LLMContentRenderer
                    v-if="hasContent(span.gen_ai_input_messages)"
                    :content="span.gen_ai_input_messages"
                    :observation-type="span.gen_ai_operation_name"
                    content-type="input"
                    :span="span"
                    view-mode="formatted"
                    :instance-id="`${span.span_id}-input`"
                  />
                </div>
              </div>

              <!-- Output Section -->
              <div class="w-1/2 io-section">
                <div
                  class="section-label font-bold mb-1 flex items-center justify-between"
                >
                  <div>{{ t('traces.traceDetailsSidebar.output') }}</div>
                  <div class="flex items-center gap-1">
                    <OButton
                      variant="outline"
                      size="icon"
                      :title="
                        isFullscreen ? t('traces.traceDetailsSidebar.exitFullscreen') : t('traces.traceDetailsSidebar.enterFullscreen')
                      "
                      @click="toggleFullscreen"
                    >
                      <OIcon
                        :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
                        size="xs"
                      />
                    </OButton>
                    <OButton
                      variant="outline"
                      size="icon"
                      :title="t('traces.traceDetailsSidebar.copyOutput')"
                      @click="copyContent(span.gen_ai_output_messages, 'output')"
                      :disabled="!hasContent(span.gen_ai_output_messages)"
                    >
                      <OIcon name="content-copy" size="xs" />
                    </OButton>
                  </div>
                </div>
                <div class="llm-content-box">
                  <div
                    v-if="!hasContent(span.gen_ai_output_messages)"
                    class="no-data-message"
                  >
                    {{ t('traces.traceDetailsSidebar.noDataAvailable') }}
</div>
                  <LLMContentRenderer
                    v-else
                    :content="span.gen_ai_output_messages"
                    :observation-type="span.gen_ai_operation_name"
                    content-type="output"
                    :span="span"
                    view-mode="formatted"
                    :instance-id="`${span.span_id}-output`"
                  />
                </div>
              </div>
            </div>

            <!-- Model Parameters (collapsible) -->
            <OCollapsible
              v-if="span.llm_request_parameters"
              v-model="modelParamsOpen"
              :label="t('traces.traceDetailsSidebar.modelParameters')"
              class="mt-3"
            >
              <pre class="model-params-json p-2">{{
                formatModelParams(span.llm_request_parameters)
              }}</pre>
            </OCollapsible>
          </div>
        </OTabPanel>

        <OTabPanel
          name="attributes"
          class="p-0 flex flex-col overflow-hidden"
        >
          <!-- View mode toggle toolbar -->
          <div class="flex items-center justify-start pb-1.5! h-fit!">
            <OToggleGroup v-model="attributesViewMode" class="rounded!">
              <OToggleGroupItem value="json"
size="xs"
class="h-5! text-[0.75rem]!">
                <template #icon-left
                  ><OIcon name="data-object" size="xs" class="shrink-0"
                /></template>
                JSON
              </OToggleGroupItem>
              <OToggleGroupItem value="table"
size="xs"
class="h-5! text-[0.75rem]!">
                <template #icon-left
                  ><OIcon name="table-chart" size="xs" class="shrink-0"
                /></template>
                {{ t('traces.traceDetailsSidebar.table') }}
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
          <!-- JSON View -->
          <div
            v-if="attributesViewMode === 'json'"
            class="grow overflow-auto"
          >
            <json-preview
              :value="attributesForDisplay"
              :highlight-query="searchQuery"
              data-test="trace-details-sidebar-attributes-table"
            >
              <template #field-dropdown="{ field, value: fieldValue }">
                <ul class="flex flex-col m-0 p-0 list-none">
                  <li
                    v-for="action in filterActions"
                    :key="action.operator"
                    :data-test="`trace-details-sidebar-json-filter-action-${action.operator}`"
                    class="flex items-center gap-1 px-1 py-1 cursor-pointer hover:bg-muted/50"
                    @click.stop="
                      $emit('apply-filter-immediately', {
                        field,
                        value: getFilterValue(field, fieldValue),
                        operator: action.operator,
                      })
                    "
                  >
                    <span class="mr-1 inline-flex shrink-0">
                      <OButton variant="ghost" size="icon-xs-circle">
                        <OIcon
                          color="currentColor"
                          class="w-[0.7rem]! h-[0.7rem]! pb-[0.185rem]!"
                        >
                          <component :is="action.iconComponent" />
                        </OIcon>
                      </OButton>
                    </span>
                    <span class="text-[0.85rem]!">{{
                      $t("traces.applyAndSearch")
                    }}</span>
                  </li>
                </ul>
              </template>
            </json-preview>
          </div>
          <!-- Table View -->
          <div
            v-else
            class="flex-1 overflow-hidden tab-content-dynamic-height border-1 border-solid border-[var(--o2-border-color)]"
            :class="
              isLLMSpan && llmMetrics && span.gen_ai_response_model
                ? '[height:calc(100vh-312px)]'
                : '[height:calc(100vh-276px)]'
            "
            data-test="trace-details-sidebar-attributes-tenstack-table"
          >
            <TenstackTable
              :rows="attributesTableRows"
              :columns="attributesTableColumns"
              :enable-row-expand="false"
              :enable-text-highlight="false"
              :enable-status-bar="false"
              :default-columns="false"
              :enable-column-reorder="false"
              :row-height="28"
              :enable-ai-context-button="false"
            >
              <template #cell-value="{ item }">
                <AttributeValueCell :field="item.field" :value="item.value">
                  <template #dropdown="{ field, value: fieldValue }">
                    <ul class="flex flex-col m-0 p-0 list-none">
                      <li
                        v-for="action in filterActions"
                        :key="action.operator"
                        :data-test="`trace-details-sidebar-attr-filter-action-${action.operator}`"
                        class="flex items-center gap-1 px-1 py-1 cursor-pointer hover:bg-muted/50"
                        @click.stop="
                          $emit('apply-filter-immediately', {
                            field,
                            value: getFilterValue(field, fieldValue),
                            operator: action.operator,
                          })
                        "
                      >
                        <span class="mr-1 inline-flex shrink-0">
                          <OButton variant="ghost" size="icon-xs-circle">
                            <OIcon
                              color="currentColor"
                              class="w-[0.7rem]! h-[0.7rem]! pb-[0.185rem]!"
                            >
                              <component :is="action.iconComponent" />
                            </OIcon>
                          </OButton>
                        </span>
                        <span class="text-[0.85rem]!">{{
                          $t("traces.applyAndSearch")
                        }}</span>
                      </li>
                    </ul>
                  </template>
                </AttributeValueCell>
              </template>
            </TenstackTable>
          </div>
        </OTabPanel>
        <OTabPanel
          name="events"
          class="p-0 flex flex-col h-[30.6rem]!"
        >
          <template v-if="spanDetails.events.length">
            <!-- Wrap toggle toolbar -->
            <div class="flex items-center gap-1 pb-[0.325rem] pl-1">
              <OSwitch
                v-model="eventsWrap"
                :label="t('common.wrap')"
                size="md"
                class="gap-1!"
              />
            </div>
            <!-- TenstackTable for events -->
            <div
              class="flex-1 traces-events-table-container overflow-hidden tab-content-dynamic-height border-1 border-solid border-[var(--o2-border-color)] rounded"
              :class="
                isLLMSpan && llmMetrics && span.gen_ai_response_model
                  ? '[height:calc(100vh-312px)]'
                  : '[height:calc(100vh-276px)]'
              "
              data-test="trace-details-sidebar-events-table"
            >
              <TenstackTable
                :rows="spanDetails.events"
                :columns="eventsTableColumns"
                :wrap="eventsWrap"
                :enable-row-expand="true"
                :enable-text-highlight="false"
                :enable-status-bar="false"
                :default-columns="false"
                :row-height="28"
                :enable-ai-context-button="false"
                :hide-view-related-button="true"
                :hide-expand-field-options="true"
                @copy="copyContentToClipboard"
                @update:columnOrder="handleEventsColumnOrder"
                @update:columnSizes="handleEventsColumnSizes"
              >
                <template #expanded-row="{ row }">
                  <json-preview
                    :value="row"
                    class="py-[0.375rem] pl-[0.375rem]"
                    copyButtonClass="left-[0.25rem]! w-fit! sticky!"
                    mode="expanded"
                  />
                </template>
              </TenstackTable>
            </div>
          </template>
          <div
            v-else
            class="w-full text-center flex items-center justify-center pt-4 font-bold tab-content-dynamic-height"
            :class="
              isLLMSpan && llmMetrics && span.gen_ai_response_model
                ? '[height:calc(100vh-312px)]'
                : '[height:calc(100vh-276px)]'
            "
            data-test="trace-details-sidebar-no-events"
          >
            {{ t('traces.traceDetailsSidebar.noEvents') }}
          </div>
        </OTabPanel>
        <OTabPanel name="error" class="h-full">
          <TraceErrorTab
            :span="span"
            :search-query="searchQuery"
            :show-llm-metrics="
              !!(isLLMSpan && llmMetrics && span.gen_ai_response_model)
            "
            data-test="trace-details-sidebar-no-exceptions"
          />
        </OTabPanel>

        <OTabPanel name="database" class="p-0 h-full">
          <DbSpanDetails :span="span" />
        </OTabPanel>

        <OTabPanel name="links">
          <div v-if="spanLinks.length" class="overflow-auto max-h-[20rem]">
            <table
              class="trace-detail-tab-table border border-solid border-[var(--o2-border-color)] w-full"
              data-test="trace-details-sidebar-links-table"
            >
              <thead
                class="thead-sticky text-left bg-(--color-surface-accent)"
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
              <tbody>
                <tr
                  v-for="(row, index) in spanLinks"
                  :data-test="`trace-event-detail-link-${index}`"
                  :key="'expand_' + index"
                  tabindex="0"
                  @click="openReferenceTrace('span', row)"
                  @keydown="onLinkRowKeydown($event, row)"
                  style="cursor: pointer"
                  class="pointer focus-visible:outline-none focus-visible:bg-(--color-surface-accent)"
                >
                  <td
                    v-for="column in linkColumns"
                    :key="index + '-' + column.name"
                    class="p-0 mb-0.5 relative overflow-visible cursor-default"
                    style="cursor: pointer"
                  >
                    <div class="flex flex items-center flex-nowrap">
                      {{ column.prop(row) }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-else
            class="w-full flex items-center justify-center text-center pt-4 font-bold tab-content-dynamic-height"
            :class="
              isLLMSpan && llmMetrics && span.gen_ai_response_model
                ? '[height:calc(100vh-312px)]'
                : '[height:calc(100vh-276px)]'
            "
            data-test="trace-details-sidebar-no-links"
          >
            {{ t('traces.traceDetailsSidebar.noLinks') }}
          </div>
        </OTabPanel>

        <!-- Correlated Logs Tab Panel -->
        <OTabPanel
          name="correlated-logs"
          class="p-0 full-height traces-correlated-logs-container"
        >
          <CorrelatedLogsTable
            v-if="correlationProps"
            :service-name="correlationProps.serviceName"
            :matched-dimensions="correlationProps.matchedDimensions"
            :additional-dimensions="correlationProps.additionalDimensions"
            :matched-set-id="correlationProps.matchedSetId"
            :chip-dimensions="correlationProps.chipDimensions"
            :source-event="correlationProps.sourceEvent"
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
            class="flex items-center justify-center py-20 tab-content-dynamic-height"
            :class="
              isLLMSpan && llmMetrics && span.gen_ai_response_model
                ? '[height:calc(100vh-312px)]'
                : '[height:calc(100vh-276px)]'
            "
          >
            <div class="text-center">
              <OSpinner
                v-if="correlationLoading"
                size="lg"
                class="mb-4"
              />
              <div
                v-else-if="correlationError"
                class="text-[0.875rem] font-bold"
              >
                {{ correlationError }}
              </div>
              <div v-else class="text-base text-gray-500">
                {{ t("correlation.clickToLoadLogs") }}
              </div>
            </div>
          </div>
        </OTabPanel>

        <!-- Correlated Metrics Tab Panel -->
        <OTabPanel
          name="correlated-metrics"
          class="p-0 full-height traces-correlated-metrics-container"
        >
          <TelemetryCorrelationDashboard
            v-if="correlationProps"
            mode="embedded-tabs"
            external-active-tab="metrics"
            :service-name="correlationProps.serviceName"
            :matched-dimensions="correlationProps.matchedDimensions"
            :additional-dimensions="correlationProps.additionalDimensions"
            :matched-set-id="correlationProps.matchedSetId"
            :chip-dimensions="correlationProps.chipDimensions"
            :source-event="correlationProps.sourceEvent"
            :metric-streams="correlationProps.metricStreams"
            :log-streams="correlationProps.logStreams"
            :trace-streams="correlationProps.traceStreams"
            :source-stream="correlationProps.sourceStream"
            :source-type="correlationProps.sourceType"
            :available-dimensions="correlationProps.availableDimensions"
            :fts-fields="correlationProps.ftsFields"
            :time-range="correlationProps.timeRange"
            :hide-dimension-filters="true"
            :metric-group-definitions="metricGroupResources"
            :panelHeight="12"
            :panelWidth="96"
            @close="activeTab = 'attributes'"
          />
          <!-- Loading/Empty state when no data -->
          <div
            v-else
            class="flex items-center justify-center py-20 tab-content-dynamic-height"
            :class="
              isLLMSpan && llmMetrics && span.gen_ai_response_model
                ? '[height:calc(100vh-312px)]'
                : '[height:calc(100vh-276px)]'
            "
          >
            <div class="text-center">
              <OSpinner
                v-if="correlationLoading"
                size="lg"
                class="mb-4"
              />
              <div
                v-else-if="correlationError"
                class="text-[0.875rem] font-bold"
              >
                {{ correlationError }}
              </div>
              <div v-else class="text-base text-gray-500">
                {{ t("correlation.clickToLoadMetrics") }}
              </div>
            </div>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { cloneDeep } from "lodash-es";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { copyToClipboard } from "@/utils/clipboard";
import { toggleFullscreen as domToggleFullScreen } from "@/utils/dom";
import { defineComponent, onBeforeMount, ref, watch, type Ref, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import {
  formatTimeWithSuffix,
  convertTimeFromNsToUs,
  getImageURL,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import { useRouter } from "vue-router";
import { onMounted, onUnmounted, defineAsyncComponent, nextTick } from "vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import JsonPreview from "@/components/JsonPreview.vue";
import CorrelatedLogsTable from "@/plugins/correlation/CorrelatedLogsTable.vue";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { buildChipDimensionsFromFilters } from "@/services/service_streams";
import { buildWorkloadChipDimensions } from "@/composables/useMetricSubjectButtons";
import { normalizeSeverity } from "@/utils/sourceEventSeverity";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";
import { buildFieldToGroupIdMap } from "@/utils/telemetryCorrelation";
import config from "@/aws-exports";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import {
  type MetricGroupDefinition,
  K8S_METRIC_GROUP_DEFINITIONS,
} from "@/utils/metrics/metricGrouping";
import DeployedCode from "@/components/icons/DeployedCode.vue";
import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import TenstackTable from "@/components/TenstackTable.vue";
import {
  isLLMTrace,
  parseUsageDetails,
  parseCostDetails,
  getObservationTypeColor,
  formatModelParameters,
} from "@/utils/llmUtils";
import DOMPurify from "dompurify";
import { escapeHtml } from "@/utils/html";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import AttributeValueCell from "@/components/AttributeValueCell.vue";
import useTraceDetails from "@/composables/traces/useTraceDetails";
import DbSpanDetails from "./DbSpanDetails.vue";
import TraceErrorTab from "./components/TraceErrorTab.vue";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { toast } from "@/lib/feedback/Toast/useToast";
import { resolveSpanIdentity } from "@/utils/traces/spanIdentity";
import {
  TRACE_SERVICE_DETECTION_KEY,
  useSpanServiceDetection,
} from "@/utils/traces/useSpanServiceDetection";
import { getOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";

// luxon equivalent of "MMM DD, YYYY HH:mm:ss.SSS Z" → e.g. "Jun 24, 2026 17:39:32.157 +0530"
const HUMAN_TZ_FORMAT = "MMM dd, yyyy HH:mm:ss.SSS ZZZ";

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
    activeTab: {
      type: String,
      default: "attributes",
    },
    selectedLogStreams: {
      type: Array,
      default: () => [],
    },
    showLogStreamSelector: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    OSeparator,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OToggleGroup,
    OToggleGroupItem,
    OButton,
    OIcon,
    OTooltip,
    OCollapsible,
    LogsHighLighting,
    JsonPreview,
    LLMContentRenderer,
    TenstackTable,
    CorrelatedLogsTable,
    TelemetryCorrelationDashboard: defineAsyncComponent(
      () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
    ),
    EqualIcon,
    NotEqualIcon,
    AttributeValueCell,
    DeployedCode,
    DbSpanDetails,
    TraceErrorTab,
    OSpinner,
    OSwitch,
    OTag,
  },
  emits: [
    "close",
    "view-logs",
    "select-span",
    "open-trace",
    "show-correlation",
    "add-filter",
    "apply-filter-immediately",
    "add-field-to-table",
    "update:activeTab",
  ],
  setup(props, { emit }) {
    const serviceDetectionConfig = inject(TRACE_SERVICE_DETECTION_KEY, ref(null));
    const { resolveSpanIdentity } = useSpanServiceDetection(serviceDetectionConfig);
    const { t } = useI18n();
    // Check if this is an LLM span to set default tab
    const isLLMSpan = computed(() => isLLMTrace(props.span));

    const spanDetails: any = ref({
      attrs: {},
      events: [],
    });

    const { hasSpanError, hasExceptionEvents } = useTraceDetails(
      computed(() => props.span),
    );

    const spanHttpResendCount = computed(() => {
      const attrs = props.span;
      if (!attrs) return null;
      const count = attrs["http_request_resend_count"] ?? null;
      if (count === null || count === undefined) return null;
      const num = parseInt(String(count), 10);
      return !isNaN(num) && num > 0 ? num : null;
    });

    const activeTab = computed({
      get: () => props.activeTab,
      set: (value: string) => emit("update:activeTab", value),
    });

    const navigateToError = () => {
      activeTab.value = "error";
    };
    const tags: Ref<{ [key: string]: string }> = ref({});

    // Ref for fullscreen container (parent container with both Input and Output)
    const ioContainerRef = ref<HTMLElement | null>(null);

    // Track fullscreen state
    const isFullscreen = ref(false);
    const sysInstrOpen = ref(false);
    const modelParamsOpen = ref(false);

    const showPendingFilter = false;

    const closeSidebar = () => {
      emit("close");
    };

    const pagination: any = ref({
      rowsPerPage: 0,
    });
    const { buildQueryDetails, navigateToLogs, navigateToCorrelatedLogs, searchObj } = useTraces();
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

    const store = useStore();

    const RAW_VALUE_FILTER_FIELDS = new Set([
      store.state?.zoConfig?.timestamp_column || "_timestamp",
    ]);

    const hasDbSpan = computed(() =>
      Object.keys(props.span ?? {}).some((key) => key.startsWith("db_")),
    );

    const filterActions = [
      { operator: "=" as const, iconComponent: EqualIcon },
      { operator: "!=" as const, iconComponent: NotEqualIcon },
    ];

    const getFilterValue = (field: string, displayValue: unknown): unknown => {
      const span = props.span as Record<string, unknown>;
      if (field === "start_time") {
        return span._start_time_ns ?? span.start_time ?? displayValue;
      }
      if (field === "end_time") {
        return span._end_time_ns ?? span.end_time ?? displayValue;
      }
      const timestampField =
        store.state?.zoConfig?.timestamp_column || "_timestamp";
      if (field === timestampField) {
        return span[timestampField] ?? displayValue;
      }

      return displayValue;
    };

    const attributesForDisplay = computed(() => {
      const attrs = { ...spanDetails.value.attrs };
      delete attrs.gen_ai_input_messages;
      delete attrs.gen_ai_output_messages;
      delete attrs.gen_ai_system_instructions;
      return attrs;
    });

    const attributesViewMode = ref<"json" | "table">("json");

    const attributesTableColumns = [
      {
        accessorKey: "field",
        id: "field",
        header: t("traces.traceDetailsSidebar.field"),
        size: 200,
        meta: {
          headerClass:
            "border-b border-r border-b-[var(--o2-border-color)]",
          cellClass:
            "border-r border-b-[var(--o2-border-color)] text-[var(--o2-json-key)]",
        },
      },
      {
        accessorKey: "value",
        id: "value",
        header: t("traces.traceDetailsSidebar.value"),
        size: 400,
        meta: {
          slot: true,
          headerClass: "border-b border-b-[var(--o2-border-color)]",
          cellClass: "border-b-[var(--o2-border-color)] p-0!",
        },
      },
    ];

    const attributesTableRows = computed(() =>
      Object.entries(attributesForDisplay.value).map(([key, value]) => ({
        field: key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    );

    watch(
      [() => props.span, () => store.state.timezone],
      () => {
        tags.value = {};
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
        headerClasses: "text-left!",
      },
      {
        name: "value",
        label: "Value",
        field: "value",
        align: "left" as const,
        headerClasses: "text-left!",
      },
    ];

    const getTagRows = computed(() => {
      return Object.entries(tags.value).map(([key, value]) => ({
        field: key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));
    });

    const getDuration = computed(() =>
      formatTimeWithSuffix(props.span.duration),
    );

    const getTTFT = computed(() => {
      // Only calculate for LLM spans with completion_start_time
      if (!props.span.gen_ai_completion_start_time || !props.span.start_time) {
        return null;
      }
      // completion_start_time is in microseconds
      // start_time is in nanoseconds, convert to microseconds
      const completionStartTime = props.span.gen_ai_completion_start_time;
      const spanStartTimeUs = props.span.start_time / 1000;
      const ttftUs = completionStartTime - spanStartTimeUs;
      return formatTimeWithSuffix(ttftUs);
    });

    onBeforeMount(() => {
      spanDetails.value = getFormattedSpanDetails();
    });

    // Get current theme from store
    const isDarkMode = computed(() => store.state.theme === "dark");

    // Check if View Logs button should be disabled
    const isViewLogsDisabled = computed(() => {
      // Enterprise loading state
      if (config.isEnterprise === 'true' && correlationLoading.value) {
        return true;
      }

      // Non-enterprise mode with visible log stream selector, disable when no streams are selected
      return (
        config.isEnterprise !== "true" &&
        props.showLogStreamSelector &&
        props.selectedLogStreams.length === 0
      );
    });

    // Get tooltip content based on disabled state
    const viewLogsTooltipContent = computed(() => {
      // Enterprise loading state
      if (config.isEnterprise === 'true' && correlationLoading.value) {
        return t('correlation.loadingCorrelation');
      }

      // Non-enterprise mode with no log streams selected
      if (
        config.isEnterprise !== "true" &&
        props.showLogStreamSelector &&
        props.selectedLogStreams.length === 0
      ) {
        return t('search.selectLogsStreamFirst');
      }

      // Default enabled state
      return t('traces.viewLogs');
    });

    const eventColumns = ref([
      {
        name: "@timestamp",
        field: "@timestamp",
        prop: (row: any) =>
          timestampToTimezoneDate(
            row[store.state.zoConfig.timestamp_column] / 1000000,
            store.state.timezone,
            HUMAN_TZ_FORMAT,
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

    const eventsWrap = ref(false);

    const eventsColOrder = ref<string[]>([]);
    const eventsColSizes = ref<Record<string, number>>({});

    const handleEventsColumnOrder = (newOrder: string[]) => {
      eventsColOrder.value = newOrder;
    };

    const handleEventsColumnSizes = (
      cssVarSizes: Record<string, number>,
      colIdMap: Record<string, string>,
    ) => {
      // cssVarSizes keys are "--col-{sanitizedId}-size"; use colIdMap to resolve originals
      const sizes: Record<string, number> = { ...eventsColSizes.value };
      for (const [sanitizedId, originalId] of Object.entries(colIdMap)) {
        const cssKey = `--col-${sanitizedId}-size`;
        if (cssVarSizes[cssKey] !== undefined) {
          sizes[originalId] = cssVarSizes[cssKey];
        }
      }
      eventsColSizes.value = sizes;
    };

    const eventsTableColumns = computed(() => {
      const events = spanDetails.value.events;
      if (!events || !events.length) return [];

      const tsCol = store.state.zoConfig.timestamp_column;
      const allKeys = new Set<string>();
      events.forEach((event: any) => {
        Object.keys(event).forEach((key) => allKeys.add(key));
      });

      const cols: any[] = [];

      // Timestamp first
      if (allKeys.has(tsCol)) {
        cols.push({
          accessorKey: tsCol,
          id: tsCol,
          header: t("traces.traceDetailsSidebar.timestamp"),
          size: eventsColSizes.value[tsCol] ?? 220,
          accessorFn: (row: any) =>
            timestampToTimezoneDate(
              row[tsCol] / 1000000,
              store.state.timezone,
              HUMAN_TZ_FORMAT,
            ),
          meta: {
            headerClass:
              "border-b border-r border-b-[var(--o2-border-color)]",
            cellClass: "border-r border-b-[var(--o2-border-color)]",
          },
        });
        allKeys.delete(tsCol);
      }

      // All remaining keys
      allKeys.forEach((key) => {
        cols.push({
          accessorKey: key,
          id: key,
          header: key,
          size: eventsColSizes.value[key] ?? 200,
          accessorFn: (row: any) => {
            const val = row[key];
            if (val === null || val === undefined) return "";
            if (val === "string") {
              try {
                return JSON.parse(val);
              } catch (err) {
                return String(val);
              }
            }
            return typeof val === "object" ? JSON.stringify(val) : String(val);
          },
          meta: {
            headerClass:
              "border-b border-r border-b-[var(--o2-border-color)]",
            cellClass: "border-r border-b-[var(--o2-border-color)]",
          },
        });
      });

      // Apply saved column order (only for IDs that still exist in current cols)
      if (eventsColOrder.value.length) {
        const colMap = new Map(cols.map((c) => [c.id, c]));
        const ordered = eventsColOrder.value
          .filter((id) => colMap.has(id))
          .map((id) => colMap.get(id)!);
        // Append any new columns not present in the saved order
        const orderedIds = new Set(eventsColOrder.value);
        cols
          .filter((c) => !orderedIds.has(c.id))
          .forEach((c) => ordered.push(c));
        return ordered;
      }

      return cols;
    });

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

    const getSpanKind = (id: number | string | null | undefined): string => {
      if (id === null || id === undefined || id === "") return "Unspecified";
      return SPAN_KIND_MAP[String(id)] || String(id);
    };

    const getFormattedSpanDetails = () => {
      const spanDetails: { attrs: any; events: any[] } = {
        attrs: {},
        events: [],
      };

      spanDetails.attrs = cloneDeep(props.span);

      if (spanDetails.attrs.events) delete spanDetails.attrs.events;

      // These are custom meta fields for start_time and end_time so removing it from spanDetails
      delete spanDetails.attrs._start_time_ns;
      delete spanDetails.attrs._end_time_ns;

      spanDetails.attrs.duration = spanDetails.attrs.duration + "us";
      spanDetails.attrs[store.state.zoConfig.timestamp_column] =
        timestampToTimezoneDate(
          spanDetails.attrs[store.state.zoConfig.timestamp_column] / 1000,
          store.state.timezone,
          HUMAN_TZ_FORMAT,
        );

      spanDetails.attrs["start_time"] = timestampToTimezoneDate(
        spanDetails.attrs["start_time"] / 1000000,
        store.state.timezone,
        HUMAN_TZ_FORMAT,
      );

      spanDetails.attrs["end_time"] = timestampToTimezoneDate(
        spanDetails.attrs["end_time"] / 1000000,
        store.state.timezone,
        HUMAN_TZ_FORMAT,
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
      "_start_time_ns",
      "_end_time_ns",
      "duration",
      "busy_ns",
      "idle_ns",
      "events",
    ]);

    watch(
      () => props.span,
      () => {
        tags.value = {};
        Object.keys(props.span).forEach((key: string) => {
          if (!span_details.has(key)) {
            tags.value[key] =
              key === "span_kind"
                ? getSpanKind(props.span[key])
                : props.span[key];
          }
        });
      },
      {
        deep: true,
        immediate: true,
      },
    );

    const viewSpanLogs = () => {
      if (config.isEnterprise === 'true' && correlationProps.value) {
        navigateToCorrelatedLogs(correlationProps.value);
      } else {
        const queryDetails = buildQueryDetails(props.span);
        navigateToLogs(queryDetails);
      }
    };


    const getStartTime = computed(() => {
      return formatTimeWithSuffix(
        convertTimeFromNsToUs(props.span.start_time) -
          (props.baseTracePosition?.startTimeUs || 0),
      );
    });

    const copySpanId = () => {
      copyToClipboard(props.span?.span_id || "", {
        successMessage: t("traces.traceDetailsSidebar.spanIdCopied"),
      });
    };

    const copyAttributesToClipboard = () => {
      const attributes = props.span?.attributes || {};
      const attributesText = JSON.stringify(attributes, null, 2);

      copyToClipboard(attributesText, {
        successMessage: t("traces.traceDetailsSidebar.attributesCopied"),
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

    // Keyboard access for clickable span-link rows: Enter/Space activate, arrows move focus.
    const onLinkRowKeydown = (event: KeyboardEvent, row: any) => {
      if (event.target !== event.currentTarget) return;
      const currentRow = event.currentTarget as HTMLElement;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openReferenceTrace("span", row);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = currentRow.nextElementSibling as HTMLElement | null;
        if (next?.matches("tr[tabindex]")) next.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = currentRow.previousElementSibling as HTMLElement | null;
        if (prev?.matches("tr[tabindex]")) prev.focus();
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

    // Metric group definitions — controls which category tabs and default selections
    // appear in the metrics dashboard. Uses K8S_METRIC_GROUP_DEFINITIONS for OTel
    // semantic defaults; overrides the pods icon with the project-specific component.
    const metricGroupResources = ref<MetricGroupDefinition[]>(
      K8S_METRIC_GROUP_DEFINITIONS.map((g) =>
        g.id === "pods" ? { ...g, icon: DeployedCode } : g,
      ),
    );

    // Correlation state
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationProps = ref<any>(null);
    const {
      findRelatedTelemetry,
      loadSemanticGroups,
      semanticGroups,
    } = useServiceCorrelation();

    // Write correlation data to shared searchObj for TraceDetails to use
    watch(correlationProps, (newVal) => {
      searchObj.data.traceDetails.correlationProps = newVal;
    });

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

    // Map a span row to a source-event severity label. Spans in this codebase
    // expose span status as `span_status` ("OK" | "ERROR" | "UNSET"); fall back
    // to OTel `status.code` (numeric, 2 = ERROR) and finally any severity-like
    // text field on the span. Returns null when nothing classifiable is set.
    const deriveSpanSeverity = (span: any): string | null => {
      if (!span) return null;
      const spanStatus = typeof span.span_status === "string"
        ? span.span_status.toUpperCase()
        : null;
      if (spanStatus === "ERROR") return "ERROR";
      const otelStatusCode =
        span.status?.code ?? span.statusCode ?? span.status_code;
      if (otelStatusCode === 2 || otelStatusCode === "ERROR") return "ERROR";
      return normalizeSeverity(span.severity_text ?? span.severity);
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
          t("traces.traceDetailsSidebar.enterpriseLicenseRequired");
        return;
      }

      if (!props.span || !props.streamName) {
        console.warn(
          "[TraceDetailsSidebar] Cannot load correlation: missing span or stream name",
        );
        correlationError.value = t("traces.traceDetailsSidebar.missingSpanOrStream");
        return;
      }

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        try {
          await loadSemanticGroups();
        } catch {
          // Non-fatal: semantic groups are used for metrics tab label resolution.
        }

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
            matchedSetId: correlationData.matched_set_id,
            chipDimensions: {
              ...buildChipDimensionsFromFilters(correlationData, semanticGroups.value),
              ...buildWorkloadChipDimensions(correlationData.matched_set_id, semanticGroups.value, props.span as Record<string, any>),
            },
            sourceEvent: {
              timestamp: props.span?.start_time,
              severity: deriveSpanSeverity(props.span) ?? undefined,
              message: props.span?.operation_name,
            },
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
          correlationError.value = t("correlation.noDataFound");
        }
      } catch (err: any) {
        console.error("[TraceDetailsSidebar] Correlation failed:", err);
        correlationError.value = err.message || t("correlation.failedToLoad");
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

        // Load correlation proactively so View Logs button has data
        if (props.serviceStreamsEnabled) {
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
    const copyContent = (content: any, type: "input" | "output") => {
      try {
        // Convert content to string
        let textToCopy = "";
        if (typeof content === "string") {
          textToCopy = content;
        } else if (content) {
          // Pretty-print JSON objects/arrays
          textToCopy = JSON.stringify(content, null, 2);
        }

        // Copy to clipboard
        copyToClipboard(textToCopy, {
          successMessage: t("traces.traceDetailsSidebar.copiedToClipboard", { type: type.charAt(0).toUpperCase() + type.slice(1) }),
          errorMessage: t("traces.traceDetailsSidebar.failedToCopyClipboard"),
        });
      } catch (error) {
        toast({
          variant: "error",
          message: t("traces.traceDetailsSidebar.failedToCopyContent"),
        });
      }
    };

    // Helper function to check if content exists
    const hasContent = (content: any) => {
      // Check for null, undefined
      if (content === null || content === undefined) return false;

      // Check for empty or "null" string (case insensitive)
      if (typeof content === "string") {
        const trimmed = content.trim();
        if (trimmed === "" || trimmed.toLowerCase() === "null") return false;
      }

      // Check for empty arrays
      if (Array.isArray(content) && content.length === 0) return false;

      // Check for empty objects (but not arrays or objects with properties)
      if (
        typeof content === "object" &&
        !Array.isArray(content) &&
        Object.keys(content).length === 0
      )
        return false;

      // Check if JSON stringified content is null/empty
      try {
        const stringified = JSON.stringify(content);
        if (
          stringified === "null" ||
          stringified === "{}" ||
          stringified === "[]"
        )
          return false;
      } catch (e) {
        // If stringify fails, continue with other checks
      }

      return true;
    };

    const parsedSystemInstructions = computed(() => {
      const raw = props.span?.gen_ai_system_instructions;
      if (!raw) return null;
      try {
        let parsed;
        if (typeof raw === "string") {
          parsed = JSON.parse(raw);
        } else {
          parsed = raw;
        }
        if (Array.isArray(parsed)) {
          return parsed
            .filter((p: any) => p.type === "text" && p.content)
            .map((p: any) => p.content)
            .join("\n") || null;
        }
        return null;
      } catch {
        return typeof raw === "string" ? raw : null;
      }
    });

    // Toggle fullscreen for both Input and Output side by side
    const toggleFullscreen = () => {
      if (ioContainerRef.value) {
        domToggleFullScreen(ioContainerRef.value)
          .then(() => {
            // Check if this specific element is now fullscreen
            nextTick(() => {
              isFullscreen.value =
                document.fullscreenElement === ioContainerRef.value;
            });
          })
          .catch((err: any) => {
            console.error("Failed to toggle fullscreen:", err);
          });
      }
    };

    // Listen for fullscreen changes (e.g., when user presses Escape)
    onMounted(() => {
      const handleFullscreenChange = () => {
        // Check if the IO container is in fullscreen
        isFullscreen.value =
          document.fullscreenElement === ioContainerRef.value;
      };

      // Listen to fullscreen change events
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      document.addEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
      document.addEventListener("mozfullscreenchange", handleFullscreenChange);
      document.addEventListener("MSFullscreenChange", handleFullscreenChange);

      // Cleanup listeners on unmount
      onUnmounted(() => {
        document.removeEventListener(
          "fullscreenchange",
          handleFullscreenChange,
        );
        document.removeEventListener(
          "webkitfullscreenchange",
          handleFullscreenChange,
        );
        document.removeEventListener(
          "mozfullscreenchange",
          handleFullscreenChange,
        );
        document.removeEventListener(
          "MSFullscreenChange",
          handleFullscreenChange,
        );
      });
    });

    // Format model parameters for display
    const formatModelParams = (params: any) => {
      return formatModelParameters(params);
    };

    const serviceIconUrl = computed(() =>
      getServiceIconDataUrl(
        props.span?.service_name ?? "",
        store.state.theme === "dark",
        props.span
          ? getOrSetServiceColor(resolveSpanIdentity(props.span))
          : "#9e9e9e",
      ),
    );

    const copyContentToClipboard = (log: any) => {
      copyToClipboard(JSON.stringify(log), {
        successMessage: t("traces.traceDetailsSidebar.contentCopied"),
        timeout: 1000,
      });
    };

    return {
      t,
      activeTab,
      filterActions,
      closeSidebar,
      eventColumns,
      eventsWrap,
      eventsTableColumns,
      handleEventsColumnOrder,
      handleEventsColumnSizes,
      pagination,
      spanDetails,
      store,
      tags,
      hasExceptionEvents,
      hasSpanError,
      spanHttpResendCount,
      navigateToError,
      getDuration,
      getTTFT,
      viewSpanLogs,
      getStartTime,
      copySpanId,
      copyAttributesToClipboard,
      openReferenceTrace,
      onLinkRowKeydown,
      spanLinks,
      linkColumns,
      getTagRows,
      tagColumns,
      getFilterValue,
      attributesForDisplay,
      attributesViewMode,
      attributesTableColumns,
      attributesTableRows,
      highlightTextMatch,
      highlightedJSON,
      // Correlation
      correlationLoading,
      correlationError,
      correlationProps,
      metricGroupResources,
      config,
      // LLM
      isLLMSpan,
      hasDbSpan,
      llmMetrics,
      copyContent,
      formatModelParams,
      getObservationTypeColor,
      hasContent,
      sysInstrOpen,
      modelParamsOpen,
      parsedSystemInstructions,
      ioContainerRef,
      isFullscreen,
      toggleFullscreen,
      isDarkMode,
      isViewLogsDisabled,
      viewLogsTooltipContent,
      serviceIconUrl,
      getImageURL,
      copyContentToClipboard,
    };
  },
});
</script>

<style>
.attributes-view-toggle .q-btn {
  padding: 0.25rem 0.5rem;
}

.span_details_tab-panels .o-tab-panel {
  height: 100%;
}

.traces-correlated-metrics-container .q-splitter--vertical .q-splitter__separator {
  height: 100% !important;
}

.traces-correlated-metrics-container .q-card {
  box-shadow: none !important;
  border: 1px solid var(--o2-border) !important;
}

.traces-correlated-metrics-container .card-container {
  box-shadow: none !important;
}

.traces-correlated-metrics-container .dimension-sidebar {
  padding-left: 0.25rem;
}

.traces-correlated-metrics-container .dimension-sidebar-search-container {
  padding: 0.375rem 0.2rem !important;
}

.traces-correlated-logs-container .logs-table-container .o2-scroll-container {
  height: 100% !important;
}

.traces-events-table-container .table-container {
  border-radius: 0 !important;
}

.trace-detail-tab-table table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(0.625rem);
  border-radius: 0.5rem;
  border: 0.125rem solid rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.trace-detail-tab-table th,
.trace-detail-tab-table td {
  border-bottom: 1px solid var(--color-table-row-divider);
  border-right: 1px solid var(--color-table-row-divider);
  text-align: left;
  padding: 8px !important;
  font-size: 13px;
  word-break: break-word;
  word-wrap: break-word;
  overflow-wrap: break-word;
  min-height: 24px;
  height: auto;
  max-width: 600px;
}

/* Add proper column sizing */
.trace-detail-tab-table th:first-child,
.trace-detail-tab-table td:first-child {
  width: 200px;
  min-width: 200px;
}

.trace-detail-tab-table th:nth-child(2),
.trace-detail-tab-table td:nth-child(2) {
  width: auto;
  min-width: 100px;
}

.trace-detail-tab-table td span {
  display: inline-block;
  width: 100%;
  word-break: break-word;
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.trace-detail-tab-table th:last-child,
.trace-detail-tab-table td:last-child {
  border-right: none;
}

.trace-detail-tab-table tr:last-child td {
  border-bottom: none;
}

.trace-detail-tab-table tbody tr:first-child td:first-child {
  border-top-left-radius: 0.5rem;
}

.trace-detail-tab-table tbody tr:first-child td:last-child {
  border-top-right-radius: 0.5rem;
}

.trace-detail-tab-table tbody tr:last-child td:first-child {
  border-bottom-left-radius: 0.5rem;
}

.trace-detail-tab-table tbody tr:last-child td:last-child {
  border-bottom-right-radius: 0.5rem;
}

.trace-detail-tab-table table.q-table {
  background: var(--color-surface-base);
  backdrop-filter: blur(0.625rem);
  border: 0.125rem solid var(--color-table-header-border);
}

.table-header .table-head-chip {
  padding: 0px;
}

.table-header .table-head-chip .q-table th.sortable {
  cursor: pointer;
  text-transform: capitalize;
  font-weight: bold;
}

.table-header.isClosable {
  padding-right: 26px;
  position: relative;
}

.table-header.isClosable .q-table-col-close {
  transform: translateX(26px);
  position: absolute;
  margin-top: 2px;
  color: grey;
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
}

.table-header .q-table th.sortable {
  cursor: pointer;
  text-transform: capitalize;
  font-weight: bold;
}

.table-header .log_json_content {
  white-space: pre-wrap;
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
}

.q-td .expanded {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-all;
}

/* Hide filter action buttons until the row is hovered */
.filter-cell .filter-actions {
  visibility: hidden;
}

.filter-cell:hover .filter-actions {
  visibility: visible;
}

.cell-with-max-height .cell-content {
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
  word-break: break-word;
  word-wrap: break-word;
  white-space: pre-wrap;
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

/* Trace Details Toolbar - Modern Styling */
.trace-details-toolbar-container .toolbar-chip {
  font-size: 11px;
  height: 22px;
  padding: 0 6px;
  background: white;
  border: 1px solid #dee2e6;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.trace-details-toolbar-container .toolbar-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.trace-details-toolbar-container .toolbar-chip .chip-label {
  color: #6c757d;
  font-size: 10px;
  font-weight: 500;
  margin-right: 3px;
}

.trace-details-toolbar-container .toolbar-chip .chip-value {
  color: #212529;
  font-weight: 600;
  font-size: 10px;
}

.trace-details-toolbar-container .toolbar-chip.service-chip {
  border-left: 3px solid #0d6efd;
}

.trace-details-toolbar-container .toolbar-chip.duration-chip {
  border-left: 3px solid #6610f2;
}

.trace-details-toolbar-container .toolbar-chip.ttft-chip {
  border-left: 3px solid #6f42c1;
}

.trace-details-toolbar-container .toolbar-chip.time-chip {
  border-left: 3px solid #d63384;
}

.trace-details-toolbar-container .toolbar-chip.span-id-chip {
  border-left: 3px solid #20c997;
  cursor: pointer;
}

.trace-details-toolbar-container .toolbar-chip.span-id-chip .copy-icon {
  opacity: 0.6;
  transition: opacity 0.2s;
}

.trace-details-toolbar-container .toolbar-chip.span-id-chip:hover .copy-icon {
  opacity: 1;
}

.trace-details-toolbar-container .view-logs-btn {
  height: 24px;
  font-size: 10px;
  font-weight: 600;
  padding: 0 10px;
  border-radius: 4px;
  text-transform: none;
  flex-shrink: 0;
}

/* Scrollbar styling for horizontal scroll */
.trace-details-toolbar-container > div::-webkit-scrollbar {
  height: 4px;
}

.trace-details-toolbar-container > div::-webkit-scrollbar-track {
  background: transparent;
}

.trace-details-toolbar-container > div::-webkit-scrollbar-thumb {
  background: #cbd5e0;
  border-radius: 2px;
}

.trace-details-toolbar-container > div::-webkit-scrollbar-thumb:hover {
  background: #a0aec0;
}

/* LLM Chips - Modern Styling (now integrated into toolbar) */
.trace-details-toolbar-container .llm-chip {
  font-size: 10px;
  height: 20px;
  padding: 0 6px;
  background: white;
  border: 1px solid #dee2e6;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.trace-details-toolbar-container .llm-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.trace-details-toolbar-container .llm-chip .chip-value {
  font-size: 10px;
  font-weight: 500;
}

.trace-details-toolbar-container .llm-chip.model-chip {
  border-left: 3px solid #ab47bc;
}

.trace-details-toolbar-container .llm-chip.model-chip .chip-value {
  color: #4a148c;
  font-weight: 600;
}

.trace-details-toolbar-container .llm-chip.token-chip {
  min-width: 60px;
  justify-content: center;
}

.trace-details-toolbar-container .llm-chip.token-chip .chip-label {
  font-size: 9px;
  font-weight: 500;
  margin-right: 2px;
}

.trace-details-toolbar-container .llm-chip.token-chip.input-token-chip {
  border-left: 3px solid #42a5f5;
}

.trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .OIcon,
.trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .chip-label,
.trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .chip-value {
  color: #1565c0;
}

.trace-details-toolbar-container .llm-chip.token-chip.output-token-chip {
  border-left: 3px solid #66bb6a;
}

.trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .OIcon,
.trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .chip-label,
.trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .chip-value {
  color: #2e7d32;
}

.trace-details-toolbar-container .llm-chip.cost-chip {
  border-left: 3px solid #ef6c00;
}

.trace-details-toolbar-container .llm-chip.cost-chip .chip-value {
  color: #e65100;
  font-weight: 600;
}

.trace-details-toolbar-container .tokens-group {
  display: inline-flex;
  gap: 3px;
  flex-shrink: 0;
}

.trace-details-toolbar-container .provider-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

/* Scrollbar styling for horizontal scroll in llm-metrics-row */
.trace-details-toolbar-container .llm-metrics-row::-webkit-scrollbar {
  height: 4px;
}

.trace-details-toolbar-container .llm-metrics-row::-webkit-scrollbar-track {
  background: transparent;
}

.trace-details-toolbar-container .llm-metrics-row::-webkit-scrollbar-thumb {
  background: #cbd5e0;
  border-radius: 2px;
}

.trace-details-toolbar-container .llm-metrics-row::-webkit-scrollbar-thumb:hover {
  background: #a0aec0;
}

/* Dark Mode Styles */
body.body--dark .trace-details-toolbar-container {
  background: rgba(45, 55, 72, 0.5);
  border-bottom-color: #4a5568;
}

body.body--dark .trace-details-toolbar-container .llm-metrics-row {
  border-top-color: #4a5568 !important;
}

body.body--dark .trace-details-toolbar-container .toolbar-chip {
  background: #1a202c;
  border-color: #4a5568;
  color: #e2e8f0;
}

body.body--dark .trace-details-toolbar-container .toolbar-chip .chip-label {
  color: #a0aec0;
}

body.body--dark .trace-details-toolbar-container .toolbar-chip .chip-value {
  color: #e2e8f0;
}

body.body--dark .trace-details-toolbar-container .toolbar-chip:hover {
  background: #2d3748;
}

body.body--dark .trace-details-toolbar-container .llm-chip {
  background: #1a202c;
  border-color: #4a5568;
}

body.body--dark .trace-details-toolbar-container .llm-chip .chip-value {
  color: #e2e8f0;
}

body.body--dark .trace-details-toolbar-container .llm-chip.model-chip {
  border-left: 3px solid #ab47bc;
}

body.body--dark .trace-details-toolbar-container .llm-chip.model-chip .chip-value {
  color: #e9d8fd;
}

body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.input-token-chip {
  border-left: 3px solid #42a5f5;
}

body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .OIcon,
body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .chip-label,
body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.input-token-chip .chip-value {
  color: #90cdf4;
}

body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.output-token-chip {
  border-left: 3px solid #66bb6a;
}

body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .OIcon,
body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .chip-label,
body.body--dark .trace-details-toolbar-container .llm-chip.token-chip.output-token-chip .chip-value {
  color: #9ae6b4;
}

body.body--dark .trace-details-toolbar-container .llm-chip.cost-chip {
  border-left: 3px solid #ef6c00;
}

body.body--dark .trace-details-toolbar-container .llm-chip.cost-chip .chip-value {
  color: #fed7aa;
}

body.body--dark .trace-details-toolbar-container .provider-badge {
  background: linear-gradient(135deg, #2b6cb0 0%, #2c5282 100%);
}

.llm-preview-container .section-label {
  color: var(--o2-text-primary);
  font-size: 14px;
  margin-bottom: 0.5rem;
}

.llm-preview-container .io-section {
  flex: 0 0 calc(50% - 0.4rem);
  display: flex;
  flex-direction: column;
  height: 100%;
}

.llm-preview-container .llm-content-box {
  flex: 1;
  height: 100%;
  max-height: calc(100% - 1.625rem);
  border: 1px solid var(--o2-border-color);
  border-radius: 4px;
  padding: 0.75rem;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--o2-code-bg);
}

.llm-preview-container .llm-content-box .plain-text-content:hover {
  background-color: rgba(0, 0, 0, 0.04) !important;
}

.llm-preview-container .llm-content-box .vjs-tree *:hover {
  background-color: transparent !important;
}

.llm-preview-container .no-data-message {
  color: var(--o2-text-secondary);
  font-style: italic;
  text-align: center;
  padding: 2rem;
  font-size: 14px;
}

.llm-preview-container .io-container:fullscreen {
  background-color: #f5f5f5;
  padding: 0.75rem;
  height: 100vh;
  max-height: 100vh;
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.llm-preview-container .io-container:fullscreen .io-section {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.llm-preview-container .io-container:fullscreen .io-section .section-label {
  background: #f5f5f5;
  border-radius: 4px;
}

.llm-preview-container .io-container:fullscreen .io-section .llm-content-box {
  height: calc(100vh - 80px);
  max-height: unset;
  min-height: unset;
}

.llm-preview-container .io-container-dark:fullscreen {
  background: #1e1e1e;
}

.llm-preview-container .io-container-dark:fullscreen .io-section .section-label {
  background: #1e1e1e;
  color: var(--o2-border);
}

.llm-preview-container .io-container-dark .llm-content-box .plain-text-content:hover {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

.llm-preview-container .io-container-dark .llm-content-box .vjs-tree *:hover {
  background-color: transparent !important;
}

.llm-preview-container .model-params-json {
  background-color: var(--o2-code-bg);
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
  font-family: monospace;
  font-size: 12px;
  margin: 0;
}
</style>

<style>
.span_details_tabs .q-tab__indicator {
  display: none;
}

.span_details_tabs .q-tab--active {
  border-bottom: 1px solid var(--q-primary);
}

.span_details_tab-panels .q-tab-panel {
  padding: 8px 8px 8px 8px;
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
}

.view-span-logs-btn .q-btn__content {
  display: flex;
  align-items: center;
  font-size: 12px;
}

.highlight {
  background-color: yellow; /* Adjust background color as desired */
}
</style>

<style>
/* Dark theme support for glassmorphic tables */
.body--dark .trace-detail-tab-table table {
  /* background: rgba(255, 255, 255, 0.05); */
  /* border: 0.125rem solid rgba(255, 255, 255, 0.3); */
}

.body--dark .trace-detail-tab-table th,
.body--dark .trace-detail-tab-table td {
  border-bottom: 1px solid var(--color-table-row-divider);
  border-right: 1px solid var(--color-table-row-divider);
}

/* Light theme support for glassmorphic tables */
.body--light .trace-detail-tab-table table {
  /* background: rgba(240, 240, 245, 0.8); */
  /* border: 0.125rem solid rgba(100, 100, 120, 0.5); */
}

.body--light .trace-detail-tab-table th,
.body--light .trace-detail-tab-table td {
  border-bottom: 1px solid var(--color-table-row-divider);
  border-right: 1px solid var(--color-table-row-divider);
}

.trace-detail-tab-table th {
  background-color: #f5f5f5 !important;
}

.body--dark .trace-detail-tab-table th {
  background-color: #424242 !important;
}
</style>
