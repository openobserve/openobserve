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
  <OPageLayout
    :title="isEditingReport ? t('reports.update') : t('reports.add')"
    title-data-test="add-report-title"
    :back="{
      label: t('reports.header'),
      onClick: () => router.back(),
      dataTest: 'add-report-back-btn',
    }"
    bleed
  >
    <div data-test="add-report-section" class="w-full flex flex-col flex-1 min-h-0 create-report-page">
      <div
        class="flex bg-card-glass-bg flex-1 min-h-0 overflow-auto"
      >
        <div
          ref="addAlertFormRef"
          class="px-4 my-3"
          style="width: 1024px"
        >
          <OForm
            :id="formId"
            :form="form"
            class="create-report-form"
          >
            <div
              class="flex items-start gap-4 px-2 pt-3"
            >
              <div data-test="add-report-name-input" class="o2-input">
                <OFormInput
                  data-test="add-report-name-input"
                  name="name"
                  :label="t('alerts.name')"
                  required
                  color="input-border"
                  class="showLabelOnTop"
                  :readonly="isEditingReport"
                  :disabled="isEditingReport"
                  :help-text="t('reports.validation.resourceNameInvalid')"
                  tabindex="0"
                  style="width: 20.625rem"
                />
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
              class="report-name-input o2-input px-2 pt-3"
            >
              <OFormInput
                data-test="add-report-description-input"
                name="description"
                :label="t('reports.description')"
                color="input-border"
                class="showLabelOnTop"
                tabindex="0"
                style="width: 600px"
              />
            </div>

            <div class="flex items-center pt-4">
              <OFormSwitch
                data-test="report-cached-toggle-btn"
                name="isCachedReport"
                size="lg"
                :label="t('reports.cachedReport')"
              />
              <OIcon
                name="info-outline"
                class="cursor-pointer ml-2"
                size="sm"
              >
                <OTooltip
                  side="right"
                  align="center"
                >
                  <template #content>{{ t('reports.cachedReportHint') }}</template>
                </OTooltip>
              </OIcon>
            </div>

            <OStepper
              v-model="step"
              orientation="vertical"
              animated
              navigable
              class="mt-3"
            >
              <OStep
                data-test="add-report-select-dashboard-step"
                :name="1"
                :title="t('reports.selectDashboardStep')"
                icon="edit"
                :done="step > 1"
              >
                <!-- Dashboard field-array: one fixed row, iterated so the array
                     structure is preserved and controls bind by their
                     `dashboards[i].*` form name.
                     KEY must be the index (stable): a value-derived key
                     (folder + dashboard) would remount the row on folder/dashboard
                     change, wiping each field's TanStack error meta. -->
                <template
                  v-for="(dashboard, index) in dashboardRows"
                  :key="index"
                >
                  <div
                    :data-test="`add-report-dashboard-${index}`"
                    class="my-2 px-2 flex flex-col"
                  >
                    <!-- items-start (not items-center): keeps all selects
                         top-aligned when a validation error appears under one and
                         grows its cell taller. -->
                    <div class="flex items-start justify-start">
                      <div
                        data-test="add-report-folder-select"
                        class="o2-input mr-2 pt-0"
                        style="width: 30%"
                      >
                        <OFormSelect
                          data-test="add-report-dashboard-folder-select"
                          :name="`dashboards[${index}].folder`"
                          :options="folderOptions"
                          :label="t('reports.dashboardFolder')"
                          required
                          :loading="isFetchingFolders"
                          @update:model-value="
                            (v: any) => onFolderSelection(v, index)
                          "
                          style="min-width: 250px !important; width: 100% !important;"
                        />
                      </div>
                      <div
                        data-test="add-report-dashboard-select"
                        class="o2-input mr-2 pt-0"
                        style="width: 30%"
                      >
                        <OFormSelect
                          data-test="add-report-dashboard-name-select"
                          :name="`dashboards[${index}].dashboard`"
                          :options="dashboardOptions"
                          :label="t('reports.dashboard')"
                          required
                          :loading="isFetchingDashboard || isFetchingFolders"
                          @update:model-value="
                            (v: any) => onDashboardSelection(v, index)
                          "
                          style="min-width: 250px !important; width: 100% !important;"
                        />
                      </div>
                      <div
                        data-test="add-report-tab-select"
                        class="o2-input pt-0"
                        style="width: 30%"
                      >
                        <OFormSelect
                          data-test="add-report-dashboard-tab-select"
                          :name="`dashboards[${index}].tabs`"
                          :options="dashboardTabOptions"
                          :label="t('reports.dashboardTab')"
                          required
                          :loading="isFetchingDashboard || isFetchingFolders"
                          style="min-width: 250px !important; width: 100% !important;"
                        />
                      </div>
                    </div>

                    <div
                      data-test="add-report-timerange-select"
                      class="w-full mt-2"
                    >
                      <OFormDateTimeRange
                        :name="`dashboards[${index}].timerange`"
                        :label="t('reports.timeRange')"
                        required
                        :description="t('reports.timeRangeDescription')"
                        auto-apply
                        data-test="add-report-timerange-dropdown"
                        menu-align="start"
                      />
                    </div>

                    <div
                      data-test="add-report-variable-select"
                      class="w-full mt-3 o2-input"
                    >
                      <VariablesInput name-prefix="variables" />
                    </div>

                    <!-- Report Format -->
                    <div
                      class="w-full mt-3"
                      data-test="add-report-format-section"
                    >
                      <div
                        style="font-size: var(--text-sm)"
                        class="font-bold text-text-secondary mb-2"
                      >
                        {{ t("reports.reportFormat") }}
                      </div>
                      <div class="flex gap-3">
                        <!-- Report Type -->
                        <div
                          class="col-auto o2-input"
                          data-test="add-report-type-select"
                        >
                          <OFormSelect
                            :name="`dashboards[${index}].report_type`"
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
                          <OFormSelect
                            :name="`dashboards[${index}].email_attachment_type`"
                            :options="attachmentTypeOptions(dashboard.report_type)"
                            :label="t('reports.attachmentType')"
                            class="showLabelOnTop"
                            style="min-width: 200px"
                          />
                        </div>
                      </div>

                      <!-- PNG note -->
                      <div
                        v-if="dashboard.report_type === 'png'"
                        class="mt-2"
                        data-test="add-report-png-note"
                      >
                        <OBanner
                          variant="warning"
                          icon="info"
                          :content="t('reports.pngPageLimitNote')"
                        />
                      </div>

                      <!-- Custom Dimensions (Advanced) -->
                      <div
                        v-if="dashboard.report_type !== 'csv'"
                        class="mt-3"
                        data-test="add-report-custom-dimensions-section"
                      >
                        <div
                          class="flex items-center cursor-pointer"
                          style="font-size: var(--text-sm); color: inherit"
                          @click="showCustomDimensions = !showCustomDimensions"
                        >
                          <OIcon
                            :name="
                              showCustomDimensions
                                ? 'expand-less'
                                : 'expand-more'
                            "
                            size="sm"
                            class="mr-1"
                          />
                          <span class="font-bold text-text-secondary">{{
                            t("reports.customDimensions")
                          }}</span>
                        </div>
                        <div
                          v-if="showCustomDimensions"
                          class="flex gap-3 pt-2"
                        >
                          <div class="col-auto o2-input">
                            <OFormInput
                              :name="`dashboards[${index}].attachmentWidth`"
                              type="number"
                              min="1"
                              :label="t('reports.dimensionWidth')"
                              color="input-border"
                              class="showLabelOnTop"
                              style="min-width: 120px"
                              :placeholder="t('reports.widthPlaceholder')"
                              data-test="add-report-dimension-width"
                            />
                          </div>
                          <div class="col-auto o2-input">
                            <OFormInput
                              :name="`dashboards[${index}].attachmentHeight`"
                              type="number"
                              min="1"
                              :label="t('reports.dimensionHeight')"
                              color="input-border"
                              class="showLabelOnTop"
                              style="min-width: 120px"
                              :placeholder="t('reports.heightPlaceholder')"
                              data-test="add-report-dimension-height"
                            />
                          </div>
                          <div class="col-auto flex items-end">
                            <div class="text-xs text-text-muted pb-1">
                              {{ t('reports.dimensionsDefaultHint') }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div class="flex gap-2 mt-4">
                  <OButton
                    data-test="add-report-step1-continue-btn"
                    variant="primary"
                    size="sm-action"
                    @click="
                      goToStep(
                        [
                          'dashboards[0].folder',
                          'dashboards[0].dashboard',
                          'dashboards[0].tabs',
                          'dashboards[0].timerange',
                        ],
                        2,
                      )
                    "
                  >
                    {{ t('reports.continue') }}
                  </OButton>
                </div>
              </OStep>

              <OStep
                data-test="add-report-select-schedule-step"
                :name="2"
                :title="t('reports.scheduleStep')"
                icon="schedule"
                :done="step > 2"
                class="mt-3"
              >
                <div class="my-2 px-2">
                  <div
                    style="font-size: var(--text-sm)"
                    class="font-bold text-text-secondary mb-2"
                  >
                    {{ t('reports.frequency') }}
                  </div>
                  <OFormToggleGroup
                    name="frequencyType"
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
                  </OFormToggleGroup>

                  <template v-if="frequencyType === 'cron'">
                    <!-- items-start: keep the Timezone select aligned with the
                         Cron input when the cron error text wraps below it. -->
                    <div class="flex items-start justify-start mt-3">
                      <div
                        data-test="add-report-schedule-custom-interval-input"
                        class="o2-input mr-2 pt-0"
                        style="width: 320px"
                      >
                        <div class="mb-1 font-bold text-text-secondary">
                          {{ t("reports.cronExpression") + " *" }}
                          <OIcon
                            name="info"
                            size="sm"
                            class="ml-1 cursor-pointer text-text-muted"
                          >
                            <OTooltip side="right" align="center">
                              <template #content>
                                <span style="font-size: var(--text-sm); white-space: pre-line">
                                  {{ t('reports.cronFormatTooltip') }}
                                </span>
                              </template>
                            </OTooltip>
                          </OIcon>
                        </div>
                        <OFormInput
                          name="cron"
                          color="input-border"
                          type="text"
                          outlined
                          class="w-full"
                          :debounce="400"
                        />
                      </div>
                      <div class="o2-input">
                        <OFormSelect
                          data-test="add-report-schedule-start-timezone-select"
                          name="timezone"
                          :options="timezoneOptions"
                          :label="t('logStream.timezone')"
                          required
                          class="timezone-select showLabelOnTop"
                          style="width: 300px"
                        />
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="mt-3 flex justify-start items-center"
                    >
                      <OFormToggleGroup name="selectedTimeTab">
                        <OToggleGroupItem
                          v-for="visual in timeTabs"
                          :key="visual.value"
                          :data-test="`add-report-schedule-${visual.value}-btn`"
                          :value="visual.value"
                          size="sm"
                        >
                          {{ visual.label }}
                        </OToggleGroupItem>
                      </OFormToggleGroup>
                      <OIcon
                        name="info-outline"
                        class="cursor-pointer ml-2"
                        size="sm"
                      >
                        <OTooltip side="right" align="center">
                          <template #content>{{ t('reports.scheduleNowHint') }}<br />
                          {{ t('reports.scheduleLaterHint') }}</template>
                        </OTooltip>
                      </OIcon>
                    </div>

                    <div
                      v-if="frequencyType === 'custom'"
                      class="flex items-start justify-start mt-3"
                    >
                      <div
                        data-test="add-report-schedule-custom-interval-input"
                        class="o2-input mr-2 pt-0"
                        style="width: 160px"
                      >
                        <OFormInput
                          name="customInterval"
                          :label="t('reports.repeatEvery')"
                          required
                          color="input-border"
                          class="showLabelOnTop w-full"
                          type="number"
                        />
                      </div>

                      <div
                        data-test="add-report-schedule-custom-frequency-select"
                        class="o2-input pt-0"
                        style="width: 160px"
                      >
                        <OFormSelect
                          name="customPeriod"
                          :options="customFrequencyOptions"
                          :label="t('reports.frequency')"
                          required
                          class="showLabelOnTop no-case"
                          style="width: 100% !important"
                        />
                      </div>
                    </div>

                    <!-- items-start (not items-center): keeps the Date, Time and
                         Timezone cells top-aligned when a validation error grows
                         one of them taller. -->
                    <div
                      data-test="add-report-schedule-send-later-section"
                      v-if="selectedTimeTab === 'scheduleLater'"
                      class="flex items-start justify-start mt-3"
                    >
                      <div
                        data-test="add-report-schedule-start-date-input"
                        class="o2-input mr-2"
                      >
                        <OFormDate
                          name="date"
                          :label="t('reports.startDate')"
                          required
                          data-test="add-report-schedule-start-date-field"
                        />
                      </div>
                      <div
                        data-test="add-report-schedule-start-time-input"
                        class="o2-input mr-2"
                      >
                        <OFormTime
                          name="time"
                          :label="t('common.startTime')"
                          required
                          data-test="add-report-schedule-start-time-field"
                        />
                      </div>
                      <div class="o2-input">
                        <OFormSelect
                          data-test="add-report-schedule-start-timezone-select"
                          name="timezone"
                          :options="timezoneOptions"
                          :label="t('logStream.timezone')"
                          required
                          class="timezone-select showLabelOnTop"
                          style="width: 300px"
                        />
                      </div>
                    </div>
                  </template>
                </div>
                <div class="flex gap-2 mt-4">
                  <OButton
                    data-test="add-report-step2-back-btn"
                    variant="outline"
                    size="sm-action"
                    @click="step--"
                  >
                    {{ t('common.back') }}
                  </OButton>
                  <OButton
                    data-test="add-report-step2-continue-btn"
                    variant="primary"
                    size="sm-action"
                    @click="
                      goToStep(
                        ['cron', 'customInterval', 'customPeriod', 'timezone', 'date', 'time'],
                        3,
                      )
                    "
                  >
                    {{ t('reports.continue') }}
                  </OButton>
                </div>
              </OStep>

              <OStep
                v-if="!isCachedReportValue"
                data-test="add-report-share-step"
                :name="3"
                :title="t('reports.shareStep')"
                icon="mail"
                :done="step > 3"
                class="mt-3"
              >
                <div class="my-2 px-2">
                  <div
                    data-test="add-report-share-title-input"
                    class="report-name-input o2-input"
                  >
                    <OFormInput
                      data-test="add-report-share-title-input"
                      name="title"
                      :label="t('reports.title')"
                      required
                      tabindex="0"
                      style="width: 400px"
                    />
                  </div>

                  <div
                    data-test="add-report-share-recipients-input"
                    class="report-name-input o2-input pt-3"
                  >
                    <OFormInput
                      data-test="add-report-share-recipients-input"
                      name="emails"
                      :label="t('reports.recipients')"
                      required
                      tabindex="0"
                      class="w-full"
                      :placeholder="t('user.inviteByEmail')"
                    />
                  </div>
                  <div data-test="add-report-share-message-section" class="pt-3">
                    <div style="font-size: var(--text-sm)" class="font-bold text-text-secondary">
                      {{ t('reports.messageLabel') }}
                    </div>

                    <div data-test="add-report-share-message-input">
                      <OFormTextarea name="message" />
                    </div>
                  </div>

                  <!-- Image Preview toggle — only shown when all dashboards are PDF type -->
                  <div
                    v-if="allDashboardsArePdf"
                    class="flex items-center pt-4"
                    data-test="add-report-image-preview-section"
                  >
                    <OFormSwitch
                      name="imagePreview"
                      size="lg"
                      :label="t('reports.imagePreview')"
                      data-test="add-report-image-preview-toggle"
                    />
                    <OIcon
                      name="info-outline"
                      class="cursor-pointer ml-2"
                      size="sm"
                    >
                      <OTooltip max-width="320px">
                        <template #content>{{ t('reports.imagePreviewHint') }}</template>
                      </OTooltip>
                    </OIcon>
                  </div>
                </div>
                <div class="flex gap-2 mt-4">
                  <OButton
                    data-test="add-report-step3-back-btn"
                    variant="outline"
                    size="sm-action"
                    @click="step--"
                  >
                    {{ t('common.back') }}
                  </OButton>
                </div>
              </OStep>
            </OStepper>
          </OForm>
        </div>
      </div>
    </div>
    <div
      class="flex justify-end px-3 w-full py-3 bg-card-glass-bg sticky! bottom-0 border-t border-card-glass-border z-2"
    >
      <OButton
        data-test="add-report-cancel-btn"
        variant="outline"
        size="sm-action"
        class="mr-2"
        :disabled="isSaving"
        @click="openCancelDialog"
      >
        {{ t("alerts.cancel") }}
      </OButton>
      <OButton
        data-test="add-report-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        :form="formId"
        :loading="isSaving"
      >
        {{ t("alerts.save") }}
      </OButton>
    </div>
  </OPageLayout>
  <ConfirmDialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useLocalTimezone } from "@/utils/zincutils";
import VariablesInput from "@/components/alerts/VariablesInput.vue";
import { useStore } from "vuex";
import dashboardService from "@/services/dashboards";
import type { Ref } from "vue";
import { DateTime as _DateTime } from "luxon";
import reports from "@/services/reports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { convertDateToTimestamp } from "@/utils/date";
import { useReo } from "@/services/reodotdev_analytics";
import SelectFolderDropdown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import { getFoldersListByType } from "@/utils/commons";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeCreateReportSchema,
  createReportDefaults,
  type CreateReportForm,
} from "./CreateReport.schema";

const props = defineProps({
  report: {
    type: Object,
    default: null,
  },
});

// Payload skeleton — the non-form server fields (destinations, frequency shape,
// timezone, timestamps, owner/lastEditedBy, ...) that aren't OForm-owned. It is
// the save base in saveReport(): the validated @submit value overwrites the
// form-owned parts on top of it. The dashboard `variables` are form-owned too
// (VariablesInput renders in form mode, name-prefix="variables").
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
const store = useStore();

// This page OWNS the <OForm> and reads form state to drive the OStepper /
// v-if / v-for conditional rendering. State is read reactively with
// `form.useStore(selector)` and written with `form.setFieldValue(...)`. `formId`
// ties the page footer's Save (which lives OUTSIDE the <form>) to the OForm via
// the native `form="<id>"` association so footer-Save + Enter submit.
const formId = "create-report-form";
const createReportSchema = makeCreateReportSchema(t, store.state?.zoConfig);
const form = useOForm<CreateReportForm>({
  defaultValues: createReportDefaults(),
  schema: createReportSchema,
  // saveReport is declared later in setup; the arrow defers the lookup to submit
  // time (after setup completes), so this is safe.
  onSubmit: (value) => saveReport(value),
});

// The form's field-name (DeepKeys) union — used to type helpers that call
// form.validateField/getFieldMeta/setFieldMeta so no per-call cast is needed.
type ReportFieldName = Parameters<typeof form.validateField>[0];

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
  { label: "Cron Job", value: "cron" },
  { label: "Once", value: "once" },
  { label: "Hourly", value: "hours" },
  { label: "Daily", value: "days" },
  { label: "Weekly", value: "weeks" },
  { label: "Monthly", value: "months" },
  { label: "Custom", value: "custom" },
];

// frequencyType, selectedTimeTab and the dashboards rows are form-owned; read
// reactively via form.useStore so the template conditionals (v-if / v-for /
// OStepper) update on every change, including async edit prefill.
const frequencyType = form.useStore(
  (s: any) => s.values?.frequencyType ?? "once",
);
const selectedTimeTab = form.useStore(
  (s: any) => s.values?.selectedTimeTab ?? "scheduleNow",
);
const dashboardRows = form.useStore(
  (s: any): any[] => s.values?.dashboards ?? [],
);

// `variables` are now form-owned (VariablesInput renders in form mode,
// name-prefix="variables"); read from the form value at save.

const filteredTimezone: any = ref([]);

const folderOptions: Ref<{ label: string; value: string }[]> = ref([]);

const dashboardOptions: Ref<
  { label: string; value: string; tabs: any[]; version: number }[]
> = ref([]);

const dashboardTabOptions: Ref<{ label: string; value: string }[]> = ref([]);

const options: Ref<{ [key: string]: any[] }> = ref({});

const isEditingReport = ref(false);

const selectedReportFolderId = ref<string>(
  (router.currentRoute.value.query.folder as string) || "default",
);

const isFetchingReport = ref(false);
const isFetchingFolders = ref(false);
const isFetchingDashboard = ref(false);

// The footer Save shows its spinner from the form's awaited isSubmitting. Read
// reactively via form.useStore (NOT a form.state snapshot, which a computed
// won't track).
const isSaving = form.useStore((s: any) => !!s.isSubmitting);

const isCachedReportValue = form.useStore(
  (s: any) => !!s.values?.isCachedReport,
);

// Build a full form value from the typed defaults, with overrides for the seeded
// values (used to reset the form for query/edit prefill).
const buildFormValues = (
  overrides: Partial<CreateReportForm> = {},
): CreateReportForm => ({
  ...createReportDefaults(),
  ...overrides,
});

// Seed the form's values (create-query / edit prefill). Async-arriving data is
// applied with `form.reset(values)`, not a per-field setFieldValue loop.
const seedForm = async (values: CreateReportForm) => {
  await nextTick();
  form.reset(values);
};

// A snapshot used to detect unsaved changes on Cancel — the form-owned values
// (covers every field incl. the dashboards row) + the component-owned variables.
const snapshot = () =>
  JSON.stringify({
    // `variables` are now form-owned, so form.state.values already covers them.
    values: form.state.values ?? {},
  });

onBeforeMount(async () => {
  await getFoldersListByType(store, "reports");
  await getDashboaordFolders();

  const query = router.currentRoute.value.query;
  isEditingReport.value = !!(query?.report_id || query?.name);

  if (!isEditingReport.value) {
    await setInitialReportData();
    originalReportData.value = snapshot();
  } else {
    isFetchingReport.value = true;

    const reportId = query?.report_id as string | undefined;
    const reportName = (query?.name || "") as string;
    const org = store.state.selectedOrganization.identifier;

    const fetchPromise = reportId
      ? reports.getReportById(org, reportId)
      : reports.getReport(org, reportName);

    fetchPromise
      .then(async (res: any) => {
        await setupEditingReport(res.data);
        originalReportData.value = snapshot();
      })
      .catch((err) => {
        // Optional chaining throughout: this catch also receives non-HTTP
        // rejections (a TypeError from malformed data, or the literal `true`
        // setDashboardOptions rejects with), so `err.response` may be undefined.
        if (err?.response?.status != 403) {
          toast({
            variant: "error",
            message:
              err?.response?.data?.message || "Error while fetching report!",
          });
        }
      })
      .finally(() => {
        isFetchingReport.value = false;
      });
  }
});

// ── OStepper error jump ──────────────────────────────────────────────────────
// On each Save, reveal step errors + jump to the first erroring step
// (re-expresses the old validateReportData step jumps; errors surface on first
// submit per R3). The folder → dashboard → tabs cascade is wired to USER changes
// via the OFormSelect @update handlers (onFolderSelection/onDashboardSelection),
// which do NOT fire on programmatic reset/prefill.

// Map the schema's failing paths back to their OStepper step and jump to the
// first one (errors are revealed on first submit per R3).
const jumpToFirstErrorStep = () => {
  const res = createReportSchema.safeParse(form.state.values);
  if (res.success) return;
  const top = new Set(res.error.issues.map((i) => String(i.path[0])));
  // dashboards[0].* errors all surface under the top-level "dashboards" path.
  const step1 = ["name", "dashboards"];
  const step2 = [
    "cron",
    "timezone",
    "customInterval",
    "customPeriod",
    "date",
    "time",
  ];
  const step3 = ["title", "emails"];
  if (step1.some((k) => top.has(k))) {
    step.value = 1;
  } else if (step2.some((k) => top.has(k))) {
    step.value = 2;
  } else if (step3.some((k) => top.has(k))) {
    step.value = 3;
  }
};

// Each Save bumps TanStack's submissionAttempts; read it reactively (no
// store.subscribe mirror) and jump to the first erroring step on each attempt.
const submissionAttempts = form.useStore((s: any) => s.submissionAttempts ?? 0);
watch(submissionAttempts, (n, o) => {
  if (n > o) jumpToFirstErrorStep();
});

// ── Per-step "Continue" validation ───────────────────────────────────────────
// Continue used to blindly advance the OStepper; a user could walk past a blank
// required field and only discover it at Save. This runs the SAME schema-driven
// validation the footer Save uses (mirrors OForm.validate(): validate each field,
// then read its meta.errors), and gates the advance ONLY on the fields listed at
// the call site (the step's own fields — see the template's Continue buttons).
// `name`/`description` (top of form) stay handled by Save.
//
// The field lists are static supersets per step; no mode branching is needed
// because the schema is already mode-aware — validating step 2's cron/custom/
// scheduleLater fields only produces errors for whichever mode is active, so the
// irrelevant ones simply pass (e.g. "Once + Schedule Now" requires none of them
// and advances freely). Same static-list approach as EditScript's stepper.
//
// We deliberately do NOT clear other fields' error meta here. The schema is
// form-level, so form.validateField() runs the whole Zod schema and records every
// field's error — but that write is additive, so Save's cross-step errors stay
// put (clearing them made a later Continue wipe the errors Save had just surfaced
// on other steps). We simply don't READ the out-of-step fields when deciding
// whether to advance.
const validateStepFields = async (
  fields: ReportFieldName[],
): Promise<boolean> => {
  let valid = true;
  for (const name of fields) {
    await form.validateField(name, "submit");
    const errors = form.getFieldMeta(name)?.errors ?? [];
    if (errors.length > 0) valid = false;
  }
  return valid;
};

// Validate the given fields; only advance to `next` when they all pass.
const goToStep = async (fields: ReportFieldName[], next: number) => {
  if (await validateStepFields(fields)) step.value = next;
};

// Map a Zod issue path to its OForm field name so we can match issues to the
// field that owns them: ["dashboards", 0, "folder"] → "dashboards[0].folder",
// ["cron"] → "cron".
const issuePathToName = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (acc, seg) =>
      typeof seg === "number"
        ? `${acc}[${seg}]`
        : acc
          ? `${acc}.${String(seg)}`
          : String(seg),
    "",
  );

// Clear a field's error the instant its value becomes valid — scoped to that one
// field, never touching the others. Needed because Continue validates with
// validateField("submit"), which does NOT flip the form into revalidate-on-change
// mode, so OForm* editing would otherwise leave a stale error until the next Save
// (e.g. a corrected cron kept showing its error). This ONLY clears — it never
// adds errors — so editing one field can't surface validation on another (no
// bleed to `name` or later-step fields).
const formValuesRef = form.useStore((s: any) => s.values);
watch(
  formValuesRef,
  () => {
    const res = createReportSchema.safeParse(form.state.values);
    const invalidNames = new Set(
      res.success ? [] : res.error.issues.map((i) => issuePathToName(i.path)),
    );
    for (const name of Object.keys(
      form.state.fieldMeta ?? {},
    ) as ReportFieldName[]) {
      const meta = form.getFieldMeta(name);
      if (!meta) continue;
      const hasError = (meta.errors?.length ?? 0) > 0;
      if (hasError && !invalidNames.has(name)) {
        form.setFieldMeta(name, { ...meta, errorMap: {} });
      }
    }

    // Also reconcile the FORM-LEVEL error map, not just per-field metas. A
    // Continue click validates via validateField("submit"); because the schema is
    // form-level, that runs the WHOLE Zod schema and records EVERY failing path —
    // including out-of-step fields like title/emails — into the form's own
    // errorMap.onDynamic. When the form later becomes fully valid (e.g. enabling
    // "Cached Report" drops the title/emails requirement), clearing the field
    // metas above is not enough: handleSubmit() re-validates fields but never
    // re-runs or clears this form-level result, so isFormValid (and thus
    // canSubmit) stays false and Save is silently blocked. Clear it here once the
    // whole schema passes — like the loop above, this ONLY clears, so it can never
    // reveal an error early.
    if (res.success) {
      const em: any = form.state.errorMap ?? {};
      if (em.onDynamic != null || em.onDynamicAsync != null) {
        form.setErrorMap({
          ...em,
          onDynamic: undefined,
          onDynamicAsync: undefined,
        });
      }
    }
  },
  { deep: true },
);

const setInitialReportData = async () => {
  const queryParams = router.currentRoute.value.query;

  const cached = queryParams.type === "cached";

  // ?folderId= is the DASHBOARD folder (passed from a dashboard context, e.g.
  // ScheduledDashboards). ?folder= is the REPORTS folder (from ReportList) and is
  // handled separately via selectedReportFolderId — it must NOT be used to
  // pre-select the dashboard folder, otherwise the dashboard folder dropdown shows
  // the raw reports-folder id instead of a dashboard folder name.
  const dashboardFolderId = queryParams.folderId as string | undefined;
  const dashboardId = queryParams.dashboardId as string | undefined;
  const tabId = queryParams.tabId as string | undefined;

  // Load the options the query-seeded selections need (no cascade @update fires
  // for programmatic seeding, so load them here).
  if (dashboardFolderId) await setDashboardOptions(dashboardFolderId);
  if (dashboardFolderId && dashboardId) setDashboardTabOptions(dashboardId);

  const row = {
    ...createReportDefaults().dashboards[0],
    folder: dashboardFolderId ?? "",
    dashboard: dashboardFolderId && dashboardId ? dashboardId : "",
    tabs: dashboardId && tabId ? tabId : "",
  };

  await seedForm(buildFormValues({ isCachedReport: cached, dashboards: [row] }));
};

// Cascade: USER picks a folder → clear that row's dependent dashboard/tabs + load
// the dashboard options. Wired via the folder OFormSelect's @update (fires on
// selection only, not on programmatic reset/prefill). `index` defaults to 0 (the
// single row) so direct/test calls work with just the folder id.
const onFolderSelection = async (id: string, index = 0) => {
  form.setFieldValue(`dashboards[${index}].dashboard`, "");
  form.setFieldValue(`dashboards[${index}].tabs`, "");

  try {
    if (id) await setDashboardOptions(id);
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

// Cascade: USER picks a dashboard → clear that row's tabs + set the tab options.
// Wired via the dashboard OFormSelect's @update (selection only).
const onDashboardSelection = (dashboardId: any, index = 0) => {
  form.setFieldValue(`dashboards[${index}].tabs`, "");
  if (dashboardId) setDashboardTabOptions(dashboardId);
};

const setDashboardTabOptions = (dashboardId: any) => {
  const defaultTabs = [{ label: "Default", value: "default" }];

  const match = dashboardOptions.value.find(
    (dashboard) => dashboard.value === dashboardId,
  );
  dashboardTabOptions.value = match?.tabs || defaultTabs;

  options.value["tabs"] = [...dashboardTabOptions.value];
};

const showCustomDimensions = ref(false);

// True when EVERY dashboard row's report type is PDF — show/hide the imagePreview
// toggle (preview only applies to PDF). Reads the form-owned rows via the mirror.
const allDashboardsArePdf = computed(
  () =>
    dashboardRows.value.length > 0 &&
    dashboardRows.value.every((d: any) => d.report_type === "pdf"),
);

// Returns the available attachment type options for a given report type.
// Inline is disabled for PDF since the report server does not support it.
const attachmentTypeOptions = (rType: string | undefined) => [
  { label: "Standard — downloadable attachment (default)", value: "standard" },
  {
    label: "Inline — embedded in email body",
    value: "inline",
    disable: rType === "pdf",
  },
];

const customFrequencyOptions = [
  { label: "days", value: "days" },
  { label: "hours", value: "hours" },
  { label: "weeks", value: "weeks" },
  { label: "months", value: "months" },
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

// @submit handler — OForm calls this only once the whole schema passes (incl. the
// conditional superRefine rules), so the schema (not a manual validate) gates the
// save. `value` is the validated, form-owned payload (name/title/frequency/
// schedule/timerange/...); the bare/bridged dashboard folder/dashboard/tabs come
// from component state. Returns the service promise so OForm's awaited
// isSubmitting drives the footer Save spinner.
const saveReport = async (value: CreateReportForm) => {
  const reportPayload = JSON.parse(JSON.stringify(formData.value));

  // Form-owned scalars are the source of truth at submit time.
  reportPayload.name = value.name;
  reportPayload.description = value.description;
  reportPayload.title = value.title;
  reportPayload.message = value.message;
  reportPayload.imagePreview = value.imagePreview;

  // Build the (single) dashboard row fresh from the form-owned values + the
  // component-owned variables; derive attachment_dimensions from width/height.
  const row = value.dashboards[0];
  const width = Number(row.attachmentWidth) || 0;
  const height = Number(row.attachmentHeight) || 0;
  const dashboardPayload: any = {
    folder: row.folder,
    dashboard: row.dashboard,
    tabs: [row.tabs],
    variables: value.variables ?? [],
    timerange: row.timerange,
    report_type: row.report_type,
    email_attachment_type: row.email_attachment_type,
  };
  // Persist attachment_dimensions only when set (else the server uses defaults).
  if (width || height) {
    dashboardPayload.attachment_dimensions = { width, height };
  }
  reportPayload.dashboards = [dashboardPayload];

  // Resolve scheduling date/time/timezone from the payload, overriding for the
  // "schedule now" / cron modes (set to "now" + the browser timezone).
  let scheduleDate = value.date;
  let scheduleTime = value.time;
  let scheduleTimezone = value.timezone;

  if (
    value.selectedTimeTab === "scheduleNow" ||
    value.frequencyType === "cron"
  ) {
    const now = new Date();

    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0"); // January is 0!
    const year = now.getFullYear();
    // YYYY-MM-DD (ISO 8601, for ODate compatibility)
    scheduleDate = `${year}-${month}-${day}`;

    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    // HH:MM
    scheduleTime = `${hours}:${minutes}`;
  }

  // Auto-fill the browser timezone only for a non-cron "Schedule Now": that mode
  // hides the timezone field. Cron mode shows a required timezone select, so we
  // honor the user's pick (value.timezone) — needed for the cron schedule to run
  // in the chosen timezone rather than silently reverting to the browser's.
  if (value.selectedTimeTab === "scheduleNow" && value.frequencyType !== "cron") {
    scheduleTimezone = timezone.value;
  }

  // scheduleDate is always YYYY-MM-DD (ISO 8601),
  // but convertDateToTimestamp expects DD-MM-YYYY
  const [y, m, d] = scheduleDate.split("-");
  const dateForConversion = `${d}-${m}-${y}`;

  const convertedDateTime = convertDateToTimestamp(
    dateForConversion,
    scheduleTime,
    scheduleTimezone,
  );

  reportPayload.start = convertedDateTime.timestamp;
  reportPayload.timezoneOffset = convertedDateTime.offset;
  reportPayload.orgId = store.state.selectedOrganization.identifier;
  reportPayload.destinations = value.emails.split(/[,;]/).map((email) => ({
    email: email.trim(),
  }));

  if (value.frequencyType === "custom") {
    reportPayload.frequency.type = value.customPeriod;
    reportPayload.frequency.interval = Number(value.customInterval);
  } else if (value.frequencyType === "cron") {
    reportPayload.frequency.type = "cron";
    reportPayload.frequency.cron = String(value.cron).trim() + " *";
  } else {
    reportPayload.frequency.type = value.frequencyType;
    reportPayload.frequency.interval = 1;
  }

  reportPayload.timezone = scheduleTimezone;

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

  if (value.isCachedReport) reportPayload.destinations = [];

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

  track("Button Click", {
    button: "Save Report",
    page: "Add Report",
  });

  return savePromise
    .then(() => {
      // Invalidate the folder cache so ReportList fetches fresh data on mount
      const fId = selectedReportFolderId.value || "default";
      const updated = {
        ...store.state.organizationData.allReportsListByFolderId,
      };
      delete updated[fId];
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
      if (error.response?.status != 403) {
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
  // Keep the report skeleton (destinations / frequency / timezone / timestamps /
  // ...) as the save base; the dashboards row + form-owned scalars are seeded
  // into the form below.
  formData.value = { ...report };

  // set date, time and timezone for the form (scheduleLater).
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

  // YYYY-MM-DD (ISO 8601, for ODate compatibility)
  const scheduleDate = dateInReportTz.toFormat("yyyy-MM-dd");
  // HH:MM
  const scheduleTime = dateInReportTz.toFormat("HH:mm");
  const scheduleTimezone = report.timezone;

  // edit reports always open on the "Schedule Later" tab (form-owned now).
  const timeTab = "scheduleLater";

  const emailsStr = report.destinations
    .map((destination: { email: string }) => destination.email)
    .join(";");

  const isCached = !report.destinations.length;

  // set frequency (form-owned — resolved into locals, seeded via buildFormValues)
  let cronStr = "";
  let custInterval: number = 1;
  let custPeriod = "days";
  let freqType = "once";
  if (report.frequency.type === "cron") {
    freqType = "cron";
    cronStr =
      report.frequency.cron.split(" ").length === 7
        ? report.frequency.cron.split(" ").slice(0, 6).join(" ")
        : report.frequency.cron;
  } else if (report.frequency.interval > 1) {
    freqType = "custom";
    custPeriod = report.frequency.type;
    custInterval = report.frequency.interval;
  } else {
    freqType = report.frequency.type;
  }

  const dims = report.dashboards[0].attachment_dimensions;
  if (dims) {
    showCustomDimensions.value = true;
  }

  await setDashboardOptions(report.dashboards[0].folder);

  // Resolve folder/dashboard/tab against the loaded options (drop + warn if the
  // saved selection has since been deleted).
  let folder = "";
  if (
    folderOptions.value.some((f) => f.value === report.dashboards[0].folder)
  ) {
    folder = report.dashboards[0].folder;
  } else {
    toast({ variant: "error", message: "Selected folder has been deleted!" });
  }

  let dashboard = "";
  if (
    dashboardOptions.value.some(
      (d) => d.value === report.dashboards[0].dashboard,
    )
  ) {
    dashboard = report.dashboards[0].dashboard;
  } else {
    toast({ variant: "error", message: "Selected dashboard has been deleted!" });
  }

  setDashboardTabOptions(dashboard);

  let tabs = "";
  const tab = dashboardTabOptions.value.find(
    (t) => t.value === report.dashboards[0].tabs[0],
  );
  if (tab) {
    tabs = tab.value;
  } else {
    toast({
      variant: "error",
      message: "Selected dashboard tab has been deleted!",
    });
  }

  const row = {
    folder,
    dashboard,
    tabs,
    report_type: report.dashboards[0].report_type ?? "pdf",
    email_attachment_type:
      report.dashboards[0].email_attachment_type ?? "standard",
    attachmentWidth: dims?.width ?? undefined,
    attachmentHeight: dims?.height ?? undefined,
    timerange:
      report.dashboards[0].timerange ??
      createReportDefaults().dashboards[0].timerange,
  };

  // Seed every form-owned value from the resolved record (async-arrived data).
  await seedForm(
    buildFormValues({
      name: report.name ?? "",
      description: report.description ?? "",
      isCachedReport: isCached,
      imagePreview: report.imagePreview ?? false,
      title: report.title ?? "",
      message: report.message ?? "",
      emails: emailsStr,
      cron: cronStr,
      customInterval: custInterval,
      customPeriod: custPeriod,
      timezone: scheduleTimezone,
      date: scheduleDate,
      time: scheduleTime,
      frequencyType: freqType,
      selectedTimeTab: timeTab,
      dashboards: [row],
      // `variables` are form-owned now; seed them from the record (drop the
      // frontend-only `id` — the schema row is {key, value}).
      variables: (report.dashboards?.[0]?.variables ?? []).map((v: any) => ({
        key: v.key ?? "",
        value: v.value ?? "",
      })),
    }),
  );
};

const openCancelDialog = () => {
  if (originalReportData.value === snapshot()) {
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
