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
  <div ref="scheduledAlertRef" class="scheduled-alerts q-pa-none q-ma-none">

    <!-- first section -->
<div class="tw-w-full">
      <div class="tw-w-full tw-ml-2">
        <AlertsContainer 
            name="Alert Settings"
            v-model:is-expanded="expandState.thresholds"
            label="Alert Settings"
            subLabel="Set your alert rules and choose how you'd like to be notified."
            icon="tune"
            class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2 "
            :iconClass="'tw-mt-[2px]'"
            @update:is-expanded="()=>emits('update:expandState', expandState)"
          />
      </div>
      <div v-if="expandState.thresholds" class=" tw-w-full row alert-setup-container ">
        <div class="q-mt-sm">
        <div
          v-if="
            alertData.stream_type === 'metrics' &&
            tab === 'promql' &&
            promqlCondition
          "
          class="flex justify-start items-center text-bold tw-pb-1 o2-input"
        >
          <div style="width: 190px">Trigger if the value is</div>
          <div class="flex justify-start items-center">
            <div data-test="scheduled-alert-promlq-condition-operator-select">
              <q-select
                v-model="promqlCondition.operator"
                :options="triggerOperators"
                color="input-border"
                class="no-case q-py-none q-mr-xs"
                :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                filled
                borderless
                dense
                use-input
                hide-selected
                fill-input
                style="width: 88px; border-right: none"
                @update:model-value="updatePromqlCondition"
              />
            </div>
            <div
              data-test="scheduled-alert-promlq-condition-value"
              style="width: 160px; margin-left: 0 !important"
              class=" o2-input"
            >
              <q-input
                v-model="promqlCondition.value"
                type="number"
                dense
                filled
                min="0"
                style="background: none"
                placeholder="Value"
                @update:model-value="updatePromqlCondition"
              />
            </div>
          </div>
        </div>
        <div
          v-if="tab === 'custom'"
          class="flex justify-start items-center tw-font-semibold tw-pb-1"
        >
          <div data-test="scheduled-alert-aggregation-title" style="width: 172px">
            Aggregation
          </div>
          <q-toggle
            data-test="scheduled-alert-aggregation-toggle"
            v-model="_isAggregationEnabled"
            size="md"
            color="primary"
            class="text-bold q-pl-0 o2-toggle-button-sm tw-h-[36px] tw-ml-1"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
            :disable="tab === 'sql' || tab === 'promql'"
            @update:model-value="updateAggregation"
          />
        </div>
        <div
          v-if="_isAggregationEnabled && aggregationData"
          class="flex items-center no-wrap q-mr-sm tw-pb-2"
        >
          <div
            data-test="scheduled-alert-group-by-title"
            class="tw-font-semibold"
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
              :key="group"
            >
              <div
                :data-test="`scheduled-alert-group-by-${index + 1}`"
                class="flex justify-start items-center no-wrap o2-input"
              >
                <div data-test="scheduled-alert-group-by-column-select">
                  <q-select
                    v-model="aggregationData.group_by[index]"
                    :options="filteredFields"
                    color="input-border"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    class="no-case q-py-none tw-pb-1"
                    filled
                    borderless
                    dense
                    use-input
                    emit-value
                    hide-selected
                    placeholder="Select column"
                    fill-input
                    :input-debounce="400"
                    hide-bottom-space
                    @filter="
                      (val: string, update: any) => filterFields(val, update)
                    "
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="width: 200px"
                    @update:model-value="updateTrigger"
                  />
                </div>
                <q-btn
                  data-test="scheduled-alert-group-by-delete-btn"
                  :icon="outlinedDelete"
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
              data-test="scheduled-alert-group-by-add-btn"
              icon="add"
              class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
              :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
              padding="xs"
              unelevated
              size="sm"
              round
              flat
              :title="t('common.add')"
              @click="addGroupByColumn()"
              style="min-width: auto"
            />
          </div>
        </div>
        <div
          v-if="!disableThreshold"
          class="flex justify-start items-center q-mb-xs no-wrap tw-pb-1"
        >
          <div
            data-test="scheduled-alert-threshold-title"
            class="tw-font-semibold flex items-center"
            style="width: 190px"
          >
            {{ t("alerts.threshold") + " *" }}

            <q-icon
              :name="outlinedInfo"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                <span style="font-size: 14px"
                  >The threshold above/below which the alert will trigger. <br />
                  e.g. if the threshold is >100 and the query returns a value of
                  101 then the alert will trigger.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)" class="position-relative">
            <template v-if="_isAggregationEnabled && aggregationData">
              <div class="flex tw-flex-col justify-start items-start">
                <div class="tw-flex tw-items-center">
                  <div
                  data-test="scheduled-alert-threshold-function-select"
                  class=" q-mr-xs o2-input"
                  :class="isHavingError ? 'tw-mb-[12px]':''"
                >
                  <q-select
                    v-model="aggregationData.function"
                    :options="aggFunctions"
                    color="input-border"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    class="no-case q-py-none"
                    filled
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    style="width: 120px"
                    @update:model-value="updateAggregation"
                  />
                </div>
                <div
                  class="monaco-editor-test q-mr-xs o2-input"
                  data-test="scheduled-alert-threshold-column-select"
                >
                  <q-select
                    v-model="aggregationData.having.column"
                    :options="filteredNumericColumns"
                    color="input-border"
                  :class="[store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light',
                  ]"
                    class="no-case q-py-none"
                    filled
                    borderless
                    dense
                    use-input
                    emit-value
                    hide-selected
                    fill-input
                    @filter="filterNumericColumns"
                    style="width: 250px"
                    @update:model-value="updateAggregation"
                    hide-bottom-space
                    :error="isHavingError"
                    error-message="Field is required!"

                  />
                </div>
                </div>
                <div class="flex items-center q-mt-xs">
                  <div
                  data-test="scheduled-alert-threshold-operator-select"
                  class="monaco-editor-test q-mr-xs o2-input tw-pb-1"
                >
                  <q-select
                    v-model="aggregationData.having.operator"
                    :options="triggerOperators"
                    color="input-border"
                  :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    class="no-case q-py-none"
                    filled
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    style="width: 120px"
                    @update:model-value="updateAggregation"
                  />
                </div>
                <div class="flex items-center tw-pb-1">
                  <div
                    data-test="scheduled-alert-threshold-value-input"
                    style="width: 250px; margin-left: 0 !important"
                    class=" o2-input"
                  >
                    <q-input
                      v-model="aggregationData.having.value"
                      type="number"
                      :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                      dense
                      filled
                      min="0"
                      placeholder="Value"
                      @update:model-value="updateAggregation"
                    />
                  </div>
                </div>
                </div>

              </div>
              
            </template>
            <template v-else>
              <div class="flex justify-start items-center">
                <div
                  class="monaco-editor-test"
                  data-test="scheduled-alert-threshold-operator-select"
                >
                  <q-select
                    v-model="triggerData.operator"
                    :options="triggerOperators"
                    color="input-border"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    class="showLabelOnTop no-case q-py-none"
                    filled
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="width: 88px; border: 1px solid rgba(0, 0, 0, 0.05)"
                    @update:model-value="updateTrigger"
                  />
                </div>
                <div
                  class="flex items-center"
                  style="border: 1px solid rgba(0, 0, 0, 0.05); border-left: none"
                >
                  <div
                    style="width: 89px; margin-left: 0 !important"
                    class=""
                    data-test="scheduled-alert-threshold-value-input"
                  >
                    <q-input
                      v-model="triggerData.threshold"
                      type="number"
                      :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                      dense
                      filled
                      min="1"
                      style="background: none"
                      debounce="300"
                      @update:model-value="updateTrigger"
                    />
                  </div>
                  <div
                    data-test="scheduled-alert-threshold-unit"
                    style="
                      min-width: 90px;
                      margin-left: 0 !important;
                      height: 40px;
                      font-weight: normal;
                    "
                    :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"

                    :class="
                      store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
                    "
                    class="flex justify-center items-center"
                  >
                    {{ t("alerts.times") }}
                  </div>
                </div>
              </div>
              <div
                data-test="scheduled-alert-threshold-error-text"
                v-if="!triggerData.operator || !Number(triggerData.threshold)"
                class="text-red-8 q-pt-xs"
                style="font-size: 11px; line-height: 12px"
              >
                Field is required!
              </div>
            </template>
          </div>
        </div>
        <div class="flex items-center q-mr-sm">
          <div
            data-test="scheduled-alert-period-title"
            class="tw-font-semibold flex items-center"
            style="width: 190px"
          >
            {{ t("alerts.period") + " *" }}
            <q-icon
              :name="outlinedInfo"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                <span style="font-size: 14px"
                  >Period for which the query should run.<br />
                  e.g. 10 minutes means that whenever the query will run it will
                  use the last 10 minutes of data. If the query runs at 4:00 PM
                  then it will use the data from 3:50 PM to 4:00 PM.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div
              class="flex items-center q-mr-sm"
              style="border: 1px solid rgba(0, 0, 0, 0.05); width: fit-content"
            >
              <div
                data-test="scheduled-alert-period-input"
                style="width: 87px; margin-left: 0 !important"
                class="period-input-container"
              >
                <q-input
                  v-model="triggerData.period"
                  :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                  type="number"
                  class="scheduled-alert-period-input"
                  dense
                  filled
                  min="1"
                  style="background: none"
                  debounce="300"
                  @update:model-value="updateTrigger"
                />
              </div>
              <div
                data-test="scheduled-alert-period-unit"
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 40px;
                  font-weight: normal;
                "
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              data-test="scheduled-alert-period-error-text"
              v-if="!Number(triggerData.period)"
              class="text-red-8 q-pt-xs"
              :class="{
                'q-field--error': triggerData.frequency_type == 'cron' && (triggerData.cron == '' || !triggerData.timezone)
              }"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>
        <div class="flex items-center q-mr-sm">
          <div
            data-test="scheduled-alert-cron-toggle-title"
            class="tw-font-semibold flex items-center"
            style="width: 172px"
          >
            {{ t("alerts.crontitle") + " *" }}
            <q-icon
              :name="outlinedInfo"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                <span style="font-size: 14px"
                  >Configure the option to enable a cron job.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div class="tw-pb-2">
            <div class="flex items-center q-mr-sm" style="width: fit-content">
              <div
                data-test="scheduled-alert-cron-input"
                style="width: 87px; margin-left: 0 !important"
                class=""
              >
                <q-toggle
                  data-test="scheduled-alert-cron-toggle-btn"
                  v-model="triggerData.frequency_type"
                  :true-value="'cron'"
                  class="q-mt-sm o2-toggle-button-sm tw-h-[36px] tw-ml-1"
                  :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
                  :false-value="'minutes'"
                  @update:model-value="updateTrigger"
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center q-mr-sm " style="min-height: 78px;">
          <div
            data-test="scheduled-alert-frequency-title"
            class="tw-font-semibold flex items-center"
            style="width: 190px;"
          >
            {{ t("alerts.frequency") + " *" }}
            <q-icon
              :name="outlinedInfo"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5 ' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="auto"
              >
                <span
                  style="font-size: 14px"
                  v-if="triggerData.frequency_type == 'minutes'"
                  >How often the task should be executed.<br />
                  e.g., 2 minutes means that the task will run every 2 minutes and
                  will be processed based on the other parameters provided.</span
                >
                <span style="font-size: 14px" v-else>
                  Pattern: * * * * * * means every second.
                  <br />
                  Format: [Second (optional) 0-59] [Minute 0-59] [Hour 0-23] [Day
                  of Month 1-31, 'L'] [Month 1-12] [Day of Week 0-7 or '1L-7L', 0
                  and 7 for Sunday].
                  <br />
                  Use '*' to represent any value, 'L' for the last day/weekday.
                  <br />
                  Example: 0 0 12 * * ? - Triggers at 12:00 PM daily. It specifies
                  second, minute, hour, day of month, month, and day of week,
                  respectively.</span
                >
              </q-tooltip>
            </q-icon>
            <template
              v-if="triggerData.frequency_type == 'cron' && showTimezoneWarning"
            >
              <q-icon
                :name="outlinedWarning"
                size="18px"
                class="cursor-pointer tw-ml-[8px]"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw-text-orange-500'
                    : 'tw-text-orange-500'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="auto"
                  class="tw-text-[14px]"
                >
                  Warning: The displayed timezone is approximate. Verify and
                  select the correct timezone manually.
                </q-tooltip>
              </q-icon>
            </template>
          </div>
          <div>
            <div class="flex items-center" style="width: fit-content">
              <div
                data-test="scheduled-alert-frequency-input"
                :style="
                  triggerData.frequency_type == 'minutes'
                    ? 'width: 87px; margin-left: 0 !important'
                    : 'width: fit-content !important'
                "
              >
                <q-input
                  data-test="scheduled-alert-frequency-input-field"
                  v-if="triggerData.frequency_type == 'minutes'"
                  :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                  v-model="triggerData.frequency"
                  type="number"
                  dense
                  filled
                  :min="
                    Math.ceil(
                      store.state?.zoConfig?.min_auto_refresh_interval / 60,
                    ) || 1
                  "
                  style="background: none; width: 100%;"
                  debounce="300"
                  class="tw-flex"
                  @update:model-value="updateTrigger"
                  :style="store.state.theme === 'dark' ? '' : 'border: 1px solid rgba(0, 0, 0, 0.05)'"
                />
                <div v-else class="tw-flex tw-items-center o2-input">
                  <q-input
                    data-test="scheduled-alert-cron-input-field"
                    v-model="triggerData.cron"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    dense
                    filled
                    :label="t('reports.cron') + ' *'"
                    style="background: none; width: 180px"
                    class="showLabelOnTop"
                    stack-label
                    outlined
                    debounce="300"
                    @update:model-value="updateTrigger"
                  />
                  <q-select
                    data-test="add-report-schedule-start-timezone-select"
                    v-model="triggerData.timezone"
                    :options="filteredTimezone"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    @blur="
                      browserTimezone =
                        browserTimezone == ''
                          ? Intl.DateTimeFormat().resolvedOptions().timeZone
                          : browserTimezone
                    "
                    use-input
                    @filter="timezoneFilterFn"
                    input-debounce="0"
                    dense
                    filled
                    emit-value
                    fill-input
                    hide-selected
                    :title="triggerData.timezone"
                    :label="t('logStream.timezone') + ' *'"
                    :display-value="`Timezone: ${browserTimezone}`"
                    class="timezone-select showLabelOnTop q-ml-sm"
                    stack-label
                    outlined
                    style="width: 210px"
                  />
                </div>
              </div>
              <div
                v-if="triggerData.frequency_type == 'minutes'"
                data-test="scheduled-alert-frequency-unit"
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 40px;
                  font-weight: normal;
                "
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"

                :class="store.state.theme === 'dark' ? 'bg-grey-10 input-border-dark' : 'bg-grey-2 input-border-light'"
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              data-test="scheduled-alert-frequency-error-text"
              v-show="
                (!Number(triggerData.frequency) &&
                  triggerData.frequency_type == 'minutes') ||
                (triggerData.frequency_type == 'cron' &&
                  (triggerData.cron == '' || !triggerData.timezone)) ||
                cronJobError
              "
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              {{ cronJobError || "Field is required!" }}
            </div>
          </div>

        </div>
      </div>
      <div class="col-12 flex justify-start items-center tw-pb-1">
                <div
                  class="q-py-sm showLabelOnTop tw-font-semibold text-h7  flex items-center"
                  data-test="add-alert-delay-title"
                  style="width: 190px"
                >
                  {{ t("alerts.silenceNotification") + " *" }}
                  <q-icon
                    :name="outlinedInfo"
                    size="17px"
                    class="q-ml-xs cursor-pointer"
                    :class="
                      store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                    "
                  >
                    <q-tooltip
                      anchor="center right"
                      self="center left"
                      max-width="300px"
                    >
                      <span style="font-size: 14px">
                        If the alert triggers then how long should it wait before
                        sending another notification.
                        <br />
                        e.g. if the alert triggers at 4:00 PM and the silence
                        notification is set to 10 minutes then it will not send
                        another notification until 4:10 PM even if the alert is
                        still after 1 minute. This is to avoid spamming the user
                        with notifications.</span
                      >
                    </q-tooltip>
                  </q-icon>
                </div>
                <div>
                  <div class="col-8 row justify-left align-center q-gutter-sm">
                    <div
                      class="flex items-center"
                      style="border: 1px solid rgba(0, 0, 0, 0.05)"
                    >
                      <div
                        data-test="add-alert-delay-input"
                        style="width: 87px; margin-left: 0 !important"
                        class=""
                      >
                        <q-input
                          v-model="triggerData.silence"
                          :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                          type="number"
                          dense
                          filled
                          min="0"
                          style="background: none"
                          @update:model-value="updateTrigger"
                        />
                      </div>
                      <div
                        data-test="add-alert-delay-unit"
                        style="
                          min-width: 90px;
                          margin-left: 0 !important;
                          background: #f2f2f2;
                          height: 40px;
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
                  </div>
                  <div
                    data-test="add-alert-delay-error"
                  v-if="triggerData.silence < 0 || triggerData.silence === undefined || triggerData.silence === null || triggerData.silence === ''"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
      </div>
      <div class="o2-input flex justify-start q-mt-xs items-start">
                <div
                  data-test="add-alert-destination-title"
                  class="tw-font-semibold"
                  style="width: 190px"
                >
                  {{ t("alerts.destination") + " *" }}
                </div>
                <div data-test="add-alert-destination-select">
                  <q-select
                    ref="destinationSelectRef"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    v-model="destinations"
                    :options="filteredDestinations"
                    :input-debounce="300"
                    color="input-border"
                    bg-color="input-bg"
                    class="no-case"
                    stack-label
                    outlined
                    filled
                    dense
                    multiple
                    use-input
                    fill-input
                    :rules="[(val: any) =>{
                      return val.length > 0 || 'Field is required!'
                    }]"
                    hide-bottom-space
                    :required="true"
                    style="width: 200px"
                    @filter="filterDestinations"
                    @update:model-value="updateDestinations"
                    @popup-show="isDestinationDropdownOpen = true"
                    @popup-hide="isDestinationDropdownOpen = false"
                  >
                    <q-tooltip
                      v-if="!isDestinationDropdownOpen && destinations.length > 0"
                      anchor="top middle"
                      self="bottom middle"
                      :offset="[0, 8]"
                      max-width="300px"
                    >
                      {{ destinations }}
                    </q-tooltip>
                    <template v-slot:option="option">
                      <q-list dense>
                        <q-item
                          tag="label"
                          :data-test="`add-alert-destination-${option.opt}-select-item`"
                        >
                          <q-item-section avatar>
                            <q-checkbox
                              size="xs"
                              dense
                              v-model="destinations"
                              :val="option.opt"
                              @update:model-value="updateDestinations"
                            />
                          </q-item-section>
                          <q-item-section>
                            <q-item-label class="ellipsis"
                              >{{ option.opt }}
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                      </q-list>
                    </template>
                  </q-select>
                </div>
                <div class="q-pl-sm">
                  <q-btn
                    data-test="create-destination-btn"
                    icon="refresh"
                    title="Refresh latest Destinations"
                    class="text-bold no-border"
                    no-caps
                    flat
                    dense
                    @click="$emit('refresh:destinations')"
                  />
                </div>
                <div class="q-pl-sm">
                  <q-btn
                    data-test="create-destination-btn"
                    label="Add New Destination"
                    class="text-bold no-border"
                    color="primary"
                    no-caps
                    @click="routeToCreateDestination"
                  />
                </div>
      </div>
      </div>
  </div>


   <!-- second section multi window selection -->
   <div class="tw-w-full tw-mt-2">
    <div class="tw-w-full tw-ml-2">
        <AlertsContainer 
          name="Multi Window"
          v-model:is-expanded="expandState.multiWindowSelection"
          label="Multi Window"
          subLabel="Set relative alerting system based on SQL query"
        class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2 "
        :iconClass="'tw-mt-[2px]'"
          :image="multiWindowImage"
          @update:is-expanded="()=>emits('update:expandState', expandState)"
        />  
    </div>

      <div class="tw-w-full row alert-setup-container " 
    v-if="expandState.multiWindowSelection"
    style=" margin-left: 8px;"
    :class="store.state.theme === 'dark' ? 'dark-mode-multi-window' : 'light-mode-multi-window'"
    >

      <div class=" q-mt-sm tw-w-full">

        <!-- current window -->
        <div class="multi-window-text tw-flex tw-items-center tw-gap-2 q-py-sm q-mt-md">
            <span>Alert set for</span>
            <div class=" tw-h-px border-line tw-flex-1"></div>
          </div>
          <div class="tw-flex tw-flex-col lg:tw-flex-row tw-justify-between tw-items-start multi-window-container   q-px-md q-py-sm ">
            <div class="multi-window-text tw-w-full tw-text-center lg:tw-w-auto lg:tw-text-left">
              Current window 
            </div>
            <div class="tw-flex lg:tw-flex-col  tw-items-start tw-gap-2">
              <div class="multi-window-text tw-w-full tw-text-center lg:tw-w-auto lg:tw-text-left">
                Cycle
                <span class="tw-cursor-pointer"> <q-icon :name="outlinedInfo" size="17px" class="q-ml-xs cursor-pointer" :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'">
                  <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px;">
                    Compare results with the same time in the previous cycle.
                  </q-tooltip> 
                  </q-icon>
                </span>
              </div>
              <div class="tw-flex tw-justify-between tw-items-start tw-gap-4 ">
                <div class="tw-w-full lg:tw-w-[300px] running-text">
                  Running for {{ convertMinutesToDisplayValue(triggerData.period) }} in the interval of every {{
                  triggerData.frequency_type == 'minutes' ? convertMinutesToDisplayValue(triggerData.frequency) : convertMinutesToDisplayValue(getCronIntervalInMinutes(triggerData.cron)) 
                    }}
                </div>
                <div>
                  <q-btn class="tw-rounded-full" flat dense icon="edit_outline" size="16px" @click="editCurrentWindow">
                    <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px;">
                      Edit Period and Frequency.
                    </q-tooltip>
                  </q-btn>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class=" q-mt-sm tw-w-full ">
          <!-- current multi time range comparision window -->
            <div v-if="dateTimePicker.length > 0"  class="multi-window-text tw-flex tw-items-center tw-gap-2 q-py-sm q-mt-sm">
              <span>Comparing with</span>
              <div class=" tw-h-px border-line tw-flex-1"></div>
            </div>
            <div  v-for="(picker, index) in dateTimePicker" 
              :key="index" 
              class="tw-flex  tw-flex-col lg:tw-flex-row tw-justify-between tw-items-start reference-window-container tw-mt-2  q-px-md q-py-sm  ">
              <div class="multi-window-text tw-w-full tw-text-center lg:tw-w-auto lg:tw-text-left">
                Reference Window {{ index + 1 }}
              </div>
              <div class="tw-flex lg:tw-flex-col tw-gap-2 lg:tw-gap-0 tw-items-start tw-justify-between tw-h-20">
                <div class="tw-flex tw-items-center">
                  <span class="tw-mr-1"><q-icon name="schedule" size="16px" /></span>
                  Time Frame 
                  <span class="tw-ml-2 tw-cursor-pointer"> <q-icon :name="outlinedInfo" size="17px" class="q-ml-xs cursor-pointer" :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'">
                    <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px;">
                      Time range for your query.
                    </q-tooltip>
                    </q-icon>
                  </span>
                </div>
                <CustomDateTimePicker
                      v-model="picker.offSet"
                      :picker="picker"
                      :isFirstEntry="false"
                      @update:model-value="updateDateTimePicker"
                      :changeStyle="true"
                    />
              </div>
              <div class="tw-flex lg:tw-flex-col tw-items-start tw-gap-2">
                <div class="multi-window-text tw-w-full tw-text-center lg:tw-w-auto lg:tw-text-left">
                    Cycle
                    <span class="tw-cursor-pointer"> <q-icon :name="outlinedInfo" size="17px" class="q-ml-xs cursor-pointer" :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'">
                      <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px;">
                      Compare results with the same time in the previous cycle.
                    </q-tooltip>
                    </q-icon>
                    </span>
                  </div>
                <div class="tw-flex tw-justify-between tw-items-start tw-gap-4 ">
                  <div class="tw-w-full lg:tw-w-[300px] reference-text">
                    Comparing current window query result with query result from previous {{ getDisplayValue(picker.offSet) }}.
                  </div>
                  <div>
                    <q-btn
                      data-test="multi-time-range-alerts-delete-btn"
                      :icon="outlinedDelete"
                      class="iconHoverBtn q-ml-xs q-mr-sm"
                      :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                      padding="xs"
                      unelevated
                      size="16px"
                      round
                      flat
                      :title="t('alert_templates.delete')"
                      @click="removeTimeShift(index)"
                      style="min-width: auto"
                    />
                  </div>
                </div>
              </div>
        </div>

    <!-- add comparision window button -->
      <div class="tw-w-full tw-flex tw-justify-center q-mt-sm ">
        <div class="tw-w-fit tw-flex tw-justify-center tw-border tw-border-gray-200 ">
        <q-btn
          data-test="multi-time-range-alerts-add-btn"
          label="Add Comparision Window"
          size="sm"
          class="text-semibold add-variable q-pa-sm multi-window-text no-border  "
          style="font-size: 14px;"
          no-caps
          @click="addTimeShift"
        >
          <q-icon :class="store.state.theme === 'dark' ? 'tw-text-white  tw-font-bold q-ml-sm' : 'tw-text-black tw-font-bold q-ml-sm'" name="add" size="20px" />
        </q-btn>
      </div>
      </div>

    </div>
      </div>
  </div>


   <!-- third section -->
   <div class="tw-w-full tw-mt-2">
    <div class="tw-w-full tw-ml-2">
      <AlertsContainer 
          name="query"
          v-model:is-expanded="expandState.queryMode"
          label="Conditions"
          :image="conditionsImage"
          subLabel="What should trigger the alert."
          class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2 "
          :iconClass="'tw-mt-[2px]'"
          @update:is-expanded="()=>emits('update:expandState', expandState)"
        />
    </div>
    <div v-if="expandState.queryMode" class="  tw-w-full row alert-setup-container " style=" margin-left: 8px;">

      <!-- query mode section -->
      <div class="tw-w-full" style="">
        <div v-if="!disableQueryTypeSelection" class="scheduled-alert-tabs q-my-md"
        :style="{
          width: alertData.stream_type === 'metrics' ? '400px' : '200px'
        }"
        :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
        >
        <q-tabs
          data-test="scheduled-alert-tabs"
          v-model="tab"
          no-caps
          outside-arrows
          size="sm"
          mobile-arrows
          class="bg-white text-primary"
          @update:model-value="updateTab"
        >
          <q-tab
            :disable="dateTimePicker.length > 0"
            data-test="scheduled-alert-custom-tab"
            name="custom"
            :label="t('alerts.quick')"
            >
            <q-tooltip max-width="200px" style="font-size: 12px;" v-if="dateTimePicker.length > 0">
              Quick mode is disabled when comparision window is added.
            </q-tooltip>
          </q-tab>
          <q-tab
            data-test="scheduled-alert-sql-tab"
            name="sql"
            :label="t('alerts.sql')"
          />
          <q-tab
          :disable="dateTimePicker.length > 0"
            data-test="scheduled-alert-metrics-tab"
            v-if="alertData.stream_type === 'metrics'"
            name="promql"
            :label="t('alerts.promql')"
          />
        </q-tabs>
        </div>
        <template v-if="tab === 'custom'" class='q-pa-none q-ma-none' ">
          <FilterGroup :stream-fields="columns" :group="inputData " :depth="0" @add-condition="updateGroup" @add-group="updateGroup" @remove-group="removeConditionGroup" @input:update="(name, field) => emits('input:update', name, field)" />

          

        </template>
        <template v-else>
          <!-- view section -->
          <div class="tw-w-full tw-flex lg:tw-flex-col tw-flex-col tw-gap-2" :class="store.state.theme === 'dark' ? 'dark-mode-view' : 'light-mode-view'">
            <div class="tw-flex tw-justify-between tw-items-center tw-w-full editor-container tw-px-2 tw-py-3 ">
            <div class="tw-flex tw-items-start">
              <div :class="[
                store.state.theme === 'dark' ? 'tw-bg-gray-600' : 'tw-bg-gray-200'
              ]" class="tw-flex tw-items-center tw-gap-2 tw-bg-gray-200 tw-rounded-full tw-px-1 tw-py-1 tw-mr-2" >
                <img :src="sqlEditorImage" style="width: 16px; height: 16px;" />

              </div>
              <div class="tw-flex tw-flex-col">
                <span style="font-size: 16px;">Editor</span>
                <span style="font-size: 14px;">Create SQL and VRL triggers with specific conditions.</span>
              </div>

            </div>
            <div>
              <q-btn
                data-test="alert-variables-add-btn"
                label="View Editor"
                size="sm"
                class="text-bold add-variable no-border q-py-sm xl:tw-w-[130px] tw-w-[85px]"
                color="primary"
                style="
                  border-radius: 4px;
                  text-transform: capitalize;
                  color: #fff !important;
                  font-size: 12px;
                "
                @click="viewSqlEditor = true"
                />
            </div>
          </div>
          </div>

        </template>
      </div>
    </div>
  </div>

   <!-- used for showing sql editor and vrl editor in modal -->
  <q-dialog
    v-model="viewSqlEditor"
    position="right"
    full-height
    maximized
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
  <div class="tw-flex tw-h-full editor-dialog-card tw-pl-1">


    <div  class="tw-h-full  tw-flex tw-pr-1 "
    :style="{
      width: isFullScreen  ? '100vw' : store.state.isAiChatEnabled ? '65vw' : '90vw'
    }"
    >
      <div class="tw-h-full tw-w-full tw-px-2 tw-py-2 "
      >
      <div class="tw-h-8 tw-flex tw-items-center tw-justify-between" style="font-size: 20px ;">
        <div class="tw-flex tw-items-center tw-gap-2">
          <div
          data-test="add-alert-back-btn"
          class="flex justify-center items-center cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="viewSqlEditor = false"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
          <span class="tw-text-[18px] tw-font-[400]">Add Conditions</span>
        </div>
        <div class="tw-flex tw-items-center">

          <q-btn
            v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
            :ripple="false"
            @click="toggleAIChat"
            data-test="menu-link-ai-item"
            no-caps
            :borderless="true"
            flat
            dense
            class="o2-button ai-hover-btn q-px-sm q-py-sm q-mr-sm"
            :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
            style="border-radius: 100%;"
            @mouseenter="isHovered = true"
            @mouseleave="isHovered = false"

          >
            <div class="row items-center no-wrap tw-gap-2  ">
              <img  :src="getBtnLogo" class="header-icon ai-icon" />
            </div>
          </q-btn>
          <q-btn 
            icon="fullscreen" 
            size="16px" 
            dense 
            class="tw-cursor-pointer" 
            :class="store.state.theme === 'dark' ? 'tw-text-white' : ''"
            :color="isFullScreen ? 'primary' : undefined"
            @click="() => isFullScreen = !isFullScreen" 
          />

        </div>
      </div>
      <q-separator class="tw-my-2"/>
        <!-- new section updated -->
      <div class="tw-grid tw-h-[calc(100vh-100px)] tw-w-full tw-grid-cols-[60%_40%] tw-gap-x-2">
        <!-- Left Section (60%) -->
         <div class="tw-flex tw-w-full">
        <div class="tw-flex tw-w-full tw-flex-col tw-h-full tw-gap-y-2">
          <!-- first sub section -->
          <div class="tw-flex-[3] tw-w-full">
            <div class="tw-w-full tw-h-full " :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
                <div  class="tw-flex tw-items-center tw-justify-between tw-pb-2 tw-pt-1">
  
                    <span class="editor-text-title">{{  tab === 'sql' ? 'SQL Editor' : 'PromQL Editor' }}</span>
                    <div class="tw-flex tw-gap-2 tw-items-center tw-h-6 ">
                      <div style="border: 1px solid #7980cc; border-radius: 4px; height: 32px;">
                        <q-btn
                          data-test="alert-variables-add-btn"
                          size="sm"
                          no-caps
                          dense
                          flat
                          class="text-bold no-border"
                            @click="toggleAIChat"
                        >
                          <img :style="{
                            width: '16px',
                            height: '16px',
                          }" :src="getBtnO2Logo" />
                          <span  
                          class=" tw-font-[400] tw-pl-[4px] tw-text-[12px] tw-pr-[6px] tw-py-[4px] tw-text-[#7980cc]" 
                          >Generate SQL</span>
                      </q-btn>
                      </div>
                      <div class="tw-h-full tw-flex tw-justify-center tw-items-center o2-select-input o2-input tw-w-full col"
                      style="padding-top: 0"                       >
                        <q-select
                          v-model="selectedColumn"
                          :options="filteredFields"
                          data-test="dashboard-use-saved-vrl-function"
                          input-debounce="0"
                          behavior="menu"
                          use-input
                          filled
                          borderless
                          dense
                          hide-selected
                          menu-anchor="bottom left"
                          fill-input
                          @filter="
                              (val: string, update: any) => filterFields(val, update)
                            "
                          @update:modelValue="onColumnSelect"
                          class="mini-select "
                          input-style="height: 12px; min-height: 8px; margin: 0px; width: 120px;  "
                          placeholder="Search for a field"
                          style="width: 150px;"
                    >
                        <template #no-option>
                          <q-item dense>
                            <q-item-section> {{ t("search.noResult") }}</q-item-section>
                          </q-item>
                        </template>
                        </q-select>

                       </div>
   
                      <div>
                        <q-btn
                          data-test="alert-variables-add-btn"
                          size="sm"
                          no-caps
                          style="height: 32px;"
                          class="text-bold add-variable no-border q-py-sm"
                          color="primary"
                          @click="tab === 'sql' ? runSqlQuery() : runPromqlQuery()"
                          :disable="tab == 'sql' ? query == '' : promqlQuery == ''"
                        >
                          <q-icon name="search" size="20px" />
                          <span class="tw-text-[12px] tw-font-[400]">Run Query</span>
                      </q-btn>
                      </div>
                    </div>
                  </div>
                  <FullViewContainer
                    name="Input"
                    label="Input"
                    :isExpanded="true"
                    :showExpandIcon="false"
                    :label-class="'tw-ml-2'"
                    class="tw-mt-1"
                  >
                  <template #right>
                    <div v-if="alertData.stream_name" class="tw-text-[12px] tw-font-semibold tw-mr-2">
                      on <span class="tw-text-[14px] tw-font-bold">{{ alertData.stream_name }}</span> stream
                    </div>
                    <div v-else class="tw-text-[12px] tw-font-semibold tw-mr-2">
                      No Stream Selected                    </div>
                  </template>
                </FullViewContainer>
                    <query-editor
                      v-if="tab === 'sql'"
                      data-test="scheduled-alert-sql-editor"
                      ref="queryEditorRef"
                      editor-id="alerts-query-editor"
                      class="tw-w-full  "
                      :debounceTime="300"
                      v-model:query="query"
                      :class="[
                        query === '' && queryEditorPlaceholderFlag ? 'empty-query' : '',
                        store.state.theme === 'dark' ? 'dark-mode dark-mode-editor' : 'light-mode light-mode-editor',
                      ]"
                      @update:query="updateQueryValue"
                      @focus="queryEditorPlaceholderFlag = false"
                      @blur="onBlurQueryEditor"
                      style="min-height: 18rem;"
                      :style="{
                            height: !!sqlQueryErrorMsg ? 'calc(100% - 150px)' : 'calc(100% - 80px)'
                      }"
                    />

                    <div style="height: 50px; overflow: auto;" v-show="!!sqlQueryErrorMsg && tab === 'sql'" class="text-negative q-py-sm invalid-sql-error">
                    <span v-show="!!sqlQueryErrorMsg">
                      Error: {{ sqlQueryErrorMsg }}</span
                    >
                  </div>
                  <!-- this is promql editor -->
                    <query-editor
                        v-if="tab === 'promql'"
                        v data-test="scheduled-alert-promql-editor"
                        ref="queryEditorRef"
                        editor-id="alerts-query-editor-dialog"
                        class="tw-w-full"
                        :debounceTime="300"
                        v-model:query="promqlQuery"
                        @update:query="updateQueryValue"
                      :class="[
                        promqlQuery === '' ? 'empty-query' : '',
                        store.state.theme === 'dark' ? 'dark-mode-editor dark-mode' : 'light-mode-editor light-mode',
                        'tw-h-[calc(100%-62px)]'
                      ]"
                      @blur="onBlurQueryEditor"
                      style="min-height: 10rem;"
                    />
                  </div>
          </div>
          <!-- second sub section -->
          <div v-if="tab !== 'promql'" class="tw-flex-[2] tw-w-full">
            <div class="tw-w-full tw-h-full " :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
              <div  class="tw-flex tw-items-center tw-justify-between tw-pb-1 tw-pt-1">
                      
                      <span class="editor-text-title">VRL Editor</span>
                      <div class="tw-flex tw-gap-2 tw-items-center">
                        <div style="border: 1px solid #7980cc; border-radius: 4px; height: 32px;">
                          <q-btn
                          data-test="alert-variables-add-btn"
                          size="sm"
                          no-caps
                          dense
                          flat
                          class="text-bold no-border"
                            @click="toggleAIChat"
                        >
                          <img :style="{
                            width: '16px',
                            height: '16px',
                          }" :src="getBtnO2Logo" />
                          <span  
                          class=" tw-font-[400] tw-pl-[4px] tw-text-[12px] tw-pr-[6px] tw-py-[4px] tw-text-[#7980cc]" 
                          >Generate VRL</span>
                      </q-btn>
                      </div>
                        <div class="tw-h-full tw-flex tw-justify-center tw-items-center o2-select-input o2-input tw-w-full col"
                        style="padding-top: 0;"                       >
                          <q-select
                          v-model="selectedFunction"
                          :options="functionOptions"
                          data-test="dashboard-use-saved-vrl-function"
                          input-debounce="0"
                          behavior="menu"
                          use-input
                          filled
                          borderless
                          dense
                          hide-selected
                          menu-anchor="bottom left"
                          fill-input
                          option-label="name"
                          option-value="name"
                          @filter="filterFunctionOptions"
                          @update:modelValue="onFunctionSelect"
                          class="mini-select"
                          clearable
                          @clear="onFunctionClear"
                          style="width: 150px;"
                          placeholder="Saved functions"
                          input-style="height: 12px; min-height: 8px; margin: 0px; width: 120px;  "
                                                >
                          <template #no-option>
                        <q-item>
                          <q-item-section> {{ t("search.noResult") }}</q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                        </div>
                        <div>
                          <q-btn
                            data-test="alert-variables-add-btn"
                            size="sm"
                            class="text-bold add-variable no-border q-py-sm"
                            color="primary"
                            no-caps
                            @click="runTestFunction"
                            :disable="vrlFunctionContent == ''"
                            style="height: 32px;"
                          >
                            <q-icon name="search" size="18px" />
                            <span class="tw-text-[12px] tw-font-[400]">Apply VRL</span>
                        </q-btn>
                        </div>
                      </div>
                    </div>
                    <FullViewContainer
                    name="Input"
                    label="Input"
                    :isExpanded="true"
                    :showExpandIcon="false"
                    :label-class="'tw-ml-2'"
                    class="tw-mt-1"
                  ></FullViewContainer>
                  <query-editor
                      data-test="scheduled-alert-vrl-function-editor"
                      ref="fnEditorRef"
                      editor-id="fnEditor-dialog"
                      class="tw-w-full tw-h-[calc(100%-80px)]  "
                      :debounceTime="300"
                      v-model:query="vrlFunctionContent"
                      :class="[
                        vrlFunctionContent == '' && functionEditorPlaceholderFlag
                          ? 'empty-function'
                          : ''
                          ,
                          store.state.theme === 'dark' ? 'dark-mode-editor dark-mode' : 'light-mode-editor light-mode'
                      ]"
                      @focus="functionEditorPlaceholderFlag = false"
                      @blur="onBlurFunctionEditor"
                      style="min-height: 15rem;"
                    />
                  </div>
          </div>
          
        </div>
        <q-separator vertical class="q-ml-sm" />
        </div>
        <!-- Right Section (40%) -->
        <div class="tw-flex tw-flex-col tw-h-full tw-p-2 tw-gap-y-2 tw-overflow-y-hidden"
        :class="store.state.theme === 'dark' ? 'tw-bg-[#374151]' : 'tw-bg-[#F4F4F5]'"
        >
          <div class=" tw-w-full"
          :class="expandCombinedOutput ? 
          expandSqlOutput && tab == 'sql' ?  'tw-flex-1 tw-h-[calc(50%-24px)]' : tab != 'sql' ? 'tw-flex-1 tw-h-[calc(100%-24px)]' : 'tw-h-[24px]' : 
          expandSqlOutput ? 'tw-flex-1 tw-h-[calc(100%-24px)]' : 'tw-h-[24px]'"
          >
            <div class="tw-flex tw-items-center tw-justify-between tw-w-[100%] tw-gap-2">
              <FullViewContainer
                name="Output"
                label="Output"
                class="tw-w-full"
                :isExpanded="expandSqlOutput"
                @update:isExpanded="expandSqlOutput = $event"
                
              >
              <template #right>
              <div class="tw-flex tw-items-center tw-justify-center tw-text-[12px] tw-font-semibold tw-mr-2"
              :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-[#6B7280]'"
              >
              Results include all multi-window additions
              </div>
            </template>
          </FullViewContainer>
            </div>
          <div v-if="expandSqlOutput" class="tw-h-[calc(100%-0px)] tw-overflow-y-hidden" >
            <!-- no output before run query section --> 
            <div v-if="!tempRunQuery && outputEvents == ''"  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] tw-w-full  no-output-before-run-query">
              <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                <q-icon
                  :name="outlinedLightbulb"
                  size="40px"
                  :class="store.state.theme === 'dark' ? 'tw-text-[#FB923C]' : 'tw-text-[#FB923C]'"
                />
                <div>
                  <span>Please click Run Query to see the output</span>
                </div>
              </div>
            </div>
            <div v-else-if="(outputEvents == '') && !runQueryLoading "  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)]  no-output-before-run-query">
              <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                <q-icon
                  :name="outlinedWarning"
                  size="40px"
                  class="tw-text-orange-400"
                />
                <div>
                  <span> {{ runPromqlError ? runPromqlError : "No results found" }}</span>
                </div>
              </div>
            </div>
            <div v-else-if="runQueryLoading"  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] ">
                <q-spinner-hourglass color="primary" size="40px" />
                <div class="tw-text-sm tw-text-gray-500">
                  Fetching Search Results...
                </div>
            </div>

            <query-editor
              v-else-if="expandSqlOutput "
              class="tw-w-full tw-h-[calc(100%-24px)] tw-overflow-y-auto"
              data-test="sql-output-editor"
              ref="outputEventsEditorRef"
              editor-id="sql-output-editor"            
              language="json"
              :read-only="true"
              v-model:query="outputEvents"
              style="min-height: 10rem; overflow-y: auto;"

            />
          </div>
          </div>

          <div class="tw-w-full"
          :class="expandSqlOutput ? 
          expandCombinedOutput ?  'tw-flex-1 tw-h-[calc(50%-24px)]' : 'tw-flex-1tw-h-[calc(100%-24px)]' 
          : expandCombinedOutput ? 'tw-flex-1 tw-h-[24px]' : 'tw-flex-1 tw-h-[calc(100%-24px)]'"
          >
            <div v-if="tab !== 'promql'" class="tw-flex tw-flex-col tw-items-start tw-justify-between tw-h-fit">
            <FullViewContainer
              name="Combined Output"
              label="Combined Output"
              :isExpanded="expandCombinedOutput"
                class="tw-w-full"
              @update:isExpanded="expandCombinedOutput = $event"
            >
            <template #right>
              <div class="tw-flex tw-items-center tw-justify-center tw-text-[12px] tw-font-semibold tw-mr-2"
              :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-[#6B7280]'"
              >
                SQL + VRL
              </div>
            </template>
          </FullViewContainer>
          </div>
          <div v-if="expandCombinedOutput && tab !== 'promql'" class="tw-h-full">
            <div v-if="!tempTestFunction && !runFnQueryLoading"  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] tw-w-full  no-output-before-run-query">
              <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                <q-icon
                  :name="outlinedLightbulb"
                  size="40px"
                  :class="store.state.theme === 'dark' ? 'tw-text-[#FB923C]' : 'tw-text-[#FB923C]'"
                />
                <div>
                  <span>Please click Apply VRL to see the combined output</span>
                </div>
              </div>
            </div>
            <div v-else-if="(outputFnEvents == '') && !runFnQueryLoading && tempTestFunction"  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)]  no-output-before-run-query">
              <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                <q-icon
                  :name="outlinedWarning"
                  size="40px"
                  class="tw-text-orange-400"
                />
                <div>
                  <span>No results found</span>
                </div>
              </div>
            </div>
            <div v-else-if="runFnQueryLoading"  class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] ">
                <q-spinner-hourglass color="primary" size="40px" />
                <div class="tw-text-sm tw-text-gray-500">
                  Fetching Search Results...
                </div>
            </div>
            <query-editor
              v-else
              class="tw-w-full tw-h-[calc(100%-24px)]"
              data-test="vrl-function-test-events-output-editor"
              ref="outputEventsEditorRef"
              editor-id="test-function-events-output-editor"
              language="json"
              :read-only="true"
              v-model:query="outputFnEvents"
              style="min-height: 10rem;"
            />
          </div>
          </div>
        </div>
      </div>



      </div>



    </div>
    <div  class="q-ml-sm " v-if="store.state.isAiChatEnabled " style="width: 24.5vw; max-width: 100%; min-width: 75px;  " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
      <O2AIChat :header-height="48" :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" style="height: calc(100vh - 0px) !important;" />
    </div>

  </div>

  </q-dialog>



  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, defineAsyncComponent, onMounted } from "vue";
import FieldsInput from "@/components/alerts/FieldsInput.vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  outlinedDelete,
  outlinedInfo,
  outlinedLightbulb,
  outlinedWarning,
} from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";
import {
  getImageURL,
  useLocalTimezone,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  getUUID,
  b64EncodeUnicode,
  getCronIntervalInMinutes,
} from "@/utils/zincutils";
import { useQuasar } from "quasar";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
  import FilterGroup from "./FilterGroup.vue";

import searchService from "@/services/search";

import AlertsContainer from "./AlertsContainer.vue";
import useQuery from "@/composables/useQuery";
import { debounce, pick } from "lodash-es";
import config from "@/aws-exports";
import O2AIChat from "../O2AIChat.vue";

import FullViewContainer from "@/components/functions/FullViewContainer.vue";

import useParser from "@/composables/useParser";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
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
  "sqlQueryErrorMsg",
  "disableThreshold",
  "disableVrlFunction",
  "disableQueryTypeSelection",
  "vrlFunctionError",
  "showTimezoneWarning",
  "multi_time_range",
  "expandState",
  "silence",
  "destinations",
  "formattedDestinations",
  "selectedStream",
  "selectedStreamType"
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
  "update:multi_time_range",
  "update:expandState",
  "field:addConditionGroup",
  "update:silence",
  "refresh:destinations",
  "update:destinations",
  "update:group",
  "remove:group"
]);

const { t } = useI18n();
const { buildQueryPayload } = useQuery();

const triggerData = ref(props.trigger);

const inputData = ref(props.conditions);

const query = ref(props.sql);

const promqlQuery = ref(props.promql);

const router = useRouter();

const tab = ref(props.query_type || "custom");

const q = useQuasar();

const store = useStore();

const functionEditorPlaceholderFlag = ref(true);

const queryEditorPlaceholderFlag = ref(true);

const isFunctionErrorExpanded = ref(false);

const { sqlParser } = useParser();

const tempTestFunction = ref(false);
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

const silence = ref(props.silence);


const aggregationData = ref(props.aggregation);

const destinations = ref(props.destinations);

const destinationSelectRef = ref<any>(null);

const isFullScreen = ref(false);

const viewSqlEditor = ref(false);

const viewVrlFunction = ref(false);

const expandSqlOutput = ref(true);

const expandCombinedOutput = ref(true);

const filteredDestinations = ref(props.formattedDestinations)

const filteredFields = ref(props.columns);

const selectedStream = ref(props.selectedStream);
const selectedStreamType = computed(() => props.selectedStreamType);
const fnEditorRef = ref<any>(null);

const tempRunQuery = ref(false);

const runQueryLoading = ref(false);

const isHovered = ref(false);

const runPromqlError = ref("");

const scheduledAlertRef = ref<any>(null);

const runFnQueryLoading = ref(false);

const selectedColumn = ref<any>({
  label: "",
  value: ""
});

const filteredTimezone: any = ref([]);

const outputEvents = ref("");

const outputFnEvents = ref("");

const cronJobError = ref("");

const expandState = ref(props.expandState);

const isDestinationDropdownOpen = ref(false);

onMounted(()=>{
  if(dateTimePicker.value.length > 0){
    tab.value = 'sql'
  }
})

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

const filteredNumericColumns = ref(getNumericColumns.value);

const addField = (groupId: string) => {
  emits("field:add", groupId);
};

const addConditionGroup = (groupId: string) => {
  emits("field:addConditionGroup", groupId);
};

const updateDateTimePicker = (data: any) => {
  emits("update:multi_time_range", dateTimePicker.value);
};

const removeTimeShift = (index: any) => {
  dateTimePicker.value.splice(index, 1);
};

var triggerOperators: any = ref(["=", "!=", ">=", "<=", ">", "<"]);
let relativePeriods = [
      { label: "Seconds", value: "s" },
      { label: "Minutes", value: "m" },
      { label: "Hours", value: "h" },
      { label: "Days", value: "d" },
      { label: "Weeks", value: "w" },
      { label: "Months", value: "M" },
    ];


const selectedFunction = ref("");

const currentTimezone =
  useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;

const browserTimezone = ref(currentTimezone);

// @ts-ignore
let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
  return tz;
});

filteredTimezone.value = [...timezoneOptions];

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

const timezoneFilterFn = (val: string, update: Function) => {
  filteredTimezone.value = filterColumns(timezoneOptions, val, update);
};

const removeField = (field: any) => {
  emits("field:remove", field);
};

const updateQueryValue = (value: string) => {
  query.value = value;

  if (tab.value === "sql") emits("update:sql", value);
  if (tab.value === "promql") emits("update:promql", value);

  emits("input:update", "query", value);
};

const updateTrigger = () => {
  cronJobError.value = "";
  validateFrequency(triggerData.value);

  emits("update:trigger", triggerData.value);
  emits("input:update", "period", triggerData.value);
};

const updateTab = () => {
  updateQuery();
  updateAggregationToggle();
  emits("update:query_type", tab.value);
  emits("input:update", "query_type", tab.value);
};

const getDefaultPromqlCondition = () => {
  return {
    column: "value",
    operator: ">=",
    value: 0,
  };
};

const testFields  = ref(
 [
    {
      uuid: "1",
      parent_id: "1",
      column: "temperature",
      operator: ">",
      value: "30",
      condition: "AND"

    },
    {
      uuid: "3",
      column: "temperature",
      operator: ">",
      value: "40",
      condition: "AND"
    },
    {
      uuid: "4",
      column: "temperature",
      operator: ">",
      value: "40",
      condition: "AND"
    },
    {
      children: [
        {
          uuid: "5",
          column: "temperature",
          operator: ">",
          value: "40",
          condition: "AND"
        }
      ]
    }
  ]
);




const onFunctionSelect = (_function: any) => {
  if(!_function){
    return;
  }
  selectedFunction.value = _function.name;
  vrlFunctionContent.value = _function.function;
};

const functionsList = computed(() => store.state.organizationData.functions);
const dateTimePicker = ref(props.multi_time_range || []);

const selectedMultiWindowOffset = ref<any[]>([]);

const functionOptions = ref<any[]>([]);

watch(
  () => functionsList.value,
  (functions: any[]) => {
    functionOptions.value = [...functions];
  },
);
watch(()=> destinations.value, (newVal, oldVal)=>{
  //check if the newVal length is greater than oldVal length
  //then if any filter is applied then clear the input
  if(newVal.length > oldVal.length){
    //have to clear the input
    //this runs every time if users types or not because setting the previous value ('') to ('') is same
    destinationSelectRef.value.updateInputValue('');
  }
})

const vrlFunctionContent = computed({
  get() {
    return props.vrl_function || "";
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
    updateFunctionVisibility(value);
  },
});

const updateFunctionVisibility = (isEnabled: boolean) => {
  if (!isEnabled) {
    vrlFunctionContent.value = null;
    selectedFunction.value = "";
  }
};

const updateQuery = () => {
  if (tab.value === "promql") {
    const condition = !props.promql_condition
      ? getDefaultPromqlCondition()
      : props.promql_condition;
    promqlCondition.value = condition;
    emits("update:promql_condition", condition);
    promqlQuery.value = props.promql;
  }

  if (tab.value === "sql") query.value = props.sql;
};
const addTimeShift = () => {
  if(dateTimePicker.value.length == 0){
    tab.value = 'sql'
    updateTab();
  }
  const newTimeShift = {
    offSet: "15m",
    uuid: getUUID(),
    data: {
      selectedDate: {
        relative: {
          value: 15,
          period: "m",
          label: "Minutes",
        },
      },
    },
  };

  dateTimePicker.value.push({ offSet: newTimeShift.offSet , uuid: newTimeShift.uuid });

  selectedMultiWindowOffset.value.push(newTimeShift.uuid);
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

const onBlurQueryEditor = debounce(() => {
  queryEditorPlaceholderFlag.value = true;
  emits("validate-sql");
}, 10);

const validateInputs = (notify: boolean = true) => {
  if (
    Number(triggerData.value.period) < 1 ||
    isNaN(Number(triggerData.value.period))
  ) {
    notify &&
      q.notify({
        type: "negative",
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
        q.notify({
          type: "negative",
          message: "Threshold should not be empty",
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
      q.notify({
        type: "negative",
        message: "Threshold should not be empty",
        timeout: 1500,
      });
    return false;
  }

  return true;
};

const onBlurFunctionEditor = debounce(() => {
  functionEditorPlaceholderFlag.value = true;
  emits("validate-sql");
}, 10);

const toggleExpandFunctionError = () => {
  isFunctionErrorExpanded.value = !isFunctionErrorExpanded.value;
};

const validateFrequency = (frequency: {
  frequency_type: string;
  cron: string;
  frequency: number;
}) => {
  if (frequency.frequency_type === "cron") {
    try {
      const intervalInSecs = getCronIntervalDifferenceInSeconds(frequency.cron);

      if (
        typeof intervalInSecs === "number" &&
        !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
      ) {
        const minInterval =
          Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
        cronJobError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
        return;
      }
    } catch (e) {
      cronJobError.value = "Invalid cron expression";
    }
  }

  if (frequency.frequency_type === "minutes") {
    const intervalInMins = Math.ceil(
      store.state?.zoConfig?.min_auto_refresh_interval / 60,
    );

    if (frequency.frequency < intervalInMins) {
      cronJobError.value =
        "Minimum frequency should be " + intervalInMins + " minutes";
      return;
    }
  }
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

  const updateDestinations = (destinations: any[]) => {
    emits("update:destinations", destinations);
  };

  const getDisplayValue = (value: any) => {
    const relativePeriods = [
      { label: "Second(s)", value: "s" },
      { label: "Minute(s)", value: "m" },
      { label: "Hour(s)", value: "h" },
      { label: "Day(s)", value: "d" },
      { label: "Week(s)", value: "w" },
      { label: "Month(s)", value: "M" },
    ];

  if (typeof value !== 'string') return value;

  const match = value.match(/^(\d+)([smhdwM])$/);
  if (!match) return value;

  const [, numberPart, unitPart] = match;

  const relativePeriod = relativePeriods.find(period => period.value === unitPart);
  
  if (!relativePeriod) return value;

  return `${numberPart} ${relativePeriod.label}`;
};

  const handleExpandSqlOutput = () => {
    expandSqlOutput.value = !expandSqlOutput.value;
    if (expandSqlOutput.value) {
      expandCombinedOutput.value = false;
    }
  };

  const handleExpandCombinedOutput = () => {
    expandCombinedOutput.value = !expandCombinedOutput.value;
    if (expandCombinedOutput.value) {
      expandSqlOutput.value = false;
    }
  };

  const handleMultiWindowOffsetClick = (uuid: string) => {
    if (selectedMultiWindowOffset.value && !selectedMultiWindowOffset.value.includes(uuid)) {
      selectedMultiWindowOffset.value.push(uuid);
    }
  };

  const handleRemoveMultiWindowOffset = (uuid: string) => {
    selectedMultiWindowOffset.value = selectedMultiWindowOffset.value.filter((offset: string) => offset !== uuid);
  };

  const checkIfMultiWindowOffsetIsSelected = (uuid: string) => {
    return selectedMultiWindowOffset.value && selectedMultiWindowOffset.value.includes(uuid);
  };

  const onColumnSelect = () => {
    if(selectedColumn.value.value){
      query.value += ` ${selectedColumn.value.value} `
    }
    // selectedColumn.value = {
    //   label: "",
    //   value: ""
    // }
  };
  const buildMulitWindowQuery = (sql: any, fn: boolean = false, periodInMicroseconds: number) => {
  const queryToSend: any = [

  ];
  const regex = /^(\d+)([smhdwM])$/;

  const unitToMicroseconds: Record<string, number> = {
    s: 1 * 1_000_000,           // seconds
    m: 60 * 1_000_000,          // minutes
    h: 60 * 60 * 1_000_000,     // hours
    d: 24 * 60 * 60 * 1_000_000,// days
    w: 7 * 24 * 60 * 60 * 1_000_000, // weeks
    M: 30 * 24 * 60 * 60 * 1_000_000 // month
  };

  const now = Date.now() * 1000; // Current time in microseconds because we are using microseconds of unix timestamp 

  dateTimePicker.value.forEach((date: any) => {
    if(checkIfMultiWindowOffsetIsSelected(date.uuid)){
    let individualQuery: any = {};
    const match = date.offSet.match(regex);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const offsetMicroseconds = value * unitToMicroseconds[unit];

      const endTime = now;
      const startTime = endTime - offsetMicroseconds;
      individualQuery.start_time = startTime - periodInMicroseconds;
      individualQuery.end_time = startTime;
      individualQuery.sql = sql;
      individualQuery.query_fn = fn ? b64EncodeUnicode(vrlFunctionContent.value) : null;
      queryToSend.push(individualQuery);
    } else {
      console.warn("Invalid format:", date);
    }
  }
  });
  return queryToSend;
  };

  const triggerQuery = async (fn: boolean = false) => {
    const isAllColumnsSelected = await checkIfAllColumnsAreSelected(query.value);
    if(!isAllColumnsSelected){
      return;
    }
    try{
    const queryReq = buildQueryPayload({
        sqlMode: true,
        streamName: selectedStream.value,
      });
      queryReq.query.sql = query.value;
      queryReq.query.size = 10;
      const periodInMicroseconds = triggerData.value.period * 60 * 1000000;
      const endTime = new Date().getTime() * 1000; // ← Use 1000 to get microseconds
      const startTime = endTime - periodInMicroseconds;
      queryReq.query.query_fn = null;
      // //this is for single window query but we will deprecate this in future
      //as we show any ways array in array so we will call multi search call always
      // if(selectedMultiWindowOffset.value.length == 0){
      //   queryReq.query.start_time = startTime;
      //   queryReq.query.end_time = endTime;
      //   runQueryLoading.value = true;
      //   if(fn){
      //     queryReq.query.query_fn = b64EncodeUnicode(vrlFunctionContent.value);
      //     outputFnEvents.value = "";
      //   }
      //   else{
      //     outputEvents.value = "";
      //   }
      //   if(queryReq.aggs){
      //     delete queryReq.aggs;
      //   }
      //   try {
      //     const res = await searchService.search({
      //       org_identifier: store.state.selectedOrganization.identifier,
      //       query: queryReq,
      //       page_type: selectedStreamType.value,
      //     })
      //     if(res.data.hits.length > 0){
      //       if(fn){
      //         outputFnEvents.value = JSON.stringify(res.data.hits,null,2);
      //       }
      //       else{
      //         outputEvents.value = JSON.stringify(res.data.hits,null,2);
      //       }
      //     }
      //     runQueryLoading.value = false;
      //   } catch (err) {
      //     console.log(err,"err")
      //     runQueryLoading.value = false;
      //   }
      // }
        queryReq.query.sql_mode = true;
        queryReq.query.per_query_response = true;
        //initial query to send like with period for suppose we have 10minutes of period then we will send 10 minutes of data
        //so we will send 10 minutes of data in initial query
        //and then if any multi window offset is selected then we will call buildMulitWindowQuery function to get the query to send
        //and then we will push the query to send to the queryReq.query.sql
        let queryTosend = [
          {
            start_time: startTime,
            end_time: endTime,
            sql: queryReq.query.sql,
            query_fn: fn ? b64EncodeUnicode(vrlFunctionContent.value) : null
          }
        ];
        queryTosend.push(...buildMulitWindowQuery(queryReq.query.sql, fn,periodInMicroseconds));
        queryReq.query.sql = queryTosend;
        const res = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: queryReq,
          page_type: selectedStreamType.value,
        })
        if(res.data.hits.length > 0){
          if(fn){
            outputFnEvents.value = JSON.stringify(res.data.hits,null,2);
          }
          else{
            outputEvents.value = JSON.stringify(res.data.hits,null,2);
          }
        }
      }
    catch(err){
      q.notify({
        type: "negative",
        message:err.response.data.message ?? "Error while fetching results",
        timeout: 1500,
      });
    }
  }



  const runSqlQuery = async () => {
    runPromqlError.value = "";
    tempRunQuery.value = true;
    expandSqlOutput.value = true;
    try{
      runQueryLoading.value = true;
      await triggerQuery();
      runQueryLoading.value = false;
    }
    catch(err){
      runQueryLoading.value = false;
    }
  };

  const runTestFunction = async () => {
    runPromqlError.value = "";
    tempTestFunction.value = true;
    expandCombinedOutput.value = true;
    runFnQueryLoading.value = true;
    try{
      await triggerQuery(true);
      runFnQueryLoading.value = false;
    }
    catch(err){
      runFnQueryLoading.value = false;
    }
  }



// Method to handle the emitted changes and update the structure
  function updateGroup(updatedGroup:any) {
    emits('update:group', updatedGroup)
  }

  const removeConditionGroup = (targetGroupId: string, currentGroup: any = inputData.value) => {
    emits('remove:group', targetGroupId)

    // No emit here — you're handling data directly in parent
  };
  const multiWindowImage = computed(() => {
  if(store.state.theme === 'dark'){
    return getImageURL('images/alerts/multi_window.svg')
  }
  else{
    return getImageURL('images/alerts/multi_window_light.svg')
  }
  })

  const conditionsImage = computed(() => {
    if(store.state.theme === 'dark'){
      return getImageURL('images/alerts/conditions_image.svg')
    }
    else{
      return getImageURL('images/alerts/conditions_image_light.svg')
    }
  })

  const sqlEditorImage = computed(() => {
    if(store.state.theme === 'light'){
      return getImageURL('images/alerts/sql_editor_light.svg')
    }
    else{ 
      return getImageURL('images/alerts/sql_editor_dark.svg')
    }
  })

  const runPromqlQuery = async () => {
    runPromqlError.value = "";
    tempRunQuery.value = true;
    expandSqlOutput.value = true;
    await triggerPromqlQuery();
  }

  const triggerPromqlQuery = async () => {
    const queryReq = buildQueryPayload({
        sqlMode: true,
        streamName: selectedStream.value,
      });

      const periodInMicroseconds = triggerData.value.period * 60 * 1000000;
      const endTime = new Date().getTime() * 1000; // ← Use 1000 to get microseconds
      const startTime = endTime - periodInMicroseconds;

        queryReq.query.start_time = startTime;
        queryReq.query.end_time = endTime;
          outputEvents.value = "";
        try {
          const res = await searchService.metrics_query_range({
              org_identifier: store.state.selectedOrganization.identifier,
              query: queryReq,
              start_time: startTime,
              end_time: endTime,
              step: '0'
            })
          if(res.data.hits.length > 0){
              outputEvents.value = JSON.stringify(res.data.hits,null,2);
          }
        } catch (err: any) {
          runPromqlError.value = err.response.data.error ?? "Something went wrong";
        }
  }


    const toggleAIChat = () => {
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
    }


    const getBtnO2Logo = computed(() => {
      return getImageURL('images/common/ai_icon_blue.svg')
    })
    const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL('images/common/ai_icon_dark.svg')
      }

      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg')
    })
    const convertMinutesToDisplayValue = (value: number) => {
      if (!value || value < 0) return '0 minutes';
      
      // Constants for time unit conversions
      const MINUTES_IN_HOUR = 60;
      const MINUTES_IN_DAY = 24 * MINUTES_IN_HOUR;
      const MINUTES_IN_WEEK = 7 * MINUTES_IN_DAY;
      const MINUTES_IN_MONTH = 30 * MINUTES_IN_DAY; // Approximate

      // Convert to the most appropriate unit
      if (value < 60) {
        return `${value} minute${value !== 1 ? 's' : ''}`;
      } else if (value < MINUTES_IN_DAY) {
        const hours = Math.floor(value / MINUTES_IN_HOUR);
        const remainingMinutes = value % MINUTES_IN_HOUR;
        return remainingMinutes > 0 
          ? `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`
          : `${hours} hour${hours !== 1 ? 's' : ''}`;
      } else if (value < MINUTES_IN_WEEK) {
        const days = Math.floor(value / MINUTES_IN_DAY);
        const remainingHours = Math.floor((value % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
        return remainingHours > 0 
          ? `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`
          : `${days} day${days !== 1 ? 's' : ''}`;
      } else if (value < MINUTES_IN_MONTH) {
        const weeks = Math.floor(value / MINUTES_IN_WEEK);
        const remainingDays = Math.floor((value % MINUTES_IN_WEEK) / MINUTES_IN_DAY);
        return remainingDays > 0 
          ? `${weeks} week${weeks !== 1 ? 's' : ''} ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`
          : `${weeks} week${weeks !== 1 ? 's' : ''}`;
      } else {
        const months = Math.floor(value / MINUTES_IN_MONTH);
        const remainingWeeks = Math.floor((value % MINUTES_IN_MONTH) / MINUTES_IN_WEEK);
        return remainingWeeks > 0 
          ? `${months} month${months !== 1 ? 's' : ''} ${remainingWeeks} week${remainingWeeks !== 1 ? 's' : ''}`
          : `${months} month${months !== 1 ? 's' : ''}`;
      }
    }

    const editCurrentWindow = () => {
      // Find the period input container
      //usign the class name to find the element
      const periodInputContainer = scheduledAlertRef.value.querySelector('.period-input-container');
      
      if (periodInputContainer) {
        // Scroll the element into view with smooth behavior
        periodInputContainer.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center'
        });
        
        // Adding focus to the input for better UX
        //user might be editing the period input so we need to focus on it
        const input = periodInputContainer.querySelector('input');
        if (input) {
          input.focus();
        }
      }
    }


    const onFunctionClear = () => {
      selectedFunction.value = null;
      vrlFunctionContent.value = "";
    };

    const filterDestinations = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredDestinations.value = [...props.formattedDestinations];
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredDestinations.value = props.formattedDestinations.filter(
          (destination: string) => destination.toLowerCase().includes(needle)
        );
      });
    };

    const checkIfAllColumnsAreSelected = async (query: string) => {
      const parser = await sqlParser();
      const regex = /\bdefault\b/g;
      const columns = parser.astify(
        query.replace(regex, "default1"),
      ).columns;
      for (const column of columns) {
        if (column.expr.column === "*") {
          return false;
        }
      }
      return true;
    }

    const isHavingError = computed(() => {
      return (
        !aggregationData.value.function ||
        !aggregationData.value.having.column ||
        !aggregationData.value.having.operator ||
        !aggregationData.value.having.value?.toString().trim().length
      );
    });


defineExpose({
  tab,
  validateInputs,
  cronJobError,
  validateFrequency,
  testFields,
  isFullScreen,
  viewSqlEditor,
  viewVrlFunction,
  expandSqlOutput,
  expandCombinedOutput,
  outlinedLightbulb,
  selectedMultiWindowOffset,
  handleMultiWindowOffsetClick,
  checkIfMultiWindowOffsetIsSelected,
  tempTestFunction,
  selectedColumn,
  filteredFields,
  onColumnSelect,
  runSqlQuery,
  runTestFunction,
  handleRemoveMultiWindowOffset,
  inputData,
  updateGroup,
  removeConditionGroup,
  runPromqlError,
  toggleAIChat,
  isHovered,
  getBtnLogo,
  convertMinutesToDisplayValue,
  scheduledAlertRef,
  filterDestinations,
  filteredDestinations,
  destinationSelectRef,
  getBtnO2Logo,
  runFnQueryLoading,
  isHavingError
});
</script>

<style lang="scss" scoped>
.scheduled-alert-tabs {
  border-radius: 4px;
  overflow: hidden;
}
</style>
<style lang="scss">
.scheduled-alert-tabs {
  .q-tab--active {
    background-color: $primary;
    color: $white;
  }

  .q-tab__indicator {
    display: none;
  }

  .q-tab {
    height: 35px;
    min-height: 35px;
    width: 50px !important;
    min-width: 50px;
  }

}
.dark-mode .scheduled-alert-tabs .q-tab--inactive{
    background-color: #494A4A;
    color: $white
  }
  .light-mode .scheduled-alert-tabs .q-tab--inactive{
    background-color: #ffffff;
    color:  #3d3d3d
  }
  .light-mode .scheduled-alert-tabs {
    border: 1px solid #cdcdcd;
  }
.scheduled-alerts {
  .monaco-editor {
    width: calc(100% - 2px ) !important;
  }
  .border-input-box{
    border: 2px solid rgb(39, 39, 39) !important;
  }

  .border-input-box-light{
    border: 1px solid rgb(196, 194, 194) !important;
  }



  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
  .rounded-border-btn{
    border-radius: 50% !important;
    padding: 0px 4px !important;
  }
  .dark-mode .monaco-editor-background{
    background-color: #181a1b;
  }
  .light-mode .monaco-editor-background{
    background-color: #ffffff !important;
  }
  .dark-mode .dark-mode-fn-editor{
    background-color: #181a1b !important;
  }

  .dark-mode .monaco-editor-add-alert{
    background-color: #18181A !important;
  }


  .empty-query .monaco-editor-background {
    background-image: url("../../assets/images/common/query-editor.png");
    background-repeat: no-repeat;
    background-size: 115px;
  }

  .empty-function .monaco-editor-background {
    background-image: url("../../assets/images/common/vrl-function.png");
    background-repeat: no-repeat;
    background-size: 170px;
  }
}
.scheduled-alerts-dialog {
  .monaco-editor {
    width: calc(100% - 2px ) !important;
  }
  .border-input-box{
    border: 2px solid rgb(39, 39, 39) !important;
  }

  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
  .rounded-border-btn{
    border-radius: 50% !important;
    padding: 0px 4px !important;
  }

  .empty-query .monaco-editor-background {
    background-image: url("../../assets/images/common/query-editor.png");
    background-repeat: no-repeat;
  }

  .empty-function .monaco-editor-background {
    background-image: url("../../assets/images/common/vrl-function.png");
    background-repeat: no-repeat;
  }
}

.invalid-sql-error {
  min-height: 21px;
}
.dialog-title-each-tab{
  font-size: 18px;
  font-weight: 600;
}
.dark-mode-multi-window .multi-window-text{
  color: #FFFFFF;
}
.light-mode-multi-window .multi-window-text{
  color: #3d3d3d;
}
.multi-window-text{
  font-weight: 700;
  font-size: 14px;
  line-height: 24px;
  vertical-align: middle;

}
.running-text{
  font-weight: 400 !important;
  line-height: 20px !important;
  font-size: 14px;
}
.dark-mode .editor-dialog-card{
  background-color: #181a1b;
}
.light-mode .editor-dialog-card{
  background-color: #ffffff;
}
.reference-text{
  font-size: 14px;
  font-weight: 400;
}
.dark-mode-multi-window .multi-window-container{
  background-color: #111111;
  border: 1px solid #343939;

}
.light-mode-multi-window .multi-window-container{
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
}

.multi-window-container{
  min-height: 110px;
  border-left: 6px solid #32CCCC !important;
}
.dark-mode-multi-window .reference-window-container{
  background-color: #111111;
  border: 1px solid #343939;
}
.light-mode-multi-window .reference-window-container{
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
}

.reference-window-container{

  min-height: 110px;
  border-left: 6px solid #6832CC !important;
}
.dark-mode-view .editor-container{
  border: 1px solid #3e3e3e;
}
.light-mode-view .editor-container{
  border: 1px solid #e5e4e4;
}

.dark-mode .border-line{
  background-color: #4f4f4f;
}
.light-mode .border-line{
  background-color: #eeeeee;
}

.monaco-editor-dialog{
  height: calc(100vh - 500px);
}
.vrl-editor-dialog{
  height: calc(100vh - 500px);
}
.editor-title-container{
  background-color: #212121;
  border: 1px  solid #2a2929;
}

.dark-mode .container-for-editors{
  border-top: 1px solid #343434;
}

.dark-mode .editor-title{
  background-color: #212121;
  border: 1px  solid #2a2929;
}

.light-mode .editor-title{
  background-color: #fcfcfe;
  border: 1px  solid #e9e9e9;
}

.dark-mode .editor-text-title{
  font-size: 16px;
  font-weight: bold;
  color: #FFFFFF;
}
.light-mode .editor-text-title{
  font-size: 16px;
  font-weight: bold;
  color: #6b7280;
}

.dark-mode .mini-select .q-field__control {
  background-color: #181a1b !important;
  border: 1px solid #7c7b7b !important;
  border-radius: 4px !important;
}

.light-mode .mini-select .q-field__control {
  background-color: #ffffff !important;
  border: 1px solid #e0e0e0 !important;
  border-radius: 4px !important;
}

.dark-mode .sql-output-section{
  background-color: #181a1b;
  border: 1px solid #212121;
  min-height: 20rem;
}
.light-mode .sql-output-section{
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  min-height: 20rem;
}

.dark-mode .no-output-before-run-query{
  background-color: #1e1e1e;
  border: 1px solid #212121;
  min-height: 10rem;
  color: #7f8281;
  font-size: 16px;
}
.light-mode .no-output-before-run-query{
  background-color: #fafafa;
  border: 1px solid #e9e9e9;
  min-height: 10rem;
  color: #a7abaa;
  font-size: 16px;
}

.multi-window-offset-container{
  border: 1px solid #ffffff;
  cursor: pointer;
}

.monaco-editor-output {
  min-height: 10rem;
  border-radius: 5px;
  height: 100%;
}


.dark-mode .monaco-editor-output, 
.dark-mode .monaco-editor .margin, 
.dark-mode .monaco-editor .monaco-editor-background,
.dark-mode .monaco-editor .margin-view-overlays,
.dark-mode .monaco-editor .line-numbers {
  background-color: #181a1b !important; /* Use your desired background color */
}

.light-mode .monaco-editor-output, 
.light-mode .monaco-editor .margin, 
.light-mode .monaco-editor .monaco-editor-background,
.light-mode .monaco-editor .margin-view-overlays,
.light-mode .monaco-editor .line-numbers {
  background-color: #ffffff !important; /* Use your desired background color */
}

.dark-mode-editor {
  border: 1px solid #212121 !important;
}

.light-mode-editor {
  border: 1px solid #e0e0e0 !important;
}
.o2-select-input {
  .q-field{
    .q-field__control{
      min-height: 32px !important;
      max-height: 32px !important;
    }
  }
}
</style>
