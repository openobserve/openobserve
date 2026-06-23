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
  <div data-test="add-action-script-section">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] tw:pt-1">
      <div class="card-container">
        <div
          class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:pl-4 tw:pr-2 tw:h-[68px]"
        >
          <div
            data-test="add-action-script-back-btn"
            class="tw:flex tw:justify-center tw:items-center tw:mr-3 tw:cursor-pointer"
            title="Go Back"
            @click="router.back()"
          >
            <OIcon name="arrow-back-ios-new" size="xs" />
            <div
              v-if="isEditingActionScript"
              class="tw:text-xl tw:font-semibold tw:pl-2"
              data-test="add-action-script-title"
            >
              {{ t("actions.update") }}
            </div>
            <div
              v-else
              class="tw:text-xl tw:font-semibold tw:pl-2"
              data-test="add-action-script-title"
            >
              {{ t("actions.add") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <div
        class="card-container tw:overflow-auto"
        style="max-height: calc(100vh - var(--navbar-height) - 157px)"
      >
        <div
          ref="addAlertFormRef"
          class="tw:px-4 tw:pb-3"
          style="width: 1024px"
        >
          <div
            class="create-report-form"
          >
            <div
              data-test="add-action-script-name-input-wrapper"
              class="report-name-input"
              style="padding-top: 12px"
            >
              <OInput
                data-test="add-action-script-name-input"
                v-model.trim="formData.name"
                :label="t('alerts.name') + ' *'"
                class="showLabelOnTop"
                :error="!!nameError"
                :error-message="nameError"
                tabindex="0"
                style="width: 400px"
                @update:model-value="(v: string) => {
                  if (!v) { nameError = t('common.nameRequired'); }
                  else if (!isValidResourceName(v)) { nameError = 'Characters like :, ?, /, #, and spaces are not allowed.'; }
                  else { nameError = ''; }
                }"
              >
                <template #hint>
                  Characters like :, ?, /, #, and spaces are not allowed.
                </template>
              </OInput>
            </div>
            <div data-test="add-action-script-description-input" class="report-name-input tw:pb-2">
              <OInput
                v-model="formData.description"
                :label="t('reports.description')"
                class="showLabelOnTop"
                tabindex="0"
                style="width: 800px"
              />
            </div>

            <div data-test="add-action-script-type" class="report-name-input tw:mb-3">
              <OSelect
                data-test="add-action-script-type-select"
                v-model="formData.type"
                :label="t('common.type') + ' *'"
                :options="actionTypes"
                labelKey="label"
                valueKey="value"
                class="showLabelOnTop no-case tw:w-[400px]"
                :error="!!typeError"
                :error-message="typeError"
                :disabled="isEditingActionScript"
                @update:model-value="(v: any) => { typeError = v ? '' : 'Field is required!'; }"
              />
            </div>

            <OStepper
              v-model="step"
              orientation="vertical"
              animated
              navigable
              class="tw:mb-3"
            >
              <OStep
                data-test="add-action-script-step-1"
                :name="1"
                :title="t('actions.uploadCodeZip')"
                icon="edit"
                :done="step > 1"
              >
                <div
                  data-test="add-action-script-file-input"
                  class="tw:flex tw:items-center"
                >
                  <OFile
                    v-if="
                      !isEditingActionScript || formData.fileNameToShow == ''
                    "
                    ref="fileInput"
                    v-model="formData.codeZip"
                    :label="t('actions.zipFile') + ' *'"
                    accept=".zip"
                    data-test="add-action-script-file-input"
                    :error-message="!isEditingActionScript && !formData.codeZip ? 'ZIP File is required!' : undefined"
                    :error="!isEditingActionScript && !formData.codeZip && step > 1"
                  >
                    <template #hint>
                      Note: Only .zip files are accepted and it may contain
                      various resources such as .py, .txt and main.py file etc.
                    </template>
                  </OFile>

                  <div
                    v-else-if="
                      isEditingActionScript && formData.fileNameToShow != ''
                    "
                  >
                    {{ formData.fileNameToShow }}
                    <OButton
                      data-test="add-action-script-edit-file-btn"
                      variant="ghost"
                      size="icon-sm"
                      @click="editFileToUpload"
                      ><OIcon name="edit" size="sm"
                    /></OButton>
                  </div>
                  <div
                    v-if="
                      isEditingActionScript && formData.fileNameToShow == ''
                    "
                    class="tw:pt-3 tw:mt-1 tw:pl-3"
                  >
                    <OButton
                      data-test="cancel-upload-new-btn-file"
                      variant="outline-destructive"
                      size="sm-action"
                      @click="cancelUploadingNewFile"
                      >Cancel</OButton
                    >
                  </div>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-8">
                  <OButton
                    data-test="add-action-script-step1-continue-btn"
                    variant="primary"
                    size="sm"
                    @click="step++"
                    >Continue</OButton
                  >
                </div>
              </OStep>

              <OStep
                v-if="formData.type === 'scheduled'"
                data-test="add-action-script-step-2"
                :name="2"
                title="Schedule"
                icon="schedule"
                :done="step > 2"
                class="tw:mt-3"
              >
                <div class="tw:my-2 tw:px-2">
                  <div
                    style="font-size: 14px"
                    class="tw:font-bold tw:text-gray-500 tw:mb-2"
                    data-test="add-action-script-frequency-title"
                  >
                    {{ t("actions.frequency") }} *
                  </div>
                  <div class="tw:p-1 el-border-radius el-border tw:w-fit">
                    <template
                      v-for="visual in frequencyTabs"
                      :key="visual.value"
                    >
                      <OButton
                        :data-test="`add-action-script-schedule-frequency-${visual.value}-btn`"
                        variant="ghost"
                        :active="visual.value === frequency.type"
                        size="xs"
                        :disabled="isEditingActionScript"
                        @click="frequency.type = visual.value"
                        >{{ visual.label }}</OButton
                      >
                    </template>
                  </div>

                  <div
                    v-if="frequency.type === 'once'"
                    class="tw:flex tw:justify-start tw:items-center tw:mt-3"
                    data-test="add-action-script-frequency-info"
                  >
                    <OIcon name="event" size="sm" class="tw:mr-2" />
                    <div style="font-size: 14px">
                      The script will be triggered immediately after it is saved
                    </div>
                  </div>

                  <template v-if="frequency.type === 'repeat'">
                    <div class="tw:flex">
                      <div
                        data-test="add-action-script-cron-input"
                        class="tw:mr-2"
                        style="padding-top: 8px; width: 320px"
                      >
                        <div
                          class="tw:mb-1 tw:font-bold tw:text-gray-500"
                          data-test="add-action-script-cron-expression-title"
                        >
                          {{ t("reports.cronExpression") + " *" }}
                          <OIcon
                            data-test="add-action-script-cron-info"
                            name="info"
                            size="sm"
                            class="tw:ml-1 tw:cursor-pointer tw:text-gray-400"
                          >
                            <OTooltip side="right" align="center">
                              <template #content>
                                <span style="font-size: 14px">
                                  Pattern: * * * * * means every minute .
                                  <br />
                                  Format: [Minute 0-59] [Hour 0-23] [Day of Month
                                  1-31, 'L'] [Month 1-12] [Day of Week 0-7 or
                                  '1L-7L', 0 and 7 for Sunday].
                                  <br />
                                  Use '*' to represent any value, 'L' for the last
                                  day/weekday. <br />
                                  Example: 0 12 * * ? - Triggers at 12:00 PM
                                  daily. It specifies minute, hour, day of month,
                                  month, and day of week, respectively.
                                </span>
                              </template>
                            </OTooltip>
                          </OIcon>
                        </div>

                        <OInput
                          v-model="frequency.cron"
                          class="showLabelOnTop"
                          type="text"
                          :error="!!cronFieldError"
                          :error-message="cronFieldError"
                          debounce="300"
                          style="width: 100%"
                          @update:model-value="(v: string) => {
                            cronFieldError = !v?.length ? 'Field is required!' : (cronError.length ? cronError : '');
                            validateFrequency(frequency.cron);
                          }"
                          :disabled="isEditingActionScript"
                          :readonly="isEditingActionScript"
                        />
                      </div>
                      <div class="tw:flex tw:pt-2.75">
                        <OSelect
                          data-test="add-action-script-timezone-select"
                          v-model="formData.timezone"
                          :options="['UTC']"
                          :label="t('actions.timezone') + ' *'"
                          :loading="isFetchingServiceAccounts"
                          class="showLabelOnTop no-case tw:mb-[2.4rem]"
                          disabled
                          style="min-width: 250px !important; width: 250px !important;"
                        />
                      </div>
                    </div>
                  </template>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-action-script-step2-back-btn"
                    variant="outline"
                    size="sm"
                    @click="step--"
                    >Back</OButton
                  >
                  <OButton
                    data-test="add-action-script-step2-continue-btn"
                    variant="primary"
                    size="sm"
                    @click="step++"
                    >Continue</OButton
                  >
                </div>
              </OStep>

              <OStep
                data-test="add-action-script-step-3"
                :name="3"
                title="Select Service Account"
                icon="dashboard"
                :done="step > 3"
                class="tw:mt-3"
              >
                <div class="tw:flex tw:items-center">
                  <div class="service-account-selector">
                    <div
                      data-test="add-action-script-service-account-title"
                      class="tw:mb-1 tw:font-bold tw:text-gray-500"
                    >
                      {{ t("actions.serviceAccount") + " *" }}
                      <OIcon
                        name="info"
                        size="sm"
                        class="tw:ml-1 tw:cursor-pointer tw:text-gray-400"
                      >
                        <OTooltip side="right" align="center">
                          <template #content>
                            <span style="font-size: 14px">
                              Make sure service account has permissions to access
                              Actions.
                            </span>
                          </template>
                        </OTooltip>
                      </OIcon>
                    </div>
                    <OSelect
                      data-test="add-action-script-service-account-select"
                      v-model="formData.service_account"
                      :options="filteredServiceAccounts"
                      :loading="isFetchingServiceAccounts"
                      class="tw:py-2 no-case"
                      labelKey="label"
                      valueKey="value"
                      :error="!!serviceAccountError"
                      :error-message="serviceAccountError"
                      @update:model-value="(v: any) => { serviceAccountError = v ? '' : 'Field is required!'; }"
                      @search="(val: string) => {
                        filteredServiceAccounts.value = val
                          ? serviceAccountsOptions.filter((s: any) => s.label.toLowerCase().includes(val.toLowerCase()))
                          : [...serviceAccountsOptions];
                      }"
                      style="min-width: 250px !important; width: 250px !important;"
                    />
                  </div>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-action-script-step3-back-btn"
                    variant="outline"
                    size="sm"
                    @click="step === 3 ? (step = formData.type === 'scheduled' ? 2 : 1) : step--"
                    >Back</OButton
                  >
                  <OButton
                    data-test="add-action-script-step3-continue-btn"
                    variant="primary"
                    size="sm"
                    @click="step++"
                    >Continue</OButton
                  >
                </div>
              </OStep>
              <OStep
                data-test="add-action-script-step-4"
                :name="4"
                title="Environmental Variables"
                icon="lock"
                :done="step > 4"
                class="tw:mt-3"
              >
                <div
                  v-for="(header, index) in environmentalVariables"
                  :key="header.uuid"
                  class="tw:flex tw:gap-2"
                  data-test="add-action-script-env-variable"
                >
                  <div class="tw:w-5/12 tw:ml-0">
                    <OInput
                      :data-test="`add-action-script-header-${header['key']}-key-input`"
                      v-model="header.key"
                      :placeholder="'Key'"
                      tabindex="0"
                    />
                  </div>
                  <div class="tw:w-5/12 tw:ml-0 tw:mb-2">
                    <OInput
                      :data-test="`add-action-script-header-${header['key']}-value-input`"
                      v-model="header.value"
                      :placeholder="t('alert_destinations.api_header_value')"
                      tabindex="0"
                    />
                  </div>
                  <div class="tw:w-1/6 tw:ml-0">
                    <OButton
                      :data-test="`add-action-script-header-${header['key']}-delete-btn`"
                      variant="ghost"
                      size="icon-circle-sm"
                      :title="t('alert_templates.delete')"
                      @click="deleteApiHeader(header)"
                      ><OIcon name="delete" size="sm"
                    /></OButton>
                    <OButton
                      data-test="add-action-script-add-header-btn"
                      v-if="index === environmentalVariables.length - 1"
                      variant="ghost"
                      size="icon-circle-sm"
                      :title="t('alert_templates.edit')"
                      @click="addApiHeader()"
                      ><OIcon name="add" size="sm"
                    /></OButton>
                  </div>
                </div>
                <div class="tw:flex tw:gap-2 tw:mt-4">
                  <OButton
                    data-test="add-action-script-step4-back-btn"
                    variant="outline"
                    size="sm"
                    @click="step--"
                    >Back</OButton
                  >
                </div>
              </OStep>
            </OStepper>

          </div>
        </div>
      </div>
    </div>
    <div class="tw:mx-2">
      <div
        class="tw:flex tw:justify-end tw:gap-2 tw:px-3 tw:w-full tw:py-[0.625rem] card-container"
        style="position: sticky; bottom: 0px; z-index: 2"
      >
        <OButton
          data-test="add-action-script-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="openCancelDialog"
          >{{ t("alerts.cancel") }}</OButton
        >
        <OButton
          data-test="add-action-script-save-btn"
          variant="primary"
          size="sm-action"
          @click="saveActionScript"
          >{{ t("alerts.save") }}</OButton
        >
      </div>
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
import { ref, nextTick, onMounted, watch } from "vue";
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
import actions from "@/services/action_scripts";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CronExpressionParser from "cron-parser";
import { convertDateToTimestamp } from "@/utils/date";
import service_accounts from "@/services/service_accounts";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

defineProps({
  report: {
    type: Object,
    default: null,
  },
});
const emit = defineEmits(["getActionScripts"]);

const defaultActionScript = {
  codeZip: null,
  description: "",
  enabled: true,
  name: "",
  orgId: "",
  start: 0,
  frequency: {
    interval: 1,
    type: "repeat",
    cron: "",
  },
  environment_variables: {},
  execution_details: "",
  timezone: "UTC",
  timezoneOffset: 0,
  lastTriggeredAt: null,
  createdAt: "",
  updatedAt: "",
  owner: "",
  lastEditedBy: "",
  fileNameToShow: "",
  id: "",
  service_account: "",
  type: "scheduled",
};

const { t } = useI18n();
const router = useRouter();

const fileInput = ref(null);

const originalActionScriptData: Ref<string> = ref("");

const step = ref(1);

const formData = ref(defaultActionScript);


const actionTypes = [
  {
    label: "Scheduled",
    value: "scheduled",
  },
  {
    label: "Real Time",
    value: "service",
  },
];

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
    value: "repeat",
  },
  {
    label: "Once",
    value: "once",
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

const isEditingActionScript = ref(false);

const isFetchingActionScript = ref(false);

const environmentalVariables = ref([{ key: "", value: "", uuid: getUUID() }]);
const cronError = ref("");
const nameError = ref("");
const typeError = ref("");
const cronFieldError = ref("");
const serviceAccountError = ref("");

const frequency = ref({
  type: "once",
  custom: {
    interval: 1,
    period: "days",
  },
  cron: "",
});

watch(
  () => router.currentRoute.value.query?.id,
  async (action_id) => {
    await handleActionScript();
  },
);

onBeforeMount(async () => {
  await handleActionScript();
});

const scheduling = ref({
  date: "",
  time: "",
  timezone: "",
});

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

const saveActionScript = async () => {
  // If frequency is cron, then we set the start timestamp as current time and timezone as browser timezone
  // if (frequency.value.type === "Repeat") {
  //   const now = new Date();

  //   // Get the day, month, and year from the date object
  //   const day = String(now.getDate()).padStart(2, "0");
  //   const month = String(now.getMonth() + 1).padStart(2, "0"); // January is 0!
  //   const year = now.getFullYear();

  //   // Combine them in the DD-MM-YYYY format
  //   scheduling.value.date = `${day}-${month}-${year}`;

  //   // Get the hours and minutes, ensuring they are formatted with two digits
  //   const hours = String(now.getHours()).padStart(2, "0");
  //   const minutes = String(now.getMinutes()).padStart(2, "0");

  //   // Combine them in the HH:MM format
  //   scheduling.value.time = `${hours}:${minutes}`;
  // }

  // // If the user has selected to schedule now, we set the timezone to the current timezone
  // if (formData.value.execution_details === "Once") {
  //   scheduling.value.timezone = timezone.value;
  // }
  let form;

  // Determine if FormData is needed
  const useFormData =
    !isEditingActionScript.value ||
    (isEditingActionScript.value && formData.value.codeZip);
  // Initialize form as FormData or plain object
  form = useFormData ? new FormData() : {};

  // Common fields
  const commonFields: Record<string, any> = {
    name: formData.value.name,
    description: formData.value.description,
    execution_details:
      formData.value.type === "scheduled"
        ? frequency.value.type
        : formData.value.type,
    service_account: formData.value.service_account,
  };
  // const convertedDateTime = convertDateToTimestamp(
  //   scheduling.value.date,
  //   scheduling.value.time,
  //   scheduling.value.timezone,
  // );

  // Add cron expression if needed
  if (
    formData.value.type === "scheduled" &&
    frequency.value.type === "repeat"
  ) {
    commonFields.cron_expr = frequency.value.cron.toString().trim();
    // commonFields.timezoneOffset = convertedDateTime.offset.toString();
    // commonFields.timezone = scheduling.value.timezone;
  }

  if (useFormData) {
    commonFields.owner = store.state.userInfo.email;
  }
  // if (frequency.value.type == "Once") {
  //   commonFields.timezone = null;
  //   commonFields.timezoneOffset = null;
  // }

  // Add environment variables if present
  if (environmentalVariables.value.length > 0) {
    // Convert environmentalVariables to an object, ignoring conflicts with mandatory keys
    const environment_variables = environmentalVariables.value.reduce(
      (acc: any, curr: any) => {
        // Check if the key exists in mandatoryKeys
        if (curr.key) {
          // Add the key only if it is not a mandatory key
          acc[curr.key] = curr.value;
        }

        return acc;
      },
      {},
    );

    // Assign to commonFields
    commonFields.environment_variables = environment_variables;
  }

  // Populate form (either FormData or plain object)
  Object.entries(commonFields).forEach(([key, value]) => {
    if (useFormData) {
      (form as FormData).append(
        key,
        typeof value === "object" ? JSON.stringify(value) : value,
      );
    } else {
      (form as Record<string, any>)[key] = value;
    }
  });

  // Add file fields if using FormData
  if (useFormData && formData.value.codeZip) {
    (form as FormData).append("file", formData.value.codeZip || "");
    (form as FormData).append(
      "filename",
      (formData.value.codeZip as File).name || "",
    );
  }

  if (isEditingActionScript.value && formData.value.codeZip) {
    (form as FormData).append("id", formData.value.id);
  }

  // Check if all report input fields are valid
  try {
    validateActionScriptData();
    await nextTick();
    // Inline validation for migrated O2 fields
    nameError.value = !formData.value.name
      ? t('common.nameRequired')
      : !isValidResourceName(formData.value.name)
        ? 'Characters like :, ?, /, #, and spaces are not allowed.'
        : '';
    typeError.value = formData.value.type ? '' : 'Field is required!';
    serviceAccountError.value = formData.value.service_account ? '' : 'Field is required!';
    if (formData.value.execution_details === 'repeat') {
      cronFieldError.value = !frequency.value.cron?.length ? 'Field is required!' : (cronError.value.length ? cronError.value : '');
    }
    if (nameError.value || typeError.value || serviceAccountError.value || cronFieldError.value) return;
  } catch (err) {
    console.log(err);
  }

  const updateAction =
    isEditingActionScript.value && !formData.value.codeZip
      ? actions.update
      : actions.create;

  const dismiss = toast({
    variant: "loading",
    message: "Please wait...",
      timeout: 0,
});
  const actionId: string = (router.currentRoute.value.query?.id ||
    "") as string;

  updateAction(store.state.selectedOrganization.identifier, actionId, form)
    .then(() => {
      toast({
        variant: "success",
        message: `Action ${
          isEditingActionScript.value ? "updated" : "saved"
        } successfully.`,
      });
      goToActionScripts();
      emit("getActionScripts");
    })
    .catch((error) => {
      step.value = 3;
      if (error.response.status != 403) {
        toast({
          variant: "error",
          message:
            error?.response?.data?.message ||
            `Error while ${
              isEditingActionScript.value ? "updating" : "saving"
            } Action.`,
        });
      }
    })
    .finally(() => {
      dismiss();
    });
};

const validateActionScriptData = async () => {
  if (!formData.value.codeZip && !isEditingActionScript.value) {
    step.value = 1;
    return;
  }

  if (formData.value.execution_details === "repeat") {
    try {
      cronError.value = "";
      CronExpressionParser.parse(frequency.value.cron, {
        currentDate: new Date(),
        utc: true,
      });
      validateFrequency(frequency.value.cron);
    } catch (err) {
      cronError.value = "Invalid cron expression!";
      return;
    }
  }

  if (formData.value.execution_details === "repeat" && cronError.value) {
    step.value = 2;
    return;
  }

  if (!formData.value.service_account) {
    step.value = 3;
    return;
  }

  if (!formData.value.execution_details) {
    step.value = 2;
    return;
  }

  // if (!formData.value.timezone) {
  //   step.value = 2;
  //   return;
  // }
};

const validateFrequency = (value: string) => {
  cronError.value = "";

  if (!value || !value.trim()) {
    cronError.value = "Invalid cron expression!";
    return;
  }

  try {
    const intervalInSecs = getCronIntervalDifferenceInSeconds(value);

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
  }
};

const goToActionScripts = () => {
  router.replace({
    name: "actionScripts",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const setupEditingActionScript = async (report: any) => {
  formData.value = {
    ...report,
    timezone: report.timezone || "UTC",
  };
  formData.value.fileNameToShow = report.zip_file_name;

  formData.value.type = "scheduled";

  if (formData.value.execution_details === "service") {
    formData.value.type = "service";
  }

  // set date, time and timezone in scheduling
  // const date = new Date(report.start / 1000);

  // // Get the day, month, and year from the date object
  // const day = String(date.getDate()).padStart(2, "0");
  // const month = String(date.getMonth() + 1).padStart(2, "0"); // January is 0!
  // const year = date.getFullYear();

  // // Combine them in the DD-MM-YYYY format
  // scheduling.value.date = `${day}-${month}-${year}`;

  // // Get the hours and minutes, ensuring they are formatted with two digits
  // const hours = String(date.getHours()).padStart(2, "0");
  // const minutes = String(date.getMinutes()).padStart(2, "0");

  // // Combine them in the HH:MM format
  // scheduling.value.time = `${hours}:${minutes}`;

  // scheduling.value.timezone = report.timezone;

  // // set selectedTimeTab to scheduleLater
  // selectedTimeTab.value = "scheduleLater";

  // set frequency
  if (report.execution_details == "repeat") {
    frequency.value.type = "repeat";
    frequency.value.cron =
      report.cron_expr.split(" ").length === 7
        ? report.cron_expr.split(" ").slice(0, 6).join(" ")
        : report.cron_expr;
  } else {
    frequency.value.type = "once";
  }
  if (Object.keys(formData.value.environment_variables).length) {
    environmentalVariables.value = [];
    Object.entries(formData.value.environment_variables).forEach(
      ([key, value]: [string, any]) => {
        addApiHeader(key, value);
      },
    );
  }
};

const openCancelDialog = () => {
  if (originalActionScriptData.value === JSON.stringify(formData.value)) {
    goToActionScripts();
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel Action changes?";
  dialog.value.okCallback = goToActionScripts;
};
const editFileToUpload = () => {
  formData.value.fileNameToShow = "";
};
const cancelUploadingNewFile = () => {
  formData.value.fileNameToShow = JSON.parse(
    originalActionScriptData.value,
  ).zip_file_name;
};
const addApiHeader = (key: string = "", value: string = "") => {
  environmentalVariables.value.push({
    key: key,
    value: value,
    uuid: getUUID(),
  });
};
const deleteApiHeader = (header: any) => {
  environmentalVariables.value = environmentalVariables.value.filter(
    (_header) => _header.uuid !== header.uuid,
  );
  if (
    (formData.value.environment_variables as { [key: string]: any })[header.key]
  ) {
    delete (formData.value.environment_variables as { [key: string]: any })[
      header.key
    ];
  }

  if (!environmentalVariables.value.length) addApiHeader();
};
const isRequiredKey = (value: any) => {
  return value && value.trim() !== "" ? true : "Key is required";
};

const isRequiredValue = (value: any) => {
  return value && value.trim() !== "" ? true : "Value is required";
};

const handleActionScript = async () => {
  isEditingActionScript.value = !!router.currentRoute.value.query?.id;

  if (isEditingActionScript.value) {
    isEditingActionScript.value = true;
    isFetchingActionScript.value = true;

    const actionId: string = (router.currentRoute.value.query?.id ||
      "") as string;
    actions
      .get_by_id(store.state.selectedOrganization.identifier, actionId)
      .then((res: any) => {
        setupEditingActionScript(res.data);

        originalActionScriptData.value = JSON.stringify(formData.value);
      })
      .catch((err) => {
        if (err.response.status != 403) {
          toast({
            variant: "error",
            message: err?.data?.message || "Error while fetching Action!",
          });
        }
      })
      .finally(() => {
        isFetchingActionScript.value = false;
      });
  } else {
    originalActionScriptData.value = JSON.stringify(formData.value);
  }
};

const filteredServiceAccounts: Ref<{ label: string; value: string }[]> = ref(
  [],
);
const isFetchingServiceAccounts = ref(false);

const filterServiceAccounts = (val: string, update: Function) => {
  filteredServiceAccounts.value = filterColumns(
    serviceAccountsOptions,
    val,
    update,
  );
};

const serviceAccountsOptions: any[] = [];

const getServiceAccounts = async () => {
  isFetchingServiceAccounts.value = true;
  try {
    const res = await service_accounts.list(
      store.state.selectedOrganization.identifier,
    );
    serviceAccountsOptions.push(
      ...res.data.data.map((account: any) => account.email),
    );
    filteredServiceAccounts.value = [...serviceAccountsOptions];
  } catch (err: any) {
    if (err.response?.status != 403) {
      toast({
        variant: "error",
        message:
          err.response?.data?.message ||
          "Error while fetching service accounts.",
      });
    }
  } finally {
    isFetchingServiceAccounts.value = false;
  }
};

onMounted(async () => {
  await getServiceAccounts();
});
</script>

<style scoped lang="scss">
.lookup-table-file-uploader {
  :deep(.q-field__label) {
    left: -30px;
  }
}

.service-account-selector {
  :deep(.q-field__control-container .q-field__native > :first-child) {
    text-transform: none !important;
  }
}
</style>
