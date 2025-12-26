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
  <base-import
    v-if="activeTab !== 'import_built_in_patterns'"
    ref="baseImportRef"
    title="Import Regex Pattern"
    test-prefix="regex-pattern"
    :is-importing="isImporting"
    container-class="o2-custom-bg"
    container-style="height: calc(100vh - 50px);"
    :editor-heights="{
      urlEditor: 'calc(100vh - 286px)',
      fileEditor: 'calc(100vh - 306px)',
      outputContainer: 'calc(100vh - 128px)',
      errorReport: 'calc(100vh - 128px)',
    }"
    :tabs="allTabs"
    @back="arrowBackFn"
    @cancel="arrowBackFn"
    @import="importJson"
    @update:active-tab="handleTabChange"
  >
    <template #output-content>
      <div class="tw:w-full" style="min-width: 400px;">
        <div
          v-if="regexPatternErrorsToDisplay.length > 0"
          class="text-center text-h6 tw:py-2"
        >
          Error Validations
        </div>
        <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
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
  </base-import>

  <!-- Built-in Patterns Tab (full width, no custom import button handling) -->
  <div
    v-if="activeTab === 'import_built_in_patterns'"
    class="o2-custom-bg"
    style="height: calc(100vh - 50px);"
  >
    <div class="card-container tw:mb-[0.625rem]">
      <div class="flex tw:px-4 items-center no-wrap tw:h-[68px]">
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
            <div class="text-h6 q-ml-md">
              {{ t("regex_patterns.import_title") }}
            </div>
          </div>
        </div>
        <div class="flex justify-center">
          <q-btn
            v-close-popup
            class="q-mr-md o2-secondary-button tw:h-[36px]"
            :label="t('function.cancel')"
            no-caps
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            @click="arrowBackFn"
            data-test="regex-pattern-import-cancel-btn"
          />
          <q-btn
            class="o2-primary-button no-border tw:h-[36px]"
            :label="t('dashboard.import')"
            type="submit"
            no-caps
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            @click="handleImportClick"
            data-test="regex-pattern-import-json-btn"
          />
        </div>
      </div>
    </div>

    <div class="editor-container-built-in">
      <div class="card-container tw:py-[0.625rem] tw:px-[0.625rem] tw:mb-[0.625rem]">
        <div class="app-tabs-container tw:h-[36px] tw:w-fit">
          <app-tabs
            data-test="regex-pattern-import-tabs"
            class="tabs-selection-container"
            :tabs="allTabs"
            v-model:active-tab="activeTab"
            @update:active-tab="updateActiveTab"
          />
        </div>
      </div>
      <built-in-patterns-tab
        ref="builtInPatternsTabRef"
        @import-patterns="handleBuiltInPatternsImport"
        data-test="built-in-patterns-tab"
      />
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
import BaseImport from "../common/BaseImport.vue";
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
    const q = useQuasar();
    const baseImportRef = ref<any>(null);

    const regexPatternErrorsToDisplay = ref<any[]>([]);
    const userSelectedRegexPatternName = ref([]);
    const userSelectedRegexPattern = ref([]);
    const regexPatternCreators = ref<any[]>([]);
    const builtInPatternsTabRef = ref<any>(null);
    const activeTab = ref("import_built_in_patterns");
    const isImporting = ref(false);

    // Create a Set for O(1) lookups
    const existingPatternNames = ref(new Set());

    // Local ref for patterns being imported (used for built-in patterns tab)
    const localJsonArrayOfObj = ref<any[]>([]);

    // Use computed to reference BaseImport's jsonArrayOfObj or local one
    const jsonArrayOfObj = computed({
      get: () => {
        // For built-in patterns tab, use local ref
        if (activeTab.value === 'import_built_in_patterns') {
          return localJsonArrayOfObj.value;
        }
        // For other tabs, use BaseImport's ref
        return baseImportRef.value?.jsonArrayOfObj || [];
      },
      set: (val) => {
        // For built-in patterns tab, set local ref
        if (activeTab.value === 'import_built_in_patterns') {
          localJsonArrayOfObj.value = val;
        } else if (baseImportRef.value) {
          // For other tabs, set BaseImport's ref
          baseImportRef.value.jsonArrayOfObj = val;
        }
      }
    });

    // All tabs including the built-in patterns tab
    const allTabs = ref([
      {
        label: "Built-in Patterns",
        value: "import_built_in_patterns",
      },
      {
        label: "File Upload / JSON",
        value: "import_json_file",
      },
      {
        label: "URL Import",
        value: "import_json_url",
      },
    ]);

    onMounted(() => {
      existingPatternNames.value = new Set(props.regexPatterns);
    });

    const updateRegexPatternName = (
      regexPatternName: string,
      index: number,
    ) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = regexPatternName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateRegexPattern = (regexPattern: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].pattern = regexPattern;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const handleTabChange = (newTab: string) => {
      activeTab.value = newTab;
    };

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      regexPatternErrorsToDisplay.value = [];
      regexPatternCreators.value = [];

      try {
        if (!jsonString || jsonString.trim() === "") {
          throw new Error("JSON string is empty");
        }

        const parsedJson = JSON.parse(jsonString);
        jsonArrayOfObj.value = Array.isArray(parsedJson)
          ? parsedJson
          : [parsedJson];
      } catch (e: any) {
        q.notify({
          message: e.message || "Invalid JSON format",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return;
      }

      let successCount = 0;
      const totalCount = jsonArrayOfObj.value.length;
      isImporting.value = true;

      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (success) {
          successCount++;
        }
      }

      if (successCount === totalCount) {
        q.notify({
          message: `Successfully imported ${successCount} pattern(s)`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        setTimeout(() => {
          emit("update:list");
          router.push({
            name: "regexPatterns",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
          emit("cancel:hideform");
        }, 400);
      }

      isImporting.value = false;

      if (baseImportRef.value) {
        baseImportRef.value.isImporting = false;
      }
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const validationResult = await validateRegexPatternInputs(
          jsonObj,
          index,
        );
        if (!validationResult) {
          return false;  // Validation error
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
      // Note: Duplicate pattern names are allowed.
      // Primary key is UUID-based (id), so multiple patterns can have the same name.
      // The backend will handle duplicates by appending a suffix automatically.
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
          const errorMessage = error?.response?.data?.message || "Unknown Error";

          // Check if it's a duplicate pattern error
          if (errorMessage.includes("already exists")) {
            q.notify({
              message: `Pattern "${jsonObj.name}" already exists. Please use a different name.`,
              color: "negative",
              position: "bottom",
              timeout: 4000,
            });
          } else {
            // Show generic error notification for other errors
            q.notify({
              message: `Failed to import pattern "${jsonObj.name}": ${errorMessage}`,
              color: "negative",
              position: "bottom",
              timeout: 4000,
            });
          }

          regexPatternCreators.value.push({
              success: false,
              message: `Regex pattern - ${index}: "${jsonObj.name}" creation failed --> \n Reason: ${errorMessage}`,
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
      emit("cancel:hideform");
    };

    const onSubmit = (e: any) => {
      e.preventDefault();
    };

    const updateActiveTab = () => {
      // This is called when switching between built-in patterns and other tabs
      if (activeTab.value !== 'import_built_in_patterns' && baseImportRef.value) {
        baseImportRef.value.jsonStr = "";
        baseImportRef.value.jsonFiles = null;
        baseImportRef.value.url = "";
        baseImportRef.value.jsonArrayOfObj = [{}];
      }
    };

    const handleBuiltInPatternsImport = async (patternsToImport: any[]) => {
      // For built-in patterns, we don't use BaseImport so we call importJson directly
      // with manually constructed payload
      const payload = {
        jsonStr: JSON.stringify(patternsToImport, null, 2),
        jsonArray: patternsToImport
      };
      await importJson(payload);
    };

    const handleImportClick = async () => {
      if (activeTab.value === 'import_built_in_patterns') {
        // For built-in patterns tab, trigger import from the child component
        if (builtInPatternsTabRef.value) {
          builtInPatternsTabRef.value.importSelectedPatterns();
        }
      } else {
        // For other tabs (file/url), BaseImport handles the import button click
        // This shouldn't be called as BaseImport has its own import button
      }
    };

    return {
      store,
      t,
      importJson,
      router,
      q,
      baseImportRef,
      regexPatternErrorsToDisplay,
      activeTab,
      allTabs,
      jsonArrayOfObj,
      updateActiveTab,
      arrowBackFn,
      userSelectedRegexPatternName,
      regexPatternCreators,
      updateRegexPatternName,
      updateRegexPattern,
      userSelectedRegexPattern,
      existingPatternNames,
      processJsonObject,
      validateRegexPatternInputs,
      createRegexPattern,
      handleBuiltInPatternsImport,
      handleImportClick,
      builtInPatternsTabRef,
      isImporting,
      handleTabChange,
    };
  },
  components: {
    BaseImport,
    AppTabs,
    BuiltInPatternsTab: defineAsyncComponent(
      () => import("@/components/settings/BuiltInPatternsTab.vue"),
    ),
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
.editor-container-built-in {
  width: 100%;
  height: calc(100vh - 128px); /* Account for header, tabs, and padding */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.editor-container-url {
  .monaco-editor {
    height: calc(100vh - 270px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.editor-container-json {
  .monaco-editor {
   height: calc(100vh - 310px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
}
.monaco-editor {
height: calc(100vh - 315px) !important; /* Total editor height */
  overflow: auto; /* Allows scrolling if content overflows */
  resize: none; /* Remove resize behavior */
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  padding-top: 0.3rem;
}
.error-report-container {
  height: calc(100vh - 200px) !important; /* Total editor height */
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