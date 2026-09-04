<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <BaseImport
    ref="baseImportRef"
    :title="t('onlineEvals.scoreConfig.import.title')"
    test-prefix="score-config"
    :is-importing="isImporting"
    container-style="height: calc(100vh - var(--navbar-height));"
    :editor-heights="editorHeights"
    @back="goBack"
    @cancel="goBack"
    @import="importJson"
  >
    <template #output-content>
      <div class="flex h-full w-full min-w-[23.75rem] flex-col">
        <div
          v-if="errors.length"
          class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold"
          data-test="score-config-import-errors-title"
        >
          {{ t("onlineEvals.scoreConfig.import.errors.title") }}
        </div>
        <div
          v-else
          class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold"
          data-test="score-config-import-output-title"
        >
          {{ t("onlineEvals.scoreConfig.import.outputMessages") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />

        <div class="min-h-0 flex-1 overflow-auto">
          <div v-if="errors.length" class="mb-2.5 p-2.5">
            <div class="error-list">
              <div
                v-for="(err, errIdx) in errors"
                :key="`${err.itemIndex}-${err.field}-${errIdx}`"
                class="py-1.25 text-sm"
                :data-test="`score-config-import-error-${err.itemIndex}-${err.field}`"
              >
                <span
                  v-if="err.field === 'name'"
                  class="text-error-600"
                  data-test="score-config-import-name-error"
                >
                  {{ err.message }}
                  <div class="mt-1 w-80">
                    <OInput
                      :data-test="`score-config-import-name-input-${err.itemIndex}`"
                      v-model="nameFixers[err.itemIndex]"
                      :label="t('onlineEvals.importNameRequired')"
                      @update:model-value="updateName(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'nameConflict'"
                  class="text-error-600"
                  data-test="score-config-import-name-conflict-error"
                >
                  {{ err.message }}
                  <div class="mt-1 w-80">
                    <OInput
                      :data-test="`score-config-import-rename-input-${err.itemIndex}`"
                      v-model="nameFixers[err.itemIndex]"
                      :label="t('onlineEvals.importNewNameRequired')"
                      @update:model-value="updateName(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'dataType'"
                  class="text-error-600"
                  data-test="score-config-import-datatype-error"
                >
                  {{ err.message }}
                  <div class="mt-1 w-80">
                    <OSelect
                      :data-test="`score-config-import-datatype-select-${err.itemIndex}`"
                      v-model="dataTypeFixers[err.itemIndex]"
                      :options="dataTypeOptions"
                      :label="t('onlineEvals.importDataTypeRequired')"
                      @update:model-value="updateDataType(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'numericRange' && numericRangeFixers[err.itemIndex]"
                  class="text-error-600"
                  data-test="score-config-import-numeric-range-error"
                >
                  {{ err.message }}
                  <div class="mt-1 flex w-80 gap-2">
                    <OInput
                      :data-test="`score-config-import-min-input-${err.itemIndex}`"
                      v-model="numericRangeFixers[err.itemIndex].min"
                      :label="t('onlineEvals.importMinRequired')"
                      type="number"
                      @update:model-value="updateNumericRange(err.itemIndex)"
                    />
                    <OInput
                      :data-test="`score-config-import-max-input-${err.itemIndex}`"
                      v-model="numericRangeFixers[err.itemIndex].max"
                      :label="t('onlineEvals.importMaxRequired')"
                      type="number"
                      @update:model-value="updateNumericRange(err.itemIndex)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'categories'"
                  class="text-error-600"
                  data-test="score-config-import-categories-error"
                >
                  {{ err.message }}
                  <div class="mt-1 w-80">
                    <OInput
                      :data-test="`score-config-import-categories-input-${err.itemIndex}`"
                      v-model="categoriesFixers[err.itemIndex]"
                      :label="t('onlineEvals.importCategoriesRequired')"
                      :placeholder="t('onlineEvals.importCategoriesPlaceholder')"
                      @update:model-value="updateCategories(err.itemIndex, $event as string)"
                    />
                  </div>
                </span>

                <span v-else class="text-error-600">{{ err.message }}</span>
              </div>
            </div>
          </div>

          <div v-if="creators.length" class="mb-2.5 p-2.5">
            <div
              class="text-text-heading mb-2.5 text-base uppercase"
              data-test="score-config-import-creation-title"
            >
              {{ t("onlineEvals.scoreConfig.import.creation") }}
            </div>
            <div
              v-for="(c, i) in creators"
              :key="`${i}-${c.name}`"
              class="error-list"
              :data-test="`score-config-import-creation-${i}`"
            >
              <div
                :class="{
                  'px-0 py-1.25 text-sm font-bold': true,
                  'text-status-success-text': c.status === 'success',
                  'text-error-600': c.status === 'error',
                  'text-text-secondary': c.status === 'exists',
                }"
                :data-test="`score-config-import-creation-${i}-message`"
              >
                <pre class="m-0 font-[inherit] whitespace-pre-wrap">{{ c.message }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseImport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRef } from "vue";
import { useI18nTyped } from "@/types/i18n";

import BaseImport from "@/components/common/BaseImport.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import onlineEvalsService, {
  type ScoreConfig,
  type ScoreDataType,
} from "@/services/online-evals.service";
import {
  prepareScoreConfigImport,
  type ScoreConfigImportError,
  type ScoreConfigPayload,
} from "./utils/importScoreConfig";

const props = defineProps<{
  orgId: string;
  existingScoreConfigs: ScoreConfig[];
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "saved"): void;
}>();

const { t } = useI18nTyped();

const baseImportRef = ref<any>(null);
const isImporting = ref(false);
const existingScoreConfigs = toRef(props, "existingScoreConfigs");

const errors = ref<ScoreConfigImportError[]>([]);
const creators = ref<
  Array<{ name: string; status: "success" | "error" | "exists"; message: string }>
>([]);

// Local inline-fixer state. Indexed by itemIndex in the imported batch.
const nameFixers = reactive<Record<number, string>>({});
const dataTypeFixers = reactive<Record<number, ScoreDataType>>({});
const numericRangeFixers = reactive<Record<number, { min: string; max: string }>>({});
const categoriesFixers = reactive<Record<number, string>>({});

const dataTypeOptions = [
  { label: t("onlineEvals.scoreConfig.dataTypes.numeric"), value: "numeric" },
  { label: t("onlineEvals.scoreConfig.dataTypes.categorical"), value: "categorical" },
  { label: t("onlineEvals.scoreConfig.dataTypes.boolean"), value: "boolean" },
];

const editorHeights = computed(() => ({
  // eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent
  urlEditor: "calc(100vh - 266px)",
  // eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent
  fileEditor: "calc(100vh - 296px)",
  // eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent
  outputContainer: "calc(100vh - 130px)",
  // eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent
  errorReport: "calc(100vh - 192px)",
}));

const orgId = computed(() => props.orgId);

function goBack() {
  emit("cancel");
}

function resetBaseImportFlag() {
  if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
}

function syncEditor(items: any[]) {
  if (baseImportRef.value?.updateJsonArray) {
    baseImportRef.value.updateJsonArray(items, true);
  }
}

function getBatch(): any[] | null {
  const arr = baseImportRef.value?.jsonArrayOfObj;
  if (Array.isArray(arr) && arr.length > 0) return arr;
  const str = baseImportRef.value?.jsonStr;
  if (!str) return null;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function updateName(itemIndex: number, value: string | number) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  arr[itemIndex].name = value;
  syncEditor(arr);
}

function updateDataType(itemIndex: number, value: SelectModelValue) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  arr[itemIndex].dataType = value;
  syncEditor(arr);
}

function updateNumericRange(itemIndex: number) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  const fix = numericRangeFixers[itemIndex];
  const min = Number(fix?.min);
  const max = Number(fix?.max);
  // Write numbers when both parse cleanly; otherwise keep the raw strings so
  // the validator surfaces a precise error rather than silently coercing.
  arr[itemIndex].numericRange = {
    min: fix?.min !== "" && !Number.isNaN(min) ? min : fix?.min,
    max: fix?.max !== "" && !Number.isNaN(max) ? max : fix?.max,
  };
  syncEditor(arr);
}

function updateCategories(itemIndex: number, value: string) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  arr[itemIndex].categories = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  syncEditor(arr);
}

async function importJson({ jsonStr, jsonArray }: { jsonStr: string; jsonArray: any[] }) {
  errors.value = [];
  creators.value = [];

  let rawItems: any[];
  if (Array.isArray(jsonArray) && jsonArray.length > 0) {
    rawItems = jsonArray;
  } else {
    try {
      if (!jsonStr || !jsonStr.trim()) throw new Error(t("onlineEvals.jsonIsEmpty"));
      const parsed = JSON.parse(jsonStr);
      rawItems = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e: any) {
      toast({ message: e.message || t("onlineEvals.invalidJsonFormat"), variant: "error" });
      resetBaseImportFlag();
      return;
    }
  }

  const prepared = prepareScoreConfigImport(rawItems, existingScoreConfigs.value, t);

  // Seed inline fixers from current values so users see the existing data
  // they're about to overwrite, rather than empty inputs.
  for (const item of prepared.items) {
    for (const e of item.errors) {
      const raw: any = rawItems[e.itemIndex] ?? {};
      if (
        (e.field === "name" || e.field === "nameConflict") &&
        nameFixers[e.itemIndex] === undefined
      ) {
        nameFixers[e.itemIndex] = typeof raw.name === "string" ? raw.name : "";
      }
      if (e.field === "dataType" && dataTypeFixers[e.itemIndex] === undefined) {
        const current = raw.dataType ?? raw.data_type;
        dataTypeFixers[e.itemIndex] = (current as ScoreDataType) ?? "numeric";
      }
      if (e.field === "numericRange" && numericRangeFixers[e.itemIndex] === undefined) {
        const range = raw.numericRange ?? raw.numeric_range ?? {};
        numericRangeFixers[e.itemIndex] = {
          min: range?.min !== undefined && range?.min !== null ? String(range.min) : "",
          max: range?.max !== undefined && range?.max !== null ? String(range.max) : "",
        };
      }
      if (e.field === "categories" && categoriesFixers[e.itemIndex] === undefined) {
        const cats = Array.isArray(raw.categories) ? raw.categories : [];
        categoriesFixers[e.itemIndex] = cats.filter((c: any) => typeof c === "string").join(", ");
      }
    }
  }

  if (prepared.hasErrors) {
    errors.value = prepared.errors;
    resetBaseImportFlag();
    return;
  }

  isImporting.value = true;
  const payloads = prepared.items
    .map((i) => i.payload)
    .filter((p): p is ScoreConfigPayload => p !== null);

  const results = await Promise.allSettled(
    payloads.map((payload) =>
      onlineEvalsService.scoreConfigs.create(orgId.value, payload).then(
        () => ({ status: "success" as const, name: payload.name }),
        (err: any) => {
          if (err?.response?.status === 409) {
            return { status: "exists" as const, name: payload.name };
          }
          const msg = err?.response?.data?.message || err?.message || t("onlineEvals.unknownError");
          return { status: "error" as const, name: payload.name, message: msg };
        },
      ),
    ),
  );

  let successCount = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const v = r.value;
    if (v.status === "success") {
      successCount++;
      creators.value.push({
        name: v.name,
        status: "success",
        message: t("onlineEvals.import.createdSuccessfully", { name: v.name }),
      });
    } else if (v.status === "exists") {
      creators.value.push({
        name: v.name,
        status: "exists",
        message: t("onlineEvals.import.alreadyExistsSkipped", { name: v.name }),
      });
    } else {
      creators.value.push({
        name: v.name,
        status: "error",
        message: t("onlineEvals.import.failedWithReason", { name: v.name, reason: v.message }),
      });
    }
  }

  isImporting.value = false;
  resetBaseImportFlag();

  if (successCount === payloads.length) {
    toast({
      message: t("toastMessages.onlineEvals.successfullyImportedScoreConfigs", {
        count: successCount,
      }),
      variant: "success",
    });
    setTimeout(() => emit("saved"), 500);
  } else if (successCount > 0) {
    toast({
      message: t("toastMessages.onlineEvals.importedOfScoreConfigs", {
        imported: successCount,
        count: payloads.length,
      }),
      variant: "warning",
    });
    emit("saved");
  }
}
</script>
