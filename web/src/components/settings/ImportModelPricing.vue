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
    ref="baseImportRef"
    :title="t('modelPricing.importTitle')"
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
          {{ t('modelPricing.errorValidations') }}
        </div>
        <div v-else class="text-center text-h6 tw:py-2">{{ t('modelPricing.outputMessages') }}</div>
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
                      <OInput
                        data-test="model-pricing-import-name-input"
                        v-model="userSelectedModelPricingName[index]"
                        :label="t('modelPricing.modelNameLabel')"
                        @update:model-value="updateModelPricingName(userSelectedModelPricingName[index], index)"
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
                      <OInput
                        data-test="model-pricing-import-pattern-input"
                        v-model="userSelectedModelPricingPattern[index]"
                        :label="t('modelPricing.matchPatternLabel')"
                        @update:model-value="updateModelPricingPattern(userSelectedModelPricingPattern[index], index)"
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
              {{ t('modelPricing.modelPricingCreation') }}
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
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

import BaseImport from "../common/BaseImport.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

import modelPricingService from "@/services/model_pricing";

const props = defineProps<{
  existingModels?: string[];
}>();

const emit = defineEmits<{
  "cancel:hideform": [];
  "update:list": [];
}>();

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const q = useQuasar();
const baseImportRef = ref<any>(null);
const modelPricingErrorsToDisplay = ref<any[]>([]);
const userSelectedModelPricingName = ref<string[]>([]);
const userSelectedModelPricingPattern = ref<string[]>([]);
const modelPricingCreators = ref<any[]>([]);
const activeTab = ref("import_json_file");
const isImporting = ref(false);

const jsonArrayOfObj = computed({
  get: () => {
    return baseImportRef.value?.jsonArrayOfObj || [];
  },
  set: (val) => {
    if (baseImportRef.value) {
      baseImportRef.value.jsonArrayOfObj = val;
    }
  },
});

const allTabs = computed(() => [
  {
    label: t("modelPricing.fileUploadTab"),
    value: "import_json_file",
  },
  {
    label: t("modelPricing.urlImportTab"),
    value: "import_json_url",
  },
]);

function updateModelPricingName(name: string, index: number) {
  if (baseImportRef.value?.jsonArrayOfObj[index]) {
    baseImportRef.value.jsonArrayOfObj[index].name = name;
    baseImportRef.value.jsonStr = JSON.stringify(
      baseImportRef.value.jsonArrayOfObj,
      null,
      2
    );
  }
}

function updateModelPricingPattern(pattern: string, index: number) {
  if (baseImportRef.value?.jsonArrayOfObj[index]) {
    baseImportRef.value.jsonArrayOfObj[index].match_pattern = pattern;
    baseImportRef.value.jsonStr = JSON.stringify(
      baseImportRef.value.jsonArrayOfObj,
      null,
      2
    );
  }
}

function handleTabChange(newTab: string) {
  activeTab.value = newTab;
}

async function importJson({ jsonStr: jsonString }: any) {
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

  // Detect duplicate names within the batch
  const batchNames = new Set<string>();
  for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
    if (jsonObj.name && batchNames.has(jsonObj.name)) {
      modelPricingErrorsToDisplay.value.push([
        {
          field: "model_pricing_name",
          message: `Model pricing - ${index + 1}: duplicate name "${jsonObj.name}" within this import batch. Each model must have a unique name.`,
        },
      ]);
      continue;
    }
    if (jsonObj.name) batchNames.add(jsonObj.name);
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
}

async function processJsonObject(jsonObj: any, index: number) {
  try {
    const validationResult = await validateModelPricingInputs(jsonObj, index);
    if (!validationResult) {
      return false;
    }

    const created = await createModelPricing(jsonObj, index);
    return created;
  } catch (e: any) {
    q.notify({
      message: "Error importing model pricing. Please check the JSON format.",
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return false;
  }
}

async function validateModelPricingInputs(jsonObj: any, index: number) {
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

  // Check for duplicate name against existing models in the org
  if (props.existingModels?.includes(jsonObj.name)) {
    modelPricingErrorsToDisplay.value.push([
      {
        field: "model_pricing_name",
        message: `Model pricing - ${index}: a model with name "${jsonObj.name}" already exists. Please choose a different name.`,
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

  // Validate usage keys in tiers
  for (const tier of jsonObj.tiers) {
    for (const key of Object.keys(tier.prices || {})) {
      if (/^\d+$/.test(key)) {
        modelPricingErrorsToDisplay.value.push([
          {
            field: "model_pricing_name",
            message: `Model pricing - ${index}: usage key "${key}" cannot be a pure integer`,
          },
        ]);
        return false;
      }
      if (/\s/.test(key)) {
        modelPricingErrorsToDisplay.value.push([
          {
            field: "model_pricing_name",
            message: `Model pricing - ${index}: usage key "${key}" must not contain spaces`,
          },
        ]);
        return false;
      }
    }
  }

  return true;
}

async function createModelPricing(jsonObj: any, index: number) {
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
      error?.response?.data?.message || "Unknown error";

    // Skip bottom snackbar for 403 — global interceptor already shows persistent top banner.
    if (error?.response?.status !== 403) {
      q.notify({
        message: `Failed to import "${jsonObj.name}": ${errorMessage}`,
        color: "negative",
        position: "bottom",
        timeout: 4000,
      });
    }

    modelPricingCreators.value.push({
      success: false,
      message: `Model pricing - ${index}: "${jsonObj.name}" creation failed\n Reason: ${errorMessage}`,
    });
    return false;
  }
}

function arrowBackFn() {
  router.push({
    name: "modelPricing",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
  emit("cancel:hideform");
}
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
