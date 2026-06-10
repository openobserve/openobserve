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
  <div class="tw:w-full tw:h-full tw:flex tw:flex-col">
    <div data-test="add-report-section" class="tw:w-full tw:flex tw:flex-col tw:flex-1 tw:min-h-0 create-report-page">
      <AppPageHeader
        :title="isEditingReport ? t('reports.update') : t('reports.add')"
        :back="{
          label: t('reports.header'),
          onClick: () => router.back(),
          dataTest: 'add-report-back-btn',
        }"
        class="tw:px-4 tw:border-b tw:border-border-default"
      >
        <template #title>
          <span data-test="add-report-title">{{
            isEditingReport ? t("reports.update") : t("reports.add")
          }}</span>
        </template>
      </AppPageHeader>
      <div
        class="tw:flex card-container tw:flex-1 tw:min-h-0 tw:overflow-auto"
      >
        <div
          ref="addAlertFormRef"
          class="tw:px-4 tw:my-3"
          style="width: 1024px"
        >
          <form
            class="create-report-form"
            @submit.prevent="onSubmit"
          >
            <div
              class="tw:flex tw:items-start tw:gap-4 tw:px-2"
              style="padding-top: 0.75rem"
            >
              <div data-test="add-report-name-input" class="o2-input">
                <OInput
                  data-test="add-report-name-input"
                  v-model.trim="formData.name"
                  :label="t('alerts.name') + ' *'"
                  color="input-border"
                  class="showLabelOnTop"
                  v-bind:readonly="isEditingReport"
                  :disabled="isEditingReport"
                  :error="!!nameError"
                  :error-message="nameError"
                  help-text="Characters like :, ?, /, #, and spaces are not allowed."
                  @update:model-value="nameError = ''"
                  tabindex="0"
                  style="width: 20.625rem"
                >
                </OInput>
              </div>

              <div
                data-test="add-report-folder-select"
                class="o2-input"
                style="width: 15.625rem"
              >
                <SelectFolderDropdown
                  :activeFolderId="selectedReportFolderId"
                  type="reports"
                  :disableDropdown="isEditingReport"
                  @folder-selected="
                    (f: any) => (selectedReportFolderId = f.value)
                  "
                />
              </div>
            </div>

            <div
              data-test="add-report-description-input"
              class="report-name-input o2-input tw:px-2 tw:pt-3"
            >
              <OInput
                data-test="add-report-description-input"
                v-model="formData.description"
                :label="t('reports.description')"
                color="input-border"
                class="showLabelOnTop"
                tabindex="0"
                style="width: 600px"
              />
            </div>

            <div class="tw:flex tw:items-center tw:pt-4">
              <OSwitch
                data-test="report-cached-toggle-btn"
                v-model="isCachedReport"
                size="lg"
                :label="t('reports.cachedReport')"
              />
              <OIcon
                name="info-outline"
                class="tw:cursor-pointer tw:ml-2"
                size="sm"
              >
                <OTooltip
                  side="right"
                  align="center"
                >
                  <template #content>Note: Cached reports are stored for quick access to
                  dashboards; sharing is disabled for these reports.</template>
                </OTooltip>
              </OIcon>
            </div>

            <OStepper
              v-model="step"
              orientation="vertical"
              animated
              navigable
              class="tw:mt-3"
            >
              <OStep
                data-test="add-report-select-dashboard-step"
                :name="1"
                title="Select Dashboard"
                icon="edit"
                :done="step > 1"
              >
                <template
                  v-for="(dashboard, index) in formData.dashboards"
                  :key="dashboard.folder + dashboard.dashboard"
                >
                  <div
                    :data-test="`add-report-dashboard-${index}`"
                    class="tw:my-2 tw:px-2 tw:flex tw:flex-col"
                  >
                    <div class="tw:flex tw:items-center tw:justify-start">
                    <div
                      data-test="add-report-folder-select"
                      class="o2-input tw:mr-2"
                      style="padding-top: 0; width: 30%"
                    >
                      <OSelect
                        data-test="add-report-dashboard-folder-select"
                        v-model="dashboard.folder"
                        :options="folderOptions"
                        :label="t('reports.dashboardFolder') + ' *'"
                        :loading="isFetchingFolders"
                        :error="index === 0 && !!folderError"
                        :error-message="index === 0 ? folderError : ''"
                        @update:model-value="folderError = ''; onFolderSelection(dashboard.folder)"
                        style="min-width: 250px !important; width: 100% !important;"
                      />
                    </div>
                    <div
                      data-test="add-report-dashboard-select"
                      class="o2-input tw:mr-2"
                      style="padding-top: 0; width: 30%"
                    >
                      <OSelect
                        data-test="add-report-dashboard-name-select"
                        v-model="dashboard.dashboard"
                        :options="dashboardOptions"
                        :label="t('reports.dashboard') + ' *'"
                        :loading="isFetchingDashboard || isFetchingFolders"
                        :error="index === 0 && !!dashboardError"
                        :error-message="index === 0 ? dashboardError : ''"
                        @update:model-value="dashboardError = ''; onDashboardSelection(dashboard.dashboard)"
                        style="min-width: 250px !important; width: 100% !important;"
                      />
                    </div>
                    <div
                      data-test="add-report-tab-select"
                      class="o2-input"
                      style="padding-top: 0; width: 30%"
                    >
                      <OSelect
                        data-test="add-report-dashboard-tab-select"
                        v-model="dashboard.tabs"
                        :options="dashboardTabOptions"
                        :label="t('reports.dashboardTab') + ' *'"
                        :loading="isFetchingDashboard || isFetchingFolders"
                        :error="index === 0 && !!tabError"
                        :error-message="index === 0 ? tabError : ''"
                        @update:model-value="tabError = ''"
                        style="min-width: 250px !important; width: 100% !important;"
                      />
                    </div>
                    </div>

                    <div
                      data-test="add-report-timerange-select"
                      class="tw:w-full tw:mt-2"
                    >
                      <div class="tw:mb-2">
                        <div
                          style="font-size: 14px"
                          class="tw:font-bold tw:text-gray-500"
                        >
                          Time Range*
                        </div>
                        <div style="font-size: 12px">
                          Generates report with the data from specified time
                          range
                        </div>
                      </div>
                      <DateTime
                        auto-apply
                        :default-type="dashboard.timerange.type"
                        :default-absolute-time="{
                          startTime: dashboard.timerange.from,
                          endTime: dashboard.timerange.to,
                        }"
                        :default-relative-time="dashboard.timerange.period"
                        data-test="add-report-timerange-dropdown"
                        menu-align="start"
                        @on:date-change="updateDateTime"
                      />
                    </div>

                    <div
                      data-test="add-report-variable-select"
                      class="tw:w-full tw:mt-3 o2-input"
                    >
                      <VariablesInput
                        :variables="dashboard.variables"
                        @add:variable="addDashboardVariable"
                        @remove:variable="removeDashboardVariable"
                      />
                    </div>

                    <!-- Report Format -->
                    <div
                      class="tw:w-full tw:mt-3"
                      data-test="add-report-format-section"
                    >
                      <div
                        style="font-size: 14px"
                        class="tw:font-bold tw:text-gray-500 tw:mb-2"
                      >
                        {{ t("reports.reportFormat") }}
                      </div>
                      <div class="tw:flex tw:gap-3">
                        <!-- Report Type -->
                        <div
                          class="col-auto o2-input"
                          data-test="add-report-type-select"
                        >
                          <OSelect
                            v-model="dashboard.report_type"
                            :options="[
                              { label: 'PDF (default)', value: 'pdf' },
                              { label: 'PNG (Image)', value: 'png' },
                              { label: 'CSV (Data)', value: 'csv' },
                            ]"
                            :label="t('reports.reportType')"
                            color="input-border"
                            class="showLabelOnTop"
                            style="min-width: 180px"
                          />
                        </div>

                        <!-- Email Attachment Type -->
                        <div
                          v-if="dashboard.report_type !== 'csv'"
                          class="col-auto o2-input"
                          data-test="add-report-attachment-type-select"
                        >
                          <OSelect
                            v-model="dashboard.email_attachment_type"
                            :options="
                              attachmentTypeOptions(dashboard.report_type)
                            "
                            :label="t('reports.attachmentType')"
                            class="showLabelOnTop"
                            style="min-width: 200px"
                          />
                        </div>
                      </div>

                      <!-- PNG note -->
                      <div
                        v-if="dashboard.report_type === 'png'"
                        class="tw:mt-2"
                        data-test="add-report-png-note"
                      >
                        <OBanner
                          variant="warning"
                          icon="info"
                          content="PNG captures only the first visible page of the dashboard. Use PDF if the dashboard spans multiple pages."
                        />
                      </div>

                      <!-- Custom Dimensions (Advanced) -->
                      <div
                        v-if="dashboard.report_type !== 'csv'"
                        class="tw:mt-3"
                        data-test="add-report-custom-dimensions-section"
                      >
                        <div
                          class="tw:flex tw:items-center tw:cursor-pointer"
                          style="font-size: 14px; color: inherit"
                          @click="showCustomDimensions = !showCustomDimensions"
                        >
                          <OIcon
                            :name="
                              showCustomDimensions
                                ? 'expand-less'
                                : 'expand-more'
                            "
                            size="sm"
                            class="tw:mr-1"
                          />
                          <span class="tw:font-bold tw:text-gray-500">{{
                            t("reports.customDimensions")
                          }}</span>
                        </div>
                        <div
                          v-if="showCustomDimensions"
                          class="tw:flex tw:gap-3 tw:pt-2"
                        >
                          <div class="col-auto o2-input">
                            <OInput
                              :model-value="
                                dashboard.attachment_dimensions?.width ?? ''
                              "
                              @update:model-value="
                                (v) => setDimension(dashboard, 'width', v)
                              "
                              type="number"
                              min="1"
                              :label="t('reports.dimensionWidth')"
                              color="input-border"
                              class="showLabelOnTop"
                              style="min-width: 120px"
                              placeholder="e.g. 1440"
                              data-test="add-report-dimension-width"
                            />
                          </div>
                          <div class="col-auto o2-input">
                            <OInput
                              :model-value="
                                dashboard.attachment_dimensions?.height ?? ''
                              "
                              @update:model-value="
                                (v) => setDimension(dashboard, 'height', v)
                              "
                              type="number"
                              min="1"
                              :label="t('reports.dimensionHeight')"
                              color="input-border"
                              class="showLabelOnTop"
                              style="min-width: 120px"
                              placeholder="e.g. 900"
                              data-test="add-report-dimension-height"
                            />
                          </div>
                          <div class="col-auto tw:flex tw:items-end">
                            <div class="tw:text-xs tw:text-gray-400 tw:pb-1">
                              Leave blank to use server defaults
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-report-step1-continue-btn"
                    variant="primary"
                    size="sm-action"
                    @click="step++"
                  >
                    Continue
                  </OButton>
                </div>
              </OStep>

              <OStep
                data-test="add-report-select-schedule-step"
                :name="2"
                title="Schedule"
                icon="schedule"
                :done="step > 2"
                class="tw:mt-3"
              >
                <div class="tw:my-2 tw:px-2">
                  <!-- <div class="tw:flex tw:justify-start tw:items-center tw:py-2">
                <OIcon name="event" size="sm" class="tw:mr-2" />
                <div style="font-size: 14px">
                  The report will be sent immediately after it is saved and will
                  be sent every hour.
                </div>
              </div> -->
                  <div
                    style="font-size: 14px"
                    class="tw:font-bold tw:text-gray-500 tw:mb-2"
                  >
                    Frequency
                  </div>
                  <OToggleGroup
                    :model-value="frequency.type"
                    @update:model-value="frequency.type = $event as string"
                    data-test="add-report-schedule-frequency-tabs"
                  >
                    <OToggleGroupItem
                      v-for="visual in frequencyTabs"
                      :key="visual.value"
                      :data-test="`add-report-schedule-frequency-${visual.value}-btn`"
                      :value="visual.value"
                      size="sm"
                    >
                      {{ visual.label }}
                    </OToggleGroupItem>
                  </OToggleGroup>

                  <template v-if="frequency.type === 'cron'">
                    <div class="tw:flex tw:items-center tw:justify-start tw:mt-3">
                      <div
                        data-test="add-report-schedule-custom-interval-input"
                        class="o2-input tw:mr-2"
                        style="padding-top: 0; width: 320px"
                      >
                        <div class="tw:mb-1 tw:font-bold tw:text-gray-500">
                          {{ t("reports.cronExpression") + " *" }}
                          <OIcon
                            name="info"
                            size="sm"
                            class="tw:ml-1 tw:cursor-pointer tw:text-gray-400"
                          >
                            <OTooltip side="right" align="center">
                              <template #content><span style="font-size: 14px">
                                Pattern: * * * * * * means every second.
                                <br />
                                Format: [Second (optional) 0-59] [Minute 0-59]
                                [Hour 0-23] [Day of Month 1-31, 'L'] [Month
                                1-12] [Day of Week 0-7 or '1L-7L', 0 and 7 for
                                Sunday].
                                <br />
                                Use '*' to represent any value, 'L' for the last
                                day/weekday. <br />
                                Example: 0 0 12 * * ? - Triggers at 12:00 PM
                                daily. It specifies second, minute, hour, day of
                                month, month, and day of week,
                                respectively.</span
                              ></template>
                            </OTooltip>
                          </OIcon>
                        </div>
                        <OInput
                          v-model="frequency.cron"
                          color="input-border"
                          type="text"
                          outlined
                          :error="!!cronError"
                          :error-message="cronError"
                          style="width: 100%"
                          :debounce="400"
                          @update:model-value="validateFrequency"
                        />
                      </div>
                      <div class="o2-input">
                        <OSelect
                          data-test="add-report-schedule-start-timezone-select"
                          v-model="scheduling.timezone"
                          :options="timezoneOptions"
                          :label="t('logStream.timezone') + ' *'"
                          :error="!!timezoneError"
                          :error-message="timezoneError"
                          @update:model-value="timezoneError = ''"
                          class="timezone-select showLabelOnTop"
                          style="width: 300px"
                        />
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="tw:mt-3 tw:flex tw:justify-start tw:items-center"
                    >
                      <OToggleGroup
                        :model-value="selectedTimeTab"
                        @update:model-value="selectedTimeTab = $event as string"
                      >
                        <OToggleGroupItem
                          v-for="visual in timeTabs"
                          :key="visual.value"
                          :data-test="`add-report-schedule-${visual.value}-btn`"
                          :value="visual.value"
                          size="sm"
                        >
                          {{ visual.label }}
                        </OToggleGroupItem>
                      </OToggleGroup>
                      <OIcon
                        name="info-outline"
                        class="tw:cursor-pointer tw:ml-2"
                        size="sm"
                      >
                        <OTooltip side="right" align="center">
                          <template #content>"Schedule Now" will schedule the report using the
                          current date, time, and timezone.<br />
                          In "Schedule Later" you can customize the date, time,
                          and timezone.</template>
                        </OTooltip>
                      </OIcon>
                    </div>

                    <div
                      v-if="frequency.type === 'custom'"
                      class="tw:flex tw:items-start tw:justify-start tw:mt-3"
                    >
                      <div
                        data-test="add-report-schedule-custom-interval-input"
                        class="o2-input tw:mr-2"
                        style="padding-top: 0; width: 160px"
                      >
                        <OInput
                          v-model="frequency.custom.interval"
                          label="Repeat every *"
                          color="input-border"
                          class="showLabelOnTop"
                          type="number"
                          :error="!!intervalError"
                          :error-message="intervalError"
                          @update:model-value="intervalError = ''"
                          style="width: 100%"
                        />
                      </div>

                      <div
                        data-test="add-report-schedule-custom-frequency-select"
                        class="o2-input"
                        style="padding-top: 0; width: 160px"
                      >
                        <OSelect
                          v-model="frequency.custom.period"
                          :options="customFrequencyOptions"
                          :label="'Frequency *'"
                          class="showLabelOnTop no-case"
                          :error="!!periodError"
                          :error-message="periodError"
                          @update:model-value="periodError = ''"
                          style="width: 100% !important"
                        />
                      </div>
                    </div>

                    <div
                      data-test="add-report-schedule-send-later-section"
                      v-if="selectedTimeTab === 'scheduleLater'"
                      class="tw:flex tw:items-center tw:justify-start tw:mt-3"
                    >
                      <div
                        data-test="add-report-schedule-start-date-input"
                        class="o2-input tw:mr-2"
                      >
                        <ODate
                          v-model="scheduling.date"
                          :label="'Start Date *'"
                          data-test="add-report-schedule-start-date-field"
                        />
                      </div>
                      <div
                        data-test="add-report-schedule-start-time-input"
                        class="o2-input tw:mr-2"
                      >
                        <OTime
                          v-model="scheduling.time"
                          :label="'Start Time *'"
                          data-test="add-report-schedule-start-time-field"
                        />
                      </div>
                      <div class="o2-input">
                        <OSelect
                          data-test="add-report-schedule-start-timezone-select"
                          v-model="scheduling.timezone"
                          :options="timezoneOptions"
                          :label="t('logStream.timezone') + ' *'"
                          :error="!!timezoneError"
                          :error-message="timezoneError"
                          @update:model-value="timezoneError = ''"
                          class="timezone-select showLabelOnTop"
                          style="width: 300px"
                        />
                      </div>
                    </div>
                  </template>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-report-step2-back-btn"
                    variant="outline"
                    size="sm-action"
                    @click="step--"
                  >
                    Back
                  </OButton>
                  <OButton
                    data-test="add-report-step2-continue-btn"
                    variant="primary"
                    size="sm-action"
                    @click="step++"
                  >
                    Continue
                  </OButton>
                </div>
              </OStep>

              <OStep
                v-if="!isCachedReport"
                data-test="add-report-share-step"
                :name="3"
                title="Share"
                icon="mail"
                :done="step > 3"
                class="tw:mt-3"
              >
                <div class="tw:my-2 tw:px-2">
                  <div
                    data-test="add-report-share-title-input"
                    class="report-name-input o2-input"
                  >
                    <OInput
                      data-test="add-report-share-title-input"
                      v-model="formData.title"
                      :label="t('reports.title') + ' *'"
                      :error="!!titleError"
                      :error-message="titleError"
                      @update:model-value="titleError = ''"
                      tabindex="0"
                      style="width: 400px"
                    />
                  </div>

                  <div
                    data-test="add-report-share-recipients-input"
                    class="report-name-input o2-input tw:pt-3"
                  >
                    <OInput
                      data-test="add-report-share-recipients-input"
                      v-model="emails"
                      :label="t('reports.recipients') + ' *'"
                      :error="!!recipientsError"
                      :error-message="recipientsError"
                      @update:model-value="recipientsError = ''"
                      tabindex="0"
                      style="width: 100%"
                      :placeholder="t('user.inviteByEmail')"
                    />
                  </div>
                  <div data-test="add-report-share-message-section" class="tw:pt-3">
                    <div style="font-size: 14px" class="tw:font-bold tw:text-gray-500">
                      Message
                    </div>

                    <div data-test="add-report-share-message-input">
                      <OInput
                        v-model="formData.message"
                        type="textarea"
                      />
                    </div>
                  </div>

                  <!-- Image Preview toggle — only shown when all dashboards are PDF type -->
                  <div
                    v-if="allDashboardsArePdf"
                    class="tw:flex tw:items-center tw:pt-4"
                    data-test="add-report-image-preview-section"
                  >
                    <OSwitch
                      v-model="formData.imagePreview"
                      size="lg"
                      :label="t('reports.imagePreview')"
                      data-test="add-report-image-preview-toggle"
                    />
                    <OIcon
                      name="info-outline"
                      class="tw:cursor-pointer tw:ml-2"
                      size="sm"
                    >
                      <OTooltip max-width="320px">
                        <template #content>Captures a PNG screenshot of the dashboard and embeds it
                        tw:inline in the email body alongside the PDF attachment
                        for a quick visual preview.</template>
                      </OTooltip>
                    </OIcon>
                  </div>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-report-step3-back-btn"
                    variant="outline"
                    size="sm-action"
                    @click="step--"
                  >
                    Back
                  </OButton>
                </div>
              </OStep>
            </OStepper>
          </form>
        </div>
      </div>
    </div>
    <div
      class="tw:flex tw:justify-end tw:px-3 tw:w-full tw:py-3 card-container tw:sticky! tw:bottom-0 tw:border-t tw:border-[var(--o2-border-color)]"
      style="z-index: 2"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >
      <OButton
        data-test="add-report-cancel-btn"
        variant="outline"
        size="sm-action"
        class="tw:mr-2"
        @click="openCancelDialog"
      >
        {{ t("alerts.cancel") }}
      </OButton>
      <OButton
        data-test="add-report-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        @click="saveReport"
      >
        {{ t("alerts.save") }}
      </OButton>
    </div>
  </div>
  <ConfirmDialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import {
  getUUID,
  useLocalTimezone,
  isValidResourceName,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/zincutils";
import VariablesInput from "@/components/alerts/VariablesInput.vue";
import { useStore } from "vuex";
import dashboardService from "@/services/dashboards";
import { onBeforeMount } from "vue";
import type { Ref } from "vue";
import { DateTime as _DateTime } from "luxon";
import reports from "@/services/reports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CronExpressionParser from "cron-parser";
import { convertDateToTimestamp } from "@/utils/date";
import { useReo } from "@/services/reodotdev_analytics";
import SelectFolderDropdown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODate from "@/lib/forms/Date/ODate.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { getFoldersListByType } from "@/utils/commons";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = defineProps({
  report: {
    type: Object,
    default: null,
  },
});

const defaultReport = {
  dashboards: [
    {
      folder: "",
      dashboard: "",
      tabs: "" as string | string[],
      variables: [] as { key: string; value: string; id: string }[],
      timerange: {
        type: "relative",
        period: "30m",
        from: 0,
        to: 0,
      },
      report_type: "pdf" as "pdf" | "png" | "csv",
      email_attachment_type: "standard" as "standard" | "inline",
      attachment_dimensions: null as { width: number; height: number } | null,
    },
  ],
  description: "",
  destinations: [
    {
      email: "",
    },
  ],
  enabled: true,
  imagePreview: false,
  name: "",
  title: "",
  message: "",
  orgId: "",
  start: 0,
  frequency: {
    interval: 1,
    type: "once",
    cron: "",
  },
  user: "",
  password: "",
  timezone: "UTC",
  timezoneOffset: 0,
  lastTriggeredAt: null,
  createdAt: "",
  updatedAt: "",
  owner: "",
  lastEditedBy: "",
  report_type: "PDF",
};

const { t } = useI18n();
const router = useRouter();

const isCachedReport = ref(false);

const showInfoTooltip = ref(false);

const originalReportData: Ref<string> = ref("");

const step = ref(1);

const formData = ref(defaultReport);


const { track } = useReo();

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const timeTabs = [
  {
    label: "Schedule now",
    value: "scheduleNow",
  },
  {
    label: "Schedule later",
    value: "scheduleLater",
  },
];

const frequencyTabs = [
  {
    label: "Cron Job",
    value: "cron",
  },
  {
    label: "Once",
    value: "once",
  },
  {
    label: "Hourly",
    value: "hours",
  },
  {
    label: "Daily",
    value: "days",
  },
  {
    label: "Weekly",
    value: "weeks",
  },
  {
    label: "Monthly",
    value: "months",
  },
  {
    label: "Custom",
    value: "custom",
  },
];

const selectedTimeTab = ref("scheduleNow");

const store = useStore();

const filteredTimezone: any = ref([]);

const folderOptions: Ref<{ label: string; value: string }[]> = ref([]);

const dashboardOptions: Ref<
  { label: string; value: string; tabs: any[]; version: number }[]
> = ref([]);

const dashboardTabOptions: Ref<{ label: string; value: string }[]> = ref([]);

const options: Ref<{ [key: string]: any[] }> = ref({});

const emails = ref("");

const isEditingReport = ref(false);

const selectedReportFolderId = ref<string>(
  (router.currentRoute.value.query.folder as string) || "default",
);

const isFetchingReport = ref(false);

const cronError = ref("");
const folderError = ref("");
const dashboardError = ref("");
const tabError = ref("");
const timezoneError = ref("");
const titleError = ref("");
const recipientsError = ref("");
const nameError = ref("");
const intervalError = ref("");
const periodError = ref("");

const frequency = ref({
  type: "once",
  custom: {
    interval: 1,
    period: "days",
  },
  cron: "",
});

onBeforeMount(async () => {
  await getFoldersListByType(store, "reports");
  await getDashboaordFolders();

  const query = router.currentRoute.value.query;
  isEditingReport.value = !!(query?.report_id || query?.name);

  if (!isEditingReport.value) setInitialReportData();

  if (isEditingReport.value) {
    isFetchingReport.value = true;

    const reportId = query?.report_id as string | undefined;
    const reportName = (query?.name || "") as string;
    const org = store.state.selectedOrganization.identifier;

    const fetchPromise = reportId
      ? reports.getReportById(org, reportId)
      : reports.getReport(org, reportName);

    fetchPromise
      .then((res: any) => {
        setupEditingReport(res.data);
        originalReportData.value = JSON.stringify(formData.value);
      })
      .catch((err) => {
        if (err.response.status != 403) {
          toast({
            variant: "error",
            message:
              err.response?.data?.message || "Error while fetching report!",
          });
        }
      })
      .finally(() => {
        isFetchingReport.value = false;
      });
  } else {
    originalReportData.value = JSON.stringify(formData.value);
  }
});

const isFetchingFolders = ref(false);

const isFetchingDashboard = ref(false);

const onSubmit = () => {};

const scheduling = ref({
  date: "",
  time: "",
  timezone: "",
});

const isValidName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(formData.value.name);
});

const setInitialReportData = async () => {
  const queryParams = router.currentRoute.value.query;

  if (queryParams.type === "cached") {
    isCachedReport.value = true;
  } else {
    isCachedReport.value = false;
  }

  // Support both ?folder= (from ReportList) and ?folderId= (legacy links)
  const reportFolderId = (queryParams.folder || queryParams.folderId) as
    | string
    | undefined;
  if (reportFolderId) {
    formData.value.dashboards[0].folder = reportFolderId;
    await onFolderSelection(reportFolderId);
  }

  if (reportFolderId && queryParams.dashboardId) {
    formData.value.dashboards[0].dashboard = queryParams.dashboardId as string;
    setDashboardTabOptions(queryParams.dashboardId);
  }

  if (queryParams.dashboardId && queryParams.tabId) {
    formData.value.dashboards[0].tabs = queryParams.tabId as string;
  }
};

const onFolderSelection = async (id: string) => {
  formData.value.dashboards.forEach((dashboard: any) => {
    dashboard.dashboard = "";
    dashboard.tabs = "";
  });

  try {
    await setDashboardOptions(id);
    return true;
  } catch (err) {
    return false;
  }
};

const setDashboardOptions = (id: string) => {
  dashboardOptions.value.length = 0;
  isFetchingDashboard.value = true;
  return new Promise((resolve, reject) => {
    dashboardService
      .list(
        0,
        10000,
        "name",
        false,
        "",
        store.state.selectedOrganization.identifier,
        id,
        "",
      )
      .then((response: any) => {
        response.data.dashboards
          .map((dash: any) => Object.values(dash).filter((dash) => dash)[0])
          .forEach(
            (dashboard: {
              title: string;
              dashboardId: string;
              tabs: any[];
              version: number;
            }) => {
              dashboardOptions.value.push({
                label: dashboard.title,
                value: dashboard.dashboardId,
                tabs: dashboard?.tabs?.map((tab) => ({
                  label: tab.name,
                  value: tab.tabId,
                })) || [{ label: "Default", value: "default" }],
                version: dashboard.version,
              });
              options.value["dashboards"] = [...dashboardOptions.value];
            },
          );

        resolve(true);
      })
      .catch((err) => reject(true))
      .finally(() => (isFetchingDashboard.value = false));
  });
};

const onDashboardSelection = (dashboardId: any) => {
  formData.value.dashboards.forEach((dashboard: any) => {
    dashboard.tabs = "";
  });
  setDashboardTabOptions(dashboardId);
};

const setDashboardTabOptions = (dashboardId: any) => {
  const defaultTabs = [{ label: "Default", value: "default" }];

  dashboardTabOptions.value =
    dashboardOptions.value.filter(
      (dashboard) => dashboard.value === dashboardId,
    )[0].tabs || defaultTabs;

  options.value["tabs"] = [...dashboardTabOptions.value];
};

const showCustomDimensions = ref(false);

// Returns true when every dashboard in the report is configured as PDF type.
// Used to show/hide the imagePreview toggle (preview only applies to PDF).
const allDashboardsArePdf = computed(() =>
  formData.value.dashboards.every((d: any) => d.report_type === "pdf"),
);

// Returns the available attachment type options for a given report type.
// Inline is disabled for PDF since the report server does not support it.
const attachmentTypeOptions = (reportType: string) => [
  { label: "Standard — downloadable attachment (default)", value: "standard" },
  {
    label: "Inline — embedded in email body",
    value: "inline",
    disable: reportType === "pdf",
  },
];

// Sets a single dimension key (width or height) on a dashboard's attachment_dimensions.
// If both keys would be empty/zero after the change, clears the object to null.
const setDimension = (
  dashboard: any,
  key: "width" | "height",
  rawValue: string | number | null,
) => {
  const val = rawValue === "" || rawValue === null ? 0 : Number(rawValue);
  if (!dashboard.attachment_dimensions) {
    dashboard.attachment_dimensions = { width: 0, height: 0 };
  }
  dashboard.attachment_dimensions[key] = val;
  const { width, height } = dashboard.attachment_dimensions;
  if (!width && !height) {
    dashboard.attachment_dimensions = null;
  }
};

const updateDateTime = (datetime: any) => {
  formData.value.dashboards[0].timerange.type =
    datetime.valueType === "relative-custom" ? "relative" : datetime.valueType;

  formData.value.dashboards[0].timerange.from = datetime.startTime;
  formData.value.dashboards[0].timerange.to = datetime.endTime;

  formData.value.dashboards[0].timerange.period =
    datetime.relativeTimePeriod || "30m";
};

const customFrequencyOptions = [
  {
    label: "days",
    value: "days",
  },
  {
    label: "hours",
    value: "hours",
  },
  {
    label: "weeks",
    value: "weeks",
  },
  {
    label: "months",
    value: "months",
  },
];

const currentTimezone =
  useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezone = ref(currentTimezone);

const timezoneFilterFn = (val: string, update: Function) => {
  filteredTimezone.value = filterColumns(timezoneOptions, val, update);
};

const filterColumns = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
    return filteredOptions;
  }
  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter(
      (column: any) => column.toLowerCase().indexOf(value) > -1,
    );
  });
  return filteredOptions;
};

// @ts-ignore
let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
  return tz;
});

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

const addDashboardVariable = () => {
  formData.value.dashboards[0].variables.push({
    key: "",
    value: "",
    id: getUUID(),
  });
};

const removeDashboardVariable = (variable: any) => {
  formData.value.dashboards[0].variables =
    formData.value.dashboards[0].variables.filter(
      (_variable: any) => _variable.id !== variable.id,
    );
};

const getDashboaordFolders = () => {
  return new Promise((resolve, reject) => {
    isFetchingFolders.value = true;
    dashboardService
      .list_Folders(store.state.selectedOrganization.identifier)
      .then((res) => {
        res.data.list.forEach((folder: { name: string; folderId: string }) => {
          folderOptions.value.push({
            label: folder.name,
            value: folder.folderId,
          });
          options.value["folders"] = [...folderOptions.value];
        });
        resolve(true);
      })
      .catch((err) => reject(true))
      .finally(() => {
        isFetchingFolders.value = false;
      });
  });
};

const saveReport = async () => {
  // If frequency is cron, then we set the start timestamp as current time and timezone as browser timezone
  const reportPayload = JSON.parse(JSON.stringify(formData.value));

  if (
    selectedTimeTab.value === "scheduleNow" ||
    frequency.value.type === "cron"
  ) {
    const now = new Date();

    // Get the day, month, and year from the date object
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0"); // January is 0!
    const year = now.getFullYear();

    // Combine them in the YYYY-MM-DD format (ISO 8601, for ODate compatibility)
    scheduling.value.date = `${year}-${month}-${day}`;

    // Get the hours and minutes, ensuring they are formatted with two digits
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    // Combine them in the HH:MM format
    scheduling.value.time = `${hours}:${minutes}`;
  }

  // If the user has selected to schedule now, we set the timezone to the current timezone
  if (selectedTimeTab.value === "scheduleNow") {
    scheduling.value.timezone = timezone.value;
  }

  // scheduling.value.date is always YYYY-MM-DD (ISO 8601),
  // but convertDateToTimestamp expects DD-MM-YYYY
  const [y, m, d] = scheduling.value.date.split("-");
  const dateForConversion = `${d}-${m}-${y}`;

  const convertedDateTime = convertDateToTimestamp(
    dateForConversion,
    scheduling.value.time,
    scheduling.value.timezone,
  );

  reportPayload.start = convertedDateTime.timestamp;

  reportPayload.timezoneOffset = convertedDateTime.offset;

  reportPayload.orgId = store.state.selectedOrganization.identifier;

  reportPayload.destinations = emails.value.split(/[,;]/).map((email) => ({
    email: email.trim(),
  }));

  if (frequency.value.type === "custom") {
    reportPayload.frequency.type = frequency.value.custom.period;
    reportPayload.frequency.interval = Number(frequency.value.custom.interval);
  } else if (frequency.value.type === "cron") {
    reportPayload.frequency.type = frequency.value.type;
    reportPayload.frequency.cron =
      frequency.value.cron.toString().trim() + " *";
  } else {
    reportPayload.frequency.type = frequency.value.type;
    reportPayload.frequency.interval = 1;
    formData.value.frequency.interval = 1;
  }

  reportPayload.timezone = scheduling.value.timezone;

  if (isEditingReport.value) {
    reportPayload.updatedAt = new Date().toISOString();
    reportPayload.lastEditedBy = store.state.userInfo.email;
  } else {
    reportPayload.createdAt = new Date().toISOString();
    reportPayload.owner = store.state.userInfo.email;
    reportPayload.lastTriggeredAt = null;
    reportPayload.lastEditedBy = store.state.userInfo.email;
    reportPayload.updatedAt = new Date().toISOString();
  }

  if (isCachedReport.value) reportPayload.destinations = [];

  // Check if all report input fields are valid
  const isValidForm = await validateReportData();
  if (!isValidForm) return;

  // This is unitil we support multiple dashboards and tabs
  if (reportPayload.dashboards[0]?.tabs)
    reportPayload.dashboards[0].tabs = [
      reportPayload.dashboards[0].tabs as string,
    ];

  // Remove attachment_dimensions when unset so the report server uses its configured defaults.
  if (!reportPayload.dashboards[0]?.attachment_dimensions) {
    delete reportPayload.dashboards[0].attachment_dimensions;
  }

  const org = store.state.selectedOrganization.identifier;
  const routeQuery = router.currentRoute.value.query;
  const reportId = routeQuery?.report_id as string | undefined;
  const folderId = selectedReportFolderId.value || "default";

  let savePromise: Promise<any>;
  if (isEditingReport.value && reportId) {
    // v2 update by ID
    savePromise = reports.updateReportById(org, reportId, reportPayload);
  } else if (isEditingReport.value) {
    // legacy v1 update by name
    savePromise = reports.updateReport(org, reportPayload);
  } else {
    // v2 create with folder
    savePromise = reports.createReportV2(org, reportPayload, folderId);
  }

  const dismiss = toast({
    variant: "loading",
    message: "Please wait...",
      timeout: 0,
});

  savePromise
    .then(() => {
      // Invalidate the folder cache so ReportList fetches fresh data on mount
      const folderId = selectedReportFolderId.value || "default";
      const updated = {
        ...store.state.organizationData.allReportsListByFolderId,
      };
      delete updated[folderId];
      store.dispatch("setAllReportsListByFolderId", updated);

      toast({
        variant: "success",
        message: `Report ${
          isEditingReport.value ? "updated" : "saved"
        } successfully.`,
      });
      goToReports();
    })
    .catch((error) => {
      if (error.response.status != 403) {
        toast({
          variant: "error",
          message:
            error?.response?.data?.message ||
            `Error while ${
              isEditingReport.value ? "updating" : "saving"
            } report.`,
        });
      }
    })
    .finally(() => {
      dismiss();
    });
  track("Button Click", {
    button: "Save Report",
    page: "Add Report",
  });
};

const validateReportData = async (): Promise<boolean> => {
  if (!formData.value.name) {
    nameError.value = t('common.nameRequired');
    step.value = 1;
    return false;
  }
  if (!isValidResourceName(formData.value.name)) {
    nameError.value = 'Characters like :, ?, /, #, and spaces are not allowed.';
    step.value = 1;
    return false;
  }
  nameError.value = '';

  if (!formData.value.dashboards[0].folder) {
    folderError.value = t('validation.required');
    step.value = 1;
    return false;
  }
  folderError.value = '';

  if (!formData.value.dashboards[0].dashboard) {
    dashboardError.value = t('validation.required');
    step.value = 1;
    return false;
  }
  dashboardError.value = '';

  if (!formData.value.dashboards[0].tabs) {
    tabError.value = t('validation.required');
    step.value = 1;
    return false;
  }
  tabError.value = '';

  if (formData.value.dashboards[0].timerange) {
    if (
      formData.value.dashboards[0].timerange.type === "relative" &&
      !formData.value.dashboards[0].timerange.period
    ) {
      step.value = 1;
      return false;
    }

    if (
      formData.value.dashboards[0].timerange.type === "absolute" &&
      !(
        formData.value.dashboards[0].timerange.to &&
        formData.value.dashboards[0].timerange.from
      )
    ) {
      step.value = 1;
      return false;
    }
  }

  if (formData.value.frequency.type === "cron") {
    try {
      cronError.value = "";
      CronExpressionParser.parse(frequency.value.cron, {
        currentDate: new Date(),
        utc: true,
      });
      validateFrequency();
    } catch (err) {
      cronError.value = "Invalid cron expression!";
      return false;
    }
  }

  if (formData.value.frequency.type === "cron" && cronError.value) {
    step.value = 2;
    return false;
  }

  console.log(JSON.parse(JSON.stringify(formData.value)));

  if (!formData.value.frequency.interval || !formData.value.frequency.type) {
    if (formData.value.frequency.type === "custom") {
      if (!frequency.value.custom.interval) {
        intervalError.value = t('validation.required');
        step.value = 2;
        return false;
      }
      intervalError.value = '';
      if (!frequency.value.custom.period) {
        periodError.value = t('validation.required');
        step.value = 2;
        return false;
      }
      periodError.value = '';
    }
    step.value = 2;
    return false;
  }

  if (!scheduling.value.timezone) {
    timezoneError.value = t('validation.required');
    step.value = 2;
    return false;
  }
  timezoneError.value = '';

  // Share step validation only applies to non-cached reports
  if (!isCachedReport.value) {
    if (!formData.value.title) {
      titleError.value = t('validation.required');
      step.value = 3;
      return false;
    }
    titleError.value = '';

    const emailRegex = /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/;
    if (!emailRegex.test(emails.value)) {
      recipientsError.value = 'Add valid emails!';
      step.value = 3;
      return false;
    }
    recipientsError.value = '';
  }

  return true;
};

const validateFrequency = () => {
  cronError.value = "";
  if (frequency.value.type === "cron") {
    try {
      const intervalInSecs = getCronIntervalDifferenceInSeconds(
        frequency.value.cron,
      );

      // parse cron expression
      if (frequency.value.cron.trim().split(" ").length !== 6) {
        cronError.value =
          "Cron expression must have exactly 6 fields: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]";
        return;
      }

      if (
        typeof intervalInSecs === "number" &&
        !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
      ) {
        const minInterval =
          Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
        cronError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
        return;
      }
    } catch (err) {
      cronError.value = "Invalid cron expression!";
      return;
    }
  }
};

const goToReports = () => {
  router.replace({
    name: "reports",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      folder: selectedReportFolderId.value || "default",
    },
  });
};

const onFilterOptions = (type: string, val: String, update: Function) => {
  if (type === "folders") {
    folderOptions.value = filterOptions(options.value[type] || [], val, update);
  }

  if (type === "dashboards") {
    dashboardOptions.value = filterOptions(
      options.value[type] || [],
      val,
      update,
    );
  }

  if (type === "tabs") {
    dashboardTabOptions.value = filterOptions(
      dashboardTabOptions.value,
      val,
      update,
    );
  }
};

const filterOptions = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter((option: any) => {
      return option.label.toLowerCase().indexOf(value) > -1;
    });
  });

  return filteredOptions;
};

const setupEditingReport = async (report: any) => {
  formData.value = {
    ...report,
    dashboards: [
      {
        folder: "",
        dashboard: "",
        tabs: "" as string | string[],
        variables: report.dashboards[0].variables,
        timerange: report.dashboards[0].timerange,
        report_type: report.dashboards[0].report_type,
        email_attachment_type: report.dashboards[0].email_attachment_type,
        attachment_dimensions: report.dashboards[0].attachment_dimensions,
      },
    ],
  };

  // set date, time and timezone in scheduling
  // Use Luxon to interpret the timestamp in the report's own timezone so that
  // the displayed date/time matches what convertDateToTimestamp will re-encode
  // on save. Using plain `new Date()` would interpret the timestamp in the
  // browser's local timezone, causing a compounding offset on every save when
  // the browser and report timezones differ.
  const reportTimezone = report.timezone
    .toLowerCase()
    .startsWith("browser time")
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : report.timezone;
  const dateInReportTz = _DateTime.fromMillis(report.start / 1000, {
    zone: reportTimezone,
  });

  // Combine them in the YYYY-MM-DD format (ISO 8601, for ODate compatibility)
  scheduling.value.date = dateInReportTz.toFormat("yyyy-MM-dd");

  // Combine them in the HH:MM format
  scheduling.value.time = dateInReportTz.toFormat("HH:mm");

  scheduling.value.timezone = report.timezone;

  // set selectedTimeTab to scheduleLater
  selectedTimeTab.value = "scheduleLater";

  emails.value = report.destinations
    .map((destination: { email: string }) => destination.email)
    .join(";");

  if (!report.destinations.length) isCachedReport.value = true;

  // set frequency
  if (report.frequency.type === "cron") {
    frequency.value.type = report.frequency.type;
    frequency.value.cron =
      report.frequency.cron.split(" ").length === 7
        ? report.frequency.cron.split(" ").slice(0, 6).join(" ")
        : report.frequency.cron;
  } else if (report.frequency.interval > 1) {
    frequency.value.type = "custom";
    frequency.value.custom.period = report.frequency.type;
    frequency.value.custom.interval = report.frequency.interval;
  } else {
    frequency.value.type = report.frequency.type;
  }

  if (report.dashboards[0].attachment_dimensions) {
    showCustomDimensions.value = true;
  }

  await setDashboardOptions(report.dashboards[0].folder);

  // Check if folder is present in the options and set the folder
  if (
    folderOptions.value.some(
      (folder) => folder.value === report.dashboards[0].folder,
    )
  ) {
    formData.value.dashboards[0].folder = report.dashboards[0].folder;
  } else {
    formData.value.dashboards[0].folder = "";
    toast({
      variant: "error",
      message: "Selected folder has been deleted!",
    });
  }

  // Check if dashboard is present in the options and set the dashboard
  if (
    dashboardOptions.value.some(
      (dashboard) => dashboard.value === report.dashboards[0].dashboard,
    )
  ) {
    formData.value.dashboards[0].dashboard = report.dashboards[0].dashboard;
  } else {
    formData.value.dashboards[0].dashboard = "";
    toast({
      variant: "error",
      message: "Selected dashboard has been deleted!",
    });
  }

  setDashboardTabOptions(formData.value.dashboards[0].dashboard);

  // Check if tab is present in the options and set the tab
  const tab = dashboardTabOptions.value.filter(
    (tab) => tab.value === report.dashboards[0].tabs[0],
  )[0];

  if (tab) {
    formData.value.dashboards[0].tabs = tab.value;
  } else {
    toast({
      variant: "error",
      message: "Selected dashboard tab has been deleted!",
    });
    formData.value.dashboards[0].tabs = "";
  }
};

const openCancelDialog = () => {
  if (originalReportData.value === JSON.stringify(formData.value)) {
    goToReports();
    track("Button Click", {
      button: "Cancel Report",
      page: "Add Report",
    });
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel report changes?";
  dialog.value.okCallback = goToReports;
};
</script>

