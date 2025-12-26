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
  <div class="q-mx-sm q-pt-xs">
    <div class="card-container tw:mb-[0.625rem]">
      <div class="flex tw:px-4 items-center no-wrap tw:h-[68px]">
      <div class="col">
        <div class="flex">
          <q-btn
            no-caps
            padding="xs"
            outline
            @click="goBack()"
            icon="arrow_back_ios_new"
            class="el-border"
          />
          <div class="text-h6 q-ml-md">
            {{ t("dashboard.importDashboard") }}
          </div>
        </div>
      </div>
      <div class="flex justify-center">
        <q-btn
          class="q-mr-md o2-secondary-button"
          no-caps
          :label="t('dashboard.communityDashboard')"
          @click="goToCommunityDashboards"
          data-test="dashboard-panel-tutorial-btn"
        ></q-btn>
        <q-btn
          v-close-popup
          class="text-bold q-mr-md o2-secondary-button"
          :label="t('function.cancel')"
          no-caps
          @click="goBack()"
        />
        <q-btn
          :disable="!!isLoading"
          class="text-bold o2-primary-button"
          :label="t('dashboard.import')"
          type="submit"
          no-caps
          @click="importDashboard"
        />
      </div>
    </div>
    </div>
    <div class="flex">

      <div class="flex">
        <q-splitter
          no-scroll
          v-model="splitterModel"
          :limits="[40, 80]"
          style="width: calc(100vw - 100px);"
        >
          <template #before>
          <div class="tw:w-full tw:h-full ">
            <div class="card-container tw:py-[0.625rem] tw:pl-[0.625rem] tw:mb-[0.625rem]">
              <div class="app-tabs-container tw:h-[36px] tw:w-fit">
            <app-tabs
                data-test="dashboard-import-type-tabs"
                class="tabs-selection-container"
                :tabs="tabs"
                v-model:active-tab="activeTab"
                @update:active-tab="updateActiveTab"
              />
              </div>
              </div>
            <div
              v-if="activeTab == 'import_json_url'"
              class="editor-container-url card-container tw:py-1"
            >
              <q-form class="tw:mx-2 q-mt-md tw:pb-2" @submit="onSubmit">
                <div
                  style="width: calc(100% - 10px)"
                  class="flex full-width"
                >
                  <div
                    data-test="dashboard-import-url-input"
                    style="width: 69%"
                    class="q-pr-sm"
                  >
                    <q-input
                      v-model="url"
                      :label="t('dashboard.addURL')"
                       style="padding: 10px;"
                      stack-label
                      label-slot
                      :loading="isLoading == ImportType.URL"
                     borderless hide-bottom-space/>
                  </div>

                  <div
                    style="width: calc(30%);position: relative;"
                    data-test="dashboard-folder-dropdown"
                    class="import-folder-dropdown-container"
                  >
                    <select-folder-dropdown
                      @folder-selected="selectedFolder = $event"
                      :activeFolderId="selectedFolder.value"
                    />
                  </div>
                </div>
                <query-editor
                  data-test="dashboard-import-url-editor"
                  ref="queryEditorFileRef"
                  editor-id="dashboards-query-editor-file"
                  class="monaco-editor tw:mx-2"
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
              </q-form>
            </div>
            <div
              v-if="activeTab == 'import_json_file'"
              class="dashboard-import-json-container card-container tw:py-1"
            >
              <q-form class="tw:mx-2 q-mt-md tw:pb-2" @submit="onSubmit">
                <div
                  style="width: calc(100% - 10px)"
                  class="flex full-width"
                >
                  <div
                    data-test="dashboard-import-file-input"
                    style="width: 69%"
                    class="q-pr-sm"
                  >
                    <q-file
                      v-model="jsonFiles"
                      bottom-slots
                      :label="t('dashboard.dropFileMsg')"
                      accept=".json"
                      multiple
                      filled
                      :disable="!!isLoading"
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
                  <div
                    style="width: calc(30%);position: relative;"
                    class="import-folder-dropdown-container"
                  >
                    <select-folder-dropdown
                      @folder-selected="selectedFolder = $event"
                      :activeFolderId="selectedFolder.value"
                    />
                  </div>
                  <div v-if="filesImportResults.length" class="q-py-sm">
                    <div v-for="importResult in filesImportResults">
                      <span
                        v-if="importResult.status == 'rejected'"
                        class="text-red"
                      >
                        <code style="background-color: #f2f1f1; padding: 3px">{{
                          importResult?.reason?.file
                        }}</code>
                        : {{ importResult?.reason?.error }}
                      </span>
                    </div>
                  </div>
                </div>
                <query-editor
                  data-test="dashboard-import-json-file-editor"
                  ref="queryEditorJsonRef"
                  editor-id="dashboards-query-editor-json"
                  class="monaco-editor tw:mx-2"
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
            </div>
          </template>
          <template #after>
            <div
              data-test="dashboard-import-error-container"
              class="card-container tw:mb-[0.625rem] tw:h-[calc(100vh-130px)]"
            >
              <div  class="text-center text-h6 tw:py-2">Error Validations</div>
              <q-separator class="q-mt-md" />
              <div
                class="error-section"
                v-if="dashboardErrorsToDisplay.length > 0"
              >
                <div class="error-reporter-container">
                  <!-- Iterate through the outer array -->

                  <!-- Iterate through each inner array (the individual error message) -->
                  <div
                    v-for="(
                      errorMessage, errorIndex
                    ) in dashboardErrorsToDisplay"
                    :key="errorIndex"
                    class="error-item"
                  >
                    <span
                      v-if="errorMessage.field == 'dashboard_title'"
                      class="text-red"
                    >
                      {{ errorMessage.message }}
                      <div style="width: 300px">
                        <q-input
                          v-model="dashboardTitles[errorIndex]"
                          :label="'Dashboard Title'"
                          color="input-border"
                          bg-color="input-bg"
                          class="showLabelOnTop"
                          stack-label
                          dense
                          tabindex="0"
                          @update:model-value="
                            updateDashboardTitle(
                              dashboardTitles[errorIndex],
                              errorMessage.dashboardIndex,
                            )
                          "
                         borderless hide-bottom-space/>
                      </div>
                    </span>
                    <span
                      v-else-if="errorMessage.field == 'stream_type'"
                      class="text-red"
                    >
                      {{ errorMessage.message }}
                      <div style="width: 300px">
                        <q-select
                          v-model="streamTypes[errorIndex]"
                          :options="streamTypeOptions"
                          :label="'Stream Type'"
                          :popup-content-style="{
                            textTransform: 'lowercase',
                          }"
                          color="input-border"
                          bg-color="input-bg"
                          class="q-py-sm showLabelOnTop no-case"
                          stack-label
                          dense
                          use-input
                          hide-selected
                          fill-input
                          :input-debounce="400"
                          @update:model-value="
                            updateStreamType(
                              streamTypes[errorIndex],
                              errorMessage.dashboardIndex,
                              errorMessage.tabIndex,
                              errorMessage.panelIndex,
                              errorMessage.queryIndex,
                            )
                          "
                          behavior="menu"
                         borderless hide-bottom-space/>
                      </div>
                    </span>

                    <span
                      v-else-if="errorMessage.field == 'dashboard_validation'"
                      class="text-red"
                    >
                      {{ errorMessage.message }}
                    </span>

                    <span v-else>{{
                      errorMessage.message || errorMessage
                    }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>

    <div></div>
  </div>
</template>
<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onMounted, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getAllDashboards, getFoldersList } from "../../utils/commons.js";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import dashboardService from "../../services/dashboards.js";
import axios from "axios";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { validateDashboardJson } from "@/utils/dashboard/convertDataIntoUnitValue";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import useNotifications from "@/composables/useNotifications";
import AppTabs from "@/components/common/AppTabs.vue";
import QueryEditor from "@/components/CodeQueryEditor.vue";
import stream from "@/services/stream.js";
export default defineComponent({
  name: "Import Dashboard",
  props: ["dashboardId"],
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const { showPositiveNotification, showErrorNotification } =
      useNotifications();
    const selectedFolder = ref({
      label:
        store.state.organizationData.folders.find(
          (item: any) => item.folderId === route.query.folder ?? "default",
        )?.name ?? "default",
      value: route.query.folder,
    });

    // hold the values of 3 supported import types
    const jsonFiles = ref<any>();
    const url = ref("");
    const jsonStr = ref("");

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
    const activeTab = ref("import_json_file");

    const dashboardErrorsToDisplay = ref([]);
    const splitterModel = ref(60);

    // holds the value of the loading for any of the import type
    const isLoading = ref(false);
    const queryEditorPlaceholderFlag = ref(true);
    const dashboardTitles = reactive({});
    const streamTypes = reactive({});
    const streamTypeOptions = ["logs", "metrics", "traces"];
    // import type values
    const ImportType = {
      FILES: "files",
      URL: "url",
      JSON_STRING: "json_string",
    };

    // store the results of the import (for files)
    const filesImportResults = ref([]);

    onMounted(async () => {
      filesImportResults.value = [];
      await getFoldersList(store);
      selectedFolder.value = {
        label:
          store.state.organizationData.folders.find(
            (item: any) => item.folderId === (route.query.folder ?? "default"),
          )?.name ?? "default",
        value: route.query.folder,
      };
    });

    watch(jsonFiles, (newVal) => {
      if (newVal && newVal.length > 0) {
        const fileContents = []; // Array to store parsed JSON objects

        newVal.forEach((file) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const jsonObject = JSON.parse(e.target.result);
              // If the parsed object is an array, flatten it
              if (Array.isArray(jsonObject)) {
                fileContents.push(...jsonObject); // spread into fileContents
              } else {
                fileContents.push(jsonObject);
              }

              // Check if all files have been processed
              if (fileContents.length >= newVal.length) {
                jsonStr.value = JSON.stringify(fileContents, null, 2);
              }
            } catch (error) {
              console.error("Error parsing JSON:", error);
            }
          };
          reader.readAsText(file);
        });
      }
    });

    watch(jsonStr, (newVal) => {
      if (newVal) {
        try {
          // If newVal is an object, stringify it directly
          if (typeof newVal === "object") {
            jsonStr.value = JSON.stringify(newVal, null, 2);
          } else if (typeof newVal === "string") {
            // Only parse it if it's a string
            const jsonObject = JSON.parse(newVal);
            jsonStr.value = JSON.stringify(jsonObject, null, 2);
          }
        } catch (error) {
          showErrorNotification("Invalid JSON format");
        }
      }
      if (newVal == "") {
        jsonFiles.value = null;
        url.value = "";
      }
    });

    watch(url, async (newVal) => {
      try {
        if (newVal) {
          const urlObj = new URL(newVal);
          if (!["http:", "https:"].includes(urlObj.protocol)) {
            throw new Error("Only HTTP(S) URLs are allowed");
          }
          const response = await axios.get(newVal, {
            timeout: 5000,
            headers: {
              Accept: "application/json,text/plain",
            },
          });

          // Check if the response body is valid JSON
          try {
            if (
              response.headers["content-type"].includes("application/json") ||
              response.headers["content-type"].includes("text/plain")
            ) {
              jsonStr.value = JSON.stringify(response.data, null, 2);
            } else {
              showErrorNotification("Invalid JSON format in the URL");
            }
          } catch (parseError) {
            // If parsing fails, display an error message
            showErrorNotification("Invalid JSON format");
          }
        }
      } catch (error) {
        showErrorNotification("Error fetching data");
      }
    });

    //import dashboard from the json
    const importDashboardFromJSON = async (
      jsonObj: any,
      selectedFolder: any,
    ) => {
      const data =
        typeof jsonObj == "string"
          ? JSON.parse(jsonObj)
          : typeof jsonObj == "object"
            ? jsonObj
            : jsonObj;

      //set owner name and creator name to import dashboard
      data.owner = store.state.userInfo.name;
      data.created = new Date().toISOString();

      //create new dashboard
      const newDashboard = await dashboardService.create(
        store.state.selectedOrganization.identifier,
        data,
        selectedFolder.value,
      );

      //update store
      await getAllDashboards(store, selectedFolder.value);

      //return new dashboard
      return newDashboard;
    };

    // import multiple files
    const importFiles = async () => {
      if (!jsonStr.value || !jsonStr.value.length) {
        showErrorNotification("No JSON file(s) selected for import");
        isLoading.value = false;
        return;
      }

      isLoading.value = ImportType.FILES;

      try {
        jsonStr.value = JSON.parse(jsonStr.value);
      } catch (e) {
        showErrorNotification("Invalid JSON content");
        isLoading.value = false;
        return;
      }

      const data = jsonStr.value.map((parsedContent, fileIndex) => {
        return new Promise(async (resolve, reject) => {
          const fileName =
            jsonFiles.value[fileIndex]?.name || `File ${fileIndex + 1}`;

          try {
            //this is done because if the user uploads a single dashboard, it will be an object and if the user uploads multiple dashboards, it will be an array of objects
            //to support both the cases, we are using this condition\
            //Example: if user uploads a single object file it will be converted to an array and if user uploads a array of objects it is already an array so we dont do anything
            const dashboards = Array.isArray(parsedContent)
              ? parsedContent
              : [parsedContent];

            const results = [];

            for (let i = 0; i < dashboards.length; i++) {
              const dashboard = dashboards[i];
              //this is the core logic to convert the dashboard schema version
              //it will convert the dashboard schema version to the latest version

              try {
                const convertedSchema =
                  convertDashboardSchemaVersion(dashboard);

                // Validate the converted schema before importing
                const validationErrors = validateDashboardJson(convertedSchema);
                if (validationErrors.length > 0) {
                  const errorMessage = validationErrors.join("; ");
                  results.push({
                    index: i + 1,
                    error: new Error(errorMessage),
                  });
                  continue;
                }

                const res = await importDashboardFromJSON(
                  convertedSchema,
                  selectedFolder.value,
                );
                results.push({ index: i + 1, result: res });
              } catch (e) {
                results.push({ index: i + 1, error: e });
              }
            }

            const failedMessages = results
              .filter((r) => r.error)
              .map((r) => `${r.error?.message || r.error}`);

            if (failedMessages.length) {
              reject({
                file: `JSON ${fileIndex + 1}`,
                error: failedMessages.join("; "),
              });
            } else {
              resolve({ file: fileName, results });
            }
          } catch (e) {
            reject({ file: fileName, error: "Error processing file" });
          }
        });
      });

      Promise.allSettled(data).then(async (results) => {
        filesImportResults.value = results;

        const successfulImports = results.filter(
          (r) => r.status === "fulfilled",
        ).length;

        if (results.length === successfulImports) {
          await resetAndRefresh(ImportType.FILES, selectedFolder.value);
        }

        if (successfulImports) {
          showPositiveNotification(
            `${successfulImports} File(s) Imported Successfully`,
          );
        }

        const failedImports = results.length - successfulImports;
        if (failedImports) {
          showErrorNotification(`${failedImports} File(s) Failed to Import`);
        }

        isLoading.value = false;
      });
    };

    // reset and refresh the value based on selected type
    const resetAndRefresh = async (type, selectedFolder) => {
      switch (type) {
        case ImportType.FILES:
          jsonFiles.value = null;
          jsonStr.value = "";
          isLoading.value = false;
          break;
        case ImportType.URL:
          url.value = "";
          isLoading.value = false;
          break;
        case ImportType.JSON_STRING:
          jsonStr.value = "";
          isLoading.value = false;
          break;
        default:
          break;
      }

      return router.push({
        path: "/dashboards",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: selectedFolder.value,
        },
      });
    };

    //import dashboard from url
    const importFromUrl = async () => {
      isLoading.value = ImportType.URL;
      try {
        const urlData = url.value.trim();

        if (!urlData && !jsonStr.value) {
          showErrorNotification("Please Enter a URL for import");
          return;
        }

        //this is used to convert the json string to an array of objects
        //so that we can use the same logic to import the dashboard
        //Example: if user uploads a single object file it will be converted to an array and if user uploads a array of objects it is already an array so we dont do anything
        const rawJson = JSON.parse(jsonStr.value);
        const dashboards = Array.isArray(rawJson) ? rawJson : [rawJson];

        const importPromises = dashboards.map((dashboard, index) => {
          try {
            const converted = convertDashboardSchemaVersion(dashboard);

            // Validate the converted schema before importing
            const validationErrors = validateDashboardJson(converted);
            if (validationErrors.length > 0) {
              const errorMessage = validationErrors.join("; ");
              return Promise.reject({ index, error: new Error(errorMessage) });
            }

            return importDashboardFromJSON(converted, selectedFolder.value);
          } catch (e) {
            return Promise.reject({ index, error: e });
          }
        });

        const results = await Promise.allSettled(importPromises);

        const successCount = results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        const failedCount = results.length - successCount;

        if (successCount > 0) {
          await resetAndRefresh(ImportType.URL, selectedFolder.value);
          showPositiveNotification(
            `${successCount} Dashboard(s) Imported Successfully`,
          );
        }

        if (failedCount > 0) {
          showErrorNotification(`${failedCount} Dashboard(s) Failed to Import`);
        }

        filesImportResults.value = results;
      } catch (error) {
        showErrorNotification("Failed to Import Dashboard");
      } finally {
        if (jsonStr.value && typeof jsonStr.value !== "string") {
          jsonStr.value = "";
        }
        isLoading.value = false;
      }
    };

    // import dashboard from json string
    const importFromJsonStr = async () => {
      isLoading.value = ImportType.JSON_STRING;
      try {
        // get the dashboard

        const oldImportedSchema = JSON.parse(jsonStr.value);
        const convertedSchema =
          convertDashboardSchemaVersion(oldImportedSchema);

        // Validate the converted schema before importing
        const validationErrors = validateDashboardJson(convertedSchema);
        if (validationErrors.length > 0) {
          const errorMessage = validationErrors.join("; ");
          showErrorNotification(`Validation failed: ${errorMessage}`);
          return;
        }

        await importDashboardFromJSON(
          convertedSchema,
          selectedFolder.value,
        ).then((res) => {
          resetAndRefresh(ImportType.JSON_STRING, selectedFolder.value);
          filesImportResults.value = [];
          jsonStr.value = "";

          showPositiveNotification(`Dashboard Imported Successfully`);
        });
      } catch (error) {
        showErrorNotification("Please Enter a JSON object for import");
      } finally {
        isLoading.value = false;
      }
    };

    // back button to render dashboard List page
    const goBack = () => {
      jsonFiles.value = [];
      url.value = "";
      jsonStr.value = "";
      filesImportResults.value = [];
      return router.push({
        path: "/dashboards",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: route?.query?.folder || "default",
        },
      });
    };
    const updateActiveTab = () => {
      jsonStr.value = "";
      jsonFiles.value = null;
      url.value = "";
    };
    const importDashboard = () => {
      try {
        dashboardErrorsToDisplay.value = [];
        const jsonObj = JSON.parse(jsonStr.value);
        if (Array.isArray(jsonObj)) {
          jsonObj.forEach((input, index) => {
            // migrate to new schema
            const convertedSchema = convertDashboardSchemaVersion(input);
            validateBasicInputs(convertedSchema, index);
          });
        } else {
          // migrate to new schema
          const convertedSchema = convertDashboardSchemaVersion(jsonObj);
          validateBasicInputs(convertedSchema);
        }
        if (dashboardErrorsToDisplay.value.length > 0) {
          return;
        }
        if (activeTab.value === "import_json_file") {
          if (jsonFiles.value == undefined) {
            importFromJsonStr();
          } else {
            importFiles();
          }
        } else {
          importFromUrl();
        }
      } catch (e) {
        showErrorNotification("Failed to Import Dashboard");
      }
    };
    const validateBasicInputs = (input, index = 0) => {
      // Basic title validation
      if (input.title === "" || typeof input.title !== "string") {
        dashboardErrorsToDisplay.value.push({
          message: `Title is required for dashboard - ${index ? index + 1 : 1}  and should be a string`,
          field: "dashboard_title",
          dashboardIndex: index,
        });
      }

      // Comprehensive dashboard validation using validateDashboardJson
      const validationErrors = validateDashboardJson(input);
      if (validationErrors.length > 0) {
        validationErrors.forEach((error) => {
          dashboardErrorsToDisplay.value.push({
            message: `Dashboard ${index ? index + 1 : 1}: ${error}`,
            field: "dashboard_validation",
            dashboardIndex: index,
          });
        });
      }
    };

    const goToCommunityDashboards = () => {
      window.open("https://github.com/openobserve/dashboards", "_blank");
    };
    const updateDashboardTitle = (selectedDashboard, dashboardIndex) => {
      const jsonObj = JSON.parse(jsonStr.value);
      if (Array.isArray(jsonObj)) {
        jsonObj[dashboardIndex].title = selectedDashboard;
      } else {
        jsonObj.title = selectedDashboard;
      }
      jsonStr.value = JSON.stringify(jsonObj, null, 2);
    };
    const updateStreamType = (
      selectedStreamType,
      dashboardIndex,
      tabIndex,
      panelIndex,
      queryIndex,
    ) => {
      const jsonObj = JSON.parse(jsonStr.value);
      if (Array.isArray(jsonObj)) {
        jsonObj[dashboardIndex].tabs[tabIndex].panels[panelIndex].queries[
          queryIndex
        ].fields.stream_type = selectedStreamType;
      } else {
        jsonObj.tabs[tabIndex].panels[panelIndex].queries[
          queryIndex
        ].fields.stream_type = selectedStreamType;
      }
      jsonStr.value = JSON.stringify(jsonObj, null, 2);
    };
    const onSubmit = () => {
      // do nothing here
    };

    return {
      t,
      goBack,
      onSubmit,
      importFiles,
      jsonFiles,
      importFromUrl,
      url,
      jsonStr,
      importFromJsonStr,
      isLoading,
      ImportType,
      filesImportResults,
      route,
      selectedFolder,
      tabs,
      activeTab,
      dashboardErrorsToDisplay,
      splitterModel,
      updateActiveTab,
      queryEditorPlaceholderFlag,
      importDashboard,
      goToCommunityDashboards,
      updateDashboardTitle,
      updateStreamType,
      streamTypeOptions,
      dashboardTitles,
      streamTypes,
    };
  },
  components: { SelectFolderDropdown, AppTabs, QueryEditor },
});
</script>

<style scoped lang="scss">
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
.editor-container {
  height: calc(80vh - 20px) !important;
}
.editor-container-url {
  .monaco-editor {
    height: calc(100vh - 310px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.dashboard-import-json-container {
  .monaco-editor {
    height: calc(100vh - 310px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.monaco-editor {
  height: calc(81vh - 14px) !important; /* Total editor height */
  overflow: auto; /* Allows scrolling if content overflows */
  resize: none; /* Remove resize behavior */
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
}
.error-report-container {
  height: calc(100vh - 8px) !important; /* Total editor height */
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
.dashboard-import-type-tabs {
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
.dashboard-import-type-tabs {
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
.dashboard-folder-dropdown {
  :deep(.q-field--labeled.showLabelOnTop) {
    padding-top: 12px; /* Example override */
  }
}
.dashboard-folder-dropdown {
  :deep(
      .q-field--labeled.showLabelOnTop.q-select
        .q-field__control-container
        .q-field__native
    )
    > :first-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
.import-folder-dropdown-container {
  :deep(.q-field) {
    padding-top: 10px;
  }
  :deep(.flex) {
    align-items: center !important;
  }
  :deep(.add-folder-btn) {
    margin-bottom: 0 !important;
    margin-top: 12px !important;
  }
}
</style>
