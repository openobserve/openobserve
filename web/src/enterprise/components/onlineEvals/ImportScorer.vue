<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <base-import
    ref="baseImportRef"
    :title="t('onlineEvals.scorer.import.title')"
    test-prefix="scorer"
    :is-importing="isImporting"
    container-style="height: calc(100vh - var(--navbar-height));"
    :editor-heights="editorHeights"
    @back="goBack"
    @cancel="goBack"
    @import="importJson"
  >
    <template #output-content>
      <div class="w-full h-full flex flex-col" style="min-width: 380px">
        <div
          v-if="errors.length"
          class="text-center text-sm font-semibold text-text-heading py-3 shrink-0"
          data-test="scorer-import-errors-title"
        >
          {{ t("onlineEvals.scorer.import.errors.title") }}
        </div>
        <div
          v-else
          class="text-center text-sm font-semibold text-text-heading py-3 shrink-0"
          data-test="scorer-import-output-title"
        >
          {{ t("onlineEvals.scorer.import.outputMessages") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />

        <div class="flex-1 min-h-0 overflow-auto">
          <div v-if="errors.length" class="p-2.5 mb-2.5">
            <div class="error-list">
              <div
                v-for="(err, errIdx) in errors"
                :key="`${err.itemIndex}-${err.field}-${errIdx}`"
                class="py-1.25 px-0 text-sm"
                :data-test="`scorer-import-error-${err.itemIndex}-${err.field}`"
              >
                <span
                  v-if="err.field === 'name'"
                  class="text-error-600"
                  data-test="scorer-import-name-error"
                >
                  {{ err.message }}
                  <div class="mt-1" style="width: 320px">
                    <OInput
                      :data-test="`scorer-import-name-input-${err.itemIndex}`"
                      v-model="nameFixers[err.itemIndex]"
                      label="Name *"
                      @update:model-value="updateName(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'nameConflict'"
                  class="text-error-600"
                  data-test="scorer-import-name-conflict-error"
                >
                  {{ err.message }}
                  <div class="mt-1" style="width: 320px">
                    <OInput
                      :data-test="`scorer-import-rename-input-${err.itemIndex}`"
                      v-model="nameFixers[err.itemIndex]"
                      label="New Name *"
                      @update:model-value="updateName(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'type'"
                  class="text-error-600"
                  data-test="scorer-import-type-error"
                >
                  {{ err.message }}
                  <div class="mt-1" style="width: 320px">
                    <OSelect
                      :data-test="`scorer-import-type-select-${err.itemIndex}`"
                      v-model="typeFixers[err.itemIndex]"
                      :options="typeOptions"
                      label="Type *"
                      @update:model-value="updateType(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'scoreConfigRef'"
                  class="text-error-600"
                  data-test="scorer-import-score-config-ref-error"
                >
                  {{ err.message }}
                  <div class="mt-1" style="width: 320px">
                    <OSelect
                      :data-test="`scorer-import-score-config-select-${err.itemIndex}`"
                      v-model="scoreConfigFixers[err.itemIndex]"
                      :options="scoreConfigOptions"
                      label="Score Config *"
                      @update:model-value="updateScoreConfigRef(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span
                  v-else-if="err.field === 'providerRef'"
                  class="text-error-600"
                  data-test="scorer-import-provider-ref-error"
                >
                  {{ err.message }}
                  <div class="mt-1" style="width: 320px">
                    <OSelect
                      :data-test="`scorer-import-provider-select-${err.itemIndex}`"
                      v-model="providerFixers[err.itemIndex]"
                      :options="providerOptions"
                      label="Provider *"
                      @update:model-value="updateProviderRef(err.itemIndex, $event)"
                    />
                  </div>
                </span>

                <span v-else class="text-error-600">{{ err.message }}</span>
              </div>
            </div>
          </div>

          <div v-if="creators.length" class="p-2.5 mb-2.5">
            <div class="section-title text-text-heading text-base mb-2.5 uppercase" data-test="scorer-import-creation-title">
              {{ t("onlineEvals.scorer.import.creation") }}
            </div>
            <div
              v-for="(c, i) in creators"
              :key="`${i}-${c.name}`"
              class="error-list"
              :data-test="`scorer-import-creation-${i}`"
            >
              <div
                :class="{
                  'py-1.25 px-0 text-sm font-bold': true,
                  'text-status-success-text': c.status === 'success',
                  'text-error-600': c.status === 'error',
                  'text-text-secondary': c.status === 'exists',
                }"
                :data-test="`scorer-import-creation-${i}-message`"
              >
                <pre class="whitespace-pre-wrap font-[inherit] m-0">{{ c.message }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </base-import>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";

import BaseImport from "@/components/common/BaseImport.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import onlineEvalsService, {
  type Provider,
  type ScoreConfig,
  type Scorer,
  type ScorerType,
} from "@/services/online-evals.service";
import {
  prepareScorerImport,
  type ScorerImportError,
  type ScorerPayload,
} from "./utils/importScorer";

const props = defineProps<{
  orgId: string;
  existingScorers: Scorer[];
  scoreConfigs: ScoreConfig[];
  providers: Provider[];
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "saved"): void;
}>();

const { t } = useI18n();

const baseImportRef = ref<any>(null);
const isImporting = ref(false);
const existingScorers = toRef(props, "existingScorers");
const scoreConfigs = toRef(props, "scoreConfigs");
const providers = toRef(props, "providers");

const errors = ref<ScorerImportError[]>([]);
const creators = ref<Array<{ name: string; status: "success" | "error" | "exists"; message: string }>>([]);

// Inline-fixer state, indexed by itemIndex in the imported batch.
const nameFixers = reactive<Record<number, string>>({});
const typeFixers = reactive<Record<number, ScorerType>>({});
const scoreConfigFixers = reactive<Record<number, string>>({});
const providerFixers = reactive<Record<number, string>>({});

const typeOptions = [
  { label: "LLM Judge", value: "llm_judge" },
  { label: "Remote", value: "remote" },
];

const scoreConfigOptions = computed(() =>
  scoreConfigs.value.map((sc) => ({
    label: sc.name,
    value: String((sc as any).entityId ?? (sc as any).entity_id ?? sc.id),
  })),
);

const providerOptions = computed(() =>
  providers.value.map((p) => ({ label: p.name, value: String(p.id) })),
);

const editorHeights = computed(() => ({
  urlEditor: "calc(100vh - 266px)",
  fileEditor: "calc(100vh - 296px)",
  outputContainer: "calc(100vh - 130px)",
  errorReport: "calc(100vh - 192px)",
}));

const orgId = computed(() => props.orgId);

function goBack() {
  emit("cancel");
}

function resetBaseImportFlag() {
  if (baseImportRef.value) baseImportRef.value.isImporting = false;
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

function ensureScorerEnvelope(item: any): Record<string, any> {
  if (!item.scorer || typeof item.scorer !== "object") item.scorer = {};
  if (!item.scorer.params || typeof item.scorer.params !== "object") item.scorer.params = {};
  return item.scorer;
}

function updateName(itemIndex: number, value: string | number) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  arr[itemIndex].name = value;
  syncEditor(arr);
}

function updateType(itemIndex: number, value: SelectModelValue) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  const scorer = ensureScorerEnvelope(arr[itemIndex]);
  scorer.type = value;
  syncEditor(arr);
}

function updateScoreConfigRef(itemIndex: number, value: SelectModelValue) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  const scorer = ensureScorerEnvelope(arr[itemIndex]);
  scorer.producesScoreConfigId = value;
  // Also embed the name so the JSON stays self-describing for future re-imports.
  const sc = scoreConfigs.value.find(
    (c) => String((c as any).entityId ?? (c as any).entity_id ?? c.id) === value,
  );
  if (sc) scorer.producesScoreConfigName = sc.name;
  syncEditor(arr);
}

function updateProviderRef(itemIndex: number, value: SelectModelValue) {
  const arr = getBatch();
  if (!arr || !arr[itemIndex]) return;
  const scorer = ensureScorerEnvelope(arr[itemIndex]);
  scorer.params.provider_id = value;
  const prov = providers.value.find((p) => String(p.id) === value);
  if (prov) scorer.params.providerName = prov.name;
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
      if (!jsonStr || !jsonStr.trim()) throw new Error("JSON is empty");
      const parsed = JSON.parse(jsonStr);
      rawItems = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e: any) {
      toast({ message: e.message || "Invalid JSON format", variant: "error" });
      resetBaseImportFlag();
      return;
    }
  }

  const prepared = prepareScorerImport(rawItems, {
    existingScorerNames: existingScorers.value,
    scoreConfigs: scoreConfigs.value,
    providers: providers.value,
  });

  // Seed inline fixers from the current raw values.
  for (const item of prepared.items) {
    for (const e of item.errors) {
      const raw: any = rawItems[e.itemIndex] ?? {};
      const scorer = raw.scorer ?? raw;

      if ((e.field === "name" || e.field === "nameConflict") && nameFixers[e.itemIndex] === undefined) {
        nameFixers[e.itemIndex] = typeof raw.name === "string" ? raw.name : "";
      }
      if (e.field === "type" && typeFixers[e.itemIndex] === undefined) {
        const current = scorer?.type ?? scorer?.scorerType ?? scorer?.scorer_type;
        typeFixers[e.itemIndex] = (current as ScorerType) ?? "llm_judge";
      }
      if (e.field === "scoreConfigRef" && scoreConfigFixers[e.itemIndex] === undefined) {
        scoreConfigFixers[e.itemIndex] = "";
      }
      if (e.field === "providerRef" && providerFixers[e.itemIndex] === undefined) {
        providerFixers[e.itemIndex] = "";
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
    .filter((p): p is ScorerPayload => p !== null);

  const results = await Promise.allSettled(
    payloads.map((payload) =>
      onlineEvalsService.scorers.create(orgId.value, payload as any).then(
        () => ({ status: "success" as const, name: payload.name }),
        (err: any) => {
          if (err?.response?.status === 409) {
            return { status: "exists" as const, name: payload.name };
          }
          const msg = err?.response?.data?.message || err?.message || "Unknown error";
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
        message: `"${v.name}" created successfully`,
      });
    } else if (v.status === "exists") {
      creators.value.push({
        name: v.name,
        status: "exists",
        message: `"${v.name}" already exists — skipped`,
      });
    } else {
      creators.value.push({
        name: v.name,
        status: "error",
        message: `"${v.name}" failed: ${v.message}`,
      });
    }
  }

  isImporting.value = false;
  resetBaseImportFlag();

  if (successCount === payloads.length) {
    toast({
      message: `Successfully imported ${successCount} scorer(s)`,
      variant: "success",
    });
    setTimeout(() => emit("saved"), 500);
  } else if (successCount > 0) {
    toast({
      message: `Imported ${successCount} of ${payloads.length} scorer(s)`,
      variant: "warning",
    });
    emit("saved");
  }
}
</script>
