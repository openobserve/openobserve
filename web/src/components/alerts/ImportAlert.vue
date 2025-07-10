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
  <div class="q-mt-md full-width">
    <div class="flex q-mx-md items-center no-wrap">
      <div class="col">
        <div class="flex">
          <q-btn
            no-caps
            padding="xs"
            outline
            @click="router.back()"
            icon="arrow_back_ios_new"
            data-test="alert-import-back-btn"
          />
          <div class="text-h6 q-ml-md">Import Alert</div>
        </div>
      </div>
      <div class="flex justify-center">
        <q-btn
          v-close-popup
          class="text-bold q-mr-md"
          :label="t('function.cancel')"
          text-color="light-text"
          padding="sm xl"
          no-caps
          @click="router.back()"
          data-test="alert-import-cancel-btn"
        />
        <q-btn
          class="text-bold no-border"
          :label="t('dashboard.import')"
          color="secondary"
          type="submit"
          padding="sm xl"
          no-caps
          @click="importJson"
          :loading="isAlertImporting"
          :disable="isAlertImporting"
          data-test="alert-import-json-btn"
        />
      </div>
    </div>

    <q-separator class="q-my-sm q-mx-md" />
  </div>
  <div class="flex">
    <div class="report-list-tabs flex items-center justify-center q-mx-md">
      <app-tabs
        data-test="alert-import-tabs"
        class="q-mr-md"
        :tabs="tabs"
        v-model:active-tab="activeTab"
        @update:active-tab="updateActiveTab"
      />
    </div>

    <div class="flex">
      <q-splitter
        class="logs-search-splitter"
        no-scroll
        v-model="splitterModel"
        style="width: calc(95vw - 20px); height: 100%"
      >
        <template #before>
          <div
            v-if="activeTab == 'import_json_url'"
            class="editor-container-url"
          >
            <q-form class="q-mx-md q-mt-md" @submit="onSubmit">
              <div style="width: calc(100% - 10px)" class="q-mb-md flex">
                <div style="width: calc(69%)" class="q-pr-sm">
                  <q-input
                    data-test="alert-import-url-input"
                    v-model="url"
                    :label="t('dashboard.addURL')"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    filled
                    label-slot
                  />
                </div>

                <div
                  style="width: calc(30%)"
                  class="alert-folder-dropdown"
                  data-test="alert-folder-dropdown"
                >
                  <SelectFolderDropDown
                    :type="'alerts'"
                    @folder-selected="updateActiveFolderId"
                    :activeFolderId="activeFolderId"
                  />
                </div>
              </div>
              <query-editor
                data-test="alert-import-sql-editor"
                ref="queryEditorRef"
                editor-id="alert-import-query-editor"
                class="monaco-editor"
                :debounceTime="300"
                v-model:query="jsonStr"
                language="json"
                :class="
                  jsonStr == '' && queryEditorPlaceholderFlag
                    ? 'empty-query'
                    : ''
                "
                @focus="queryEditorPlaceholderFlag = false"
                @blur="queryEditorPlaceholderFlag = true"
              />

              <div></div>
            </q-form>
          </div>
          <div
            v-if="activeTab == 'import_json_file'"
            class="editor-container-json"
          >
            <q-form class="q-mx-md q-mt-md" @submit="onSubmit">
              <div style="width: calc(100% - 10px)" class="q-mb-md flex">
                <div style="width: calc(69%)" class="q-pr-sm">
                  <q-file
                    data-test="alert-import-json-file-input"
                    v-model="jsonFiles"
                    filled
                    bottom-slots
                    :label="t('dashboard.dropFileMsg')"
                    accept=".json"
                    multiple
                  >
                    <template v-slot:prepend>
                      <q-icon name="cloud_upload" @click.stop.prevent />
                    </template>
                    <template v-slot:append>
                      <q-icon
                        name="close"
                        @click.stop.prevent="jsonFiles = null"
                        class="cursor-pointer"
                      />
                    </template>
                    <template v-slot:hint> .json files only </template>
                  </q-file>
                </div>
                <div style="width: calc(30%)" class="alert-folder-dropdown">
                  <SelectFolderDropDown
                    :type="'alerts'"
                    @folder-selected="updateActiveFolderId"
                    :activeFolderId="activeFolderId"
                  />
                </div>
              </div>
              <query-editor
                data-test="alert-import-sql-editor"
                ref="queryEditorRef"
                editor-id="alert-import-query-editor"
                class="monaco-editor"
                :debounceTime="300"
                v-model:query="jsonStr"
                language="json"
                :class="
                  jsonStr == '' && queryEditorPlaceholderFlag
                    ? 'empty-query'
                    : ''
                "
                @focus="queryEditorPlaceholderFlag = false"
                @blur="queryEditorPlaceholderFlag = true"
              />

              <div></div>
            </q-form>
          </div>
        </template>
        <template #after>
          <div
            data-test="alert-import-output-editor"
            style="width: 100%; height: 100%"
          >
            <div
              v-if="alertErrorsToDisplay.length > 0"
              class="text-center text-h6"
            >
              Error Validations
            </div>
            <div v-else class="text-center text-h6">Output Messages</div>
            <q-separator class="q-mx-md q-mt-md" />
            <div class="error-report-container">
              <!-- Alert Errors Section -->
              <div class="error-section" v-if="alertErrorsToDisplay.length > 0">
                <div class="error-list">
                  <!-- Iterate through the outer array -->
                  <div
                    v-for="(errorGroup, index) in alertErrorsToDisplay"
                    :key="index"
                    :data-test="`alert-import-error-${index}`"
                  >
                    <!-- Iterate through each inner array (the individual error message) -->
                    <div
                      v-for="(errorMessage, errorIndex) in errorGroup"
                      :key="errorIndex"
                      class="error-item"
                      :data-test="`alert-import-error-${index}-${errorIndex}`"
                    >
                      <span
                        class="text-red"
                        v-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'alert_name'
                        "
                      >
                        {{ errorMessage.message }}

                        <div style="width: 300px">
                          <q-input
                            data-test="alert-import-name-input"
                            v-model="userSelectedAlertName[index]"
                            :label="t('alerts.name') + ' *'"
                            color="input-border"
                            bg-color="input-bg"
                            class="showLabelOnTop"
                            stack-label
                            outlined
                            filled
                            dense
                            tabindex="0"
                            @update:model-value="
                              updateAlertName(
                                userSelectedAlertName[index],
                                index,
                              )
                            "
                          />
                        </div>
                      </span>
                      <!-- Check if the errorMessage is an object, if so, display the 'message' property -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'stream_name'
                        "
                      >
                        {{ errorMessage.message }}
                        <div style="width: 300px">
                          <q-select
                            data-test="alert-import-stream-name-input"
                            v-model="userSelectedStreamName[index]"
                            :options="streamList"
                            :label="t('alerts.stream_name') + ' *'"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
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
                              updateStreamFields(
                                userSelectedStreamName[index],
                                index,
                              )
                            "
                            behavior="menu"
                          />
                        </div>
                      </span>
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'destination_name'
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="alert-import-destination-name-input"
                            v-model="userSelectedDestinations[index]"
                            :options="filteredDestinations"
                            @filter="filterDestinations"
                            label="Destinations *"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            filled
                            stack-label
                            dense
                            use-input
                            multiple
                            :input-debounce="400"
                            behavior="menu"
                            :rules="[
                              (val: any) => !!val || 'Field is required!',
                            ]"
                            style="width: 300px"
                            @update:model-value="
                              updateUserSelectedDestinations(
                                userSelectedDestinations[index],
                                index,
                              )
                            "
                          >
                            <template v-slot:option="scope">
                              <q-item
                                v-bind="scope.itemProps"
                                :data-test="`add-alert-destination-${scope.opt}-select-item`"
                              >
                                <q-item-section side>
                                  <q-checkbox
                                    data-test="alert-import-destination-checkbox"
                                    :model-value="
                                      userSelectedDestinations[index]?.includes(
                                        scope.opt,
                                      ) ?? false
                                    "
                                    dense
                                    @update:model-value="
                                      toggleDestination(scope.opt, index)
                                    "
                                  />
                                </q-item-section>
                                <q-item-section>
                                  <q-item-label
                                    data-test="alert-import-destination-label"
                                    >{{ scope.opt }}</q-item-label
                                  >
                                </q-item-section>
                              </q-item>
                            </template>
                          </q-select>
                        </div>
                      </span>
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'stream_type'
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="alert-import-stream-type-input"
                            v-model="userSelectedStreamType[index]"
                            :options="streamTypes"
                            :label="t('alerts.streamType') + ' *'"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="
                              updateStreams(
                                userSelectedStreamType[index],
                                index,
                              )
                            "
                            :rules="[
                              (val: any) => !!val || 'Field is required!',
                            ]"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'timezone'
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="alert-import-timezone-input"
                            v-model="userSelectedTimezone[index]"
                            :options="filteredTimezone"
                            :label="'Timezone *'"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="
                              updateTimezone(userSelectedTimezone[index], index)
                            "
                            @filter="timezoneFilterFn"
                            use-input
                            hide-selected
                            fill-input
                            :input-debounce="400"
                            behavior="menu"
                            :rules="[
                              (val: any) => !!val || 'Field is required!',
                            ]"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'org_id'
                        "
                      >
                        {{ errorMessage.message }}
                        <div style="width: 300px">
                          <q-select
                            data-test="alert-import-org-id-input"
                            v-model="userSelectedOrgId[index]"
                            :options="organizationDataList"
                            :label="'Organization Id'"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
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
                              updateOrgId(userSelectedOrgId[index].value, index)
                            "
                            behavior="menu"
                          >
                          </q-select>
                        </div>
                      </span>

                      <span v-else>{{ errorMessage }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="error-section" v-if="alertCreators.length > 0">
                <div
                  class="section-title text-primary"
                  data-test="alert-import-creation-title"
                >
                  Alert Creation
                </div>
                <div
                  class="error-list"
                  v-for="(val, index) in alertCreators"
                  :key="index"
                  :data-test="`alert-import-creation-${index}`"
                >
                  <div
                    :class="{
                      'error-item text-bold': true,
                      'text-green ': val.success,
                      'text-red': !val.success,
                    }"
                    :data-test="`alert-import-creation-${index}-message`"
                  >
                    <pre>{{ val.message }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </q-splitter>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  reactive,
  computed,
  watch,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import axios from "axios";
import router from "@/router";
import { useQuasar } from "quasar";
import alertsService from "../../services/alerts";

import useStreams from "@/composables/useStreams";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";

import AppTabs from "../common/AppTabs.vue";
import { error } from "console";

import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import store from "@/test/unit/helpers/store";

export default defineComponent({
  name: "ImportAlert",
  props: {
    destinations: {
      type: Array,
      default: () => [],
    },
    templates: {
      type: Array,
      default: () => [],
    },
    alerts: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:destinations", "update:templates", "update:alerts"],
  setup(props, { emit }) {
    type ErrorMessage = {
      field: string;
      message: string;
    };
    type alertCreator = {
      message: string;
      success: boolean;
    }[];

    type AlertErrors = (ErrorMessage | string)[][];
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();

    const jsonStr: any = ref("");
    const q = useQuasar();
    const { getStreams } = useStreams();

    const templateErrorsToDisplay = ref([]);

    const destinationErrorsToDisplay = ref([]);

    const alertErrorsToDisplay = ref<AlertErrors>([]);
    const userSelectedDestinations = ref<string[][]>([]);
    const userSelectedAlertName = ref<string[]>([]);

    const tempalteCreators = ref([]);
    const destinationCreators = ref([]);
    const alertCreators = ref<alertCreator>([]);
    const queryEditorPlaceholderFlag = ref(true);
    const streamList = ref<any>([]);
    const userSelectedStreamName = ref<string[]>([]);
    const userSelectedStreamType = ref<string[]>([]);
    const jsonFiles = ref(null);
    const url = ref("");
    const jsonArrayOfObj: any = ref([{}]);
    const streams = ref<any>({});
    const activeTab = ref("import_json_file");
    const splitterModel = ref(60);
    const filteredDestinations = ref<string[]>([]);
    const streamTypes = ["logs", "metrics", "traces"];
    const selectedFolderId = ref<any>(
      router.currentRoute.value.query.folder || "default",
    );
    const activeFolderId = ref(
      router.currentRoute.value.query.folder ||
        router.currentRoute.value.query?.folderId,
    );
    const activeFolderAlerts = ref<any>([]);
    const isAlertImporting = ref(false);
    const userSelectedOrgId = ref<any[]>([]);
    const organizationDataList = computed(() => {
      return store.state.organizations.map((org: any) => {
        return {
          label: org.identifier,
          value: org.identifier,
          disable:
            !org.identifier ||
            org.identifier !== store.state.selectedOrganization.identifier,
        };
      });
    });

    const getFormattedDestinations: any = computed(() => {
      return props.destinations.map((destination: any) => {
        return destination.name;
      });
    });

    const userSelectedTimezone = ref<string[]>([]);

    // @ts-ignore
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
      return tz;
    });
    const filteredTimezone = ref<any>([]);
    filteredTimezone.value = [...timezoneOptions];

    const browserTime =
      "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);

    const updateUserSelectedDestinations = (
      destinations: string[],
      index: number,
    ) => {
      jsonArrayOfObj.value[index].destinations = destinations;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
    };

    const updateStreamFields = (stream_name: string, index: number) => {
      jsonArrayOfObj.value[index].stream_name = stream_name;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
    };

    const updateAlertName = (alertName: string, index: number) => {
      jsonArrayOfObj.value[index].name = alertName;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
    };

    watch(jsonFiles, async (newVal: any, oldVal: any) => {
      if (newVal && newVal.length > 0) {
        let combinedJson: any[] = [];

        for (const file of newVal) {
          try {
            const result: any = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e: any) => {
                try {
                  const parsedJson = JSON.parse(e.target.result);
                  // Convert to array if it's a single object
                  const jsonArray = Array.isArray(parsedJson)
                    ? parsedJson
                    : [parsedJson];
                  resolve(jsonArray);
                } catch (error) {
                  q.notify({
                    message: `Error parsing JSON from file ${file.name}`,
                    color: "negative",
                    position: "bottom",
                    timeout: 2000,
                  });
                  resolve([]);
                }
              };
              reader.readAsText(file);
            });

            combinedJson = [...combinedJson, ...result];
          } catch (error) {
            console.error("Error reading file:", error);
          }
        }

        // Update the refs with combined JSON data
        jsonArrayOfObj.value = combinedJson;
        jsonStr.value = JSON.stringify(combinedJson, null, 2);
      }
    });
    watch(url, async (newVal, oldVal) => {
      try {
        if (newVal) {
          const response = await axios.get(newVal);

          // Check if the response body is valid JSON
          try {
            if (
              response.headers["content-type"].includes("application/json") ||
              response.headers["content-type"].includes("text/plain")
            ) {
              jsonStr.value = JSON.stringify(response.data, null, 2);
              jsonArrayOfObj.value = response.data;
            } else {
              q.notify({
                message: "Invalid JSON format in the URL",
                color: "negative",
                position: "bottom",
                timeout: 2000,
              });
            }
          } catch (parseError) {
            // If parsing fails, display an error message
            q.notify({
              message: "Invalid JSON format",
              color: "negative",
              position: "bottom",
              timeout: 2000,
            });
          }
        }
      } catch (error) {
        q.notify({
          message: "Error fetching data",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
      }
    });

    const tabs = reactive([
      {
        label: "File Upload / JSON",
        value: "import_json_file",
      },
      {
        label: "URL Import",
        value: "import_json_url",
      },
    ]);

    const updateActiveTab = () => {
      jsonStr.value = "";
      jsonFiles.value = null;
      url.value = "";
      jsonArrayOfObj.value = [{}];
    };

    onMounted(() => {
      activeFolderId.value =
        router.currentRoute.value.query?.folder ||
        router.currentRoute.value.query?.folderId;
      getActiveFolderAlerts(activeFolderId.value as string);
    });

    const importJson = async () => {
      alertErrorsToDisplay.value = [];
      templateErrorsToDisplay.value = [];
      destinationErrorsToDisplay.value = [];
      destinationCreators.value = [];
      alertCreators.value = [];

      try {
        // Check if jsonStr.value is empty or null
        if ((!jsonStr.value || jsonStr.value.trim() === "") && !url.value) {
          throw new Error("JSON string is empty");
        } else {
          const parsedJson = JSON.parse(jsonStr.value);
          // Convert single object to array if needed
          jsonArrayOfObj.value = Array.isArray(parsedJson)
            ? parsedJson
            : [parsedJson];
        }
      } catch (e: any) {
        q.notify({
          message: e.message || "Invalid JSON format",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return;
      }

      let allAlertsCreated = true;
      // made the isAlertImporting to true to disable the import button
      // and also added a spinner to the import button
      isAlertImporting.value = true;
      // Now we can always process as an array
      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (!success) {
          allAlertsCreated = false;
        }
      }
      if (allAlertsCreated) {
        q.notify({
          message: "Alert(s) imported successfully",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
        router.push({
          name: "alertList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
            folder: selectedFolderId.value,
          },
        });
      }
      //if the alerts created successfully or not make the isAlertImporting to false
      //it will only enable the import button after the alerts are created successfully
      isAlertImporting.value = false;
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const isValidAlert = await validateAlertInputs(jsonObj, index);
        if (!isValidAlert) {
          return false;
        }

        if (alertErrorsToDisplay.value.length === 0 && isValidAlert) {
          return await createAlert(jsonObj, index, selectedFolderId.value);
        }
      } catch (e: any) {
        console.log(e,'e')
        q.notify({
          message: "Error importing Alert(s) please check the JSON",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return false;
      }
      return false;
    };

    const validateAlertInputs = async (input: any, index: number) => {
      console.log(input,'input')
      let alertErrors: (string | { message: string; field: string })[] = [];

      // 1. Validate 'name' field
      if (
        !input.name ||
        typeof input.name !== "string" ||
        input.name.trim() === ""
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Name is mandatory and should be a valid string.`,
          field: "alert_name",
        });
      }
      const organizationData = store.state.organizations;
      const orgList = organizationData.map((org: any) => org.identifier);

      // 2. Validate 'org_id' field
      if (
        !input.org_id ||
        typeof input.org_id !== "string" ||
        input.org_id.trim() === "" ||
        input.org_id != store.state.selectedOrganization.identifier
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Organization Id is mandatory, should exist in organization list and should be equal to ${store.state.selectedOrganization.identifier}.`,
          field: "org_id",
        });
      }

      // 3. Validate 'stream_type' field
      const validStreamTypes = ["logs", "metrics", "traces"];
      if (!input.stream_type || !validStreamTypes.includes(input.stream_type)) {
        alertErrors.push({
          message: `Alert - ${index}: Stream Type is mandatory and should be one of: 'logs', 'metrics', 'traces'.`,
          field: "stream_type",
        });
      }

      try {
        const streamResponse: any = await getStreams(input.stream_type, false);
        streamList.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (e) {
        alertErrors.push();
        const err: any = {
          message: `Alert - ${index}: Error fetching stream list. Please try again.`,
          field: "stream_list",
        };
        alertErrorsToDisplay.value.push(err);
      }

      // 4. Validate 'stream_name' field
      if (
        !input.stream_name ||
        typeof input.stream_name !== "string" ||
        !streamList.value.includes(input.stream_name)
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Stream Name is mandatory, should exist in the stream list and should be a valid string.`,
          field: "stream_name",
        });
      }

      // 5. Validate 'is_real_time' field
      if (typeof input.is_real_time !== "boolean") {
        alertErrors.push(
          `Alert - ${index}: Is Real-Time is mandatory and should be a boolean value.`,
        );
      }

      // 6. Validate 'query_condition' field
      if (input.query_condition && input.query_condition.conditions) {
        const validateCondition = (condition: any) => {
          // Check if it's a simple condition
          if (condition.column && condition.operator && condition.value !== undefined) {
            if (
              input.query_condition.type === "custom" &&
              !["=", ">", "<", ">=", "<=", "Contains", "NotContains","contains","not_contains"].includes(
                condition.operator,
              )
            ) {
              alertErrors.push(
                `Alert - ${index}: Invalid operator in query condition. Allowed operators: '=', '>', '<', '>=', '<=', 'Contains', 'NotContains'.`,
              );
            }
            return;
          }

          // Check if it's a nested condition with 'and' or 'or'
          if (condition.and || condition.or) {
            const conditions = condition.and || condition.or;
            if (!Array.isArray(conditions)) {
              alertErrors.push(
                `Alert - ${index}: 'and'/'or' conditions must be an array.`,
              );
              return;
            }
            conditions.forEach(validateCondition);
            return;
          }

          // If neither a simple condition nor a nested condition
          alertErrors.push(
            `Alert - ${index}: Invalid condition format. Must have either column/operator/value or and/or operators.`,
          );
        };

        // Handle both array format and nested format
        //because old alerts are having direct array which is and by default 
        //new alerts are having nested conditions with and/or and can have multiple conditions
        if (Array.isArray(input.query_condition.conditions)) {
          // Old format - array of conditions
          input.query_condition.conditions.forEach((condition) => {
            if (!condition.column || !condition.operator || !condition.value) {
              alertErrors.push(
                `Alert - ${index}: Each query condition must have 'column', 'operator', and 'value'.`,
              );
            }
          });
        } else {
          // New format - nested conditions with and/or
          //the new format looks like this
            //             {
            //     "or": [
            //         {
            //             "column": "_timestamp",
            //             "operator": "<=",
            //             "value": "100",
            //             "ignore_case": false
            //         },
            //         {
            //             "column": "job",
            //             "operator": "not_contains",
            //             "value": "12",
            //             "ignore_case": true
            //         },
            //         {
            //             "or": [
            //                 {
            //                     "column": "job",
            //                     "operator": "contains",
            //                     "value": "1222",
            //                     "ignore_case": true
            //                 },
            //                 {
            //                     "column": "level",
            //                     "operator": "not_contains",
            //                     "value": "dsff",
            //                     "ignore_case": true
            //                 },
            //                 {
            //                     "or": [
            //                         {
            //                             "column": "job",
            //                             "operator": "=",
            //                             "value": "111",
            //                             "ignore_case": true
            //                         },
            //                         {
            //                             "column": "level",
            //                             "operator": "contains",
            //                             "value": "1222",
            //                             "ignore_case": true
            //                         }
            //                     ]
            //                 },
            //                 {
            //                     "column": "log",
            //                     "operator": "!=",
            //                     "value": "33",
            //                     "ignore_case": true
            //                 }
            //             ]
            //         }
            //     ]
            // }  
          validateCondition(input.query_condition.conditions);
        }
      }
      // 7. Validate 'sql' and 'promql'
      if (
        input.query_condition.type === "sql" &&
        typeof input.query_condition.sql !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: SQL should be provided when the type is 'sql'.`,
        );
      }

      if (
        input.query_condition.type === "promql" &&
        typeof input.query_condition.promql !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: PromQL should be provided when the type is 'promql'.`,
        );
      }

      // 8. Validate 'vrl_function'
      if (
        input.query_condition.vrl_function &&
        typeof input.query_condition.vrl_function !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: VRL function should be a string or null.`,
        );
      }

      // 9. Validate 'multi_time_range'
      if (
        input.query_condition.type === "custom" &&
        input.query_condition.multi_time_range !== null &&
        (!Array.isArray(input.query_condition.multi_time_range) ||
          input.query_condition.multi_time_range.length > 0)
      ) {
        alertErrors.push(
          `Alert - ${index}: Multi Time Range should be an empty array or null.`,
        );
      }

      // 10. Validate 'trigger_condition'
      const triggerCondition = input.trigger_condition;
      if (!triggerCondition) {
        alertErrors.push(`Alert - ${index}: Trigger Condition is required.`);
      }
      if (
        isNaN(Number(triggerCondition.period)) ||
        triggerCondition.period < 1 ||
        typeof triggerCondition.period !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Period should be a positive number greater than 0 and should be a number.`,
        );
      }

      const validOperators = [
        "=",
        "!=",
        ">=",
        "<=",
        ">",
        "<",
        "Contains",
        "NotContains",
      ];
      if (!validOperators.includes(triggerCondition.operator)) {
        alertErrors.push(
          `Alert - ${index}: Operator should be one of: '=', '!=', '>=', '<=', '>', '<', 'Contains', 'NotContains'.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.frequency)) ||
        triggerCondition.frequency < 1 ||
        typeof triggerCondition.frequency !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Frequency should be a positive number greater than 0 and should be a number.`,
        );
      }

      if (triggerCondition.cron && typeof triggerCondition.cron !== "string") {
        alertErrors.push(
          `Alert - ${index}: Cron expression should be a string.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.threshold)) ||
        triggerCondition.threshold < 1 ||
        typeof triggerCondition.threshold !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Threshold should be a positive number greater than 0 and should be a number.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.silence)) ||
        triggerCondition.silence < 0 ||
        typeof triggerCondition.silence !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Silence should be a positive number greater than or equal to 0 and should be a number.`,
        );
      }

      if (
        (triggerCondition.frequency_type !== "minutes" &&
          triggerCondition.frequency_type !== "cron") ||
        typeof triggerCondition.frequency_type !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: Frequency Type must be 'minutes' or 'cron' and should be a string.`,
        );
      }

      if (
        triggerCondition.frequency_type === "cron" &&
        (triggerCondition.cron.trim() === "" ||
          typeof triggerCondition.cron !== "string")
      ) {
        alertErrors.push(
          `Alert - ${index}: Cron expression should be a valid cron expression.`,
        );
      }

      if (
        !input.destinations ||
        !Array.isArray(input.destinations) ||
        input.destinations.length === 0
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Destinations are required and should be an array.`,
          field: "destination_name",
        });
      }

      if (typeof input.enabled !== "boolean") {
        alertErrors.push(`Alert - ${index}: Enabled should be Boolean.`);
      }

      if (
        input.tz_offset &&
        (typeof input.tz_offset !== "number" || input.tz_offset < 0)
      ) {
        alertErrors.push(
          `Alert - ${index}: Timezone offset should be a number.`,
        );
      }

      if (
        (input.trigger_condition.frequency_type == "cron" &&
          !input.trigger_condition.hasOwnProperty("timezone")) ||
        input.trigger_condition.timezone === ""
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Timezone is required when frequency type is 'cron'.`,
          field: "timezone",
        });
      }

      input.destinations.forEach((destination: any) => {
        if (!checkDestinationInList(props.destinations, destination)) {
          alertErrors.push({
            message: `Alert - ${index}: "${destination}" destination does not exist`,
            field: "destination_name",
          });
        }
      });

      //this condition is added to avoid the error when the updated_at is not a number
      //with the new alert api the updated_at is a nummer
      if (typeof input.updated_at !== "number") {
        input.updated_at = null;
      }

      // Log all alert errors at the end
      if (alertErrors.length > 0) {
        alertErrorsToDisplay.value.push(alertErrors);
        return false;
      }

      return true;
    };

    const checkDestinationInList = (
      destinations: any,
      destinationName: any,
    ) => {
      const destinationsList = destinations.map(
        (destination: any) => destination.name,
      );
      return destinationsList.includes(destinationName);
    };

    const checkAlertsInList = (alerts: any, alertName: any) => {
      return alerts.includes(alertName);
    };

    const createAlert = async (input: any, index: any, folderId: any) => {
      if (!input.hasOwnProperty("context_attributes")) {
        input.context_attributes = {};
      }
      if (!input.trigger_condition.hasOwnProperty("timezone")) {
        input.trigger_condition.timezone = store.state.timezone;
      }
      if (!input.trigger_condition.hasOwnProperty("tolerance_in_secs")) {
        input.trigger_condition.tolerance_in_secs = null;
      }
      input.folder_id = folderId;
      //assigning the owner from the alert payload because the current logged in user will be the owner of the alert
      input.owner = store.state.userInfo.email;
      //assigning the last_edited_by from the alert payload because the current logged in user will be the last_edited_by of the alert
      input.last_edited_by = store.state.userInfo.email;

      try {
        await alertsService.create_by_alert_id(
          store.state.selectedOrganization.identifier,
          input,
          folderId,
        );

        // Success
        alertCreators.value.push({
          message: `Alert - ${index}: "${input.name}" created successfully \nNote: please remove the created alert object ${input.name} from the json file`,
          success: true,
        });
        // Emit update after each successful creation
        emit("update:alerts", store, selectedFolderId.value);
        getActiveFolderAlerts(selectedFolderId.value);
        return true;
      } catch (error: any) {
        // Failure
        alertCreators.value.push({
          message: `Alert - ${index}: "${input.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
          success: false,
        });
        return false;
      }
    };

    const onSubmit = (e: any) => {
      e.preventDefault();
    };
    const updateStreams = async (streamType: string, index: number) => {
      jsonArrayOfObj.value[index].stream_type = streamType;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);

      try {
        const streamResponse: any = await getStreams(streamType, false);
        streamList.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };
    const filterDestinations = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredDestinations.value = getFormattedDestinations.value;
        });
        return;
      }

      update(() => {
        filteredDestinations.value = getFormattedDestinations.value.filter(
          (destination: string) =>
            destination.toLowerCase().includes(val.toLowerCase()),
        );
      });
    };

    const toggleDestination = (destination: string, index: number) => {
      if (!userSelectedDestinations.value[index]) {
        userSelectedDestinations.value[index] = [];
      }

      const destinations = userSelectedDestinations.value[index];
      const destinationIndex = destinations.indexOf(destination);

      if (destinationIndex === -1) {
        destinations.push(destination);
      } else {
        destinations.splice(destinationIndex, 1);
      }

      updateUserSelectedDestinations(destinations, index);
    };

    const updateTimezone = (timezone: string, index: number) => {
      jsonArrayOfObj.value[index].trigger_condition.timezone = timezone;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
    };

    const timezoneFilterFn = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredTimezone.value = timezoneOptions;
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredTimezone.value = timezoneOptions.filter((timezone: string) =>
          timezone.toLowerCase().includes(needle),
        );
      });
    };
    const updateActiveFolderId = (newVal: any) => {
      selectedFolderId.value = newVal.value;
      getActiveFolderAlerts(selectedFolderId.value);
    };

    const getActiveFolderAlerts = async (folderId: string) => {
      if (!store.state.organizationData.allAlertsListByNames[folderId]) {
        const response: any = await alertsService.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier,
          folderId,
          "",
        );

        store.dispatch("setAllAlertsListByNames", {
          ...store.state.organizationData.allAlertsListByNames,
          [folderId]: response.data.list.map((alert: any) => alert.name),
        });
      }
      activeFolderAlerts.value =
        store.state.organizationData.allAlertsListByNames[folderId];
    };
    const updateOrgId = (orgId: string, index: number) => {
      jsonArrayOfObj.value[index].org_id = orgId;
      jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
    };

    return {
      t,
      jsonStr,
      importJson,
      onSubmit,
      router,
      q,
      templateErrorsToDisplay,
      destinationErrorsToDisplay,
      alertErrorsToDisplay,
      tempalteCreators,
      destinationCreators,
      alertCreators,
      queryEditorPlaceholderFlag,
      splitterModel,
      tabs,
      activeTab,
      userSelectedDestinations,
      getFormattedDestinations,
      jsonArrayOfObj,
      streamList,
      userSelectedStreamName,
      updateStreamFields,
      updateAlertName,
      jsonFiles,
      updateActiveTab,
      url,
      userSelectedAlertName,
      streamTypes,
      userSelectedStreamType,
      updateStreams,
      streams,
      filterDestinations,
      filteredDestinations,
      updateUserSelectedDestinations,
      toggleDestination,
      userSelectedTimezone,
      filteredTimezone,
      updateTimezone,
      timezoneFilterFn,
      activeFolderId,
      updateActiveFolderId,
      selectedFolderId,
      getActiveFolderAlerts,
      activeFolderAlerts,
      store,
      isAlertImporting,
      organizationDataList,
      userSelectedOrgId,
      updateOrgId,
    };
  },
  components: {
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    AppTabs,
    SelectFolderDropDown,
  },
});
</script>

<style scoped lang="scss">
.empty-query .monaco-editor-background {
  background-image: url("../../assets/images/common/query-editor.png");
  background-repeat: no-repeat;
  background-size: 115px;
}

.alert-folder-dropdown {
  :deep(.q-field--labeled.showLabelOnTop) {
    padding-top: 12px; /* Example override */
  }
}

.empty-function .monaco-editor-background {
  background-image: url("../../assets/images/common/vrl-function.png");
  background-repeat: no-repeat;
  background-size: 170px;
}
.editor-container {
  height: calc(78vh - 20px) !important;
}
.editor-container-url {
  .monaco-editor {
    height: calc(70vh - 16px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.editor-container-json {
  .monaco-editor {
    height: calc(70vh - 22px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.monaco-editor {
  height: calc(81vh - 14px) !important; /* Total editor height */
  overflow: auto; /* Allows scrolling if content overflows */
  resize: none; /* Remove resize behavior */
}
.error-report-container {
  height: calc(78vh - 24px) !important; /* Total editor height */
  overflow: auto; /* Allows scrolling if content overflows */
  resize: none;
}
.error-container {
  display: flex;
  overflow-y: auto;

  flex-direction: column;
  border: 1px solid #ccc;
  height: calc(100% - 100px) !important; /* Total container height */
}

.error-section {
  padding: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: 16px;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.error-list {
}

.error-item {
  padding: 5px 0px;
  font-size: 14px;
}
.report-list-tabs {
  height: fit-content;

  :deep(.rum-tabs) {
    border: 1px solid #464646;
  }

  :deep(.rum-tab) {
    &:hover {
      background: #464646;
    }

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}
.report-list-tabs {
  height: fit-content;

  :deep(.rum-tabs) {
    border: 1px solid #eaeaea;
    height: fit-content;
    border-radius: 4px;
    overflow: hidden;
  }

  :deep(.rum-tab) {
    width: fit-content !important;
    padding: 4px 12px !important;
    border: none !important;

    &:hover {
      background: #eaeaea;
    }

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}
</style>
