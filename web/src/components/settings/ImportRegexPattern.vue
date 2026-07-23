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
  <OPageLayout
    :title="headerTitle"
    :back="{
      label: t('regex_patterns.title'),
      onClick: arrowBackFn,
      dataTest: 'regex-pattern-import-back-btn',
    }"
    bleed
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        @click="arrowBackFn"
        data-test="regex-pattern-import-cancel-btn"
        >{{ t("function.cancel") }}</OButton
      >
      <OButton
        variant="primary"
        size="sm-action"
        type="submit"
        @click="handleImportClick"
        :loading="isImporting"
        :disabled="isImporting"
        data-test="regex-pattern-import-json-btn"
        >{{ t("dashboard.import") }}</OButton
      >
    </template>

    <BaseImport
      v-if="activeTab !== 'import_built_in_patterns'"
      ref="baseImportRef"
      :title="t('settings.importRegexPattern.title')"
      test-prefix="regex-pattern"
      hide-header
      container-class="flex-1 min-h-0"
      container-style=""
      :is-importing="isImporting"
      :tabs="allTabs"
      @back="arrowBackFn"
      @cancel="arrowBackFn"
      @import="importJson"
      @update:active-tab="handleTabChange"
    >
      <template #output-content>
        <div
          class="w-full h-full flex flex-col border-l border-border-default"
          style="min-width: 400px"
        >
          <div
            v-if="regexPatternErrorsToDisplay.length > 0"
            class="text-center text-sm font-semibold text-text-heading py-3 shrink-0"
          >
            {{ t("settings.importRegexPattern.errorValidations") }}
          </div>
          <div v-else class="text-center text-sm font-semibold text-text-heading py-3 shrink-0">
            {{ t("settings.importRegexPattern.outputMessages") }}
          </div>
          <OSeparator class="mt-1 shrink-0" />
          <div class="flex-1 min-h-0 overflow-auto resize-none">
            <!-- Regex Pattern Errors Section -->
            <div class="p-2.5 mb-2.5" v-if="regexPatternErrorsToDisplay.length > 0">
              <div>
                <!-- Iterate through the outer array -->
                <div v-for="(errorGroup, index) in regexPatternErrorsToDisplay" :key="index">
                  <!-- Iterate through each inner array (the individual error message) -->
                  <div
                    v-for="(errorMessage, errorIndex) in errorGroup"
                    :key="errorIndex"
                    class="py-1.25 text-sm"
                    :data-test="`regex-pattern-import-error-${index}-${errorIndex}`"
                  >
                    <span
                      data-test="regex-pattern-import-name-error"
                      class="text-status-negative"
                      v-if="
                        typeof errorMessage === 'object' &&
                        errorMessage.field == 'regex_pattern_name'
                      "
                    >
                      {{ errorMessage.message }}
                      <div style="width: 300px">
                        <OInput
                          data-test="regex-pattern-import-name-input"
                          v-model="userSelectedRegexPatternName[index]"
                          :label="t('settings.importRegexPattern.regexPatternNameLabel')"
                          @update:model-value="
                            updateRegexPatternName(userSelectedRegexPatternName[index], index)
                          "
                        />
                      </div>
                    </span>
                    <span
                      data-test="regex-pattern-import-pattern-error"
                      class="text-status-negative"
                      v-else-if="
                        typeof errorMessage === 'object' && errorMessage.field == 'regex_pattern'
                      "
                    >
                      {{ errorMessage.message }}
                      <!-- name is required so we need to show the input field -->
                      <div style="width: 300px">
                        <OInput
                          data-test="regex-pattern-import-name-input"
                          v-model="userSelectedRegexPattern[index]"
                          :label="t('settings.importRegexPattern.regexPatternLabel')"
                          @update:model-value="
                            updateRegexPattern(userSelectedRegexPattern[index], index)
                          "
                        />
                      </div>
                    </span>
                    <span class="text-status-negative" v-else>{{ errorMessage }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="p-2.5 mb-2.5" v-if="regexPatternCreators.length > 0">
              <div
                class="text-base mb-2.5 uppercase text-primary"
                data-test="regex-pattern-import-creation-title"
              >
                {{ t("settings.importRegexPattern.regexPatternCreation") }}
              </div>
              <div
                v-for="(val, index) in regexPatternCreators"
                :key="index"
                :data-test="`regex-pattern-import-creation-${index}`"
              >
                <div
                  :class="{
                    'py-1.25 text-sm font-bold': true,
                    'text-green ': val.success,
                    'text-status-negative': !val.success,
                  }"
                  :data-test="`regex-pattern-import-creation-${index}-message`"
                >
                  <pre
                    class="whitespace-pre-wrap max-w-full"
                    style="word-wrap: break-word; overflow-wrap: break-word; word-break: break-word"
                    >{{ val.message }}</pre
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </BaseImport>

    <!-- Built-in Patterns Tab (full width, no custom import button handling) -->
    <div
      v-if="activeTab === 'import_built_in_patterns'"
      class="w-full flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      <div class="bg-card-glass-bg pt-2 px-2.5">
        <div class="app-tabs-container h-9 w-fit">
          <AppTabs
            data-test="regex-pattern-import-tabs"
            class="tabs-selection-container"
            :tabs="allTabs"
            v-model:active-tab="activeTab"
            @update:active-tab="updateActiveTab"
          />
        </div>
      </div>
      <BuiltInPatternsTab
        ref="builtInPatternsTabRef"
        @import-patterns="handleBuiltInPatternsImport"
        data-test="built-in-patterns-tab"
      />
    </div>
  </OPageLayout>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import AppTabs from "../common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import BaseImport from "../common/BaseImport.vue";

import regexPatternsService from "@/services/regex_pattern";
import { toast } from "@/lib/feedback/Toast/useToast";

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
        if (activeTab.value === "import_built_in_patterns") {
          return localJsonArrayOfObj.value;
        }
        // For other tabs, use BaseImport's ref
        return baseImportRef.value?.jsonArrayOfObj || [];
      },
      set: (val) => {
        // For built-in patterns tab, set local ref
        if (activeTab.value === "import_built_in_patterns") {
          localJsonArrayOfObj.value = val;
        } else if (baseImportRef.value) {
          // For other tabs, set BaseImport's ref
          baseImportRef.value.jsonArrayOfObj = val;
        }
      },
    });

    // Page-header title preserves the existing per-tab text: the Built-in Patterns
    // tab keeps t('regex_patterns.import_title') ("Import Pattern") while the
    // File / URL tabs keep "Import Regex Pattern" (BaseImport's previous title).
    const headerTitle = computed(() =>
      activeTab.value === "import_built_in_patterns"
        ? t("regex_patterns.import_title")
        : t("settings.importRegexPattern.title"),
    );

    // All tabs including the built-in patterns tab
    const allTabs = ref([
      {
        label: t("settings.importRegexPattern.tabBuiltInPatterns"),
        value: "import_built_in_patterns",
        icon: "menu-book",
      },
      {
        label: t("settings.importRegexPattern.tabFileUploadJson"),
        value: "import_json_file",
        icon: "upload",
      },
      {
        label: t("settings.importRegexPattern.tabUrlImport"),
        value: "import_json_url",
        icon: "link",
      },
    ]);

    onMounted(() => {
      existingPatternNames.value = new Set(props.regexPatterns);
    });

    const updateRegexPatternName = (regexPatternName: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = regexPatternName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateRegexPattern = (regexPattern: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].pattern = regexPattern;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const handleTabChange = (newTab: string) => {
      activeTab.value = newTab;
    };

    const importJson = async ({ jsonStr: jsonString }: any) => {
      regexPatternErrorsToDisplay.value = [];
      regexPatternCreators.value = [];

      try {
        if (!jsonString || jsonString.trim() === "") {
          throw new Error(t("settings.importRegexPattern.jsonStringEmpty"));
        }

        const parsedJson = JSON.parse(jsonString);
        jsonArrayOfObj.value = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      } catch (e: any) {
        toast({
          message: e.message || t("settings.importRegexPattern.invalidJsonFormat"),
          variant: "error",
        });
        // Reset BaseImport's importing flag on validation error
        if (baseImportRef.value) {
          baseImportRef.value.isImporting = false;
        }
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
        toast({
          message: t("settings.importRegexPattern.importSuccess", { count: successCount }),
          variant: "success",
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
        const validationResult = await validateRegexPatternInputs(jsonObj, index);
        if (!validationResult) {
          return false; // Validation error
        }

        if (regexPatternErrorsToDisplay.value.length === 0) {
          const hasCreatedRegexPattern = await createRegexPattern(jsonObj, index);
          return hasCreatedRegexPattern;
        }
        return false;
      } catch (e: any) {
        toast({
          message: t("settings.importRegexPattern.importError"),
          variant: "error",
        });
        return false;
      }
    };

    const validateRegexPatternInputs = async (jsonObj: any, index: number) => {
      if (!jsonObj.name || !jsonObj.name.trim() || typeof jsonObj.name !== "string") {
        regexPatternErrorsToDisplay.value.push([
          {
            field: "regex_pattern_name",
            message: t("settings.importRegexPattern.nameRequired", { index }),
          },
        ]);
        return false;
      }
      // Note: Duplicate pattern names are allowed.
      // Primary key is UUID-based (id), so multiple patterns can have the same name.
      // The backend will handle duplicates by appending a suffix automatically.
      if (!jsonObj.pattern || !jsonObj.pattern.trim() || typeof jsonObj.pattern !== "string") {
        regexPatternErrorsToDisplay.value.push([
          {
            field: "regex_pattern",
            message: t("settings.importRegexPattern.patternRequired", { index }),
          },
        ]);
        return false;
      }
      if (
        typeof jsonObj.description !== "string" &&
        jsonObj.description !== null &&
        jsonObj.description !== undefined
      ) {
        regexPatternErrorsToDisplay.value.push([
          t("settings.importRegexPattern.descriptionMustBeString", { index }),
        ]);
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
        };
        await regexPatternsService.create(store.state.selectedOrganization.identifier, payload);
        regexPatternCreators.value.push({
          success: true,
          message: t("settings.importRegexPattern.createSuccess", { index, name: jsonObj.name }),
        });
        return true;
      } catch (error: any) {
        const errorMessage =
          error?.response?.data?.message || t("settings.importRegexPattern.unknownError");

        // Check if it's a duplicate pattern error
        if (errorMessage.includes("already exists")) {
          toast({
            message: t("settings.importRegexPattern.alreadyExists", { name: jsonObj.name }),
            variant: "error",
          });
        } else {
          // Show generic error notification for other errors
          toast({
            message: t("settings.importRegexPattern.importPatternFailed", {
              name: jsonObj.name,
              error: errorMessage,
            }),
            variant: "error",
          });
        }

        regexPatternCreators.value.push({
          success: false,
          message: t("settings.importRegexPattern.createFailed", {
            index,
            name: jsonObj.name,
            error: errorMessage,
          }),
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

    const updateActiveTab = () => {
      // This is called when switching between built-in patterns and other tabs
      if (activeTab.value !== "import_built_in_patterns" && baseImportRef.value) {
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
        jsonArray: patternsToImport,
      };
      await importJson(payload);
    };

    const handleImportClick = async () => {
      if (activeTab.value === "import_built_in_patterns") {
        // For built-in patterns tab, trigger import from the child component
        if (builtInPatternsTabRef.value) {
          builtInPatternsTabRef.value.importSelectedPatterns();
        }
      } else {
        // For file/url tabs, BaseImport's built-in header is hidden, so the shared
        // page-header Import button drives BaseImport's import flow directly.
        baseImportRef.value?.handleImport?.();
      }
    };

    return {
      store,
      t,
      importJson,
      router,
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
      headerTitle,
    };
  },
  components: {
    OSeparator,
    BaseImport,
    AppTabs,
    OPageLayout,
    OButton,
    OInput,
    BuiltInPatternsTab: defineAsyncComponent(
      () => import("@/components/settings/BuiltInPatternsTab.vue"),
    ),
  },
});
</script>
