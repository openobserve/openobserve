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
  <base-import
    v-if="activeTab !== 'import_built_in_models'"
    ref="baseImportRef"
    title="Import Model Pricing"
    test-prefix="model-pricing"
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
          v-if="modelPricingErrorsToDisplay.length > 0"
          class="text-center text-h6 tw:py-2"
        >
          Error Validations
        </div>
        <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
        <q-separator class="q-mx-md q-mt-md" />
        <div class="error-report-container">
          <!-- Model Pricing Errors Section -->
          <div
            class="error-section"
            v-if="modelPricingErrorsToDisplay.length > 0"
          >
            <div class="error-list">
              <div
                v-for="(errorGroup, index) in modelPricingErrorsToDisplay"
                :key="index"
              >
                <div
                  v-for="(errorMessage, errorIndex) in errorGroup"
                  :key="errorIndex"
                  class="error-item"
                  :data-test="`model-pricing-import-error-${index}-${errorIndex}`"
                >
                  <span
                    data-test="model-pricing-import-name-error"
                    class="text-red"
                    v-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'model_pricing_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-input
                        data-test="model-pricing-import-name-input"
                        v-model="userSelectedModelPricingName[index]"
                        :label="'Model Name *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        @update:model-value="
                          updateModelPricingName(
                            userSelectedModelPricingName[index],
                            index,
                          )
                        "
                      />
                    </div>
                  </span>
                  <span
                    data-test="model-pricing-import-pattern-error"
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'model_pricing_pattern'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-input
                        data-test="model-pricing-import-pattern-input"
                        v-model="userSelectedModelPricingPattern[index]"
                        :label="'Match Pattern *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        @update:model-value="
                          updateModelPricingPattern(
                            userSelectedModelPricingPattern[index],
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

          <div class="error-section" v-if="modelPricingCreators.length > 0">
            <div
              class="section-title text-primary"
              data-test="model-pricing-import-creation-title"
            >
              Model Pricing Creation
            </div>
            <div
              class="error-list"
              v-for="(val, index) in modelPricingCreators"
              :key="index"
              :data-test="`model-pricing-import-creation-${index}`"
            >
              <div
                :class="{
                  'error-item text-bold': true,
                  'text-green ': val.success,
                  'text-red': !val.success,
                }"
                :data-test="`model-pricing-import-creation-${index}-message`"
              >
                <pre class="creators-message">{{ val.message }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </base-import>

  <!-- Built-in Models Tab (full width) -->
  <div
    v-if="activeTab === 'import_built_in_models'"
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
              data-test="model-pricing-import-back-btn"
            />
            <div class="text-h6 q-ml-md">
              Import Model Pricing
            </div>
          </div>
        </div>
        <div class="flex justify-center">
          <q-btn
            v-close-popup
            class="q-mr-md o2-secondary-button tw:h-[36px]"
            label="Cancel"
            no-caps
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            @click="arrowBackFn"
            data-test="model-pricing-import-cancel-btn"
          />
          <q-btn
            class="o2-primary-button no-border tw:h-[36px]"
            label="Import"
            type="submit"
            no-caps
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            @click="handleImportClick"
            data-test="model-pricing-import-json-btn"
          />
        </div>
      </div>
    </div>

    <div class="editor-container-built-in">
      <div class="card-container tw:py-[0.625rem] tw:px-[0.625rem] tw:mb-[0.625rem]">
        <div class="app-tabs-container tw:h-[36px] tw:w-fit">
          <app-tabs
            data-test="model-pricing-import-tabs"
            class="tabs-selection-container"
            :tabs="allTabs"
            v-model:active-tab="activeTab"
            @update:active-tab="updateActiveTab"
          />
        </div>
      </div>
      <built-in-model-pricing-tab
        ref="builtInModelPricingTabRef"
        @import-models="handleBuiltInModelsImport"
        data-test="built-in-model-pricing-tab"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  computed,
  defineAsyncComponent,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

import AppTabs from "../common/AppTabs.vue";
import BaseImport from "../common/BaseImport.vue";

import modelPricingService from "@/services/model_pricing";

export default defineComponent({
  name: "ImportModelPricing",
  props: {
    existingModels: {
      type: Array as () => string[],
      default: () => [],
    },
  },
  emits: ["cancel:hideform", "update:list"],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const q = useQuasar();
    const baseImportRef = ref<any>(null);
    const builtInModelPricingTabRef = ref<any>(null);

    const modelPricingErrorsToDisplay = ref<any[]>([]);
    const userSelectedModelPricingName = ref<string[]>([]);
    const userSelectedModelPricingPattern = ref<string[]>([]);
    const modelPricingCreators = ref<any[]>([]);
    const activeTab = ref("import_built_in_models");
    const isImporting = ref(false);

    const localJsonArrayOfObj = ref<any[]>([]);

    const jsonArrayOfObj = computed({
      get: () => {
        if (activeTab.value === "import_built_in_models") {
          return localJsonArrayOfObj.value;
        }
        return baseImportRef.value?.jsonArrayOfObj || [];
      },
      set: (val) => {
        if (activeTab.value === "import_built_in_models") {
          localJsonArrayOfObj.value = val;
        } else if (baseImportRef.value) {
          baseImportRef.value.jsonArrayOfObj = val;
        }
      },
    });

    const allTabs = ref([
      {
        label: "Built-in Models",
        value: "import_built_in_models",
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
      // existingModels available if needed for duplicate detection
    });

    const updateModelPricingName = (name: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = name;
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateModelPricingPattern = (pattern: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].match_pattern = pattern;
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

    const importJson = async ({ jsonStr: jsonString }: any) => {
      modelPricingErrorsToDisplay.value = [];
      modelPricingCreators.value = [];

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
          message: `Successfully imported ${successCount} model pricing definition${successCount !== 1 ? "s" : ""}`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        setTimeout(() => {
          emit("update:list");
          router.push({
            name: "modelPricing",
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
        const validationResult = await validateModelPricingInputs(jsonObj, index);
        if (!validationResult) {
          return false;
        }

        if (modelPricingErrorsToDisplay.value.length === 0) {
          const created = await createModelPricing(jsonObj, index);
          return created;
        }
        return false;
      } catch (e: any) {
        q.notify({
          message: "Error importing model pricing — please check the JSON",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return false;
      }
    };

    const validateModelPricingInputs = async (jsonObj: any, index: number) => {
      if (!jsonObj.name || !jsonObj.name.trim() || typeof jsonObj.name !== "string") {
        modelPricingErrorsToDisplay.value.push([
          {
            field: "model_pricing_name",
            message: `Model pricing - ${index}: name is required`,
          },
        ]);
        return false;
      }

      if (
        !jsonObj.match_pattern ||
        !jsonObj.match_pattern.trim() ||
        typeof jsonObj.match_pattern !== "string"
      ) {
        modelPricingErrorsToDisplay.value.push([
          {
            field: "model_pricing_pattern",
            message: `Model pricing - ${index}: match_pattern is required`,
          },
        ]);
        return false;
      }

      if (!Array.isArray(jsonObj.tiers) || jsonObj.tiers.length === 0) {
        modelPricingErrorsToDisplay.value.push([
          `Model pricing - ${index}: tiers must be a non-empty array`,
        ]);
        return false;
      }

      return true;
    };

    const createModelPricing = async (jsonObj: any, index: number) => {
      try {
        await modelPricingService.create(store.state.selectedOrganization.identifier, {
          name: jsonObj.name,
          match_pattern: jsonObj.match_pattern,
          enabled: jsonObj.enabled ?? true,
          tiers: jsonObj.tiers,
          sort_order: jsonObj.sort_order ?? 0,
        });
        modelPricingCreators.value.push({
          success: true,
          message: `Model pricing - ${index}: "${jsonObj.name}" created successfully`,
        });
        return true;
      } catch (error: any) {
        const errorMessage =
          error?.response?.data?.message || "Unknown Error";

        q.notify({
          message: `Failed to import model pricing "${jsonObj.name}": ${errorMessage}`,
          color: "negative",
          position: "bottom",
          timeout: 4000,
        });

        modelPricingCreators.value.push({
          success: false,
          message: `Model pricing - ${index}: "${jsonObj.name}" creation failed --> \n Reason: ${errorMessage}`,
        });
        return false;
      }
    };

    const arrowBackFn = () => {
      router.push({
        name: "modelPricing",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      emit("cancel:hideform");
    };

    const updateActiveTab = () => {
      if (activeTab.value !== "import_built_in_models" && baseImportRef.value) {
        baseImportRef.value.jsonStr = "";
        baseImportRef.value.jsonFiles = null;
        baseImportRef.value.url = "";
        baseImportRef.value.jsonArrayOfObj = [{}];
      }
    };

    const handleBuiltInModelsImport = async (modelsToImport: any[]) => {
      const payload = {
        jsonStr: JSON.stringify(modelsToImport, null, 2),
        jsonArray: modelsToImport,
      };
      await importJson(payload);
    };

    const handleImportClick = async () => {
      if (activeTab.value === "import_built_in_models") {
        if (builtInModelPricingTabRef.value) {
          builtInModelPricingTabRef.value.importSelectedModels();
        }
      }
    };

    return {
      store,
      importJson,
      router,
      q,
      baseImportRef,
      builtInModelPricingTabRef,
      modelPricingErrorsToDisplay,
      activeTab,
      allTabs,
      jsonArrayOfObj,
      updateActiveTab,
      arrowBackFn,
      userSelectedModelPricingName,
      userSelectedModelPricingPattern,
      modelPricingCreators,
      updateModelPricingName,
      updateModelPricingPattern,
      handleBuiltInModelsImport,
      handleImportClick,
      isImporting,
      handleTabChange,
      processJsonObject,
      validateModelPricingInputs,
      createModelPricing,
    };
  },
  components: {
    BaseImport,
    AppTabs,
    BuiltInModelPricingTab: defineAsyncComponent(
      () => import("@/components/settings/BuiltInModelPricingTab.vue")
    ),
  },
});
</script>

<style scoped lang="scss">
.editor-container-built-in {
  width: 100%;
  height: calc(100vh - 128px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.error-report-container {
  height: calc(100vh - 200px) !important;
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

.creators-message {
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}
</style>
