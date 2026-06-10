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
  <div class="tw:w-full scheduled-pipeline-container">
    <!-- <OSeparator /> -->

    <div class="tw:mb-2 stepper-header tw:w-full tw:flex tw:h-full">
      <div
        :class="store.state.isAiChatEnabled ? 'tw:w-[75%]' : 'tw:w-[100%]'"
        style="height: 100% !important; display: flex;"
      >
        <!-- Collapsed field list bar (shown when hidden) -->
        <div
          v-if="collapseFields"
          class="field-list-sidebar-header-collapsed card-container tw:bg-surface-panel! tw:shrink-0 tw:cursor-pointer"
          style="width: 50px; height: 100%"
          data-test="scheduled-pipeline-field-list-collapsed-bar"
          @click="collapseFieldList"
        >
          <OIcon name="expand-all" size="sm" class="field-list-collapsed-icon rotate-90" />
          <div class="field-list-collapsed-title">{{ t("pipeline.buildQuery") }}</div>
        </div>

        <OSplitter
          v-model="splitterModel"
          :style="{ width: collapseFields ? 'calc(100% - 50px)' : '100%' }"
          class="o2-custom-splitter"
        >
          <template #before>
            <div style="display: flex; flex-direction: column; height: 100%;">
            <!-- Left panel header with collapse button -->
            <div class="tw:flex tw:items-center tw:justify-between tw:shrink-0 tw:px-2 tw:py-1.5 tw:border-b tw:border-border-default tw:bg-surface-panel">
              <span class="tw:font-semibold tw:text-sm">{{ t("pipeline.buildQuery") }}</span>
              <OButton
                variant="outline"
                size="icon-xs-sq"
                class="tw:rotate-90"
                icon-left="unfold-less"
                :title="t('search.collapseFields')"
                data-test="scheduled-pipeline-collapse-btn"
                @click="collapseFieldList"
              />
            </div>
            <div class="tw:pl-2 tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
            <div
              style="width: 100%; overflow-y: auto;"
              class="tw:flex-1 tw:min-h-0"
            >
                <!-- fieldlist section -->
                <div
                  style="
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <span
                    @click.stop="
                      expandState.buildQuery = !expandState.buildQuery
                    "
                  >
                    <FullViewContainer
                      name="query"
                      v-model:is-expanded="expandState.buildQuery"
                      :label="t('pipeline.buildQuery')"
                    />
                  </span>
                  <div
                    v-show="expandState.buildQuery"
                    style="
                      display: flex;
                      flex-direction: column;
                      padding-top: 8px;
                    "
                  >
                    <div style="flex-shrink: 0">
                      <OSelect
                        v-model="selectedStreamType"
                        :options="streamTypes"
                        :label="t('alerts.streamType') + ' *'"
                        class="no-case tw:w-full tw:mb-1"
                        data-test="scheduled-pipeline-stream-type-select"
                        @update:model-value="getStreamList"
                      />

                      <OSelect
                        v-model="selectedStreamName"
                        :options="filteredStreams"
                        labelKey="label"
                        valueKey="value"
                        :label="t('alerts.stream_name')"
                        :placeholder="t('pipeline.selectStream')"
                        :loading="streamsLoading"
                        class="tw:my-1 no-case tw:w-full"
                        data-test="scheduled-pipeline-stream-name-select"
                        @update:model-value="getStreamFields"
                        @open="getStreamList"
                      />
                    </div>

                    <!-- FieldList scrolls within a capped height -->
                    <div
                      style="max-height: 40vh; overflow-y: auto;"
                      class="pipeline-field-list-wrapper"
                    >
                      <GroupedFieldList
                        :fields="streamFields"
                        :theme="store.state.theme"
                        :show-pagination="false"
                        :page-size="50"
                      >
                        <template #field-row="{ row }">
                          <FieldRow
                            :field="row"
                            :selected-fields="[]"
                            :timestamp-column="store.state.zoConfig.timestamp_column"
                            :theme="store.state.theme"
                            :show-quick-mode="false"
                            :show-visibility-toggle="false"
                            :show-fts-field-values="showFtsFieldValues"
                            @add-to-filter="addFieldSearchTerm(`${row.name}=''`)"
                          >
                            <template
                              v-if="isFieldExpandable(row)"
                              #expansion="{ field }"
                            >
                              <FieldExpansion
                                :field="field"
                                :field-values="fieldValues[field.name]"
                                :expanded="expandedRows?.[field.name] ?? false"
                                :theme="store.state.theme"
                                :show-visibility-toggle="false"
                                :show-filter-icon="false"
                                :show-quick-mode="false"
                                :default-values-count="defaultValuesCount"
                                @add-to-filter="(val: string) => addFieldSearchTerm(val)"
                                @add-search-term="handleAddSearchTerm"
                                @add-multiple-search-terms="handleAddMultipleSearchTerms"
                                @remove-field-filter="(fn: string) => handleSidebarEvent('remove-field', fn)"
                                @search-field-values="handleSearchFieldValues"
                                @load-more-values="handleLoadMoreValues"
                                @before-show="(event: any, f: any) => openFilterCreator(f)"
                                @before-hide="(f: any) => closeField(f.name)"
                              >
                                <!-- Duration percentiles for traces -->
                                <template
                                  v-if="field.name === 'duration' && selectedStreamType === 'traces'"
                                  #body
                                >
                                  <div
                                    v-if="durationPercentilesLoading"
                                    class="tw:flex tw:justify-center tw:py-[0.5rem]"
                                  >
                                    <OSpinner size="xs" />
                                  </div>
                                  <template v-else-if="hasDurationPercentiles">
                                    <div
                                      v-for="p in PERCENTILE_LABELS"
                                      :key="p.key"
                                      class="tw:flex tw:items-center tw:justify-between tw:py-[0.15rem] tw:pl-[0.5rem]"
                                    >
                                      <span class="tw:text-[0.7rem] tw:w-[2rem] tw:shrink-0">{{ p.label }}</span>
                                      <span class="tw:text-[0.7rem] tw:flex-1 tw:text-right tw:pr-[0.25rem]">
                                        {{ formatTimeWithSuffix(durationPercentiles[p.key]) }}
                                      </span>
                                      <div class="tw:flex tw:w-[2.7rem]">
                                        <OButton
                                          v-if="p.key !== 'max'"
                                          variant="ghost"
                                          size="icon-xs-circle"
                                          :title="`duration >= ${formatTimeWithSuffix(durationPercentiles[p.key])}`"
                                          @click.stop="addFieldSearchTerm(`duration>='${formatTimeWithSuffix(durationPercentiles[p.key])}'`)"
                                          class="tw:ml-[0.125rem]! tw:border! tw:border-[var(--o2-border-color)]!"
                                        >
                                          <OIcon name="arrow-forward-ios" size="sm" class="tw:h-[0.4rem]! tw:w-[0.4rem]!" />
                                        </OButton>
                                        <OButton
                                          variant="ghost"
                                          size="icon-xs-circle"
                                          :title="`duration <= ${formatTimeWithSuffix(durationPercentiles[p.key])}`"
                                          @click.stop="addFieldSearchTerm(`duration<='${formatTimeWithSuffix(durationPercentiles[p.key])}'`)"
                                          class="tw:ml-auto! tw:mr-[0.5rem]! tw:border! tw:border-[var(--o2-border-color)]!"
                                        >
                                          <OIcon name="arrow-back-ios" size="sm" class="tw:h-[0.4rem]! tw:w-[0.4rem]!" />
                                        </OButton>
                                      </div>
                                    </div>
                                  </template>
                                  <div v-else class="tw:pl-2 tw:py-1 tw:text-[0.7rem] tw:text-o2-text-secondary">
                                    {{ durationPercentileErrMsg || "No values found" }}
                                  </div>
                                </template>
                              </FieldExpansion>
                            </template>
                          </FieldRow>
                        </template>
                      </GroupedFieldList>
                    </div>
                  </div>
                </div>
                <span
                  @click.stop="
                    expandState.setVariables = !expandState.setVariables
                  "
                >
                  <!-- set variables part -->
                  <FullViewContainer
                    name="query"
                    v-model:is-expanded="expandState.setVariables"
                    :label="t('pipeline.setVariables')"
                    class="tw:mt-1"
                  />
                </span>
                <div
                  v-show="expandState.setVariables"
                  class="tw:flex tw:flex-col tw:pt-2"
                >
                  <div class="tw:flex tw:flex-col tw:gap-4 tw:w-full">
                    <div
                      v-if="
                        selectedStreamType === 'metrics' &&
                        tab === 'promql' &&
                        promqlCondition
                      "
                      class="tw:flex tw:items-center tw:gap-2"
                    >
                      <div
                        class="tw:font-bold tw:flex tw:items-center tw:gap-1 tw:w-[160px] tw:shrink-0"
                      >
                        <span>{{ t("pipeline.trigger") }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:cursor-pointer tw:text-gray-400"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="tw:text-[14px]">
                                Based upon the condition of trigger the
                                pipeline will get trigger <br />
                                e.g. if the trigger value is &gt;100 and the query
                                returns a value of 101 then the pipeline will
                                trigger.
                              </span>
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <OSelect
                        v-model="promqlCondition.operator"
                        :options="triggerOperators"
                        :searchable="false"
                        width="xs"
                        class="no-case"
                        data-test="scheduled-pipeline-promlq-condition-operator-select"
                        @update:model-value="updatePromqlCondition"
                      />
                      <OInput
                        v-model="promqlCondition.value"
                        type="number"
                        :min="0"
                        :placeholder="t('pipeline.value')"
                        width="xs"
                        data-test="scheduled-pipeline-promlq-condition-value"
                        @update:model-value="updatePromqlCondition"
                      />
                    </div>
                    <div
                      v-if="tab === 'custom'"
                      class="tw:flex tw:items-center tw:gap-2 tw:font-bold tw:mb-4"
                    >
                      <div
                        data-test="scheduled-pipeline-aggregation-title"
                        class="tw:w-[172px] tw:shrink-0"
                      >
                        {{ t("pipeline.aggregation") }}
                      </div>
                      <OSwitch
                        data-test="scheduled-pipeline-aggregation-toggle"
                        v-model="_isAggregationEnabled"
                        :disabled="tab === 'sql' || tab === 'promql'"
                        @update:model-value="updateAggregation"
                      />
                    </div>
                    <div
                      v-if="_isAggregationEnabled && aggregationData"
                      class="tw:flex tw:items-center tw:flex-nowrap tw:mr-2 tw:mb-2"
                    >
                      <div
                        data-test="scheduled-pipeline-group-by-title"
                        class="tw:font-bold"
                        style="width: 190px"
                      >
                        {{ t("alerts.groupBy") }}
                      </div>
                      <div
                        class="tw:flex tw:justify-start tw:items-center tw:flex-wrap"
                        style="width: calc(100% - 190px)"
                      >
                        <template
                          v-for="(group, index) in aggregationData.group_by"
                          :key="group"
                        >
                          <div
                            :data-test="`scheduled-pipeline-group-by-${index + 1}`"
                            class="tw:flex tw:justify-start tw:items-center tw:flex-nowrap o2-input"
                          >
                            <div
                              data-test="scheduled-pipeline-group-by-column-select"
                            >
                              <OSelect
                                v-model="aggregationData.group_by[index]"
                                :options="filteredFields"
                                labelKey="label"
                                valueKey="value"
                                :placeholder="t('pipeline.selectColumn')"
                                :error="!!groupByErrors[index]"
                                :error-message="groupByErrors[index]"
                                style="width: 200px"
                                @update:model-value="
                                  (val: any) => {
                                    groupByErrors[index] = '';
                                    updateTrigger();
                                  }
                                "
                              />
                            </div>
                            <OButton
                              data-test="scheduled-pipeline-group-by-delete-btn"
                              variant="ghost-destructive"
                              size="icon-xs-sq"
                              class="tw:mb-2 tw:ml-1 tw:mr-2"
                              :title="t('alert_templates.delete')"
                              @click="deleteGroupByColumn(index)"
                              icon-left="delete"
                            />
                          </div>
                        </template>
                        <OButton
                          data-test="scheduled-pipeline-group-by-add-btn"
                          variant="ghost"
                          size="icon-xs-sq"
                          class="tw:mb-2 tw:ml-1 tw:mr-2"
                          :title="t('common.add')"
                          @click="addGroupByColumn()"
                          icon-left="add"
                        />
                      </div>
                    </div>
                    <div
                      v-if="!disableThreshold"
                      class="tw:flex tw:justify-start tw:items-center tw:mb-1 tw:flex-nowrap tw:pb-3"
                    >
                      <div
                        data-test="scheduled-pipeline-threshold-title"
                        class="tw:font-bold tw:flex tw:items-center"
                        style="width: 190px"
                      >
                        {{ t("alerts.threshold") + " *" }}

                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:ml-1 tw:cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'tw:text-gray-400'
                              : 'tw:text-gray-400'
                          "
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span style="font-size: 14px"
                                >The threshold above/below which the alert will
                                trigger. <br />
                                e.g. if the threshold is >100 and the query
                                returns a value of 101 then the alert will
                                trigger.</span
                              >
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <div
                        style="width: calc(100% - 190px)"
                        class="position-relative"
                      >
                        <template
                          v-if="_isAggregationEnabled && aggregationData"
                        >
                          <div class="tw:flex tw:justify-start tw:items-center">
                            <div
                              data-test="scheduled-pipeline-threshold-function-select"
                              class="threshould-input tw:mr-1 o2-input"
                            >
                              <OSelect
                                v-model="aggregationData.function"
                                :options="aggFunctions"
                                style="width: 120px"
                                @update:model-value="updateAggregation"
                              />
                            </div>
                            <div
                              class="threshould-input tw:mr-1 o2-input"
                              data-test="scheduled-pipeline-threshold-column-select"
                            >
                              <OSelect
                                v-model="aggregationData.having.column"
                                :options="filteredNumericColumns"
                                labelKey="label"
                                valueKey="value"
                                style="width: 250px"
                                @update:model-value="updateAggregation"
                              />
                            </div>
                            <div
                              data-test="scheduled-pipeline-threshold-operator-select"
                              class="threshould-input tw:mr-1 o2-input tw:mt-2"
                            >
                              <OSelect
                                v-model="aggregationData.having.operator"
                                :options="triggerOperators"
                                style="width: 120px"
                                @update:model-value="updateAggregation"
                              />
                            </div>
                            <div class="tw:flex tw:items-center tw:mt-2">
                              <div
                                data-test="scheduled-pipeline-threshold-value-input"
                                style="width: 250px; margin-left: 0 !important"
                                class="silence-notification-input o2-input"
                              >
                                <OInput
                                  v-model="aggregationData.having.value"
                                  type="number"
                                  :min="0"
                                  :placeholder="t('pipeline.value')"
                                  @update:model-value="updateAggregation"
                                />
                              </div>
                            </div>
                          </div>
                          <div
                            data-test="scheduled-pipeline-threshold-error-text"
                            v-if="
                              !aggregationData.function ||
                              !aggregationData.having.column ||
                              !aggregationData.having.operator ||
                              !aggregationData.having.value.toString().trim()
                                .length
                            "
                            class="text-red-8 tw:pt-1 tw:absolute"
                            style="font-size: 11px; line-height: 12px"
                          >
                            {{ t("pipeline.fieldRequired") }}
                          </div>
                        </template>
                        <template v-else>
                          <div class="tw:flex tw:justify-start tw:items-center">
                            <div
                              class="threshould-input"
                              data-test="scheduled-pipeline-threshold-operator-select"
                            >
                              <OSelect
                                v-model="triggerData.operator"
                                :options="triggerOperators"
                                style="
                                  width: 88px;
                                  border: 1px solid rgba(0, 0, 0, 0.05);
                                "
                                @update:model-value="updateTrigger"
                              />
                            </div>
                            <div
                              class="tw:flex tw:items-center"
                              style="
                                border: 1px solid rgba(0, 0, 0, 0.05);
                                border-left: none;
                              "
                            >
                              <div
                                style="width: 89px; margin-left: 0 !important"
                                class="silence-notification-input"
                                data-test="scheduled-pipeline-threshold-value-input"
                              >
                                <OInput
                                  v-model="triggerData.threshold"
                                  type="number"
                                  :min="1"
                                  @update:model-value="updateTrigger"
                                />
                              </div>
                              <div
                                data-test="scheduled-pipeline-threshold-unit"
                                style="
                                  min-width: 90px;
                                  margin-left: 0 !important;
                                  height: 40px;
                                  font-weight: normal;
                                "
                                :class="
                                  store.state.theme === 'dark'
                                    ? 'tw:bg-gray-800'
                                    : 'tw:bg-gray-100'
                                "
                                class="tw:flex tw:justify-center tw:items-center"
                              >
                                {{ t("alerts.times") }}
                              </div>
                            </div>
                          </div>
                          <div
                            data-test="scheduled-pipeline-threshold-error-text"
                            v-if="
                              !triggerData.operator ||
                              !Number(triggerData.threshold)
                            "
                            class="text-red-8 tw:pt-1 tw:absolute"
                            style="font-size: 11px; line-height: 12px"
                          >
                            {{ t("pipeline.fieldRequired") }}
                          </div>
                        </template>
                      </div>
                    </div>
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <div
                        data-test="scheduled-pipeline-cron-toggle-title"
                        class="tw:font-bold tw:flex tw:items-center tw:gap-1 tw:w-[160px] tw:shrink-0"
                      >
                        <span>{{ t("alerts.crontitle") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:cursor-pointer tw:text-gray-400"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="tw:text-[14px]">
                                Configure the option to enable a cron
                                expression.
                              </span>
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <OSwitch
                        data-test="scheduled-pipeline-cron-toggle-btn"
                        v-model="isCronMode"
                      />
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <div
                        data-test="scheduled-pipeline-frequency-title"
                        class="tw:font-bold tw:flex tw:items-center tw:gap-1 tw:w-[160px] tw:shrink-0 tw:pt-2"
                      >
                        <span>{{ t("alerts.frequency") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:cursor-pointer tw:text-gray-400"
                        >
                          <OTooltip side="right">
                            <template #content>
                              <span
                                class="tw:text-[14px]"
                                v-if="triggerData.frequency_type == 'minutes'"
                                >How often the task should be executed.<br />
                                e.g., 2 minutes means that the task will run
                                every 2 minutes and will be processed based on
                                the other parameters provided.</span
                              >
                              <span class="tw:text-[14px]" v-else>
                                Pattern: * * * * * * means every second.
                                <br />
                                Format: [Second (optional) 0-59] [Minute 0-59]
                                [Hour 0-23] [Day of Month 1-31, 'L'] [Month
                                1-12] [Day of Week 0-7 or '1L-7L', 0 and 7 for
                                Sunday].
                                <br />
                                Use '*' to represent any value, 'L' for the last
                                day/weekday.
                                <br />
                                Example: 0 0 12 * * ? - Triggers at 12:00 PM
                                daily. It specifies second, minute, hour, day of
                                month, month, and day of week,
                                respectively.</span
                              >
                            </template>
                          </OTooltip>
                        </OIcon>
                        <template
                          v-if="
                            triggerData.frequency_type == 'cron' &&
                            showTimezoneWarning
                          "
                        >
                          <OIcon
                            name="warning"
                            size="sm"
                            class="tw:cursor-pointer tw:text-orange-500"
                          >
                            <OTooltip
                              side="right"
                              content="Warning: The displayed timezone is approximate. Verify and select the correct timezone manually."
                            />
                          </OIcon>
                        </template>
                      </div>
                      <div class="tw:flex tw:flex-col tw:gap-1">
                        <template v-if="triggerData.frequency_type == 'minutes'">
                          <div
                            class="tw:flex tw:items-stretch tw:border tw:border-[var(--o2-border-color)] tw:rounded-md tw:w-fit tw:overflow-hidden"
                          >
                            <OInput
                              data-test="scheduled-pipeline-frequency-input-field"
                              v-model="triggerData.frequency"
                              type="number"
                              :min="
                                Math.ceil(
                                  store.state?.zoConfig
                                    ?.min_auto_refresh_interval / 60,
                                ) || 1
                              "
                              width="xs"
                              @update:model-value="updateFrequency"
                            />
                            <div
                              data-test="scheduled-pipeline-frequency-unit"
                              :class="[
                                'tw:flex tw:justify-center tw:items-center tw:min-w-[60px] tw:px-2 tw:font-normal',
                                store.state.theme === 'dark'
                                  ? 'tw:bg-gray-800'
                                  : 'tw:bg-gray-100',
                              ]"
                            >
                              {{ t("alerts.minutes") }}
                            </div>
                          </div>
                        </template>
                        <template v-else>
                          <div class="tw:flex tw:items-center tw:gap-2">
                            <OInput
                              data-test="scheduled-pipeline-cron-input-field"
                              v-model="triggerData.cron"
                              :placeholder="t('reports.cronExpression') + ' *'"
                              width="xs"
                              @update:model-value="updateCron"
                              @blur="cronTouched = true"
                            />
                            <OSelect
                              data-test="add-report-schedule-start-timezone-select"
                              v-model="triggerData.timezone"
                              :options="filteredTimezone"
                              :placeholder="t('logStream.timezone') + ' *'"
                              :title="triggerData.timezone"
                              width="xs"
                            />
                          </div>
                        </template>
                        <div
                          data-test="scheduled-pipeline-frequency-error-text"
                          v-if="
                            (!Number(triggerData.frequency) &&
                              triggerData.frequency_type == 'minutes') ||
                            (triggerData.frequency_type == 'cron' &&
                              triggerData.cron == '' &&
                              cronTouched) ||
                            cronJobError
                          "
                          class="tw:text-red-700 tw:text-[11px] tw:leading-3"
                        >
                          {{ cronJobError || t("pipeline.fieldRequired") }}
                        </div>
                      </div>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <div
                        data-test="scheduled-pipeline-period-title"
                        class="tw:font-bold tw:flex tw:items-center tw:gap-1 tw:w-[160px] tw:shrink-0 tw:pt-2"
                      >
                        <span>{{ t("alerts.period") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:cursor-pointer tw:text-gray-400"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="tw:text-[14px]">
                                Period for which the query should run.<br />
                                e.g. 10 minutes means that whenever the query
                                will run it will use the last 10 minutes of
                                data. If the query runs at 4:00 PM then it will
                                use the data from 3:50 PM to 4:00 PM.
                              </span>
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <div class="tw:flex tw:flex-col tw:gap-1">
                        <div
                          class="tw:flex tw:items-stretch tw:border tw:border-[var(--o2-border-color)] tw:rounded-md tw:w-fit tw:overflow-hidden"
                        >
                          <OInput
                            data-test="scheduled-pipeline-period-input"
                            v-model="triggerData.period"
                            type="number"
                            :min="1"
                            :readonly="triggerData.frequency_type == 'minutes'"
                            :disabled="triggerData.frequency_type == 'minutes'"
                            class="silence-notification-input" width="xs"
                            @update:model-value="updateTrigger"
                          />
                          <div
                            data-test="scheduled-pipeline-period-unit"
                            :class="[
                              'tw:flex tw:justify-center tw:items-center tw:min-w-[60px] tw:px-2 tw:font-normal',
                              store.state.theme === 'dark'
                                ? 'tw:bg-gray-800'
                                : 'tw:bg-gray-100',
                            ]"
                          >
                            {{ t("alerts.minutes") }}
                          </div>
                        </div>
                        <div
                          v-if="!Number(triggerData.period)"
                          data-test="scheduled-pipeline-period-error-text"
                          class="tw:text-red-700 tw:text-[11px] tw:leading-3"
                        >
                          Field is required!
                        </div>
                        <div
                          v-else
                          data-test="scheduled-pipeline-period-warning-text"
                          class="tw:text-[var(--o2-primary)] tw:text-[12px] tw:leading-3 tw:py-0.5"
                        >
                          Note: The period should be the same as frequency.
                        </div>
                      </div>
                    </div>
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <div
                        data-test="scheduled-pipeline-delay-title"
                        class="tw:font-bold tw:flex tw:items-center tw:gap-1 tw:w-[160px] tw:shrink-0"
                      >
                        <span>{{ t("pipeline.delay") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="tw:cursor-pointer tw:text-gray-400"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="tw:text-[14px]"
                                >Delay for which the pipeline is scheduled to
                                run.<br />
                                e.g. 10 minutes delay means that the pipeline
                                will run 10 minutes after its scheduled
                                time.</span
                              >
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <div
                        class="tw:flex tw:items-stretch tw:border tw:border-[var(--o2-border-color)] tw:rounded-md tw:w-fit tw:overflow-hidden"
                      >
                        <OInput
                          data-test="scheduled-pipeline-delay-input"
                          v-model="delayCondition"
                          type="number"
                          :min="0"
                          width="xs"
                          @update:model-value="updateDelay"
                        />
                        <div
                          data-test="scheduled-pipeline-delay-unit"
                          :class="[
                            'tw:flex tw:justify-center tw:items-center tw:min-w-[60px] tw:px-2 tw:font-normal',
                            store.state.theme === 'dark'
                              ? 'tw:bg-gray-800'
                              : 'tw:bg-gray-100',
                          ]"
                        >
                          {{ t("alerts.minutes") }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div></div>

                  <div
                    class="tw:flex tw:justify-start tw:items-end tw:mt-4 tw:pb-4 tw:w-full"
                    :class="
                      store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'
                    "
                  ></div>
                </div>
            </div>
            </div>
            </div>
          </template>
          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
          </template>
          <template #after>
            <div class="tw:w-full tw:flex tw:flex-col tw:border-l tw:border-border-default" style="height: 100%">
              <div
                class="tw:flex-1 tw:overflow-auto"
                style="height: calc(100vh - 200px) !important; width: 100%"
              >
                <div class="query-editor-container scheduled-pipelines">
                  <span @click.stop="expandState.query = !expandState.query">
                    <FullViewContainer
                      name="query"
                      v-model:is-expanded="expandState.query"
                      :label="
                        tab === 'sql'
                          ? t('pipeline.sqlQuery')
                          : t('pipeline.promqlQuery')
                      "
                    />
                  </span>
                  <div class="tw:relative">
                    <UnifiedQueryEditor
                      v-show="expandState.query"
                      data-test="scheduled-pipeline-sql-editor"
                      ref="pipelineEditorRef"
                      :languages="tab === 'promql' ? ['promql'] : ['sql']"
                      :default-language="tab === 'promql' ? 'promql' : 'sql'"
                      :query="query"
                      :keywords="effectiveKeywords"
                      :suggestions="effectiveSuggestions"
                      :disable-ai="!selectedStreamName"
                      :disable-ai-reason="t('search.selectStreamForAI')"
                      @update:query="updateQueryValue"
                      @run-query="runQuery"
                      @focus="() => { queryEditorPlaceholderFlag = false; _sqlOnFocus(); }"
                      @blur="onBlurQueryEditor"
                      editor-height="calc(100vh - 190px)"
                    />
                    <div
                      v-if="!query && queryEditorPlaceholderFlag && expandState.query"
                      class="query-editor-placeholder-overlay"
                    >
                      <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
                    </div>
                  </div>

                  <div>
                  <span @click.stop="expandState.output = !expandState.output">
                    <FullViewContainer
                      name="output"
                      v-model:is-expanded="expandState.output"
                      :label="t('pipeline.output')"
                      class="tw:mt-1"
                    />
                  </span>
                  <div
                    v-if="loading && expandState.output && tab == 'sql'"
                    style="height: calc(100vh - 190px) !important"
                    class="tw:flex tw:justify-center tw:items-center"
                  >
                    <OSpinner size="md" />
                  </div>

                  <TenstackTable
                    v-else-if="
                      expandState.output && rows.length > 0 && tab == 'sql'
                    "
                    style="height: calc(100vh - 190px) !important"
                    ref="searchTableRef"
                    :columns="getColumns"
                    :rows="rows"
                    :jsonpreviewStreamName="selectedStreamName"
                    :expandedRows="expandedLogs"
                    @expand-row="expandLog"
                    @copy="copyLogToClipboard"
                    @sendToAiChat="sendToAiChat"
                  />

                  <div
                    v-else-if="
                      rows.length == 0 && expandState.output && tab == 'sql'
                    "
                    style="height: calc(100vh - 236px) !important"
                  >
                    <h6
                      v-if="selectedStreamName == ''"
                      data-test="logs-search-no-stream-selected-text"
                      class="tw:text-center tw:w-5/6 tw:mx-0"
                    >
                      <OIcon
                        name="info"
                        size="md"
                        class="tw:align-middle tw:mr-1"
                      />
                      {{ t("search.noStreamSelectedMessage") }}
                    </h6>
                    <h6
                      v-else-if="notificationMsgValue != ''"
                      data-test="logs-search-no-stream-selected-text"
                      class="tw:text-center tw:w-5/6 tw:mx-0"
                    >
                      {{ notificationMsgValue }}
                    </h6>
                    <h6
                      v-else
                      data-test="logs-search-no-stream-selected-text"
                      class="tw:text-center tw:w-5/6 tw:mx-0"
                    >
                      <OIcon name="info" size="md" />
                      {{ t("search.applySearch") }}
                    </h6>
                  </div>

                  <div v-else-if="tab == 'promql' && expandState.output">
                    <PreviewPromqlQuery
                      ref="previewPromqlQueryRef"
                      :query="query"
                      :stream_name="selectedStreamName"
                      :stream_type="selectedStreamType"
                      :dateTime="dateTime"
                    />
                  </div>
                </div>
                </div>
              </div>

              <div
                class="scheduled-pipeline-footer tw:sticky tw:bottom-0 tw:px-4 tw:py-3 tw:z-10"
                :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
              >
                <div class="tw:flex tw:justify-end tw:gap-2">
                  <OButton
                    v-if="pipelineObj.isEditNode"
                    data-test="stream-routing-query-delete-btn"
                    variant="outline-destructive"
                    size="sm-action"
                    @mousedown.prevent
                    @click="$emit('delete:node')"
                    icon-left="delete"
                  >
                    {{ t("pipeline.deleteNode") }}
                  </OButton>

                  <OButton
                    data-test="stream-routing-query-cancel-btn"
                    variant="outline"
                    size="sm-action"
                    @mousedown.prevent
                    @click="$emit('cancel:form')"
                  >
                    {{ t("alerts.cancel") }}
                  </OButton>
                  <OButton
                    data-test="stream-routing-query-save-btn"
                    variant="primary"
                    size="sm-action"
                    :disabled="validatingSqlQuery"
                    @mousedown.prevent
                    @click.prevent="$emit('submit:form')"
                  >
                    {{
                      validatingSqlQuery
                        ? t("pipeline.validating")
                        : t("pipeline.validateAndClose")
                    }}
                  </OButton>
                </div>
              </div>
            </div>
          </template>
        </OSplitter>

        <!-- query-eidtor-part -->
      </div>

      <div
        class="tw:ml-2"
        v-if="store.state.isAiChatEnabled"
        style="
          width: 25%;
          max-width: 100%;
          min-width: 75px;
          height: calc(100vh - 70px) !important;
        "
        :class="
          store.state.theme == 'dark'
            ? 'dark-mode-chat-container'
            : 'light-mode-chat-container'
        "
      >
        <O2AIChat
          style="height: calc(100vh - 70px) !important"
          :is-open="store.state.isAiChatEnabled"
          @close="store.state.isAiChatEnabled = false"
          :aiChatInputContext="aiChatInputContext"
          :appendMode="aiChatAppendMode"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  type Ref,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onBeforeMount,
} from "vue";
import FieldsInput from "@/components/alerts/FieldsInput.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import {
  getImageURL,
  useLocalTimezone,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  timestampToTimezoneDate,
  formatTimeWithSuffix,
  b64EncodeUnicode,
  queryIndexSplit,
} from "@/utils/zincutils";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { toggleFullscreen } from "@/utils/dom";
import { copyToClipboard } from "@/utils/clipboard";
import CronExpressionParser from "cron-parser";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import IndexList from "@/plugins/logs/IndexList.vue";
import { split } from "postcss/lib/list";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import DateTime from "@/components/DateTime.vue";

import useLogs from "@/composables/useLogs";

import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import FieldRow from "@/components/common/FieldRow.vue";
import FieldListPagination from "@/components/common/FieldListPagination.vue";
import useStreams from "@/composables/useStreams";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import useDurationPercentiles from "@/composables/useDurationPercentiles";
import AppTabs from "@/components/common/AppTabs.vue";
import {
  applyFieldGrouping,
  buildSemanticIndex,
  type FieldObj,
} from "@/utils/fieldCategories";
import {
  useServiceCorrelation,
  type KeyFieldsConfig,
  type FieldGroupingConfig,
} from "@/composables/useServiceCorrelation";

import TenstackTable from "@/plugins/logs/TenstackTable.vue";
import PreviewPromqlQuery from "./PreviewPromqlQuery.vue";

import config from "../../../aws-exports";

import useAiChat from "@/composables/useAiChat";
import { onBeforeUnmount } from "vue";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { debounce } from "lodash-es";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { createPipelinesContextProvider } from "@/composables/contextProviders/pipelinesContextProvider";
import { contextRegistry } from "@/composables/contextProviders";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  getFieldFromExpression,
  hasFieldCondition,
  removeFieldCondition,
  replaceExistingFieldCondition,
} from "@/plugins/logs/filterUtils";

const UnifiedQueryEditor = defineAsyncComponent(
  () => import("@/components/QueryEditor.vue"),
);
const FieldExpansion = defineAsyncComponent(
  () => import("@/components/common/FieldExpansion.vue"),
);

const props = defineProps([
  "columns",
  "conditions",
  "trigger",
  "sql",
  "query_type",
  "aggregation",
  "isAggregationEnabled",
  "alertData",
  "promql",
  "promql_condition",
  "vrl_function",
  "showVrlFunction",
  "isValidSqlQuery",
  "disableThreshold",
  "disableVrlFunction",
  "disableQueryTypeSelection",
  "showTimezoneWarning",
  "streamType",
  "validatingSqlQuery",
  "delay",
]);

const emits = defineEmits([
  "field:add",
  "field:remove",
  "update:trigger",
  "update:query_type",
  "update:sql",
  "update:aggregation",
  "update:isAggregationEnabled",
  "input:update",
  "update:promql",
  "update:promql_condition",
  "update:vrl_function",
  "update:showVrlFunction",
  "validate-sql",
  "update:frequency",
  "update:stream_type",
  "submit:form",
  "cancel:form",
  "delete:node",
  "update:fullscreen",
  "update:stream_type",
  "update:delay",
]);
const { pipelineObj } = useDragAndDrop();
const { searchObj } = useLogs();
const { getStream, getStreams } = useStreams();
const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } =
  useServiceCorrelation();
const { registerAiChatHandler, removeAiChatHandler } = useAiChat();
let parser: any;

const selectedStreamName = ref("");

const streamOptions = ref([]);

const notificationMsgValue = ref("");

const getColumns = computed(() => {
  return [
    {
      name: "_timestamp",
      id: "_timestamp",
      accessorFn: (row: any) =>
        timestampToTimezoneDate(
          row["_timestamp"] / 1000,
          store.state.timezone,
          "yyyy-MM-dd HH:mm:ss.SSS",
        ),
      prop: (row: any) =>
        timestampToTimezoneDate(
          row["_timestamp"] / 1000,
          store.state.timezone,
          "yyyy-MM-dd HH:mm:ss.SSS",
        ),
      label: t("search.timestamp") + ` (${store.state.timezone})`,
      header: t("search.timestamp") + ` (${store.state.timezone})`,
      align: "left",
      sortable: true,
      enableResizing: false,
      meta: {
        closable: false,
        showWrap: false,
        wrapContent: true,
      },
      size: 260,
    },
    {
      name: "source",
      id: "source",
      accessorFn: (row: any) => JSON.stringify(row),
      cell: (info: any) => info.getValue(),
      header: "source",
      sortable: true,
      enableResizing: false,
      meta: {
        closable: false,
        showWrap: false,
        wrapContent: false,
      },
    },
  ];
});

const { t } = useI18n();

const triggerData = ref(props.trigger);

const tab = ref(props.query_type || "custom");

const query = ref(tab.value === "promql" ? props.promql : props.sql);

const promqlQuery = ref(props.promql);

const delayCondition = ref(props.delay);
const stream_type = ref(props.streamType || "logs");
const collapseFields = ref(false);



const store = useStore();

const functionEditorPlaceholderFlag = ref(true);

const queryEditorPlaceholderFlag = ref(true);
const pipelineEditorRef: any = ref(null);

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef: pipelineEditorRef,
    sqlMode: computed(() => tab.value === "sql"),
    query: computed(() => query.value ?? ""),
  });
const expandedLogs = ref<any[]>([]);
const cursorPosition = ref(-1);
const splitterModel = ref(30);
const step = ref(1);
const dateTime = ref({
  startTime: null,
  endTime: null,
  relativeTimePeriod: null,
  valueType: "absolute",
});
const streamFields: any = ref([]);
const previewPromqlQueryRef: any = ref(null);
const isHovered = ref(false);
const loading = ref(false);
const streamsLoading = ref(false);
// Flag to prevent the "stream changed → generate default query" watch from
// firing when the stream name is updated programmatically from the SQL text.
const isSyncingStreamFromQuery = ref(false);

const aiChatInputContext = ref("");
const aiChatAppendMode = ref(true);

const userDefinedFields = ref<any[]>([]);

// ─── Field value streaming & duration percentiles ────────────────────

const {
  fieldValues,
  fieldValuesFinalizedValues,
  fieldValuesCurrentSize,
  fetchFieldValues,
  cancelFieldStream,
  resetFieldValues,
} = useFieldValuesStream();

// ─── Query editor typewriter placeholder ─────────────────────────────
const isSqlMode = computed(() => tab.value === "sql");
const noStream = computed(() => !selectedStreamName.value);
const { placeholder: editorPlaceholder } = useQueryPlaceholder(
  streamFields,
  fieldValues,
  isSqlMode,
  noStream,
  { noStreamText: t("pipeline.queryEditorPlaceholder") },
);

// ─── Auto-suggestions (same composable as logs page) ─────────────────
const {
  autoCompleteData,
  effectiveKeywords,
  effectiveSuggestions,
  getSuggestions,
  updateFieldKeywords,
  updateStreamKeywords,
} = useSqlSuggestions();

const PERCENTILE_LABELS = [
  { key: "p25", label: "P25" },
  { key: "p50", label: "P50" },
  { key: "p75", label: "P75" },
  { key: "p95", label: "P95" },
  { key: "p99", label: "P99" },
  { key: "max", label: "Max" },
] as const;

const {
  percentiles: durationPercentiles,
  isLoading: durationPercentilesLoading,
  fetchPercentiles,
  cancelFetch: cancelPercentileFetch,
  errMsg: durationPercentileErrMsg,
} = useDurationPercentiles();

const hasDurationPercentiles = computed(() =>
  PERCENTILE_LABELS.some((p) => durationPercentiles.value[p.key] !== null),
);

const expandedRows: Ref<Record<string, boolean>> = ref({});
const expandedIds = ref<string[]>([]);
const currentSizePerField: Ref<Record<string, number>> = ref({});
const currentKeyword: Ref<Record<string, string>> = ref({});
const fieldValuesTimeRange: Ref<
  Record<string, { start_time: number; end_time: number }>
> = ref({});

const defaultValuesCount = computed(
  () => store.state.zoConfig?.query_values_default_num || 10,
);

const showFtsFieldValues = computed(
  () => store.state.zoConfig?.showFtsFieldValues ?? false,
);

const selectedStreamType = ref(props.streamType || "logs");

const tabOptions = computed(() => [
  {
    label: t("alerts.sql"),
    value: "sql",
    icon: "code",
  },
  {
    label: t("alerts.promql"),
    value: "promql",
    icon: "bar-chart",
    disabled: selectedStreamType.value !== "metrics",
    tooltipLabel:
      selectedStreamType.value !== "metrics"
        ? t("pipeline.promqlOnlyForMetrics")
        : "",
  },
]);

const filteredStreams = ref<any[]>([]);
const streams = ref([]);

// Add a loading state and track stream types that have been loaded
const loadedStreamTypes = ref(new Set());

watch(
  () => collapseFields.value,
  (val) => {
    if (val == true) {
      splitterModel.value = 0;
    }
  },
  {
    immediate: true,
    deep: true,
  },
);
watch(
  () => splitterModel.value,
  (val) => {
    if (val == 10) {
      splitterModel.value = 0;
    }
  },
);

watch(
  () => selectedStreamName.value,
  (val) => {
    if (searchObj?.data?.stream) {
      searchObj.data.stream.pipelineQueryStream = [val];
    }
  },
);

// Watch for stream name changes and auto-generate query.
// Skipped when the name change originated from parsing the SQL the user typed
// (isSyncingStreamFromQuery = true) to avoid overwriting their edits.
watch(
  () => selectedStreamName.value,
  (newStreamName, oldStreamName) => {
    if (isSyncingStreamFromQuery.value) return;
    if (newStreamName && oldStreamName && oldStreamName !== newStreamName) {
      // Stream changed via dropdown: generate a default query for the new stream
      if (tab.value === "sql") {
        query.value = `SELECT max(_timestamp) as _timestamp, count(_timestamp) as total_events\nFROM "${newStreamName}"\nGROUP BY histogram(_timestamp)`;
        updateQueryValue(query.value);
      } else if (tab.value === "promql") {
        query.value = `${newStreamName}{}`;
        updateQueryValue(query.value);
      }
    } else if (!oldStreamName && newStreamName) {
      // Initial stream selection: generate default query only when editor is empty
      if (tab.value === "sql" && !query.value.trim()) {
        query.value = `SELECT max(_timestamp) as _timestamp, count(_timestamp) as total_events\nFROM "${newStreamName}"\nGROUP BY histogram(_timestamp)`;
        updateQueryValue(query.value);
      } else if (tab.value === "promql" && !query.value.trim()) {
        query.value = `${newStreamName}{}`;
        updateQueryValue(query.value);
      }
    }
  },
);

// Keep auto-suggest field keywords in sync with the loaded stream fields
watch(
  () => streamFields.value,
  (fields) => {
    if (fields?.length) updateFieldKeywords(fields);
  },
  { immediate: true, deep: false },
);

watch(
  () => triggerData.value.frequency_type,
  (val) => {
    if (val == "minutes") {
      triggerData.value.period = Number(triggerData.value.frequency) || 15;
    } else {
      const periodValue = convertCronToMinutes(triggerData.value.cron);
      triggerData.value.period =
        periodValue > 0
          ? periodValue
          : Number(triggerData.value.frequency) || 15;
    }
  },
);

// Watch for stream name changes and update context provider
watch(selectedStreamName, (newStreamName) => {
  const contextProvider = createPipelinesContextProvider(
    pipelineObj,
    store,
    newStreamName,
    selectedStreamType.value,
    tab.value,
  );
  contextRegistry.register("pipelines", contextProvider);
});

// Watch for stream type changes and update context provider
watch(selectedStreamType, (newStreamType) => {
  const contextProvider = createPipelinesContextProvider(
    pipelineObj,
    store,
    selectedStreamName.value,
    newStreamType,
    tab.value,
  );
  contextRegistry.register("pipelines", contextProvider);
});

// Watch for query type changes and update context provider
watch(tab, (newTab) => {
  const contextProvider = createPipelinesContextProvider(
    pipelineObj,
    store,
    selectedStreamName.value,
    selectedStreamType.value,
    newTab,
  );
  contextRegistry.register("pipelines", contextProvider);
});

onBeforeMount(async () => {
  await importSqlParser();
});

onMounted(async () => {
  await getStreamList();

  // Initialize context provider for AI queries
  const contextProvider = createPipelinesContextProvider(
    pipelineObj,
    store,
    selectedStreamName.value,
    selectedStreamType.value,
    tab.value,
  );
  contextRegistry.register("pipelines", contextProvider);
  contextRegistry.setActive("pipelines");

  setTimeout(() => {
    if (tab.value === "sql" && query.value != "") {
      const parsedQuery = parser?.parse(query.value);
      selectedStreamName.value = parsedQuery?.ast.from[0].table;

      getStreamFields();
    } else if (tab.value === "promql" && query.value != "") {
      // Extract stream name from PromQL query
      // PromQL query format: stream_name{} or stream_name{label="value"}
      const match = query.value.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        selectedStreamName.value = match[1];
        getStreamFields();
      }
    }
  }, 200);

  registerAiContextHandler();
});

onBeforeUnmount(() => {
  removeAiContextHandler();
});

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

const filteredTimezone: any = ref([]);
const expandState = ref({
  output: false,
  query: true,
  buildQuery: true,
  setVariables: true,
});

const sideBarSplitterModel = ref(60);

watch(
  () => sideBarSplitterModel.value,
  (val) => {
    if (val == 10) {
      sideBarSplitterModel.value = 5;
    }
    if (val == 90) {
      sideBarSplitterModel.value = 95;
    }
  },
);
watch(
  () => expandState.value.output,
  (val) => {
    if (val == true) {
      expandState.value.query = false;
    }
  },
);
watch(
  () => expandState.value.query,
  (val) => {
    if (val == true) {
      expandState.value.output = false;
    }
  },
);
// The horizontal splitter splits the sidebar into "Build Query" (top) and
// "Set Variables" (bottom). Each pane carries the FullViewContainer header
// inside it, so the splitter must NEVER go all the way to 0 / 100 — otherwise
// the collapsed pane's header disappears and the user can't re-expand it.
// HEADER_PCT reserves just enough percentage for a single FullViewContainer
// row to remain visible.
const HEADER_PCT = 6;
watch(
  () => expandState.value.buildQuery,
  (val) => {
    if (val == false && expandState.value.setVariables == true) {
      sideBarSplitterModel.value = HEADER_PCT;
    } else if (val == false && expandState.value.setVariables == false) {
      sideBarSplitterModel.value = HEADER_PCT;
    } else if (val == true && expandState.value.setVariables == false) {
      sideBarSplitterModel.value = 100 - HEADER_PCT;
    } else {
      sideBarSplitterModel.value = 60;
    }
  },
);
watch(
  () => expandState.value.setVariables,
  (val) => {
    if (val == false && expandState.value.buildQuery == true) {
      sideBarSplitterModel.value = 100 - HEADER_PCT;
    } else if (val == false && expandState.value.buildQuery == false) {
      sideBarSplitterModel.value = HEADER_PCT;
    } else if (val == true && expandState.value.buildQuery == false) {
      sideBarSplitterModel.value = HEADER_PCT;
    } else {
      sideBarSplitterModel.value = 60;
    }
  },
);

watch(
  () => selectedStreamType.value,
  (val) => {
    if (val != "metrics") {
      tab.value = "sql";
    }
    selectedStreamName.value = "";
    streamFields.value = [];
    query.value = "";
    expandState.value.query = true;
    expandState.value.output = false;
    emits("update:stream_type", val);
  },
);

const metricFunctions = ["p50", "p75", "p90", "p95", "p99"];
const regularFunctions = ["avg", "max", "min", "sum", "count"];

const aggFunctions = computed(() =>
  props.alertData.stream_type === "metrics"
    ? [...regularFunctions, ...metricFunctions]
    : [...regularFunctions],
);

const _isAggregationEnabled = ref(
  tab.value === "custom" && props.isAggregationEnabled,
);

const promqlCondition = ref(props.promql_condition);

const aggregationData = ref(props.aggregation);

const filteredFields = ref(props.columns);
const groupByErrors = ref<Record<number, string>>({});

const getNumericColumns = computed(() => {
  if (
    _isAggregationEnabled.value &&
    aggregationData &&
    aggregationData.value.function === "count"
  )
    return props.columns;
  else
    return props.columns.filter((column: any) => {
      return column.type !== "Utf8";
    });
});

const cronJobError = ref("");
const cronTouched = ref(false);

const filteredNumericColumns = ref(getNumericColumns.value);

const currentTimezone =
  useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;

const browserTimezone = ref(currentTimezone);
const streamTypes = ["logs", "metrics", "traces"];

const rows = ref([]);

// @ts-ignore
let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
  return tz;
});

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

filteredTimezone.value = [...timezoneOptions];

const timezoneFilterFn = (val: string, update: Function) => {
  filteredTimezone.value = filterColumns(timezoneOptions, val, update);
};

const addField = () => {
  emits("field:add");
};

var triggerOperators: any = ref(["=", "!=", ">=", "<=", ">", "<"]);

const isCronMode = computed({
  get: () => triggerData.value.frequency_type === "cron",
  set: (val: boolean) => {
    triggerData.value.frequency_type = val ? "cron" : "minutes";
    if (!val) cronTouched.value = false;
  },
});

const selectedFunction = ref("");

const removeField = (field: any) => {
  emits("field:remove", field);
};

const updateQueryValue = (value: string) => {
  _sqlOnQueryChange();
  query.value = value;

  if (tab.value === "sql") emits("update:sql", value);
  if (tab.value === "promql") emits("update:promql", value);

  emits("input:update", "query", value);

  // Feed auto-suggest with the current query and context
  autoCompleteData.value.query = value;
  autoCompleteData.value.cursorIndex = pipelineEditorRef.value?.getCursorIndex() ?? -1;
  autoCompleteData.value.popup.open = pipelineEditorRef.value?.triggerAutoComplete;
  autoCompleteData.value.org = store.state.selectedOrganization.identifier;
  autoCompleteData.value.streamType = selectedStreamType.value;
  autoCompleteData.value.streamName = selectedStreamName.value;
  getSuggestions();

  // Sync stream name from SQL as user types
  if (tab.value === "sql") debouncedSyncStreamFromQuery(value);
};

// Debounced helper: read the FROM stream name from the SQL query the user is
// typing and sync it to the stream-name dropdown WITHOUT triggering the
// "stream changed → regenerate default query" watch.
const debouncedSyncStreamFromQuery = debounce(async (sql: string) => {
  if (!sql || !parser) return;
  try {
    const parsed = parser.parse(sql);
    const fromStream = parsed?.ast?.from?.[0]?.table as string | undefined;
    if (fromStream && fromStream !== selectedStreamName.value) {
      isSyncingStreamFromQuery.value = true;
      selectedStreamName.value = fromStream;
      await getStreamFields();
      isSyncingStreamFromQuery.value = false;
    }
  } catch {
    // ignore parse errors while user is mid-typing
  }
}, 600);

const updateTrigger = () => {
  emits("update:trigger", triggerData.value);
  emits("input:update", "period", triggerData.value);
};
const updateStreamType = () => {
  if (stream_type.value != "metrics") {
    tab.value = "sql";
  }
  emits("update:stream_type", stream_type.value);
};

const updateFrequency = async () => {
  cronJobError.value = "";

  validateFrequency();

  triggerData.value.period = Number(triggerData.value.frequency);

  emits("update:trigger", triggerData.value);
  emits("input:update", "period", triggerData.value);
};

function convertCronToMinutes(cronExpression: string) {
  cronJobError.value = "";
  // Parse the cron expression using cron-parser v5
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      utc: true,
    });
    // Get the first and second execution times
    const firstExecution = interval.next();
    const secondExecution = interval.next();

    // Calculate the difference in milliseconds
    const diffInMs = secondExecution.getTime() - firstExecution.getTime();

    // Convert milliseconds to minutes
    const diffInMinutes = diffInMs / (1000 * 60);

    return diffInMinutes;
  } catch (err) {
    cronJobError.value = t("pipeline.invalidCronExpression");
    return -1;
  }
}

const updateCron = () => {
  cronJobError.value = "";

  let minutes = 0;
  try {
    minutes = convertCronToMinutes(triggerData.value.cron);
    validateFrequency();

    if (minutes < 0) return;

    // Check if the number is a float by checking if the value has a decimal part
    if (minutes % 1 !== 0) {
      // If it's a float, fix it to 2 decimal places
      minutes = Number(minutes.toFixed(2));
    } else {
      // If it's an integer, return it as is
      minutes = Number(minutes.toString());
    }
  } catch (err) {
    console.log(err);
    return;
  }

  triggerData.value.period = minutes;

  emits("update:trigger", triggerData.value);
  emits("input:update", "period", triggerData.value);
};

const updateTab = () => {
  updateQuery();
  updateAggregationToggle();
  emits("update:query_type", tab.value);
  emits("input:update", "query_type", tab.value);
};

const onFunctionSelect = (_function: any) => {
  selectedFunction.value = _function.name;
  vrlFunctionContent.value = _function.function;
};

const functionsList = computed(() => store.state.organizationData.functions);

const functionOptions = ref<any[]>([]);

watch(
  () => functionsList.value,
  (functions: any[]) => {
    functionOptions.value = [...functions];
  },
);

const vrlFunctionContent = computed({
  get() {
    return props.vrl_function;
  },
  set(value) {
    emits("update:vrl_function", value);
  },
});

const isVrlFunctionEnabled = computed({
  get() {
    return props.showVrlFunction;
  },
  set(value) {
    emits("update:showVrlFunction", value);
  },
});

const updateQuery = () => {
  if (tab.value === "promql") {
    query.value = `${selectedStreamName.value}{}`;
  }

  if (tab.value === "sql") query.value = props.sql;
};

const updatePromqlCondition = () => {
  emits("update:promql_condition", promqlCondition.value);
  emits("input:update", "promql_condition", promqlCondition.value);
};

const addGroupByColumn = () => {
  const aggregationDataCopy = { ...aggregationData.value };
  aggregationDataCopy.group_by.push("");
  emits("update:aggregation", aggregationDataCopy);
  emits("input:update", "aggregation", aggregationDataCopy);
};

const deleteGroupByColumn = (index: number) => {
  const aggregationDataCopy = { ...aggregationData.value };
  aggregationDataCopy.group_by.splice(index, 1);
  emits("update:aggregation", aggregationDataCopy);
  emits("input:update", "aggregation", aggregationDataCopy);
};

const updateAggregation = () => {
  if (!props.aggregation) {
    aggregationData.value = {
      group_by: [""],
      function: "avg",
      having: {
        column: "",
        operator: "=",
        value: "",
      },
    };
  }
  emits("update:aggregation", aggregationData.value);
  emits("update:isAggregationEnabled", _isAggregationEnabled.value);
  emits("input:update", "aggregation", aggregationData.value);
};

const filterFields = (val: string, update: Function) => {
  filteredFields.value = filterColumns(props.columns, val, update);
};

const filterColumns = (options: string[], val: string, update: Function) => {
  let filteredOptions: any[] = [];

  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
  }

  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter((column: any) => {
      // Check if type of column is object or string and then filter
      if (typeof column === "object") {
        return column.value.toLowerCase().indexOf(value) > -1;
      }

      if (typeof column === "string") {
        return column.toLowerCase().indexOf(value) > -1;
      }
    });
  });

  return filteredOptions;
};

const filterNumericColumns = (val: string, update: Function) => {
  if (val === "") {
    update(() => {
      filteredNumericColumns.value = [...getNumericColumns.value];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredNumericColumns.value = getNumericColumns.value.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1,
    );
  });
};

const updateAggregationToggle = () => {
  _isAggregationEnabled.value =
    tab.value === "custom" && props.isAggregationEnabled;
};

const filterFunctionOptions = (val: string, update: any) => {
  update(() => {
    functionOptions.value = functionsList.value.filter((fn: any) => {
      return fn.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
    });
  });
};

const onBlurQueryEditor = debounce(async () => {
  queryEditorPlaceholderFlag.value = true;
  await _sqlOnBlur();
  emits("validate-sql");
}, 10);

const validateInputs = (notify: boolean = true) => {
  validateFrequency();

  if (cronJobError.value) {
    notify &&
      toast({
        variant: "error",
        message: cronJobError.value,
      });
    return false;
  }

  if (
    Number(triggerData.value.period) < 1 ||
    isNaN(Number(triggerData.value.period))
  ) {
    notify &&
      toast({
        variant: "error",
        message: "Period should be greater than 0",
        timeout: 1500,
      });
    return false;
  }

  if (aggregationData.value) {
    if (
      !props.disableThreshold &&
      (isNaN(triggerData.value.threshold) ||
        !aggregationData.value.having.value.toString().trim().length ||
        !aggregationData.value.having.column ||
        !aggregationData.value.having.operator)
    ) {
      notify &&
        toast({
          variant: "error",
          message: t("pipeline.thresholdShouldNotBeEmpty"),
          timeout: 1500,
        });
      return false;
    }

    return true;
  }

  if (
    !props.disableThreshold &&
    (isNaN(triggerData.value.threshold) ||
      triggerData.value.threshold < 1 ||
      !triggerData.value.operator)
  ) {
    notify &&
      toast({
        variant: "error",
        message: t("pipeline.thresholdShouldNotBeEmpty"),
        timeout: 1500,
      });
    return false;
  }

  return true;
};

const validateFrequency = () => {
  if (triggerData.value.frequency_type === "cron") {
    try {
      const intervalInSecs = getCronIntervalDifferenceInSeconds(
        triggerData.value.cron,
      );

      if (
        typeof intervalInSecs === "number" &&
        !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
      ) {
        const minInterval =
          Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
        cronJobError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
        return;
      }
    } catch (err) {
      cronJobError.value = t("pipeline.invalidCronExpression");
    }
  }

  if (triggerData.value.frequency_type === "minutes") {
    const intervalInMins = Math.ceil(
      store.state?.zoConfig?.min_auto_refresh_interval / 60,
    );

    if (triggerData.value.frequency < intervalInMins) {
      cronJobError.value =
        "Minimum frequency should be " + intervalInMins + " minutes";
      return;
    }
  }
};
const collapseFieldList = () => {
  splitterModel.value = collapseFields.value ? 30 : 0;
  collapseFields.value = !collapseFields.value;
};

const getStreamFields = () => {
  return new Promise((resolve) => {
    getStream(selectedStreamName.value, selectedStreamType.value, true)
      .then(async (stream: any) => {
        streamFields.value = [];
        userDefinedFields.value = [];
        const ftsKeys: string[] = stream.settings?.full_text_search_keys || [];
        const timestampColumn: string = store.state.zoConfig.timestamp_column;
        stream.schema?.forEach((field: any) => {
          streamFields.value.push({
            ...field,
            dataType: field.type,
            isSchemaField: true,
            showValues: field.name !== timestampColumn,
            ftsKey: ftsKeys.includes(field.name),
          });
        });
        stream.uds_schema?.forEach((field: any) => {
          userDefinedFields.value.push({
            ...field,
          });
        });

        // Apply field grouping (same as logs/traces)
        try {
          const isEnterprise =
            config.isEnterprise === "true" || config.isCloud === "true";
          const [semanticAliases, keyFieldsConfig, fieldGrouping] =
            await Promise.all([
              isEnterprise ? loadSemanticGroups() : Promise.resolve([]),
              loadKeyFields(),
              loadFieldGrouping(),
            ]);
          const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
            ? (fieldGrouping as FieldGroupingConfig)
            : null;
          const semanticIndex =
            semanticAliases.length > 0
              ? buildSemanticIndex(semanticAliases, grouping)
              : null;
          const keySpec = (keyFieldsConfig as KeyFieldsConfig)[
            selectedStreamType.value
          ] ?? { fields: [], groups: [] };
          const keyFieldSet = new Set(
            keySpec.fields.map((f: string) => f.toLowerCase()),
          );
          const keyGroupSet = new Set(
            keySpec.groups.map((g: string) => g.toLowerCase()),
          );

          streamFields.value = applyFieldGrouping(
            streamFields.value as FieldObj[],
            semanticIndex,
            keyFieldSet,
            keyGroupSet,
          );
        } catch (groupErr) {
          console.warn(
            "Field grouping failed for pipeline, using flat list",
            groupErr,
          );
        }
      })
      .finally(() => {
        // Note: Default query generation removed
        // Query is now cleared when stream changes (see watch on selectedStreamName)
        // Initial query generation happens in onMounted
        expandState.value.query = true;
        expandState.value.output = false;
        resolve(true);
      });
  });
};

// ─── Field value helpers (moved from sidebar/FieldList) ──────────────

const buildSql = (streamName: string, whereClause?: string) =>
  b64EncodeUnicode(
    `SELECT * FROM "${streamName}"${whereClause ? ` WHERE ${whereClause}` : ""}`,
  ) || "";

function isFieldExpandable(row: any) {
  if (row.isGroup || row.label) return false;
  if (row.ftsKey && !showFtsFieldValues.value) return false;
  if (!row.showValues) return false;
  return true;
}

// Default to last 15 min when dateTime hasn't been set yet (mount-order race
// with the parent's DateTime component — see Query.vue).
const getEffectiveTimeRange = () => {
  const now = Date.now() * 1000;
  return {
    start_time: dateTime.value.startTime ?? (now - 900_000_000),
    end_time: dateTime.value.endTime ?? now,
  };
};

function openFilterCreator({ name, ftsKey, stream_name }: any) {
  if (ftsKey && !showFtsFieldValues.value) return;

  expandedRows.value[name] = true;
  expandedIds.value = [name];

  // Duration field in traces — fetch percentiles instead of regular values
  if (name === "duration" && selectedStreamType.value === "traces") {
    cancelPercentileFetch();
    const { start_time, end_time } = getEffectiveTimeRange();
    fetchPercentiles({
      streamName: stream_name || selectedStreamName.value,
      startTime: start_time,
      endTime: end_time,
      whereClause: "",
    });
    return;
  }

  cancelFieldStream(name);
  currentSizePerField.value[name] = defaultValuesCount.value;
  currentKeyword.value[name] = "";
  const { start_time, end_time } = getEffectiveTimeRange();
  fieldValuesTimeRange.value[name] = { start_time, end_time };
  resetFieldValues(name, true);

  const resolvedStream = stream_name || selectedStreamName.value;
  fieldValuesCurrentSize.value[name] = defaultValuesCount.value;

  fetchFieldValues({
    fields: [name],
    size: defaultValuesCount.value,
    no_count: false,
    start_time,
    end_time,
    stream_name: resolvedStream,
    stream_type: selectedStreamType.value,
    sql: buildSql(resolvedStream),
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
}

function closeField(fieldName: string) {
  if (fieldName === "duration" && selectedStreamType.value === "traces") {
    cancelPercentileFetch();
  } else {
    cancelFieldStream(fieldName);
    currentSizePerField.value[fieldName] = 0;
    currentKeyword.value[fieldName] = "";
    delete fieldValuesTimeRange.value[fieldName];
    resetFieldValues(fieldName);
  }
  expandedRows.value[fieldName] = false;
  expandedIds.value = expandedIds.value.filter((id) => id !== fieldName);
}

function onFieldRowClick(row: any) {
  if (!isFieldExpandable(row)) return;
  const currentlyExpanded = expandedRows.value[row.name];
  if (currentlyExpanded) {
    closeField(row.name);
  } else {
    openFilterCreator(row);
  }
}

const handleSearchFieldValues = (fieldName: string, term: string) => {
  const row: any = (streamFields.value as any[]).find(
    (f: any) => f.name === fieldName,
  );
  const resolvedStream = row?.stream_name || selectedStreamName.value;
  currentKeyword.value[fieldName] = term;
  currentSizePerField.value[fieldName] = defaultValuesCount.value;
  fieldValuesCurrentSize.value[fieldName] = defaultValuesCount.value;
  delete fieldValuesFinalizedValues.value[fieldName];
  cancelFieldStream(fieldName);
  resetFieldValues(fieldName, true);

  const pinnedTime = fieldValuesTimeRange.value[fieldName];
  const effective = getEffectiveTimeRange();
  fetchFieldValues({
    fields: [fieldName],
    size: defaultValuesCount.value,
    no_count: false,
    start_time: pinnedTime?.start_time ?? effective.start_time,
    end_time: pinnedTime?.end_time ?? effective.end_time,
    stream_name: resolvedStream,
    stream_type: selectedStreamType.value,
    sql: buildSql(resolvedStream),
    keyword: term || undefined,
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
};

const handleLoadMoreValues = (fieldName: string) => {
  const row: any = (streamFields.value as any[]).find(
    (f: any) => f.name === fieldName,
  );
  const resolvedStream = row?.stream_name || selectedStreamName.value;
  const newSize =
    (currentSizePerField.value[fieldName] ?? defaultValuesCount.value) +
    defaultValuesCount.value;
  currentSizePerField.value[fieldName] = newSize;
  fieldValuesCurrentSize.value[fieldName] = newSize;
  fieldValuesFinalizedValues.value[fieldName] = [
    ...(fieldValues.value[fieldName]?.values || []),
  ];

  const pinnedTime = fieldValuesTimeRange.value[fieldName];
  const effective2 = getEffectiveTimeRange();
  fetchFieldValues({
    fields: [fieldName],
    size: newSize,
    no_count: false,
    start_time: pinnedTime?.start_time ?? effective2.start_time,
    end_time: pinnedTime?.end_time ?? effective2.end_time,
    stream_name: resolvedStream,
    stream_type: selectedStreamType.value,
    sql: buildSql(resolvedStream),
    keyword: currentKeyword.value[fieldName] || undefined,
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
};

const isNullValue = (v: string) =>
  v === null || v === undefined || v === "" || v.toLowerCase() === "null";

const buildExpression = (fieldName: string, v: string, action: string) =>
  isNullValue(v)
    ? action === "include"
      ? `${fieldName} IS NULL`
      : `${fieldName} IS NOT NULL`
    : action === "include"
      ? `${fieldName}='${v}'`
      : `${fieldName}!='${v}'`;

const handleAddSearchTerm = (
  fieldName: string,
  value: string,
  action: string,
) => {
  handleSidebarEvent("add-field", buildExpression(fieldName, value, action));
};

const handleAddMultipleSearchTerms = (
  fieldName: string,
  values: string[],
  action: string,
) => {
  const joinOp = action === "include" ? " or " : " and ";
  const expressions = values.map((v) => buildExpression(fieldName, v, action));
  handleSidebarEvent(
    "add-field",
    expressions.length > 1 ? `(${expressions.join(joinOp)})` : expressions[0],
  );
};

const addFieldSearchTerm = (term: string) => {
  handleSidebarEvent("add-field", term);
};

const filterStreams = (val: string, update: any) => {
  update(() => {
    if (!val || val === "") {
      // If value is empty, show all streams
      filteredStreams.value = streams.value.map((stream: any) => ({
        label: stream.name,
        value: stream.name,
      }));
      // Only fetch if we haven't loaded this stream type yet
      if (
        !loadedStreamTypes.value.has(selectedStreamType.value) &&
        !streamsLoading.value
      ) {
        getStreamList();
      }
    } else {
      // Filter existing streams based on the search value
      filteredStreams.value = streams.value
        .map((stream: any) => ({
          label: stream.name,
          value: stream.name,
        }))
        .filter((stream: any) => {
          return stream.label.toLowerCase().indexOf(val.toLowerCase()) > -1;
        });
    }
  });
};

// Modify getStreamList to store the full list
async function getStreamList() {
  if (streamsLoading.value) return;
  streamsLoading.value = true;

  try {
    const res: any = await getStreams(selectedStreamType.value, false);
    streams.value = res.list || [];
    // Set filtered streams to show all streams initially
    filteredStreams.value = streams.value.map((stream: any) => ({
      label: stream.name,
      value: stream.name,
    }));
    // Update stream keywords for auto-suggest FROM clause
    updateStreamKeywords(streams.value.map((s: any) => ({ name: s.name })));
    // Mark this stream type as loaded
    loadedStreamTypes.value.add(selectedStreamType.value);
  } catch (err) {
    console.log(err);
    streams.value = [];
    filteredStreams.value = [];
  } finally {
    streamsLoading.value = false;
  }
}

// Reload streams whenever the stream type changes
watch(
  () => selectedStreamType.value,
  () => {
    streams.value = [];
    filteredStreams.value = [];
    loadedStreamTypes.value.delete(selectedStreamType.value);
    getStreamList();
  },
);

const SQL_FILTER_TERMINATING_CLAUSES = [
  "group by",
  "having",
  "order by",
  "limit",
];

const getFirstSqlTerminatingClause = (sql: string): string | null => {
  const lowerSql = sql.toLowerCase();
  let firstClause: string | null = null;
  let firstIndex = Infinity;

  SQL_FILTER_TERMINATING_CLAUSES.forEach((clause) => {
    const index = lowerSql.indexOf(clause);
    if (index !== -1 && index < firstIndex) {
      firstIndex = index;
      firstClause = sql.slice(index, index + clause.length);
    }
  });

  return firstClause;
};

const normalizeFilterValue = (filter: string) => {
  const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";

  if (!isFilterValueNull) return filter;

  return filter
    .replace(/=|!=/, (match) => (match === "=" ? " is " : " is not "))
    .replace(/'null'/, "null");
};

const insertSqlFilter = (sql: string, filterValue: string) => {
  const filter = normalizeFilterValue(filterValue);
  const query = sql.trimEnd().replace(/;$/, "").trimEnd();

  if (!query) return filter;

  if (/\bwhere\b/i.test(query)) {
    const fieldName = getFieldFromExpression(filter);

    if (fieldName && hasFieldCondition(query, fieldName)) {
      return replaceExistingFieldCondition(query, fieldName, filter);
    }

    const firstClause = getFirstSqlTerminatingClause(query);
    if (firstClause) {
      const [beforeClause, afterClause] = queryIndexSplit(query, firstClause);
      return `${beforeClause.trim()} AND ${filter} ${firstClause}${afterClause}`;
    }

    return `${query} AND ${filter}`;
  }

  const firstClause = getFirstSqlTerminatingClause(query);
  if (firstClause) {
    const [beforeClause, afterClause] = queryIndexSplit(query, firstClause);
    return `${beforeClause.trim()} where ${filter} ${firstClause}${afterClause}`;
  }

  return `${query} where ${filter}`;
};

const removeSqlFieldFilter = (sql: string, fieldName: string) => {
  const whereMatch = sql.match(/\bwhere\b/i);

  if (whereMatch?.index == null) return sql;

  const whereIndex = whereMatch.index;
  const beforeWhere = sql.slice(0, whereIndex).trimEnd();
  const afterWhereStart = whereIndex + whereMatch[0].length;
  const afterWhere = sql.slice(afterWhereStart);
  const firstClause = getFirstSqlTerminatingClause(afterWhere);

  let whereClause = afterWhere;
  let trailingClause = "";

  if (firstClause) {
    const [beforeClause, afterClause] = queryIndexSplit(afterWhere, firstClause);
    whereClause = beforeClause;
    trailingClause = `${firstClause}${afterClause}`;
  }

  const nextWhereClause = removeFieldCondition(whereClause, fieldName).trim();
  const nextSql = nextWhereClause
    ? `${beforeWhere} WHERE ${nextWhereClause}`
    : beforeWhere;

  return trailingClause.trim()
    ? `${nextSql} ${trailingClause.trim()}`
    : nextSql;
};

const handleSidebarEvent = (event: string, value: any) => {
  if (pipelineEditorRef.value) {
    const currentQuery: string = pipelineEditorRef.value.getValue() ?? "";

    if (event === "remove-field") {
      const newQuery =
        tab.value === "sql"
          ? removeSqlFieldFilter(currentQuery, value)
          : removeFieldCondition(currentQuery, value);
      pipelineEditorRef.value.setValue(newQuery);
      updateQueryValue(newQuery);
      cursorPosition.value = newQuery.length - 1;
      return;
    }

    // For include/exclude expressions in SQL mode, append with WHERE / AND so the
    // resulting query stays syntactically valid.
    if (tab.value === "sql" && !value.endsWith("=''")) {
      const newQuery = insertSqlFilter(currentQuery, value);
      pipelineEditorRef.value.setValue(newQuery);
      updateQueryValue(newQuery);
      cursorPosition.value = newQuery.length - 1;
      return;
    }

    // For bare field names (add button) or non-SQL modes: insert at cursor.
    const insertValue = value.endsWith("=''")
      ? value.split("=")[0].trim()
      : value;
    const valueToInsert = ` ${insertValue} `;
    let cursorIndex = pipelineEditorRef.value?.getCursorIndex();
    if (cursorIndex != -1) {
      cursorPosition.value = cursorIndex;
    } else if (cursorIndex == -1 && cursorPosition.value == -1) {
      cursorPosition.value = currentQuery.length;
    }

    // Insert at cursor position
    const newQuery =
      currentQuery.slice(0, cursorPosition.value + 1) +
      valueToInsert +
      currentQuery.slice(cursorPosition.value + 1);
    if (cursorPosition.value != -1) {
      cursorPosition.value += valueToInsert.length;
    }

    // Set the new value
    pipelineEditorRef.value.setValue(newQuery);
    updateQueryValue(newQuery);
  } else {
    console.log("Could not find editor instance");
  }
};
const updateDateChange = (date: any) => {
  if (JSON.stringify(date) === JSON.stringify(dateTime.value)) return;
  dateTime.value = {
    startTime: date.startTime,
    endTime: date.endTime,
    relativeTimePeriod: date.relativeTimePeriod,
    valueType: date.relativeTimePeriod ? "relative" : "absolute",
  };
};

const runQuery = async () => {
  notificationMsgValue.value = "";
  //check if datetime is present or not
  //else show the error message
  if (!dateTime.value.startTime) {
    notificationMsgValue.value =
      "The selected start time is  invalid. Please choose a valid time.";
    return null;
  }
  if (!dateTime.value.endTime) {
    notificationMsgValue.value =
      "The selected end time is  invalid. Please choose a valid time.";
    return null;
  }
  if (tab.value == "sql") {
    loading.value = true;

    const queryReq = {
      sql: query.value,
      start_time: dateTime.value.startTime,
      end_time: dateTime.value.endTime,
      from: 0,
      size: 10,
    };
    searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: { query: queryReq },
          page_type: selectedStreamType.value,
          validate: true,
        },
        "ui",
      )
      .then((res: any) => {
        if (res.data.hits.length > 0) {
          rows.value = res.data.hits;
        } else {
          rows.value = [];
        }
      })
      .catch((err: any) => {
        if (err.response?.data) {
          notificationMsgValue.value =
            err.response?.data?.message || err.response?.data;
        } else {
          notificationMsgValue.value = t("pipeline.errorGettingResults");
        }
      })
      .finally(() => {
        loading.value = false;
      });
  } else if (tab.value == "promql") {
    // Wait for next tick to ensure PreviewPromqlQuery component is mounted
    await nextTick();
    if (previewPromqlQueryRef.value) {
      previewPromqlQueryRef.value.refreshData();
    }
  }
};

const isFullscreen = ref(false);

const handleFullScreen = () => {
  toggleFullscreen();
  isFullscreen.value = !isFullscreen.value;
};

const updateFullscreenStatus = () => {
  const active = !!document.fullscreenElement;
  isFullscreen.value = active;
  emits("update:fullscreen", active);
};

onMounted(() => {
  document.addEventListener("fullscreenchange", updateFullscreenStatus);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", updateFullscreenStatus);
});

const focusQueryEditor = () => {
  queryEditorPlaceholderFlag.value = false;
};

const expandLog = (index: any) => {
  if (expandedLogs.value.includes(index))
    expandedLogs.value = expandedLogs.value.filter((item) => item != index);
  else expandedLogs.value.push(index);
};
const copyLogToClipboard = (log: any, copyAsJson: boolean = true) => {
  const copyData = copyAsJson ? JSON.stringify(log) : log;
  copyToClipboard(copyData, {
    successMessage: "Content Copied Successfully!",
    timeout: 1000,
  });
};

const updateDelay = (val: any) => {
  emits("update:delay", val);
};

const toggleAIChat = () => {
  const isEnabled = !store.state.isAiChatEnabled;
  store.dispatch("setIsAiChatEnabled", isEnabled);
};

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL("images/common/ai_icon_dark.svg");
  }

  return store.state.theme === "dark"
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});

// [START] O2 AI Context Handler

const registerAiContextHandler = () => {
  registerAiChatHandler(getContext);
};

const getContext = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const payload: any = {};

      if (!selectedStreamType.value || !selectedStreamName.value) {
        resolve("");
        return;
      }

      const schema = streamFields.value.map((field: any) => {
        return {
          name: field.name,
          type: field.type,
        };
      });

      //if uds is enabled we need to push the timestamp and all fields name in the schema
      const hasTimestampColumn = userDefinedFields.value.some(
        (field: any) => field.name === store.state.zoConfig.timestamp_column,
      );
      const hasAllFieldsName = userDefinedFields.value.some(
        (field: any) => field.name === store.state.zoConfig.all_fields_name,
      );
      if (userDefinedFields.value.length > 0) {
        if (!hasTimestampColumn) {
          userDefinedFields.value.push({
            name: store.state.zoConfig.timestamp_column,
            type: "Int64",
          });
        }
        if (!hasAllFieldsName) {
          userDefinedFields.value.push({
            name: store.state.zoConfig.all_fields_name,
            type: "Utf8",
          });
        }
      }

      payload["stream_name"] = selectedStreamName.value;
      payload["schema_"] =
        userDefinedFields.value.length > 0 ? userDefinedFields.value : schema;

      resolve(payload);
    } catch (error) {
      console.error("Error in getContext for logs page", error);
      resolve("");
    }
  });
};

const removeAiContextHandler = () => {
  removeAiChatHandler();
};

// [END] O2 AI Context Handler

const sendToAiChat = (value: any, append: boolean = true) => {
  aiChatAppendMode.value = append;
  aiChatInputContext.value = value;
  store.dispatch("setIsAiChatEnabled", true);

  // Clear context after setting to prevent accumulation
  nextTick(() => {
    aiChatInputContext.value = "";
  });
};

defineExpose({
  tab,
  tabOptions,
  validateInputs,
  pipelineEditorRef,
  pipelineObj,
  step,
  splitterModel,
  collapseFieldList,
  collapseFields,
  expandState,
  streamFields,
  getStreamFields,
  selectedStreamName,
  streamOptions,
  filteredStreams,
  streams,
  selectedStreamType,
  handleSidebarEvent,
  dateTime,
  updateDateChange,
  updateTab,
  runQuery,
  getColumns,
  rows,
  sideBarSplitterModel,
  previewPromqlQueryRef,
  cursorPosition,
  focusQueryEditor,
  expandedLogs,
  copyLogToClipboard,
  copyToClipboard,
  updateDelay,
  delayCondition,
  toggleAIChat,
  isHovered,
  getBtnLogo,
  isFullscreen,
  handleFullScreen,
  sendToAiChat,
  aiChatInputContext,
  aiChatAppendMode,
  effectiveKeywords,
  effectiveSuggestions,
  streamsLoading,
});
</script>

<style lang="scss" scoped>
.scheduled-pipeline-tabs {
  padding: 0px !important;
  height: 28px !important;
  border: 1px solid $primary;
  width: 200px;
  border-radius: 4px;
  overflow: hidden;
}

.scheduled-pipeline-footer {
  border-top: 1px solid var(--o2-border-color);
}

.query-editor-placeholder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  padding: 0.1875rem 0.5rem 0 2.15rem;
  pointer-events: none;
  z-index: 1;
  user-select: none;

  .query-editor-placeholder-typewriter {
    font-family: monospace;
    font-size: var(--text-base);
    line-height: 1.3125rem;
    color: #a0aec0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.body--dark .query-editor-placeholder-overlay {
  .query-editor-placeholder-typewriter {
    color: #718096;
  }
}

// Collapsed sidebar bar (mirrors PanelEditor pattern)
.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 8px;
  gap: 6px;
  flex-shrink: 0;
}

.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
  font-size: 12px;
}
</style>
<style lang="scss">
.scheduled-pipeline-container {
  height: 100%;
  .o-splitter__before {
    overflow: hidden;
  }
  .o-splitter__after {
    overflow: hidden;
  }

  // Propagate 100% height through every level of the FieldList component so the
  // q-table fills its flex container and can scroll internally instead of
  // overflowing the splitter pane with the traces-page viewport calculation.
  .pipeline-field-list-wrapper {
    .index-menu,
    .index-table {
      height: 100%;
    }

    .traces-field-table {
      height: 100% !important;
    }
  }

  .q-table__control {
    width: 100%;
  }
  .q-table__top {
    padding: 0px !important;
  }
  .scheduled-pipeline-tabs {
    padding: 0px !important;

    .q-tab--active {
      background-color: $primary;
      color: $white;
    }

    .q-tab__indicator {
      display: none;
    }

    .q-tab {
      min-height: 28px;
      height: 32px;
    }
  }
  .scheduled-pipelines {
    .monaco-editor {
      width: 100%;
    }
    .query-editor-container {
      width: 100% !important;
    }

    .q-btn {
      &.icon-dark {
        filter: none !important;
      }
    }
  }
  .field-list-collapse-btn {
    z-index: 11;
    position: absolute;
    top: -6px !important;
    font-size: 12px !important;
  }
  .stream-routing-title {
    font-size: 18px;
    padding-top: 12px;
  }
}

.search-button-pipeline {
  height: 32px !important;
  min-width: 77px;
  line-height: 29px;
  font-weight: bold;
  text-transform: initial;
  font-size: 11px;
  color: white;

  .q-btn__content {
    background: $secondary;
    border-radius: 3px 3px 3px 3px;
    padding: 0px 5px;
}
}
.o2-custom-splitter {
  > .o-splitter__separator {
    width: 0.625rem; // 10px
    z-index: 999 !important;
    height: 100%;
    background: transparent;
  }
}
</style>
