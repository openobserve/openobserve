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
  <div
    class="flex h-full min-h-0 w-full flex-col overflow-hidden"
    :class="[containerClass]"
    :style="containerStyle"
  >
    <!-- Header Section — the standard OPageHeader (back tile + title + actions)
         used across the app. Hidden when the host page provides its own page
         header, e.g. the pipeline shell's OPageHeader (avoids a duplicate). -->
    <OPageHeader
      v-if="!hideHeader"
      :title="title"
      :back="{ label: '', onClick: handleBack, dataTest: `${testPrefix}-import-back-btn` }"
      class="border-border-default shrink-0 border-b"
      :class="headerContainerClass"
    >
      <template #actions>
        <!-- Slot for additional header content (e.g., folder dropdown) -->
        <slot name="header-additional" />

        <OButton
          variant="outline"
          size="sm"
          :class="cancelButtonClass"
          @click="handleCancel"
          :data-test="`${testPrefix}-import-cancel-btn`"
          >{{ t("function.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm"
          type="submit"
          :class="importButtonClass"
          @click="handleImport"
          :loading="isImporting || $props.isImporting"
          :disabled="isImporting || $props.isImporting"
          :data-test="`${testPrefix}-import-json-btn`"
          >{{ t("dashboard.import") }}</OButton
        >
      </template>
    </OPageHeader>

    <!-- No px-page-edge here: the tabs section carries its own px-page-edge so
         it aligns with the header back-button icon (which is inset one
         page-edge from the container). A page-edge on this wrapper too would
         double the inset and push the content past the header icon. -->
    <div class="flex min-h-0 flex-1" :class="contentWrapperClass">
      <div class="flex min-h-0 w-full" :style="contentStyle">
        <OSplitter
          v-if="showSplitter"
          class="logs-search-splitter h-full min-h-0 w-full"
          v-model="splitterModel"
          :style="splitterStyle"
          :limits="[30, 60]"
          :horizontal="false"
        >
          <template #before>
            <div class="border-border-default flex h-full w-full flex-col border-r">
              <!-- Tabs Section -->
              <div class="bg-card-glass-bg px-page-edge mb-1 shrink-0 py-2.5">
                <div class="app-tabs-container h-9 w-fit">
                  <AppTabs
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
                class="editor-container-url bg-card-glass-bg flex min-h-0 flex-1 flex-col py-1"
              >
                <div class="mx-2 mt-1 flex min-h-0 flex-1 flex-col pb-2">
                  <!-- Slot for custom URL input section -->
                  <slot name="url-input-section" :url="url" :updateUrl="updateUrl">
                    <div class="mb-3 flex shrink-0">
                      <OInput
                        :data-test="`${testPrefix}-import-url-input`"
                        v-model="url"
                        size="md"
                        :placeholder="t('dashboard.addURL')"
                      />
                    </div>
                  </slot>

                  <QueryEditor
                    :key="`editor-${editorKey}`"
                    :data-test="`${testPrefix}-import-sql-editor`"
                    ref="queryEditorRef"
                    :editor-id="`${testPrefix}-import-query-editor`"
                    class="import-url-editor border-card-glass-border rounded-default min-h-0 flex-1 overflow-hidden border"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                  />
                </div>
              </div>
              <div
                v-if="activeTab === 'import_json_file'"
                class="editor-container-json bg-card-glass-bg flex min-h-0 flex-1 flex-col py-1"
              >
                <div class="mx-2 mt-1 flex min-h-0 flex-1 flex-col pb-2">
                  <!-- Slot for custom file input section -->
                  <slot name="file-input-section" :jsonFiles="jsonFiles" :updateFiles="updateFiles">
                    <div class="mb-1 flex w-full shrink-0">
                      <div class="w-full">
                        <OFile
                          :data-test="`${testPrefix}-import-json-file-input`"
                          v-model="jsonFiles"
                          bottom-slots
                          :label="t('dashboard.dropFileMsg')"
                          accept=".json"
                          multiple
                          helpText=".json files only"
                        >
                          <template v-slot:prepend>
                            <OIcon name="cloud-upload" size="sm" @click.stop.prevent />
                          </template>
                          <template v-slot:append>
                            <OIcon
                              name="close"
                              size="sm"
                              @click.stop.prevent="jsonFiles = null"
                              class="cursor-pointer"
                            />
                          </template>
                        </OFile>
                      </div>
                    </div>
                  </slot>

                  <QueryEditor
                    :key="`editor-${editorKey}`"
                    :data-test="`${testPrefix}-import-sql-editor`"
                    ref="queryEditorRef"
                    :editor-id="`${testPrefix}-import-query-editor`"
                    class="import-file-editor border-card-glass-border rounded-default min-h-0 flex-1 overflow-hidden border"
                    :debounceTime="300"
                    v-model:query="jsonStr"
                    language="json"
                  />
                </div>
              </div>
              <!-- Slot for custom tab (e.g., built-in patterns) -->
              <slot name="custom-tab" :activeTab="activeTab" />
            </div>
          </template>

          <template #after>
            <div
              :data-test="`${testPrefix}-import-output-editor`"
              class="bg-card-glass-bg flex h-full min-h-0 w-full flex-col"
            >
              <!-- Slot for complete output section customization -->
              <slot name="output-section">
                <!-- Default output section - only shown if slot not used -->
                <slot name="output-content">
                  <div class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold">
                    Output Messages
                  </div>
                  <OSeparator class="mt-1 shrink-0" />
                  <div class="error-report-container min-h-0 flex-1 resize-none overflow-auto">
                    <div class="text-text-muted p-3 text-center">No messages to display</div>
                  </div>
                </slot>
              </slot>
            </div>
          </template>
        </OSplitter>

        <!-- Slot for w-full content (when splitter is not shown) -->
        <slot name="full-width-content" v-if="!showSplitter" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
  defineAsyncComponent,
  computed,
  onBeforeUnmount,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import axios from "axios";
import AppTabs from "./AppTabs.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

export default defineComponent({
  name: "BaseImport",
  components: {
    OSeparator,
    OSplitter,
    QueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
    AppTabs,
    OPageHeader,
    OButton,
    OInput,
    OIcon,
    OFile,
  },
  props: {
    // Title for the import page
    title: {
      type: String,
      required: true,
    },
    // Tabs configuration (shape matches AppTabs' Tab interface)
    tabs: {
      type: Array as PropType<
        { label: string; value: string; icon?: string; disabled?: boolean }[]
      >,
      default: () => [
        {
          label: "File Upload / JSON",
          value: "import_json_file",
          icon: "upload",
        },
        {
          label: "URL Import",
          value: "import_json_url",
          icon: "link",
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
    // Hide the built-in header (title + back + cancel/import buttons) when the
    // host page already renders its own page header and teleports the actions.
    hideHeader: {
      type: Boolean,
      default: false,
    },
    // Custom heights for different editor sections
    editorHeights: {
      type: Object,
      default: () => ({
        urlEditor: "calc(100vh - 286px)", // Default for management pages
        fileEditor: "calc(100vh - 290px)", // Default for management pages
        outputContainer: "calc(100vh - 130px)", // Default for management pages
        errorReport: "calc(100vh - 192px)", // Default for management pages
      }),
    },
    // Custom classes
    containerClass: {
      type: String,
      default: "mb-2.5",
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
      default: "py-3",
    },
    titleClass: {
      type: String,
      default: "font-[600] text-xl",
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
  emits: ["back", "cancel", "import", "update:jsonStr", "update:jsonArray", "update:activeTab"],
  setup(props, { emit }) {
    const { t } = useI18n();

    // State
    const jsonStr = ref<any>("");
    const jsonFiles = ref<any>(null);
    const url = ref("");
    const jsonArrayOfObj = ref<any[]>([]);
    const activeTab = ref(props.defaultActiveTab);
    const splitterModel = ref(60);
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
      return "width: 100%;";
    });

    const splitterStyle = computed(() => {
      return {
        width: "100%",
        height: "100%",
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
                  const jsonArray = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
                  resolve(jsonArray);
                } catch (error) {
                  toast({
                    message: `Error parsing JSON from file ${file.name}`,
                    variant: "error",
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
              jsonArrayOfObj.value = Array.isArray(response.data) ? response.data : [response.data];
              emit("update:jsonStr", jsonStr.value);
              emit("update:jsonArray", jsonArrayOfObj.value);
            } else {
              toast({
                message: "Invalid JSON format in the URL",
                variant: "error",
              });
            }
          } catch (parseError) {
            toast({
              message: "Invalid JSON format",
              variant: "error",
            });
          }
        }
      } catch (error) {
        toast({
          message: "Error fetching data",
          variant: "error",
        });
      }
    });

    // Watch jsonStr changes from parent
    watch(
      () => jsonStr.value,
      (newVal) => {
        emit("update:jsonStr", newVal);
        // Editor emptied → clear the selected file(s) too, so the file input
        // stays in sync with the editor (mirrors the file→editor clear above).
        if (newVal === "" && jsonFiles.value) {
          jsonFiles.value = null;
          jsonArrayOfObj.value = [];
          emit("update:jsonArray", jsonArrayOfObj.value);
        }
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
      { deep: true },
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
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:monaco): fixed Monaco height for the URL import editor.
   Previously inherited from ImportDashboard.vue's global .editor-container-url
   rule; now owned locally (via :deep to Monaco's DOM), same value/props, so the
   editor no longer depends on that view having been mounted first. */
.editor-container-url :deep(.monaco-editor) {
  height: calc(100vh - 17.8125rem) !important;
  overflow: hidden;
  resize: none;
}
</style>
