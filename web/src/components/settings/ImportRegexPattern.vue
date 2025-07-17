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
              @click="arrowBackFn"
              icon="arrow_back_ios_new"
              data-test="regex-pattern-import-back-btn"
            />
            <div class="text-h6 q-ml-md">{{ t('regex_patterns.import_title') }}</div>
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
            @click="arrowBackFn"
            data-test="regex-pattern-import-cancel-btn"
          />
          <q-btn
            class="text-bold no-border"
            :label="t('dashboard.import')"
            color="secondary"
            type="submit"
            padding="sm xl"
            no-caps
            @click="importJson"
            data-test="regex-pattern-import-json-btn"
          />
        </div>
      </div>
  
      <q-separator class="q-my-sm q-mx-md" />
    </div>
    <div class="flex">
      <div class="report-list-tabs flex items-center justify-center q-mx-md">
        <app-tabs
          data-test="regex-pattern-import-tabs"
          class="q-mr-md"
          :tabs="tabs"
          v-model:active-tab="activeTab"
          @update:active-tab="updateActiveTab"
        />
      </div>
  
      <div class="flex" style="width: 100%">
        <q-splitter
          class="logs-search-splitter"
          no-scroll
          v-model="splitterModel"
          :style="{
            width: '100%',
            height: '100%',
          }"
        >
          <template #before>
            <div
              v-if="activeTab == 'import_json_url'"
              class="editor-container-url"
            >
              <q-form class="q-mx-md q-mt-md" @submit="onSubmit">
                <div style="width: 100%" class="q-mb-md">
                  <q-input
                    v-model="url"
                    :label="t('dashboard.addURL')"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    filled
                    label-slot
                    data-test="regex-pattern-import-url-input"
                  />
                </div>
                <query-editor
                  data-test="regex-pattern-import-sql-editor"
                  ref="queryEditorRef"
                  editor-id="regex-pattern-import-query-editor"
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
                <div style="width: 100%" class="q-mb-md">
                  <q-file
                    v-model="jsonFiles"
                    filled
                    bottom-slots
                    :label="t('dashboard.dropFileMsg')"
                    accept=".json"
                    multiple
                    data-test="regex-pattern-import-file-input"
                  >
                    <template v-slot:prepend>
                      <q-icon name="cloud_upload" @click.stop.prevent />
                    </template>
                    <template v-slot:append>
                      <q-icon
                        name="close"
                        @click.stop.prevent="jsonFiles = null"
                        class="cursor-pointer"
                        data-test="regex-pattern-import-file-close-btn"
                      />
                    </template>
                    <template v-slot:hint> .json files only </template>
                  </q-file>
                </div>
                <query-editor
                  data-test="regex-pattern-import-sql-editor"
                  ref="queryEditorRef"
                  editor-id="regex-pattern-import-query-editor"
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
              data-test="regex-pattern-import-output-editor"
              style="width: 100%; height: 100%"
            >
              <div
                v-if="regexPatternErrorsToDisplay.length > 0"
                class="text-center text-h6"
              >
                Error Validations
              </div>
              <div v-else class="text-center text-h6">Output Messages</div>
              <q-separator class="q-mx-md q-mt-md" />
              <div class="error-report-container">
                <!-- Regex Pattern Errors Section -->
                <div
                  class="error-section"
                  v-if="regexPatternErrorsToDisplay.length > 0"
                >
                  <div class="error-list">
                    <!-- Iterate through the outer array -->
                    <div
                      v-for="(errorGroup, index) in regexPatternErrorsToDisplay"
                      :key="index"
                    >
                      <!-- Iterate through each inner array (the individual error message) -->
                      <div
                        v-for="(errorMessage, errorIndex) in errorGroup"
                        :key="errorIndex"
                        class="error-item"
                        :data-test="`regex-pattern-import-error-${index}-${errorIndex}`"
                      >
                        <span
                          data-test="regex-pattern-import-name-error"
                          class="text-red"
                          v-if="
                            typeof errorMessage === 'object' &&
                            errorMessage.field == 'regex_pattern_name'
                          "
                        >
                          {{ errorMessage.message }}
                          <!-- name is required so we need to show the input field -->
                          <div style="width: 300px">
                            <q-input
                              data-test="regex-pattern-import-name-input"
                              v-model="userSelectedRegexPatternName[index]"
                              :label="'Regex Pattern Name *'"
                              color="input-border"
                              bg-color="input-bg"
                              class="showLabelOnTop"
                              stack-label
                              outlined
                              filled
                              dense
                              tabindex="0"
                              @update:model-value="
                                updateRegexPatternName(
                                  userSelectedRegexPatternName[index],
                                  index,
                                )
                              "
                            />
                          </div>
                        </span>
                        <span
                          data-test="regex-pattern-import-pattern-error"
                          class="text-red"
                          v-else-if="
                            typeof errorMessage === 'object' &&
                            errorMessage.field == 'regex_pattern'
                          "
                        >
                          {{ errorMessage.message }}
                          <!-- name is required so we need to show the input field -->
                          <div style="width: 300px">
                            <q-input
                              data-test="regex-pattern-import-name-input"
                              v-model="userSelectedRegexPattern[index]"
                              :label="'Regex Pattern *'"
                              color="input-border"
                              bg-color="input-bg"
                              class="showLabelOnTop"
                              stack-label
                              outlined
                              filled
                              dense
                              tabindex="0"
                              @update:model-value="
                                updateRegexPattern(
                                  userSelectedRegexPattern[index],
                                  index,
                                )
                              "
                            />
                          </div>
                        </span>
                        <span class="text-red" v-else>{{ errorMessage }}</span>
                      </div>
                    </div>
                  </div>
                </div>
  
                <div class="error-section" v-if="regexPatternCreators.length > 0">
                  <div
                    class="section-title text-primary"
                    data-test="regex-pattern-import-creation-title"
                  >
                    Regex Pattern Creation
                  </div>
                  <div
                    class="error-list"
                    v-for="(val, index) in regexPatternCreators"
                    :key="index"
                    :data-test="`regex-pattern-import-creation-${index}`"
                  >
                    <div
                      :class="{
                        'error-item text-bold': true,
                        'text-green ': val.success,
                        'text-red': !val.success,
                      }"
                      :data-test="`regex-pattern-import-creation-${index}-message`"
                    >
                      <pre class="creators-message">{{ val.message }}</pre>
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
  import { useRouter } from "vue-router";
  
  import { useQuasar } from "quasar";
    
  import AppTabs from "../common/AppTabs.vue";
  import axios from "axios";

  import regexPatternsService from "@/services/regex_pattern";
  
  export default defineComponent({
    name: "ImportRegexPattern",
    props: {
      regexPatterns: {
        type: Array as () => string[],
        required: true,
      },
    },
    emits: ["cancel:hideform", "update:list"],
    setup(props, { emit }) {
  
      const { t } = useI18n();
      const store = useStore();
      const router = useRouter();
  
      const jsonStr: any = ref("");
      const q = useQuasar();
  
      const regexPatternErrorsToDisplay = ref<any[]>([]);
  
      const queryEditorPlaceholderFlag = ref(true);
      const jsonFiles = ref(null);
      const url = ref("");
      const jsonArrayOfObj = ref<any[]>([{}]);
      const activeTab = ref("import_json_file");
      const splitterModel = ref(60);
      const userSelectedRegexPatternName = ref([]);
      const userSelectedRegexPattern = ref([]);
      const regexPatternCreators = ref<any[]>([]);
  
      // Create a Set for O(1) lookups
      const existingPatternNames = ref(new Set());

      onMounted(() => {
        existingPatternNames.value = new Set(props.regexPatterns);
      });
  
      const updateRegexPatternName = (regexPatternName: string, index: number) => {
        jsonArrayOfObj.value[index].name = regexPatternName;
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      };
      const updateRegexPattern = (regexPattern: any, index: number) => {
        jsonArrayOfObj.value[index].pattern = regexPattern;
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
  
      const importJson = async () => {
        regexPatternErrorsToDisplay.value = [];
  
        try {
          if ((!jsonStr.value || jsonStr.value.trim() === "") && !url.value) {
            throw new Error("JSON string is empty");
          } else {
            const parsedJson = JSON.parse(jsonStr.value);
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
  
        let hasErrors = false;
        let successCount = 0;
        const totalCount = jsonArrayOfObj.value.length;
        for (let index = 0; index < jsonArrayOfObj.value.length; index++) {
          const jsonObj = jsonArrayOfObj.value[index];
          const success = await processJsonObject(jsonObj, index + 1);
          if (!success) {
            hasErrors = true;
          } else {
            successCount++;
          }
        }
  
        // Only redirect and show success message if ALL regex patterns were imported successfully
        if (successCount === totalCount) {
          q.notify({
            message: `Successfully imported regex-pattern(s)`,
            color: "positive",
            position: "bottom",
            timeout: 2000,
          });
          emit("update:list");

          router.push({
            name: "regexPatterns",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
          emit("cancel:hideform");
        }
      };
  
      const processJsonObject = async (jsonObj: any, index: number) => {
        try {
          const isValidRegexPattern = await validateRegexPatternInputs(
            jsonObj,
            index,
          );
          if (!isValidRegexPattern) {
            return false;
          }
  
          if (regexPatternErrorsToDisplay.value.length === 0) {
            const hasCreatedRegexPattern = await createRegexPattern(jsonObj, index);
            return hasCreatedRegexPattern;
          }
          return false;
        } catch (e: any) {
          q.notify({
            message: "Error importing Regex Pattern please check the JSON",
            color: "negative",
            position: "bottom",
            timeout: 2000,
          });
          return false;
        }
      };
  
      const validateRegexPatternInputs = async (jsonObj: any, index: number) => {
        if(!jsonObj.name || !jsonObj.name.trim() || typeof jsonObj.name !== 'string'){
          regexPatternErrorsToDisplay.value.push([{
            field: 'regex_pattern_name',
            message: `Regex pattern - ${index}: name is required`
          }]);
          return false;
        }
        // Check if name already exists - O(1) lookup
        if(existingPatternNames.value.has(jsonObj.name.trim())) {
          regexPatternErrorsToDisplay.value.push([{
            field: 'regex_pattern_name',
            message: `Regex pattern - ${index}: with this name already exists`
          }]);

          return false;
        }
        if(!jsonObj.pattern || !jsonObj.pattern.trim() || typeof jsonObj.pattern !== 'string'){
          regexPatternErrorsToDisplay.value.push([{
            field: 'regex_pattern',
            message: `Regex pattern - ${index}: is required`
          }]);
          return false;
        }
        if(typeof jsonObj.description !== 'string' && jsonObj.description !== null && jsonObj.description !== undefined){
          regexPatternErrorsToDisplay.value.push([`Regex pattern - ${index}: description must be a string or should be empty`]);
          return false;
        }
        return true;
      };

      const createRegexPattern = async (jsonObj: any, index: number) => {
        try {
            const payload = {
                name: jsonObj.name,
                pattern: jsonObj.pattern,
                description: jsonObj.description,
            }
            await regexPatternsService.create(store.state.selectedOrganization.identifier, payload);
            regexPatternCreators.value.push({
                success: true,
                message: `Regex pattern - ${index}: "${jsonObj.name}" created successfully \nNote: please remove the created regex pattern object ${jsonObj.name} from the json file`,
            });
            return true;
        } catch (error: any) {
            regexPatternCreators.value.push({
                success: false,
                message: `Regex pattern - ${index}: "${jsonObj.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
            });
            return false;
        }
      };
  
      const arrowBackFn = () => {
        router.push({
          name: "regexPatterns",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        emit("cancel:hideform")
      };
  
      const onSubmit = (e: any) => {
        e.preventDefault();
      };
  
      return {
        store,
        t,
        jsonStr,
        importJson,
        onSubmit,
        router,
        q,
        regexPatternErrorsToDisplay,
        queryEditorPlaceholderFlag,
        splitterModel,
        tabs,
        activeTab,
        jsonArrayOfObj,
        jsonFiles,
        updateActiveTab,
        arrowBackFn,
        url,
        userSelectedRegexPatternName,
        regexPatternCreators,
        updateRegexPatternName,
        updateRegexPattern,
        userSelectedRegexPattern,
      };
    },
    components: {
      QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
      AppTabs,
    },
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
    height: calc(70vh - 20px) !important;
  }
  .editor-container-url {
    .monaco-editor {
      height: calc(66vh - 8px) !important; /* Total editor height */
      overflow: auto; /* Allows scrolling if content overflows */
      resize: none; /* Remove resize behavior */
    }
  }
  .editor-container-json {
    .monaco-editor {
      height: calc(65vh - 20px) !important; /* Total editor height */
      overflow: auto; /* Allows scrolling if content overflows */
      resize: none; /* Remove resize behavior */
    }
  }
  .monaco-editor {
    height: calc(60vh - 14px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
  .error-report-container {
    height: calc(70vh - 8px) !important; /* Total editor height */
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
  .creators-message {
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    word-break: break-word;
    max-width: 100%;
  }
  </style>
  