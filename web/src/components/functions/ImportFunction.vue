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
    :title="t('function.import.title')"
    :back="{
      label: t('function.header'),
      onClick: goBack,
      dataTest: 'function-import-back-btn',
    }"
    bleed
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="function-import-cancel-btn"
        @click="goBack"
      >
        {{ t("function.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        type="submit"
        data-test="function-import-json-btn"
        :loading="isImporting"
        :disabled="isImporting"
        @click="triggerImport"
      >
        {{ t("common.import") }}
      </OButton>
    </template>

    <BaseImport
      ref="baseImportRef"
      :title="t('function.import.title')"
      test-prefix="function"
      hide-header
      container-class="flex-1 min-h-0"
      container-style=""
      :is-importing="isImporting"
      @back="goBack"
      @cancel="goBack"
      @import="importJson"
    >
      <template #output-content>
        <div
          class="border-border-default flex h-full w-full min-w-100 flex-col border-s max-md:min-w-0!"
        >
          <div class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold">
            {{
              functionErrors.length > 0
                ? t("function.import.errorValidations")
                : t("function.import.outputMessages")
            }}
          </div>
          <OSeparator class="mt-1 shrink-0" />
          <div class="min-h-0 flex-1 overflow-auto">
            <div v-if="functionErrors.length > 0" class="mb-2.5 p-2.5">
              <div
                v-for="(errorGroup, index) in functionErrors"
                :key="index"
                :data-test="`function-import-error-${index}`"
              >
                <div
                  v-for="(errorMessage, errorIndex) in errorGroup"
                  :key="errorIndex"
                  class="py-1.25 text-sm"
                  :data-test="`function-import-error-${index}-${errorIndex}`"
                >
                  <span
                    v-if="typeof errorMessage === 'object' && errorMessage.field === 'name_exists'"
                    class="text-status-negative"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75 py-2">
                      <OSelect
                        :data-test="`function-import-conflict-select-${errorMessage.itemIndex}`"
                        :model-value="conflictChoice[errorMessage.itemIndex] ?? USE_EXISTING"
                        :options="conflictOptions"
                        :label="t('function.import.conflictActionLabel')"
                        @update:model-value="
                          (val: any) => onConflictChoice(errorMessage.itemIndex, val)
                        "
                      />
                      <div
                        v-if="
                          conflictChoice[errorMessage.itemIndex] === OVERRIDE &&
                          dependentPipelines[errorMessage.name]?.length
                        "
                        class="text-text-secondary pt-2 text-xs"
                        :data-test="`function-import-override-dependents-${errorMessage.itemIndex}`"
                      >
                        {{
                          t("function.import.overrideAffects", {
                            pipelines: dependentPipelines[errorMessage.name].join(", "),
                          })
                        }}
                      </div>
                    </div>
                  </span>
                  <span
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field === 'function_name'
                    "
                    class="text-status-negative"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75 py-2">
                      <OInput
                        :data-test="`function-import-name-input-${errorMessage.itemIndex}`"
                        :model-value="userSelectedName[errorMessage.itemIndex] ?? ''"
                        :label="t('function.import.nameLabel')"
                        @update:model-value="
                          (val: any) => updateFunctionName(String(val), errorMessage.itemIndex)
                        "
                      />
                    </div>
                  </span>
                  <span v-else class="text-status-negative">{{ errorMessage }}</span>
                </div>
              </div>
            </div>

            <div v-if="importResults.length > 0" class="mb-2.5 p-2.5">
              <div class="text-primary mb-2.5 text-base" data-test="function-import-results-title">
                {{ t("function.import.results") }}
              </div>
              <div
                v-for="(result, index) in importResults"
                :key="index"
                class="py-1.25 text-sm font-bold whitespace-pre-wrap"
                :class="resultClass(result.status)"
                :data-test="`function-import-result-${index}`"
              >
                {{ result.message }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </BaseImport>
  </OPageLayout>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import BaseImport from "../common/BaseImport.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import jsTransformService from "@/services/jstransform";
import { functionsQuery, saveFunctionMutation } from "@/services/jstransform.queries";
import { useOrgId } from "@/composables/query/useOrgId";

type ImportStatus = "created" | "overridden" | "skipped" | "failed";

type ImportError =
  | I18nText
  | {
      field: "function_name" | "name_exists";
      message: I18nText;
      itemIndex: number;
      name: string;
    };

const USE_EXISTING = "use_existing";
const OVERRIDE = "override";

export default defineComponent({
  name: "ImportFunction",
  components: {
    OPageLayout,
    OButton,
    OSeparator,
    BaseImport,
    OInput: defineAsyncComponent(() => import("@/lib/forms/Input/OInput.vue")),
    OSelect: defineAsyncComponent(() => import("@/lib/forms/Select/OSelect.vue")),
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const orgId = useOrgId();

    const baseImportRef = ref<any>(null);
    const isImporting = ref(false);
    const functionErrors = ref<ImportError[][]>([]);
    const importResults = ref<{ message: I18nText; status: ImportStatus }[]>([]);
    const userSelectedName = ref<string[]>([]);
    const conflictChoice = ref<string[]>([]);
    const dependentPipelines = ref<Record<string, string[]>>({});

    // A conflict is surfaced once and written on the next press, so the user
    // never has an existing function replaced by a click they did not make.
    const conflictsAwaitingConfirm = ref(false);

    const conflictOptions = [
      { label: t("function.import.useExisting"), value: USE_EXISTING },
      { label: t("function.import.override"), value: OVERRIDE },
    ];

    const existingFunctions = useQuery(() =>
      Object.assign(functionsQuery(orgId.value), { enabled: !!orgId.value }),
    );

    // Set at each call site, so one declared mutation covers both create and override.
    const isOverride = ref(false);
    const saveFunction = useMutation(() =>
      saveFunctionMutation(orgId.value, () => isOverride.value),
    );

    const goBack = () => {
      router.push({
        name: "functionList",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    };

    const triggerImport = () => baseImportRef.value?.handleImport();

    const resultClass = (status: ImportStatus) => {
      if (status === "failed") return "text-status-negative";
      if (status === "skipped") return "text-text-secondary";
      return "text-status-positive";
    };

    // Under RBAC the list is filtered to what the user may read, so a name can
    // exist without appearing here; the server's 400 is what reveals it.
    const serverReportedExisting = ref<Set<string>>(new Set());

    const nameExists = (name: string) =>
      (existingFunctions.data.value ?? []).some((fn: any) => fn.name === name) ||
      serverReportedExisting.value.has(name);

    const writeBackToEditor = () => {
      if (!baseImportRef.value) return;
      baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
    };

    const updateFunctionName = (name: string, index: number) => {
      userSelectedName.value[index] = name;
      const item = baseImportRef.value?.jsonArrayOfObj?.[index];
      if (!item) return;
      item.name = name;
      writeBackToEditor();
    };

    const onConflictChoice = async (index: number, choice: string) => {
      conflictChoice.value[index] = choice;
      const name = baseImportRef.value?.jsonArrayOfObj?.[index]?.name;
      if (choice !== OVERRIDE || !name || dependentPipelines.value[name]) return;
      try {
        const res: any = await jsTransformService.getAssociatedPipelines(orgId.value, name);
        dependentPipelines.value[name] = (res.data.list ?? []).map((p: any) => p.name);
      } catch (err) {
        console.error("Error while reading function dependencies", err);
      }
    };

    const validate = (item: any, index: number, itemIndex: number) => {
      const errors: ImportError[] = [];

      if (!item?.name || typeof item.name !== "string" || !item.name.trim()) {
        errors.push({
          field: "function_name",
          message: t("function.import.nameRequired", { index }),
          itemIndex,
          name: "",
        });
      } else if (nameExists(item.name) && conflictsAwaitingConfirm.value === false) {
        errors.push({
          field: "name_exists",
          message: t("function.import.nameExists", { index, name: item.name }),
          itemIndex,
          name: item.name,
        });
      }

      if (!item?.function || typeof item.function !== "string" || !item.function.trim()) {
        errors.push(t("function.import.bodyRequired", { index }));
      }

      const transType = item?.transType ?? 0;
      if (![0, 1, "0", "1"].includes(transType)) {
        errors.push(t("function.import.transTypeInvalid", { index }));
      }

      if (item?.params !== undefined && typeof item.params !== "string") {
        errors.push(t("function.import.paramsInvalid", { index }));
      }

      return errors;
    };

    const conflictError = (item: any, index: number, itemIndex: number): ImportError => ({
      field: "name_exists",
      message: t("function.import.nameExists", { index, name: item.name }),
      itemIndex,
      name: item.name,
    });

    const writeFunction = async (item: any, index: number, itemIndex: number) => {
      const override = nameExists(item.name) && conflictChoice.value[itemIndex] === OVERRIDE;
      isOverride.value = override;

      try {
        await saveFunction.mutateAsync({
          name: item.name.trim(),
          function: item.function.trim(),
          params: typeof item.params === "string" && item.params.trim() ? item.params : "row",
          transType: parseInt(String(item.transType ?? 0)),
        });
        importResults.value.push({
          message: override
            ? t("function.import.overridden", { index, name: item.name })
            : t("function.import.createSuccess", { index, name: item.name }),
          status: override ? "overridden" : "created",
        });
        return override ? "overridden" : "created";
      } catch (error: any) {
        const reason = error?.response?.data?.message ?? error?.message ?? "";
        // The name was taken after all, so the user gets the same choice a
        // visible clash would have offered rather than a dead failure line.
        if (/already exist/i.test(String(reason))) {
          serverReportedExisting.value.add(item.name);
          return "conflict";
        }
        importResults.value.push({
          message: t("function.import.createFailed", {
            index,
            name: item.name,
            reason: raw(reason) || raw("unknown error"),
          }),
          status: "failed",
        });
        return "failed";
      }
    };

    const importJson = async ({ jsonStr: jsonString }: any) => {
      functionErrors.value = [];
      importResults.value = [];

      let items: any[];
      try {
        if (!jsonString || jsonString.trim() === "") {
          throw new Error(t("function.import.jsonStringEmpty"));
        }
        const parsed = JSON.parse(jsonString);
        items = Array.isArray(parsed) ? parsed : [parsed];
        baseImportRef.value.jsonArrayOfObj = items;
      } catch (e: any) {
        toast({
          message: raw(e?.message) || t("function.import.invalidJsonFormat"),
          variant: "error",
        });
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      // A file that failed to parse leaves BaseImport holding an empty array, so
      // without this an unreadable file reports a successful import of nothing.
      if (items.length === 0) {
        toast({ message: t("function.import.nothingToImport"), variant: "error" });
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      isImporting.value = true;

      const errors = items.map((item, i) => validate(item, i + 1, i));
      const blocking = errors.filter((group) => group.length > 0);
      if (blocking.length > 0) {
        functionErrors.value = blocking;
        // The next press acts on the choices now on screen rather than re-reporting them.
        conflictsAwaitingConfirm.value = true;
        isImporting.value = false;
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      let written = 0;
      let failed = 0;
      let skipped = 0;
      const lateConflicts: ImportError[][] = [];
      for (const [itemIndex, item] of items.entries()) {
        const index = itemIndex + 1;
        if (nameExists(item.name) && conflictChoice.value[itemIndex] !== OVERRIDE) {
          importResults.value.push({
            message: t("function.import.skipped", { index, name: item.name }),
            status: "skipped",
          });
          skipped++;
          continue;
        }
        const outcome = await writeFunction(item, index, itemIndex);
        if (outcome === "conflict") {
          lateConflicts.push([conflictError(item, index, itemIndex)]);
        } else if (outcome === "failed") {
          failed++;
        } else {
          written++;
        }
      }

      if (lateConflicts.length > 0) {
        functionErrors.value = [...functionErrors.value, ...lateConflicts];
      }

      // Nothing was written, so the run stays on screen with its skipped lines
      // rather than reporting an import that did not happen.
      if (failed === 0 && lateConflicts.length === 0 && written === 0 && skipped > 0) {
        toast({
          message: t("function.import.allSkipped", { count: skipped }, skipped),
          variant: "info",
        });
      } else if (failed === 0 && lateConflicts.length === 0) {
        toast({
          message: t("function.import.importSuccess", { count: written }, written),
          variant: "success",
        });
        setTimeout(goBack, 400);
      }

      // Held across the press only while a conflict is still on screen awaiting a choice.
      conflictsAwaitingConfirm.value = lateConflicts.length > 0;
      isImporting.value = false;
      if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
    };

    return {
      t,
      USE_EXISTING,
      OVERRIDE,
      baseImportRef,
      isImporting,
      functionErrors,
      importResults,
      userSelectedName,
      conflictChoice,
      conflictOptions,
      dependentPipelines,
      goBack,
      triggerImport,
      resultClass,
      updateFunctionName,
      onConflictChoice,
      importJson,
      validate,
    };
  },
});
</script>
