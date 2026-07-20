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
  <div class="mx-2 flex flex-col h-[calc(100vh-var(--navbar-height))] min-h-0 overflow-hidden">
    <AppPageHeader
      :title="t('dashboard.importDashboard')"
      :back="{ label: t('dashboard.header'), onClick: goBack }"
      class="-mx-2 px-4 border-b border-border-default"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          @click="goToCommunityDashboards"
          data-test="dashboard-panel-tutorial-btn"
          >{{ t("dashboard.communityDashboard") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm-action"
          v-close-popup
          data-test="dashboard-import-cancel-btn"
          @click="goBack()"
          >{{ t("function.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          form="import-dashboard-form"
          :loading="!!isLoading"
          data-test="dashboard-import-submit-btn"
          >{{ t("dashboard.import") }}</OButton
        >
      </template>
    </AppPageHeader>
    <div class="flex w-full flex-1 min-h-0">
      <div class="flex w-full min-w-0 min-h-0">
        <OSplitter
          v-model="splitterModel"
          class="w-full min-w-0 h-full min-h-0"
        >
          <template #before>
            <OForm id="import-dashboard-form" :form="form" class="h-full flex flex-col min-h-0">
            <div class="w-full h-full flex flex-col min-h-0">
              <div
                class="card-container py-[0.625rem] pl-[0.625rem] mb-1 shrink-0"
              >
                <div class="app-tabs-container h-[36px] w-fit">
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
                class="editor-container-url card-container py-1 flex-1 min-h-0 flex flex-col"
              >
                <div class="mx-2 mt-1 mb-1 flex flex-col flex-1 min-h-0">
                  <div style="width: calc(100% - 10px)" class="flex gap-2 w-full items-center shrink-0">
                    <div
                      data-test="dashboard-import-url-input"
                      style="width: 69%"
                    >
                      <OFormInput
                        data-test="dashboard-import-url-control"
                        name="url"
                        label="URL"
                        :placeholder="t('dashboard.addURL')"
                      />
                    </div>

                    <div
                      style="width: calc(30%)"
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
                    class="mt-2 flex-1 min-h-0 overflow-hidden resize-none border border-(--o2-border-color) rounded-md"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                  />
                </div>
              </div>
              <div
                v-if="activeTab == 'import_json_file'"
                class="dashboard-import-json-container card-container py-1 flex-1 min-h-0 flex flex-col"
              >
                <div class="mx-2 mt-1 mb-1 flex flex-col flex-1 min-h-0">
                  <div style="width: calc(100% - 10px)" class="flex gap-2 w-full items-center shrink-0">
                    <div
                      data-test="dashboard-import-file-input"
                      style="width: 69%"
                    >
                      <OFormFile
                        data-test="dashboard-import-file-control"
                        name="jsonFiles"
                        :label="t('dashboard.selectFile')"
                        :placeholder="t('dashboard.dropFileMsg')"
                        accept=".json"
                        multiple
                        dropZone
                        :disabled="!!isLoading"
                      />
                    </div>
                    <div
                      style="width: calc(30%)"
                      class="import-folder-dropdown-container"
                    >
                      <select-folder-dropdown
                        @folder-selected="selectedFolder = $event"
                        :activeFolderId="selectedFolder.value"
                      />
                    </div>
                    <div v-if="filesImportResults.length" class="py-2" data-test="dashboard-import-file-results">
                      <div v-for="importResult in filesImportResults">
                        <span
                          v-if="importResult.status == 'rejected'"
                          class="text-red"
                          data-test="dashboard-import-file-rejected"
                        >
                          <code
                            style="background-color: var(--color-surface-panel); padding: 3px"
                            >{{ importResult?.reason?.file }}</code
                          >
                          : {{ importResult?.reason?.error }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <query-editor
                    data-test="dashboard-import-json-file-editor"
                    ref="queryEditorJsonRef"
                    editor-id="dashboards-query-editor-json"
                    class="mt-2 flex-1 min-h-0 overflow-hidden resize-none border border-(--o2-border-color) rounded-md"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                  />
                </div>
              </div>
            </div>
            </OForm>
          </template>
          <template #after>
            <div
              data-test="dashboard-import-error-container"
              class="card-container h-full flex flex-col min-h-0 border-l border-border-default"
            >
              <div class="text-center text-[0.9375rem] font-semibold text-text-primary py-3 shrink-0">{{ t('dashboard.importDashboardPage.errorValidations') }}</div>
              <OSeparator class="mt-1 shrink-0" />
              <div
                class="error-section p-[10px] mb-[10px] flex-1 min-h-0 overflow-auto"
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
                    class="error-item py-[5px] text-sm"
                  >
                    <span
                      v-if="errorMessage.field == 'dashboard_title'"
                      class="text-red"
                      data-test="dashboard-import-error-title-message"
                    >
                      {{ errorMessage.message }}
                      <div
                        style="width: 300px"
                        data-test="dashboard-import-error-title-input"
                      >
                        <OInput
                          data-test="dashboard-import-error-title-control"
                          v-model="dashboardTitles[errorIndex]"
                          :label="t('dashboard.importDashboardPage.dashboardTitle')"
                          @update:model-value="
                            updateDashboardTitle(
                              dashboardTitles[errorIndex],
                              errorMessage.dashboardIndex,
                            )
                          "
                        />
                      </div>
                    </span>
                    <span
                      v-else-if="errorMessage.field == 'stream_type'"
                      class="text-red"
                    >
                      {{ errorMessage.message }}
                      <div style="width: 300px">
                        <OSelect
                          v-model="streamTypes[errorIndex]"
                          :options="streamTypeSelectOptions"
                          :label="t('dashboard.importDashboardPage.streamType')"
                          @update:model-value="
                            updateStreamType(
                              streamTypes[errorIndex],
                              errorMessage.dashboardIndex,
                              errorMessage.tabIndex,
                              errorMessage.panelIndex,
                              errorMessage.queryIndex,
                            )
                          "
                        />
                      </div>
                    </span>

                    <span
                      v-else-if="errorMessage.field == 'dashboard_validation'"
                      class="text-red"
                      data-test="dashboard-import-error-validation-message"
                    >
                      {{ errorMessage.message }}
                    </span>

                    <span
                      v-else
                      data-test="dashboard-import-error-message"
                    >{{
                      errorMessage.message || errorMessage
                    }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </OSplitter>
      </div>
    </div>

    <div></div>
  </div>
</template>
<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  computed,
  onMounted,
  onActivated,
  onDeactivated,
  onUnmounted,
  reactive,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { getAllDashboards, getFoldersList } from "../../utils/commons.js";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import dashboardService from "../../services/dashboards.js";
import axios from "axios";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { validateDashboardJson } from "@/utils/dashboard/panelValidation";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import useNotifications from "@/composables/useNotifications";
import AppTabs from "@/components/common/AppTabs.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormFile from "@/lib/forms/File/OFormFile.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeImportDashboardSchema,
  importDashboardDefaults,
} from "./ImportDashboard.schema";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { defineAsyncComponent } from "vue";
const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
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
          (item: any) => item.folderId === (route.query.folder ?? "default"),
        )?.name ?? "default",
      value: route.query.folder,
    });

    // Monaco editor content (a non-OForm* code editor, bridged at @submit).
    // url + jsonFiles are form-owned and read below via form.useStore.
    const jsonStr = ref("");

    const tabs = reactive([
      {
        label: t("dashboard.importDashboardPage.fileUploadJson"),
        value: "import_json_file",
        icon: "upload",
      },
      {
        label: t("dashboard.importDashboardPage.urlImport"),
        value: "import_json_url",
        icon: "link",
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
    const streamTypeSelectOptions = streamTypeOptions.map((t) => ({ label: t, value: t }));
    // import type values
    const ImportType = {
      FILES: "files",
      URL: "url",
      JSON_STRING: "json_string",
    };

    // store the results of the import (for files)
    const filesImportResults = ref([]);

    // OWNER pattern (rule ③): the page owns <OForm> (url + jsonFiles) and the
    // fetch/parse watchers + import logic read those values, so it creates the
    // form with useOForm and reads it via form.useStore — ONE source, no mirror.
    // url/jsonFiles are name=-owned; every write goes through setFormField. The
    // deep JSON validation + recovery inputs + the Monaco editor stay outside the
    // form (documented no-OForm* exceptions).
    const form = useOForm({
      defaultValues: importDashboardDefaults(),
      schema: makeImportDashboardSchema(t),
      // forward to importDashboard defined below (avoids a TDZ ref at setup time)
      onSubmit: () => importDashboard(),
    });
    const setFormField = (name: string, val: unknown) =>
      form.setFieldValue(name, val);
    const url = form.useStore((s: any) => s.values?.url ?? "");
    const jsonFiles = form.useStore((s: any) => s.values?.jsonFiles);

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
          showErrorNotification(t("dashboard.importDashboardPage.invalidJsonFormat"));
        }
      }
      if (newVal == "") {
        setFormField("jsonFiles", null);
        setFormField("url", "");
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
              showErrorNotification(t("dashboard.importDashboardPage.invalidJsonFormatUrl"));
            }
          } catch (parseError) {
            // If parsing fails, display an error message
            showErrorNotification(t("dashboard.importDashboardPage.invalidJsonFormat"));
          }
        }
      } catch (error) {
        showErrorNotification(t("dashboard.importDashboardPage.errorFetchingData"));
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
        showErrorNotification(t("dashboard.importDashboardPage.noJsonFilesSelected"));
        isLoading.value = false;
        return;
      }

      isLoading.value = ImportType.FILES;

      try {
        jsonStr.value = JSON.parse(jsonStr.value);
      } catch (e) {
        showErrorNotification(t("dashboard.importDashboardPage.invalidJsonContent"));
        isLoading.value = false;
        return;
      }

      const data = jsonStr.value.map((parsedContent, fileIndex) => {
        return new Promise(async (resolve, reject) => {
          const fileName =
            jsonFiles.value[fileIndex]?.name ||
            t("dashboard.importDashboardPage.fileFallback", { n: fileIndex + 1 });

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
                file: t("dashboard.importDashboardPage.jsonFileLabel", { n: fileIndex + 1 }),
                error: failedMessages.join("; "),
              });
            } else {
              resolve({ file: fileName, results });
            }
          } catch (e) {
            reject({ file: fileName, error: t("dashboard.importDashboardPage.errorProcessingFile") });
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
            t("dashboard.importDashboardPage.filesImportedSuccessfully", { n: successfulImports }),
          );
        }

        const failedImports = results.length - successfulImports;
        if (failedImports) {
          showErrorNotification(t("dashboard.importDashboardPage.filesFailedToImport", { n: failedImports }));
        }

        isLoading.value = false;
      });
    };

    // reset and refresh the value based on selected type
    const resetAndRefresh = async (type, selectedFolder) => {
      switch (type) {
        case ImportType.FILES:
          setFormField("jsonFiles", null);
          jsonStr.value = "";
          isLoading.value = false;
          break;
        case ImportType.URL:
          setFormField("url", "");
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
          showErrorNotification(t("dashboard.importDashboardPage.pleaseEnterUrl"));
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
            t("dashboard.importDashboardPage.dashboardsImportedSuccessfully", { n: successCount }),
          );
        }

        if (failedCount > 0) {
          showErrorNotification(t("dashboard.importDashboardPage.dashboardsFailedToImport", { n: failedCount }));
        }

        filesImportResults.value = results;
      } catch (error) {
        showErrorNotification(t("dashboard.importDashboardPage.failedToImportDashboard"));
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
          showErrorNotification(t("dashboard.importDashboardPage.validationFailed", { error: errorMessage }));
          return;
        }

        await importDashboardFromJSON(
          convertedSchema,
          selectedFolder.value,
        ).then((res) => {
          resetAndRefresh(ImportType.JSON_STRING, selectedFolder.value);
          filesImportResults.value = [];
          jsonStr.value = "";

          showPositiveNotification(t("dashboard.importDashboardPage.dashboardImportedSuccessfully"));
        });
      } catch (error) {
        showErrorNotification(t("dashboard.importDashboardPage.pleaseEnterJsonObject"));
      } finally {
        isLoading.value = false;
      }
    };

    // back button to render dashboard List page
    const goBack = () => {
      setFormField("jsonFiles", []);
      setFormField("url", "");
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
      setFormField("jsonFiles", null);
      setFormField("url", "");
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
        showErrorNotification(t("dashboard.importDashboardPage.failedToImportDashboard"));
      }
    };
    const validateBasicInputs = (input, index = 0) => {
      // Basic title validation
      if (input.title === "" || typeof input.title !== "string") {
        dashboardErrorsToDisplay.value.push({
          message: t("dashboard.importDashboardPage.titleRequired", { index: index ? index + 1 : 1 }),
          field: "dashboard_title",
          dashboardIndex: index,
        });
      }

      // Comprehensive dashboard validation using validateDashboardJson
      const validationErrors = validateDashboardJson(input);
      if (validationErrors.length > 0) {
        validationErrors.forEach((error) => {
          dashboardErrorsToDisplay.value.push({
            message: t("dashboard.importDashboardPage.dashboardValidationError", { index: index ? index + 1 : 1, error }),
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
      streamTypeSelectOptions,
      dashboardTitles,
      streamTypes,
      form,
    };
  },
  components: { OSeparator, SelectFolderDropdown, AppTabs, AppPageHeader, QueryEditor, OButton, OInput, OSelect,
    OForm, OFormInput, OFormFile,
    OIcon, OSplitter,
},
});
</script>

<style>
.editor-container-url .monaco-editor {
  height: calc(100vh - 285px) !important;
  overflow: hidden;
  resize: none;
}
.dashboard-import-json-container .monaco-editor {
  height: calc(100vh - 282px) !important;
  overflow: hidden;
  resize: none;
}
.import-folder-dropdown-container .add-folder-btn {
  margin-bottom: 0 !important;
  margin-top: 12px !important;
}
</style>
