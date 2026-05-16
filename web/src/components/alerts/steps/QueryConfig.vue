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
  <div class="step-query-config" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container">
      <!-- Section header -->
      <div class="section-header">
        <div class="section-header-accent" />
        <span class="section-header-title">{{ t('alerts.queryConfig.sectionTitle') }}</span>
      </div>
      <div class="tw:px-3 tw:py-2 tw:min-w-0 tw:w-full tw:box-border">
      <!-- Query Mode Tabs (hidden for real-time alerts) -->
      <div v-if="shouldShowTabs" class="tw:mb-2 tw:flex tw:items-center tw:justify-between">
        <OToggleGroup
          :model-value="localTab"
          @update:model-value="updateTab($event as string)"
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
        {{ t('alerts.queryConfig.openFullEditor') }}
      </OButton>
      </div>

      <!-- Custom Query Builder -->
      <template v-if="localTab === 'custom'">
        <q-form ref="customConditionsForm" greedy>

          <!-- Section 1: Alert condition sentence — scheduled only -->
          <div v-if="isRealTime === 'false'" class="alert-condition-rows">

            <!-- LOGS/TRACES -->
            <template v-if="isEventBased">
              <!-- Alert if row -->
              <div class="alert-condition-row">
                <span class="condition-label">Alert if *</span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="selectedFunction"
                    :options="logFunctionOptions"
                    emit-value
                    map-options
                    dense
                    borderless
                    hide-bottom-space
                    class="alert-v3-select"
                    style="min-width: 130px; max-width: 180px;"
                    @update:model-value="onLogFunctionChange"
                  >
                    <q-tooltip :delay="400">
                      {{ logFunctionOptions.find((o: any) => o.value === selectedFunction)?.tooltip || '' }}
                    </q-tooltip>
                    <template #option="{ opt, itemProps }">
                      <q-item v-bind="itemProps" dense>
                        <q-item-section>
                          <q-item-label>{{ opt.label }}</q-item-label>
                        </q-item-section>
                        <q-tooltip v-if="opt.tooltip" anchor="center right" self="center left" :delay="300">
                          {{ opt.tooltip }}
                        </q-tooltip>
                      </q-item>
                    </template>
                  </q-select>
                  <!-- "of [field]" shown for measure modes -->
                  <template v-if="selectedFunction !== 'total_events'">
                    <span class="condition-text">of</span>
                    <q-select
                      v-model="logMeasureColumn"
                      :options="filteredLogMeasureColumns"
                      emit-value
                      dense
                      borderless
                      use-input
                      hide-selected
                      fill-input
                      hide-bottom-space
                      :placeholder="t('alerts.placeholders.selectColumn')"
                      @filter="filterLogMeasureColumns"
                      class="alert-v3-select"
                      :class="columnSelectError ? 'column-select-error' : ''"
                      style="min-width: 140px; max-width: 200px;"
                      @update:model-value="columnSelectError = false; onLogMeasureColumnChange($event)"
                    />
                  </template>

                  <!-- COUNT mode -->
                  <template v-if="selectedFunction === 'total_events'">
                    <q-select
                      v-model="triggerOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="alert-v3-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <q-input
                      v-model="triggerThreshold"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      no-error-icon
                      @blur="restoreDefaultThreshold"
                      class="alert-v3-input"
                      style="min-width: 60px; max-width: 80px;"
                      min="1"
                      :rules="[(val: any) => !!val || 'Required']"
                      @update:model-value="onTriggerThresholdChange"
                    />
                    <span v-if="streamName" class="condition-text">matching {{ streamType === 'traces' ? 'traces' : 'logs' }} found</span>
                  </template>

                  <!-- MEASURE mode -->
                  <template v-else>
                    <span class="condition-text">is</span>
                    <q-select
                      v-model="conditionOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="alert-v3-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onConditionOperatorChange"
                    />
                    <q-input
                      v-model="conditionValue"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      no-error-icon
                      :placeholder="t('alerts.placeholders.value')"
                      class="alert-v3-input"
                      style="min-width: 80px; max-width: 120px;"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      @update:model-value="onConditionValueChange"
                    />
                  </template>
                </div>
              </div>

              <!-- group by row (hidden for count mode) -->
              <div v-if="selectedFunction !== 'total_events'" class="alert-condition-row">
                <span class="condition-label tw:font-bold">
                  {{ t('alerts.groupBy') }}
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    {{ t('alerts.queryConfig.groupByTooltip') }}
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  <template
                    v-for="(group, index) in logGroupBy"
                    :key="index"
                  >
                    <div class="tw:flex tw:items-center tw:gap-1">
                      <q-select
                        v-model="logGroupBy[index]"
                        :options="filteredFields"
                        class="alert-v3-select"
                        borderless
                        dense
                        use-input
                        emit-value
                        hide-selected
                        :placeholder="t('alerts.placeholders.selectColumn')"
                        fill-input
                        :input-debounce="400"
                        hide-bottom-space
                        @filter="(val: string, update: any) => filterFields(val, update)"
                        style="min-width: 120px; max-width: 180px;"
                        @update:model-value="onLogGroupByChange"
                      />
                      <OButton
                        variant="ghost"
                        size="icon-circle-sm"
                        class="tw:text-gray-400 hover:tw:text-red-500"
                        @click="deleteLogGroupByColumn(index)"
                      >
                        <OIcon name="close" size="sm" />
                      </OButton>
                    </div>
                  </template>
                  <OButton
                    variant="ghost-primary"
                    size="icon-circle-sm"
                    @click="addLogGroupByColumn"
                  >
                    <OIcon name="add" size="sm" />
                    <q-tooltip>{{ t('alerts.queryConfig.addGroupByField') }}</q-tooltip>
                  </OButton>
                </div>
              </div>

              <!-- no. of groups row — visible only when group-by fields are added -->
              <div v-if="selectedFunction !== 'total_events' && hasLogGroupByFields" class="alert-condition-row">
                <span class="condition-label tw:font-bold">
                  {{ t('alerts.queryConfig.havingGroups') }}
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    {{ t('alerts.queryConfig.havingGroupsTooltip') }}
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="triggerOperator"
                    :options="numericOperators"
                    dense borderless hide-bottom-space
                    class="alert-v3-select"
                    style="min-width: 70px; max-width: 120px;"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <q-input
                    v-model="triggerThreshold"
                    type="number"
                    dense borderless hide-bottom-space
                    class="alert-v3-input"
                    style="min-width: 60px; max-width: 80px;"
                    min="1"
                    @update:model-value="onTriggerThresholdChange"
                    @blur="restoreDefaultThreshold"
                  />
                </div>
              </div>
            </template>

            <!-- METRICS -->
            <template v-else>
              <!-- Alert if row -->
              <div class="alert-condition-row">
                <span class="condition-label">Alert if *</span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="selectedFunction"
                    :options="logFunctionOptions"
                    emit-value
                    map-options
                    dense
                    borderless
                    hide-bottom-space
                    class="alert-v3-select"
                    style="min-width: 130px; max-width: 180px;"
                    @update:model-value="onMetricFunctionChange"
                  >
                    <q-tooltip :delay="400">
                      {{ logFunctionOptions.find((o: any) => o.value === selectedFunction)?.tooltip || '' }}
                    </q-tooltip>
                    <template #option="{ opt, itemProps }">
                      <q-item v-bind="itemProps" dense>
                        <q-item-section>
                          <q-item-label>{{ opt.label }}</q-item-label>
                        </q-item-section>
                        <q-tooltip v-if="opt.tooltip" anchor="center right" self="center left" :delay="300">
                          {{ opt.tooltip }}
                        </q-tooltip>
                      </q-item>
                    </template>
                  </q-select>

                  <!-- "of [field]" hidden for count mode -->
                  <template v-if="selectedFunction !== 'total_events'">
                    <span class="condition-text">of</span>
                    <div style="position: relative; display: inline-flex;">
                      <q-select
                        v-model="inputData.aggregation.having.column"
                        :options="filteredNumericColumns"
                        emit-value
                        dense
                        borderless
                        use-input
                        hide-selected
                        fill-input
                        hide-bottom-space
                        :placeholder="t('alerts.placeholders.selectColumn')"
                        :readonly="inputData.aggregation.having.column === 'value' && filteredNumericColumns.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value')"
                        :disable="inputData.aggregation.having.column === 'value' && filteredNumericColumns.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value')"
                        @filter="filterNumericColumns"
                        @update:model-value="columnSelectError = false; emitAggregationUpdate()"
                        class="alert-v3-select"
                        :class="columnSelectError ? 'column-select-error' : ''"
                        style="min-width: 140px; max-width: 200px;"
                      />
                      <q-tooltip v-if="inputData.aggregation.having.column === 'value' && filteredNumericColumns.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value')" anchor="bottom middle" self="top middle" :delay="300">
                        Metrics streams store their measurement in the "value" field by default
                      </q-tooltip>
                    </div>
                    <span class="condition-text">is</span>
                  </template>

                  <!-- Count mode for metrics -->
                  <template v-if="selectedFunction === 'total_events'">
                    <q-select
                      v-model="triggerOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="alert-v3-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <q-input
                      v-model="triggerThreshold"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      no-error-icon
                      class="alert-v3-input"
                      style="min-width: 80px; max-width: 120px;"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      @update:model-value="onTriggerThresholdChange"
                    />
                    <span class="condition-text">matching metrics found</span>
                  </template>

                  <!-- Measure mode for metrics -->
                  <template v-else>
                    <q-select
                      v-model="conditionOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="alert-v3-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onConditionOperatorChange"
                    />
                    <q-input
                      v-model="conditionValue"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      no-error-icon
                      :placeholder="t('alerts.placeholders.value')"
                      class="alert-v3-input"
                      style="min-width: 80px; max-width: 120px;"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      @update:model-value="onConditionValueChange"
                    />
                  </template>
                </div>
              </div>

              <!-- group by row — hidden for count mode -->
              <div v-if="inputData.aggregation && selectedFunction !== 'total_events'" class="alert-condition-row">
                <span class="condition-label tw:font-bold">
                  {{ t('alerts.groupBy') }}
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    {{ t('alerts.queryConfig.groupByTooltip') }}
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  <template
                    v-for="(group, index) in inputData.aggregation.group_by"
                    :key="index"
                  >
                    <div class="tw:flex tw:items-center tw:gap-1">
                      <q-select
                        v-model="inputData.aggregation.group_by[index]"
                        :options="filteredFields"
                        class="alert-v3-select"
                        borderless
                        dense
                        use-input
                        emit-value
                        hide-selected
                        :placeholder="t('alerts.placeholders.selectColumn')"
                        fill-input
                        :input-debounce="400"
                        hide-bottom-space
                        @filter="(val: string, update: any) => filterFields(val, update)"
                        style="min-width: 120px; max-width: 180px;"
                        @update:model-value="emitAggregationUpdate"
                      />
                      <OButton
                        variant="ghost"
                        size="icon-circle-sm"
                        class="tw:text-gray-400 hover:tw:text-red-500"
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
                    <q-tooltip>{{ t('alerts.queryConfig.addGroupByField') }}</q-tooltip>
                  </OButton>
                </div>
              </div>

              <!-- no. of groups row — visible only when group-by fields are added -->
              <div v-if="selectedFunction !== 'total_events' && hasMetricGroupByFields" class="alert-condition-row">
                <span class="condition-label tw:font-bold">
                  {{ t('alerts.queryConfig.havingGroups') }}
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    {{ t('alerts.queryConfig.havingGroupsTooltip') }}
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="triggerOperator"
                    :options="numericOperators"
                    dense borderless hide-bottom-space
                    class="alert-v3-select"
                    style="min-width: 70px; max-width: 120px;"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <q-input
                    v-model="triggerThreshold"
                    type="number"
                    dense borderless hide-bottom-space
                    class="alert-v3-input"
                    style="min-width: 60px; max-width: 80px;"
                    min="1"
                    @update:model-value="onTriggerThresholdChange"
                    @blur="restoreDefaultThreshold"
                  />
                </div>
              </div>
            </template>

            <!-- Check every row -->
            <div class="alert-condition-row tw:!items-start">
              <span class="condition-label" style="line-height: 28px;">
                Check every *
                <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                  How often to check this alert condition
                </q-tooltip>
              </span>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <!-- Minutes/hours mode: number input -->
                  <template v-if="frequencyMode !== 'cron'">
                    <q-input
                      v-model="checkEveryFrequency"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      no-error-icon
                      class="alert-v3-input"
                      style="min-width: 100px; max-width: 100px;"
                      min="1"
                      :rules="[(val: any) => !!val || 'Required']"
                      @update:model-value="onCheckEveryChange"
                      @blur="restoreDefaultFrequency"
                    />
                  </template>
                  <!-- Cron mode: expression input + timezone -->
                  <template v-else>
                    <q-input
                      v-model="cronExpression"
                      dense
                      borderless
                      hide-bottom-space
                      class="alert-v3-input"
                      placeholder="0 */10 * * * *"
                      style="min-width: 100px; max-width: 100px;"
                      @update:model-value="onCronExpressionChange"
                    />
                  </template>

                  <!-- Unit dropdown: minutes / hours / cron -->
                  <q-select
                    :model-value="frequencyMode"
                    :options="frequencyUnitOptions"
                    dense
                    borderless
                    hide-bottom-space
                    emit-value
                    map-options
                    class="alert-v3-select frequency-unit-select"
                    style="min-width: 80px; max-width: 100px;"
                    @update:model-value="onFrequencyUnitChange"
                  />

                  <!-- Timezone (only for cron, inline) -->
                  <template v-if="frequencyMode === 'cron'">
                    <q-select
                      v-model="cronTimezone"
                      :options="filteredTimezones"
                      dense
                      borderless
                      hide-bottom-space
                      use-input
                      emit-value
                      fill-input
                      hide-selected
                      :input-debounce="0"
                      class="alert-v3-select"
                      placeholder="timezone"
                      :display-value="cronTimezone || 'timezone'"
                      style="min-width: 150px; max-width: 150px;"
                      @filter="timezoneFilterFn"
                      @update:model-value="onCronTimezoneChange"
                    >
                    <q-tooltip v-if="cronTimezone" :delay="300" anchor="bottom middle" self="top middle">{{ cronTimezone }}</q-tooltip>
                  </q-select>
                  </template>

                  <span class="condition-text">on these</span>
                  <div
                    class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:select-none filters-inline-toggle tw:px-2 tw:py-0.5 tw:rounded-md tw:transition-colors"
                    :class="store.state.theme === 'dark'
                      ? 'tw:bg-gray-700/60 hover:tw:bg-gray-600/70'
                      : 'tw:bg-gray-100 hover:tw:bg-gray-200'"
                    @click="toggleFilters"
                  >
                    <OIcon
                      name="filter-alt"
                      size="xs"
                      :class="filterCount > 0
                        ? 'tw:text-[var(--q-primary)]'
                        : (store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500')"
                    />
                    <span class="tw:text-xs tw:font-semibold"
                          :class="filterCount > 0
                            ? 'tw:text-[var(--q-primary)]'
                            : (store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-600')">
                      filters
                    </span>
                    <span v-if="filterCount > 0"
                          class="tw:text-[11px] tw:px-1.5 tw:py-0 tw:rounded-full tw:font-bold tw:leading-5"
                          :class="store.state.theme === 'dark' ? 'tw:bg-blue-800 tw:text-blue-200' : 'tw:bg-blue-100 tw:text-blue-700'">
                      {{ filterCount }}
                    </span>
                    <OIcon
                      :name="showFilters ? 'expand-more' : 'chevron-right'"
                      size="14px"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    />
                    <!-- Review your SQL query hint -->
                    <span v-if="generatedSqlQuery && !showFilters"
                          class="tw:text-xs tw:italic tw:ml-1 sql-query-hint"
                          :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'">
                      view the alert query
                      <q-tooltip
                        anchor="bottom middle"
                        self="top middle"
                        :delay="200"
                        max-width="500px"
                        class="sql-preview-tooltip"
                      >
                        <pre class="hljs tw:text-xs tw:m-0 tw:whitespace-pre-wrap tw:font-mono tw:p-2 tw:rounded" v-html="highlightedSqlQuery" />
                      </q-tooltip>
                    </span>
                  </div>
                </div>

                <!-- Cron description + error -->
                <div v-if="frequencyMode === 'cron' && cronDescription && !cronError" class="tw:text-[11px] tw:ml-0 tw:italic"
                     :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'">
                  {{ cronDescription }}
                </div>
                <div v-if="frequencyMode === 'cron' && cronError" class="tw:text-red-500 tw:text-[11px] tw:ml-0">
                  {{ cronError }}
                </div>
              </div>
            </div>
          </div>

          <!-- Filters section — scheduled -->
          <div v-if="isRealTime === 'false'" ref="filtersSectionRef" class="tw:mt-1 tw:px-3">
            <div v-show="showFilters" ref="customPreviewRef">
              <FilterGroup
                :stream-fields="columns"
                :stream-fields-map="streamFieldsMap"
                :show-sql-preview="false"
                :sql-query="generatedSqlQuery"
                :group="inputData.conditions"
                :depth="0"
                module="alerts"
                @add-condition="updateGroup"
                @add-group="updateGroup"
                @remove-group="removeConditionGroup"
                @input:update="onInputUpdate"
              />
            </div>
          </div>

          <!-- Realtime — no threshold sentence, just filters always visible -->
          <div v-else class="tw:mb-1 tw:px-3">
            <div class="tw:flex tw:items-center tw:gap-2 tw:py-1">
              <div
                class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:select-none filters-inline-toggle tw:px-2 tw:py-0.5 tw:rounded-md tw:transition-colors"
                :class="store.state.theme === 'dark'
                  ? 'tw:bg-gray-700/60 hover:tw:bg-gray-600/70'
                  : 'tw:bg-gray-100 hover:tw:bg-gray-200'"
                @click="toggleFilters"
              >
                <OIcon
                  name="filter-alt"
                  size="xs"
                  :class="filterCount > 0
                    ? 'tw:text-[var(--q-primary)]'
                    : (store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500')"
                />
                <span class="tw:text-xs tw:font-semibold"
                      :class="filterCount > 0
                        ? 'tw:text-[var(--q-primary)]'
                        : (store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-600')">
                  filters
                </span>
                <span v-if="filterCount > 0"
                      class="tw:text-[11px] tw:px-1.5 tw:py-0 tw:rounded-full tw:font-bold tw:leading-5"
                      :class="store.state.theme === 'dark' ? 'tw:bg-blue-800 tw:text-blue-200' : 'tw:bg-blue-100 tw:text-blue-700'">
                  {{ filterCount }}
                </span>
                <OIcon
                  :name="showFilters ? 'expand-more' : 'chevron-right'"
                  size="14px"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                />
                <!-- Review your SQL query hint -->
                <span v-if="generatedSqlQuery && !showFilters"
                      class="tw:text-xs tw:italic tw:ml-1 sql-query-hint"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'">
                  view the alert query
                  <q-tooltip
                    anchor="bottom middle"
                    self="top middle"
                    :delay="200"
                    max-width="500px"
                    class="sql-preview-tooltip"
                  >
                    <pre class="hljs tw:text-xs tw:m-0 tw:whitespace-pre-wrap tw:font-mono tw:p-2 tw:rounded" v-html="highlightedSqlQuery" />
                  </q-tooltip>
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
                @add-condition="updateGroup"
                @add-group="updateGroup"
                @remove-group="removeConditionGroup"
                @input:update="onInputUpdate"
              />
            </div>
          </div>

        </q-form>
      </template>

      <!-- SQL/PromQL Inline Editor Mode -->
      <template v-else>
        <div class="tw:w-full tw:flex tw:flex-col tw:gap-2 tw:overflow-hidden">

          <!-- Editor area — position:relative shell owns the size; inner absolute never leaks -->
          <div style="position: relative; height: 320px;">
            <div style="position: absolute; inset: 0; display: flex; overflow: hidden;">

              <!-- SQL/PromQL pane — with its own header -->
              <div style="display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden;"
                :style="{ width: showVrl && localTab === 'sql' ? '50%' : '100%' }">
                <div class="inline-editor-header tw:flex tw:items-center tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'inline-editor-header--dark' : 'inline-editor-header--light'">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <div class="pane-accent-bar pane-accent-bar--primary" />
                    <span class="inline-editor-title">{{ localTab === 'sql' ? 'SQL Editor' : 'PromQL Editor' }}</span>
                  </div>
                  <!-- fx toggle shown here only when VRL is not yet enabled -->
                  <q-toggle
                    v-if="localTab === 'sql' && !showVrl"
                    v-model="showVrl"
                    :icon="'img:' + getImageURL('images/common/function.svg')"
                    size="xs"
                    class="o2-toggle-button-xs"
                    :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
                  >
                    <q-tooltip class="tw:text-[12px]" :delay="300">Show VRL editor</q-tooltip>
                  </q-toggle>
                </div>
                <div style="position: relative; flex: 1; min-height: 0;">
                  <div style="position: absolute; inset: 0;">
                    <UnifiedQueryEditor
                      ref="inlineQueryEditorRef"
                      data-test-prefix="alert-inline-sql"
                      :languages="localTab === 'promql' ? ['promql'] : ['sql']"
                      :default-language="localTab"
                      :query="localTab === 'sql' ? localSqlQuery : localPromqlQuery"
                      editor-height="100%"
                      :disable-ai="!streamName"
                      :keywords="autoCompleteKeywords"
                      :suggestions="autoCompleteSuggestions"
                      :class="(localTab === 'sql' ? localSqlQuery : localPromqlQuery) === '' && queryEditorPlaceholderFlag ? 'empty-query' : ''"
                      @focus="queryEditorPlaceholderFlag = false"
                      @blur="onBlurInlineSqlEditor"
                      @update:query="handleInlineQueryUpdate"
                    />
                  </div>
                </div>
              </div>

              <!-- VRL pane — with its own header, side-by-side with SQL pane -->
              <div v-if="showVrl && localTab === 'sql'"
                style="display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; width: 50%;"
                :style="{ borderLeft: store.state.theme === 'dark' ? '1px solid #2d3748' : '1px solid #e5e7eb' }">
                <div class="inline-editor-header tw:flex tw:items-center tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'inline-editor-header--dark' : 'inline-editor-header--light'">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <div class="pane-accent-bar pane-accent-bar--secondary" />
                    <span class="inline-editor-title">VRL Editor</span>
                  </div>
                  <div class="tw:flex tw:items-center tw:gap-1">
                    <q-select
                      :model-value="null"
                      :options="functionsList"
                      option-label="name"
                      option-value="name"
                      borderless dense use-input hide-selected fill-input
                      input-debounce="0"
                      behavior="menu"
                      clearable
                      class="mini-select alert-v3-select"
                      style="width: 130px;"
                      :placeholder="t('alerts.placeholders.savedFunctions')"
                      @update:model-value="(fn) => fn && (vrlFunctionContent = fn.function || fn.body || '')"
                    >
                      <template #no-option>
                        <q-item><q-item-section>{{ t('alerts.queryConfig.noFunctions') }}</q-item-section></q-item>
                      </template>
                    </q-select>
                    <q-toggle
                      v-model="showVrl"
                      :icon="'img:' + getImageURL('images/common/function.svg')"
                      size="xs"
                      class="o2-toggle-button-xs"
                      :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
                    >
                      <q-tooltip class="tw:text-[12px]" :delay="300">Hide VRL editor</q-tooltip>
                    </q-toggle>
                  </div>
                </div>
                <div style="position: relative; flex: 1; min-height: 0;">
                  <div style="position: absolute; inset: 0;">
                    <UnifiedQueryEditor
                      data-test-prefix="alert-inline-vrl"
                      :languages="['vrl']"
                      default-language="vrl"
                      :query="vrlFunctionContent"
                      editor-height="100%"
                      :disable-ai="false"
                      :hide-nl-toggle="false"
                      :class="vrlFunctionContent === '' && vrlEditorPlaceholderFlag ? 'empty-function' : ''"
                      @focus="vrlEditorPlaceholderFlag = false"
                      @blur="onBlurInlineVrlEditor"
                      @update:query="(v) => { vrlFunctionContent = v; handleVrlFunctionUpdate(v); }"
                    />
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Status bar — outside overflow:hidden so borders render correctly -->
          <div
            v-if="localTab !== 'promql'"
            class="inline-sql-status-bar"
            :class="[inlineStatusState, store.state.theme === 'dark' ? 'sql-status-bar--dark' : 'sql-status-bar--light']"
          >
            <div class="sql-status-bar__inner">
              <template v-if="inlineStatusState === 'sql-status-bar--error'">
                <OIcon name="error-outline" size="xs" style="flex-shrink:0;" />
                <span class="sql-status-bar__msg">{{ sqlQueryErrorMsg }}</span>
              </template>
              <template v-else-if="inlineStatusState === 'sql-status-bar--hint'">
                <OIcon name="edit" size="11px" style="flex-shrink:0;opacity:0.6;" />
                <span>{{ t('alerts.queryConfig.writeQueryHint') }}</span>
              </template>
              <template v-else-if="inlineStatusState === 'sql-status-bar--idle'">
                <OIcon name="check-circle-outline" size="xs" style="flex-shrink:0;opacity:0.7;" />
                <span>{{ t('alerts.queryConfig.sqlEditorHint') }}</span>
              </template>
            </div>
            <q-tooltip
              v-if="inlineStatusState === 'sql-status-bar--error'"
              anchor="top middle" self="bottom middle" max-width="520px"
              style="font-size:11px;white-space:pre-wrap;word-break:break-word;"
            >{{ sqlQueryErrorMsg }}</q-tooltip>
          </div>

          <!-- SQL/PromQL condition rows (scheduled only): Check every + Alert if in one block -->
          <div v-if="isRealTime === 'false'" class="alert-condition-rows tw:mt-2 tw:px-1">

            <!-- Check every -->
            <div class="alert-condition-row tw:!items-start">
              <span class="condition-label sql-promql-label" style="line-height: 28px;">
                Check every *
                <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                  How often to check this alert condition
                </q-tooltip>
              </span>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <template v-if="frequencyMode !== 'cron'">
                    <q-input
                      v-model="checkEveryFrequency"
                      type="number"
                      dense borderless hide-bottom-space
                      no-error-icon
                      class="alert-v3-input"
                      style="min-width: 100px; max-width: 100px;"
                      min="1"
                      :rules="[(val: any) => !!val || 'Required']"
                      @update:model-value="onCheckEveryChange"
                      @blur="restoreDefaultFrequency"
                    />
                  </template>
                  <template v-else>
                    <q-input
                      v-model="cronExpression"
                      dense borderless hide-bottom-space
                      class="alert-v3-input"
                      placeholder="0 */10 * * * *"
                      style="min-width: 100px; max-width: 100px;"
                      @update:model-value="onCronExpressionChange"
                    />
                  </template>
                  <q-select
                    :model-value="frequencyMode"
                    :options="frequencyUnitOptions"
                    dense borderless hide-bottom-space
                    emit-value map-options
                    class="alert-v3-select frequency-unit-select"
                    style="min-width: 80px; max-width: 100px;"
                    @update:model-value="onFrequencyUnitChange"
                  />
                  <template v-if="frequencyMode === 'cron'">
                    <q-select
                      v-model="cronTimezone"
                      :options="filteredTimezones"
                      dense borderless hide-bottom-space
                      use-input emit-value fill-input hide-selected
                      :input-debounce="0"
                      class="alert-v3-select"
                      placeholder="timezone"
                      :display-value="cronTimezone || 'timezone'"
                      style="min-width: 150px; max-width: 150px;"
                      @filter="timezoneFilterFn"
                      @update:model-value="onCronTimezoneChange"
                    >
                      <q-tooltip v-if="cronTimezone" :delay="300" anchor="bottom middle" self="top middle">{{ cronTimezone }}</q-tooltip>
                    </q-select>
                  </template>
                </div>
                <div v-if="frequencyMode === 'cron' && cronDescription && !cronError" class="tw:text-[11px] tw:italic"
                     :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'">
                  {{ cronDescription }}
                </div>
                <div v-if="frequencyMode === 'cron' && cronError" class="tw:text-red-500 tw:text-[11px]">
                  {{ cronError }}
                </div>
              </div>
            </div>

            <!-- SQL: Alert if No. of events -->
            <div v-if="localTab === 'sql'" class="alert-condition-row">
              <span class="condition-label sql-promql-label">Alert if No. of events *</span>
              <div class="tw:flex tw:items-center tw:gap-2">
                <q-select
                  v-model="triggerOperator"
                  :options="numericOperators"
                  dense borderless hide-bottom-space
                  class="alert-v3-select"
                  style="min-width: 70px; max-width: 120px;"
                  @update:model-value="onTriggerOperatorChange"
                />
                <q-input
                  v-model="triggerThreshold"
                  type="number"
                  dense borderless hide-bottom-space
                  class="alert-v3-input"
                  style="min-width: 60px; max-width: 80px;"
                  min="1"
                  @update:model-value="onTriggerThresholdChange"
                  @blur="restoreDefaultThreshold"
                />
              </div>
            </div>

            <!-- PromQL: Alert if the value is + Having series -->
            <template v-if="localTab === 'promql' && promqlCondition">
              <div class="alert-condition-row">
                <span class="condition-label sql-promql-label">Alert if the value is *
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Alert when the PromQL expression evaluates to this condition for a time series. Example: &gt;= 100 triggers when the result is 100 or more.
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:items-center tw:gap-2">
                  <q-select
                    v-model="promqlCondition.operator"
                    :options="numericOperators"
                    dense borderless hide-bottom-space
                    no-error-icon
                    class="alert-v3-select"
                    data-test="alert-threshold-operator-select"
                    style="min-width: 70px; max-width: 120px;"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    @update:model-value="emitPromqlConditionUpdate"
                  />
                  <q-input
                    v-model.number="promqlCondition.value"
                    type="number"
                    dense borderless hide-bottom-space
                    no-error-icon
                    class="alert-v3-input"
                    data-test="alert-threshold-value-input"
                    style="min-width: 60px; max-width: 120px;"
                    debounce="300"
                    :rules="[(val: any) => (val !== undefined && val !== null && val !== '') || 'Field is required!']"
                    @update:model-value="emitPromqlConditionUpdate"
                  />
                </div>
              </div>
              <div class="alert-condition-row">
                <span class="condition-label sql-promql-label">Having series *
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Minimum number of time series that must satisfy the condition above to trigger the alert.
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:items-center tw:gap-2">
                  <q-select
                    v-model="triggerOperator"
                    :options="numericOperators"
                    dense borderless hide-bottom-space
                    class="alert-v3-select"
                    style="min-width: 70px; max-width: 120px;"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <q-input
                    v-model="triggerThreshold"
                    type="number"
                    dense borderless hide-bottom-space
                    class="alert-v3-input"
                    style="min-width: 60px; max-width: 80px;"
                    min="1"
                    @update:model-value="onTriggerThresholdChange"
                    @blur="restoreDefaultThreshold"
                  />
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
      :tab="localTab"
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
      title="Clear Multi-Windows?"
      :message="`Multi-windows are configured. To enable ${pendingTab === 'custom' ? 'Custom' : 'PromQL'} mode, we need to clear them. Do you want to proceed?`"
      @confirm="handleConfirmClearMultiWindows"
      @cancel="handleCancelClearMultiWindows"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType, defineAsyncComponent, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { b64EncodeUnicode, getUUID, convertMinutesToCron, getCronIntervalDifferenceInSeconds, isAboveMinRefreshInterval, describeCron, getImageURL } from "@/utils/zincutils";
import hljs from "highlight.js/lib/core";
import sql from "highlight.js/lib/languages/sql";

hljs.registerLanguage("sql", sql);

import useSqlSuggestions from "@/composables/useSuggestions";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import CustomConfirmDialog from "@/components/alerts/CustomConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue")
);
const UnifiedQueryEditor = defineAsyncComponent(
  () => import("@/components/QueryEditor.vue")
);

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    FilterGroup,
    QueryEditor,
    QueryEditorDialog,
    CustomConfirmDialog,
    UnifiedQueryEditor,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    OIcon,
  },
  props: {
    tab: {
      type: String,
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
  emits: ["update:tab", "update-group", "remove-group", "input:update", "update:sqlQuery", "update:promqlQuery", "update:vrlFunction", "validate-sql", "clear-multi-windows", "editor-closed", "editor-state-changed", "update:isAggregationEnabled", "update:aggregation", "update:promqlCondition", "update:triggerCondition"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();

    const localTab = ref(props.tab);
    const columnSelectError = ref(false);
    const viewSqlEditor = ref(false);
    const customConditionsForm = ref(null);
    const showMultiWindowDialog = ref(false);
    const pendingTab = ref<string | null>(null);

    // Field refs for focus manager
    const customPreviewRef = ref(null);
    const sqlPromqlPreviewRef = ref(null);

    // Local query values
    const localSqlQuery = ref(props.sqlQuery);
    const localPromqlQuery = ref(props.promqlQuery);
    const vrlFunctionContent = ref(props.vrlFunction);

    // Aggregation state
    const localIsAggregationEnabled = ref(props.isAggregationEnabled);

    // Expandable section toggles — auto-expand filters if editing an alert with existing conditions
    const hasExistingFilters = props.inputData.conditions?.conditions?.some(
      (c: any) => c.filterType === 'condition' && c.column && c.column.trim() !== ''
    );
    const showFilters = ref(true);
    const showVrl = ref(!!(props.vrlFunction?.trim()));
    const filtersSectionRef = ref<HTMLElement | null>(null);
    const inlineQueryEditorRef = ref<any>(null);

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
            name: typeof c === 'string' ? c : (c.value ?? c.label ?? c),
            type: c.type ?? 'Utf8',
          }));
          updateFieldKeywords(fields);
        }
      },
      { immediate: true, deep: true }
    );

    // Called on every keystroke in the inline SQL/PromQL editor — updates
    // the query and feeds autocomplete context (same pattern as QueryEditorDialog)
    const handleInlineQueryUpdate = (newQuery: string) => {
      if (localTab.value === 'sql') {
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
      if (props.sqlQueryErrorMsg?.trim()) return 'sql-status-bar--error';
      const query = localTab.value === 'sql' ? localSqlQuery.value : localPromqlQuery.value;
      if (!query?.trim()) return 'sql-status-bar--hint';
      return 'sql-status-bar--idle';
    });

    // Placeholder flags for inline editors (show image when empty + not focused)
    const queryEditorPlaceholderFlag = ref(true);
    const vrlEditorPlaceholderFlag = ref(true);

    const onBlurInlineSqlEditor = () => {
      queryEditorPlaceholderFlag.value = localTab.value === 'sql'
        ? localSqlQuery.value === ''
        : localPromqlQuery.value === '';
      // Validate SQL on blur (same chain as QueryEditorDialog)
      if (localTab.value === 'sql') {
        emit("validate-sql");
      }
    };
    const onBlurInlineVrlEditor = () => {
      vrlEditorPlaceholderFlag.value = vrlFunctionContent.value === '';
    };

    const toggleFilters = () => {
      showFilters.value = !showFilters.value;
    };

    // Stream-type-driven: logs/traces are event-based, metrics are aggregation-based
    const isEventBased = computed(() => {
      return props.streamType !== 'metrics';
    });

    // Set aggregation state based on stream type on mount
    if (!isEventBased.value) {
      if (!props.isAggregationEnabled) {
        // total_events selected — no aggregation, same path as logs
        localIsAggregationEnabled.value = false;
      } else {
        // Metrics: aggregation-enabled
        localIsAggregationEnabled.value = true;
        // Initialize aggregation object if missing
        if (!props.inputData.aggregation) {
          props.inputData.aggregation = {
            group_by: [],
            function: "avg",
            having: { column: "", operator: ">=", value: "" },
          };
        }
        // Default column to "value" only if the stream actually has a "value" field
        if (!props.inputData.aggregation?.having?.column) {
          const hasValueField = props.columns.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value');
          if (hasValueField && props.inputData.aggregation?.having) {
            props.inputData.aggregation.having.column = 'value';
          }
        }
      }
    } else {
      // Logs/Traces: event-based, no aggregation
      localIsAggregationEnabled.value = false;
    }

    // Log function options — count (default) and measure functions
    const logFunctionOptions = [
      { label: 'total events', value: 'total_events', tooltip: 'Count the total number of log events matching your filters (COUNT(*))' },
      { label: 'count', value: 'count', tooltip: 'Count non-null values of a specific field (COUNT(field))' },
      { label: 'avg', value: 'avg', tooltip: 'Average value of a numeric field' },
      { label: 'min', value: 'min', tooltip: 'Minimum value of a numeric field' },
      { label: 'max', value: 'max', tooltip: 'Maximum value of a numeric field' },
      { label: 'sum', value: 'sum', tooltip: 'Sum of values of a numeric field' },
      { label: 'median', value: 'median', tooltip: 'Median value of a numeric field' },
      { label: 'p50', value: 'p50', tooltip: '50th percentile of a numeric field' },
      { label: 'p75', value: 'p75', tooltip: '75th percentile of a numeric field' },
      { label: 'p90', value: 'p90', tooltip: '90th percentile of a numeric field' },
      { label: 'p95', value: 'p95', tooltip: '95th percentile of a numeric field' },
      { label: 'p99', value: 'p99', tooltip: '99th percentile of a numeric field' },
    ];

    // Numeric-only operators (no Contains/NotContains for thresholds)
    const numericOperators = ["=", "!=", ">=", ">", "<=", "<"];

    // Selected function — defaults to 'total_events' when no aggregation, 'avg' otherwise
    const selectedFunction = ref(
      isEventBased.value
        ? (props.isAggregationEnabled && props.inputData.aggregation?.function
            ? props.inputData.aggregation.function
            : 'total_events')
        : (!props.isAggregationEnabled
            ? 'total_events'
            : (props.inputData.aggregation?.function || 'avg'))
    );

    // Log-specific: measure column and group-by
    const logMeasureColumn = ref(
      props.inputData.aggregation?.having?.column || ''
    );
    const logGroupBy = ref<string[]>(
      props.inputData.aggregation?.group_by?.filter((g: string) => g)?.length
        ? [...props.inputData.aggregation.group_by.filter((g: string) => g)]
        : []
    );

    // Condition operator and value
    // Logs/Traces: maps to trigger_condition (event count threshold)
    // Metrics: maps to aggregation.having (aggregated value threshold)
    const conditionOperator = ref(
      isEventBased.value
        ? (props.triggerCondition?.operator || '>=')
        : (props.inputData.aggregation?.having?.operator || '>=')
    );
    const conditionValue = ref(
      isEventBased.value
        ? (props.triggerCondition?.threshold || '')
        : (props.inputData.aggregation?.having?.value || '')
    );

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
        if (props.isAggregationEnabled && props.inputData.aggregation?.function && oldEventBased !== false) {
          selectedFunction.value = props.inputData.aggregation.function;
          localIsAggregationEnabled.value = true;
        } else {
          selectedFunction.value = 'total_events';
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
          selectedFunction.value = 'total_events';
          localIsAggregationEnabled.value = false;
        } else {
          // New alert switching to metrics — default to avg + init aggregation
          selectedFunction.value = 'avg';
          localIsAggregationEnabled.value = true;
          emit("update:isAggregationEnabled", true);
          if (!props.inputData.aggregation) {
            props.inputData.aggregation = {
              group_by: [],
              function: "avg",
              having: { column: "", operator: ">=", value: "" },
            };
          } else {
            props.inputData.aggregation.function = 'avg';
            if (!props.inputData.aggregation.having?.column) {
              const hasValueField = props.columns.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value');
              if (hasValueField) {
                props.inputData.aggregation.having.column = 'value';
              }
            }
          }
          emitAggregationUpdate();
        }
      }
    });

    // Trigger threshold — only meaningful when group-by fields exist.
    // If loading an alert with no group-by, reset to defaults so stale values don't show.
    const hasInitialGroupBy =
      (props.inputData.aggregation?.group_by || []).filter((g: string) => g?.trim()).length > 0;
    const triggerOperator = ref(hasInitialGroupBy ? (props.triggerCondition?.operator || '>=') : '>=');
    const triggerThreshold = ref(hasInitialGroupBy ? (props.triggerCondition?.threshold || 1) : 1);
    // Sync reset to parent so saving also persists the corrected value
    if (!hasInitialGroupBy && props.triggerCondition) {
      props.triggerCondition.threshold = 1;
      props.triggerCondition.operator = '>=';
      emit("update:triggerCondition", { ...props.triggerCondition });
    }

    // Whether log/trace group-by has at least one non-empty field
    const hasLogGroupByFields = computed(
      () => logGroupBy.value.filter((f: string) => f?.trim()).length > 0
    );

    // Whether metric group-by has at least one non-empty field
    const hasMetricGroupByFields = computed(
      () => (props.inputData.aggregation?.group_by || []).filter((f: string) => f?.trim()).length > 0
    );

    const onTriggerOperatorChange = (value: string) => {
      triggerOperator.value = value;
      if (props.triggerCondition) {
        props.triggerCondition.operator = value;
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    const onTriggerThresholdChange = (value: any) => {
      isUserTriggerChange.value = true;
      triggerThreshold.value = value === '' || value === null || value === undefined ? null : Number(value);
      if (props.triggerCondition) {
        props.triggerCondition.threshold = triggerThreshold.value;
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    const restoreDefaultThreshold = () => {
      if (triggerThreshold.value === null || triggerThreshold.value === '' || triggerThreshold.value === undefined || Number.isNaN(Number(triggerThreshold.value))) {
        triggerThreshold.value = 3;
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 3;
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
      }
    };

    // Check every — evaluation frequency
    const checkEveryFrequency = ref(props.triggerCondition?.frequency || 10);
    // Determine initial unit: if frequency_type is 'cron' use cron, else check if frequency >= 60 for hours
    const initFrequencyUnit = (): 'minutes' | 'hours' | 'cron' => {
      if (props.triggerCondition?.frequency_type === 'cron') return 'cron';
      const freq = props.triggerCondition?.frequency || 10;
      // If frequency is >= 60 and divisible by 60, show as hours
      if (freq >= 60 && freq % 60 === 0) return 'hours';
      return 'minutes';
    };
    const frequencyMode = ref<'minutes' | 'hours' | 'cron'>(initFrequencyUnit());
    const isUserTriggerChange = ref(false);
    const cronExpression = ref(props.triggerCondition?.cron || '');
    const cronTimezone = ref(props.triggerCondition?.timezone || '');
    const cronError = ref('');
    const cronDescription = computed(() => describeCron(cronExpression.value, cronTimezone.value));
    const filteredTimezones = ref<string[]>([]);

    // Initialize timezone
    const initTimezones = () => {
      try {
        if (!cronTimezone.value) {
          cronTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        // @ts-ignore
        if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
          // @ts-ignore
          filteredTimezones.value = Intl.supportedValuesOf("timeZone");
        } else {
          filteredTimezones.value = [cronTimezone.value];
        }
      } catch {
        cronTimezone.value = cronTimezone.value || 'UTC';
        filteredTimezones.value = ['UTC'];
      }
    };
    initTimezones();

    const timezoneFilterFn = (val: string, update: any) => {
      update(() => {
        try {
          // @ts-ignore
          const all: string[] = (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function')
            // @ts-ignore
            ? Intl.supportedValuesOf("timeZone") : [cronTimezone.value];
          if (val === '') {
            filteredTimezones.value = all;
          } else {
            const needle = val.toLowerCase();
            filteredTimezones.value = all.filter((tz: string) => tz.toLowerCase().includes(needle));
          }
        } catch {
          // keep current list
        }
      });
    };

    const validateCron = () => {
      cronError.value = '';
      if (frequencyMode.value !== 'cron') return;
      if (!cronExpression.value || !cronTimezone.value) {
        cronError.value = 'Cron expression and timezone are required';
        return;
      }
      try {
        const intervalInSecs = getCronIntervalDifferenceInSeconds(cronExpression.value);
        if (typeof intervalInSecs === 'number' && !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)) {
          const minInterval = Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
          cronError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
        }
      } catch {
        cronError.value = 'Invalid cron expression';
      }
    };

    const frequencyUnitOptions = [
      { label: 'Minutes', value: 'minutes' },
      { label: 'Hours', value: 'hours' },
      { label: 'Cron', value: 'cron' },
    ];

    const onFrequencyUnitChange = (unit: string) => {
      const prevMode = frequencyMode.value;
      isUserTriggerChange.value = true;
      frequencyMode.value = unit as 'minutes' | 'hours' | 'cron';

      if (!props.triggerCondition) return;

      if (unit === 'cron') {
        props.triggerCondition.frequency_type = 'cron';
        // Auto-convert current frequency to cron if no expression yet
        if (!cronExpression.value) {
          let mins = Number(checkEveryFrequency.value);
          if (prevMode === 'hours') mins = mins * 60;
          if (mins > 0) {
            cronExpression.value = convertMinutesToCron(mins);
            props.triggerCondition.cron = cronExpression.value;
          }
          if (!cronTimezone.value) {
            cronTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
          }
          props.triggerCondition.timezone = cronTimezone.value;
        }
        validateCron();
      } else {
        props.triggerCondition.frequency_type = 'minutes';
        // Convert between minutes and hours
        if (unit === 'hours' && prevMode === 'minutes') {
          // Converting minutes to hours: round up
          const hrs = Math.max(1, Math.round(Number(checkEveryFrequency.value) / 60));
          checkEveryFrequency.value = hrs;
          props.triggerCondition.frequency = hrs * 60;
        } else if (unit === 'minutes' && prevMode === 'hours') {
          // Converting hours to minutes
          const mins = Number(checkEveryFrequency.value) * 60;
          checkEveryFrequency.value = mins;
          props.triggerCondition.frequency = mins;
        } else if (unit === 'minutes' && prevMode === 'cron') {
          // Coming back from cron, restore sensible default
          checkEveryFrequency.value = props.triggerCondition.frequency || 10;
        } else if (unit === 'hours' && prevMode === 'cron') {
          const mins = props.triggerCondition.frequency || 60;
          checkEveryFrequency.value = Math.max(1, Math.round(mins / 60));
          props.triggerCondition.frequency = checkEveryFrequency.value * 60;
        }
      }
      emit("update:triggerCondition", { ...props.triggerCondition });
    };

    const onCronExpressionChange = (value: any) => {
      isUserTriggerChange.value = true;
      cronExpression.value = value;
      if (props.triggerCondition) {
        props.triggerCondition.cron = value;
        validateCron();
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    const onCronTimezoneChange = (value: any) => {
      isUserTriggerChange.value = true;
      cronTimezone.value = value;
      if (props.triggerCondition) {
        props.triggerCondition.timezone = value;
        validateCron();
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    const onCheckEveryChange = (value: any) => {
      isUserTriggerChange.value = true;
      const parsed = value === '' || value === null || value === undefined ? null : Number(value);
      checkEveryFrequency.value = parsed;
      if (props.triggerCondition) {
        // Store as minutes internally (hours mode: multiply by 60)
        const mins = parsed != null ? (frequencyMode.value === 'hours' ? parsed * 60 : parsed) : null;
        props.triggerCondition.frequency = mins;
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    const restoreDefaultFrequency = () => {
      if (checkEveryFrequency.value === null || checkEveryFrequency.value === '' || checkEveryFrequency.value === undefined || Number.isNaN(Number(checkEveryFrequency.value))) {
        const defaultVal = frequencyMode.value === 'hours' ? 1 : 10;
        checkEveryFrequency.value = defaultVal;
        if (props.triggerCondition) {
          props.triggerCondition.frequency = frequencyMode.value === 'hours' ? 60 : 10;
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
      }
    };

    // Count of active filter conditions
    const filterCount = computed(() => {
      const conditions = props.inputData.conditions?.conditions;
      if (!conditions || !Array.isArray(conditions)) return 0;
      return conditions.filter((c: any) => c.filterType === 'condition' && c.column).length;
    });

    // Ensure at least one empty filter condition exists on mount (filters are always visible now)
    // Empty condition is now provided by default form data in useAlertForm.ts

    // Aggregation functions (kept for legacy references)
    const aggFunctions = ["count", "min", "max", "avg", "sum", "median", "p50", "p75", "p90", "p95", "p99"];

    // Trigger operators
    const triggerOperators = ["=", "!=", ">=", ">", "<=", "<", "Contains", "NotContains"];

    // Filtered fields for group by
    const filteredFields = ref([...props.columns]);
    const filterFields = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredFields.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredFields.value = props.columns.filter((v: any) => {
            const label = typeof v === "string" ? v : v.label || v.value || "";
            return label.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    // Filtered numeric columns for aggregation
    const filteredNumericColumns = ref([...props.columns]);
    const filterNumericColumns = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredNumericColumns.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredNumericColumns.value = props.columns.filter((v: any) => {
            const label = typeof v === "string" ? v : v.label || v.value || "";
            return label.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    // Helper to get numeric columns based on selected function
    const getNumericColumns = (cols: any[]) => {
      if (selectedFunction.value === 'count' || selectedFunction.value === 'total_events') {
        return [...cols];
      }
      return cols.filter((column: any) => {
        if (typeof column === "string") return false;
        if (!column.type) return false;
        return !/(?:utf8|string)/i.test(column.type);
      });
    };

    // Filtered columns for log measure column (unique count uses all fields, measure uses numeric)
    const filteredLogMeasureColumns = ref(getNumericColumns(props.columns));
    const filterLogMeasureColumns = (val: string, update: any) => {
      update(() => {
        const numericCols = getNumericColumns(props.columns);
        if (val === "") {
          filteredLogMeasureColumns.value = numericCols;
        } else {
          const needle = val.toLowerCase();
          filteredLogMeasureColumns.value = numericCols.filter((v: any) => {
            const label = typeof v === "string" ? v : v.label || v.value || "";
            return label.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    // Get saved VRL functions from store
    const functionsList = computed(() => store.state.organizationData.functions || []);


    // Compute tab options based on stream type and alert type
    const tabOptions = computed(() => {
      // For real-time alerts, only show Builder (no tabs needed)
      if (props.isRealTime === "true") {
        return [
          {
            label: t('alerts.queryBuilder'),
            value: "custom",
          },
        ];
      }

      // For metrics, show all three tabs: Builder, SQL, PromQL
      if (props.streamType === "metrics") {
        return [
          {
            label: t('alerts.queryBuilder'),
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
          label: "Builder",
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

    const updateTab = (tab: string) => {
      const hasComparisonWindow = props.multiTimeRange?.length > 0;

      // Check if switching to custom or promql while multi-windows are present
      if ((tab === 'custom' || tab === 'promql') && hasComparisonWindow) {
        // Show confirmation dialog
        pendingTab.value = tab;
        showMultiWindowDialog.value = true;
        return;
      }

      // When switching to custom mode, check if there's only one empty condition and remove it
      // This ensures generate_sql API is called
      if (tab === 'custom' && props.inputData.conditions) {
        removeSingleEmptyCondition(props.inputData.conditions);
      }

      // No multi-windows, proceed with tab change
      localTab.value = tab;
      emit("update:tab", tab);
    };

    // Helper function to remove a single empty condition if that's the only condition present
    const removeSingleEmptyCondition = (conditionsObj: any) => {
      if (!conditionsObj || !conditionsObj.conditions || !Array.isArray(conditionsObj.conditions)) {
        return;
      }

      // Only proceed if there's exactly one condition at the top level
      if (conditionsObj.conditions.length === 1) {
        const singleItem = conditionsObj.conditions[0];

        // Check if it's a condition (not a group) with empty column AND empty value
        if (singleItem.filterType === 'condition') {
          const hasColumn = singleItem.column && singleItem.column.trim() !== '';
          const hasValue = singleItem.value !== undefined && singleItem.value !== '' && singleItem.value !== null;

          // If both column and value are empty, remove this condition
          if (!hasColumn && !hasValue) {
            conditionsObj.conditions = [];
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
      return localTab.value === 'sql' ? props.sqlQuery : props.promqlQuery;
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

    // Emit trigger condition update (for non-aggregation mode)
    const emitTriggerUpdate = () => {
      if (props.triggerCondition) {
        emit("update:triggerCondition", { ...props.triggerCondition });
      }
    };

    // When metric function dropdown changes — handles count vs aggregation modes
    const onMetricFunctionChange = (value: string) => {
      if (value === 'total_events') {
        // total_events (COUNT(*)) — no aggregation, trigger threshold shown inline
        localIsAggregationEnabled.value = false;
        emit("update:isAggregationEnabled", false);
      } else {
        // Measure mode — aggregation, always reset "having groups" to >= 1 on switch
        localIsAggregationEnabled.value = true;
        triggerThreshold.value = 1;
        triggerOperator.value = '>=';
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 1;
          props.triggerCondition.operator = '>=';
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
        emit("update:isAggregationEnabled", true);
        onFunctionChange(value);
      }
    };

    // When function dropdown changes (metrics only — always aggregation)
    const onFunctionChange = (value: string) => {
      localIsAggregationEnabled.value = true;
      emit("update:isAggregationEnabled", true);

      // Initialize aggregation object if needed
      if (!props.inputData.aggregation) {
        props.inputData.aggregation = {
          group_by: [],
          function: value,
          having: {
            column: "",
            operator: conditionOperator.value || ">=",
            value: conditionValue.value || "",
          },
        };
      } else {
        props.inputData.aggregation.function = value;
        props.inputData.aggregation.having.operator = conditionOperator.value;
        props.inputData.aggregation.having.value = conditionValue.value;
      }
      emitAggregationUpdate();
    };

    // When log function mode changes (count / unique_count / avg / etc.)
    const onLogFunctionChange = (value: string) => {
      if (value === 'total_events') {
        // total_events (COUNT(*)) — no aggregation, trigger threshold shown inline
        localIsAggregationEnabled.value = false;
        emit("update:isAggregationEnabled", false);
        logMeasureColumn.value = '';
        // Restore default threshold for count mode
        triggerThreshold.value = 3;
        triggerOperator.value = '>=';
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 3;
          props.triggerCondition.operator = '>=';
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
      } else {
        // Measure mode — uses aggregation, always reset "having groups" to >= 1 on switch
        localIsAggregationEnabled.value = true;
        triggerThreshold.value = 1;
        triggerOperator.value = '>=';
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 1;
          props.triggerCondition.operator = '>=';
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
        emit("update:isAggregationEnabled", true);
        const aggFunction = value;
        if (!props.inputData.aggregation) {
          props.inputData.aggregation = {
            group_by: logGroupBy.value.length ? [...logGroupBy.value] : [],
            function: aggFunction,
            having: {
              column: logMeasureColumn.value || "",
              operator: conditionOperator.value || ">=",
              value: conditionValue.value || "",
            },
          };
        } else {
          props.inputData.aggregation.function = aggFunction;
          props.inputData.aggregation.having.operator = conditionOperator.value;
          props.inputData.aggregation.having.value = conditionValue.value;
          props.inputData.aggregation.having.column = logMeasureColumn.value || "";
          props.inputData.aggregation.group_by = logGroupBy.value.length ? [...logGroupBy.value] : [];
        }
        emitAggregationUpdate();
      }
    };

    // When log measure column changes (for unique count / measure modes)
    const onLogMeasureColumnChange = (value: string) => {
      if (props.inputData.aggregation) {
        props.inputData.aggregation.having.column = value;
        emitAggregationUpdate();
      }
    };

    // Log group-by management
    const addLogGroupByColumn = () => {
      logGroupBy.value.push("");
    };
    const deleteLogGroupByColumn = (index: number) => {
      logGroupBy.value.splice(index, 1);
      onLogGroupByChange();
      // Reset threshold to 1 when last group-by field is removed
      if (logGroupBy.value.filter((f: string) => f?.trim()).length === 0) {
        triggerThreshold.value = 1;
        triggerOperator.value = '>=';
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 1;
          props.triggerCondition.operator = '>=';
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
      }
    };
    const onLogGroupByChange = () => {
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by = [...logGroupBy.value];
        emitAggregationUpdate();
      }
    };

    // When condition operator changes
    const onConditionOperatorChange = (value: string) => {
      if (isEventBased.value && selectedFunction.value === 'total_events') {
        // Logs count mode: maps to trigger_condition
        if (props.triggerCondition) {
          props.triggerCondition.operator = value;
          emitTriggerUpdate();
        }
      } else {
        // Metrics or logs measure/unique count: maps to aggregation.having
        if (props.inputData.aggregation) {
          props.inputData.aggregation.having.operator = value;
          emitAggregationUpdate();
        }
      }
    };

    // When condition value changes
    const onConditionValueChange = (value: any) => {
      const parsed = value === '' || value === null || value === undefined ? null : Number(value);
      if (isEventBased.value && selectedFunction.value === 'total_events') {
        // Logs count mode: maps to trigger_condition
        if (props.triggerCondition) {
          isUserTriggerChange.value = true;
          props.triggerCondition.threshold = parsed;
          emitTriggerUpdate();
        }
      } else {
        // Metrics or logs measure/unique count: maps to aggregation.having
        if (props.inputData.aggregation) {
          props.inputData.aggregation.having.value = parsed;
          emitAggregationUpdate();
        }
      }
    };

    // Legacy toggle kept for compatibility — not used in new UI
    const toggleAggregation = () => {
      emit("update:isAggregationEnabled", localIsAggregationEnabled.value);
    };

    // Add group by column
    const addGroupByColumn = () => {
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by.push("");
        emitAggregationUpdate();
      }
    };

    // Delete group by column
    const deleteGroupByColumn = (index: string | number) => {
      const idx = typeof index === 'string' ? parseInt(index) : index;
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by.splice(idx, 1);
        emitAggregationUpdate();
        // Reset threshold to 1 when last group-by field is removed
        const remaining = (props.inputData.aggregation.group_by || []).filter((f: string) => f?.trim()).length;
        if (remaining === 0) {
          triggerThreshold.value = 1;
          triggerOperator.value = '>=';
          if (props.triggerCondition) {
            props.triggerCondition.threshold = 1;
            props.triggerCondition.operator = '>=';
            emit("update:triggerCondition", { ...props.triggerCondition });
          }
        }
      }
    };

    // Emit aggregation update
    const emitAggregationUpdate = () => {
      emit("update:aggregation", props.inputData.aggregation);
    };

    // Emit PromQL condition update
    const emitPromqlConditionUpdate = () => {
      emit("update:promqlCondition", props.promqlCondition);
    };

    // Watch for SQL editor dialog state changes
    // Sync local state when parent props update (e.g. after loading an existing alert async)
    watch(
      () => props.tab,
      (newTab) => {
        if (newTab && newTab !== localTab.value) {
          localTab.value = newTab;
        }
      }
    );
    watch(
      () => props.sqlQuery,
      (newVal) => {
        if (newVal !== undefined && newVal !== localSqlQuery.value) {
          localSqlQuery.value = newVal;
        }
      }
    );
    watch(
      () => props.promqlQuery,
      (newVal) => {
        if (newVal !== undefined && newVal !== localPromqlQuery.value) {
          localPromqlQuery.value = newVal;
        }
      }
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
      }
    );

    watch(viewSqlEditor, (newValue, oldValue) => {
      // Emit state change whenever it changes
      emit("editor-state-changed", newValue);

      // When dialog closes (goes from true to false), emit event to refresh preview
      if (oldValue === true && newValue === false) {
        emit("editor-closed");
      }
    });

    // Sync filtered lists when columns prop changes (async stream load)
    watch(
      () => props.columns,
      (newCols) => {
        filteredFields.value = [...newCols];
        filteredNumericColumns.value = [...newCols];
        filteredLogMeasureColumns.value = getNumericColumns(newCols);

        if (!isEventBased.value && props.inputData.aggregation?.having) {
          const currentCol = props.inputData.aggregation.having.column;
          const colExistsInNewStream = currentCol
            ? newCols.some((c: any) => (typeof c === 'string' ? c : c.value) === currentCol)
            : false;

          if (currentCol && !colExistsInNewStream) {
            // Stream changed — previously selected column is no longer valid, clear it
            // and auto-set to "value" only if the new stream has it
            const hasValue = newCols.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value');
            props.inputData.aggregation.having.column = hasValue ? 'value' : '';
            emitAggregationUpdate();
          } else if (!currentCol) {
            // Column not set yet — auto-set to "value" if new stream has it
            const hasValue = newCols.some((c: any) => (typeof c === 'string' ? c : c.value) === 'value');
            if (hasValue) {
              props.inputData.aggregation.having.column = 'value';
              emitAggregationUpdate();
            }
          }
        }
      }
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
      }
    );

    // Sync from aggregation data when it changes (e.g. loading saved metric alert)
    watch(
      () => props.inputData.aggregation,
      (agg) => {
        if (isEventBased.value) return; // Only for metrics
        if (agg?.having) {
          conditionOperator.value = agg.having.operator || '>=';
          conditionValue.value = agg.having.value || '';
        }
        if (agg?.function) {
          selectedFunction.value = agg.function;
        }
      },
      { deep: true, immediate: false }
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
        const inMeasureMode = selectedFunction.value !== 'total_events';
        const groupByEmpty = isEventBased.value
          ? !hasLogGroupByFields.value
          : !hasMetricGroupByFields.value;
        if (inMeasureMode && groupByEmpty) {
          triggerOperator.value = '>=';
          triggerThreshold.value = 1;
          if (tc.operator !== '>=' || tc.threshold !== 1) {
            tc.operator = '>=';
            tc.threshold = 1;
            emit("update:triggerCondition", { ...tc });
          }
        } else {
          triggerOperator.value = tc.operator ?? '>=';
          triggerThreshold.value = tc.threshold ?? 3;
        }
        const freq = tc.frequency ?? 10;
        if (tc.frequency_type === 'cron') {
          frequencyMode.value = 'cron';
          checkEveryFrequency.value = freq;
        } else if (freq >= 60 && freq % 60 === 0) {
          frequencyMode.value = 'hours';
          checkEveryFrequency.value = freq / 60;
        } else {
          frequencyMode.value = 'minutes';
          checkEveryFrequency.value = freq;
        }
        cronExpression.value = tc.cron || '';
        cronTimezone.value = tc.timezone || '';
      },
      { deep: true, immediate: false }
    );

    // When function switches to measure mode, reset threshold to >= 1 if group-by is empty
    watch(selectedFunction, (value) => {
      filteredLogMeasureColumns.value = getNumericColumns(props.columns);
      if (value === 'total_events') return;
      const groupByEmpty = isEventBased.value
        ? !hasLogGroupByFields.value
        : !hasMetricGroupByFields.value;
      if (groupByEmpty) {
        triggerThreshold.value = 1;
        triggerOperator.value = '>=';
        if (props.triggerCondition) {
          props.triggerCondition.threshold = 1;
          props.triggerCondition.operator = '>=';
          emit("update:triggerCondition", { ...props.triggerCondition });
        }
      }
    });

    // Validation function for Step 2
    const validate = async () => {
      // Custom mode: Check if conditions have empty columns or values
      if (localTab.value === 'custom') {
        // Aggregation column required when a measure function is selected
        if (selectedFunction.value !== 'total_events') {
          const col = isEventBased.value
            ? logMeasureColumn.value
            : props.inputData?.aggregation?.having?.column;
          if (!col || col.trim() === '') {
            columnSelectError.value = true;
            q.notify({ type: 'negative', message: 'Column is required when using an aggregate function.', timeout: 2000 });
            return false;
          }
        }
        columnSelectError.value = false;
        return await validateCustomMode();
      }

      // SQL mode
      if (localTab.value === 'sql') {
        const sqlQuery = props.sqlQuery;
        if (!sqlQuery || sqlQuery.trim() === '') {
          q.notify({ type: 'negative', message: 'SQL query cannot be empty.', timeout: 2000 });
          await nextTick();
          inlineQueryEditorRef.value?.focus?.();
          return false;
        }
        if (props.sqlQueryErrorMsg && props.sqlQueryErrorMsg.trim() !== '') {
          q.notify({ type: 'negative', message: 'Please fix the SQL error before saving.', timeout: 2000 });
          await nextTick();
          inlineQueryEditorRef.value?.focus?.();
          return false;
        }
        return true;
      }

      // PromQL mode
      if (localTab.value === 'promql') {
        const promqlQuery = localPromqlQuery.value;
        if (!promqlQuery || promqlQuery.trim() === '') {
          q.notify({ type: 'negative', message: 'PromQL query cannot be empty.', timeout: 2000 });
          await nextTick();
          inlineQueryEditorRef.value?.focus?.();
          return false;
        }
        return true;
      }

      return true;
    };

    // Validate custom mode conditions
    const validateCustomMode = async () => {
      const conditions = props.inputData.conditions;

      // If no conditions added at all, allow navigation
      if (!conditions || !conditions.conditions || conditions.conditions.length === 0) {
        return true;
      }

      // Use Quasar form validation
      if (customConditionsForm.value && typeof (customConditionsForm.value as any).validate === 'function') {
        const validationResult = (customConditionsForm.value as any).validate();

        // Await if async
        const isValid = validationResult instanceof Promise ? await validationResult : validationResult;

        // Focus first error field if validation failed
        if (!isValid) {
          await nextTick();
          const firstErrorField = document.querySelector('.q-field--error input, .q-field--error textarea, .q-field--error .q-select') as HTMLElement;
          if (firstErrorField) {
            firstErrorField.focus();
          }
        }

        return isValid;
      }

      // If form validation is not available, return true as safe fallback
      return true;
    };

    // Validate SQL mode
    const validateSqlMode = () => {
      const sqlQuery = props.sqlQuery;

      // Check if SQL query is empty
      if (!sqlQuery || sqlQuery.trim() === '') {
        return false;
      }

      // Check if there's a backend validation error
      if (props.sqlQueryErrorMsg && props.sqlQueryErrorMsg.trim() !== '') {
        return false;
      }

      return true;
    };

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
      updateSqlQuery,
      updatePromqlQuery,
      handleVrlFunctionUpdate,
      handleValidateSql,
      functionsList,
      validate,
      customConditionsForm,
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
      filteredFields,
      filterFields,
      filteredNumericColumns,
      filterNumericColumns,
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
      filteredTimezones,
      timezoneFilterFn,
      onFrequencyUnitChange,
      frequencyUnitOptions,
      onCronExpressionChange,
      onCronTimezoneChange,
      logMeasureColumn,
      columnSelectError,
      filteredLogMeasureColumns,
      filterLogMeasureColumns,
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
      onBlurInlineSqlEditor,
      onBlurInlineVrlEditor,
      inlineStatusState,
      inlineQueryEditorRef,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      handleInlineQueryUpdate,
    };
  },
});
</script>

<style scoped lang="scss">
.step-query-config {
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0 auto;
  overflow: auto;

  .step-content {
    border-radius: 8px;
    min-height: 100%;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
    .section-header {
      border-bottom: 1px solid #343434;
    }
    .section-header-title {
      color: #e0e0e0;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
    .section-header {
      border-bottom: 1px solid #eeeeee;
    }
    .section-header-title {
      color: #374151;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 10px 12px;
}

.section-header-accent {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}

.section-header-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.preview-box {
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .preview-header {
    border-bottom: 1px solid;
    flex-shrink: 0;
  }

  .preview-title {
    font-weight: 600;
    font-size: 14px;
  }

  .preview-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .preview-code {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 12px;
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  &.dark-mode-preview {
    background-color: #181a1b;
    border: 1px solid #343434;

    .preview-header {
      background-color: #212121;
      border-bottom-color: #343434;
    }

    .preview-title {
      color: #ffffff;
    }

    .preview-code {
      color: #e0e0e0;
    }
  }

  &.light-mode-preview {
    background-color: #f5f5f5;
    border: 1px solid #e6e6e6;

    .preview-header {
      background-color: #ffffff;
      border-bottom-color: #e6e6e6;
    }

    .preview-title {
      color: #3d3d3d;
    }

    .preview-code {
      color: #3d3d3d;
    }
  }
}

.inline-editor-pane {
  border-radius: 8px;
  overflow: hidden;

  &--light { border: 1px solid #e5e7eb; }
  &--dark  { border: 1px solid #2d3748; }
}

.inline-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  flex-shrink: 0;
  height: 36px;

  &--light {
    background-color: #f3f4f6;
    border-bottom: 1px solid #e5e7eb;
  }
  &--dark {
    background-color: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid #2d3748;
  }
}

.inline-editor-title {
  font-size: 12px;
  font-weight: 600;
}

.inline-sql-status-bar {
  position: relative;
  height: 22px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 500;
  cursor: default;

  .sql-status-bar__inner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    overflow: hidden;
  }

  .sql-status-bar__msg {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  &.sql-status-bar--hint    { background: #f3f4f6; color: #6b7280; }
  &.sql-status-bar--idle    { background: #f3f4f6; color: #6b7280; }
  &.sql-status-bar--error   { background: rgba(239, 68, 68, 0.08); color: #ef4444; cursor: pointer; }

  &.sql-status-bar--light {
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
  }
  &.sql-status-bar--dark {
    border-left: 1px solid #2d3748;
    border-right: 1px solid #2d3748;
    border-bottom: 1px solid #2d3748;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
    &.sql-status-bar--hint,
    &.sql-status-bar--idle { background: rgba(255, 255, 255, 0.04); color: #d1d5db; }
  }
}

.pane-accent-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;

  &--primary   { background: var(--q-primary); }
  &--secondary { background: var(--q-secondary); }
}

.condition-label-hint {
  font-weight: 500;
  opacity: 0.7;
  font-size: 12px;
}

.sql-query-hint {
  cursor: help;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

// Override Quasar tooltip background for SQL preview
:global(.sql-preview-tooltip) {
  background: #1e1e1e !important;
  padding: 0 !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;

  .hljs {
    background: #1e1e1e !important;
    border-radius: 6px;
  }
}

.editor-dialog-card {
  background-color: var(--q-dark-page);
}

.editor-text-title {
  font-weight: 600;
  font-size: 16px;
}

.no-output-before-run-query {
  border-radius: 8px;
}

.dark-mode {
  .no-output-before-run-query {
    background-color: #1a1a1a;
  }
}

.light-mode {
  .no-output-before-run-query {
    background-color: #f9fafb;
  }
}

// Condition rows layout
.alert-condition-rows {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.alert-condition-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.condition-label {
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
  min-width: 90px;
  flex-shrink: 0;
}

.condition-text {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
}

.set-threshold-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px dashed color-mix(in srgb, var(--q-primary) 50%, transparent);
  color: var(--q-primary);
  cursor: pointer;
  user-select: none;
  opacity: 0.65;
  transition: opacity 0.15s ease, background 0.15s ease;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--q-primary) 10%, transparent);
  }
}

.light-mode {
  .condition-label {
    color: rgba(0, 0, 0, 0.8);
  }
  .condition-text {
    color: rgba(0, 0, 0, 0.7);
  }
}

.dark-mode {
  .condition-label {
    color: rgba(255, 255, 255, 0.9);
  }
  .condition-text {
    color: rgba(255, 255, 255, 0.75);
  }
}


.ai-hover-btn {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%) !important;
  transition: background 0.3s ease, box-shadow 0.3s ease;

  &:hover {
    background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%) !important;
    box-shadow: 0 0.25rem 0.75rem 0 rgba(139, 92, 246, 0.35);
  }

  &.ai-btn-active {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%) !important;
  }
}

.dark-mode-chat-container {
  background-color: #1f2937;
  border-left: 1px solid #374151;
}

.light-mode-chat-container {
  background-color: #ffffff;
  border-left: 1px solid #e5e7eb;
}

// Fixed label width for SQL/PromQL condition rows so inputs align
.sql-promql-label {
  min-width: 160px;
  width: 160px;
}

// Column select error state (aggregation measure column)
.alert-v3-select.column-select-error {
  :deep(.q-field__control) {
    border: 1px solid #ef5350 !important;
    border-radius: 4px !important;
    background: rgba(239, 83, 80, 0.05) !important;
  }
}
</style>
