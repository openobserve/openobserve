<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="full-width create-report-page">
    <div class="row items-center no-wrap q-mx-md q-my-sm">
      <div class="flex items-center">
        <div
          data-test="add-report-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="router.back()"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div v-if="beingUpdated" class="text-h6" data-test="add-report-title">
          {{ t("reports.updateTitle") }}
        </div>
        <div v-else class="text-h6" data-test="add-report-title">
          {{ t("reports.add") }}
        </div>
      </div>
    </div>
    <q-separator />
    <div style="height: calc(100vh - 162px); overflow: auto">
      <div ref="addAlertFormRef" class="q-px-lg q-my-md" style="width: 1024px">
        <q-form
          class="create-report-form"
          ref="addReportFormRef"
          @submit="onSubmit"
        >
          <div
            data-test="add-report-name-input"
            class="report-name-input o2-input q-px-sm"
            style="padding-top: 12px"
          >
            <q-input
              v-model="formData.name"
              :label="t('alerts.name') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              :rules="[(val: any) => !!val.trim() || 'Field is required!']"
              tabindex="0"
              style="width: 400px"
            />
          </div>
          <div
            data-test="add-report-name-input"
            class="report-name-input o2-input q-px-sm"
          >
            <q-input
              v-model="formData.description"
              :label="t('reports.description')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="0"
              style="width: 600px"
            />
          </div>
          <q-stepper
            v-model="step"
            vertical
            color="primary"
            animated
            class="q-mt-md"
            header-nav
          >
            <q-step
              :name="1"
              title="Select Dashboard"
              :icon="outlinedDashboard"
              :done="step > 1"
            >
              <template
                v-for="dashboard in formData.dashboards"
                :key="dashboard.folder + dashboard.dashboard"
              >
                <div class="q-my-sm q-px-sm flex items-center justify-start">
                  <div
                    data-test="add-report-dashboard-select"
                    class="o2-input q-mr-sm"
                    style="padding-top: 0; width: 30%"
                  >
                    <q-select
                      v-model="dashboard.folder"
                      :options="folderOptions"
                      :label="t('reports.dashboardFolder') + ' *'"
                      :loading="isFetchingFolders"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="q-py-sm showLabelOnTop no-case"
                      filled
                      stack-label
                      map-options
                      dense
                      emit-value
                      use-input
                      hide-selected
                      fill-input
                      :input-debounce="400"
                      @update:model-value="onFolderSelection(dashboard.folder)"
                      behavior="menu"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      style="
                        min-width: 250px !important;
                        width: 100% !important;
                      "
                    />
                  </div>
                  <div
                    data-test="add-alert-stream-select"
                    class="o2-input q-mr-sm"
                    style="padding-top: 0; width: 30%"
                  >
                    <q-select
                      v-model="dashboard.dashboard"
                      :options="dashboardOptions"
                      :label="t('reports.dashboard') + ' *'"
                      :loading="isFetchingDashboard || isFetchingFolders"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="q-py-sm showLabelOnTop no-case"
                      filled
                      map-options
                      stack-label
                      dense
                      use-input
                      hide-selected
                      fill-input
                      :input-debounce="400"
                      @update:model-value="
                        onDashboardSelection(dashboard.dashboard)
                      "
                      behavior="menu"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      style="
                        min-width: 250px !important;
                        width: 100% !important;
                      "
                    />
                  </div>
                  <div
                    data-test="add-alert-stream-select"
                    class="o2-input"
                    style="padding-top: 0; width: 30%"
                  >
                    <q-select
                      v-model="dashboard.tabs"
                      :options="dashboardTabOptions"
                      :label="t('reports.dashboardTab') + ' *'"
                      :loading="isFetchingDashboard || isFetchingFolders"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="q-py-sm showLabelOnTop no-case"
                      filled
                      emit-value
                      map-options
                      stack-label
                      dense
                      use-input
                      hide-selected
                      fill-input
                      :input-debounce="400"
                      behavior="menu"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      style="
                        min-width: 250px !important;
                        width: 100% !important;
                      "
                    />
                  </div>

                  <div class="full-width q-mt-sm">
                    <div class="q-mb-sm">
                      <div
                        style="font-size: 14px"
                        class="text-bold text-grey-8"
                      >
                        Time Range*
                      </div>
                      <div style="font-size: 12px">
                        Generates report with the data from specified time range
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
                      data-test="logs-search-bar-date-time-dropdown"
                      @on:date-change="updateDateTime"
                    />
                  </div>

                  <div class="full-width q-mt-md o2-input">
                    <div style="font-size: 14px" class="text-bold text-grey-8">
                      Variables
                    </div>
                    <VariablesInput
                      :variables="dashboard.variables"
                      @add:variable="addDashboardVariable"
                      @remove:variable="removeDashboardVariable"
                    />
                  </div>
                </div>
              </template>
              <q-stepper-navigation>
                <q-btn
                  @click="step = 2"
                  color="secondary"
                  label="Continue"
                  no-caps
                />
              </q-stepper-navigation>
            </q-step>

            <q-step
              :name="2"
              title="Schedule"
              icon="schedule"
              :done="step > 2"
              class="q-mt-md"
            >
              <div class="q-my-sm q-px-sm">
                <!-- <div class="flex justify-start items-center q-py-sm">
              <q-icon name="event" class="q-mr-sm" />
              <div style="font-size: 14px">
                The report will be sent immediately after it is saved and will
                be sent every hour.
              </div>
            </div> -->
                <div
                  style="font-size: 14px"
                  class="text-bold text-grey-8 q-mb-sm"
                >
                  Frequency
                </div>
                <div
                  style="
                    border: 1px solid #d7d7d7;
                    width: fit-content;
                    border-radius: 2px;
                  "
                >
                  <template v-for="visual in frequencyTabs" :key="visual.value">
                    <q-btn
                      :data-test="`edit-role-permissions-show-${visual.value}-btn`"
                      :color="
                        visual.value === formData.frequency ? 'primary' : ''
                      "
                      :flat="visual.value === formData.frequency ? false : true"
                      dense
                      no-caps
                      size="12px"
                      class="q-px-lg visual-selection-btn"
                      style="padding-top: 4px; padding-bottom: 4px"
                      @click="formData.frequency = visual.value"
                    >
                      {{ visual.label }}</q-btn
                    >
                  </template>
                </div>

                <div
                  class="q-mt-md"
                  style="
                    border: 1px solid #d7d7d7;
                    width: fit-content;
                    border-radius: 2px;
                  "
                >
                  <template v-for="visual in timeTabs" :key="visual.value">
                    <q-btn
                      :data-test="`edit-role-permissions-show-${visual.value}-btn`"
                      :color="visual.value === selectedTimeTab ? 'primary' : ''"
                      :flat="visual.value === selectedTimeTab ? false : true"
                      dense
                      no-caps
                      size="12px"
                      class="q-px-md visual-selection-btn"
                      style="padding-top: 4px; padding-bottom: 4px"
                      @click="selectedTimeTab = visual.value"
                    >
                      {{ visual.label }}</q-btn
                    >
                  </template>
                </div>

                <div
                  v-if="formData.frequency === 'custom'"
                  class="flex items-center justify-start q-mt-md"
                >
                  <div
                    data-test="add-alert-stream-select"
                    class="o2-input q-mr-sm"
                    style="padding-top: 0; width: 160px"
                  >
                    <q-input
                      filled
                      v-model="formData.custom_frequency.interval"
                      label="Repeat every"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
                      stack-label
                      type="number"
                      outlined
                      dense
                      style="width: 100%"
                    />
                  </div>

                  <div
                    data-test="add-alert-stream-select"
                    class="o2-input"
                    style="padding-top: 0; width: 160px"
                  >
                    <q-select
                      v-model="formData.custom_frequency.frequency"
                      :options="customFrequencyOptions"
                      :label="' '"
                      :popup-content-style="{ textTransform: 'capitalize' }"
                      color="input-border"
                      bg-color="input-bg"
                      class="q-pt-sm q-pb-none showLabelOnTop no-case"
                      filled
                      emit-value
                      stack-label
                      dense
                      behavior="menu"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      style="width: 100% !important"
                    />
                  </div>
                </div>

                <div
                  v-if="selectedTimeTab === 'sendLater'"
                  class="flex items-center justify-start q-mt-md"
                >
                  <div class="o2-input q-mr-sm">
                    <q-input
                      filled
                      v-model="scheduling.date"
                      label="Start Date"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
                      :rules="[
                        (val) =>
                          /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-\d{4}$/.test(
                            val
                          ) || 'Date format is incorrect!',
                      ]"
                      stack-label
                      outlined
                      dense
                      style="width: 160px"
                    >
                      <template v-slot:append>
                        <q-icon name="event" class="cursor-pointer">
                          <q-popup-proxy
                            cover
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-date v-model="scheduling.date" mask="DD-MM-YYYY">
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup
                                  label="Close"
                                  color="primary"
                                  flat
                                />
                              </div>
                            </q-date>
                          </q-popup-proxy>
                        </q-icon>
                      </template>
                    </q-input>
                  </div>
                  <div class="o2-input q-mr-sm">
                    <q-input
                      filled
                      v-model="scheduling.time"
                      label="Start Time"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
                      mask="time"
                      :rules="['time']"
                      stack-label
                      outlined
                      dense
                      style="width: 160px"
                    >
                      <template v-slot:append>
                        <q-icon name="access_time" class="cursor-pointer">
                          <q-popup-proxy
                            cover
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-time v-model="scheduling.time">
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup
                                  label="Close"
                                  color="primary"
                                  flat
                                />
                              </div>
                            </q-time>
                          </q-popup-proxy>
                        </q-icon>
                      </template>
                    </q-input>
                  </div>
                  <div class="o2-input">
                    <q-select
                      data-test="datetime-timezone-select"
                      v-model="scheduling.timezone"
                      :options="filteredTimezone"
                      @blur="
                        timezone =
                          timezone == ''
                            ? Intl.DateTimeFormat().resolvedOptions().timeZone
                            : timezone
                      "
                      use-input
                      @filter="timezoneFilterFn"
                      input-debounce="0"
                      dense
                      filled
                      emit-value
                      fill-input
                      hide-selected
                      :label="t('logStream.timezone')"
                      @update:modelValue="onTimezoneChange"
                      :display-value="`Timezone: ${timezone}`"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      class="timezone-select showLabelOnTop"
                      stack-label
                      outlined
                      style="width: 300px"
                    />
                  </div>
                </div>
              </div>

              <q-stepper-navigation>
                <q-btn
                  @click="step = 3"
                  color="secondary"
                  label="Continue"
                  no-caps
                />
                <q-btn
                  flat
                  @click="step = 1"
                  color="primary"
                  label="Back"
                  class="q-ml-sm"
                  no-caps
                />
              </q-stepper-navigation>
            </q-step>

            <q-step
              :name="3"
              title="Share"
              icon="mail"
              :done="step > 3"
              class="q-mt-md"
            >
              <div class="q-my-sm q-px-sm">
                <div
                  data-test="add-report-name-input"
                  class="report-name-input o2-input"
                >
                  <q-input
                    v-model="formData.title"
                    :label="t('reports.title') + ' *'"
                    color="input-border"
                    bg-color="input-bg"
                    class="showLabelOnTop"
                    stack-label
                    outlined
                    filled
                    dense
                    v-bind:readonly="beingUpdated"
                    v-bind:disable="beingUpdated"
                    :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                    tabindex="0"
                    style="width: 400px"
                  />
                </div>

                <div
                  data-test="add-report-name-input"
                  class="report-name-input o2-input"
                >
                  <q-input
                    v-model="formData.destinations.emails"
                    :label="t('reports.recipients') + ' *'"
                    color="input-border"
                    bg-color="input-bg"
                    class="showLabelOnTop"
                    stack-label
                    outlined
                    filled
                    dense
                    v-bind:readonly="beingUpdated"
                    v-bind:disable="beingUpdated"
                    :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                    tabindex="0"
                    style="width: 100%"
                    borderless
                    :placeholder="t('user.inviteByEmail')"
                  />
                </div>
                <div>
                  <div style="font-size: 14px" class="text-bold text-grey-8">
                    Message
                  </div>

                  <q-input v-model="formData.message" filled type="textarea" />
                </div>
              </div>
              <q-stepper-navigation>
                <q-btn
                  flat
                  @click="step = 2"
                  color="primary"
                  label="Back"
                  class="q-ml-sm"
                  no-caps
                />
              </q-stepper-navigation>
            </q-step>
          </q-stepper>

          <!-- <q-expansion-item
            label="Credentials"
            header-class="text-bold"
            class="q-mt-md"
          >
            <div class="q-my-sm q-px-sm">
              <div
                data-test="add-report-name-input"
                class="report-name-input o2-input"
              >
                <q-input
                  v-model="formData.user_credentials.email"
                  :label="t('login.userEmail') + ' *'"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  v-bind:readonly="beingUpdated"
                  v-bind:disable="beingUpdated"
                  :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                  tabindex="0"
                  style="width: 400px"
                />
              </div>
              <div
                data-test="add-report-name-input"
                class="report-name-input o2-input"
              >
                <q-input
                  v-model="formData.user_credentials.password"
                  :label="t('login.password') + ' *'"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  type="password"
                  dense
                  v-bind:readonly="beingUpdated"
                  v-bind:disable="beingUpdated"
                  :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                  tabindex="0"
                  style="width: 400px"
                />
              </div>
            </div>
          </q-expansion-item> -->
        </q-form>
      </div>
    </div>
    <div
      class="flex justify-end q-px-md q-py-sm full-width"
      style="position: sticky; bottom: 0px; z-index: 2"
      :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
      :style="{
        'box-shadow':
          store.state.theme === 'dark'
            ? 'rgb(45 45 45) 0px -4px 7px 0px'
            : 'rgb(240 240 240) 0px -4px 7px 0px',
      }"
    >
      <q-btn
        data-test="edit-role-cancel-btn"
        class="text-bold"
        :label="t('alerts.cancel')"
        text-color="light-text"
        padding="sm md"
        no-caps
      />
      <q-btn
        data-test="edit-role-save-btn"
        :label="t('alerts.save')"
        class="text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        no-caps
        @click="saveReport"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import { getUUID, useLocalTimezone } from "@/utils/zincutils";
import VariablesInput from "@/components/alerts/VariablesInput.vue";
import { useStore } from "vuex";
import { outlinedDashboard } from "@quasar/extras/material-icons-outlined";
import dashboardService from "@/services/dashboards";
import { onBeforeMount } from "vue";
import type { Ref } from "vue";
import { DateTime as _DateTime } from "luxon";

const { t } = useI18n();
const router = useRouter();

const step = ref(1);

const formData = ref({
  dashboards: [
    {
      folder: "",
      dashboard: "",
      tabs: "",
      variables: [],
      timerange: {
        type: "relative",
        period: "30m",
        from: 0,
        to: 0,
      },
    },
  ],
  description: "",
  destinations: {
    emails: "",
  },
  enabled: true,
  media_type: "Pdf",
  name: "MyReport",
  title: "Report",
  message: "",
  org_id: "default",
  start: 1708928905113829,
  frequency: "once",
  user: "something",
  password: "something",
  custom_frequency: {
    interval: "",
    frequency: "",
  },
});

const timeTabs = [
  {
    label: "Send now",
    value: "sendNow",
  },
  {
    label: "Send later",
    value: "sendLater",
  },
];

const frequencyTabs = [
  {
    label: "Once",
    value: "once",
  },
  {
    label: "Hourly",
    value: "hourly",
  },
  {
    label: "Daily",
    value: "daily",
  },
  {
    label: "Weekly",
    value: "weekly",
  },
  {
    label: "Monthly",
    value: "monthly",
  },
  {
    label: "Custom",
    value: "custom",
  },
];

const selectedTimeTab = ref("sendLater");

const beingUpdated = computed(() => {
  return false;
});

const store = useStore();

const filteredTimezone: any = ref([]);

const folderOptions = ref([]);

const dashboardOptions: Ref<
  { label: string; value: string; tabs: any[]; version: number }[]
> = ref([]);

const dashboardTabOptions: Ref<{ label: string; value: string }[]> = ref([]);

onBeforeMount(() => {
  getDashboaordFolders();
});

const reportPayload: Ref<any> = ref(formData.value);

const isFetchingFolders = ref(false);

const isFetchingDashboard = ref(false);

const onSubmit = () => {};

const scheduling = ref({
  date: "",
  time: "",
  timezone: "",
});

const filterFolders = () => {};

const onFolderSelection = (id: string) => {
  dashboardOptions.value.length = 0;
  isFetchingDashboard.value = true;
  dashboardService
    .list(
      0,
      10000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      id
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
              tabs: dashboard.tabs || [],
              version: dashboard.version,
            });
          }
        );
    })
    .finally(() => (isFetchingDashboard.value = false));
};

const filterDashboard = () => {};

const onDashboardSelection = (dashboard: any) => {
  dashboardTabOptions.value.length = 0;
  dashboard.tabs.forEach((tab: any) => {
    dashboardTabOptions.value.push({
      label: tab.name,
      value: tab.tabId,
    });
  });
};

const filterTabs = () => {};

const updateDateTime = (datetime) => {
  console.log(datetime);
};

const scheduleInfoMapping = {
  frequency: {
    once: "immediately",
  },
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

const timezoneFilterFn = (val, update) => {
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
      (column: any) => column.toLowerCase().indexOf(value) > -1
    );
  });
  return filteredOptions;
};

let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
  return tz;
});

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

const onTimezoneChange = async (timezone) => {
  console.log(timezone);
};

const addDashboardVariable = () => {
  formData.value.dashboards[0].variables.push({
    name: "",
    value: "",
    id: getUUID(),
  });
};

const removeDashboardVariable = (variable: any) => {
  formData.value.dashboards[0].variables =
    formData.value.dashboards[0].variables.filter(
      (_variable: any) => _variable.id !== variable.id
    );
};

const getDashboaordFolders = () => {
  isFetchingFolders.value = true;
  dashboardService
    .list_Folders(store.state.selectedOrganization.identifier)
    .then((res) => {
      res.data.list.forEach((folder: { name: string; folderId: string }) => {
        folderOptions.value.push({
          label: folder.name,
          value: folder.folderId,
        });
      });
    })
    .finally(() => {
      isFetchingFolders.value = false;
    });
};

/**
 * @param {string} date - date in DD-MM-YYYY format
 * @param {string} time - time in HH:MM 24hr format
 * @param {string} timezone - timezone
 */
const convertDateToTimestamp = (
  date: string,
  time: string,
  timezone: string
) => {
  const [day, month, year] = date.split("-");
  const [hour, minute] = time.split(":");

  const _date = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };

  // Create a DateTime instance from date and time, then set the timezone
  const dateTime = _DateTime.fromObject(_date, {
    zone: timezone,
  });

  // Convert the DateTime to a Unix timestamp in milliseconds
  const unixTimestampMillis = dateTime.toMillis();

  return unixTimestampMillis * 1000; // timestamp in microseconds
};

const saveReport = () => {
  formData.value.start = convertDateToTimestamp(
    scheduling.value.date,
    scheduling.value.time,
    scheduling.value.timezone
  );

  console.log(formData.value);
};
</script>

<style lang="scss">
.create-report-page {
  .q-expansion-item .q-item {
    padding: 0 8px;
  }
}
</style>
