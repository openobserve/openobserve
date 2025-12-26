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
  <div class="tw:w-full" :class="containerClass" :style="containerStyle">
    <!-- Header Section -->
    <div class="card-container tw:mb-[0.625rem]" :class="headerContainerClass">
      <div class="flex tw:px-4 items-center no-wrap tw:h-[68px]" :class="headerClass">
        <div class="col">
          <div class="flex">
            <q-btn
              no-caps
              padding="xs"
              outline
              @click="handleBack"
              icon="arrow_back_ios_new"
              :data-test="`${testPrefix}-import-back-btn`"
            />
            <div :class="titleClass" class="q-ml-md">{{ title }}</div>
          </div>
        </div>

        <!-- Slot for additional header content (e.g., folder dropdown) -->
        <slot name="header-additional" />

        <div class="flex justify-center">
          <q-btn
            v-close-popup
            class="q-mr-md o2-secondary-button tw:h-[36px]"
            :label="t('function.cancel')"
            no-caps
            flat
            :class="cancelButtonClass"
            @click="handleCancel"
            :data-test="`${testPrefix}-import-cancel-btn`"
          />
          <q-btn
            class="o2-primary-button no-border tw:h-[36px]"
            :label="t('dashboard.import')"
            type="submit"
            no-caps
            flat
            :class="importButtonClass"
            @click="handleImport"
            :loading="isImporting"
            :disable="isImporting"
            :data-test="`${testPrefix}-import-json-btn`"
          />
        </div>
      </div>
    </div>

    <div class="flex" :class="contentWrapperClass">
      <div class="flex" :style="contentStyle">
        <q-splitter
          v-if="showSplitter"
          class="logs-search-splitter"
          no-scroll
          v-model="splitterModel"
          :style="splitterStyle"
          :limits="[30, 60]"
        >
          <template #before>
            <div class="tw:w-full tw:h-full">
              <!-- Tabs Section -->
              <div class="card-container tw:py-[0.625rem] tw:px-[0.625rem] tw:mb-[0.625rem]">
                <div class="app-tabs-container tw:h-[36px] tw:w-fit">
                  <app-tabs
                    :data-test="`${testPrefix}-import-tabs`"
                    class="tabs-selection-container"
                    :tabs="tabs"
                    v-model:active-tab="activeTab"
                    @update:active-tab="handleTabChange"
                  />
                </div>
              </div>

              <!-- URL Import Tab -->
              <div
                v-if="activeTab === 'import_json_url'"
                class="editor-container-url card-container tw:py-1"
              >
                <q-form class="tw:mx-2 tw:pb-2" @submit.prevent>
                  <!-- Slot for custom URL input section -->
                  <slot name="url-input-section" :url="url" :updateUrl="updateUrl">
                    <div class="flex tw:mt-[0.725rem] tw:h-[64px]">
                      <div style="width: 100%" class="q-pr-sm">
                        <q-input
                          :data-test="`${testPrefix}-import-url-input`"
                          v-model="url"
                          :placeholder="t('dashboard.addURL')"
                          borderless
                          style="padding: 10px 0px;"
                        />
                      </div>
                    </div>
                  </slot>

                  <query-editor
                    :key="`editor-${editorKey}`"
                    :data-test="`${testPrefix}-import-sql-editor`"
                    ref="queryEditorRef"
                    :editor-id="`${testPrefix}-import-query-editor`"
                    class="monaco-editor tw:mx-2"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                    :class="
                      jsonStr === '' && queryEditorPlaceholderFlag
                        ? 'empty-query'
                        : ''
                    "
                    @focus="queryEditorPlaceholderFlag = false"
                    @blur="queryEditorPlaceholderFlag = true"
                  />
                </q-form>
              </div>

              <!-- File Upload Tab -->
              <div
                v-if="activeTab === 'import_json_file'"
                class="editor-container-json card-container tw:py-1"
              >
                <q-form class="tw:mx-2 q-mt-md tw:pb-2" @submit.prevent>
                  <!-- Slot for custom file input section -->
                  <slot name="file-input-section" :jsonFiles="jsonFiles" :updateFiles="updateFiles">
                    <div style="width: calc(100% - 10px)" class="q-mb-xs flex">
                      <div style="width: 100%" class="q-pr-sm">
                        <q-file
                          :data-test="`${testPrefix}-import-json-file-input`"
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
                    </div>
                  </slot>

                  <query-editor
                    :key="`editor-${editorKey}`"
                    :data-test="`${testPrefix}-import-sql-editor`"
                    ref="queryEditorRef"
                    :editor-id="`${testPrefix}-import-query-editor`"
                    class="monaco-editor tw:mx-2"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                    :class="
                      jsonStr === '' && queryEditorPlaceholderFlag
                        ? 'empty-query'
                        : ''
                    "
                    @focus="queryEditorPlaceholderFlag = false"
                    @blur="queryEditorPlaceholderFlag = true"
                  />
                </q-form>
              </div>

              <!-- Slot for custom tabs (e.g., built-in patterns) -->
              <slot name="custom-tab" :activeTab="activeTab" />
            </div>
          </template>

          <template #after>
            <div
              :data-test="`${testPrefix}-import-output-editor`"
              class="card-container tw:mb-[0.625rem] tw:w-full"
              :style="outputContainerStyle"
            >
              <!-- Slot for complete output section customization -->
              <slot name="output-section">
                <!-- Default output section - only shown if slot not used -->
                <slot name="output-content">
                  <div class="text-center text-h6 tw:py-2">Output Messages</div>
                  <q-separator class="q-mx-md q-mt-md" />
                  <div class="error-report-container">
                    <div class="text-center q-pa-md text-grey-6">
                      No messages to display
                    </div>
                  </div>
                </slot>
              </slot>
            </div>
          </template>
        </q-splitter>

        <!-- Slot for full-width content (when splitter is not shown) -->
        <slot name="full-width-content" v-if="!showSplitter" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  reactive,
  watch,
  defineAsyncComponent,
  computed,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import axios from "axios";
import AppTabs from "./AppTabs.vue";

export default defineComponent({
  name: "BaseImport",
  components: {
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    AppTabs,
  },
  props: {
    // Title for the import page
    title: {
      type: String,
      required: true,
    },
    // Tabs configuration
    tabs: {
      type: Array,
      default: () => [
        {
          label: "File Upload / JSON",
          value: "import_json_file",
        },
        {
          label: "URL Import",
          value: "import_json_url",
        },
      ],
    },
    // Default active tab
    defaultActiveTab: {
      type: String,
      default: "import_json_file",
    },
    // Test prefix for data-test attributes
    testPrefix: {
      type: String,
      required: true,
    },
    // Loading state for import button
    isImporting: {
      type: Boolean,
      default: false,
    },
    // Show splitter layout
    showSplitter: {
      type: Boolean,
      default: true,
    },
    // Custom heights for different editor sections
    editorHeights: {
      type: Object,
      default: () => ({
        urlEditor: "calc(100vh - 286px)", // Default for management pages
        fileEditor: "calc(100vh - 308px)", // Default for management pages
        outputContainer: "calc(100vh - 130px)", // Default for management pages
        errorReport: "calc(100vh - 192px)", // Default for management pages
      }),
    },
    // Custom classes
    containerClass: {
      type: String,
      default: "tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs",
    },
    containerStyle: {
      type: String,
      default: "",
    },
    headerContainerClass: {
      type: String,
      default: "",
    },
    headerClass: {
      type: String,
      default: "tw:py-3",
    },
    titleClass: {
      type: String,
      default: "tw:font-[600] tw:text-[20px]",
    },
    contentWrapperClass: {
      type: String,
      default: "",
    },
    // Button classes for theme support
    cancelButtonClass: {
      type: String,
      default: "",
    },
    importButtonClass: {
      type: String,
      default: "",
    },
  },
  emits: [
    "back",
    "cancel",
    "import",
    "update:jsonStr",
    "update:jsonArray",
    "update:activeTab",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const q = useQuasar();

    // State
    const jsonStr = ref<any>("");
    const jsonFiles = ref<any>(null);
    const url = ref("");
    const jsonArrayOfObj = ref<any[]>([]);
    const activeTab = ref(props.defaultActiveTab);
    const splitterModel = ref(60);
    const queryEditorPlaceholderFlag = ref(true);
    const editorKey = ref(0); // Force editor to re-render when changes
    const isImporting = ref(false); // Track if import is in progress

    // Expose methods to allow parent to update jsonStr
    const updateJsonStr = (newJsonStr: string) => {
      jsonStr.value = newJsonStr;
    };

    const updateJsonArray = (newJsonArray: any[], skipEditorUpdate = false) => {
      jsonArrayOfObj.value = newJsonArray;
      jsonStr.value = JSON.stringify(newJsonArray, null, 2);
      if (!skipEditorUpdate && !isImporting.value) {
        editorKey.value++; // Force editor to update only if not importing
      }
    };

    // Computed styles
    const contentStyle = computed(() => {
      return props.showSplitter ? "width: calc(100vw - 100px);" : "width: 100%;";
    });

    const splitterStyle = computed(() => {
      return {
        width: "100%",
        height: "100%",
      };
    });

    const outputContainerStyle = computed(() => {
      return {
        height: props.editorHeights.outputContainer,
      };
    });

    // Methods
    const handleBack = () => {
      emit("back");
    };

    const handleCancel = () => {
      emit("cancel");
    };

    const handleImport = () => {
      isImporting.value = true;
      emit("import", {
        jsonStr: jsonStr.value,
        jsonArray: jsonArrayOfObj.value,
      });
    };

    const handleTabChange = (newTab: string) => {
      activeTab.value = newTab;
      jsonStr.value = "";
      jsonFiles.value = null;
      url.value = "";
      jsonArrayOfObj.value = [];
      emit("update:activeTab", newTab);
    };

    const updateUrl = (newUrl: string) => {
      url.value = newUrl;
    };

    const updateFiles = (files: any) => {
      jsonFiles.value = files;
    };

    // Watch for file changes
    watch(jsonFiles, async (newVal: any) => {
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
        emit("update:jsonStr", jsonStr.value);
        emit("update:jsonArray", jsonArrayOfObj.value);
      }
    });

    // Watch for URL changes
    watch(url, async (newVal) => {
      try {
        if (newVal) {
          const response = await axios.get(newVal);

          // Check if the response body is valid JSON
          try {
            if (
              response.headers["content-type"]?.includes("application/json") ||
              response.headers["content-type"]?.includes("text/plain")
            ) {
              jsonStr.value = JSON.stringify(response.data, null, 2);
              jsonArrayOfObj.value = Array.isArray(response.data)
                ? response.data
                : [response.data];
              emit("update:jsonStr", jsonStr.value);
              emit("update:jsonArray", jsonArrayOfObj.value);
            } else {
              q.notify({
                message: "Invalid JSON format in the URL",
                color: "negative",
                position: "bottom",
                timeout: 2000,
              });
            }
          } catch (parseError) {
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

    // Watch jsonStr changes from parent
    watch(
      () => jsonStr.value,
      (newVal) => {
        emit("update:jsonStr", newVal);
      },
    );

    // Watch jsonArrayOfObj for deep changes and sync to jsonStr
    watch(
      jsonArrayOfObj,
      (newVal) => {
        if (newVal && newVal.length > 0) {
          jsonStr.value = JSON.stringify(newVal, null, 2);
          emit("update:jsonStr", jsonStr.value);
          emit("update:jsonArray", newVal);
        }
      },
      { deep: true }
    );

    // Cleanup before component unmounts to prevent Monaco editor errors
    onBeforeUnmount(() => {
      // Stop any pending updates
      isImporting.value = true;
      // Clear the jsonStr to prevent Monaco from trying to update
      jsonStr.value = "";
    });

    return {
      t,
      jsonStr,
      jsonFiles,
      url,
      jsonArrayOfObj,
      activeTab,
      splitterModel,
      queryEditorPlaceholderFlag,
      editorKey,
      isImporting,
      handleBack,
      handleCancel,
      handleImport,
      handleTabChange,
      updateUrl,
      updateFiles,
      updateJsonStr,
      updateJsonArray,
      contentStyle,
      splitterStyle,
      outputContainerStyle,
    };
  },
});
</script>

<style scoped lang="scss">
.empty-query .monaco-editor-background {
  background-image: url("../../assets/images/common/query-editor.png");
  background-repeat: no-repeat;
  background-size: 115px;
}

.editor-container-url {
  .monaco-editor {
    height: v-bind('editorHeights.urlEditor') !important;
    overflow: auto;
    resize: none;
    border: 1px solid var(--o2-border-color);
    border-radius: 0.375rem;
    padding-top: 12px;
  }
}

.editor-container-json {
  .monaco-editor {
    height: v-bind('editorHeights.fileEditor') !important;
    overflow: auto;
    resize: none;
    border: 1px solid var(--o2-border-color);
    border-radius: 0.375rem;
    padding-top: 12px;
  }
}

.monaco-editor {
  height: v-bind('editorHeights.fileEditor') !important;
  overflow: auto;
  resize: none;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
}

.error-report-container {
  height: v-bind('editorHeights.errorReport') !important;
  overflow: auto;
  resize: none;
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
</style>
