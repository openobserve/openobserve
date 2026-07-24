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
  <div class="trace-details-sidebar flex flex-col h-full">
    <div
      class="flex justify-start items-center px-page-edge h-8 border-b border-solid border-b-card-glass-border bg-surface-panel"
      data-test="trace-details-sidebar-header"
    >
      <div
        :title="span.operation_name"
        class="w-[calc(100%-1.5rem)] pb-0 pl-1 truncate flex items-center"
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
            class="mr-1 text-status-error-text!"
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
      class="trace-details-toolbar-container bg-surface-panel/50 whitespace-nowrap"
      data-test="trace-details-sidebar-header-toolbar"
    >
      <!-- Row 1: Trace Details -->
      <div class="flex items-center justify-between p-1 overflow-x-auto flex-nowrap">
        <div class="flex items-center flex-nowrap">
          <!-- Service Badge -->
          <OTag
            type="metricChip"
            class="text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-blue-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="span.service_name"
            data-test="trace-details-sidebar-header-toolbar-service"
          >
            <template #icon>
              <img
                :src="serviceIconUrl"
                class="w-3.5 h-3.5 shrink-0"
                aria-hidden="true"
                alt=""
              />
            </template>
            <span class="text-3xs font-medium mr-0.75 text-text-secondary">{{ t('traces.traceDetailsSidebar.service') }}</span>
            <span
              class="text-3xs font-semibold text-text-body"
              data-test="trace-details-sidebar-header-toolbar-service-name"
            >
              {{ span.service_name }}
            </span>
          </OTag>

          <!-- Duration Badge -->
          <OTag
            type="metricChip"
            class="text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-indigo-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="getDuration"
            data-test="trace-details-sidebar-header-toolbar-duration"
          >
            <template #icon><OIcon name="schedule" size="xs" /></template>
            <span class="text-3xs font-medium mr-0.75 text-text-secondary">{{ t('traces.traceDetailsSidebar.duration') }}</span>
            <span class="text-3xs font-semibold text-text-body">{{ getDuration }}</span>
          </OTag>

          <!-- TTFT Badge -->
          <OTag
            v-if="getTTFT"
            type="metricChip"
            class="text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-purple-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="getTTFT"
            data-test="trace-details-sidebar-header-toolbar-ttft"
          >
            <template #icon><OIcon name="speed" size="xs" /></template>
            <span class="text-3xs font-medium mr-0.75 text-text-secondary">{{ t('traces.traceDetailsSidebar.ttft') }}</span>
            <span class="text-3xs font-semibold text-text-body">{{ getTTFT }}</span>
          </OTag>

          <!-- Start Time Badge -->
          <OTag
            type="metricChip"
            class="text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-amber-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="getStartTime"
            data-test="trace-details-sidebar-header-toolbar-start-time"
          >
            <template #icon><OIcon name="access-time" size="xs" /></template>
            <span class="text-3xs font-medium mr-0.75 text-text-secondary">{{ t('traces.traceDetailsSidebar.start') }}</span>
            <span class="text-3xs font-semibold text-text-body">{{ getStartTime }}</span>
          </OTag>

          <!-- Resend Count Badge -->
          <OTag
            v-if="spanHttpResendCount"
            type="metricChip"
            class="text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default shrink-0 transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="t('traces.traceDetailsSidebar.requestResent', { count: spanHttpResendCount })"
            data-test="trace-details-sidebar-header-toolbar-resend-count"
          >
            <template #icon><OIcon name="replay" size="xs" /></template>
            <span class="text-3xs font-medium mr-0.75 text-text-secondary">{{ t('traces.traceDetailsSidebar.resends') }}</span>
            <span class="text-3xs font-semibold text-text-body">{{ spanHttpResendCount }}</span>
          </OTag>
        </div>

        <div class="flex items-center">
          <!-- Span ID Badge -->
          <OTag
            type="metricChip"
            clickable
            class="group text-2xs h-5.5 px-1.5 mr-[0.325rem] bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-teal-ol-border shrink-0 cursor-pointer transition-all duration-200 hover:-translate-y-px hover:bg-surface-panel"
            :title="t('traces.traceDetailsSidebar.spanIdTitle', { id: span.span_id })"
            @click="copySpanId"
            data-test="trace-details-sidebar-header-toolbar-span-id"
          >
            <template #icon><OIcon name="tag" size="xs" /></template>
            <span class="text-3xs font-semibold text-text-body">{{ span.span_id }}</span>
            <OIcon
              name="content-copy"
              size="xs"
              class="ml-1 opacity-60 transition-opacity duration-200 group-hover:opacity-100"
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
                class="h-full text-xs!"
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
        class="flex items-center justify-between p-1 llm-metrics-row overflow-x-auto flex-nowrap border-t border-solid border-border-default"
      >
        <div class="flex items-center flex-nowrap">
          <!-- Model Chip -->
          <OTag
            type="metricChip"
            icon="psychology"
            class="text-3xs h-5 px-1.5 bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-purple-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px"
            :title="span.gen_ai_response_model"
          >
            <span class="text-3xs font-semibold text-badge-purple-ol-text">{{ span.gen_ai_response_model }}</span>
          </OTag>

          <!-- Token Usage Group -->
          <div class="inline-flex gap-0.75 shrink-0">
            <!-- Input Tokens -->
            <OTag
              type="metricChip"
              class="text-3xs h-5 px-1.5 min-w-15 justify-center bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-blue-ol-border text-badge-blue-ol-text shrink-0 transition-all duration-200 hover:-translate-y-px"
              :title="t('traces.traceDetailsSidebar.inputTokens')"
            >
              <template #icon><OIcon name="arrow-upward" size="xs" /></template>
              <span class="text-3xs font-medium mr-0.5">{{ t('traces.traceDetailsSidebar.in') }}</span>
              <span class="text-3xs font-medium">{{ llmMetrics.usage.input }}</span>
            </OTag>

            <!-- Output Tokens -->
            <OTag
              type="metricChip"
              class="text-3xs h-5 px-1.5 min-w-15 justify-center bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-success-ol-border text-badge-success-ol-text shrink-0 transition-all duration-200 hover:-translate-y-px"
              :title="t('traces.traceDetailsSidebar.outputTokens')"
            >
              <template #icon><OIcon name="arrow-downward" size="xs" /></template>
              <span class="text-3xs font-medium mr-0.5">{{ t('traces.traceDetailsSidebar.out') }}</span>
              <span class="text-3xs font-medium">{{ llmMetrics.usage.output }}</span>
            </OTag>
          </div>

          <!-- Cost Chip -->
          <OTag
            type="metricChip"
            icon="attach-money"
            class="text-3xs h-5 px-1.5 bg-surface-base border border-solid border-border-default border-l-[0.1875rem] border-l-badge-orange-ol-border shrink-0 transition-all duration-200 hover:-translate-y-px"
            :title="t('traces.traceDetailsSidebar.totalCost')"
          >
            <span class="text-3xs font-semibold text-badge-orange-ol-text"
              >{{ t('traces.sessionDetail.currencySymbol') }}{{ Number(llmMetrics.cost.total).toFixed(5) }}</span
            >
          </OTag>
        </div>

        <div class="flex items-center">
          <!-- Provider Badge -->
          <OTag
            v-if="span.gen_ai_provider_name"
            type="metricChip"
            class="text-3xs font-semibold px-2 py-0.75 bg-badge-blue-solid-bg text-badge-blue-solid-text rounded-full uppercase tracking-wide shrink-0"
          >{{ span.gen_ai_provider_name }}</OTag>
        </div>
      </div>
    </div>

    <div class="px-page-edge span_details_tabs">
      <OTabs
        :model-value="activeTab"
        @update:model-value="$emit('update:activeTab', $event)"
        dense
        align="left"
        data-test="trace-details-sidebar-tabs"
      >
        <!-- LLM Preview Tab (conditional - shown first for LLM traces) -->
        <OTab
          v-if="canPreviewSpan"
          name="preview"
          :label="t('traces.traceDetailsSidebar.preview')"
          data-test="trace-details-sidebar-tabs-preview"
                    class="font-normal! capitalize"

        />

        <OTab
          name="attributes"
          :label="t('common.attributes')"
          data-test="trace-details-sidebar-tabs-attributes"
          class="font-normal! capitalize"
        />
        <OTab
          name="error"
          data-test="trace-details-sidebar-tabs-error"
          class="font-normal! gap-1! capitalize"
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
          class="font-normal! capitalize"
          data-test="trace-details-sidebar-tabs-database"
        />
        <OTab
          name="events"
          :label="t('common.events')"
          data-test="trace-details-sidebar-tabs-events"
                    class="font-normal! capitalize"

        />
        <OTab
          name="links"
          :label="t('common.links')"
          data-test="trace-details-sidebar-tabs-links"
          class="font-normal! capitalize"

        />
        <!-- Correlation Tabs (only visible when service streams enabled and enterprise license) -->
        <OTab
          v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
          name="correlated-logs"
          :label="t('correlation.correlatedLogs')"
          data-test="trace-details-sidebar-tabs-correlated-logs"
          class="font-normal! capitalize"

        />
        <OTab
          v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
          name="correlated-metrics"
          :label="t('correlation.correlatedMetrics')"
          data-test="trace-details-sidebar-tabs-correlated-metrics"
          class="font-normal! capitalize"
        />
      </OTabs>
    </div>
    <OSeparator class="w-full" />
    <div
      class="span_details_tab-panels h-[calc(100%-6rem)] overflow-hidden"
      :class="
        activeTab === 'correlated-logs' || activeTab === 'correlated-metrics'
          ? ''
          : 'px-page-edge py-2'
      "
    >
      <OTabPanels :model-value="activeTab"
@update:model-value="$emit('update:activeTab', $event)"
grow
class="h-full overflow-y-auto">
        <!-- LLM Preview Tab Panel -->
        <OTabPanel
          v-if="canPreviewSpan"
          name="preview"
          class="llm-preview-panel p-3"
        >
          <div class="llm-preview-container overflow-hidden overflow-x-auto w-full h-full!">
            <!-- Input and Output Side by Side -->
            <div
              class="flex io-container w-full! h-full!"
              ref="ioContainerRef"
            >
              <!-- Input Section -->
              <div class="w-1/2 io-section basis-[calc(50%-0.4rem)] grow-0 shrink-0 flex flex-col h-full pr-2">
                <div
                  class="section-label font-bold mb-2 flex items-center justify-between text-text-heading text-sm"
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
                      @click="copyContent(previewInput, 'input')"
                      :disabled="!hasContent(previewInput)"
                    >
                      <OIcon name="content-copy" size="xs" />
                    </OButton>
                  </div>
                </div>
                <div class="llm-content-box flex-1 h-full max-h-[calc(100%-1.625rem)] border border-solid border-card-glass-border rounded-default p-3 overflow-y-auto overflow-x-hidden bg-code-bg">
                  <!-- System Instructions (when available) -->
                  <div v-if="parsedSystemInstructions" class="mb-3">
                    <OCollapsible
                      v-model="sysInstrOpen"
                      icon="settings"
                      :label="t('traces.traceDetailsSidebar.systemInstructions')"
                    >
                      <div class="p-2 bg-code-bg">
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
                    v-if="!hasContent(previewInput) && !parsedSystemInstructions"
                    class="text-text-secondary italic text-center p-8 text-sm"
                  >
                    {{ t('traces.traceDetailsSidebar.noDataAvailable') }}
                  </div>
                  <LLMContentRenderer
                    v-if="hasContent(previewInput)"
                    :content="previewInput"
                    :observation-type="previewOperationName"
                    content-type="input"
                    :span="span"
                    view-mode="formatted"
                    :instance-id="`${span.span_id}-input`"
                  />
                </div>
              </div>

              <!-- Output Section -->
              <div class="w-1/2 io-section basis-[calc(50%-0.4rem)] grow-0 shrink-0 flex flex-col h-full">
                <div
                  class="section-label font-bold mb-2 flex items-center justify-between text-text-heading text-sm"
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
                      @click="copyContent(previewOutput, 'output')"
                      :disabled="!hasContent(previewOutput)"
                    >
                      <OIcon name="content-copy" size="xs" />
                    </OButton>
                  </div>
                </div>
                <div class="llm-content-box flex-1 h-full max-h-[calc(100%-1.625rem)] border border-solid border-card-glass-border rounded-default p-3 overflow-y-auto overflow-x-hidden bg-code-bg">
                  <div
                    v-if="!hasContent(previewOutput)"
                    class="text-text-secondary italic text-center p-8 text-sm"
                  >
                    {{ t('traces.traceDetailsSidebar.noDataAvailable') }}
                  </div>
                  <LLMContentRenderer
                    v-else
                    :content="previewOutput"
                    :observation-type="previewOperationName"
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
              <pre class="bg-code-bg p-4 rounded-default overflow-x-auto font-mono text-xs m-0">{{
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
            <OToggleGroup v-model="attributesViewMode" class="rounded-default!">
              <OToggleGroupItem value="json"
size="xs"
class="h-5! text-xs!">
                <template #icon-left
                  ><OIcon name="data-object" size="xs" class="shrink-0"
                /></template>
                {{ t('common.json') }}
              </OToggleGroupItem>
              <OToggleGroupItem value="table"
size="xs"
class="h-5! text-xs!">
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
                    <span class="text-sm!">{{
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
            class="flex-1 overflow-hidden tab-content-dynamic-height border-1 border-solid border-card-glass-border"
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
                        <span class="text-sm!">{{
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
              class="flex-1 traces-events-table-container overflow-hidden tab-content-dynamic-height border-1 border-solid border-card-glass-border rounded-default"
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
                    class="py-1.5 pl-1.5"
                    copyButtonClass="left-1! w-fit! sticky!"
                    mode="expanded"
                  />
                </template>
              </TenstackTable>
            </div>
          </template>
          <OEmptyState
            v-else
            size="inline"
            variant="no-results"
            :title="t('traces.noEventsPresent')"
            hide-action
            data-test="trace-details-sidebar-no-events"
          />
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
          <div v-if="spanLinks.length" class="overflow-auto max-h-80">
            <table
              class="trace-detail-tab-table border border-solid border-card-glass-border w-full"
              data-test="trace-details-sidebar-links-table"
            >
              <thead
                class="thead-sticky text-left bg-surface-accent"
              >
                <tr>
                  <th
                    v-for="(col, index) in linkColumns"
                    :key="'result_' + index"
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
                  class="pointer cursor-pointer focus-visible:outline-none focus-visible:bg-surface-accent"
                >
                  <td
                    v-for="column in linkColumns"
                    :key="index + '-' + column.name"
                    class="p-0 mb-0.5 relative overflow-visible cursor-pointer"
                  >
                    <div class="flex flex items-center flex-nowrap">
                      {{ column.prop(row) }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <OEmptyState
            v-else
            size="inline"
            variant="no-results"
            :title="t('traces.noLinksPresent')"
            hide-action
            data-test="trace-details-sidebar-no-links"
          />
        </OTabPanel>

        <!-- Correlated Logs Tab Panel -->
        <OTabPanel
          name="correlated-logs"
          class="p-0 h-full max-h-full overflow-hidden traces-correlated-logs-container"
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
            class="flex items-center justify-center py-20 h-full"
          >
            <div class="text-center">
              <OSpinner
                v-if="correlationLoading"
                size="lg"
                class="mb-4"
              />
              <div
                v-else-if="correlationError"
                class="text-sm font-bold"
              >
                {{ correlationError }}
              </div>
              <div v-else class="text-base text-text-muted">
                {{ t("correlation.clickToLoadLogs") }}
              </div>
            </div>
          </div>
        </OTabPanel>

        <!-- Correlated Metrics Tab Panel -->
        <OTabPanel
          name="correlated-metrics"
          class="p-0 h-full max-h-full overflow-hidden traces-correlated-metrics-container"
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
            @close="$emit('update:activeTab', 'attributes')"
          />
          <!-- Loading/Empty state when no data -->
          <div
            v-else
            class="flex items-center justify-center py-20 h-full"
          >
            <div class="text-center">
              <OSpinner
                v-if="correlationLoading"
                size="lg"
                class="mb-4"
              />
              <div
                v-else-if="correlationError"
                class="text-sm font-bold"
              >
                {{ correlationError }}
              </div>
              <div v-else class="text-base text-text-muted">
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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { cloneDeep } from "lodash-es";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { copyToClipboard } from "@/utils/clipboard";
import { toggleFullscreen as domToggleFullScreen } from "@/utils/dom";
import { defineComponent, onBeforeMount, ref, watch, type Ref, type PropType, inject } from "vue";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import {
  formatTimeWithSuffix,
  convertTimeFromNsToUs,
  getImageURL,
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
  hasTracePreview,
  isLLMTrace,
  parseUsageDetails,
  parseCostDetails,
  getObservationTypeColor,
  formatModelParameters,
} from "@/utils/llmUtils";
import { escapeHtml } from "@/utils/html";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import AttributeValueCell from "@/components/AttributeValueCell.vue";
import useTraceDetails from "@/composables/traces/useTraceDetails";
import DbSpanDetails from "./DbSpanDetails.vue";
import TraceErrorTab from "./components/TraceErrorTab.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  TRACE_SERVICE_DETECTION_KEY,
  useSpanServiceDetection,
} from "@/utils/traces/useSpanServiceDetection";
import type { Span } from "@/ts/interfaces/traces/span.types";
import { getOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";

// luxon equivalent of "MMM DD, YYYY HH:mm:ss.SSS Z" → e.g. "Jun 24, 2026 17:39:32.157 +0530"
const HUMAN_TZ_FORMAT = "MMM dd, yyyy HH:mm:ss.SSS ZZZ";

export default defineComponent({
  name: "TraceDetailsSidebar",
  props: {
    span: {
      type: Object as PropType<Span>,
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
    OEmptyState,
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
    const canPreviewSpan = computed(() => hasTracePreview(props.span));
    const previewInput = computed(
      () =>
        props.span?.gen_ai_input_messages ??
        props.span?.attributes_prompt ??
        "",
    );
    const previewOutput = computed(
      () =>
        props.span?.gen_ai_output_messages ??
        props.span?.attributes_response ??
        "",
    );
    const previewOperationName = computed(
      () => props.span?.gen_ai_operation_name ?? "evaluator",
    );

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

    const closeSidebar = () => {
      emit("close");
    };

    const pagination: any = ref({
      rowsPerPage: 0,
    });
    const { buildQueryDetails, navigateToLogs, navigateToCorrelatedLogs, searchObj } = useTraces();
    const router = useRouter();

    const highlightTextMatch = (text: string, query: string): string => {
      if (!query) return escapeHtml(text);
      try {
        // Escape special regex characters
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escapedQuery})`, "gi");
        return escapeHtml(text).replace(
          regex,
          (match) => `<span class="trace-sidebar-highlight">${match}</span>`,
        );
      } catch (e) {
        return escapeHtml(text);
      }
    };

    // Emits class names only — the colours live in the style block below, driven
    // by the registered --color-json-* tokens, so the output themes itself.
    const highlightedJSON = (value: Record<string, unknown>) => {
      const attrs = value;
      const query = props.searchQuery;

      const formatValue = (value: any): string => {
        if (value === null) {
          return `<span class="trace-json-null">${highlightTextMatch("null", query)}</span>`;
        } else if (typeof value === "boolean") {
          return `<span class="trace-json-boolean">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "number") {
          return `<span class="trace-json-number">${highlightTextMatch(String(value), query)}</span>`;
        } else if (typeof value === "string") {
          return `<span class="trace-json-string">"${highlightTextMatch(value, query)}"</span>`;
        } else if (typeof value === "object") {
          return `<span class="trace-json-object">"${highlightTextMatch(JSON.stringify(value), query)}"</span>`;
        }
        return highlightTextMatch(String(value), query);
      };

      const lines: string[] = [];
      lines.push('<span class="trace-json-punct">{</span>');

      const entries = Object.entries(attrs);
      entries.forEach(([key, value], index) => {
        const keyHtml = `<span class="trace-json-key">"${escapeHtml(key)}"</span>`;
        const valueHtml = formatValue(value);
        const comma =
          index < entries.length - 1
            ? '<span class="trace-json-punct">,</span>'
            : "";
        lines.push(
          `  ${keyHtml}<span class="trace-json-punct">:</span> ${valueHtml}${comma}`,
        );
      });

      lines.push('<span class="trace-json-punct">}</span>');
      return lines.join("\n");
    };

    const store = useStore();

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
            "border-b border-r border-b-card-glass-border",
          cellClass:
            "border-r border-b-card-glass-border text-json-key",
        },
      },
      {
        accessorKey: "value",
        id: "value",
        header: t("traces.traceDetailsSidebar.value"),
        size: 400,
        meta: {
          slot: true,
          headerClass: "border-b border-b-card-glass-border",
          cellClass: "border-b-card-glass-border p-0!",
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

    // Get current theme via the sanctioned dark-mode seam
    const { isDark: isDarkMode } = useTheme();

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
              "border-b border-r border-b-card-glass-border",
            cellClass: "border-r border-b-card-glass-border",
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
              "border-b border-r border-b-card-glass-border",
            cellClass: "border-r border-b-card-glass-border",
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
        spanDetails.events = JSON.parse(
          (props.span.events as unknown as string) || "[]",
        ).map((event: any) => event);
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
          // (service_k8s_namespace_name).
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
        isDarkMode.value,
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
      canPreviewSpan,
      previewInput,
      previewOutput,
      previewOperationName,
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

<style lang="scss" scoped>
/* keep(complex-state): Deliberate CSS — generated content the template can't class up,
   child-component internals reached with :deep(), :fullscreen chains, and
   scrollbar rails. */

/* generated-content — highlightedJSON()/highlightTextMatch() build these spans
   as HTML strings, so scoped classes can't reach them; colours come from the
   registered --color-json-* tokens and flip with the theme on their own. */
.trace-details-sidebar {
  :deep(.trace-json-key) {
    color: var(--color-json-key);
  }

  :deep(.trace-json-string) {
    color: var(--color-json-string);
  }

  :deep(.trace-json-number) {
    color: var(--color-json-number);
  }

  :deep(.trace-json-boolean) {
    color: var(--color-json-boolean);
  }

  :deep(.trace-json-null) {
    color: var(--color-json-null);
  }

  :deep(.trace-json-object) {
    color: var(--color-json-object);
  }

  :deep(.trace-json-punct) {
    color: var(--color-text-label);
  }

  :deep(.trace-sidebar-highlight) {
    background-color: var(--color-table-highlight-bg);
  }
}

/* .trace-detail-tab-table is also worn by TraceErrorTab.vue's table, which only
   ever renders inside this sidebar — anchoring under the root keeps both
   reachable without the bare th/td restyle leaking app-wide. */
.trace-details-sidebar :deep(.trace-detail-tab-table) {
  th,
  td {
    border-bottom: 1px solid var(--color-table-row-divider);
    border-right: 1px solid var(--color-table-row-divider);
    text-align: left;
    padding: 0.5rem;
    font-size: var(--text-compact);
    word-break: break-word;
    overflow-wrap: break-word;
    min-height: 1.5rem;
    height: auto;
    max-width: 37.5rem;
  }

  th {
    background-color: var(--color-surface-panel);
  }

  th:first-child,
  td:first-child {
    width: 12.5rem;
    min-width: 12.5rem;
  }

  th:nth-child(2),
  td:nth-child(2) {
    width: auto;
    min-width: 6.25rem;
  }

  th:last-child,
  td:last-child {
    border-right: none;
  }

  tr:last-child td {
    border-bottom: none;
  }

  td span {
    display: inline-block;
    width: 100%;
    word-break: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }

  tbody tr:first-child {
    td:first-child {
      border-top-left-radius: var(--radius-surface);
    }

    td:last-child {
      border-top-right-radius: var(--radius-surface);
    }
  }

  tbody tr:last-child {
    td:first-child {
      border-bottom-left-radius: var(--radius-surface);
    }

    td:last-child {
      border-bottom-right-radius: var(--radius-surface);
    }
  }
}

/* scrollbar — both toolbar rows overflow horizontally */
.trace-details-toolbar-container > div {
  &::-webkit-scrollbar {
    height: 0.25rem;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar-thumb);
    border-radius: 0.125rem;

    &:hover {
      background: var(--color-scrollbar-thumb-hover);
    }
  }
}

/* complex-state — :fullscreen chains on the LLM input/output panes */
.llm-preview-container {
  .io-container:fullscreen {
    background-color: var(--color-surface-panel);
    padding: 0.75rem;
    height: 100vh;
    max-height: 100vh;
    display: flex;
    gap: 0.5rem;
    align-items: stretch;

    .io-section {
      flex: 1;
      display: flex;
      flex-direction: column;

      .section-label {
        background: var(--color-surface-panel);
        border-radius: var(--radius-default);
      }

      .llm-content-box {
        height: calc(100vh - 5rem);
        max-height: unset;
        min-height: unset;
      }
    }
  }

  /* generated-content — LLMContentRenderer output rendered inside the box */
  :deep(.llm-content-box .plain-text-content:hover) {
    background-color: var(--color-interactive-hover-bg) !important;
  }

  /* lib-override:vue-json-pretty — suppress the library's own row hover */
  :deep(.llm-content-box .vjs-tree *:hover) {
    background-color: transparent !important;
  }
}

/* child-component internals */
.span_details_tab-panels :deep(.o-tab-panel) {
  height: 100%;
}

.traces-correlated-metrics-container {
  :deep(.dimension-sidebar) {
    padding-left: 0.25rem;
  }

  :deep(.dimension-sidebar-search-container) {
    padding: 0.375rem 0.2rem !important;
  }
}

.traces-correlated-logs-container :deep(.logs-table-container .o2-scroll-container) {
  height: 100% !important;
}

.traces-events-table-container :deep(.table-container) {
  border-radius: 0 !important;
}
/* sticky header cells for the links table — position:sticky must sit on the
   cells (tr > *), not the <thead>, so it cannot be a utility on the thead
   element this template owns. */
.thead-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
  background: var(--color-grey-200);
}

.thead-sticky tr:last-child > * {
  top: 0;
}
</style>
