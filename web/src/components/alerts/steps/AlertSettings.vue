<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="step-alert-conditions" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw:px-3 tw:py-4">
      <q-form ref="alertSettingsForm" @submit.prevent>
      <!-- For Real-Time Alerts -->
      <template v-if="isRealTime === 'true'">
        <!-- Silence Notification (Cooldown) -->
        <div class="flex justify-start items-start tw:pb-3 tw:mb-4">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.silenceNotification") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  If the alert triggers then how long should it wait before sending another notification.<br />
                  e.g. if the alert triggers at 4:00 PM and the silence notification is set to 10 minutes then it will not send
                  another notification until 4:10 PM even if the alert is still after 1 minute. This is to avoid spamming the user
                  with notifications.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center q-mr-sm" style="width: fit-content">
              <div
                style="width: 87px; margin-left: 0 !important"
                class="silence-notification-input"
              >
                <q-input
                  v-model.number="formData.trigger_condition.silence"
                  type="number"
                  dense
                  borderless
                  min="0"
                  style="background: none"
                  @update:model-value="$emit('update:trigger', formData.trigger_condition)"
                />
              </div>
              <div
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 36px;
                "
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="
                  store.state.theme === 'dark'
                    ? 'bg-grey-10'
                    : 'bg-grey-2'
                "
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="formData.trigger_condition.silence < 0 || formData.trigger_condition.silence === undefined || formData.trigger_condition.silence === null || formData.trigger_condition.silence === ''"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Destinations -->
        <div class="flex items-start tw:pb-4 tw:mb-4">
          <div style="width: 190px; height: 36px" class="flex items-center tw:font-semibold">
            <span>{{ t("alerts.destination") }} *</span>
          </div>
          <div class="tw:flex tw:flex-col">
            <div class="tw:flex tw:items-center">
              <q-select
                v-model="localDestinations"
                :options="filteredDestinations"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop no-case destinations-select-field"
                :class="
                  store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
                "
                filled
                dense
                multiple
                use-input
                input-debounce="0"
                @filter="filterDestinations"
                style="width: 300px; max-width: 300px"
                @update:model-value="emitDestinationsUpdate"
              >
                <template v-slot:selected>
                  <div v-if="localDestinations.length > 0" class="ellipsis">
                    {{ localDestinations.join(", ") }}
                  </div>
                </template>
                <template v-slot:option="option">
                  <q-list dense>
                    <q-item tag="label">
                      <q-item-section avatar>
                        <q-checkbox
                          size="xs"
                          dense
                          v-model="localDestinations"
                          :val="option.opt"
                          @update:model-value="emitDestinationsUpdate"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label class="ellipsis">{{ option.opt }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </template>
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">No destinations available</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn
                icon="refresh"
                class="iconHoverBtn q-ml-xs"
                :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                title="Refresh latest Destinations"
                @click="$emit('refresh:destinations')"
                style="min-width: auto"
              />
              <q-btn
                data-test="create-destination-btn"
                label="Add New Destination"
                class="text-bold no-border q-ml-sm"
                color="primary"
                no-caps
                @click="routeToCreateDestination"
              />
            </div>
            <div
              v-if="!localDestinations || localDestinations.length === 0"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>
      </template>

      <!-- For Scheduled Alerts -->
      <template v-else>
        <!-- Aggregation Toggle (only for custom queries, not SQL or PromQL) -->
        <div v-if="queryType === 'custom'" class="flex justify-start items-center tw:font-semibold alert-settings-row">
          <div class="flex items-center" style="width: 190px; height: 36px">
            {{ t("common.aggregation") }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Enable to summarize data using functions like count, sum, avg, etc. before triggering the alert.<br />
                  Example: Alert when average response time exceeds 500ms instead of individual events.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <q-toggle
            v-model="localIsAggregationEnabled"
            size="30px"
            class="text-bold o2-toggle-button-xs"
            @update:model-value="toggleAggregation"
          />
        </div>

        <!-- Group By Fields (shown when aggregation is enabled) -->
        <div
          v-if="localIsAggregationEnabled && formData.query_condition.aggregation"
          class="flex items-start no-wrap q-mr-sm alert-settings-row"
        >
          <div class="flex items-center tw:font-semibold" style="width: 190px; height: 36px">
            {{ t("alerts.groupBy") }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Group the aggregated data by specific fields to create separate alerts for each unique value.<br />
                  Example: Group by "hostname" to get individual alerts per server, or by "status_code" to track errors separately.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div class="flex justify-start items-center flex-wrap" style="width: calc(100% - 190px)">
            <template
              v-for="(group, index) in formData.query_condition.aggregation.group_by"
              :key="index"
            >
              <div class="flex justify-start items-center no-wrap">
                <div>
                  <q-select
                    v-model="formData.query_condition.aggregation.group_by[index]"
                    :options="filteredFields"
                    class="no-case q-py-none q-mb-sm"
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
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="width: 200px"
                    @update:model-value="emitAggregationUpdate"
                  />
                </div>
                <q-btn
                  icon="delete"
                  class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                  :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                  padding="xs"
                  unelevated
                  size="sm"
                  round
                  flat
                  :title="t('alert_templates.delete')"
                  @click="deleteGroupByColumn(index)"
                  style="min-width: auto"
                />
              </div>
            </template>
            <q-btn
              icon="add"
              class="iconHoverBtn q-mb-sm q-mr-sm"
              :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
              padding="xs"
              unelevated
              size="sm"
              round
              flat
              :title="t('common.add')"
              @click="addGroupByColumn"
              style="min-width: auto"
            />
          </div>
        </div>

        <!-- PromQL Trigger Condition (for promql queries only) -->
        <div v-if="queryType === 'promql' && formData.query_condition.promql_condition" class="flex justify-start items-start q-mb-xs no-wrap alert-settings-row">
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
                  v-model="formData.query_condition.promql_condition.operator"
                  :options="triggerOperators"
                  class="showLabelOnTop no-case q-py-none"
                  borderless
                  dense
                  use-input
                  hide-selected
                  fill-input
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  :style="{
                    width: (formData.query_condition.promql_condition.operator === 'Contains' || formData.query_condition.promql_condition.operator === 'NotContains')
                      ? '124px'
                      : '88px',
                    minWidth: '88px'
                  }"
                  @update:model-value="emitPromqlConditionUpdate"
                />
                <div
                  v-if="!formData.query_condition.promql_condition.operator"
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
                      v-model.number="formData.query_condition.promql_condition.value"
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
                  v-if="formData.query_condition.promql_condition.value === undefined || formData.query_condition.promql_condition.value === null || formData.query_condition.promql_condition.value === ''"
                  class="text-red-8 q-pt-xs"
                  style="font-size: 11px; line-height: 12px"
                >
                  Field is required!
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Threshold (for custom and sql queries, always shown for promql) -->
        <div class="flex justify-start items-start q-mb-xs no-wrap alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.threshold") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Defines when the alert should trigger based on the event count or aggregated value.<br />
                  Example: If set to "> 100", the alert triggers when the count exceeds 100 events.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- With Aggregation (only for custom queries with aggregation enabled) -->
            <template v-if="localIsAggregationEnabled && formData.query_condition.aggregation && queryType === 'custom'">
              <div ref="thresholdFieldRef" class="flex tw:flex-col justify-start items-start tw:gap-2">
                <div class="tw:flex tw:items-center">
                  <div class="q-mr-xs">
                    <q-select
                      v-model="formData.query_condition.aggregation.function"
                      :options="aggFunctions"
                      class="no-case q-py-none q-mb-xs"
                      borderless
                      hide-bottom-space
                      dense
                      use-input
                      hide-selected
                      fill-input
                      style="width: 120px"
                      @update:model-value="emitAggregationUpdate"
                    />
                  </div>
                  <div class="q-mr-xs">
                    <q-select
                      v-model="formData.query_condition.aggregation.having.column"
                      :options="filteredNumericColumns"
                      class="no-case q-py-none q-mb-xs"
                      borderless
                      dense
                      use-input
                      emit-value
                      hide-selected
                      fill-input
                      @filter="filterNumericColumns"
                      style="width: 250px"
                      @update:model-value="emitAggregationUpdate"
                      hide-bottom-space
                      :error="!formData.query_condition.aggregation.having.column || formData.query_condition.aggregation.having.column.length === 0"
                      error-message="Field is required!"
                    />
                  </div>
                </div>
                <div class="flex items-center q-mt-xs">
                  <div class="monaco-editor-test q-mr-xs tw:pb-1">
                    <q-select
                      v-model="formData.query_condition.aggregation.having.operator"
                      :options="triggerOperators"
                      color="input-border"
                      class="no-case q-py-none"
                      borderless
                      dense
                      use-input
                      hide-selected
                      fill-input
                      style="width: 120px"
                      @update:model-value="emitAggregationUpdate"
                    />
                  </div>
                  <div class="flex items-center tw:pb-1">
                    <div style="width: 250px; margin-left: 0 !important">
                      <q-input
                        v-model="formData.query_condition.aggregation.having.value"
                        type="number"
                        dense
                        borderless
                        min="0"
                        :placeholder="t('alerts.placeholders.value')"
                        @update:model-value="emitAggregationUpdate"
                        hide-bottom-space
                        :rules="[(val: any) => !!val || 'Field is required!']"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Without Aggregation (for custom without aggregation, sql, and promql queries) -->
            <template v-if="!localIsAggregationEnabled || queryType !== 'custom'">
              <div ref="thresholdFieldRef" class="flex justify-start items-start">
                <div class="tw:flex tw:flex-col">
                  <q-select
                    v-model="formData.trigger_condition.operator"
                    :options="triggerOperators"
                    class="showLabelOnTop no-case q-py-none"
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    :style="{
                      width: (formData.trigger_condition.operator === 'Contains' || formData.trigger_condition.operator === 'NotContains')
                        ? '124px'
                        : '88px',
                      minWidth: '88px'
                    }"
                    @update:model-value="emitTriggerUpdate"
                  />
                  <div
                    v-if="!formData.trigger_condition.operator"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
                <div class="flex items-start tw:flex-col" style="border-left: none">
                  <div class="tw:flex tw:items-center">
                    <div style="width: 89px; margin-left: 0 !important">
                      <q-input
                        v-model.number="formData.trigger_condition.threshold"
                        type="number"
                        dense
                        borderless
                        min="1"
                        style="background: none"
                        debounce="300"
                        @update:model-value="emitTriggerUpdate"
                      />
                    </div>
                    <div
                      style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                      :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c;' : ''"
                      :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                      class="flex justify-center items-center"
                    >
                      {{ t("alerts.events") }}
                    </div>
                  </div>
                  <div
                    v-if="!Number(formData.trigger_condition.threshold)"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Period -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.period") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Period for which the query should run.<br />
                  e.g. 10 minutes means that whenever the query will run it will use the last 10 minutes of data.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div ref="periodFieldRef" class="flex items-center q-mr-sm" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important" class="period-input-container">
                <q-input
                  v-model.number="formData.trigger_condition.period"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none"
                  debounce="300"
                  @update:model-value="handlePeriodChange"
                />
              </div>
              <div
                style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="!Number(formData.trigger_condition.period)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Frequency (with inline interval/cron toggle) -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.frequency") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="auto">
                <span style="font-size: 14px" v-if="formData.trigger_condition.frequency_type === 'minutes'">
                  How often the task should be executed.<br />
                  e.g., 2 minutes means that the task will run every 2 minutes.
                </span>
                <span style="font-size: 14px" v-else>
                  Pattern: * * * * * * means every second.
                  <br />
                  Format: [Second (optional) 0-59] [Minute 0-59] [Hour 0-23] [Day of Month 1-31, 'L'] [Month 1-12]
                  [Day of Week 0-7 or '1L-7L', 0 and 7 for Sunday].
                </span>
              </q-tooltip>
            </q-icon>
            <template v-if="formData.trigger_condition.frequency_type === 'cron' && showTimezoneWarning">
              <q-icon
                name="warning"
                size="18px"
                class="cursor-pointer tw:ml-2"
                :class="store.state.theme === 'dark' ? 'tw:text-orange-500' : 'tw:text-orange-500'"
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="auto"
                  class="tw:text-[14px]"
                >
                  Warning: The displayed timezone is approximate. Verify and select the correct timezone manually.
                </q-tooltip>
              </q-icon>
            </template>
          </div>
          <div class="tw:flex tw:flex-col" style="min-height: 78px">
            <!-- Interval/Cron Mode Buttons -->
            <div class="tw:flex frequency-toggle-group tw:mb-3">
              <q-btn
                :label="t('alerts.interval')"
                :outline="formData.trigger_condition.frequency_type === 'cron'"
                :unelevated="formData.trigger_condition.frequency_type === 'minutes'"
                :color="formData.trigger_condition.frequency_type === 'minutes' ? 'primary' : 'grey-7'"
                no-caps
                size="sm"
                class="tw:px-4 frequency-toggle-btn frequency-toggle-left"
                :class="formData.trigger_condition.frequency_type === 'minutes' ? 'active' : 'inactive'"
                style="min-width: 90px"
                @click="handleFrequencyTypeChange('minutes')"
              />
              <q-btn
                label="Cron Schedule"
                :outline="formData.trigger_condition.frequency_type === 'minutes'"
                :unelevated="formData.trigger_condition.frequency_type === 'cron'"
                :color="formData.trigger_condition.frequency_type === 'cron' ? 'primary' : 'grey-7'"
                no-caps
                size="sm"
                class="tw:px-4 frequency-toggle-btn frequency-toggle-right"
                :class="formData.trigger_condition.frequency_type === 'cron' ? 'active' : 'inactive'"
                style="min-width: 130px"
                @click="handleFrequencyTypeChange('cron')"
              />
            </div>

            <!-- Input Fields Container (fixed height to prevent shifting) -->
            <div class="tw:flex tw:items-start" style="min-height: 36px">
              <!-- Interval Mode -->
              <div v-if="formData.trigger_condition.frequency_type === 'minutes'" class="tw:flex tw:items-center">
                <div style="width: 87px; margin-left: 0 !important">
                  <q-input
                    v-model.number="formData.trigger_condition.frequency"
                    type="number"
                    dense
                    borderless
                    min="1"
                    style="background: none"
                    debounce="300"
                    @update:model-value="emitTriggerUpdate"
                  />
                </div>
                <div
                  style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                  :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                  :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                  class="flex justify-center items-center"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>

              <!-- Cron Mode -->
              <div v-else class="tw:flex tw:items-center tw:gap-2">
                <q-input
                  v-model="formData.trigger_condition.cron"
                  dense
                  borderless
                  placeholder="Cron Expression *"
                  style="background: none; width: 180px"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
                <q-select
                  v-model="formData.trigger_condition.timezone"
                  :options="filteredTimezone"
                  @blur="
                    browserTimezone =
                      browserTimezone === ''
                        ? Intl.DateTimeFormat().resolvedOptions().timeZone
                        : browserTimezone
                  "
                  use-input
                  @filter="timezoneFilterFn"
                  input-debounce="0"
                  dense
                  borderless
                  emit-value
                  fill-input
                  hide-selected
                  :title="formData.trigger_condition.timezone"
                  placeholder="Timezone *"
                  :display-value="`${browserTimezone || 'Select timezone'}`"
                  style="width: 210px"
                  @update:model-value="emitTriggerUpdate"
                />
              </div>
            </div>

            <!-- Error Message -->
            <div
              v-if="
                (formData.trigger_condition.frequency_type === 'minutes' && !Number(formData.trigger_condition.frequency)) ||
                (formData.trigger_condition.frequency_type === 'cron' && (!formData.trigger_condition.cron || !formData.trigger_condition.timezone)) ||
                cronJobError
              "
              class="text-red-8 tw:mt-1"
              style="font-size: 11px; line-height: 12px"
            >
              {{ cronJobError || "Field is required!" }}
            </div>
          </div>
        </div>

        <!-- Silence Notification (Cooldown) for Scheduled Alerts -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.silenceNotification") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  If the alert triggers then how long should it wait before sending another notification.<br />
                  e.g. if the alert triggers at 4:00 PM and the silence notification is set to 10 minutes then it will not send
                  another notification until 4:10 PM even if the alert is still after 1 minute. This is to avoid spamming the user
                  with notifications.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div ref="silenceFieldRef" class="flex items-center q-mr-sm" style="width: fit-content">
              <div
                style="width: 87px; margin-left: 0 !important"
                class="silence-notification-input"
              >
                <q-input
                  v-model.number="formData.trigger_condition.silence"
                  type="number"
                  dense
                  borderless
                  min="0"
                  style="background: none"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
              </div>
              <div
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 36px;
                "
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="
                  store.state.theme === 'dark'
                    ? 'bg-grey-10'
                    : 'bg-grey-2'
                "
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="formData.trigger_condition.silence < 0 || formData.trigger_condition.silence === undefined || formData.trigger_condition.silence === null || formData.trigger_condition.silence === ''"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Destinations -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.destination") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">Select one or more destinations to send alert notifications.</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center">
              <q-select
                ref="destinationsFieldRef"
                v-model="localDestinations"
                :options="filteredDestinations"
                class="no-case q-py-none destinations-select-field"
                borderless
                dense
                multiple
                use-input
                fill-input
                :input-debounce="400"
                hide-bottom-space
                @filter="filterDestinations"
                @update:model-value="emitDestinationsUpdate"
                style="width: 180px; max-width: 300px"
              >
                <template v-slot:selected>
                  <div
                    v-if="localDestinations.length > 0"
                    class="ellipsis"
                  >
                    {{ localDestinations.join(", ") }}
                  </div>
                </template>
                <template v-slot:option="option">
                  <q-list dense>
                    <q-item tag="label">
                      <q-item-section avatar>
                        <q-checkbox
                          size="xs"
                          dense
                          v-model="localDestinations"
                          :val="option.opt"
                          @update:model-value="emitDestinationsUpdate"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label class="ellipsis">{{ option.opt }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </template>
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">No destinations available</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn
                icon="refresh"
                class="iconHoverBtn q-ml-xs"
                :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                title="Refresh latest Destinations"
                @click="$emit('refresh:destinations')"
                style="min-width: auto"
              />
              <q-btn
                data-test="create-destination-btn"
                label="Add New Destination"
                class="text-bold no-border q-ml-sm"
                color="primary"
                no-caps
                @click="routeToCreateDestination"
              />
            </div>
            <div
              v-if="!localDestinations || localDestinations.length === 0"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Template Override -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.template") }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Optional: Select a template to use for all destinations in this alert.
                  This overrides any templates configured on individual destinations.
                  If not selected, each destination will use its own configured template.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center">
              <q-select
                ref="templateFieldRef"
                v-model="localTemplate"
                :options="filteredTemplates"
                class="no-case q-py-none"
                borderless
                dense
                use-input
                fill-input
                clearable
                emit-value
                :input-debounce="400"
                hide-bottom-space
                @filter="filterTemplates"
                @update:model-value="emitTemplateUpdate"
                style="width: 180px; max-width: 300px"
                placeholder="Use destination templates"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">No templates available</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn
                icon="refresh"
                class="iconHoverBtn q-ml-xs"
                :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                title="Refresh latest Templates"
                @click="$emit('refresh:templates')"
                style="min-width: auto"
              />
            </div>
          </div>
        </div>
      </template>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import {
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  convertMinutesToCron,
} from "@/utils/zincutils";

export default defineComponent({
  name: "Step3AlertConditions",
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    formattedDestinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    template: {
      type: String,
      default: "",
    },
    templates: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: [
    "update:trigger",
    "update:aggregation",
    "update:isAggregationEnabled",
    "update:destinations",
    "update:template",
    "update:promqlCondition",
    "refresh:destinations",
    "refresh:templates",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    // Form ref
    const alertSettingsForm = ref(null);

    // Field refs for focus manager
    const periodFieldRef = ref(null);
    const thresholdFieldRef = ref(null);
    const silenceFieldRef = ref(null);
    const destinationsFieldRef = ref(null);
    const templateFieldRef = ref(null);

    // Local state for aggregation toggle
    // Only enable aggregation when query type is "custom" (not "sql" or "promql")
    const queryType = computed(() => props.formData.query_condition?.type || "custom");
    const localIsAggregationEnabled = ref(
      queryType.value === "custom" && props.isAggregationEnabled
    );
    const localDestinations = ref(props.destinations);
    const localTemplate = ref(props.template);

    // Timezone management
    const browserTimezone = ref("");
    const filteredTimezone = ref<string[]>([]);
    const showTimezoneWarning = ref(false);

    // Cron validation
    const cronJobError = ref("");

    // Initialize timezone
    const initializeTimezone = () => {
      try {
        const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        browserTimezone.value = detectedTimezone;

        // Auto-detect and set timezone if not already set and in cron mode
        if (props.formData.trigger_condition.frequency_type === 'cron' && !props.formData.trigger_condition.timezone) {
          props.formData.trigger_condition.timezone = detectedTimezone;
          showTimezoneWarning.value = true;
        }

        // Get all available timezones
        try {
          // @ts-ignore - supportedValuesOf is not in all TypeScript versions
          if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
            // @ts-ignore
            filteredTimezone.value = Intl.supportedValuesOf("timeZone");
          } else {
            // Fallback for older browsers
            filteredTimezone.value = [detectedTimezone];
          }
        } catch (err) {
          filteredTimezone.value = [detectedTimezone];
        }
      } catch (e) {
        console.error('Error initializing timezone:', e);
        browserTimezone.value = "UTC";
        filteredTimezone.value = ["UTC"];
      }
    };

    // Initialize on mount
    initializeTimezone();

    // Watch for prop changes
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        // Only enable aggregation if query type is "custom"
        localIsAggregationEnabled.value = queryType.value === "custom" && newVal;
      }
    );

    // Watch for query type changes
    watch(
      queryType,
      (newType) => {
        // Disable aggregation when switching to sql or promql
        if (newType !== "custom") {
          localIsAggregationEnabled.value = false;
          emit("update:isAggregationEnabled", false);
        } else {
          // Re-enable aggregation if it was previously enabled
          localIsAggregationEnabled.value = props.isAggregationEnabled;
        }
      }
    );

    watch(
      () => props.destinations,
      (newVal) => {
        localDestinations.value = newVal;
      }
    );

    watch(
      () => props.template,
      (newVal) => {
        localTemplate.value = newVal;
      }
    );

    // Watch for frequency type changes to manage timezone
    watch(
      () => props.formData.trigger_condition.frequency_type,
      (newVal) => {
        if (newVal === 'cron') {
          initializeTimezone();
        }
      }
    );

    // Aggregation functions
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
          filteredFields.value = props.columns.filter((v: any) => v.toLowerCase().indexOf(needle) > -1);
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
          filteredNumericColumns.value = props.columns.filter((v: any) => v.toLowerCase().indexOf(needle) > -1);
        }
      });
    };

    // Filtered destinations
    const filteredDestinations = ref([...props.formattedDestinations]);
    const filterDestinations = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredDestinations.value = [...props.formattedDestinations];
        } else {
          const needle = val.toLowerCase();
          filteredDestinations.value = props.formattedDestinations.filter(
            (v: any) => v.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    // Filtered templates
    const formattedTemplates = computed(() => props.templates.map((t: any) => t.name));
    const filteredTemplates = ref<string[]>([]);
    const filterTemplates = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredTemplates.value = [...formattedTemplates.value];
        } else {
          const needle = val.toLowerCase();
          filteredTemplates.value = formattedTemplates.value.filter(
            (v: string) => v.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    // Watch for templates prop changes
    watch(
      () => props.templates,
      () => {
        filteredTemplates.value = [...formattedTemplates.value];
      },
      { immediate: true }
    );

    // Timezone filter function
    const timezoneFilterFn = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          try {
            // @ts-ignore
            if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
              // @ts-ignore
              filteredTimezone.value = Intl.supportedValuesOf("timeZone");
            }
          } catch (e) {
            // Keep current filtered list
          }
        } else {
          const needle = val.toLowerCase();
          const allTimezones: string[] = [];
          try {
            // @ts-ignore
            if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
              // @ts-ignore
              allTimezones.push(...Intl.supportedValuesOf("timeZone"));
            }
          } catch (e) {
            allTimezones.push(browserTimezone.value);
          }
          filteredTimezone.value = allTimezones.filter((v: string) =>
            v.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    // Handle frequency type change with conversion
    const handleFrequencyTypeChange = (type: 'minutes' | 'cron') => {
      // If switching to cron and we have a frequency value, convert it
      // Only convert if there's no existing cron expression
      if (type === 'cron' && props.formData.trigger_condition.frequency_type === 'minutes') {
        const frequencyMinutes = Number(props.formData.trigger_condition.frequency);
        const existingCron = props.formData.trigger_condition.cron;

        // Only convert if we have a frequency value and no existing cron expression
        if (frequencyMinutes && frequencyMinutes > 0 && (!existingCron || existingCron.trim() === '')) {
          // Convert minutes to cron expression (6-field format: second minute hour day month dayOfWeek)
          const cronExpression = convertMinutesToCron(frequencyMinutes);
          props.formData.trigger_condition.cron = cronExpression;

          // Set timezone if not already set
          if (!props.formData.trigger_condition.timezone) {
            props.formData.trigger_condition.timezone = browserTimezone.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
          }
        }
      }

      // Update the frequency type
      props.formData.trigger_condition.frequency_type = type;
      emitTriggerUpdate();
    };

    // Toggle aggregation
    const toggleAggregation = () => {
      // Only allow aggregation toggle when query type is "custom"
      if (queryType.value !== "custom") {
        localIsAggregationEnabled.value = false;
        return;
      }

      // Initialize aggregation object when enabling
      if (localIsAggregationEnabled.value && !props.formData.query_condition.aggregation) {
        props.formData.query_condition.aggregation = {
          group_by: [""],
          function: "avg",
          having: {
            column: "",
            operator: "=",
            value: "",
          },
        };
      }

      // Also initialize if aggregation exists but doesn't have function property
      if (localIsAggregationEnabled.value && props.formData.query_condition.aggregation && !props.formData.query_condition.aggregation.function) {
        props.formData.query_condition.aggregation.function = "avg";
      }

      emit("update:isAggregationEnabled", localIsAggregationEnabled.value);
    };

    // Add group by column
    const addGroupByColumn = () => {
      if (props.formData.query_condition.aggregation) {
        props.formData.query_condition.aggregation.group_by.push("");
        emitAggregationUpdate();
      }
    };

    // Delete group by column
    const deleteGroupByColumn = (index: number) => {
      if (props.formData.query_condition.aggregation) {
        props.formData.query_condition.aggregation.group_by.splice(index, 1);
        emitAggregationUpdate();
      }
    };

    // Validate cron expression
    const validateFrequency = () => {
      cronJobError.value = "";

      if (props.formData.trigger_condition.frequency_type === "cron") {
        try {
          const intervalInSecs = getCronIntervalDifferenceInSeconds(props.formData.trigger_condition.cron);

          if (
            typeof intervalInSecs === "number" &&
            !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
          ) {
            const minInterval = Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
            cronJobError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
            return;
          }
        } catch (e) {
          cronJobError.value = "Invalid cron expression";
        }
      }

      if (props.formData.trigger_condition.frequency_type === "minutes") {
        const intervalInMins = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60);

        if (props.formData.trigger_condition.frequency < intervalInMins) {
          cronJobError.value = "Minimum frequency should be " + intervalInMins + " minutes";
          return;
        }
      }
    };

    // Emit updates
    const emitTriggerUpdate = () => {
      validateFrequency();
      emit("update:trigger", props.formData.trigger_condition);
    };

    // Handle period change and sync with frequency, silence, and cron
    const handlePeriodChange = () => {
      const periodValue = Number(props.formData.trigger_condition.period);

      if (periodValue && periodValue > 0) {
        // Only sync frequency if period is above minimum refresh interval
        // This prevents frequency from going below the minimum allowed value
        const minFrequency = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60) || 10;
        if (periodValue >= minFrequency) {
          props.formData.trigger_condition.frequency = periodValue;
        }

        // Always sync cron expression, regardless of current mode
        // This ensures cron is up-to-date when user switches to cron mode
        const cronExpression = convertMinutesToCron(periodValue);
        props.formData.trigger_condition.cron = cronExpression;

        // Ensure timezone is set
        if (!props.formData.trigger_condition.timezone) {
          props.formData.trigger_condition.timezone = browserTimezone.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
        }

        // Always sync silence notification
        props.formData.trigger_condition.silence = periodValue;
      }

      emitTriggerUpdate();
    };

    const emitAggregationUpdate = () => {
      emit("update:aggregation", props.formData.query_condition.aggregation);
    };

    const emitDestinationsUpdate = () => {
      emit("update:destinations", localDestinations.value);
    };

    const emitTemplateUpdate = () => {
      emit("update:template", localTemplate.value || "");
    };

    const emitPromqlConditionUpdate = () => {
      emit("update:promqlCondition", props.formData.query_condition.promql_condition);
    };

    const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    // Validation method - just call the inline validations that already exist
    const validate = async () => {
      // Validate cron/frequency first
      validateFrequency();

      // Check if there are any cron validation errors
      if (cronJobError.value) {
        return { valid: false, message: cronJobError.value };
      }

      // For Real-Time Alerts
      if (props.isRealTime === 'true') {
        // Check silence notification
        if (
          props.formData.trigger_condition.silence < 0 ||
          props.formData.trigger_condition.silence === undefined ||
          props.formData.trigger_condition.silence === null ||
          props.formData.trigger_condition.silence === ''
        ) {
          return { valid: false, message: `${t('alerts.silenceNotification')} should be greater than or equal to 0` };
        }

        // Check destinations (required for both real-time and scheduled)
        if (!localDestinations.value || localDestinations.value.length === 0) {
          return { valid: false, message: null }; // null means show inline error only
        }

        return { valid: true };
      }

      // For Scheduled Alerts
      // Check if query type is PromQL - validate both promql_condition AND threshold
      if (queryType.value === 'promql') {
        // Validate PromQL condition
        if (!props.formData.query_condition.promql_condition) {
          return { valid: false, message: 'PromQL condition is required' };
        }
        if (!props.formData.query_condition.promql_condition.operator) {
          return { valid: false, message: null };
        }
        if (
          props.formData.query_condition.promql_condition.value === undefined ||
          props.formData.query_condition.promql_condition.value === null ||
          props.formData.query_condition.promql_condition.value === ''
        ) {
          return { valid: false, message: null };
        }

        // Also validate threshold for PromQL
        if (!props.formData.trigger_condition.operator) {
          return { valid: false, message: null };
        }
        const threshold = Number(props.formData.trigger_condition.threshold);
        if (isNaN(threshold) || threshold < 1) {
          return { valid: false, message: `${t('alerts.threshold')} should be greater than 0` };
        }
      } else if (localIsAggregationEnabled.value && props.formData.query_condition.aggregation) {
        // Check if aggregation is enabled
        // Validate group by fields (if any are added, they must not be empty)
        const groupByFields = props.formData.query_condition.aggregation.group_by;
        if (groupByFields && groupByFields.length > 0) {
          for (const field of groupByFields) {
            if (!field || field === '') {
              return { valid: false, message: null }; // Show inline error only
            }
          }
        }

        // Validate threshold with aggregation
        if (!props.formData.query_condition.aggregation.having.column || props.formData.query_condition.aggregation.having.column === '') {
          return { valid: false, message: null };
        }
        if (!props.formData.query_condition.aggregation.having.value || props.formData.query_condition.aggregation.having.value === '') {
          return { valid: false, message: null };
        }
        if (!props.formData.query_condition.aggregation.having.operator) {
          return { valid: false, message: null };
        }
      } else {
        // Validate threshold without aggregation
        if (!props.formData.trigger_condition.operator) {
          return { valid: false, message: null };
        }
        const threshold = Number(props.formData.trigger_condition.threshold);
        if (isNaN(threshold) || threshold < 1) {
          return { valid: false, message: `${t('alerts.threshold')} should be greater than 0` };
        }
      }

      // Validate period
      const period = Number(props.formData.trigger_condition.period);
      if (isNaN(period) || period < 1) {
        return { valid: false, message: `${t('alerts.period')} should be greater than 0` };
      }

      // Validate frequency
      if (props.formData.trigger_condition.frequency_type === 'minutes') {
        const frequency = Number(props.formData.trigger_condition.frequency);
        if (isNaN(frequency) || frequency < 1) {
          return { valid: false, message: `${t('alerts.frequency')} should be greater than 0` };
        }
      } else if (props.formData.trigger_condition.frequency_type === 'cron') {
        if (!props.formData.trigger_condition.cron || !props.formData.trigger_condition.timezone) {
          return { valid: false, message: null };
        }
      }

      // Validate silence notification
      if (
        props.formData.trigger_condition.silence < 0 ||
        props.formData.trigger_condition.silence === undefined ||
        props.formData.trigger_condition.silence === null ||
        props.formData.trigger_condition.silence === ''
      ) {
        return { valid: false, message: `${t('alerts.silenceNotification')} should be greater than or equal to 0` };
      }

      // Check destinations (required for both real-time and scheduled)
      if (!localDestinations.value || localDestinations.value.length === 0) {
        return { valid: false, message: null }; // null means show inline error only
      }

      return { valid: true };
    };

    return {
      t,
      store,
      queryType,
      localIsAggregationEnabled,
      localDestinations,
      localTemplate,
      aggFunctions,
      triggerOperators,
      filteredFields,
      filterFields,
      filteredNumericColumns,
      filterNumericColumns,
      filteredDestinations,
      filterDestinations,
      filteredTemplates,
      filterTemplates,
      toggleAggregation,
      addGroupByColumn,
      deleteGroupByColumn,
      emitTriggerUpdate,
      emitAggregationUpdate,
      emitDestinationsUpdate,
      emitTemplateUpdate,
      emitPromqlConditionUpdate,
      routeToCreateDestination,
      handleFrequencyTypeChange,
      handlePeriodChange,
      // Timezone-related
      browserTimezone,
      filteredTimezone,
      showTimezoneWarning,
      timezoneFilterFn,
      // Cron validation
      cronJobError,
      validateFrequency,
      // Validation
      validate,
      alertSettingsForm,
      // Field refs for focus manager
      periodFieldRef,
      thresholdFieldRef,
      silenceFieldRef,
      destinationsFieldRef,
      templateFieldRef,
    };
  },
});
</script>

<style scoped lang="scss">
.step-alert-conditions {
  width: 100%;
  height: 100%;
  margin: 0 auto;

  .step-content {
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }

  .step-header {
    .step-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 0.2rem;
    }

    .step-subtitle {
      font-size: 13px;
      opacity: 0.8;
      margin: 0;
      margin-bottom: 0.5rem;
    }
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }

    .step-title {
      color: #ffffff;
    }

    .step-subtitle {
      color: #bdbdbd;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }

    .step-title {
      color: #1a1a1a;
    }

    .step-subtitle {
      color: #5c5c5c;
    }
  }
}

// Consistent spacing for alert settings rows
.alert-settings-row {
  margin-bottom: 24px !important;
  padding-bottom: 0 !important;
}

// Frequency toggle buttons styling
.frequency-toggle-group {
  display: flex;
  width: fit-content;
}

.frequency-toggle-btn {
  border: 1px solid !important;
  border-radius: 0 !important;
  transition: all 0.2s ease;
  margin: 0 !important;

  &.active {
    border-color: var(--q-primary) !important;
    background-color: var(--q-primary) !important;
    color: white !important;
    z-index: 1;
  }

  &.inactive {
    border-color: #d0d0d0 !important;
    background-color: transparent !important;
  }
}

.frequency-toggle-left {
  border-radius: 4px 0 0 4px !important;
}

.frequency-toggle-right {
  border-left: none !important;
  border-radius: 0 4px 4px 0 !important;
}

.dark-mode {
  .frequency-toggle-btn {
    &.inactive {
      border-color: #404040 !important;
      color: #bdbdbd !important;
    }
  }
}

.light-mode {
  .frequency-toggle-btn {
    &.inactive {
      color: #5c5c5c !important;
    }
  }
}

// Fix for destinations select - keep selected items and input on same line
.destinations-select-field {
  :deep(.q-field__control) {
    .q-field__native {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      flex-wrap: nowrap !important;
      overflow: hidden !important;

      > span {
        flex: 0 0 80% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        min-width: 0 !important;
      }

      > input {
        flex: 0 0 20% !important;
        min-width: 0 !important;
        width: 20% !important;
      }
    }
  }
}
</style>
