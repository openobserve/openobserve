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
        <span class="section-header-title">Conditions</span>
      </div>
      <div class="tw:px-3 tw:py-2">
      <!-- Query Mode Tabs (hidden for real-time alerts) -->
      <div v-if="shouldShowTabs" class="tw:mb-2 tw:flex tw:items-center tw:justify-between">
        <div class="query-mode-tabs" data-test="step2-query-tabs">
          <button
            v-for="tab in tabOptions"
            :key="tab.value"
            type="button"
            class="query-mode-tab"
            :class="{ active: localTab === tab.value }"
            @click="updateTab(tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- View Editor Button (only for SQL/PromQL tabs) -->
        <q-btn
          v-if="localTab !== 'custom'"
          data-test="step2-view-editor-btn"
          label="View Editor"
          size="sm"
          class="o2-secondary-button q-py-sm"
          @click="viewSqlEditor = true"
        />
      </div>

      <!-- Custom Query Builder -->
      <template v-if="localTab === 'custom'">
        <q-form ref="customConditionsForm" greedy>

          <!-- Section 1: Alert condition sentence — scheduled only -->
          <div v-if="isRealTime === 'false'" class="condition-rows">

            <!-- LOGS/TRACES -->
            <template v-if="isEventBased">
              <!-- Alert if row -->
              <div class="condition-row">
                <span class="condition-label">Alert if</span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="selectedFunction"
                    :options="logFunctionOptions"
                    emit-value
                    map-options
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
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
                  <template v-if="selectedFunction !== 'count'">
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
                      class="inline-condition-select"
                      style="min-width: 140px; max-width: 200px;"
                      @update:model-value="onLogMeasureColumnChange"
                    />
                  </template>

                  <!-- COUNT mode -->
                  <template v-if="selectedFunction === 'count'">
                    <q-select
                      v-model="triggerOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="inline-condition-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <q-input
                      v-model="triggerThreshold"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      @blur="restoreDefaultThreshold"
                      class="inline-condition-select"
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
                      class="inline-condition-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onConditionOperatorChange"
                    />
                    <q-input
                      v-model="conditionValue"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      :placeholder="t('alerts.placeholders.value')"
                      class="inline-condition-select"
                      style="min-width: 80px; max-width: 120px;"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      @update:model-value="onConditionValueChange"
                    />
                  </template>
                </div>
              </div>

              <!-- For any (group by) row (hidden for count mode) -->
              <div v-if="selectedFunction !== 'count'" class="condition-row">
                <span class="condition-label">
                  For any <span class="condition-label-hint">(group by)</span>
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Group results by these fields — alert triggers per unique combination
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
                        class="inline-condition-select"
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
                      <q-btn
                        icon="close"
                        size="xs"
                        flat
                        round
                        dense
                        class="tw:text-gray-400 hover:tw:text-red-500"
                        @click="deleteLogGroupByColumn(index)"
                      />
                    </div>
                  </template>
                  <!-- Default empty dropdown when no group-by fields yet -->
                  <q-select
                    v-if="logGroupBy.length === 0"
                    :model-value="null"
                    :options="filteredFields"
                    class="inline-condition-select"
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
                    @update:model-value="(val: string) => { logGroupBy.push(val); onLogGroupByChange(); }"
                  />
                  <q-btn
                    icon="add"
                    size="xs"
                    flat
                    round
                    dense
                    color="primary"
                    @click="addLogGroupByColumn"
                  >
                    <q-tooltip>Add group by field</q-tooltip>
                  </q-btn>
                </div>
              </div>

              <!-- Atleast row — trigger threshold for measure mode -->
              <div v-if="selectedFunction !== 'count'" class="condition-row">
                <span class="condition-label">
                  Atleast
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Minimum number of matching groups required to trigger the alert
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="triggerOperator"
                    :options="numericOperators"
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
                    style="min-width: 70px; max-width: 120px;"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <q-input
                    v-model="triggerThreshold"
                    type="number"
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
                    style="min-width: 60px; max-width: 80px;"
                    min="1"
                    :rules="[(val: any) => !!val || 'Required']"
                    @update:model-value="onTriggerThresholdChange"
                    @blur="restoreDefaultThreshold"
                  />
                  <span class="condition-text">matching groups found</span>
                </div>
              </div>
            </template>

            <!-- METRICS -->
            <template v-else>
              <!-- Alert if row -->
              <div class="condition-row">
                <span class="condition-label">Alert if</span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="selectedFunction"
                    :options="metricFunctionOptions"
                    emit-value
                    map-options
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
                    style="min-width: 130px; max-width: 180px;"
                    @update:model-value="onMetricFunctionChange"
                  >
                    <q-tooltip :delay="400">
                      {{ metricFunctionOptions.find((o: any) => o.value === selectedFunction)?.tooltip || '' }}
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
                  <template v-if="selectedFunction !== 'count'">
                    <span class="condition-text">of</span>
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
                      @filter="filterNumericColumns"
                      @update:model-value="emitAggregationUpdate"
                      class="inline-condition-select"
                      style="min-width: 140px; max-width: 200px;"
                    />
                    <span class="condition-text">is</span>
                  </template>

                  <!-- Count mode for metrics -->
                  <template v-if="selectedFunction === 'count'">
                    <q-select
                      v-model="triggerOperator"
                      :options="numericOperators"
                      dense
                      borderless
                      hide-bottom-space
                      class="inline-condition-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onTriggerOperatorChange"
                    />
                    <q-input
                      v-model="triggerThreshold"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      class="inline-condition-select"
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
                      class="inline-condition-select"
                      style="min-width: 70px; max-width: 120px;"
                      @update:model-value="onConditionOperatorChange"
                    />
                    <q-input
                      v-model="conditionValue"
                      type="number"
                      dense
                      borderless
                      hide-bottom-space
                      :placeholder="t('alerts.placeholders.value')"
                      class="inline-condition-select"
                      style="min-width: 80px; max-width: 120px;"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      @update:model-value="onConditionValueChange"
                    />
                  </template>
                </div>
              </div>

              <!-- For any (group by) row — hidden for count mode -->
              <div v-if="inputData.aggregation && selectedFunction !== 'count'" class="condition-row">
                <span class="condition-label">
                  For any <span class="condition-label-hint">(group by)</span>
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Group results by these fields — alert triggers per unique combination
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
                        class="inline-condition-select"
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
                      <q-btn
                        icon="close"
                        size="xs"
                        flat
                        round
                        dense
                        class="tw:text-gray-400 hover:tw:text-red-500"
                        @click="deleteGroupByColumn(index)"
                      />
                    </div>
                  </template>
                  <!-- Default empty dropdown when no group-by fields yet -->
                  <q-select
                    v-if="!inputData.aggregation.group_by || inputData.aggregation.group_by.length === 0"
                    :model-value="null"
                    :options="filteredFields"
                    class="inline-condition-select"
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
                    @update:model-value="(val: string) => { if (inputData.aggregation) { inputData.aggregation.group_by.push(val); emitAggregationUpdate(); } }"
                  />
                  <q-btn
                    icon="add"
                    size="xs"
                    flat
                    round
                    dense
                    color="primary"
                    @click="addGroupByColumn"
                  >
                    <q-tooltip>Add group by field</q-tooltip>
                  </q-btn>
                </div>
              </div>

              <!-- Atleast row — trigger threshold for metrics measure mode -->
              <div v-if="selectedFunction !== 'count'" class="condition-row">
                <span class="condition-label">
                  Atleast
                  <q-tooltip anchor="top middle" self="bottom middle" :delay="300">
                    Minimum number of matching groups required to trigger the alert
                  </q-tooltip>
                </span>
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <q-select
                    v-model="triggerOperator"
                    :options="numericOperators"
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
                    style="min-width: 70px; max-width: 120px;"
                    @update:model-value="onTriggerOperatorChange"
                  />
                  <q-input
                    v-model="triggerThreshold"
                    type="number"
                    dense
                    borderless
                    hide-bottom-space
                    class="inline-condition-select"
                    style="min-width: 60px; max-width: 80px;"
                    min="1"
                    :rules="[(val: any) => !!val || 'Required']"
                    @update:model-value="onTriggerThresholdChange"
                    @blur="restoreDefaultThreshold"
                  />
                  <span class="condition-text">matching groups found</span>
                </div>
              </div>
            </template>

            <!-- Check every row -->
            <div class="condition-row tw:!items-start">
              <span class="condition-label" style="line-height: 28px;">
                Check every
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
                      class="inline-condition-select"
                      style="min-width: 60px; max-width: 80px;"
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
                      class="inline-condition-select"
                      placeholder="0 */10 * * * *"
                      style="min-width: 140px; max-width: 180px;"
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
                    class="inline-condition-select frequency-unit-select"
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
                      class="inline-condition-select"
                      placeholder="timezone"
                      :display-value="cronTimezone || 'timezone'"
                      style="min-width: 130px; max-width: 180px;"
                      @filter="timezoneFilterFn"
                      @update:model-value="onCronTimezoneChange"
                    />
                  </template>

                  <span class="condition-text">on these</span>
                  <div
                    class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:select-none filters-inline-toggle"
                    @click="toggleFilters"
                  >
                    <q-icon
                      :name="showFilters ? 'expand_more' : 'chevron_right'"
                      size="16px"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    />
                    <span class="tw:text-xs tw:font-semibold"
                          :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-600'">
                      filters
                    </span>
                    <span v-if="filterCount > 0"
                          class="tw:text-xs tw:px-1.5 tw:py-0.5 tw:rounded-full tw:font-medium"
                          :class="store.state.theme === 'dark' ? 'tw:bg-blue-900 tw:text-blue-200' : 'tw:bg-blue-100 tw:text-blue-700'">
                      {{ filterCount }}
                    </span>
                    <!-- Review your SQL query hint -->
                    <span v-if="generatedSqlQuery && !showFilters"
                          class="tw:text-xs tw:italic tw:ml-1 sql-query-hint"
                          :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'">
                      review your sql query
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
          <div v-else ref="customPreviewRef" class="tw:mb-1 tw:px-3">
            <div class="tw:flex tw:items-center tw:gap-1.5 tw:py-1">
              <span class="tw:text-xs tw:font-semibold"
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-600'">
                Filters
              </span>
              <span v-if="generatedSqlQuery"
                    class="tw:text-xs tw:italic tw:ml-2 sql-query-hint"
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'">
                review your sql query
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

        </q-form>
      </template>

      <!-- SQL/PromQL Preview Mode -->
      <template v-else>
        <div class="tw:w-full tw:flex tw:flex-col tw:gap-4">

          <!-- Preview Boxes Container -->
          <div class="tw:flex tw:gap-4 tw:w-full">
            <!-- SQL/PromQL Preview Box (50% or 100% if no VRL) -->
            <div ref="sqlPromqlPreviewRef" class="preview-box tw:flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" :style="{ height: localTab === 'promql' ? '380px' : '464px' }">
              <div class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
                <span class="preview-title">{{ localTab === 'sql' ? 'SQL' : 'PromQL' }} Preview</span>
              </div>
              <div class="preview-content tw:px-3 tw:py-2">
                <pre class="preview-code">{{ sqlOrPromqlQuery || `No ${localTab === 'sql' ? 'SQL' : 'PromQL'} query defined yet` }}</pre>
              </div>
            </div>

            <!-- VRL Preview Box (50%) - Only show if VRL function exists -->
            <div v-if="vrlFunction" class="preview-box tw:flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" :style="{ height: localTab === 'promql' ? '380px' : '464px' }">
              <div class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
                <span class="preview-title">VRL Preview</span>
              </div>
              <div class="preview-content tw:px-3 tw:py-2">
                <pre class="preview-code">{{ vrlFunction }}</pre>
              </div>
            </div>
          </div>

          <!-- PromQL Trigger Condition (only for PromQL tab) - Below the preview -->
          <div v-if="localTab === 'promql' && promqlCondition" class="flex justify-start items-start q-mb-xs tw:ml-2 no-wrap">
            <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
              Trigger if the value is *
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
              >
                <q-tooltip anchor="center right" self="center left" max-width="300px">
                  <span style="font-size: 14px">
                    Defines when the alert should trigger based on the PromQL query result value.<br />
                    Example: If set to ">= 100", the alert triggers when the query result is greater than or equal to 100.
                  </span>
                </q-tooltip>
              </q-icon>
            </div>
            <div style="width: calc(100% - 190px)">
              <div class="flex justify-start items-start">
                <div class="tw:flex tw:flex-col">
                  <q-select
                    v-model="promqlCondition.operator"
                    :options="triggerOperators"
                    class="showLabelOnTop no-case q-py-none"
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    :style="{
                      width: (promqlCondition.operator === 'Contains' || promqlCondition.operator === 'NotContains')
                        ? '124px'
                        : '88px',
                      minWidth: '88px'
                    }"
                    @update:model-value="emitPromqlConditionUpdate"
                  />
                  <div
                    v-if="!promqlCondition.operator"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
                <div class="flex items-start tw:flex-col" style="border-left: none">
                  <div class="tw:flex tw:items-center">
                    <div style="width: 179px; margin-left: 0 !important">
                      <q-input
                        v-model.number="promqlCondition.value"
                        type="number"
                        dense
                        borderless
                        style="background: none"
                        debounce="300"
                        @update:model-value="emitPromqlConditionUpdate"
                      />
                    </div>
                  </div>
                  <div
                    v-if="promqlCondition.value === undefined || promqlCondition.value === null || promqlCondition.value === ''"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
              </div>
            </div>
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
import { b64EncodeUnicode, getUUID, convertMinutesToCron, getCronIntervalDifferenceInSeconds, isAboveMinRefreshInterval, describeCron } from "@/utils/zincutils";
import hljs from "highlight.js/lib/core";
import sql from "highlight.js/lib/languages/sql";

hljs.registerLanguage("sql", sql);

import FilterGroup from "@/components/alerts/FilterGroup.vue";
import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import CustomConfirmDialog from "@/components/alerts/CustomConfirmDialog.vue";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue")
);

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    FilterGroup,
    QueryEditor,
    QueryEditorDialog,
    CustomConfirmDialog,
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

    const localTab = ref(props.tab);
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
    const showVrl = ref(false);
    const filtersSectionRef = ref<HTMLElement | null>(null);

    // Toggle filters and ensure at least one empty condition exists
    const toggleFilters = () => {
      showFilters.value = !showFilters.value;
      if (showFilters.value && props.inputData.conditions?.conditions) {
        const conditions = props.inputData.conditions.conditions;
        if (conditions.length === 0) {
          conditions.push({
            filterType: 'condition',
            column: '',
            operator: '=',
            value: '',
            values: [],
            logicalOperator: 'AND',
            id: getUUID(),
          });
        }
      }
    };

    // Stream-type-driven: logs/traces are event-based, metrics are aggregation-based
    const isEventBased = computed(() => {
      return props.streamType !== 'metrics';
    });

    // Set aggregation state based on stream type on mount
    if (!isEventBased.value) {
      // Metrics: always aggregation-enabled
      localIsAggregationEnabled.value = true;
      // Initialize aggregation object if missing
      if (!props.inputData.aggregation) {
        props.inputData.aggregation = {
          group_by: [""],
          function: "avg",
          having: { column: "", operator: ">=", value: "" },
        };
      }
    } else {
      // Logs/Traces: event-based, no aggregation
      localIsAggregationEnabled.value = false;
    }

    // Log function options — count (default) and measure functions
    const logFunctionOptions = [
      { label: 'events count', value: 'count', tooltip: 'Count the number of log events matching your filters' },
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

    // Metric function options — always aggregated
    const metricFunctionOptions = [
      { label: 'events count', value: 'count', tooltip: 'Count the number of metric events matching your filters' },
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

    // Selected function — for logs defaults to 'count', for metrics to 'avg'
    const selectedFunction = ref(
      isEventBased.value
        ? (props.isAggregationEnabled && props.inputData.aggregation?.function
            ? props.inputData.aggregation.function
            : 'count')
        : (props.inputData.aggregation?.function || 'avg')
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

    // Watch stream type changes to reset defaults
    watch(isEventBased, (eventBased) => {
      if (eventBased) {
        // Switched to logs/traces
        selectedFunction.value = 'count';
        localIsAggregationEnabled.value = false;
      } else {
        // Switched to metrics — default to avg
        selectedFunction.value = 'avg';
        localIsAggregationEnabled.value = true;
        if (!props.inputData.aggregation) {
          props.inputData.aggregation = {
            group_by: [""],
            function: "avg",
            having: { column: "", operator: ">=", value: "" },
          };
        } else {
          props.inputData.aggregation.function = 'avg';
        }
      }
    });

    // Trigger threshold — "for >= N times" (how many evaluation periods must match)
    const triggerOperator = ref(props.triggerCondition?.operator || '>=');
    const triggerThreshold = ref(props.triggerCondition?.threshold || 3);

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
      { label: 'minutes', value: 'minutes' },
      { label: 'hours', value: 'hours' },
      { label: 'cron', value: 'cron' },
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

    // Filtered columns for log measure column (unique count uses all fields, measure uses numeric)
    const filteredLogMeasureColumns = ref([...props.columns]);
    const filterLogMeasureColumns = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredLogMeasureColumns.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredLogMeasureColumns.value = props.columns.filter((v: any) => {
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
      if (value === 'count') {
        // Count mode — same as logs count, use trigger_condition
        localIsAggregationEnabled.value = false;
        emit("update:isAggregationEnabled", false);
      } else {
        // Measure mode — aggregation
        localIsAggregationEnabled.value = true;
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
          group_by: [""],
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
      if (value === 'count') {
        // Simple count mode — no aggregation, trigger threshold shown inline
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
        // Measure mode — uses aggregation, default trigger to "atleast 1 group"
        localIsAggregationEnabled.value = true;
        if (triggerThreshold.value === 3) {
          // Only change if still at count-mode default
          triggerThreshold.value = 1;
          triggerOperator.value = '>=';
          if (props.triggerCondition) {
            props.triggerCondition.threshold = 1;
            props.triggerCondition.operator = '>=';
            emit("update:triggerCondition", { ...props.triggerCondition });
          }
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
    };
    const onLogGroupByChange = () => {
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by = [...logGroupBy.value];
        emitAggregationUpdate();
      }
    };

    // When condition operator changes
    const onConditionOperatorChange = (value: string) => {
      if (isEventBased.value && selectedFunction.value === 'count') {
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
      if (isEventBased.value && selectedFunction.value === 'count') {
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
    watch(viewSqlEditor, (newValue, oldValue) => {
      // Emit state change whenever it changes
      console.log("[QueryConfig] SQL Editor state changed:", oldValue, "->", newValue);
      emit("editor-state-changed", newValue);

      // When dialog closes (goes from true to false), emit event to refresh preview
      if (oldValue === true && newValue === false) {
        console.log("[QueryConfig] SQL Editor Dialog closed, emitting editor-closed event");
        emit("editor-closed");
      }
    });

    // Sync filtered lists when columns prop changes (async stream load)
    watch(
      () => props.columns,
      (newCols) => {
        filteredFields.value = [...newCols];
        filteredNumericColumns.value = [...newCols];
      }
    );

    // Watch for isAggregationEnabled prop changes (for loading saved alerts)
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        localIsAggregationEnabled.value = newVal;
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
        triggerOperator.value = tc.operator ?? '>=';
        triggerThreshold.value = tc.threshold ?? 3;
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

    // Validation function for Step 2
    const validate = async () => {
      // Custom mode: Check if conditions have empty columns or values
      if (localTab.value === 'custom') {
        return await validateCustomMode();
      }

      // SQL mode: Check for empty query and backend validation errors
      if (localTab.value === 'sql') {
        return validateSqlMode();
      }

      // PromQL mode: No validation required
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
      metricFunctionOptions,
      numericOperators,
      selectedFunction,
      conditionOperator,
      conditionValue,
      triggerOperator,
      triggerThreshold,
      onTriggerOperatorChange,
      onTriggerThresholdChange,
      restoreDefaultThreshold,
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
    };
  },
});
</script>

<style scoped lang="scss">
.step-query-config {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  overflow: auto;

  .step-content {
    border-radius: 8px;
    min-height: 100%;
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
.condition-rows {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.condition-row {
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

// Inline condition sentence styling
.inline-condition-select {
  :deep(.q-field__control) {
    background: rgba(var(--q-primary-rgb, 92, 107, 192), 0.06);
    border: 1px solid rgba(var(--q-primary-rgb, 92, 107, 192), 0.25);
    border-radius: 6px;
    padding: 2px 8px;
    min-height: 28px;
    height: 28px;
  }

  :deep(.q-field__native),
  :deep(.q-field__input) {
    color: var(--q-primary);
    font-weight: 600;
    font-size: 13px;
  }

  :deep(.q-field__append) {
    color: var(--q-primary);
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
    background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%) !important;
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

.query-mode-tabs {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  padding: 3px;

  .query-mode-tab {
    padding: 4px 12px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: rgba(0, 0, 0, 0.4);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    line-height: 1.4;

    &:hover { color: rgba(0, 0, 0, 0.7); }

    &.active {
      background: #fff;
      color: #1a1a1a;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
  }
}

.dark-mode .query-mode-tabs {
  background: rgba(255, 255, 255, 0.05);

  .query-mode-tab {
    color: rgba(255, 255, 255, 0.6);

    &:hover { color: rgba(255, 255, 255, 0.85); }

    &.active {
      background: #374151;
      color: #e4e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
  }
}
</style>
