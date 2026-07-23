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
  <div class="step-query-config mx-auto h-full w-full min-w-0 overflow-auto">
    <div
      class="step-content rounded-default bg-surface-overlay border-border-default box-border min-h-full w-full min-w-0 overflow-hidden border"
    >
      <!-- Section header -->
      <div
        class="section-header border-border-default flex items-center gap-0 border-b px-3 py-2.5"
      >
        <div
          class="section-header-accent rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0"
        />
        <span
          class="section-header-title text-compact text-text-heading font-semibold tracking-[0.01em]"
          >{{ t("alerts.queryConfig.sectionTitle") }}</span
        >
      </div>
      <!-- Descendant step: the AddAlert orchestrator owns the ONE <OForm> and
           provides FORM_CONTEXT_KEY. The OForm* fields below bind by nested
           `name=` (trigger_condition.*, query_condition.*, logGroupBy[]) into that
           form; the composed schema in AddAlert.schema.ts validates them on save.
           Non-form widgets (tabs / editors / VRL / FilterGroup) are bridged. -->
      <div class="box-border w-full min-w-0 px-3 py-2">
        <!-- Query Mode Tabs (hidden for real-time alerts) -->
        <div v-if="shouldShowTabs" class="mb-2 flex items-center justify-between">
          <OToggleGroup
            :model-value="localTab"
            @update:model-value="updateTab($event as 'sql' | 'promql' | 'custom')"
            data-test="step2-query-tabs"
          >
            <OToggleGroupItem
              v-for="tab in tabOptions"
              :key="tab.value"
              :value="tab.value"
              :data-test="`query-mode-${tab.value}`"
              size="sm"
            >
              <template #icon-left>
                <OIcon v-if="tab.value === 'custom'" name="build" size="sm" />
                <OIcon v-else-if="tab.value === 'sql'" name="database" size="sm" />
                <OIcon v-else-if="tab.value === 'promql'" name="show-chart" size="sm" />
              </template>
              {{ tab.label }}
            </OToggleGroupItem>
          </OToggleGroup>

          <!-- Open Full Editor (SQL/PromQL tabs) -->
          <OButton
            v-if="localTab !== 'custom'"
            data-test="step2-view-editor-btn"
            variant="outline"
            size="sm"
            @click="viewSqlEditor = true"
          >
            {{ t("alerts.queryConfig.openFullEditor") }}
          </OButton>
        </div>

        <!-- Custom Query Builder -->
        <template v-if="localTab === 'custom'">
          <div>
            <!-- Section 1: Alert condition sentence — scheduled only -->
            <div v-if="isRealTime === 'false'" class="flex flex-col gap-0">
              <!-- LOGS/TRACES -->
              <template v-if="isEventBased">
                <!-- Alert if row -->
                <div
                  class="rounded-default text-compact flex items-start gap-3 px-3 py-2"
                  data-test="alert-if-row-logs"
                >
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                    >{{ t("alerts.threshold") }}*</span
                  >
                  <div class="flex flex-nowrap items-start gap-2">
                    <div class="max-w-45 min-w-32.5">
                      <OSelect
                        v-model="selectedFunction"
                        :options="logFunctionOptions"
                        labelKey="label"
                        valueKey="value"
                        @update:model-value="onLogFunctionChange"
                      />
                      <OTooltip
                        :content="
                          logFunctionOptions.find((o: any) => o.value === selectedFunction)
                            ?.tooltip || ''
                        "
                        :delay="400"
                      />
                    </div>
                    <!-- "of [field]" shown for measure modes -->
                    <template v-if="selectedFunction !== 'total_events'">
                      <span
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{ t("alerts.conditionOf") }}</span
                      >
                      <OFormSelect
                        name="query_condition.aggregation.having.column"
                        :options="numericColumns"
                        searchable
                        :placeholder="t('alerts.placeholders.selectColumn')"
                        :class="['max-w-50 min-w-35']"
                        @update:model-value="onLogMeasureColumnChange($event)"
                      />
                    </template>

                    <!-- COUNT mode -->
                    <template v-if="selectedFunction === 'total_events'">
                      <OFormSelect
                        name="trigger_condition.operator"
                        :options="numericOperators"
                        class="max-w-30 min-w-17.5"
                        data-test="alert-trigger-operator-select"
                        :searchable="false"
                        @update:model-value="onTriggerOperatorChange"
                      />
                      <!-- Message hangs under the threshold field it describes. -->
                      <div class="flex max-w-20 min-w-15 flex-col gap-1">
                        <OFormInput
                          name="trigger_condition.threshold"
                          type="number"
                          data-test="alert-trigger-threshold-input"
                          @blur="restoreDefaultThreshold"
                          min="1"
                          @update:model-value="onTriggerThresholdChange($event)"
                        >
                          <template #error />
                        </OFormInput>
                        <div
                          v-if="thresholdError"
                          class="text-input-error-text text-xs whitespace-nowrap"
                          data-test="alert-if-row-logs-error"
                          role="alert"
                        >
                          {{ thresholdError }}
                        </div>
                      </div>
                      <span
                        v-if="streamName"
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{
                          t("alerts.matchingTypeFound", {
                            type: streamType === "traces" ? "traces" : "logs",
                          })
                        }}</span
                      >
                    </template>

                    <!-- MEASURE mode -->
                    <template v-else>
                      <span
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{ t("alerts.conditionIs") }}</span
                      >
                      <OFormSelect
                        name="query_condition.aggregation.having.operator"
                        :options="numericOperators"
                        :searchable="false"
                        class="max-w-30 min-w-17.5"
                        data-test="alert-condition-operator-select"
                        @update:model-value="onConditionOperatorChange"
                      />
                      <!-- Message hangs under the value field it describes. -->
                      <div class="flex max-w-30 min-w-20 flex-col gap-1">
                        <OFormInput
                          name="query_condition.aggregation.having.value"
                          type="number"
                          :placeholder="t('alerts.placeholders.value')"
                          @update:model-value="onConditionValueChange($event)"
                        >
                          <template #error />
                        </OFormInput>
                        <div
                          v-if="havingValueError"
                          class="text-input-error-text text-xs whitespace-nowrap"
                          data-test="alert-if-row-logs-value-error"
                          role="alert"
                        >
                          {{ havingValueError }}
                        </div>
                      </div>
                    </template>
                  </div>
                </div>

                <!-- group by row (hidden for count mode) -->
                <div
                  v-if="selectedFunction !== 'total_events'"
                  class="rounded-default text-compact flex items-center gap-3 px-3 py-2"
                  data-test="alert-group-by-row"
                >
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 font-bold whitespace-nowrap"
                  >
                    {{ t("alerts.groupBy") }}
                    <OTooltip
                      :content="t('alerts.queryConfig.groupByTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex flex-wrap items-center gap-2">
                    <template v-for="(group, index) in logGroupByRows" :key="index">
                      <div class="flex items-center gap-1">
                        <OFormSelect
                          :name="`logGroupBy[${index}]`"
                          :options="columns"
                          searchable
                          :placeholder="t('alerts.placeholders.selectColumn')"
                          :data-test="`alert-group-by-select-${index}`"
                          @update:model-value="onLogGroupByChange"
                        />
                        <OButton
                          variant="ghost"
                          size="icon-circle-sm"
                          class="text-icon-color hover:text-status-error-text"
                          @click="deleteLogGroupByColumn(index)"
                        >
                          <OIcon name="close" size="sm" />
                        </OButton>
                      </div>
                    </template>
                    <OButton
                      variant="ghost-primary"
                      size="icon-circle-sm"
                      data-test="alert-group-by-add-btn"
                      @click="addLogGroupByColumn"
                    >
                      <OIcon name="add" size="sm" />
                      <OTooltip :content="t('alerts.queryConfig.addGroupByField')" />
                    </OButton>
                  </div>
                </div>

                <!-- no. of groups row — visible only when group-by fields are added -->
                <div
                  v-if="selectedFunction !== 'total_events' && hasLogGroupByFields"
                  class="rounded-default text-compact flex items-start gap-3 px-3 py-2"
                  data-test="alert-having-groups-row"
                >
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                  >
                    {{ t("alerts.queryConfig.havingGroups") }}
                    <OTooltip
                      :content="t('alerts.queryConfig.havingGroupsTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex flex-nowrap items-start gap-2">
                    <OFormSelect
                      name="trigger_condition.operator"
                      :options="numericOperators"
                      :searchable="false"
                      class="max-w-30 min-w-17.5"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <!-- Message hangs under the threshold field it describes. -->
                    <div class="flex max-w-20 min-w-15 flex-col gap-1">
                      <OFormInput
                        name="trigger_condition.threshold"
                        type="number"
                        min="1"
                        @update:model-value="onTriggerThresholdChange($event)"
                        @blur="restoreDefaultThreshold"
                      >
                        <template #error />
                      </OFormInput>
                      <div
                        v-if="thresholdError"
                        class="text-input-error-text text-xs whitespace-nowrap"
                        data-test="alert-having-groups-threshold-error"
                        role="alert"
                      >
                        {{ thresholdError }}
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- METRICS -->
              <template v-else>
                <!-- Alert if row -->
                <div class="rounded-default text-compact flex items-start gap-3 px-3 py-2">
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                    >{{ t("alerts.threshold") }}*</span
                  >
                  <div class="flex flex-nowrap items-start gap-2">
                    <div class="max-w-45 min-w-32.5">
                      <OSelect
                        v-model="selectedFunction"
                        :options="logFunctionOptions"
                        labelKey="label"
                        valueKey="value"
                        @update:model-value="onMetricFunctionChange"
                      />
                      <OTooltip
                        :content="
                          logFunctionOptions.find((o: any) => o.value === selectedFunction)
                            ?.tooltip || ''
                        "
                        :delay="400"
                      />
                    </div>

                    <!-- "of [field]" hidden for count mode -->
                    <template v-if="selectedFunction !== 'total_events'">
                      <span
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{ t("alerts.conditionOf") }}</span
                      >
                      <div class="relative inline-flex">
                        <OFormSelect
                          name="query_condition.aggregation.having.column"
                          :options="columns"
                          searchable
                          :placeholder="t('alerts.placeholders.selectColumn')"
                          :readonly="
                            inputData.aggregation?.having?.column === 'value' &&
                            columns.some(
                              (c: any) => (typeof c === 'string' ? c : c.value) === 'value',
                            )
                          "
                          :disable="
                            inputData.aggregation?.having?.column === 'value' &&
                            columns.some(
                              (c: any) => (typeof c === 'string' ? c : c.value) === 'value',
                            )
                          "
                          @update:model-value="onLogMeasureColumnChange($event)"
                          class="max-w-50 min-w-35"
                        />
                        <OTooltip
                          v-if="
                            inputData.aggregation?.having?.column === 'value' &&
                            columns.some(
                              (c: any) => (typeof c === 'string' ? c : c.value) === 'value',
                            )
                          "
                          :content="t('alerts.metricsValueFieldTooltip')"
                          :delay="300"
                          side="bottom"
                        />
                      </div>
                      <span
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{ t("alerts.conditionIs") }}</span
                      >
                    </template>

                    <!-- Count mode for metrics -->
                    <template v-if="selectedFunction === 'total_events'">
                      <OFormSelect
                        name="trigger_condition.operator"
                        :options="numericOperators"
                        :searchable="false"
                        @update:model-value="onTriggerOperatorChange"
                      />
                      <!-- Message hangs under the threshold field it describes. -->
                      <div class="flex max-w-30 min-w-20 flex-col gap-1">
                        <OFormInput
                          name="trigger_condition.threshold"
                          type="number"
                          @update:model-value="onTriggerThresholdChange($event)"
                        >
                          <template #error />
                        </OFormInput>
                        <div
                          v-if="thresholdError"
                          class="text-input-error-text text-xs whitespace-nowrap"
                          data-test="alert-if-row-metrics-error"
                          role="alert"
                        >
                          {{ thresholdError }}
                        </div>
                      </div>
                      <span
                        class="text-text-secondary text-compact leading-8.5 font-semibold whitespace-nowrap"
                        >{{ t("alerts.matchingMetricsFound") }}</span
                      >
                    </template>

                    <!-- Measure mode for metrics -->
                    <template v-else>
                      <OFormSelect
                        name="query_condition.aggregation.having.operator"
                        :options="numericOperators"
                        :searchable="false"
                        @update:model-value="onConditionOperatorChange"
                      />
                      <!-- Message hangs under the value field it describes. -->
                      <div class="flex max-w-30 min-w-20 flex-col gap-1">
                        <OFormInput
                          name="query_condition.aggregation.having.value"
                          type="number"
                          :placeholder="t('alerts.placeholders.value')"
                          @update:model-value="onConditionValueChange($event)"
                        >
                          <template #error />
                        </OFormInput>
                        <div
                          v-if="havingValueError"
                          class="text-input-error-text text-xs whitespace-nowrap"
                          data-test="alert-if-row-metrics-value-error"
                          role="alert"
                        >
                          {{ havingValueError }}
                        </div>
                      </div>
                    </template>
                  </div>
                </div>

                <!-- group by row — hidden for count mode -->
                <div
                  v-if="inputData.aggregation && selectedFunction !== 'total_events'"
                  class="rounded-default text-compact flex items-center gap-3 px-3 py-2"
                >
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 font-bold whitespace-nowrap"
                  >
                    {{ t("alerts.groupBy") }}
                    <OTooltip
                      :content="t('alerts.queryConfig.groupByTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex flex-wrap items-center gap-2">
                    <template v-for="(group, index) in metricGroupByRows" :key="index">
                      <div class="flex items-center gap-1">
                        <OFormSelect
                          :name="`query_condition.aggregation.group_by[${index}]`"
                          :options="columns"
                          searchable
                          :placeholder="t('alerts.placeholders.selectColumn')"
                          class="max-w-45 min-w-30"
                          @update:model-value="syncMetricGroupByToProps"
                        />
                        <OButton
                          variant="ghost"
                          size="icon-circle-sm"
                          class="text-icon-color hover:text-status-error-text"
                          @click="deleteGroupByColumn(index)"
                        >
                          <OIcon name="close" size="sm" />
                        </OButton>
                      </div>
                    </template>
                    <OButton
                      variant="ghost-primary"
                      size="icon-circle-sm"
                      @click="addGroupByColumn"
                    >
                      <OIcon name="add" size="sm" />
                      <OTooltip :content="t('alerts.queryConfig.addGroupByField')" />
                    </OButton>
                  </div>
                </div>

                <!-- no. of groups row — visible only when group-by fields are added -->
                <div
                  v-if="selectedFunction !== 'total_events' && hasMetricGroupByFields"
                  class="rounded-default text-compact flex items-start gap-3 px-3 py-2"
                >
                  <span
                    class="text-text-heading text-compact min-w-22.5 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                  >
                    {{ t("alerts.queryConfig.havingGroups") }}
                    <OTooltip
                      :content="t('alerts.queryConfig.havingGroupsTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex flex-nowrap items-start gap-2">
                    <OFormSelect
                      name="trigger_condition.operator"
                      :options="numericOperators"
                      :searchable="false"
                      class="max-w-30 min-w-17.5"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <!-- Message hangs under the threshold field it describes. -->
                    <div class="flex max-w-20 min-w-15 flex-col gap-1">
                      <OFormInput
                        name="trigger_condition.threshold"
                        type="number"
                        min="1"
                        @update:model-value="onTriggerThresholdChange($event)"
                        @blur="restoreDefaultThreshold"
                      >
                        <template #error />
                      </OFormInput>
                      <div
                        v-if="thresholdError"
                        class="text-input-error-text text-xs whitespace-nowrap"
                        data-test="alert-metric-having-groups-threshold-error"
                        role="alert"
                      >
                        {{ thresholdError }}
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- Check every row -->
              <div class="rounded-default text-compact flex items-start gap-3 px-3 py-2">
                <span
                  class="text-text-heading text-compact min-w-22.5 shrink-0 leading-7 font-bold whitespace-nowrap"
                >
                  {{ t("alerts.queryConfig.checkEvery") }} *
                  <OTooltip :content="t('alerts.howOftenCheckTooltip')" :delay="300" side="top" />
                </span>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <!-- Minutes/hours mode: number input -->
                    <template v-if="frequencyMode !== 'cron'">
                      <OFormInput
                        name="_ui.checkEvery"
                        type="number"
                        class="max-w-25 min-w-25"
                        min="1"
                        @update:model-value="onCheckEveryChange($event)"
                        @blur="restoreDefaultFrequency"
                      >
                        <!-- Message rendered below at row width — see checkEveryError. -->
                        <template #error />
                      </OFormInput>
                    </template>
                    <!-- Cron mode: expression input + timezone (Rule ②: form-owned
                       by `name=`, no v-model mirror). -->
                    <template v-else>
                      <OFormInput
                        name="trigger_condition.cron"
                        :placeholder="t('alerts.queryConfig.cronExpressionPlaceholder')"
                        class="max-w-25 min-w-25"
                        @update:model-value="onCronExpressionChange"
                      />
                    </template>

                    <!-- Unit dropdown: minutes / hours / cron -->
                    <OSelect
                      class="max-w-25 min-w-20"
                      :model-value="frequencyMode"
                      :options="frequencyUnitOptions"
                      labelKey="label"
                      valueKey="value"
                      :searchable="false"
                      @update:model-value="onFrequencyUnitChange"
                    />

                    <!-- Timezone (only for cron, inline) -->
                    <template v-if="frequencyMode === 'cron'">
                      <span class="inline-block max-w-37.5 min-w-37.5">
                        <OFormSelect
                          name="trigger_condition.timezone"
                          :options="filteredTimezones"
                          searchable
                          :placeholder="t('alerts.queryConfig.timezonePlaceholder')"
                          class="max-w-37.5 min-w-37.5"
                          @update:model-value="onCronTimezoneChange"
                        />
                        <OTooltip
                          v-if="cronTimezone"
                          :content="cronTimezone"
                          :delay="300"
                          side="bottom"
                        />
                      </span>
                    </template>

                    <span
                      class="text-text-secondary text-compact font-semibold whitespace-nowrap"
                      >{{ t("alerts.queryConfig.onThese") }}</span
                    >
                    <div
                      class="filters-inline-toggle rounded-default bg-surface-panel hover:bg-primary-50 flex cursor-pointer items-center gap-1 px-2 py-0.5 transition-colors select-none"
                      @click="toggleFilters"
                    >
                      <OIcon
                        name="filter-alt"
                        size="xs"
                        :class="filterCount > 0 ? 'text-theme-accent' : 'text-text-secondary'"
                      />
                      <span
                        class="text-xs font-semibold"
                        :class="filterCount > 0 ? 'text-theme-accent' : 'text-text-body'"
                      >
                        {{ t("alerts.queryConfig.filters") }}
                      </span>
                      <span
                        v-if="filterCount > 0"
                        class="text-2xs rounded-full px-1.5 py-0 leading-5 font-bold"
                        :class="'bg-status-info-bg text-status-info-text'"
                      >
                        {{ filterCount }}
                      </span>
                      <OIcon
                        :name="showFilters ? 'expand-more' : 'chevron-right'"
                        size="sm"
                        :class="'text-text-secondary'"
                      />
                      <!-- Review your SQL query hint -->
                      <span
                        v-if="generatedSqlQuery && !showFilters"
                        class="ml-1 cursor-help text-xs whitespace-nowrap italic underline decoration-dotted underline-offset-2"
                        :class="'text-text-secondary'"
                      >
                        {{ t("alerts.queryConfig.viewAlertQuery") }}
                        <OTooltip :delay="200" side="bottom">
                          <template #content>
                            <pre
                              class="hljs rounded-default m-0 p-2 font-mono text-xs whitespace-pre-wrap"
                              v-html="highlightedSqlQuery"
                            />
                          </template>
                        </OTooltip>
                      </span>
                    </div>
                  </div>

                  <!-- Cron description + error -->
                  <div
                    v-if="frequencyMode !== 'cron' && checkEveryError"
                    class="text-input-error-text text-xs"
                    data-test="alert-check-every-error"
                    role="alert"
                  >
                    {{ checkEveryError }}
                  </div>
                  <div
                    v-if="frequencyMode === 'cron' && cronDescription && !cronError"
                    class="text-2xs ml-0 italic"
                    :class="'text-text-secondary'"
                  >
                    {{ cronDescription }}
                  </div>
                  <div
                    v-if="frequencyMode === 'cron' && cronError"
                    class="text-status-error-text text-2xs ml-0"
                  >
                    {{ cronError }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Filters section — scheduled -->
            <div v-if="isRealTime === 'false'" ref="filtersSectionRef" class="mt-1 px-3">
              <div v-show="showFilters" ref="customPreviewRef">
                <FilterGroup
                  :stream-fields="columns"
                  :stream-fields-map="streamFieldsMap"
                  :show-sql-preview="false"
                  :sql-query="generatedSqlQuery"
                  :group="inputData.conditions"
                  :depth="0"
                  module="alerts"
                  name-prefix="query_condition.conditions"
                  @add-condition="updateGroup"
                  @add-group="updateGroup"
                  @remove-group="removeConditionGroup"
                  @input:update="onInputUpdate"
                />
              </div>
            </div>

            <!-- Realtime — no threshold sentence, just filters always visible -->
            <div v-else class="mb-1 px-3">
              <div class="flex items-center gap-2 py-1">
                <div
                  class="filters-inline-toggle rounded-default bg-surface-panel hover:bg-primary-50 flex cursor-pointer items-center gap-1 px-2 py-0.5 transition-colors select-none"
                  @click="toggleFilters"
                >
                  <OIcon
                    name="filter-alt"
                    size="xs"
                    :class="filterCount > 0 ? 'text-theme-accent' : 'text-text-secondary'"
                  />
                  <span
                    class="text-xs font-semibold"
                    :class="filterCount > 0 ? 'text-theme-accent' : 'text-text-body'"
                  >
                    {{ t("alerts.queryConfig.filters") }}
                  </span>
                  <span
                    v-if="filterCount > 0"
                    class="text-2xs rounded-full px-1.5 py-0 leading-5 font-bold"
                    :class="'bg-status-info-bg text-status-info-text'"
                  >
                    {{ filterCount }}
                  </span>
                  <OIcon
                    :name="showFilters ? 'expand-more' : 'chevron-right'"
                    size="sm"
                    :class="'text-text-secondary'"
                  />
                  <!-- Review your SQL query hint -->
                  <span
                    v-if="generatedSqlQuery && !showFilters"
                    class="ml-1 cursor-help text-xs whitespace-nowrap italic underline decoration-dotted underline-offset-2"
                    :class="'text-text-secondary'"
                  >
                    {{ t("alerts.queryConfig.viewAlertQuery") }}
                    <OTooltip :delay="200" side="bottom">
                      <template #content>
                        <pre
                          class="hljs rounded-default m-0 p-2 font-mono text-xs whitespace-pre-wrap"
                          v-html="highlightedSqlQuery"
                        />
                      </template>
                    </OTooltip>
                  </span>
                </div>
              </div>
              <div v-show="showFilters" ref="customPreviewRef">
                <FilterGroup
                  :stream-fields="columns"
                  :stream-fields-map="streamFieldsMap"
                  :show-sql-preview="false"
                  :sql-query="generatedSqlQuery"
                  :group="inputData.conditions"
                  :depth="0"
                  module="alerts"
                  name-prefix="query_condition.conditions"
                  @add-condition="updateGroup"
                  @add-group="updateGroup"
                  @remove-group="removeConditionGroup"
                  @input:update="onInputUpdate"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- SQL/PromQL Inline Editor Mode -->
        <template v-else>
          <div class="flex w-full flex-col gap-2 overflow-hidden">
            <!-- Editor area — position:relative shell owns the size; inner absolute never leaks -->
            <div class="relative h-80">
              <div class="absolute inset-0 flex overflow-hidden">
                <!-- SQL/PromQL pane — with its own header -->
                <div
                  class="flex shrink-0 flex-col overflow-hidden"
                  :class="showVrl && localTab === 'sql' ? 'w-1/2' : 'w-full'"
                >
                  <div
                    class="flex h-9 shrink-0 items-center justify-between px-2.5"
                    :class="'bg-surface-subtle border-border-default border-b'"
                  >
                    <div class="flex items-center gap-2">
                      <div class="rounded-default bg-theme-accent h-3.5 w-0.75 shrink-0" />
                      <span class="text-xs font-semibold">{{
                        localTab === "sql" ? t("alerts.sqlEditor") : t("alerts.promqlEditor")
                      }}</span>
                    </div>
                    <!-- fx toggle shown here only when VRL is not yet enabled -->
                    <OSwitch v-if="localTab === 'sql' && !showVrl" v-model="showVrl">
                      <OTooltip :content="t('alerts.queryConfig.showVrlEditor')" :delay="300" />
                    </OSwitch>
                  </div>
                  <div class="relative min-h-0 flex-1">
                    <div class="absolute inset-0">
                      <UnifiedQueryEditor
                        ref="inlineQueryEditorRef"
                        data-test-prefix="alert-inline-sql"
                        :languages="localTab === 'promql' ? ['promql'] : ['sql']"
                        :default-language="localTab === 'promql' ? 'promql' : 'sql'"
                        :query="localTab === 'sql' ? localSqlQuery : localPromqlQuery"
                        editor-height="100%"
                        :disable-ai="!streamName"
                        :keywords="autoCompleteKeywords"
                        :suggestions="autoCompleteSuggestions"
                        @focus="onQueryEditorFocus"
                        @blur="onBlurInlineSqlEditor"
                        @update:query="handleInlineQueryUpdate"
                      />
                    </div>
                    <div
                      v-if="
                        (localTab === 'sql' ? !localSqlQuery : !localPromqlQuery) &&
                        queryEditorPlaceholderFlag
                      "
                      class="query-editor-placeholder-overlay pointer-events-none absolute inset-0 z-1 flex items-start pt-0.75 pr-2 pl-[2.15rem] select-none"
                    >
                      <span class="query-editor-placeholder-typewriter">{{
                        inlineEditorPlaceholder
                      }}</span>
                    </div>
                  </div>
                </div>

                <!-- VRL pane — with its own header, side-by-side with SQL pane -->
                <div
                  class="border-border-default flex w-1/2 shrink-0 flex-col overflow-hidden border-l"
                  v-if="showVrl && localTab === 'sql'"
                >
                  <div
                    class="flex h-9 shrink-0 items-center justify-between px-2.5"
                    :class="'bg-surface-subtle border-border-default border-b'"
                  >
                    <div class="flex items-center gap-2">
                      <div
                        class="rounded-default bg-section-accent-secondary h-3.5 w-0.75 shrink-0"
                      />
                      <span class="text-xs font-semibold">{{
                        t("alerts.queryConfig.vrlEditor")
                      }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <OSelect
                        class="w-32.5!"
                        v-model="selectedSavedFunctionName"
                        :options="functionsList"
                        labelKey="name"
                        valueKey="name"
                        clearable
                        :placeholder="t('alerts.placeholders.savedFunctions')"
                        @update:model-value="
                          (name: any) => {
                            const fn = functionsList.find((f: any) => f.name === name);
                            if (fn) vrlFunctionContent = fn.function || fn.body || '';
                          }
                        "
                      >
                        <template #empty>
                          <span>{{ t("alerts.queryConfig.noFunctions") }}</span>
                        </template>
                      </OSelect>
                      <OSwitch v-model="showVrl">
                        <OTooltip :content="t('alerts.queryConfig.hideVrlEditor')" :delay="300" />
                      </OSwitch>
                    </div>
                  </div>
                  <div class="relative min-h-0 flex-1">
                    <div class="absolute inset-0">
                      <UnifiedQueryEditor
                        data-test-prefix="alert-inline-vrl"
                        :languages="['vrl']"
                        default-language="vrl"
                        :query="vrlFunctionContent"
                        editor-height="100%"
                        :disable-ai="false"
                        :hide-nl-toggle="false"
                        @focus="vrlEditorPlaceholderFlag = false"
                        @blur="onBlurInlineVrlEditor"
                        @update:query="
                          (v) => {
                            vrlFunctionContent = v;
                            handleVrlFunctionUpdate(v);
                          }
                        "
                      />
                      <div
                        v-if="!vrlFunctionContent && vrlEditorPlaceholderFlag"
                        class="query-editor-placeholder-overlay pointer-events-none absolute inset-0 z-1 flex items-start pt-0.75 pr-2 pl-[2.15rem] select-none"
                      >
                        <span class="query-editor-placeholder-typewriter">{{
                          vrlPlaceholder
                        }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Status bar — outside overflow:hidden so borders render correctly -->
            <div
              v-if="localTab !== 'promql'"
              class="text-compact border-border-default rounded-b-default relative h-5.5 shrink-0 border-x border-b font-medium"
              :class="inlineStatusBarClass"
            >
              <div class="absolute inset-0 flex items-center gap-1.25 overflow-hidden px-2.5">
                <template v-if="inlineStatusState === 'sql-status-bar--error'">
                  <OIcon class="shrink-0" name="error-outline" size="xs" />
                  <span class="min-w-0 flex-1 truncate">{{ sqlQueryErrorMsg }}</span>
                  <OTooltip side="top">{{ sqlQueryErrorMsg }}</OTooltip>
                </template>
                <template v-else-if="inlineStatusState === 'sql-status-bar--hint'">
                  <OIcon class="shrink-0 opacity-60" name="edit" size="xs" />
                  <span>{{ t("alerts.queryConfig.writeQueryHint") }}</span>
                </template>
                <template v-else-if="inlineStatusState === 'sql-status-bar--idle'">
                  <OIcon class="shrink-0 opacity-70" name="check-circle-outline" size="xs" />
                  <span>{{ t("alerts.queryConfig.sqlEditorHint") }}</span>
                </template>
              </div>
            </div>

            <!-- SQL/PromQL condition rows (scheduled only): Check every + Alert if in one block -->
            <div v-if="isRealTime === 'false'" class="mt-2 flex flex-col gap-0 px-1">
              <!-- Check every -->
              <div class="rounded-default text-compact flex items-start gap-3 px-3 py-2">
                <span
                  class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-7 font-bold whitespace-nowrap"
                >
                  {{ t("alerts.queryConfig.checkEvery") }} *
                  <OTooltip :content="t('alerts.howOftenCheckTooltip')" :delay="300" side="top" />
                </span>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <template v-if="frequencyMode !== 'cron'">
                      <OFormInput
                        name="_ui.checkEvery"
                        type="number"
                        class="max-w-25 min-w-25"
                        min="1"
                        @update:model-value="onCheckEveryChange($event)"
                        @blur="restoreDefaultFrequency"
                      >
                        <!-- Message rendered below at row width — see checkEveryError. -->
                        <template #error />
                      </OFormInput>
                    </template>
                    <template v-else>
                      <OFormInput
                        name="trigger_condition.cron"
                        :placeholder="t('alerts.queryConfig.cronExpressionPlaceholder')"
                        class="max-w-25 min-w-25"
                        @update:model-value="onCronExpressionChange"
                      />
                    </template>
                    <OSelect
                      class="max-w-25 min-w-20"
                      :model-value="frequencyMode"
                      :options="frequencyUnitOptions"
                      labelKey="label"
                      valueKey="value"
                      :searchable="false"
                      @update:model-value="onFrequencyUnitChange"
                    />
                    <template v-if="frequencyMode === 'cron'">
                      <span class="inline-block max-w-37.5 min-w-37.5">
                        <OFormSelect
                          name="trigger_condition.timezone"
                          :options="filteredTimezones"
                          searchable
                          :placeholder="t('alerts.queryConfig.timezonePlaceholder')"
                          class="max-w-37.5 min-w-37.5"
                          @update:model-value="onCronTimezoneChange"
                        />
                        <OTooltip
                          v-if="cronTimezone"
                          :content="cronTimezone"
                          :delay="300"
                          side="bottom"
                        />
                      </span>
                    </template>
                  </div>
                  <div
                    v-if="frequencyMode !== 'cron' && checkEveryError"
                    class="text-input-error-text text-xs"
                    data-test="alert-check-every-error"
                    role="alert"
                  >
                    {{ checkEveryError }}
                  </div>
                  <div
                    v-if="frequencyMode === 'cron' && cronDescription && !cronError"
                    class="text-2xs italic"
                    :class="'text-text-secondary'"
                  >
                    {{ cronDescription }}
                  </div>
                  <div
                    v-if="frequencyMode === 'cron' && cronError"
                    class="text-status-error-text text-2xs"
                  >
                    {{ cronError }}
                  </div>
                </div>
              </div>

              <!-- SQL: Alert if No. of events -->
              <div
                v-if="localTab === 'sql'"
                class="rounded-default text-compact flex items-start gap-3 px-3 py-2"
              >
                <span
                  class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                  >{{ t("alerts.alertIfNoOfEvents") }} *</span
                >
                <div class="flex items-start gap-2">
                  <OFormSelect
                    name="trigger_condition.operator"
                    :options="numericOperators"
                    :searchable="false"
                    data-test="alert-trigger-operator-select"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <!-- The message belongs to the threshold, so it hangs under the
                     threshold — not at the row's left edge. The column is capped
                     to the field's width and the message is nowrap, so it spills
                     right into empty space instead of widening the row. -->
                  <div class="flex max-w-20 min-w-15 flex-col gap-1">
                    <OFormInput
                      name="trigger_condition.threshold"
                      type="number"
                      data-test="alert-trigger-threshold-input"
                      min="1"
                      @update:model-value="onTriggerThresholdChange($event)"
                      @blur="restoreDefaultThreshold"
                    >
                      <template #error />
                    </OFormInput>
                    <div
                      v-if="thresholdError"
                      class="text-input-error-text text-xs whitespace-nowrap"
                      data-test="alert-trigger-threshold-error"
                      role="alert"
                    >
                      {{ thresholdError }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- PromQL: Alert if the value is + Having series -->
              <template v-if="localTab === 'promql' && promqlCondition">
                <div class="rounded-default text-compact flex items-start gap-3 px-3 py-2">
                  <span
                    class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                    >{{ t("alerts.alertIfValueIs") }} *
                    <OTooltip
                      :content="t('alerts.queryConfig.alertIfValueIsTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex items-start gap-2">
                    <OFormSelect
                      name="query_condition.promql_condition.operator"
                      :options="numericOperators"
                      :searchable="false"
                      data-test="alert-threshold-operator-select"
                      class="max-w-30 min-w-17.5"
                      @update:model-value="onPromqlOperatorChange"
                    />
                    <!-- Message hangs under the value field it describes. -->
                    <div class="flex max-w-30 min-w-15 flex-col gap-1">
                      <OFormInput
                        name="query_condition.promql_condition.value"
                        type="number"
                        data-test="alert-threshold-value-input"
                        :debounce="300"
                        @update:model-value="onPromqlValueChange"
                      >
                        <template #error />
                      </OFormInput>
                      <div
                        v-if="promqlValueError"
                        class="text-input-error-text text-xs whitespace-nowrap"
                        data-test="alert-threshold-value-error"
                        role="alert"
                      >
                        {{ promqlValueError }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="rounded-default text-compact flex items-start gap-3 px-3 py-2">
                  <span
                    class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-8.5 font-bold whitespace-nowrap"
                    >{{ t("alerts.havingSeries") }} *
                    <OTooltip
                      :content="t('alerts.queryConfig.havingSeriesTooltip')"
                      :delay="300"
                      side="top"
                    />
                  </span>
                  <div class="flex items-start gap-2">
                    <OFormSelect
                      name="trigger_condition.operator"
                      :options="numericOperators"
                      :searchable="false"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <!-- Message hangs under the threshold field it describes. -->
                    <div class="flex max-w-20 min-w-15 flex-col gap-1">
                      <OFormInput
                        name="trigger_condition.threshold"
                        type="number"
                        min="1"
                        @update:model-value="onTriggerThresholdChange($event)"
                        @blur="restoreDefaultThreshold"
                      >
                        <template #error />
                      </OFormInput>
                      <div
                        v-if="thresholdError"
                        class="text-input-error-text text-xs whitespace-nowrap"
                        data-test="alert-having-series-threshold-error"
                        role="alert"
                      >
                        {{ thresholdError }}
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Query Editor Dialog -->
    <QueryEditorDialog
      v-model="viewSqlEditor"
      :tab="localTab === 'promql' ? 'promql' : 'sql'"
      :sqlQuery="localSqlQuery"
      :promqlQuery="localPromqlQuery"
      :vrlFunction="vrlFunctionContent"
      :streamName="streamName"
      :streamType="streamType"
      :columns="columns"
      :period="inputData.period"
      :multiTimeRange="inputData.multi_time_range"
      :savedFunctions="functionsList"
      :sqlQueryErrorMsg="sqlQueryErrorMsg"
      @update:sqlQuery="updateSqlQuery"
      @update:promqlQuery="updatePromqlQuery"
      @update:vrlFunction="handleVrlFunctionUpdate"
      @validate-sql="handleValidateSql"
    />

    <!-- Multi-Window Confirmation Dialog -->
    <CustomConfirmDialog
      v-model="showMultiWindowDialog"
      :title="t('alerts.clearMultiWindowsTitle')"
      :message="
        t('alerts.queryConfig.clearMultiWindowsMessage', {
          mode: pendingTab === 'custom' ? t('alerts.queryConfig.customMode') : 'PromQL',
        })
      "
      @confirm="handleConfirmClearMultiWindows"
      @cancel="handleCancelClearMultiWindows"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  type PropType,
  defineAsyncComponent,
  nextTick,
  watch,
  inject,
  type Ref,
} from "vue";
import { type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import {
  b64EncodeUnicode,
  getUUID,
  convertMinutesToCron,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  describeCron,
  getImageURL,
} from "@/utils/zincutils";
import hljs from "highlight.js/lib/core";
import sql from "highlight.js/lib/languages/sql";

hljs.registerLanguage("sql", sql);

import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useVrlPlaceholder } from "@/composables/useVrlPlaceholder";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import CustomConfirmDialog from "@/components/alerts/CustomConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { type QueryConfigMeta } from "./QueryConfig.schema";

const UnifiedQueryEditor = defineAsyncComponent(() => import("@/components/QueryEditor.vue"));

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    FilterGroup,
    QueryEditorDialog,
    CustomConfirmDialog,
    UnifiedQueryEditor,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    OSelect,
    OSwitch,
    OTooltip,
    OIcon,
    OFormInput,
    OFormSelect,
  },
  props: {
    tab: {
      type: String as PropType<"sql" | "promql" | "custom">,
      default: "custom",
    },
    multiTimeRange: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    streamFieldsMap: {
      type: Object as PropType<any>,
      default: () => ({}),
    },
    generatedSqlQuery: {
      type: String,
      default: "",
    },
    inputData: {
      type: Object as PropType<any>,
      required: true,
    },
    streamType: {
      type: String,
      default: "",
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    sqlQuery: {
      type: String,
      default: "",
    },
    promqlQuery: {
      type: String,
      default: "",
    },
    vrlFunction: {
      type: String,
      default: "",
    },
    streamName: {
      type: String,
      default: "",
    },
    sqlQueryErrorMsg: {
      type: String,
      default: "",
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    beingUpdated: {
      type: Boolean,
      default: false,
    },
    promqlCondition: {
      type: Object as PropType<any>,
      default: null,
    },
    triggerCondition: {
      type: Object as PropType<any>,
      default: null,
    },
  },
  emits: [
    "update:tab",
    "update-group",
    "remove-group",
    "input:update",
    "update:sqlQuery",
    "update:promqlQuery",
    "update:vrlFunction",
    "validate-sql",
    "clear-multi-windows",
    "editor-closed",
    "editor-state-changed",
    "update:isAggregationEnabled",
    "update:aggregation",
    "update:promqlCondition",
    "update:triggerCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    // Descendant step: the AddAlert orchestrator owns the ONE form and provides
    // FORM_CONTEXT_KEY. All field reads/writes below go through it; the composed
    // AddAlert schema validates on save.
    const form: any = inject(FORM_CONTEXT_KEY, null);

    // Initial values for the discriminator refs below (the form itself is seeded
    // by useAlertForm's defaults; `_meta` is kept fresh by the syncMeta watcher).
    const isEventBasedInit = props.streamType !== "metrics";
    const initialSelectedFunction = isEventBasedInit
      ? props.isAggregationEnabled && props.inputData.aggregation?.function
        ? props.inputData.aggregation.function
        : "total_events"
      : !props.isAggregationEnabled
        ? "total_events"
        : props.inputData.aggregation?.function || "avg";
    const initialFreqRaw = props.triggerCondition?.frequency ?? 10;
    const initialFrequencyMode: "minutes" | "hours" | "cron" =
      props.triggerCondition?.frequency_type === "cron"
        ? "cron"
        : initialFreqRaw >= 60 && initialFreqRaw % 60 === 0
          ? "hours"
          : "minutes";
    const hasInitialGroupBy =
      (props.inputData.aggregation?.group_by || []).filter((g: string) => g?.trim()).length > 0;

    // Field get/set helpers — the form is the single source of truth for the
    // validated scalars; props.* stay a write-through copy for the SQL-gen path.
    //
    // `fv` must be BOTH fresh AND reactive:
    //  • `getFieldValue` is a synchronous read straight off TanStack's store, so a
    //    handler that just wrote a field reads its own write back in the same tick.
    //  • but `getFieldValue` is NOT a Vue reactive source. A `computed()` whose
    //    getter only calls it tracks NO dependency, so Vue caches the FIRST result
    //    and never re-evaluates it.
    // Touching the reactive values snapshot registers the dependency (so the
    // computeds invalidate on any form write); the value still comes from the
    // fresh synchronous read, so same-tick read-after-write stays correct.
    const formValuesSnapshot: any = form?.useStore?.((s: any) => s.values);
    const fv = (name: string): any => {
      void formValuesSnapshot?.value;
      return form?.getFieldValue?.(name);
    };
    const setFV = (name: string, value: any): void => {
      form?.setFieldValue?.(name, value);
    };

    // Build a fresh aggregation object off the CURRENT form value (NEVER the
    // readonly `props.inputData`, which is the readonly form read-view), apply
    // `mutate`, and write it back through the form. Cloning + setFV keeps the form
    // the single source of truth.
    const writeAggregation = (mutate: (agg: any) => void): any => {
      const current = fv("query_condition.aggregation");
      const next = current
        ? JSON.parse(JSON.stringify(current))
        : {
            group_by: [],
            function: "avg",
            having: { column: "", operator: ">=", value: "" },
          };
      if (!next.having) next.having = { column: "", operator: ">=", value: "" };
      mutate(next);
      setFV("query_condition.aggregation", next);
      return next;
    };

    const localTab = ref(props.tab);
    const viewSqlEditor = ref(false);
    const showMultiWindowDialog = ref(false);

    // (No field-level error refs: every rule lives in the composed schema and is
    // surfaced by the OForm* wrapper bound to that field.)
    const pendingTab = ref<"sql" | "promql" | "custom" | null>(null);

    // Field refs for focus manager
    const customPreviewRef = ref(null);
    const sqlPromqlPreviewRef = ref(null);

    // Local query values
    const localSqlQuery = ref(props.sqlQuery);
    const localPromqlQuery = ref(props.promqlQuery);
    const vrlFunctionContent = ref(props.vrlFunction);
    const selectedSavedFunctionName = ref<string | null>(null);

    // Aggregation state
    const localIsAggregationEnabled = ref(props.isAggregationEnabled);

    // Expandable section toggles — auto-expand filters if editing an alert with existing conditions
    const hasExistingFilters = props.inputData.conditions?.conditions?.some(
      (c: any) => c.filterType === "condition" && c.column && c.column.trim() !== "",
    );
    const showFilters = ref(true);
    const showVrl = ref(!!props.vrlFunction?.trim());
    const filtersSectionRef = ref<HTMLElement | null>(null);
    const inlineQueryEditorRef = ref<any>(null);

    // Server SQL-validation squiggle ranges, provided by AddAlert.vue.
    const alertSqlErrorRanges = inject<Ref<SqlErrorRange[]>>(
      "alertSqlErrorRanges",
      ref<SqlErrorRange[]>([]),
    );

    const {
      onFocus: _sqlOnFocus,
      onBlur: _sqlOnBlur,
      onQueryChange: _sqlOnQueryChange,
    } = useSqlEditorDiagnostics({
      queryEditorRef: inlineQueryEditorRef,
      sqlMode: computed(() => localTab.value === "sql"),
      query: computed(() => localSqlQuery.value ?? ""),
      streamName: computed(() => props.streamName),
      externalErrors: alertSqlErrorRanges,
    });

    const onQueryEditorFocus = () => {
      queryEditorPlaceholderFlag.value = false;
      _sqlOnFocus();
    };

    // ── Inline editor autocomplete ──────────────────────────────────────────
    const {
      autoCompleteData,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      getSuggestions,
      updateFieldKeywords,
    } = useSqlSuggestions();

    // Rebuild field keywords whenever columns prop changes
    watch(
      () => props.columns,
      (cols) => {
        if (cols?.length) {
          const fields = (cols as any[]).map((c: any) => ({
            name: typeof c === "string" ? c : (c.value ?? c.label ?? c),
            type: c.type ?? "Utf8",
          }));
          updateFieldKeywords(fields);
        }
      },
      { immediate: true, deep: true },
    );

    // Called on every keystroke in the inline SQL/PromQL editor — updates
    // the query and feeds autocomplete context (same pattern as QueryEditorDialog)
    const handleInlineQueryUpdate = (newQuery: string) => {
      _sqlOnQueryChange();
      if (localTab.value === "sql") {
        updateSqlQuery(newQuery);
      } else {
        updatePromqlQuery(newQuery);
      }
      autoCompleteData.value.query = newQuery;
      autoCompleteData.value.cursorIndex = inlineQueryEditorRef.value?.getCursorIndex?.() ?? 0;
      autoCompleteData.value.org = store.state.selectedOrganization.identifier;
      autoCompleteData.value.streamType = props.streamType;
      autoCompleteData.value.streamName = props.streamName;
      autoCompleteData.value.popup.open = inlineQueryEditorRef.value?.triggerAutoComplete;
      getSuggestions();
    };

    // Inline editor status bar state
    const inlineStatusState = computed(() => {
      if (props.sqlQueryErrorMsg?.trim()) return "sql-status-bar--error";
      const query = localTab.value === "sql" ? localSqlQuery.value : localPromqlQuery.value;
      if (!query?.trim()) return "sql-status-bar--hint";
      return "sql-status-bar--idle";
    });

    // Status-bar color/cursor per state (was CSS .sql-status-bar--*).
    const inlineStatusBarClass = computed(() =>
      inlineStatusState.value === "sql-status-bar--error"
        ? "bg-status-error-bg text-status-error-text cursor-pointer"
        : "bg-surface-subtle text-text-secondary cursor-default",
    );

    // Placeholder flags for inline editors (show image when empty + not focused)
    const queryEditorPlaceholderFlag = ref(true);
    const vrlEditorPlaceholderFlag = ref(true);
    const { placeholder: vrlPlaceholder } = useVrlPlaceholder();

    // ─── Typewriter placeholder for the inline query editor ──────────
    const streamFieldsForPlaceholder = computed(() =>
      (props.columns as any[]).map((c: any) => ({
        name: typeof c === "string" ? c : (c.value ?? c.label ?? ""),
        dataType: typeof c === "string" ? "" : (c.type ?? ""),
      })),
    );
    const noStreamForPlaceholder = computed(() => !props.streamName);
    const isSqlModeForPlaceholder = computed(() => localTab.value === "sql");
    const { placeholder: inlineEditorPlaceholder } = useQueryPlaceholder(
      streamFieldsForPlaceholder,
      ref({}),
      isSqlModeForPlaceholder,
      noStreamForPlaceholder,
      { noStreamText: t("pipeline.queryEditorPlaceholder") },
    );

    const onBlurInlineSqlEditor = async () => {
      queryEditorPlaceholderFlag.value =
        localTab.value === "sql" ? localSqlQuery.value === "" : localPromqlQuery.value === "";
      if (localTab.value === "sql") {
        await _sqlOnBlur();
        emit("validate-sql");
      }
    };
    const onBlurInlineVrlEditor = () => {
      vrlEditorPlaceholderFlag.value = vrlFunctionContent.value === "";
    };

    const toggleFilters = () => {
      showFilters.value = !showFilters.value;
    };

    // Stream-type-driven: logs/traces are event-based, metrics are aggregation-based
    const isEventBased = computed(() => {
      return props.streamType !== "metrics";
    });

    // Set aggregation state based on stream type on mount
    if (!isEventBased.value) {
      if (!props.isAggregationEnabled) {
        // total_events selected — no aggregation, same path as logs
        localIsAggregationEnabled.value = false;
      } else {
        // Metrics: aggregation-enabled. Initialize the aggregation in the form,
        // defaulting the column to "value" only if the stream has that field.
        localIsAggregationEnabled.value = true;
        writeAggregation((agg) => {
          if (!agg.having.column) {
            const hasValueField = props.columns.some(
              (c: any) => (typeof c === "string" ? c : c.value) === "value",
            );
            if (hasValueField) agg.having.column = "value";
          }
        });
      }
    } else {
      // Logs/Traces: event-based, no aggregation
      localIsAggregationEnabled.value = false;
    }

    // Log function options — count (default) and measure functions.
    // computed() (not a module/setup const) so the labels + tooltips re-resolve
    // if the locale changes; the `value`s are payload identifiers and stay literal.
    const logFunctionOptions = computed(() => [
      {
        label: t("alerts.queryConfig.functions.totalEvents"),
        value: "total_events",
        tooltip: t("alerts.queryConfig.functionTooltips.totalEvents"),
      },
      {
        label: t("alerts.queryConfig.functions.count"),
        value: "count",
        tooltip: t("alerts.queryConfig.functionTooltips.count"),
      },
      {
        label: t("alerts.queryConfig.functions.avg"),
        value: "avg",
        tooltip: t("alerts.queryConfig.functionTooltips.avg"),
      },
      {
        label: t("alerts.queryConfig.functions.min"),
        value: "min",
        tooltip: t("alerts.queryConfig.functionTooltips.min"),
      },
      {
        label: t("alerts.queryConfig.functions.max"),
        value: "max",
        tooltip: t("alerts.queryConfig.functionTooltips.max"),
      },
      {
        label: t("alerts.queryConfig.functions.sum"),
        value: "sum",
        tooltip: t("alerts.queryConfig.functionTooltips.sum"),
      },
      {
        label: t("alerts.queryConfig.functions.median"),
        value: "median",
        tooltip: t("alerts.queryConfig.functionTooltips.median"),
      },
      {
        label: t("alerts.queryConfig.functions.p50"),
        value: "p50",
        tooltip: t("alerts.queryConfig.functionTooltips.p50"),
      },
      {
        label: t("alerts.queryConfig.functions.p75"),
        value: "p75",
        tooltip: t("alerts.queryConfig.functionTooltips.p75"),
      },
      {
        label: t("alerts.queryConfig.functions.p90"),
        value: "p90",
        tooltip: t("alerts.queryConfig.functionTooltips.p90"),
      },
      {
        label: t("alerts.queryConfig.functions.p95"),
        value: "p95",
        tooltip: t("alerts.queryConfig.functionTooltips.p95"),
      },
      {
        label: t("alerts.queryConfig.functions.p99"),
        value: "p99",
        tooltip: t("alerts.queryConfig.functionTooltips.p99"),
      },
    ]);

    // Numeric-only operators (no Contains/NotContains for thresholds)
    const numericOperators = ["=", "!=", ">=", ">", "<=", "<"];

    // Selected function — bare mode-discriminator (drives conditional rendering
    // + the aggregation payload). Stays a ref (bridged into `_meta` for the
    // schema). Seeded from the shared initial const.
    const selectedFunction = ref(initialSelectedFunction);

    // Form-backed scalar accessors: the form is the single source of truth; these
    // writable computeds let handlers/watchers read/write the field values without
    // a parallel ref. The `.vue` controls are name=-owned OForm* — these never
    // drive a v-model.
    // Log/metric MEASURE column → aggregation.having.column.
    const logMeasureColumn = computed<any>({
      get: () => fv("query_condition.aggregation.having.column") ?? "",
      set: (v) => setFV("query_condition.aggregation.having.column", v),
    });
    // Log group-by field array (metrics group-by lives on aggregation.group_by).
    const logGroupBy = computed<string[]>({
      get: () => (fv("logGroupBy") as string[]) ?? [],
      set: (v) => setFV("logGroupBy", [...(v ?? [])]),
    });
    // Measure "value is" operator/value → aggregation.having.{operator,value}.
    const conditionOperator = computed<any>({
      get: () => fv("query_condition.aggregation.having.operator") ?? ">=",
      set: (v) => setFV("query_condition.aggregation.having.operator", v),
    });
    const conditionValue = computed<any>({
      get: () => fv("query_condition.aggregation.having.value") ?? "",
      set: (v) => setFV("query_condition.aggregation.having.value", v),
    });

    // Pre-migration, `conditionValue` was a plain ref seeded ONCE at setup from
    // trigger_condition.threshold for logs/traces (metrics seeded from having.value).
    // That snapshot is why the measure row opens on the threshold default of 3 rather
    // than having.value's own default of 1. having.value is form-owned now, so carry
    // the seed explicitly. Snapshot the threshold HERE: onLogFunctionChange resets the
    // live threshold to 1 before it writes having.value, so it can't be read at switch
    // time. One-shot, and only when no saved aggregation is being loaded — a saved
    // measure alert must keep its own having.value.
    const initialThresholdSeed = fv("trigger_condition.threshold");
    let measureSeedPending = isEventBasedInit && !props.isAggregationEnabled;

    // Watch stream type changes to restore saved state or set new-alert defaults.
    // Fires when stream type prop changes (e.g. async load on edit, or user switching stream type).
    watch(isEventBased, (eventBased, oldEventBased) => {
      if (eventBased) {
        // PromQL is only available for metrics — switch to builder when
        // moving to logs/traces so the user isn't stuck on an invalid tab.
        if (localTab.value === "promql") {
          updateTab("custom");
        }

        // Switched to logs/traces — restore saved function or default to total_events.
        // When coming from metrics the aggregation defaults don't apply to log fields.
        if (
          props.isAggregationEnabled &&
          props.inputData.aggregation?.function &&
          oldEventBased !== false
        ) {
          selectedFunction.value = props.inputData.aggregation.function;
          localIsAggregationEnabled.value = true;
        } else {
          selectedFunction.value = "total_events";
          localIsAggregationEnabled.value = false;
          emit("update:isAggregationEnabled", false);
        }
      } else {
        // Switched to metrics
        if (props.isAggregationEnabled && props.inputData.aggregation?.function) {
          // Edit mode: restore saved aggregation function
          selectedFunction.value = props.inputData.aggregation.function;
          localIsAggregationEnabled.value = true;
        } else if (!props.isAggregationEnabled && props.beingUpdated) {
          // Edit mode: alert was saved with total_events (aggregation: null)
          selectedFunction.value = "total_events";
          localIsAggregationEnabled.value = false;
        } else {
          // New alert switching to metrics — default to avg + init aggregation
          selectedFunction.value = "avg";
          localIsAggregationEnabled.value = true;
          emit("update:isAggregationEnabled", true);
          writeAggregation((agg) => {
            agg.function = "avg";
            if (!agg.having.column) {
              const hasValueField = props.columns.some(
                (c: any) => (typeof c === "string" ? c : c.value) === "value",
              );
              if (hasValueField) agg.having.column = "value";
            }
          });
          emitAggregationUpdate();
        }
      }
    });

    // Trigger threshold/operator — shared "no. of events" / "having groups" /
    // "having series" scalar (ONE logical value across all 6 render sites).
    // Form-backed (name="trigger_condition.threshold" / ".operator").
    const triggerOperator = computed<any>({
      get: () => fv("trigger_condition.operator") ?? ">=",
      set: (v) => setFV("trigger_condition.operator", v),
    });
    const triggerThreshold = computed<any>({
      get: () => fv("trigger_condition.threshold"),
      set: (v) => setFV("trigger_condition.threshold", v),
    });
    // (Removed a mount-time `props.triggerCondition.threshold = 1` reset that
    // mutated the readonly form read-view — it silently failed (no-op) and only
    // logged a warning. The measure-mode "reset to >= 1 when group-by is empty"
    // rule is enforced by the function-change handlers and the trigger_condition
    // watcher; count mode keeps its default threshold of 3.)

    // The threshold / PromQL-value controls are narrow numeric fields sitting in
    // a "sentence" row next to an operator select. OFormInput renders its message
    // INSIDE the field's own width, so a ~5rem field wraps the message into a
    // ragged column and grows the row, knocking the label and the operator out of
    // line. Same fix as ScheduledPipeline's composite fields: an empty #error slot
    // suppresses the built-in message and we render it in a full-width sibling
    // below the row. These read the same R3-timed field errors OFormInput would
    // have surfaced — single source of truth, just displayed at column width.
    const thresholdError = form.useStore((s: any) =>
      firstFieldError(s.fieldMeta?.["trigger_condition.threshold"]?.errors ?? []),
    );
    const promqlValueError = form.useStore((s: any) =>
      firstFieldError(s.fieldMeta?.["query_condition.promql_condition.value"]?.errors ?? []),
    );
    const checkEveryError = form.useStore((s: any) =>
      firstFieldError(s.fieldMeta?.["_ui.checkEvery"]?.errors ?? []),
    );
    const havingValueError = form.useStore((s: any) =>
      firstFieldError(s.fieldMeta?.["query_condition.aggregation.having.value"]?.errors ?? []),
    );

    // Reactive views of the two group-by field arrays (form store) so the
    // template v-if / schema `_meta` stay live.
    const logGroupByStore: Ref<string[]> = form.useStore(
      (s: any) => (s.values?.logGroupBy ?? []) as string[],
    );
    const metricGroupByStore = form.useStore(
      (s: any) => (s.values?.query_condition?.aggregation?.group_by ?? []) as string[],
    );
    // Whether log/trace group-by has at least one non-empty field
    const hasLogGroupByFields = computed(
      () => logGroupByStore.value.filter((f: string) => f?.trim()).length > 0,
    );
    // Whether metric group-by has at least one non-empty field
    const hasMetricGroupByFields = computed(
      () => metricGroupByStore.value.filter((f: string) => f?.trim()).length > 0,
    );

    // name="trigger_condition.operator" owns the value, but it is NOT written yet
    // when this runs — field.handleChange commits after us — so the new operator
    // must be passed to the emit explicitly (same fix as onLogMeasureColumnChange).
    // Pre-migration mutated the prop before emitting, so the parent always saw the
    // fresh operator; reading it back off the form here would emit the OLD one.
    const onTriggerOperatorChange = (value: string) => {
      emitTriggerUpdate({ operator: value });
    };

    // name="trigger_condition.threshold" wrote the raw (string) input; re-write the
    // Number-coerced value so the payload stays numeric (mirrors `v-model.number`).
    const onTriggerThresholdChange = (value: any) => {
      isUserTriggerChange.value = true;
      triggerThreshold.value =
        value === "" || value === null || value === undefined ? null : Number(value);
      emitTriggerUpdate();
    };

    const restoreDefaultThreshold = () => {
      if (
        triggerThreshold.value === null ||
        triggerThreshold.value === "" ||
        triggerThreshold.value === undefined ||
        Number.isNaN(Number(triggerThreshold.value))
      ) {
        triggerThreshold.value = 3;
        emitTriggerUpdate();
      }
    };

    // Check every — evaluation frequency.
    //
    // TWO values, deliberately separate (pre-migration parity):
    //   • checkEveryFrequency → `_ui.checkEvery` = the DISPLAY value. 2 in hours
    //     mode. Form-backed so the schema's ≥1 + org-floor rules render inline on
    //     the input, but `_ui` is display-only and never reaches the payload
    //     (stripped in getAlertPayload next to _meta/logGroupBy).
    //   • trigger_condition.frequency = the STORED value, ALWAYS MINUTES (120).
    //     Sent raw to the backend by alertPayload.ts; frequency_type is
    //     'minutes' for BOTH minutes and hours display modes — "hours" is
    //     purely a display unit.
    // Collapsing these corrupts data: a display 2 written into the stored field
    // means "every 2 minutes", and the deep sync watch below would then flip the
    // mode back to minutes — silently rewriting a saved 2-hour alert to 2 min.
    // Write stored minutes ONLY through setStoredFrequency.
    const checkEveryFrequency = computed<any>({
      get: () => fv("_ui.checkEvery"),
      set: (v) => setFV("_ui.checkEvery", v),
    });

    /** Bridge DISPLAY → STORED MINUTES. The single writer of
     *  trigger_condition.frequency in this component. */
    const setStoredFrequency = (display: number | null): void => {
      const mins =
        display != null ? (frequencyMode.value === "hours" ? display * 60 : display) : null;
      setFV("trigger_condition.frequency", mins);
    };

    const frequencyMode = ref<"minutes" | "hours" | "cron">(initialFrequencyMode);

    // Seed the DISPLAY from the stored minutes at setup. The sync watcher below
    // is `immediate: false`, so loading a saved alert (frequency: 120) would
    // otherwise leave the input showing the default until trigger_condition next
    // changed. initialFrequencyMode already applied the >=60-and-whole-hours
    // rule to the same value, so this just divides when it said "hours".
    // The STORED value is NOT touched here — 120 stays 120.
    checkEveryFrequency.value =
      initialFrequencyMode === "hours" ? Number(initialFreqRaw) / 60 : initialFreqRaw;

    const isUserTriggerChange = ref(false);
    // Rule ②: `cron` + `timezone` are SAVED alert fields, so the ONE form owns
    // them — no local-ref mirror. The visible controls bind by `name=`; these
    // computeds are the read/write seam for the NON-control consumers
    // (cronDescription, validateCron, onFrequencyUnitChange, the tooltips).
    // Writing through the setter goes straight to the form, so there is exactly
    // one source of truth.
    const cronExpression = computed<string>({
      get: () => fv("trigger_condition.cron") ?? "",
      set: (v) => setFV("trigger_condition.cron", v ?? ""),
    });
    const cronTimezone = computed<string>({
      get: () => fv("trigger_condition.timezone") ?? "",
      set: (v) => setFV("trigger_condition.timezone", v ?? ""),
    });
    const cronError = ref("");
    const cronDescription = computed(() => describeCron(cronExpression.value, cronTimezone.value));
    const filteredTimezones = ref<string[]>([]);

    // Initialize timezone
    // Populate the timezone OPTIONS only. This must NOT seed the timezone value:
    // `cronTimezone` is now form-owned, so writing here would push a browser
    // timezone into the SAVED payload at mount — pre-migration seeded a local
    // display ref, leaving the stored value untouched until the user entered cron
    // mode (onFrequencyUnitChange still seeds it there). defaultAlertValue()
    // already seeds `timezone: "UTC"`, so the control is never blank anyway.
    const initTimezones = () => {
      try {
        // @ts-ignore
        if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
          // @ts-ignore
          filteredTimezones.value = Intl.supportedValuesOf("timeZone");
        } else {
          filteredTimezones.value = [cronTimezone.value || "UTC"];
        }
      } catch {
        filteredTimezones.value = ["UTC"];
      }
    };
    initTimezones();

    const validateCron = () => {
      cronError.value = "";
      if (frequencyMode.value !== "cron") return;
      if (!cronExpression.value || !cronTimezone.value) {
        cronError.value = t("alerts.queryConfig.cronExpressionTimezoneRequired");
        return;
      }
      try {
        const intervalInSecs = getCronIntervalDifferenceInSeconds(cronExpression.value);
        if (
          typeof intervalInSecs === "number" &&
          !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
        ) {
          const minInterval = Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
          cronError.value = t("alerts.queryConfig.frequencyGreaterThanSeconds", {
            seconds: minInterval - 1,
          });
        }
      } catch {
        cronError.value = t("alerts.queryConfig.invalidCronExpression");
      }
    };

    // computed() so the labels re-resolve on a locale change; the `value`s are
    // the frequency-mode identifiers and stay literal.
    const frequencyUnitOptions = computed(() => [
      { label: t("common.minutes"), value: "minutes" },
      { label: t("common.hours"), value: "hours" },
      { label: t("alerts.queryConfig.cron"), value: "cron" },
    ]);

    const onFrequencyUnitChange = (modelValue: SelectModelValue) => {
      // Single-select of frequency units: value is a string at runtime.
      const unit = typeof modelValue === "string" ? modelValue : "";
      const prevMode = frequencyMode.value;
      isUserTriggerChange.value = true;
      frequencyMode.value = unit as "minutes" | "hours" | "cron";

      if (unit === "cron") {
        setFV("trigger_condition.frequency_type", "cron");
        // Auto-convert current frequency to cron if no expression yet
        // cronExpression / cronTimezone are form-backed computeds — assigning
        // them IS the form write, so the explicit setFV calls that used to
        // shadow them here are gone (they were the Rule-② double-write).
        if (!cronExpression.value) {
          let mins = Number(checkEveryFrequency.value);
          if (prevMode === "hours") mins = mins * 60;
          if (mins > 0) {
            cronExpression.value = convertMinutesToCron(mins);
          }
          // Entering cron mode is where a timezone first gets SAVED (parity:
          // pre-migration seeded it here, not at mount).
          if (!cronTimezone.value) {
            cronTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
          }
        }
        validateCron();
      } else {
        setFV("trigger_condition.frequency_type", "minutes");
        // Convert between minutes and hours. checkEveryFrequency is the DISPLAY
        // value; the stored field always gets MINUTES (frequencyMode is already
        // the NEW unit here, so setStoredFrequency converts correctly).
        if (unit === "hours" && prevMode === "minutes") {
          // Converting minutes to hours: round up
          const hrs = Math.max(1, Math.round(Number(checkEveryFrequency.value) / 60));
          checkEveryFrequency.value = hrs;
          setStoredFrequency(hrs); // → hrs * 60 minutes
        } else if (unit === "minutes" && prevMode === "hours") {
          // Converting hours to minutes
          const mins = Number(checkEveryFrequency.value) * 60;
          checkEveryFrequency.value = mins;
          setStoredFrequency(mins); // → mins, unchanged
        } else if (unit === "minutes" && prevMode === "cron") {
          // Coming back from cron, restore sensible default. Stored is already
          // minutes — adopt it as the display value verbatim.
          checkEveryFrequency.value = fv("trigger_condition.frequency") || 10;
        } else if (unit === "hours" && prevMode === "cron") {
          const mins = fv("trigger_condition.frequency") || 60;
          const hrs = Math.max(1, Math.round(mins / 60));
          checkEveryFrequency.value = hrs;
          setStoredFrequency(hrs); // → re-round stored to whole hours
        }
      }
      emitTriggerUpdate();
    };

    // The `name=` binding owns the write, but this handler runs BEFORE the
    // wrapper's own field.handleChange (merged listeners fire in declaration
    // order — see R6), so write through the computed FIRST: validateCron() and
    // emitTriggerUpdate() both re-read the form and would otherwise see the
    // STALE cron. Writing the same value twice targets the ONE form, so this is
    // ordering insurance — not a second source of truth.
    const onCronExpressionChange = (value: any) => {
      isUserTriggerChange.value = true;
      cronExpression.value = value;
      validateCron();
      emitTriggerUpdate();
    };

    const onCronTimezoneChange = (value: any) => {
      isUserTriggerChange.value = true;
      cronTimezone.value = value;
      validateCron();
      emitTriggerUpdate();
    };

    const onCheckEveryChange = (value: any) => {
      isUserTriggerChange.value = true;
      const parsed = value === "" || value === null || value === undefined ? null : Number(value);
      checkEveryFrequency.value = parsed;
      // Store as minutes internally (hours mode: multiply by 60).
      setStoredFrequency(parsed);
      emitTriggerUpdate();
    };

    const restoreDefaultFrequency = () => {
      if (
        checkEveryFrequency.value === null ||
        checkEveryFrequency.value === "" ||
        checkEveryFrequency.value === undefined ||
        Number.isNaN(Number(checkEveryFrequency.value))
      ) {
        const defaultVal = frequencyMode.value === "hours" ? 1 : 10;
        checkEveryFrequency.value = defaultVal;
        // hours → display 1 / stored 60; minutes → display 10 / stored 10.
        setStoredFrequency(defaultVal);
        emitTriggerUpdate();
      }
    };

    // Count of active filter conditions
    const filterCount = computed(() => {
      const conditions = props.inputData.conditions?.conditions;
      if (!conditions || !Array.isArray(conditions)) return 0;
      return conditions.filter((c: any) => c.filterType === "condition" && c.column).length;
    });

    // Ensure at least one empty filter condition exists on mount (filters are always visible now)
    // Empty condition is now provided by default form data in useAlertForm.ts

    // Aggregation functions (kept for legacy references)
    const aggFunctions = [
      "count",
      "min",
      "max",
      "avg",
      "sum",
      "median",
      "p50",
      "p75",
      "p90",
      "p95",
      "p99",
    ];

    // Trigger operators
    const triggerOperators = ["=", "!=", ">=", ">", "<=", "<", "Contains", "NotContains"];

    // Helper to get numeric columns based on selected function
    const getNumericColumns = (cols: any[]) => {
      if (selectedFunction.value === "count" || selectedFunction.value === "total_events") {
        return [...cols];
      }
      return cols.filter((column: any) => {
        if (typeof column === "string") return false;
        if (!column.type) return false;
        return !/(?:utf8|string)/i.test(column.type);
      });
    };

    // Computed column lists — OSelect handles built-in filtering, no @filter needed
    const numericColumns = computed(() => getNumericColumns(props.columns));

    // Get saved VRL functions from store
    const functionsList = computed(() => store.state.organizationData.functions || []);

    // Compute tab options based on stream type and alert type
    const tabOptions = computed(() => {
      // For real-time alerts, only show Builder (no tabs needed)
      if (props.isRealTime === "true") {
        return [
          {
            label: t("alerts.queryBuilder"),
            value: "custom",
          },
        ];
      }

      // For metrics, show all three tabs: Builder, SQL, PromQL
      if (props.streamType === "metrics") {
        return [
          {
            label: t("alerts.queryBuilder"),
            value: "custom",
          },
          {
            label: "SQL",
            value: "sql",
          },
          {
            label: "PromQL",
            value: "promql",
          },
        ];
      }

      // For logs and traces, show only Builder and SQL
      return [
        {
          label: t("alerts.queryBuilder"),
          value: "custom",
        },
        {
          label: "SQL",
          value: "sql",
        },
      ];
    });

    // Hide tabs completely for real-time alerts (only one option)
    const shouldShowTabs = computed(() => {
      return props.isRealTime === "false";
    });

    const updateTab = (tab: "sql" | "promql" | "custom") => {
      const hasComparisonWindow = props.multiTimeRange?.length > 0;

      // Check if switching to custom or promql while multi-windows are present
      if ((tab === "custom" || tab === "promql") && hasComparisonWindow) {
        // Show confirmation dialog
        pendingTab.value = tab;
        showMultiWindowDialog.value = true;
        return;
      }

      // When switching to custom mode, check if there's only one empty condition and remove it
      // This ensures generate_sql API is called
      if (tab === "custom" && props.inputData.conditions) {
        removeSingleEmptyCondition(props.inputData.conditions);
      }

      // No multi-windows, proceed with tab change
      localTab.value = tab;
      emit("update:tab", tab);
    };

    // Helper function to remove a single empty condition if that's the only condition present
    // READS `conditionsObj` (the readonly form read-view via props.inputData) but
    // WRITES through the form — see the empty-out below.
    const removeSingleEmptyCondition = (conditionsObj: any) => {
      if (!conditionsObj || !conditionsObj.conditions || !Array.isArray(conditionsObj.conditions)) {
        return;
      }

      // Only proceed if there's exactly one condition at the top level
      if (conditionsObj.conditions.length === 1) {
        const singleItem = conditionsObj.conditions[0];

        // Check if it's a condition (not a group) with empty column AND empty value
        if (singleItem.filterType === "condition") {
          const hasColumn = singleItem.column && singleItem.column.trim() !== "";
          const hasValue =
            singleItem.value !== undefined && singleItem.value !== "" && singleItem.value !== null;

          // If both column and value are empty, remove this condition.
          // Written through the form: `conditionsObj` is props.inputData.conditions,
          // i.e. part of the DEEP-READONLY `form.useStore` read-view, so the
          // pre-migration in-place `conditionsObj.conditions = []` silently
          // no-ops now (same failure mode as writeAggregation above).
          if (!hasColumn && !hasValue) {
            setFV("query_condition.conditions.conditions", []);
          }
        }
      }
    };

    const handleConfirmClearMultiWindows = () => {
      // Clear multi-windows
      emit("clear-multi-windows");

      // Wait for next tick to ensure multi-windows are cleared, then switch tab
      nextTick(() => {
        if (pendingTab.value) {
          localTab.value = pendingTab.value;
          emit("update:tab", pendingTab.value);
          pendingTab.value = null;
        }
        showMultiWindowDialog.value = false;
      });
    };

    const handleCancelClearMultiWindows = () => {
      pendingTab.value = null;
      showMultiWindowDialog.value = false;
    };

    // ── Conditions tree ↔ form bridge ────────────────────────────────────────
    // The 2 <FilterGroup> usages carry name-prefix="query_condition.conditions"
    // so FilterCondition binds each row's column/operator/value into THIS form.
    // Structural changes (add/remove/toggle/reorder) arrive as a NEW immutable
    // tree from FilterGroup and are written to the form by the ancestor
    // (useAlertForm.updateGroup/removeConditionGroup → setFieldValue). We just
    // forward the events. (The old code mutated the readonly `props.inputData`
    // read-view in place, which silently failed — nothing was added.)
    const updateGroup = (data: any) => {
      emit("update-group", data);
    };

    const removeConditionGroup = (data: any) => {
      emit("remove-group", data);
    };

    const onInputUpdate = (name: string, field: any) => {
      emit("input:update", name, field);
    };

    const sqlOrPromqlQuery = computed(() => {
      return localTab.value === "sql" ? props.sqlQuery : props.promqlQuery;
    });

    const updateSqlQuery = (value: string) => {
      localSqlQuery.value = value;
      emit("update:sqlQuery", value);
    };

    const updatePromqlQuery = (value: string) => {
      localPromqlQuery.value = value;
      emit("update:promqlQuery", value);
    };

    // Handler for VRL function updates from QueryEditorDialog
    // The dialog now emits plain text VRL (encoding happens once at save time)
    const handleVrlFunctionUpdate = (vrlValue: string) => {
      emit("update:vrlFunction", vrlValue);
    };

    // Handler for SQL validation from QueryEditorDialog
    const handleValidateSql = () => {
      emit("validate-sql");
    };

    // Emit trigger condition update (for non-aggregation mode).
    //
    // Emit the CURRENT FORM value (`fv` = form.getFieldValue, a synchronous
    // always-fresh read), never `props.triggerCondition` — the prop is a
    // `form.useStore` read-view that only refreshes next render, so it still
    // holds the PRE-write snapshot in a same-tick handler, and the parent's
    // whole-object `setFieldValue("trigger_condition", value)` would round-trip
    // that stale value back and clobber the writes.
    // `overrides` mirrors emitAggregationUpdate: a consumer @update:model-value
    // handler runs BEFORE field.handleChange commits, so `fv("trigger_condition")`
    // still holds the OLD value there. Callers that have the new value in hand must
    // pass it, or the parent receives a stale object.
    const emitTriggerUpdate = (overrides?: Record<string, any>) => {
      const tc = fv("trigger_condition");
      if (tc) {
        emit("update:triggerCondition", { ...tc, ...(overrides ?? {}) });
      }
    };

    // When metric function dropdown changes — handles count vs aggregation modes
    const onMetricFunctionChange = (modelValue: SelectModelValue) => {
      // Single-select of function names: value is a string at runtime.
      const value = typeof modelValue === "string" ? modelValue : "";
      if (value === "total_events") {
        // total_events (COUNT(*)) — no aggregation, trigger threshold shown inline
        localIsAggregationEnabled.value = false;
        emit("update:isAggregationEnabled", false);
      } else {
        // Measure mode — aggregation, always reset "having groups" to >= 1 on switch.
        // trigger_condition.threshold/operator are form-backed computeds (they also
        // drive the name= inputs) — no direct prop mutation / re-emit needed.
        localIsAggregationEnabled.value = true;
        triggerThreshold.value = 1;
        triggerOperator.value = ">=";
        emit("update:isAggregationEnabled", true);
        onFunctionChange(value);
      }
    };

    // When function dropdown changes (metrics only — always aggregation)
    const onFunctionChange = (value: string) => {
      localIsAggregationEnabled.value = true;
      emit("update:isAggregationEnabled", true);

      // Seed the whole aggregation subtree into the form so the name-owned
      // measure controls (column / operator / value / group_by) render it.
      writeAggregation((agg) => {
        agg.function = value;
        agg.having.operator = conditionOperator.value || ">=";
        agg.having.value = conditionValue.value ?? "";
      });
      emitAggregationUpdate();
    };

    // When log function mode changes (count / unique_count / avg / etc.)
    const onLogFunctionChange = (modelValue: SelectModelValue) => {
      // Single-select of function names: value is a string at runtime.
      const value = typeof modelValue === "string" ? modelValue : "";
      if (value === "total_events") {
        // total_events (COUNT(*)) — no aggregation, trigger threshold shown inline.
        // threshold/operator are form-backed computeds (also drive the name= inputs).
        localIsAggregationEnabled.value = false;
        emit("update:isAggregationEnabled", false);
        logMeasureColumn.value = "";
        // Restore default threshold for count mode
        triggerThreshold.value = 3;
        triggerOperator.value = ">=";
      } else {
        // Measure mode — uses aggregation, always reset "having groups" to >= 1 on switch
        localIsAggregationEnabled.value = true;
        triggerThreshold.value = 1;
        triggerOperator.value = ">=";
        emit("update:isAggregationEnabled", true);
        // First entry into measure mode opens on the loaded threshold (3 for a new
        // alert), matching the pre-migration setup seed; afterwards having.value
        // holds real loaded/user state and wins.
        const seedThisSwitch =
          measureSeedPending &&
          initialThresholdSeed !== undefined &&
          initialThresholdSeed !== null &&
          initialThresholdSeed !== "";
        measureSeedPending = false;
        writeAggregation((agg) => {
          agg.function = value;
          agg.having.operator = conditionOperator.value || ">=";
          agg.having.value = seedThisSwitch ? initialThresholdSeed : (conditionValue.value ?? "");
          agg.having.column = logMeasureColumn.value || "";
          agg.group_by = logGroupBy.value.length ? [...logGroupBy.value] : [];
        });
        emitAggregationUpdate();
      }
    };

    // When log measure column changes (for unique count / measure modes).
    // name="query_condition.aggregation.having.column" already wrote the value.
    // R6 PARITY: use the $event ARG, never a form re-read.
    // This handler is bound via `@update:model-value` on an <OFormSelect>, whose
    // inner OSelect declares `v-bind="$attrs"` BEFORE `@update:model-value=
    // "field.handleChange"`. Vue fires merged listeners in declaration order, so
    // THIS handler runs BEFORE the form is written — `fv(...)` would read the
    // STALE column and emit it (the SQL preview then lagged one edit).
    // Pre-migration did `aggregation.having.column = value; emitAggregationUpdate()`
    // i.e. it emitted an object that ALREADY carried the new column. The `name=`
    // binding now owns the write, so we only override the emitted copy.
    const onLogMeasureColumnChange = (value: string) => {
      const aggregation = fv("query_condition.aggregation");
      if (aggregation) {
        emitAggregationUpdate({
          having: { ...(aggregation.having ?? {}), column: value },
        });
      }
    };

    // Log group-by management — form-owned field array (Rule ①, :key=index).
    // add/remove via the form so the RENDERED inputs track the array; each change
    // is bridged into props.inputData.aggregation.group_by (in place) + emitted,
    // preserving the SQL-gen cadence.
    const addLogGroupByColumn = () => {
      form?.pushFieldValue?.("logGroupBy", "");
    };
    const deleteLogGroupByColumn = (index: number) => {
      form?.removeFieldValue?.("logGroupBy", index);
      onLogGroupByChange();
      // Reset threshold to 1 when last group-by field is removed (form-backed
      // computeds; no direct prop mutation / re-emit).
      if (((fv("logGroupBy") as string[]) ?? []).filter((f: string) => f?.trim()).length === 0) {
        triggerThreshold.value = 1;
        triggerOperator.value = ">=";
      }
    };
    const onLogGroupByChange = () => {
      if (!fv("query_condition.aggregation")) return;
      // OFormSelect fires this consumer `@update:model-value` BEFORE its own
      // internal `field.handleChange` commits the picked value into
      // logGroupBy[index] — the two update:model-value listeners run in
      // registration order, and the consumer's is registered first. Reading
      // logGroupBy synchronously here therefore copies the STALE array into
      // aggregation.group_by, dropping the column the user just picked (it
      // persisted as [""]; pre-migration avoided this with a direct v-model into
      // group_by[index]). Defer to nextTick so the copy reads the committed
      // logGroupBy — logGroupBy is a stripped _meta field, so group_by is the
      // only thing that survives to the payload and it MUST hold the real value.
      nextTick(() => {
        if (!fv("query_condition.aggregation")) return;
        writeAggregation((agg) => {
          agg.group_by = [...((fv("logGroupBy") as string[]) ?? [])];
        });
        emitAggregationUpdate();
      });
    };

    // When condition operator changes. The name= binding OWNS the value
    // (trigger_condition.operator in count mode, aggregation.having.operator in
    // measure mode) but has NOT written it yet — field.handleChange commits after
    // us — so pass it to the emit explicitly rather than reading back a stale one
    // (same fix as onLogMeasureColumnChange, which overrides `having.column`).
    const onConditionOperatorChange = (value: string) => {
      if (isEventBased.value && selectedFunction.value === "total_events") {
        emitTriggerUpdate({ operator: value });
      } else {
        const aggregation = fv("query_condition.aggregation");
        if (aggregation) {
          emitAggregationUpdate({
            having: { ...(aggregation.having ?? {}), operator: value },
          });
        }
      }
    };

    // When condition value changes.
    //
    // The write below is load-bearing for the EMIT, not for the payload: this
    // handler runs BEFORE OFormInput's field.handleChange commits (the wrapper
    // registers v-bind="$attrs" ahead of its own @update:model-value), so writing
    // first is what lets emitAggregationUpdate/emitTriggerUpdate read the fresh
    // value instead of a stale one. Do NOT delete it — that is the same stale-read
    // trap that silently saved group_by as [""].
    //
    // Its Number() coercion, however, does NOT reach the payload on the else
    // branch: handleChange commits the raw string to the SAME field afterwards and
    // wins. `having.value` is therefore coerced at payload build (getAlertPayload),
    // which also keeps form state a string so typing a decimal ("5." → "5.5")
    // isn't fought mid-keystroke. The total_events branch targets a DIFFERENT
    // field (trigger_condition.threshold) that handleChange never touches, so the
    // Number() does survive there.
    const onConditionValueChange = (value: any) => {
      const parsed = value === "" || value === null || value === undefined ? null : Number(value);
      if (isEventBased.value && selectedFunction.value === "total_events") {
        isUserTriggerChange.value = true;
        triggerThreshold.value = parsed;
        emitTriggerUpdate();
      } else {
        conditionValue.value = parsed;
        emitAggregationUpdate();
      }
    };

    // Legacy toggle kept for compatibility — not used in new UI
    const toggleAggregation = () => {
      emit("update:isAggregationEnabled", localIsAggregationEnabled.value);
    };

    // Metric group-by field array (form-owned; name="query_condition.aggregation.
    // group_by[i]"). form is the source; props.inputData.aggregation.group_by is
    // the write-through copy that feeds SQL-gen.
    const syncMetricGroupByToProps = () => {
      // group_by is form-owned via the name= bindings; just refresh the preview.
      // Deferred to nextTick for the same reason as onLogGroupByChange: this
      // consumer @update:model-value runs BEFORE OFormSelect's internal
      // field.handleChange commits group_by[index], so emitting synchronously
      // would push a stale aggregation up to the parent's setF and clobber the
      // just-picked value. nextTick reads the committed group_by.
      nextTick(() => {
        if (fv("query_condition.aggregation")) {
          emitAggregationUpdate();
        }
      });
    };

    // Add group by column
    const addGroupByColumn = () => {
      if (fv("query_condition.aggregation")) {
        form?.pushFieldValue?.("query_condition.aggregation.group_by", "");
        syncMetricGroupByToProps();
      }
    };

    // Delete group by column
    const deleteGroupByColumn = (index: string | number) => {
      const idx = typeof index === "string" ? parseInt(index) : index;
      if (!fv("query_condition.aggregation")) return;
      form?.removeFieldValue?.("query_condition.aggregation.group_by", idx);
      syncMetricGroupByToProps();
      // Reset threshold to 1 when last group-by field is removed (form-backed
      // computeds; no direct prop mutation / re-emit).
      const remaining = ((fv("query_condition.aggregation.group_by") as string[]) || []).filter(
        (f: string) => f?.trim(),
      ).length;
      if (remaining === 0) {
        triggerThreshold.value = 1;
        triggerOperator.value = ">=";
      }
    };

    // Emit aggregation update — read the fresh value off the form (props.inputData
    // is the readonly read-view and can lag / be stale after writeAggregation).
    // `overrides` (R6): for callers that run BEFORE the form is written — i.e. an
    // `@update:model-value` handler on an OForm* control, which fires ahead of the
    // wrapper's own `field.handleChange` — so the emit still carries that control's
    // NEW value instead of the stale one still sitting in the form.
    const emitAggregationUpdate = (overrides?: Record<string, any>) => {
      const aggregation = fv("query_condition.aggregation");
      emit(
        "update:aggregation",
        overrides ? { ...(aggregation ?? {}), ...overrides } : aggregation,
      );
    };

    // Emit PromQL condition update — read the fresh value off the form.
    const emitPromqlConditionUpdate = () => {
      emit("update:promqlCondition", fv("query_condition.promql_condition"));
    };

    // PromQL operator/value — name-owned OForm*. Write through the form (never the
    // readonly props.promqlCondition read-view) + emit for the SQL-preview.
    const onPromqlOperatorChange = (val: any) => {
      if (fv("query_condition.promql_condition")) {
        setFV("query_condition.promql_condition.operator", val);
        emitPromqlConditionUpdate();
      }
    };
    const onPromqlValueChange = (val: any) => {
      if (fv("query_condition.promql_condition")) {
        // Write-then-emit: this runs before field.handleChange commits, so the
        // write is what makes emitPromqlConditionUpdate read the fresh value.
        // The Number() does NOT reach the payload — handleChange overwrites this
        // same field with the raw string right after. promql_condition.value is
        // coerced at payload build (getAlertPayload); see the note there.
        setFV(
          "query_condition.promql_condition.value",
          val === "" || val === null || val === undefined ? val : Number(val),
        );
        emitPromqlConditionUpdate();
      }
    };
    // Seed the form when the parent creates/replaces promql_condition async
    // (useAlertForm builds it on the first switch to the PromQL tab).
    watch(
      () => props.promqlCondition,
      (pc) => {
        if (pc) setFV("query_condition.promql_condition", pc);
      },
      { deep: true, immediate: false },
    );

    // Watch for SQL editor dialog state changes
    // Sync local state when parent props update (e.g. after loading an existing alert async)
    watch(
      () => props.tab,
      (newTab) => {
        if (newTab && newTab !== localTab.value) {
          localTab.value = newTab;
        }
      },
    );
    watch(
      () => props.sqlQuery,
      (newVal) => {
        if (newVal !== undefined && newVal !== localSqlQuery.value) {
          localSqlQuery.value = newVal;
        }
      },
    );
    watch(
      () => props.promqlQuery,
      (newVal) => {
        if (newVal !== undefined && newVal !== localPromqlQuery.value) {
          localPromqlQuery.value = newVal;
        }
      },
    );
    watch(
      () => props.vrlFunction,
      (newVal) => {
        if (newVal !== undefined && newVal !== vrlFunctionContent.value) {
          vrlFunctionContent.value = newVal;
        }
        // Auto-enable VRL pane when a function is present
        if (newVal?.trim()) {
          showVrl.value = true;
        }
      },
    );

    watch(viewSqlEditor, (newValue, oldValue) => {
      // Emit state change whenever it changes
      emit("editor-state-changed", newValue);

      // When dialog closes (goes from true to false), emit event to refresh preview
      if (oldValue === true && newValue === false) {
        emit("editor-closed");
      }
    });

    // Sync aggregation state when columns prop changes (async stream load)
    watch(
      () => props.columns,
      (newCols) => {
        const agg = fv("query_condition.aggregation");
        if (!isEventBased.value && agg?.having) {
          const currentCol = agg.having.column;
          const colExistsInNewStream = currentCol
            ? newCols.some((c: any) => (typeof c === "string" ? c : c.value) === currentCol)
            : false;
          const hasValue = newCols.some(
            (c: any) => (typeof c === "string" ? c : c.value) === "value",
          );

          if (currentCol && !colExistsInNewStream) {
            // Stream changed — previously selected column is no longer valid, clear it
            // and auto-set to "value" only if the new stream has it
            writeAggregation((a) => {
              a.having.column = hasValue ? "value" : "";
            });
            emitAggregationUpdate();
          } else if (!currentCol && hasValue) {
            // Column not set yet — auto-set to "value" if new stream has it
            writeAggregation((a) => {
              a.having.column = "value";
            });
            emitAggregationUpdate();
          }
        }
      },
    );

    // Watch for isAggregationEnabled prop changes (for loading saved alerts)
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        localIsAggregationEnabled.value = newVal;
        // Sync all aggregation-dependent UI state when aggregation becomes enabled during load
        // (e.g. editing a logs/traces alert that was saved with avg/sum/etc.)
        if (newVal && props.inputData.aggregation) {
          const agg = props.inputData.aggregation;
          if (agg.function) {
            selectedFunction.value = agg.function;
          }
          if (agg.having?.column) {
            logMeasureColumn.value = agg.having.column;
          }
          if (agg.having?.operator) {
            conditionOperator.value = agg.having.operator;
          }
          if (agg.having?.value !== undefined && agg.having?.value !== null) {
            conditionValue.value = agg.having.value;
          }
          if (agg.group_by?.length) {
            logGroupBy.value = [...agg.group_by.filter((g: string) => g?.trim())];
          }
        }
      },
    );

    // Sync from aggregation data when it changes (e.g. loading saved metric alert)
    watch(
      () => props.inputData.aggregation,
      (agg) => {
        if (isEventBased.value) return; // Only for metrics
        // conditionOperator/conditionValue are form-backed computeds that already
        // reflect aggregation.having — writing them back here just re-triggers
        // this same deep watcher (setFieldValue doesn't dedup identical values),
        // looping. Only selectedFunction (a plain ref discriminator) needs syncing.
        if (agg?.function) {
          selectedFunction.value = agg.function;
        }
      },
      { deep: true, immediate: false },
    );

    // Sync from trigger_condition when it changes (e.g. loading saved alert)
    watch(
      () => props.triggerCondition,
      (tc) => {
        if (!tc) return;
        // Skip frequency mode sync when the change was triggered by user interaction
        if (isUserTriggerChange.value) {
          isUserTriggerChange.value = false;
          return;
        }
        // In measure mode with empty group-by, always reset to >= 1 (field is disabled, user can't edit it)
        const inMeasureMode = selectedFunction.value !== "total_events";
        const groupByEmpty = isEventBased.value
          ? !hasLogGroupByFields.value
          : !hasMetricGroupByFields.value;
        if (inMeasureMode && groupByEmpty) {
          // Force ">= 1" (the disabled field can't be user-edited). Write through
          // the FORM and ONLY when the value actually differs. The old code mutated
          // the readonly form read-view (`tc`) and re-emitted a fresh object here;
          // because the readonly write silently fails, the guard never settled and
          // this deep watcher re-fired forever ("Maximum recursive updates").
          if (fv("trigger_condition.operator") !== ">=") {
            setFV("trigger_condition.operator", ">=");
          }
          if (fv("trigger_condition.threshold") !== 1) {
            setFV("trigger_condition.threshold", 1);
          }
        }
        // (triggerOperator / triggerThreshold are form-backed computeds — they
        //  already reflect the stored value, so no read-back sync is needed.)
        // Sync the DISPLAY value from the stored MINUTES. This is a READ of
        // trigger_condition and a WRITE to `_ui.checkEvery` ONLY — never write
        // the stored field here: this watcher watches trigger_condition DEEPLY,
        // so writing it back re-fires this same watcher ("Maximum recursive
        // updates"), and writing a DISPLAY value into it (e.g. 2 for "2 hours")
        // both corrupts the stored minutes and makes the next pass re-read
        // 2 < 60 → flip the mode to minutes, silently rewriting a saved 2-hour
        // alert to 2 minutes. `_ui` is outside trigger_condition, so this is
        // recursion-safe by construction.
        const freq = tc.frequency ?? 10;
        if (tc.frequency_type === "cron") {
          frequencyMode.value = "cron";
          checkEveryFrequency.value = freq;
        } else if (freq >= 60 && freq % 60 === 0) {
          frequencyMode.value = "hours";
          checkEveryFrequency.value = freq / 60;
        } else {
          frequencyMode.value = "minutes";
          checkEveryFrequency.value = freq;
        }
        // cron/timezone need NO sync here: they are form-owned (name=-bound), so
        // the controls already read `tc`. Re-assigning them would write straight
        // back into the deeply-watched trigger_condition and re-trigger THIS
        // watcher (the "Maximum recursive updates" trap noted above).
      },
      { deep: true, immediate: false },
    );

    // When function switches to measure mode, reset threshold to >= 1 if group-by is empty
    watch(selectedFunction, (value) => {
      if (value === "total_events") return;
      const groupByEmpty = isEventBased.value
        ? !hasLogGroupByFields.value
        : !hasMetricGroupByFields.value;
      if (groupByEmpty) {
        // form-backed computeds; no direct prop mutation / re-emit.
        triggerThreshold.value = 1;
        triggerOperator.value = ">=";
      }
    });

    // ── `_meta` discriminator bridge ─────────────────────────────────────────
    // Push the current bare mode-selectors into the form so the schema's
    // superRefine fires each rule only in the branch that applies (the sanctioned
    // watch → setFieldValue bridge for NON-input discriminators).
    const syncMeta = () => {
      const meta: QueryConfigMeta = {
        tab: localTab.value as any,
        isRealTime: props.isRealTime,
        isEventBased: isEventBased.value,
        selectedFunction: selectedFunction.value,
        frequencyMode: frequencyMode.value,
        hasConditions: !!props.inputData.conditions?.conditions?.length,
        hasGroupBy: isEventBased.value ? hasLogGroupByFields.value : hasMetricGroupByFields.value,
        aggregationEnabled: localIsAggregationEnabled.value,
        // SECONDS, raw from zoConfig — the schema derives ceil(secs/60) itself.
        minAutoRefreshInterval: Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0,
      };
      setFV("_meta", meta);
    };
    watch(
      [
        localTab,
        () => props.isRealTime,
        isEventBased,
        selectedFunction,
        frequencyMode,
        () => props.inputData.conditions,
        localIsAggregationEnabled,
        hasLogGroupByFields,
        hasMetricGroupByFields,
      ],
      () => syncMeta(),
      { deep: true, immediate: true },
    );

    // NOTE: the old exposed validate() (the wizard's step2Ref contract) is gone.
    // The field rules run through the composed AddAlert schema on save
    // (handleSave → form.handleSubmit), and the imperative query-text gates
    // (empty SQL / SQL error / empty PromQL / aggregate-column toast) are
    // re-homed in useAlertForm.runImperativeQueryChecks (same messages).

    const highlightedSqlQuery = computed(() => {
      if (!props.generatedSqlQuery) return "";
      return hljs.highlight(props.generatedSqlQuery, { language: "sql" }).value;
    });

    return {
      t,
      store,
      highlightedSqlQuery,
      localTab,
      tabOptions,
      shouldShowTabs,
      updateTab,
      updateGroup,
      removeConditionGroup,
      onInputUpdate,
      sqlOrPromqlQuery,
      viewSqlEditor,
      localSqlQuery,
      localPromqlQuery,
      vrlFunctionContent,
      selectedSavedFunctionName,
      updateSqlQuery,
      updatePromqlQuery,
      handleVrlFunctionUpdate,
      handleValidateSql,
      functionsList,
      // Field refs for focus manager
      customPreviewRef,
      sqlPromqlPreviewRef,
      // Multi-window dialog
      showMultiWindowDialog,
      pendingTab,
      handleConfirmClearMultiWindows,
      handleCancelClearMultiWindows,
      // Aggregation & inline condition
      localIsAggregationEnabled,
      aggFunctions,
      triggerOperators,
      numericColumns,
      toggleAggregation,
      addGroupByColumn,
      deleteGroupByColumn,
      emitAggregationUpdate,
      emitPromqlConditionUpdate,
      // V3.1 inline condition
      isEventBased,
      logFunctionOptions,
      numericOperators,
      selectedFunction,
      conditionOperator,
      conditionValue,
      triggerOperator,
      triggerThreshold,
      onTriggerOperatorChange,
      onTriggerThresholdChange,
      restoreDefaultThreshold,
      hasLogGroupByFields,
      hasMetricGroupByFields,
      checkEveryFrequency,
      onCheckEveryChange,
      restoreDefaultFrequency,
      frequencyMode,
      cronExpression,
      cronTimezone,
      cronError,
      cronDescription,
      thresholdError,
      promqlValueError,
      checkEveryError,
      havingValueError,
      filteredTimezones,
      onFrequencyUnitChange,
      frequencyUnitOptions,
      onCronExpressionChange,
      onCronTimezoneChange,
      logMeasureColumn,
      logGroupBy,
      onFunctionChange,
      onMetricFunctionChange,
      onLogFunctionChange,
      onLogMeasureColumnChange,
      addLogGroupByColumn,
      deleteLogGroupByColumn,
      onLogGroupByChange,
      onConditionOperatorChange,
      onConditionValueChange,
      showFilters,
      toggleFilters,
      filtersSectionRef,
      showVrl,
      filterCount,
      emitTriggerUpdate,
      getImageURL,
      queryEditorPlaceholderFlag,
      vrlEditorPlaceholderFlag,
      vrlPlaceholder,
      onQueryEditorFocus,
      onBlurInlineSqlEditor,
      onBlurInlineVrlEditor,
      inlineStatusState,
      inlineStatusBarClass,
      inlineQueryEditorRef,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      handleInlineQueryUpdate,
      inlineEditorPlaceholder,
      onPromqlOperatorChange,
      onPromqlValueChange,
      syncMetricGroupByToProps,
      // Reactive views of the group-by field arrays (render source, Rule ①)
      logGroupByRows: logGroupByStore,
      metricGroupByRows: metricGroupByStore,
    };
  },
});
</script>
