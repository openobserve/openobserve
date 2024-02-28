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
              <div class="q-my-sm q-px-sm flex items-center justify-start">
                <div
                  data-test="add-report-dashboard-select"
                  class="o2-input q-mr-sm"
                  style="padding-top: 0; width: 30%"
                >
                  <q-select
                    v-model="formData.selected_dashboard.folder_id"
                    :options="folderOptions"
                    :label="t('reports.dashboardFolder') + ' *'"
                    :loading="isFetchingFolders"
                    :popup-content-style="{ textTransform: 'lowercase' }"
                    color="input-border"
                    bg-color="input-bg"
                    class="q-py-sm showLabelOnTop no-case"
                    filled
                    stack-label
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :input-debounce="400"
                    @update:model-value="
                      onFolderSelection(formData.selected_dashboard.folder_id)
                    "
                    behavior="menu"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="min-width: 250px !important; width: 100% !important"
                  />
                </div>
                <div
                  data-test="add-alert-stream-select"
                  class="o2-input q-mr-sm"
                  style="padding-top: 0; width: 30%"
                >
                  <q-select
                    v-model="formData.selected_dashboard.dashboard_id"
                    :options="dashboardOptions"
                    :label="t('reports.dashboard') + ' *'"
                    :loading="isFetchingDashboard"
                    :popup-content-style="{ textTransform: 'lowercase' }"
                    color="input-border"
                    bg-color="input-bg"
                    class="q-py-sm showLabelOnTop no-case"
                    filled
                    stack-label
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :input-debounce="400"
                    @update:model-value="
                      onDashboardSelection(
                        formData.selected_dashboard.dashboard_id
                      )
                    "
                    behavior="menu"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="min-width: 250px !important; width: 100% !important"
                  />
                </div>
                <div
                  data-test="add-alert-stream-select"
                  class="o2-input"
                  style="padding-top: 0; width: 30%"
                >
                  <q-select
                    v-model="formData.selected_dashboard.tab_id"
                    :options="dashboardTabOptions"
                    :label="t('reports.dashboardTab') + ' *'"
                    :loading="isFetchingDashboard"
                    :popup-content-style="{ textTransform: 'lowercase' }"
                    color="input-border"
                    bg-color="input-bg"
                    class="q-py-sm showLabelOnTop no-case"
                    filled
                    stack-label
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :input-debounce="400"
                    behavior="menu"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="min-width: 250px !important; width: 100% !important"
                  />
                </div>

                <div class="full-width q-mt-sm">
                  <div class="q-mb-sm">
                    <div style="font-size: 14px" class="text-bold text-grey-8">
                      Time Range*
                    </div>
                    <div style="font-size: 12px">
                      Generates report with the data from specified time range
                    </div>
                  </div>
                  <DateTime
                    auto-apply
                    :default-type="formData.time_range.type"
                    :default-absolute-time="{
                      startTime: formData.time_range.from,
                      endTime: formData.time_range.to,
                    }"
                    :default-relative-time="formData.time_range.period"
                    data-test="logs-search-bar-date-time-dropdown"
                    @on:date-change="updateDateTime"
                  />
                </div>

                <div class="full-width q-mt-md o2-input">
                  <div style="font-size: 14px" class="text-bold text-grey-8">
                    Variables
                  </div>
                  <VariablesInput
                    :variables="formData.selected_dashboard.variables"
                    @add:variable="addDashboardVariable"
                    @remove:variable="removeDashboardVariable"
                  />
                </div>
              </div>

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
                      v-model="formData.custom_frequency.every"
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
                      v-model="formData.scheduling.date"
                      label="Start Date"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
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
                            <q-date
                              v-model="formData.scheduling.date"
                              mask="YYYY-MM-DD"
                            >
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
                      v-model="formData.scheduling.time"
                      label="Start Date"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
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
                            <q-time
                              v-model="formData.scheduling.time"
                              mask="HH:MM"
                            >
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
                      v-model="formData.scheduling.timeZone"
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
                    v-model="formData.email_content.title"
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
                    v-model="formData.destination.recipients"
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
                  <q-input
                    v-model="formData.email_content.message"
                    filled
                    type="textarea"
                  />
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

const { t } = useI18n();
const router = useRouter();

const step = ref(1);

const formData = ref({
  name: "",
  description: "",
  selected_dashboard: {
    folder_id: "",
    dashboard_id: "",
    tab_id: "",
    variables: [
      {
        name: "",
        value: "",
        id: "abc",
      },
    ],
  },
  time_range: {
    from: 0,
    to: 0,
    period: "15m",
    type: "relative",
  },
  scheduling: {
    frequency: "Monthly/Weekly/Daily/Hourly",
    date: "",
    time: "",
    timeZone: "",
  },
  user_credentials: {
    username: "",
    password: "",
  },
  destination: {
    type: "Email",
    recipients: "",
  },
  email_content: {
    title: "",
    dashboard_link: "URL to Dashboard",
    attachments: ["image", "csv", "pdf"],
    message: "",
  },
  frequency: "once",
  custom_frequency: {
    every: 1,
    frequency: "days",
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

const folderOptions = ref([
  {
    label: "Folder1",
    value: "Folder1",
  },
]);

const dashboardOptions = ref([
  {
    label: "Dashboard1",
    value: "Dashboard1",
  },
]);

const dashboardTabOptions = ref([
  {
    label: "Tab1",
    value: "Tab1",
  },
]);

const isFetchingFolders = ref(false);

const isFetchingDashboard = ref(false);

const onSubmit = () => {};

const filterFolders = () => {};

const onFolderSelection = (id: string) => {};

const filterDashboard = () => {};

const onDashboardSelection = (id: string) => {};

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
  formData.value.selected_dashboard.variables.push({
    name: "",
    value: "",
    id: getUUID(),
  });
};

const removeDashboardVariable = (variable: any) => {
  formData.value.selected_dashboard.variables =
    formData.value.selected_dashboard.variables.filter(
      (_variable: any) => _variable.id !== variable.id
    );
};
</script>

<style lang="scss">
.create-report-page {
  .q-expansion-item .q-item {
    padding: 0 8px;
  }
}
</style>
