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
    container-class="flex-1 min-h-0"
    container-style=""
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
          v-if="modelPricingErrorsToDisplay.length > 0"
          class="text-center text-sm font-semibold text-text-heading py-3 shrink-0"
        >
          {{ t("modelPricing.errorValidations") }}
        </div>
        <div v-else class="text-center text-sm font-semibold text-text-heading py-3 shrink-0">
          {{ t("modelPricing.outputMessages") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />
        <div class="flex-1 min-h-0 overflow-auto resize-none">
          <!-- Model Pricing Errors Section -->
          <div class="p-2.5 mb-2.5" v-if="modelPricingErrorsToDisplay.length > 0">
            <div>
              <div v-for="(errorGroup, index) in modelPricingErrorsToDisplay" :key="index">
                <div
                  v-for="(errorMessage, errorIndex) in errorGroup"
                  :key="errorIndex"
                  class="py-1.25 text-sm"
                  :data-test="`model-pricing-import-error-${index}-${errorIndex}`"
                >
                  <span
                    data-test="model-pricing-import-name-error"
                    class="text-status-negative"
                    v-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'model_pricing_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <OInput
                        data-test="model-pricing-import-name-input"
                        v-model="userSelectedModelPricingName[index]"
                        :label="t('modelPricing.modelNameLabel')"
                        @update:model-value="
                          updateModelPricingName(userSelectedModelPricingName[index], index)
                        "
                      />
                    </div>
                  </span>
                  <span
                    data-test="model-pricing-import-pattern-error"
                    class="text-status-negative"
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
                        @update:model-value="
                          updateModelPricingPattern(userSelectedModelPricingPattern[index], index)
                        "
                      />
                    </div>
                  </span>
                  <span class="text-status-negative" v-else>{{ errorMessage }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="p-2.5 mb-2.5" v-if="modelPricingCreators.length > 0">
            <div
              class="text-base mb-2.5 uppercase text-primary"
              data-test="model-pricing-import-creation-title"
            >
              {{ t("modelPricing.modelPricingCreation") }}
            </div>
            <div
              class=""
              v-for="(val, index) in modelPricingCreators"
              :key="index"
              :data-test="`model-pricing-import-creation-${index}`"
            >
              <div
                :class="{
                  'py-1.25 text-sm font-bold': true,
                  'text-green ': val.success,
                  'text-status-negative': !val.success,
                }"
                :data-test="`model-pricing-import-creation-${index}-message`"
              >
                <pre
                  class="creators-message whitespace-pre-wrap max-w-full"
                  style="word-wrap: break-word; overflow-wrap: break-word; word-break: break-word"
                  >{{ val.message }}</pre
                >
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

import BaseImport from "../common/BaseImport.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

import modelPricingService from "@/services/model_pricing";
import { toast } from "@/lib/feedback/Toast/useToast";

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
    icon: "upload",
  },
  {
    label: t("modelPricing.urlImportTab"),
    value: "import_json_url",
    icon: "link",
  },
]);

function updateModelPricingName(name: string, index: number) {
  if (baseImportRef.value?.jsonArrayOfObj[index]) {
    baseImportRef.value.jsonArrayOfObj[index].name = name;
    baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
  }
}

function updateModelPricingPattern(pattern: string, index: number) {
  if (baseImportRef.value?.jsonArrayOfObj[index]) {
    baseImportRef.value.jsonArrayOfObj[index].match_pattern = pattern;
    baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
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
      throw new Error(t("settings.importModelPricing.jsonEmpty"));
    }

    const parsedJson = JSON.parse(jsonString);
    jsonArrayOfObj.value = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
  } catch (e: any) {
    toast({
      message: e.message || t("settings.importModelPricing.invalidJsonFormat"),
      variant: "error",
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
          message: t("settings.importModelPricing.duplicateNameInBatch", {
            index: index + 1,
            name: jsonObj.name,
          }),
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
    toast({
      message:
        successCount !== 1
          ? t("settings.importModelPricing.importedPlural", {
              count: successCount,
            })
          : t("settings.importModelPricing.importedSingular", {
              count: successCount,
            }),
      variant: "success",
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
    toast({
      message: t("settings.importModelPricing.errorImporting"),
      variant: "error",
    });
    return false;
  }
}

async function validateModelPricingInputs(jsonObj: any, index: number) {
  if (!jsonObj.name || !jsonObj.name.trim() || typeof jsonObj.name !== "string") {
    modelPricingErrorsToDisplay.value.push([
      {
        field: "model_pricing_name",
        message: t("settings.importModelPricing.nameRequired", { index }),
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
        message: t("settings.importModelPricing.matchPatternRequired", {
          index,
        }),
      },
    ]);
    return false;
  }

  // Check for duplicate name against existing models in the org
  if (props.existingModels?.includes(jsonObj.name)) {
    modelPricingErrorsToDisplay.value.push([
      {
        field: "model_pricing_name",
        message: t("settings.importModelPricing.nameAlreadyExists", {
          index,
          name: jsonObj.name,
        }),
      },
    ]);
    return false;
  }

  if (!Array.isArray(jsonObj.tiers) || jsonObj.tiers.length === 0) {
    modelPricingErrorsToDisplay.value.push([
      t("settings.importModelPricing.tiersNonEmpty", { index }),
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
            message: t("settings.importModelPricing.usageKeyInteger", {
              index,
              key,
            }),
          },
        ]);
        return false;
      }
      if (/\s/.test(key)) {
        modelPricingErrorsToDisplay.value.push([
          {
            field: "model_pricing_name",
            message: t("settings.importModelPricing.usageKeySpaces", {
              index,
              key,
            }),
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
      message: t("settings.importModelPricing.createdSuccessfully", {
        index,
        name: jsonObj.name,
      }),
    });
    return true;
  } catch (error: any) {
    const errorMessage =
      error?.response?.data?.message || t("settings.importModelPricing.unknownError");

    // Skip bottom snackbar for 403 — global interceptor already shows persistent top banner.
    if (error?.response?.status !== 403) {
      toast({
        message: t("settings.importModelPricing.failedToImport", {
          name: jsonObj.name,
          error: errorMessage,
        }),
        variant: "error",
      });
    }

    modelPricingCreators.value.push({
      success: false,
      message: t("settings.importModelPricing.creationFailed", {
        index,
        name: jsonObj.name,
        reason: errorMessage,
      }),
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
