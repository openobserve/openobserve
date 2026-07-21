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
  <div class="w-full h-full scheduled-pipeline-container">
    <!-- <OSeparator /> -->

    <div class="mb-2 stepper-header w-full flex h-full">
      <div
        :class="store.state.isAiChatEnabled ? 'w-[75%]' : 'w-full'"
        class="flex"
        style="height: 100% !important;"
      >
        <!-- Collapsed field list bar (shown when hidden) -->
        <div
          v-if="collapseFields"
          class="bg-surface-panel! shrink-0 cursor-pointer flex flex-col items-center justify-start pt-2 gap-1.5 h-full"
          style="width: 50px"
          data-test="scheduled-pipeline-field-list-collapsed-bar"
          @click="collapseFieldList"
        >
          <OIcon name="expand-all" size="sm" class="rotate-90 mt-2.5 text-xl" />
          <div class="[writing-mode:vertical-rl] [text-orientation:mixed] font-bold text-xs">{{ t("pipeline.buildQuery") }}</div>
        </div>

        <OSplitter
          v-model="splitterModel"
          :style="{ width: collapseFields ? 'calc(100% - 50px)' : '100%' }"
          class="o2-custom-splitter"
        >
          <template #before>
            <div class="flex flex-col h-full">
            <!-- Left panel header with collapse button -->
            <div class="flex items-center justify-between shrink-0 px-2 py-1.5 border-b border-border-default bg-surface-panel">
              <span class="font-semibold text-sm">{{ t("pipeline.buildQuery") }}</span>
              <OButton
                variant="outline"
                size="icon-xs-sq"
                class="rotate-90"
                icon-left="unfold-less"
                :title="t('search.collapseFields')"
                data-test="scheduled-pipeline-collapse-btn"
                @click="collapseFieldList"
              />
            </div>
            <div class="pl-2 flex flex-col flex-1 min-h-0">
            <div
              class="flex-1 min-h-0 w-full overflow-y-auto"
            >
                <!-- fieldlist section -->
                <div
                  class="flex flex-col overflow-hidden"
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
                    class="flex flex-col pt-2"
                  >
                    <div class="shrink-0">
                      <OFormSelect
                        name="stream_type"
                        :options="streamTypes"
                        :label="t('alerts.streamType')"
                        required
                        class="no-case w-full mb-1"
                        data-test="scheduled-pipeline-stream-type-select"
                      />

                      <OFormSelect
                        name="stream_name"
                        :options="filteredStreams"
                        labelKey="label"
                        valueKey="value"
                        :label="t('alerts.stream_name')"
                        :placeholder="t('pipeline.selectStream')"
                        :loading="streamsLoading"
                        class="my-1 no-case w-full"
                        data-test="scheduled-pipeline-stream-name-select"
                        @open="getStreamList"
                      />
                    </div>

                    <!-- FieldList scrolls within a capped height -->
                    <div
                      style="max-height: 40vh;"
                      class="pipeline-field-list-wrapper overflow-y-auto"
                    >
                      <GroupedFieldList
                        :fields="streamFields"
                        :theme="store.state.theme"
                        :show-pagination="false"
                        :page-size="50"
                        search-class="px-0!"
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
                                    class="flex justify-center py-2"
                                  >
                                    <OSpinner size="xs" />
                                  </div>
                                  <template v-else-if="hasDurationPercentiles">
                                    <div
                                      v-for="p in PERCENTILE_LABELS"
                                      :key="p.key"
                                      class="flex items-center justify-between py-[0.15rem] pl-2"
                                    >
                                      <span class="text-2xs w-8 shrink-0">{{ p.label }}</span>
                                      <span class="text-2xs flex-1 text-right pr-1">
                                        {{ formatPercentile(durationPercentiles[p.key]) }}
                                      </span>
                                      <div class="flex w-[2.7rem]">
                                        <OButton
                                          v-if="p.key !== 'max'"
                                          variant="ghost"
                                          size="icon-xs-circle"
                                          :title="`duration >= ${formatPercentile(durationPercentiles[p.key])}`"
                                          @click.stop="addFieldSearchTerm(`duration>='${formatPercentile(durationPercentiles[p.key])}'`)"
                                          class="ml-0.5! border! border-card-glass-border!"
                                        >
                                          <OIcon name="arrow-forward-ios" size="sm" class="h-[0.4rem]! w-[0.4rem]!" />
                                        </OButton>
                                        <OButton
                                          variant="ghost"
                                          size="icon-xs-circle"
                                          :title="`duration <= ${formatPercentile(durationPercentiles[p.key])}`"
                                          @click.stop="addFieldSearchTerm(`duration<='${formatPercentile(durationPercentiles[p.key])}'`)"
                                          class="ml-auto! mr-2! border! border-card-glass-border!"
                                        >
                                          <OIcon name="arrow-back-ios" size="sm" class="h-[0.4rem]! w-[0.4rem]!" />
                                        </OButton>
                                      </div>
                                    </div>
                                  </template>
                                  <div v-else class="pl-2 py-1 text-2xs text-text-secondary">
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
                    class="mt-1"
                  />
                </span>
                <div
                  v-show="expandState.setVariables"
                  class="flex flex-col pt-2"
                >
                  <div class="flex flex-col gap-4 w-full">
                    <div
                      v-if="
                        selectedStreamType === 'metrics' &&
                        tab === 'promql' &&
                        promqlCondition
                      "
                      class="flex items-center gap-2"
                    >
                      <div
                        class="font-bold flex items-center gap-1 w-40 shrink-0"
                      >
                        <span>{{ t("pipeline.trigger") }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="cursor-pointer text-icon-color"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="text-sm">
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
                      <OFormSelect
                        name="query_condition.promql_condition.operator"
                        :options="triggerOperators"
                        :searchable="false"
                        width="xs"
                        class="no-case"
                        data-test="scheduled-pipeline-promlq-condition-operator-select"
                      />
                      <OFormInput
                        name="query_condition.promql_condition.value"
                        type="number"
                        :min="0"
                        :placeholder="t('pipeline.value')"
                        width="xs"
                        data-test="scheduled-pipeline-promlq-condition-value"
                      />
                    </div>
                    <div
                      v-if="tab === 'custom'"
                      class="flex items-center gap-2 font-bold mb-4"
                    >
                      <div
                        data-test="scheduled-pipeline-aggregation-title"
                        class="w-43 shrink-0"
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
                      class="flex items-center flex-nowrap mr-2 mb-2"
                    >
                      <div
                        data-test="scheduled-pipeline-group-by-title"
                        class="font-bold"
                        style="width: 190px"
                      >
                        {{ t("alerts.groupBy") }}
                      </div>
                      <div
                        class="flex justify-start items-center flex-wrap"
                        style="width: calc(100% - 190px)"
                      >
                        <template
                          v-for="(group, index) in aggregationData.group_by"
                          :key="index"
                        >
                          <div
                            :data-test="`scheduled-pipeline-group-by-${Number(index) + 1}`"
                            class="flex justify-start items-center flex-nowrap o2-input"
                          >
                            <div
                              data-test="scheduled-pipeline-group-by-column-select"
                            >
                              <OFormSelect
                                :name="`query_condition.aggregation.group_by[${index}]`"
                                :options="filteredFields"
                                labelKey="label"
                                valueKey="value"
                                :placeholder="t('pipeline.selectColumn')"
                                style="width: 200px"
                              />
                            </div>
                            <OButton
                              data-test="scheduled-pipeline-group-by-delete-btn"
                              variant="ghost-destructive"
                              size="icon-xs-sq"
                              class="mb-2 ml-1 mr-2"
                              :title="t('alert_templates.delete')"
                              @click="deleteGroupByColumn(Number(index))"
                              icon-left="delete"
                            />
                          </div>
                        </template>
                        <OButton
                          data-test="scheduled-pipeline-group-by-add-btn"
                          variant="ghost"
                          size="icon-xs-sq"
                          class="mb-2 ml-1 mr-2"
                          :title="t('common.add')"
                          @click="addGroupByColumn()"
                          icon-left="add"
                        />
                      </div>
                    </div>
                    <div
                      v-if="!disableThreshold"
                      class="flex justify-start items-center mb-1 flex-nowrap pb-3"
                    >
                      <div
                        data-test="scheduled-pipeline-threshold-title"
                        class="font-bold flex items-center"
                        style="width: 190px"
                      >
                        {{ t("alerts.threshold") + " *" }}

                        <OIcon
                          name="info"
                          size="sm"
                          class="ml-1 cursor-pointer"
                          :class="
                            'text-text-secondary'
                          "
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span style="font-size: var(--text-sm)"
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
                          <div class="flex justify-start items-center">
                            <div
                              data-test="scheduled-pipeline-threshold-function-select"
                              class="threshould-input mr-1 o2-input"
                            >
                              <OFormSelect
                                name="query_condition.aggregation.function"
                                :options="aggFunctions"
                                style="width: 120px"
                              />
                            </div>
                            <div
                              class="threshould-input mr-1 o2-input"
                              data-test="scheduled-pipeline-threshold-column-select"
                            >
                              <OFormSelect
                                name="query_condition.aggregation.having.column"
                                :options="filteredNumericColumns"
                                labelKey="label"
                                valueKey="value"
                                style="width: 250px"
                              />
                            </div>
                            <div
                              data-test="scheduled-pipeline-threshold-operator-select"
                              class="threshould-input mr-1 o2-input mt-2"
                            >
                              <OFormSelect
                                name="query_condition.aggregation.having.operator"
                                :options="triggerOperators"
                                style="width: 120px"
                              />
                            </div>
                            <div class="flex items-center mt-2">
                              <div
                                data-test="scheduled-pipeline-threshold-value-input"
                                style="width: 250px; margin-left: 0 !important"
                                class="silence-notification-input o2-input"
                              >
                                <OFormInput
                                  name="query_condition.aggregation.having.value"
                                  type="number"
                                  :min="0"
                                  :placeholder="t('pipeline.value')"
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
                            class="text-status-error-text pt-1 absolute"
                            style="font-size: var(--text-2xs); line-height: 12px"
                          >
                            {{ t("pipeline.fieldRequired") }}
                          </div>
                        </template>
                        <template v-else>
                          <div class="flex justify-start items-center">
                            <div
                              class="threshould-input"
                              data-test="scheduled-pipeline-threshold-operator-select"
                            >
                              <OFormSelect
                                name="trigger_condition.operator"
                                :options="triggerOperators"
                                style="
                                  width: 88px;
                                  border: 1px solid var(--color-border-subtle);
                                "
                              />
                            </div>
                            <div
                              class="flex items-center"
                              style="
                                border: 1px solid var(--color-border-subtle);
                                border-left: none;
                              "
                            >
                              <div
                                style="width: 89px; margin-left: 0 !important"
                                class="silence-notification-input"
                                data-test="scheduled-pipeline-threshold-value-input"
                              >
                                <OFormInput
                                  name="trigger_condition.threshold"
                                  type="number"
                                  :min="1"
                                />
                              </div>
                              <div
                                data-test="scheduled-pipeline-threshold-unit"
                                style="
                                  min-width: 90px;
                                  margin-left: 0 !important;
                                  height: 40px;
                                "
                                class="flex justify-center items-center bg-surface-subtle font-normal"
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
                            class="text-status-error-text pt-1 absolute"
                            style="font-size: var(--text-2xs); line-height: 12px"
                          >
                            {{ t("pipeline.fieldRequired") }}
                          </div>
                        </template>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <div
                        data-test="scheduled-pipeline-cron-toggle-title"
                        class="font-bold flex items-center gap-1 w-40 shrink-0"
                      >
                        <span>{{ t("alerts.crontitle") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="cursor-pointer text-icon-color"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="text-sm">
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
                    <div class="flex items-start gap-2">
                      <div
                        data-test="scheduled-pipeline-frequency-title"
                        class="font-bold flex items-center gap-1 w-40 shrink-0 pt-2"
                      >
                        <span>{{ t("alerts.frequency") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="cursor-pointer text-icon-color"
                        >
                          <OTooltip side="right">
                            <template #content>
                              <span
                                class="text-sm"
                                v-if="triggerData.frequency_type == 'minutes'"
                                >How often the task should be executed.<br />
                                e.g., 2 minutes means that the task will run
                                every 2 minutes and will be processed based on
                                the other parameters provided.</span
                              >
                              <span class="text-sm" v-else>
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
                            class="cursor-pointer text-status-warning-text"
                          >
                            <OTooltip
                              side="right"
                              content="Warning: The displayed timezone is approximate. Verify and select the correct timezone manually."
                            />
                          </OIcon>
                        </template>
                      </div>
                      <div class="flex flex-col gap-1">
                        <template v-if="triggerData.frequency_type == 'minutes'">
                          <!-- Composite "number + unit" field: the control sits
                               inside a shared w-fit/overflow-hidden border, so
                               OFormInput's built-in message would render inside
                               the 7.5rem field and wrap/clip. The empty #error
                               slot keeps the field form-owned (name=) but
                               suppresses its inline message; the schema error is
                               surfaced in the full-width sibling below. -->
                          <div
                            class="flex items-stretch border border-card-glass-border rounded-default w-fit overflow-hidden"
                          >
                            <OFormInput
                              data-test="scheduled-pipeline-frequency-input-field"
                              name="trigger_condition.frequency"
                              type="number"
                              :min="
                                Math.ceil(
                                  store.state?.zoConfig
                                    ?.min_auto_refresh_interval / 60,
                                ) || 1
                              "
                              width="xs"
                            >
                              <template #error />
                            </OFormInput>
                            <div
                              data-test="scheduled-pipeline-frequency-unit"
                              class="flex justify-center items-center min-w-15 px-2 font-normal bg-surface-subtle"
                            >
                              {{ t("alerts.minutes") }}
                            </div>
                          </div>
                          <div
                            v-if="frequencyError"
                            data-test="scheduled-pipeline-frequency-error-text"
                            class="text-status-error-text text-2xs leading-3"
                          >
                            {{ frequencyError }}
                          </div>
                        </template>
                        <template v-else>
                          <div class="flex items-start gap-2">
                            <OFormInput
                              data-test="scheduled-pipeline-cron-input-field"
                              name="trigger_condition.cron"
                              :placeholder="t('reports.cronExpression')"
                              width="xs"
                              required
                            />
                            <OFormSelect
                              data-test="add-report-schedule-start-timezone-select"
                              name="trigger_condition.timezone"
                              :options="filteredTimezone"
                              :placeholder="t('logStream.timezone') + ' *'"
                              :title="triggerData.timezone"
                              width="xs"
                            />
                          </div>
                        </template>
                      </div>
                    </div>
                    <div class="flex items-start gap-2">
                      <div
                        data-test="scheduled-pipeline-period-title"
                        class="font-bold flex items-center gap-1 w-40 shrink-0 pt-2"
                      >
                        <span>{{ t("alerts.period") + " *" }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="cursor-pointer text-icon-color"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="text-sm">
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
                      <div class="flex flex-col gap-1">
                        <!-- Composite "number + unit" field — same pattern as
                             frequency: an empty #error slot on the form-owned
                             field suppresses its inline message, and the schema
                             error (period ≥ 1) is rendered as a full-width sibling
                             below the bordered control instead of inside the
                             7.5rem field, where it would wrap. -->
                        <div
                          class="flex items-stretch border border-card-glass-border rounded-default w-fit overflow-hidden"
                        >
                          <OFormInput
                            data-test="scheduled-pipeline-period-input"
                            name="trigger_condition.period"
                            type="number"
                            :min="1"
                            :readonly="triggerData.frequency_type == 'minutes'"
                            :disabled="triggerData.frequency_type == 'minutes'"
                            class="silence-notification-input" width="xs"
                          >
                            <template #error />
                          </OFormInput>
                          <div
                            data-test="scheduled-pipeline-period-unit"
                            class="flex justify-center items-center min-w-15 px-2 font-normal bg-surface-subtle"
                          >
                            {{ t("alerts.minutes") }}
                          </div>
                        </div>
                        <!-- The required rule lives in the schema (period ≥ 1);
                             surfaced here after submit. Otherwise, once a
                             period is set, show the informational note. -->
                        <div
                          v-if="periodError"
                          data-test="scheduled-pipeline-period-error-text"
                          class="text-status-error-text text-2xs leading-3"
                        >
                          {{ periodError }}
                        </div>
                        <div
                          v-else-if="Number(triggerData.period)"
                          data-test="scheduled-pipeline-period-warning-text"
                          class="text-accent text-xs leading-3 py-0.5"
                        >
                          Note: The period should be the same as frequency.
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <div
                        data-test="scheduled-pipeline-delay-title"
                        class="font-bold flex items-center gap-1 w-40 shrink-0"
                      >
                        <span>{{ t("pipeline.delay") }}</span>
                        <OIcon
                          name="info"
                          size="sm"
                          class="cursor-pointer text-icon-color"
                        >
                          <OTooltip side="right" max-width="300px">
                            <template #content>
                              <span class="text-sm"
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
                        class="flex items-stretch border border-card-glass-border rounded-default w-fit overflow-hidden"
                      >
                        <OFormInput
                          data-test="scheduled-pipeline-delay-input"
                          name="delay"
                          type="number"
                          :min="0"
                          width="xs"
                        />
                        <div
                          data-test="scheduled-pipeline-delay-unit"
                          class="flex justify-center items-center min-w-15 px-2 font-normal bg-surface-subtle"
                        >
                          {{ t("alerts.minutes") }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div></div>

                  <div
                    class="flex justify-start items-end mt-4 pb-4 w-full bg-surface-base"
                  ></div>
                </div>
            </div>
            </div>
            </div>
          </template>
          <template #separator>
            <div
              class="w-1 h-full bg-transparent transition-colors duration-300 hover:bg-[var(--color-orange-500)]"
            ></div>
          </template>
          <template #after>
            <div class="w-full flex flex-col border-l border-border-default h-full">
              <div
                class="flex-1 overflow-auto w-full"
                style="height: calc(100vh - 200px) !important"
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
                  <div class="relative">
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
                      class="query-editor-placeholder-overlay absolute inset-0 flex items-start pt-0.75 pl-[2.15rem] pr-2 pointer-events-none z-1 select-none"
                    >
                      <span class="query-editor-placeholder-typewriter font-mono text-[var(--text-sm)] [line-height:1.3125rem] text-text-placeholder whitespace-nowrap overflow-hidden text-ellipsis">{{ editorPlaceholder }}</span>
                    </div>
                  </div>

                  <div>
                  <span @click.stop="expandState.output = !expandState.output">
                    <FullViewContainer
                      name="output"
                      v-model:is-expanded="expandState.output"
                      :label="t('pipeline.output')"
                      class="mt-1"
                    />
                  </span>
                  <div
                    v-if="loading && expandState.output && tab == 'sql'"
                    style="height: calc(100vh - 190px) !important"
                    class="flex justify-center items-center"
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
                      class="text-center w-5/6 mx-0"
                    >
                      <OIcon
                        name="info"
                        size="md"
                        class="align-middle mr-1"
                      />
                      {{ t("search.noStreamSelectedMessage") }}
                    </h6>
                    <h6
                      v-else-if="notificationMsgValue != ''"
                      data-test="logs-search-no-stream-selected-text"
                      class="text-center w-5/6 mx-0"
                    >
                      {{ notificationMsgValue }}
                    </h6>
                    <h6
                      v-else
                      data-test="logs-search-no-stream-selected-text"
                      class="text-center w-5/6 mx-0"
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
                class="border-t border-card-glass-border sticky bottom-0 px-4 py-3 z-10 bg-surface-base"
              >
                <div class="flex justify-end gap-2">
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
                    type="submit"
                    :disabled="formIsSubmitting"
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
        class="ml-2 w-1/4 max-w-full"
        v-if="store.state.isAiChatEnabled"
        style="
          min-width: 75px;
          height: calc(100vh - 70px) !important;
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import {
  getImageURL,
  timestampToTimezoneDate,
  formatTimeWithSuffix,
  b64EncodeUnicode,
  queryIndexSplit,
} from "@/utils/zincutils";
import searchService from "@/services/search";
import { toggleFullscreen } from "@/utils/dom";
import { copyToClipboard } from "@/utils/clipboard";
import CronExpressionParser from "cron-parser";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { inject } from "vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";

import useLogs from "@/composables/useLogs";

import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import FieldRow from "@/components/common/FieldRow.vue";
import useStreams from "@/composables/useStreams";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import useDurationPercentiles from "@/composables/useDurationPercentiles";
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
import { type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { createPipelinesContextProvider } from "@/composables/contextProviders/pipelinesContextProvider";
import { contextRegistry } from "@/composables/contextProviders";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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
// `searchObj` is provided by the logs search state, not the job-focused
// useLogs return; type it as optional so the guarded write stays type-safe.
const {
  searchObj,
}: ReturnType<typeof useLogs> & {
  searchObj?: { data?: { stream?: { pipelineQueryStream?: string[] } } };
} = useLogs();
const { getStream, getStreams } = useStreams();
const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } =
  useServiceCorrelation();
const { registerAiChatHandler, removeAiChatHandler } = useAiChat();
let parser: any;

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

// ── Form descendant ───────────────────────────────────────────────────────────
// ScheduledPipeline is rendered INSIDE Query's <OForm>; it injects that form and
// treats it as the SINGLE source of truth. The validated scalar controls below
// are OForm* `name=` fields (trigger_condition.* / delay / query_condition.type /
// stream_type / promql_condition.*); the rest of the internal logic reads the
// form-owned slices via these reactive views and writes them with
// form.setFieldValue — NO `props.trigger`/`props.aggregation` ref proxy, NO mirror.
const form: any = inject(FORM_CONTEXT_KEY);

// Reactive VIEWS of the form-owned slices (the single source of truth). These are
// reads only; every write goes through setTrigger/setAggregation/form.setFieldValue.
const triggerData = form.useStore(
  (s: any) => s.values.trigger_condition ?? {},
);
const aggregationData = form.useStore(
  (s: any) => s.values.query_condition?.aggregation ?? null,
);
const delayCondition = form.useStore((s: any) => s.values.delay);

// The frequency (minutes) and period controls are composite "number + unit"
// fields wrapped in a shared w-fit/overflow-hidden border, so their OFormInput
// carries an empty #error slot (suppresses the built-in inline message) and we
// render the schema error in a full-width sibling below the group. These read
// the same field errors OFormInput would have surfaced — single source of truth,
// just displayed at column width.
const frequencyError = form.useStore((s: any) =>
  firstFieldError(s.fieldMeta?.["trigger_condition.frequency"]?.errors ?? []),
);
const periodError = form.useStore((s: any) =>
  firstFieldError(s.fieldMeta?.["trigger_condition.period"]?.errors ?? []),
);

// Helper writers — set a nested key on the form-owned trigger object (single
// source of truth). `dontUpdateMeta` keeps these programmatic writes from
// flipping touched/blurred meta (the OForm* field controls own that).
const setTrigger = (key: string, value: any) => {
  form.setFieldValue(`trigger_condition.${key}`, value, {
    dontUpdateMeta: true,
  });
};
const setAggregation = (value: any) => {
  form.setFieldValue("query_condition.aggregation", value, {
    dontUpdateMeta: true,
  });
};

// Stream type / name are form-owned: the two <OFormSelect> controls own
// `stream_type` / `stream_name`. These are reactive READ views of that single
// source of truth — every programmatic write goes through form.setFieldValue so
// all the internal read-sites (query preview, field lists, watches, AI context)
// keep working off one value, and nothing mirrors it.
const selectedStreamType = form.useStore(
  (s: any) => s.values.stream_type ?? props.streamType ?? "logs",
);
const selectedStreamName = form.useStore(
  (s: any) => s.values.stream_name ?? "",
);

// Initial query/tab/stream-type come from the form-owned values (single source
// of truth) seeded by Query's defaultValues / edit-node reset — with prop
// fallbacks so a standalone mount (tests that still pass props) keeps working.
const initialQc = (form.state.values?.query_condition ?? {}) as any;
const initialQueryType = initialQc.type ?? props.query_type ?? "custom";

const tab = ref(initialQueryType);

const query = ref(
  initialQueryType === "promql"
    ? (initialQc.promql ?? props.promql)
    : (initialQc.sql ?? props.sql),
);

const collapseFields = ref(false);



const store = useStore();
const { isDark } = useTheme();

const queryEditorPlaceholderFlag = ref(true);
const pipelineEditorRef: any = ref(null);

// Server-error highlight ranges, provided by the parent Query.vue where the
// SQL validation runs. The composable forwards these to the editor.
const sqlErrorRanges = inject<Ref<SqlErrorRange[]>>(
  "pipelineSqlErrorRanges",
  ref<SqlErrorRange[]>([]),
);

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef: pipelineEditorRef,
    sqlMode: computed(() => tab.value === "sql"),
    query: computed(() => query.value ?? ""),
    externalErrors: sqlErrorRanges,
  });
const expandedLogs = ref<any[]>([]);
const cursorPosition = ref(-1);
const splitterModel = ref(30);
const step = ref(1);
const dateTime = ref<{
  startTime: number | null;
  endTime: number | null;
  relativeTimePeriod: string | null;
  valueType: string;
}>({
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

// Percentile values are `number | null`; formatTimeWithSuffix already renders
// null as "0us", so `?? 0` preserves runtime output while satisfying its `number` param.
const formatPercentile = (value: number | null) =>
  formatTimeWithSuffix(value ?? 0);

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

// The stream-name <OFormSelect> owns `stream_name`; react to the form-owned value
// here to load the selected stream's fields. The SQL-sync path awaits
// getStreamFields explicitly, so skip it there to avoid a double fetch.
watch(
  () => selectedStreamName.value,
  (val) => {
    if (isSyncingStreamFromQuery.value) return;
    if (val) getStreamFields();
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

// Cross-field reset: when frequency_type flips, recompute the form-owned period.
// flush:"sync" so the period write lands before any same-tick read.
watch(
  () => triggerData.value.frequency_type,
  (val) => {
    if (val == "minutes") {
      setTrigger("period", Number(triggerData.value.frequency) || 15);
    } else {
      const periodValue = convertCronToMinutes(triggerData.value.cron);
      setTrigger(
        "period",
        periodValue > 0
          ? periodValue
          : Number(triggerData.value.frequency) || 15,
      );
    }
  },
  { flush: "sync" },
);

// The frequency / cron OForm* fields write the form directly; their side effects
// (validate + recompute period) run by watching the form-owned values.
watch(
  () => triggerData.value.frequency,
  () => {
    if (triggerData.value.frequency_type === "minutes") updateFrequency();
  },
);
watch(
  () => triggerData.value.cron,
  () => {
    if (triggerData.value.frequency_type === "cron") updateCron();
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
      // Writing the form-owned stream_name triggers the watch → getStreamFields.
      form.setFieldValue("stream_name", parsedQuery?.ast.from[0].table, {
        dontUpdateMeta: true,
      });
    } else if (tab.value === "promql" && query.value != "") {
      // Extract stream name from PromQL query
      // PromQL query format: stream_name{} or stream_name{label="value"}
      const match = query.value.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1], { dontUpdateMeta: true });
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
    form.setFieldValue("stream_name", "", { dontUpdateMeta: true });
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

// Aggregation toggle. Initialised from the form-owned aggregation presence so an
// edit-node with an existing aggregation comes back enabled. Writing the toggle
// goes through updateAggregation (which sets/clears the form's aggregation).
const _isAggregationEnabled = ref(
  tab.value === "custom" && !!aggregationData.value,
);

// promql_condition is form-owned (query_condition.promql_condition); read it as a
// reactive view and write nested keys via form.setFieldValue (single SoT).
const promqlCondition = form.useStore(
  (s: any) => s.values.query_condition?.promql_condition ?? null,
);

const filteredFields = ref(props.columns);
// group_by per-row error display reads the form's field meta (the schema's
// superRefine populates it) — a reactive view, NOT an imperative error store.
const groupByErrors = form.useStore((s: any) => {
  const out: Record<number, string> = {};
  const meta = s.fieldMeta ?? {};
  const gb = aggregationData.value?.group_by ?? [];
  gb.forEach((_col: any, index: number) => {
    const key = `query_condition.aggregation.group_by[${index}]`;
    const errs = meta[key]?.errors ?? [];
    if (errs.length) {
      const e = errs[0];
      out[index] =
        typeof e === "string" ? e : (e?.message ?? String(e));
    }
  });
  return out;
});

const getNumericColumns = computed(() => {
  if (
    _isAggregationEnabled.value &&
    aggregationData.value &&
    aggregationData.value.function === "count"
  )
    return props.columns;
  else
    return props.columns.filter((column: any) => {
      return column.type !== "Utf8";
    });
});

// Save button loading is form-driven — TanStack's isSubmitting spans the awaited
// @submit (which includes the async SQL validation), so no manual flag is needed.
const formIsSubmitting = form.useStore((s: any) => s.isSubmitting);

const filteredNumericColumns = ref(getNumericColumns.value);

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

var triggerOperators: any = ref(["=", "!=", ">=", "<=", ">", "<"]);

const isCronMode = computed({
  get: () => triggerData.value.frequency_type === "cron",
  set: (val: boolean) => {
    setTrigger("frequency_type", val ? "cron" : "minutes");
  },
});

const selectedFunction = ref("");

const updateQueryValue = (value: string) => {
  _sqlOnQueryChange();
  query.value = value;

  // Monaco SQL/PromQL editors are bare — bridge their text into the form-owned
  // query_condition.sql / .promql at change (single source of truth, NOT a
  // mirror). The SQL value is not schema-validated (validity is a pre-submit
  // guard in Query), but it must be on the form so the payload build reads it.
  if (tab.value === "sql")
    form.setFieldValue("query_condition.sql", value, { dontUpdateMeta: true });
  if (tab.value === "promql")
    form.setFieldValue("query_condition.promql", value, {
      dontUpdateMeta: true,
    });

  if (tab.value === "sql") emits("update:sql", value);
  if (tab.value === "promql") emits("update:promql", value);

  emits("input:update", "query", value);

  // Feed auto-suggest with the current query and context
  autoCompleteData.value.query = value;
  autoCompleteData.value.cursorIndex =
    pipelineEditorRef.value?.getCursorIndex() ?? -1;
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
      form.setFieldValue("stream_name", fromStream, { dontUpdateMeta: true });
      await getStreamFields();
      isSyncingStreamFromQuery.value = false;
    }
  } catch {
    // ignore parse errors while user is mid-typing
  }
}, 600);

const updateFrequency = async () => {
  // Mirror frequency into period for the minutes mode (form-owned, single SoT).
  setTrigger("period", Number(triggerData.value.frequency));
};

function convertCronToMinutes(cronExpression: string) {
  // Parse the cron expression using cron-parser v5
  try {
    // cron-parser v5 dropped the `utc` option (it was already ignored at runtime).
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
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
    return -1;
  }
}

const updateCron = () => {
  let minutes = 0;
  try {
    minutes = convertCronToMinutes(triggerData.value.cron);

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

  setTrigger("period", minutes);
};

const updateTab = () => {
  updateQuery();
  updateAggregationToggle();
  // query_condition.type is form-owned — keep the form in sync with the tab.
  form.setFieldValue("query_condition.type", tab.value, {
    dontUpdateMeta: true,
  });
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

const updateQuery = () => {
  if (tab.value === "promql") {
    query.value = `${selectedStreamName.value}{}`;
  }

  // sql is form-owned (query_condition.sql) — restore the editor text from it.
  if (tab.value === "sql")
    query.value = form.state.values?.query_condition?.sql ?? props.sql ?? "";
};

// group_by[] is a form-owned array: each row renders as an indexed
// OFormSelect (`query_condition.aggregation.group_by[${i}]`) so the row value is
// owned by the form and its per-row error comes from the schema's superRefine —
// no bare <OSelect>, no manual :error binding, no bridge. Add/remove rows go
// through the form's own array ops (pushFieldValue / removeFieldValue).
const addGroupByColumn = () => {
  form.pushFieldValue("query_condition.aggregation.group_by", "", {
    dontUpdateMeta: true,
  });
};

const deleteGroupByColumn = (index: number) => {
  form.removeFieldValue("query_condition.aggregation.group_by", index, {
    dontUpdateMeta: true,
  });
};

const updateAggregation = () => {
  // Toggle ON with no existing aggregation → seed the default aggregation object
  // on the form. Toggle OFF → clear it (so the schema's group_by rule disengages
  // and the payload carries `aggregation: null`).
  if (_isAggregationEnabled.value) {
    if (!aggregationData.value) {
      setAggregation({
        group_by: [""],
        function: "avg",
        having: {
          column: "",
          operator: "=",
          value: "",
        },
      });
    }
  } else {
    setAggregation(null);
  }
};


const updateAggregationToggle = () => {
  _isAggregationEnabled.value =
    tab.value === "custom" && !!aggregationData.value;
};

const onBlurQueryEditor = debounce(async () => {
  queryEditorPlaceholderFlag.value = true;
  await _sqlOnBlur();
  emits("validate-sql");
}, 10);

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
        // Query is cleared when stream changes (see watch on selectedStreamName);
        // initial query generation happens in onMounted.
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

// getStreamList stores the full stream list
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
  return undefined;
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

  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});

// [START] O2 AI Context Handler

const registerAiContextHandler = () => {
  registerAiChatHandler(getContext);
};

const getContext = async () => {
    try {
      const payload: any = {};

      if (!selectedStreamType.value || !selectedStreamName.value) {
        return "";
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

      return payload;
    } catch (error) {
      console.error("Error in getContext for logs page", error);
      return "";
    }
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
  // Reactive form-owned slices exposed for tests/behaviour.
  form,
  triggerData,
  aggregationData,
  _isAggregationEnabled,
  groupByErrors,
  updateFrequency,
  updateCron,
  updateAggregation,
  addGroupByColumn,
  deleteGroupByColumn,
  updateQueryValue,
  query,
  promqlCondition,
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
  filterStreams,
  handleSidebarEvent,
  dateTime,
  updateDateChange,
  updateTab,
  runQuery,
  getColumns,
  rows,
  loading,
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
  functionsList,
  selectedFunction,
  onFunctionSelect,
  vrlFunctionContent,
});
</script>

<style scoped>
/* keep(lib-override): all of these reach into DOM owned by child/third-party components —
   OSplitter panes (.o-splitter__*), the field-list component (.index-menu/.index-table/
   .traces-field-table) and the Monaco-based query editor (.monaco-editor/
   .query-editor-container) — so they cannot be expressed as template utilities. */
.scheduled-pipeline-container :deep(.o-splitter__before),
.scheduled-pipeline-container :deep(.o-splitter__after) {
  overflow: hidden;
}

.scheduled-pipeline-container .pipeline-field-list-wrapper :deep(.index-menu),
.scheduled-pipeline-container .pipeline-field-list-wrapper :deep(.index-table) {
  height: 100%;
}

.scheduled-pipeline-container .pipeline-field-list-wrapper :deep(.traces-field-table) {
  height: 100% !important;
}

.scheduled-pipeline-container .scheduled-pipelines :deep(.monaco-editor) {
  width: 100%;
}

.scheduled-pipeline-container .scheduled-pipelines :deep(.query-editor-container) {
  width: 100% !important;
}
</style>
