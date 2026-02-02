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
  <div class="full-width scheduled-pipeline-container">
    <div class="flex items-center justify-between q-pb-sm">
      <div class="flex items-center">
        <q-btn
          icon="cancel"
          size="14px"
          class="q-pt-sm"
          flat
          dense
          @click="$emit('cancel:form')"
        />
        <div class="q-pb-sm stream-routing-title q-pl-xs">
          {{ t("pipeline.query") }}
        </div>
      </div>

      <div class="flex items-center">
        <q-btn
          v-if="
            config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled
          "
          :ripple="false"
          @click="toggleAIChat"
          data-test="menu-link-ai-item"
          no-caps
          :borderless="true"
          flat
          dense
          class="o2-button ai-hover-btn q-px-sm q-py-sm q-mr-sm"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          style="border-radius: 100%"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"
        >
          <div class="row items-center no-wrap tw:gap-2">
            <img :src="getBtnLogo" class="header-icon ai-icon" />
          </div>
        </q-btn>
        <div class="flex items-center app-tabs-container tw:h-[36px] q-mr-sm">
          <AppTabs
            data-test="scheduled-pipeline-tabs"
            :tabs="tabOptions"
            v-model:active-tab="tab"
            class="tabs-selection-container"
            @update:active-tab="updateTab"
          />
        </div>
        <DateTime
          style="height: 34px !important; border-radius: 3px"
          @on:date-change="updateDateChange"
          class="q-mr-sm"
        />
        <q-btn
          data-test="logs-search-bar-refresh-btn"
          data-cy="search-bar-refresh-button"
          flat
          no-caps
          :title="t('search.runQuery')"
          class="q-pa-none q-mr-sm o2-primary-button tw:h-[36px]"
          :class="
            store.state.theme === 'dark'
              ? 'o2-primary-button-dark'
              : 'o2-primary-button-light'
          "
          @click="
            {
              expandState.output = true;
              expandState.query = false;
              runQuery();
            }
          "
          >{{ t("search.runQuery") }}</q-btn
        >

        <q-btn
          data-test="add-function-fullscreen-btn"
          :text-color="store.state.theme === 'dark' ? 'grey-1' : 'primary'"
          dense
          style="height: 34px"
          no-caps
          :icon="isFullscreen ? 'fullscreen_exit' : 'fullscreen'"
          @click="handleFullScreen"
        />
      </div>
    </div>
    <q-separator />

    <div class="q-mb-sm stepper-header tw:w-full tw:flex tw:h-full">
      <div
        :class="store.state.isAiChatEnabled ? 'tw:w-[75%]' : 'tw:w-[100%]'"
        style="height: 100% !important"
      >
        <q-splitter
          v-model="splitterModel"
          style="width: 100%"
          class="o2-custom-splitter"
        >
          <template #before>
            <q-splitter
              v-model="sideBarSplitterModel"
              style="width: 100%; height: calc(100vh - 90px) !important"
              class="full-height"
              horizontal
            >
              <template #before>
                <!-- fieldlist section -->
                <span
                  @click.stop="expandState.buildQuery = !expandState.buildQuery"
                >
                  <FullViewContainer
                    name="query"
                    v-model:is-expanded="expandState.buildQuery"
                    :label="t('pipeline.buildQuery')"
                    class="tw:mt-1"
                  />
                </span>
                <div class="q-pt-sm" v-show="expandState.buildQuery">
                  <div>
                    <q-select
                      v-model="selectedStreamType"
                      :options="streamTypes"
                      option-label="label"
                      option-value="value"
                      :label="t('alerts.streamType') + ' *'"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="no-case full-width q-mb-xs o2-custom-select-dashboard"
                      stack-label
                      dense
                      use-input
                      hide-selected
                      fill-input
                      borderless
                      input-debounce="300"
                      @update:model-value="getStreamList"
                    />

                    <q-select
                      v-model="selectedStreamName"
                      :options="filteredStreams"
                      option-label="label"
                      option-value="value"
                      :label="t('alerts.stream_name')"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="q-my-xs no-case full-width o2-custom-select-dashboard"
                      stack-label
                      dense
                      use-input
                      hide-selected
                      fill-input
                      borderless
                      input-debounce="300"
                      @update:model-value="getStreamFields"
                      @filter="filterStreams"
                      @popup-show="getStreamList"
                      map-options
                      emit-value
                    />
                  </div>

                  <FieldList
                    :fields="streamFields"
                    :stream-name="selectedStreamName"
                    :stream-type="selectedStreamType"
                    @event-emitted="handleSidebarEvent"
                    :time-stamp="{
                      startTime: dateTime.startTime,
                      endTime: dateTime.endTime,
                    }"
                    :hideIncludeExlcude="true"
                    :hideCopyValue="false"
                    :hideAddSearchTerm="true"
                  />
                </div>
              </template>
              <template #after>
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
                  class="flex justify-between q-pl-sm full-height"
                  style="overflow-y: auto !important"
                >
                  <div>
                    <div
                      v-if="
                        selectedStreamType === 'metrics' &&
                        tab === 'promql' &&
                        promqlCondition
                      "
                      class="flex justify-start items-center text-bold q-mb-sm q-mt-md o2-input"
                    >
                      <div style="width: 130px">
                        {{ t('pipeline.trigger') }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
                          "
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                          >
                            <span style="font-size: 14px"
                              >Based upon the condition of trigger the pipeline
                              will get trigger <br />
                              e.g. if the trigger value is >100 and the query
                              returns a value of 101 then the pipeline will
                              trigger.</span
                            >
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <div class="flex justify-start items-center">
                        <div
                          data-test="scheduled-pipeline-promlq-condition-operator-select"
                        >
                          <q-select
                            v-model="promqlCondition.operator"
                            :options="triggerOperators"
                            color="input-border"
                            bg-color="input-bg"
                            class="no-case q-py-none q-mr-xs"
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
                          data-test="scheduled-pipeline-promlq-condition-value"
                          style="width: 160px; margin-left: 0 !important"
                          class="silence-notification-input o2-input"
                        >
                          <q-input
                            v-model="promqlCondition.value"
                            type="number"
                            dense
                            filled
                            min="0"
                            style="background: none"
                            :placeholder="t('pipeline.value')"
                            @update:model-value="updatePromqlCondition"
                          />
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="tab === 'custom'"
                      class="flex justify-start items-center text-bold q-mb-lg"
                    >
                      <div
                        data-test="scheduled-pipeline-aggregation-title"
                        style="width: 172px"
                      >
                        {{ t('pipeline.aggregation') }}
                      </div>
                      <q-toggle
                        data-test="scheduled-pipeline-aggregation-toggle"
                        v-model="_isAggregationEnabled"
                        size="md"
                        color="primary"
                        class="text-bold q-pl-0 o2-toggle-button-sm tw:h-[36px] tw:ml-1"
                        :disable="tab === 'sql' || tab === 'promql'"
                        @update:model-value="updateAggregation"
                      />
                    </div>
                    <div
                      v-if="_isAggregationEnabled && aggregationData"
                      class="flex items-center no-wrap q-mr-sm q-mb-sm"
                    >
                      <div
                        data-test="scheduled-pipeline-group-by-title"
                        class="text-bold"
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
                            :data-test="`scheduled-pipeline-group-by-${index + 1}`"
                            class="flex justify-start items-center no-wrap o2-input"
                          >
                            <div
                              data-test="scheduled-pipeline-group-by-column-select"
                            >
                              <q-select
                                v-model="aggregationData.group_by[index]"
                                :options="filteredFields"
                                color="input-border"
                                bg-color="input-bg"
                                class="no-case q-py-none q-mb-sm"
                                filled
                                borderless
                                dense
                                use-input
                                emit-value
                                hide-selected
                                :placeholder="t('pipeline.selectColumn')"
                                fill-input
                                :input-debounce="400"
                                @filter="filterFields"
                                :rules="[
                                  (val: any) => !!val || t('pipeline.fieldRequired'),
                                ]"
                                style="width: 200px"
                                @update:model-value="updateTrigger"
                              />
                            </div>
                            <q-btn
                              data-test="scheduled-pipeline-group-by-delete-btn"
                              :icon="outlinedDelete"
                              class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                              :class="
                                store.state?.theme === 'dark' ? 'icon-dark' : ''
                              "
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
                          data-test="scheduled-pipeline-group-by-add-btn"
                          icon="add"
                          class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                          :class="
                            store.state?.theme === 'dark' ? 'icon-dark' : ''
                          "
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
                      class="flex justify-start items-center q-mb-xs no-wrap q-pb-md"
                    >
                      <div
                        data-test="scheduled-pipeline-threshold-title"
                        class="text-bold flex items-center"
                        style="width: 190px"
                      >
                        {{ t("alerts.threshold") + " *" }}

                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
                          "
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                          >
                            <span style="font-size: 14px"
                              >The threshold above/below which the alert will
                              trigger. <br />
                              e.g. if the threshold is >100 and the query
                              returns a value of 101 then the alert will
                              trigger.</span
                            >
                          </q-tooltip>
                        </q-icon>
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
                              class="threshould-input q-mr-xs o2-input"
                            >
                              <q-select
                                v-model="aggregationData.function"
                                :options="aggFunctions"
                                color="input-border"
                                bg-color="input-bg"
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
                              class="threshould-input q-mr-xs o2-input"
                              data-test="scheduled-pipeline-threshold-column-select"
                            >
                              <q-select
                                v-model="aggregationData.having.column"
                                :options="filteredNumericColumns"
                                color="input-border"
                                bg-color="input-bg"
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
                              />
                            </div>
                            <div
                              data-test="scheduled-pipeline-threshold-operator-select"
                              class="threshould-input q-mr-xs o2-input q-mt-sm"
                            >
                              <q-select
                                v-model="aggregationData.having.operator"
                                :options="triggerOperators"
                                color="input-border"
                                bg-color="input-bg"
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
                            <div class="flex items-center q-mt-sm">
                              <div
                                data-test="scheduled-pipeline-threshold-value-input"
                                style="width: 250px; margin-left: 0 !important"
                                class="silence-notification-input o2-input"
                              >
                                <q-input
                                  v-model="aggregationData.having.value"
                                  type="number"
                                  dense
                                  filled
                                  min="0"
                                  style="background: none"
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
                            class="text-red-8 q-pt-xs absolute"
                            style="font-size: 11px; line-height: 12px"
                          >
                            {{ t('pipeline.fieldRequired') }}
                          </div>
                        </template>
                        <template v-else>
                          <div class="flex justify-start items-center">
                            <div
                              class="threshould-input"
                              data-test="scheduled-pipeline-threshold-operator-select"
                            >
                              <q-select
                                v-model="triggerData.operator"
                                :options="triggerOperators"
                                color="input-border"
                                bg-color="input-bg"
                                class="showLabelOnTop no-case q-py-none"
                                filled
                                borderless
                                dense
                                use-input
                                hide-selected
                                fill-input
                                :rules="[
                                  (val: any) => !!val || t('pipeline.fieldRequired'),
                                ]"
                                style="
                                  width: 88px;
                                  border: 1px solid rgba(0, 0, 0, 0.05);
                                "
                                @update:model-value="updateTrigger"
                              />
                            </div>
                            <div
                              class="flex items-center"
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
                                <q-input
                                  v-model="triggerData.threshold"
                                  type="number"
                                  dense
                                  filled
                                  min="1"
                                  style="background: none"
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
                                    ? 'bg-grey-10'
                                    : 'bg-grey-2'
                                "
                                class="flex justify-center items-center"
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
                            class="text-red-8 q-pt-xs absolute"
                            style="font-size: 11px; line-height: 12px"
                          >
                            {{ t('pipeline.fieldRequired') }}
                          </div>
                        </template>
                      </div>
                    </div>
                    <div class="flex items-center q-mr-sm">
                      <div
                        data-test="scheduled-pipeline-cron-toggle-title"
                        class="text-bold flex items-center"
                        style="width: 130px"
                      >
                        {{ t("alerts.crontitle") + " *" }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
                          "
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                          >
                            <span style="font-size: 14px"
                              >Configure the option to enable a cron
                              expression.</span
                            >
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <div style="min-height: 58px">
                        <div
                          class="flex items-center q-mr-sm"
                          style="width: fit-content"
                        >
                          <div
                            data-test="scheduled-pipeline-cron-input"
                            class="silence-notification-input"
                          >
                            <q-toggle
                              data-test="scheduled-pipeline-cron-toggle-btn"
                              size="md"
                              color="primary"
                              class="text-bold q-pl-0 o2-toggle-button-sm tw:h-[36px] tw:ml-1"
                              v-model="triggerData.frequency_type"
                              :true-value="'cron'"
                              :false-value="'minutes'"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center justify-start q-mr-sm">
                      <div
                        data-test="scheduled-pipeline-frequency-title"
                        class="text-bold flex items-center q-mr-xs"
                        :style="{
                          width:
                            triggerData.frequency_type == 'minutes'
                              ? '130px'
                              : '100px',
                        }"
                      >
                        {{ t("alerts.frequency") + " *" }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
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
                              e.g., 2 minutes means that the task will run every
                              2 minutes and will be processed based on the other
                              parameters provided.</span
                            >
                            <span style="font-size: 14px" v-else>
                              Pattern: * * * * * * means every second.
                              <br />
                              Format: [Second (optional) 0-59] [Minute 0-59]
                              [Hour 0-23] [Day of Month 1-31, 'L'] [Month 1-12]
                              [Day of Week 0-7 or '1L-7L', 0 and 7 for Sunday].
                              <br />
                              Use '*' to represent any value, 'L' for the last
                              day/weekday.
                              <br />
                              Example: 0 0 12 * * ? - Triggers at 12:00 PM
                              daily. It specifies second, minute, hour, day of
                              month, month, and day of week, respectively.</span
                            >
                          </q-tooltip>
                        </q-icon>
                        <template
                          v-if="
                            triggerData.frequency_type == 'cron' &&
                            showTimezoneWarning
                          "
                        >
                          <q-icon
                            :name="outlinedWarning"
                            size="18px"
                            class="cursor-pointer tw:ml-[8px]"
                            :class="
                              store.state.theme === 'dark'
                                ? 'tw:text-orange-500'
                                : 'tw:text-orange-500'
                            "
                          >
                            <q-tooltip
                              anchor="center right"
                              self="center left"
                              max-width="auto"
                              class="tw:text-[14px]"
                            >
                              Warning: The displayed timezone is approximate.
                              Verify and select the correct timezone manually.
                            </q-tooltip>
                          </q-icon>
                        </template>
                      </div>
                      <div style="max-height: 50px" class="q-mb-sm">
                        <div
                          class="flex items-center q-mr-sm"
                          style="width: fit-content"
                        >
                          <div
                            data-test="scheduled-pipeline-frequency-input"
                            :style="
                              triggerData.frequency_type == 'minutes'
                                ? 'width: 87px; margin-left: 0 !important;margin-top: 10px'
                                : 'width: fit-content !important'
                            "
                            class="silence-notification-input"
                          >
                            <q-input
                              data-test="scheduled-pipeline-frequency-input-field"
                              v-if="triggerData.frequency_type == 'minutes'"
                              v-model="triggerData.frequency"
                              type="number"
                              dense
                              filled
                              :min="
                                Math.ceil(
                                  store.state?.zoConfig
                                    ?.min_auto_refresh_interval / 60,
                                ) || 1
                              "
                              style="background: none"
                              @update:model-value="updateFrequency"
                            />
                            <div
                              v-else
                              class="tw:flex tw:items-center o2-input"
                            >
                              <q-input
                                data-test="scheduled-pipeline-cron-input-field"
                                v-model="triggerData.cron"
                                dense
                                filled
                                :label="t('reports.cronExpression') + ' *'"
                                style="background: none; width: 130px"
                                class="showLabelOnTop"
                                stack-label
                                outlined
                                @update:model-value="updateCron"
                                required
                              />
                              <q-select
                                data-test="add-report-schedule-start-timezone-select"
                                v-model="triggerData.timezone"
                                :options="filteredTimezone"
                                @blur="
                                  browserTimezone =
                                    browserTimezone == ''
                                      ? Intl.DateTimeFormat().resolvedOptions()
                                          .timeZone
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
                                style="width: 200px"
                              />
                            </div>
                          </div>
                          <div
                            v-if="triggerData.frequency_type == 'minutes'"
                            data-test="scheduled-pipeline-frequency-unit"
                            style="
                              margin-left: 0 !important;
                              height: 40px;
                              font-weight: normal;
                              margin-top: 10px;
                              width: 87px;
                            "
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
                          data-test="scheduled-pipeline-frequency-error-text"
                          v-if="
                            (!Number(triggerData.frequency) &&
                              triggerData.frequency_type == 'minutes') ||
                            (triggerData.frequency_type == 'cron' &&
                              triggerData.cron == '') ||
                            cronJobError
                          "
                          class="text-red-8 q-pt-xs"
                          style="font-size: 11px; line-height: 12px"
                        >
                          {{ cronJobError || t('pipeline.fieldRequired') }}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center q-mr-sm q-mt-lg">
                      <div
                        data-test="scheduled-pipeline-period-title"
                        class="text-bold flex items-center q-pb-sm"
                        style="width: 130px"
                      >
                        {{ t("alerts.period") + " *" }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
                          "
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                          >
                            <span style="font-size: 14px"
                              >Period for which the query should run.<br />
                              e.g. 10 minutes means that whenever the query will
                              run it will use the last 10 minutes of data. If
                              the query runs at 4:00 PM then it will use the
                              data from 3:50 PM to 4:00 PM.</span
                            >
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <div style="min-height: 58px">
                        <div
                          class="flex items-center q-mr-sm"
                          style="
                            border: 1px solid rgba(0, 0, 0, 0.05);
                            width: fit-content;
                          "
                        >
                          <div
                            data-test="scheduled-pipeline-period-input"
                            style="width: 87px; margin-left: 0 !important"
                            class="silence-notification-input"
                          >
                            <q-input
                              v-model="triggerData.period"
                              type="number"
                              dense
                              filled
                              min="1"
                              style="background: none"
                              v-bind:readonly="
                                triggerData.frequency_type == 'minutes'
                              "
                              v-bind:disable="
                                triggerData.frequency_type == 'minutes'
                              "
                              @update:model-value="updateTrigger"
                            />
                          </div>
                          <div
                            data-test="scheduled-pipeline-period-unit"
                            style="
                              min-width: 90px;
                              margin-left: 0 !important;
                              height: 40px;
                              font-weight: normal;
                            "
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
                        data-test="scheduled-pipeline-period-error-text"
                        v-if="!Number(triggerData.period)"
                        class="text-red-8 q-pt-xs"
                        style="font-size: 11px; line-height: 12px"
                      >
                        Field is required!
                      </div>
                      <div
                        data-test="scheduled-pipeline-period-warning-text"
                        v-else
                        class="text-primary q-pt-xs"
                        style="
                          font-size: 12px;
                          line-height: 12px;
                          padding: 2px 0px;
                        "
                      >
                        Note: The period should be the same as frequency.
                      </div>
                    </div>
                    <div class="flex items-center q-mr-sm q-mt-lg">
                      <div
                        data-test="scheduled-pipeline-delay-title"
                        class="text-bold flex items-center q-pb-sm"
                        style="width: 130px"
                      >
                        {{ t("pipeline.delay") + " *" }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="
                            store.state.theme === 'dark'
                              ? 'text-grey-5'
                              : 'text-grey-7'
                          "
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                          >
                            <span style="font-size: 14px"
                              >Delay for which the pipeline is scheduled to
                              run.<br />
                              e.g. 10 minutes delay means that the pipeline will
                              run 10 minutes after its scheduled time.</span
                            >
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <div style="min-height: 58px">
                        <div
                          class="flex items-center q-mr-sm"
                          style="
                            border: 1px solid rgba(0, 0, 0, 0.05);
                            width: fit-content;
                          "
                        >
                          <div
                            data-test="scheduled-pipeline-delay-input"
                            style="width: 87px; margin-left: 0 !important"
                            class="silence-notification-input"
                          >
                            <q-input
                              v-model="delayCondition"
                              type="number"
                              dense
                              filled
                              min="0"
                              style="background: none"
                              @update:model-value="updateDelay"
                            />
                          </div>
                          <div
                            data-test="scheduled-pipeline-delay-unit"
                            style="
                              min-width: 90px;
                              margin-left: 0 !important;
                              height: 40px;
                              font-weight: normal;
                            "
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
                    </div>
                  </div>

                  <div></div>

                  <div
                    class="flex justify-start items-end q-mt-lg q-pb-lg full-width"
                    :class="
                      store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'
                    "
                  ></div>
                </div>
              </template>
            </q-splitter>
          </template>
          <template #separator>
            <q-btn
              data-test="logs-search-field-list-collapse-btn"
              :icon="collapseFields ? 'chevron_right' : 'chevron_left'"
              :title="collapseFields ? 'Collapse Fields' : 'Open Fields'"
              dense
              size="20px"
              round
              class="q-mr-xs field-list-collapse-btn"
              color="primary"
              style="
                left: 10px;
                position: absolute;
                overflow: auto !important;
                top: 0px;
                z-index: 100 !important;
              "
              @click="collapseFieldList"
            ></q-btn>
          </template>
          <template #after>
            <div class="full-width tw:flex tw:flex-col" style="height: 100%">
              <div
                class="tw:flex-1 tw:overflow-auto"
                style="height: calc(100vh - 200px) !important; width: 100%"
              >
                <div class="query-editor-container scheduled-pipelines">
                  <span @click.stop="expandState.query = !expandState.query">
                    <FullViewContainer
                      name="query"
                      v-model:is-expanded="expandState.query"
                      :label="tab === 'sql' ? t('pipeline.sqlQuery') : t('pipeline.promqlQuery')"
                      class="tw:mt-1"
                    />
                  </span>
                  <query-editor
                    v-show="expandState.query"
                    data-test="scheduled-pipeline-sql-editor"
                    ref="pipelineEditorRef"
                    editor-id="pipeline-query-editor"
                    :debounceTime="300"
                    class="monaco-editor"
                    v-model:query="query"
                    :class="
                      query == '' && queryEditorPlaceholderFlag
                        ? 'empty-query'
                        : ''
                    "
                    @update:query="updateQueryValue"
                    @focus="focusQueryEditor"
                    @blur="onBlurQueryEditor"
                    style="height: calc(100vh - 190px) !important"
                  />
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
                    class="flex justify-center items-center"
                  >
                    <q-spinner-hourglass color="primary" size="lg" />
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
                      class="text-center col-10 q-mx-none"
                    >
                      <q-icon name="info" color="primary" size="md" />
                      {{ t("search.noStreamSelectedMessage") }}
                    </h6>
                    <h6
                      v-else-if="notificationMsgValue != ''"
                      data-test="logs-search-no-stream-selected-text"
                      class="text-center col-10 q-mx-none"
                    >
                    {{ 
                      notificationMsgValue
                     }}
                    </h6>
                    <h6
                      v-else
                      data-test="logs-search-no-stream-selected-text"
                      class="text-center col-10 q-mx-none"
                    >
                      <q-icon name="info" color="primary"
size="md" />
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

              <div
                class="scheduled-pipeline-footer tw:sticky tw:bottom-0 tw:px-4 tw:py-3 tw:z-10"
                :class="
                  store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'
                "
              >
                <div class="flex justify-end">
                  <q-btn
                    v-if="pipelineObj.isEditNode"
                    data-test="stream-routing-query-delete-btn"
                    class="o2-secondary-button tw:h-[36px]"
                    flat
                    no-caps
                    @mousedown.prevent
                    @click="$emit('delete:node')"
                  >
                    <q-icon name="delete" class="q-mr-xs" />
                    {{ t("pipeline.deleteNode") }}
                  </q-btn>

                  <q-btn
                    data-test="stream-routing-query-cancel-btn"
                    class="o2-secondary-button tw:h-[36px] q-ml-md"
                    :label="t('alerts.cancel')"
                    flat
                    no-caps
                    @mousedown.prevent
                    @click="$emit('cancel:form')"
                  />
                  <q-btn
                    data-test="stream-routing-query-save-btn"
                    :label="
                      validatingSqlQuery ? t('pipeline.validating') : t('pipeline.validateAndClose')
                    "
                    class="no-border q-ml-md o2-primary-button tw:h-[36px]"
                    no-caps
                    @mousedown.prevent
                    @click.prevent="$emit('submit:form')"
                    :disable="validatingSqlQuery"
                  />
                </div>
              </div>
            </div>
          </template>
        </q-splitter>

        <!-- query-eidtor-part -->
      </div>

      <div
        class="q-ml-sm"
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
import {
  outlinedDelete,
  outlinedInfo,
  outlinedWarning,
} from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";
import {
  getImageURL,
  useLocalTimezone,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  timestampToTimezoneDate,
} from "@/utils/zincutils";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { useQuasar, copyToClipboard } from "quasar";
import CronExpressionParser from "cron-parser";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import IndexList from "@/plugins/logs/IndexList.vue";
import { split } from "postcss/lib/list";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import O2AIChat from "@/components/O2AIChat.vue";

import DateTime from "@/components/DateTime.vue";

import useLogs from "@/composables/useLogs";

import FieldList from "@/components/common/sidebar/FieldList.vue";
import useStreams from "@/composables/useStreams";
import AppTabs from "@/components/common/AppTabs.vue";

import TenstackTable from "@/plugins/logs/TenstackTable.vue";
import PreviewPromqlQuery from "./PreviewPromqlQuery.vue";

import config from "../../../aws-exports";

import useAiChat from "@/composables/useAiChat";
import { onBeforeUnmount } from "vue";
import { debounce } from "lodash-es";

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

const q = useQuasar();

const store = useStore();

const functionEditorPlaceholderFlag = ref(true);

const queryEditorPlaceholderFlag = ref(true);
const pipelineEditorRef: any = ref(null);
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

const aiChatInputContext = ref("");

const userDefinedFields = ref<any[]>([]);

const selectedStreamType = ref(props.streamType || "logs");

const tabOptions = computed(() => [
  {
    label: t("alerts.sql"),
    value: "sql",
  },
  {
    label: t("alerts.promql"),
    value: "promql",
    disabled: selectedStreamType.value !== "metrics",
    tooltipLabel: selectedStreamType.value !== "metrics"
      ? "Promql is only available for metrics stream type"
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

// Watch for stream name changes and auto-generate query
// Fix for issue #9658: Auto-generate SELECT * query when stream changes
watch(
  () => selectedStreamName.value,
  (newStreamName, oldStreamName) => {
    if (newStreamName && oldStreamName && oldStreamName !== newStreamName) {
      // Stream changed: Generate new SELECT * query for the new stream
      if (tab.value === "sql") {
        query.value = `SELECT * FROM "${newStreamName}"`;
        updateQueryValue(query.value);
      } else if (tab.value === "promql") {
        query.value = `${newStreamName}{}`;
        updateQueryValue(query.value);
      }
    } else if (!oldStreamName && newStreamName) {
      // Initial stream selection: Generate default query
      if (tab.value === "sql" && !query.value.trim()) {
        query.value = `SELECT * FROM "${newStreamName}"`;
        updateQueryValue(query.value);
      } else if (tab.value === "promql" && !query.value.trim()) {
        query.value = `${newStreamName}{}`;
        updateQueryValue(query.value);
      }
    }
  }
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

onBeforeMount(async () => {
  await importSqlParser();
});

onMounted(async () => {
  await getStreamList();

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
watch(
  () => expandState.value.buildQuery,
  (val) => {
    if (val == false && expandState.value.setVariables == true) {
      sideBarSplitterModel.value = 0;
    } else if (val == false && expandState.value.setVariables == false) {
      sideBarSplitterModel.value = 0;
    } else if (val == true && expandState.value.setVariables == false) {
      sideBarSplitterModel.value = 99;
    } else {
      sideBarSplitterModel.value = 60;
    }
  },
);
watch(
  () => expandState.value.setVariables,
  (val) => {
    if (val == false && expandState.value.buildQuery == true) {
      sideBarSplitterModel.value = 99;
    } else if (val == false && expandState.value.buildQuery == false) {
      sideBarSplitterModel.value = 0;
    } else if (val == true && expandState.value.buildQuery == false) {
      sideBarSplitterModel.value = 0;
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

filteredTimezone.value = [...timezoneOptions];

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

const timezoneFilterFn = (val: string, update: Function) => {
  filteredTimezone.value = filterColumns(timezoneOptions, val, update);
};

const addField = () => {
  emits("field:add");
};

var triggerOperators: any = ref(["=", "!=", ">=", "<=", ">", "<"]);

const selectedFunction = ref("");

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
    cronJobError.value = "Invalid cron expression";
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

const onBlurQueryEditor = debounce(() => {
  queryEditorPlaceholderFlag.value = true;
  emits("validate-sql");
}, 10);

const validateInputs = (notify: boolean = true) => {
  validateFrequency();

  if (cronJobError.value) {
    notify &&
      q.notify({
        type: "negative",
        message: cronJobError.value,
        timeout: 2000,
      });
    return false;
  }

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
      cronJobError.value = "Invalid cron expression";
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
      .then((stream: any) => {
        streamFields.value = [];
        userDefinedFields.value = [];
        stream.schema?.forEach((field: any) => {
          streamFields.value.push({
            ...field,
            showValues: true,
          });
        });
        stream.uds_schema?.forEach((field: any) => {
          userDefinedFields.value.push({
            ...field,
          });
        });
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
        !loading.value
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
  if (loading.value) return;
  loading.value = true;

  try {
    const res: any = await getStreams(selectedStreamType.value, false);
    streams.value = res.list || [];
    // Set filtered streams to show all streams initially
    filteredStreams.value = streams.value.map((stream: any) => ({
      label: stream.name,
      value: stream.name,
    }));
    // Mark this stream type as loaded
    loadedStreamTypes.value.add(selectedStreamType.value);
  } catch (err) {
    console.log(err);
    streams.value = [];
    filteredStreams.value = [];
  } finally {
    loading.value = false;
  }
}

// Clear loaded streams when stream type changes
watch(
  () => selectedStreamType.value,
  () => {
    streams.value = [];
    filteredStreams.value = [];
    if (!loadedStreamTypes.value.has(selectedStreamType.value)) {
      getStreamList();
    }
  },
);

const handleSidebarEvent = (event: string, value: any) => {
  if (pipelineEditorRef.value) {
    let cursorIndex = pipelineEditorRef.value?.getCursorIndex();

    // Split the value by '=' and take the first part
    const insertValue = value.split("=")[0].trim();

    // Add spaces before and after the value
    const valueToInsert = ` ${insertValue} `;
    // Get current query value
    const currentQuery: any = pipelineEditorRef.value.getValue();
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
  if(!dateTime.value.startTime) {
    notificationMsgValue.value = "The selected start time is  invalid. Please choose a valid time.";
    return null;
  }
  if(!dateTime.value.endTime){
     notificationMsgValue.value = "The selected end time is  invalid. Please choose a valid time.";
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
        "derived_stream",
      )
      .then((res: any) => {
        if (res.data.hits.length > 0) {
          rows.value = res.data.hits;
        } else {
          rows.value = [];
        }
      })
      .catch((err: any) => {
        if(err.response?.data){
          notificationMsgValue.value = err.response?.data?.message || err.response?.data
        }
        else {
          notificationMsgValue.value = "Error while getting results"
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
  q.fullscreen.toggle();
  isFullscreen.value = !isFullscreen.value;
};

watch(
  () => q.fullscreen.isActive,
  (val) => {
    isFullscreen.value = val;
    emits("update:fullscreen", val);
  },
);

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
  copyToClipboard(copyData).then(() =>
    q.notify({
      type: "positive",
      message: "Content Copied Successfully!",
      timeout: 1000,
    }),
  );
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
    : getImageURL("images/common/ai_icon.svg");
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

const sendToAiChat = (value: any) => {
  aiChatInputContext.value = value;
  store.dispatch("setIsAiChatEnabled", true);
};

defineExpose({
  tab,
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
  sendToAiChat,
  aiChatInputContext,
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
</style>
<style lang="scss">
.scheduled-pipeline-container {
  height: 100%;
  .q-splitter__before {
    overflow: hidden;
  }
  .q-splitter__after {
    overflow: hidden;
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
      width: 97% !important;
      border: 1px solid $border-color;
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

    .q-icon {
      font-size: 15px;
      color: #ffffff;
    }
  }
}
.o2-custom-splitter{
    >.q-splitter__separator {
      width: 0.625rem; // 10px
      z-index: 999 !important;
      height: 100%;
      background: transparent;
    }
}
</style>
