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
        data-test="function-import-json-btn"
        :loading="isImporting"
        :disabled="isImporting"
        @click="triggerImport"
      >
        {{ t("dashboard.import") }}
      </OButton>
    </template>

    <BaseImport
      ref="baseImportRef"
      :title="t('function.import.title')"
      test-prefix="function"
      hide-header
      container-class="flex-1 min-h-0"
      :is-importing="isImporting"
      @back="goBack"
      @cancel="goBack"
      @import="importJson"
      @update:json-str="onDocumentChanged"
      @update:json-array="onDocumentArrayChanged"
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
                  <!-- Every validation the import runs has a control here that
                       fixes it in place, the way the template and pipeline import
                       screens do. Typing writes straight back into the JSON on the
                       left, so the document and these fields never disagree. -->
                  <template v-if="typeof errorMessage === 'object'">
                    <span class="text-status-negative">{{ errorMessage.message }}</span>

                    <!-- Missing, unusable, repeated in the file, or already taken:
                         four checks, one fix — a name that is free and valid. -->
                    <div
                      v-if="
                        errorMessage.field === 'function_name' ||
                        errorMessage.field === 'name_exists'
                      "
                      class="w-75 py-2"
                    >
                      <OInput
                        :data-test="`function-import-name-input-${errorMessage.itemIndex}`"
                        :model-value="userSelectedName[errorMessage.itemIndex] ?? errorMessage.name"
                        :label="t('function.import.nameLabel')"
                        :disabled="overrideExisting[errorMessage.name] === true"
                        :error="!!nameInputError[errorMessage.itemIndex]"
                        :error-message="nameInputError[errorMessage.itemIndex] ?? undefined"
                        @update:model-value="
                          (val: any) => updateFunctionName(String(val), errorMessage.itemIndex)
                        "
                      />

                      <!-- Replacing what is already there is the other way out of
                           a clash, but it is a deliberate second choice rather
                           than the default the name box offers. -->
                      <div v-if="errorMessage.field === 'name_exists'" class="pt-3">
                        <OCheckbox
                          size="sm"
                          :data-test="`function-import-override-checkbox-${errorMessage.itemIndex}`"
                          :model-value="overrideExisting[errorMessage.name] === true"
                          :label="t('function.import.overrideExisting')"
                          @update:model-value="
                            (val: any) =>
                              onOverrideChoice(
                                errorMessage.name,
                                errorMessage.itemIndex,
                                val === true,
                              )
                          "
                        />
                        <div
                          v-if="
                            overrideExisting[errorMessage.name] &&
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
                    </div>

                    <!-- The body is the function. A plain text box would make VRL
                         unreadable, so it gets the same editor the Add form uses,
                         in the language the item declares. -->
                    <div v-else-if="errorMessage.field === 'function_body'" class="py-2">
                      <div
                        class="border-border-default rounded-default h-50 overflow-hidden border"
                      >
                        <QueryEditor
                          :editor-id="`function-import-body-editor-${errorMessage.itemIndex}`"
                          :data-test="`function-import-body-input-${errorMessage.itemIndex}`"
                          class="h-full"
                          :query="
                            userSelectedBody[errorMessage.itemIndex] ??
                            currentBody(errorMessage.itemIndex)
                          "
                          :language="bodyLanguage(errorMessage.itemIndex)"
                          :debounce-time="300"
                          :show-auto-complete="false"
                          @update:query="
                            (val: any) => updateFunctionBody(String(val), errorMessage.itemIndex)
                          "
                        />
                      </div>
                    </div>

                    <div v-else-if="errorMessage.field === 'trans_type'" class="w-75 py-2">
                      <OSelect
                        :data-test="`function-import-trans-type-input-${errorMessage.itemIndex}`"
                        :model-value="
                          userSelectedTransType[errorMessage.itemIndex] ??
                          currentTransType(errorMessage.itemIndex)
                        "
                        :options="transTypeOptions"
                        :label="t('function.import.transTypeLabel')"
                        :placeholder="t('function.import.transTypePlaceholder')"
                        @update:model-value="
                          (val: any) => updateTransType(String(val), errorMessage.itemIndex)
                        "
                      />
                    </div>

                    <div v-else-if="errorMessage.field === 'params'" class="w-75 py-2">
                      <OInput
                        :data-test="`function-import-params-input-${errorMessage.itemIndex}`"
                        :model-value="userSelectedParams[errorMessage.itemIndex] ?? 'row'"
                        :label="t('function.import.paramsLabel')"
                        :help-text="t('function.import.paramsHint')"
                        @update:model-value="
                          (val: any) => updateParams(String(val), errorMessage.itemIndex)
                        "
                      />
                    </div>
                  </template>
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
import { computed, defineAsyncComponent, defineComponent, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useMutation } from "@tanstack/vue-query";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import config from "@/aws-exports";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import BaseImport from "../common/BaseImport.vue";
import { functionNameRegex } from "./AddFunction.schema";
import { toast } from "@/lib/feedback/Toast/useToast";
import jsTransformService from "@/services/jstransform";
import { functionsQuery, saveFunctionMutation } from "@/services/jstransform.queries";
import { queryClient } from "@/composables/query/queryClient";
import { useOrgId } from "@/composables/query/useOrgId";

type ImportStatus = "created" | "overridden" | "failed";

// Each validation names its field so the output pane can show the control that fixes it.
type FieldError = {
  field: "function_name" | "name_exists" | "function_body" | "trans_type" | "params";
  message: I18nText;
  itemIndex: number;
  name: string;
};

// I18nText is a branded string, so `typeof e === "object"` separates the two arms.
type ImportError = I18nText | FieldError;

export default defineComponent({
  name: "ImportFunction",
  components: {
    OPageLayout,
    OButton,
    OSeparator,
    BaseImport,
    OInput: defineAsyncComponent(() => import("@/lib/forms/Input/OInput.vue")),
    OSelect: defineAsyncComponent(() => import("@/lib/forms/Select/OSelect.vue")),
    OCheckbox: defineAsyncComponent(() => import("@/lib/forms/Checkbox/OCheckbox.vue")),
    // Async: the body editor only appears for a rejected item, so most imports never load it.
    QueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
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

    // Keyed by position: a missing name gives nothing else to key a fix-up box by.
    const userSelectedName = ref<Record<number, string>>({});
    const userSelectedBody = ref<Record<number, string>>({});
    const userSelectedTransType = ref<Record<number, string>>({});
    const userSelectedParams = ref<Record<number, string>>({});

    // What the box says about what is typed now, not what the last press found.
    const nameInputError = ref<Record<number, I18nText | null>>({});

    // Keyed by name: index 0 of the next file is a different function.
    const overrideExisting = ref<Record<string, boolean>>({});
    const dependentPipelines = ref<Record<string, string[]>>({});

    // Names this run created, so a retry updates them instead of being refused as clashes.
    const writtenByThisRun = ref<Set<string>>(new Set());

    // Names the org holds, so a taken name is answered before anything is sent.
    const existingNames = ref<Set<string> | null>(null);

    const loadExistingNames = async () => {
      if (existingNames.value) return;
      try {
        // The list page's own query, so an import reached from it reuses that cache.
        const list = await queryClient.ensureQueryData(functionsQuery(orgId.value));
        existingNames.value = new Set((list ?? []).map((fn: any) => fn.name).filter(Boolean));
      } catch (err) {
        console.error("Error while reading existing functions", err);
        // Unreadable list leaves the clash to the server, as it was before.
        existingNames.value = new Set();
      }
    };

    // The Add form's entitlement: offering JS the build cannot run only moves the error.
    const isJsAllowed = computed(
      () =>
        config.isEnterprise === "true" ||
        config.isCloud === "true" ||
        store.state.selectedOrganization?.identifier === "_meta",
    );

    const transTypeOptions = computed(() => {
      const options = [{ label: t("function.vrl"), value: "0" }];
      if (isJsAllowed.value) options.push({ label: raw("JavaScript"), value: "1" });
      return options;
    });

    // Set at each call site, so one declared mutation covers both create and override.
    const isOverride = ref(false);
    const saveFunction = useMutation(() =>
      saveFunctionMutation(orgId.value, () => isOverride.value),
    );

    // Cleared on unmount, or leaving within the window yanks the user back to the list.
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    onBeforeUnmount(() => {
      if (redirectTimer !== undefined) clearTimeout(redirectTimer);
    });

    const goBack = () => {
      router.push({
        name: "functionList",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    };

    const triggerImport = () => baseImportRef.value?.handleImport();

    const resultClass = (status: ImportStatus) =>
      status === "failed" ? "text-status-negative" : "text-status-positive";

    // Describes one org's functions and means nothing in the next.
    watch(orgId, () => {
      writtenByThisRun.value = new Set();
      existingNames.value = null;
    });

    // BaseImport re-emits our own writes, so the text we wrote is recorded and its echo ignored.
    const currentDocument = ref("");

    const resetPendingState = () => {
      functionErrors.value = [];
      importResults.value = [];
      userSelectedName.value = {};
      userSelectedBody.value = {};
      userSelectedTransType.value = {};
      userSelectedParams.value = {};
      nameInputError.value = {};
      overrideExisting.value = {};
      dependentPipelines.value = {};
    };

    // Compared on content: BaseImport reformats, so one document arrives in several spellings.
    const normalizeDocument = (value: unknown): string => {
      if (Array.isArray(value)) return JSON.stringify(value);
      const text = String(value ?? "").trim();
      if (!text) return "";
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        return text;
      }
    };

    const adoptDocument = (items: any[]) => {
      currentDocument.value = JSON.stringify(items);
    };

    const onDocumentChanged = (value: unknown) => {
      const next = normalizeDocument(value);
      if (next === currentDocument.value) return;
      currentDocument.value = next;
      resetPendingState();
    };

    const onDocumentArrayChanged = (items: unknown) => onDocumentChanged(items ?? []);

    const writeBackToEditor = () => {
      if (!baseImportRef.value) return;
      adoptDocument(baseImportRef.value.jsonArrayOfObj);
      baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
    };

    // One path from every fix-up control to the document, so the JSON pane never disagrees.
    const writeField = (index: number, field: string, value: unknown) => {
      const item = baseImportRef.value?.jsonArrayOfObj?.[index];
      if (!item) return;
      item[field] = value;
      writeBackToEditor();
    };

    // The next press's rules, run as you type, so a dead rename says so immediately.
    const validateNameInput = (name: string, index: number): I18nText | null => {
      if (!name.trim()) return t("function.import.nameInputRequired");
      if (!functionNameRegex.test(name)) return t("function.import.nameInputInvalid");
      const items: any[] = baseImportRef.value?.jsonArrayOfObj ?? [];
      if (items.some((other, i) => i !== index && other?.name === name)) {
        return t("function.import.nameInputDuplicate");
      }
      // Same list the press checks, so the box answers now rather than after it.
      if (
        !writtenByThisRun.value.has(name) &&
        existingNames.value?.has(name) &&
        !overrideExisting.value[name]
      ) {
        return t("function.import.nameInputExists");
      }
      return null;
    };

    const updateFunctionName = (name: string, index: number) => {
      userSelectedName.value[index] = name;
      nameInputError.value[index] = validateNameInput(name, index);
      writeField(index, "name", name);
    };

    const updateFunctionBody = (body: string, index: number) => {
      userSelectedBody.value[index] = body;
      writeField(index, "function", body);
    };

    const updateTransType = (transType: string, index: number) => {
      userSelectedTransType.value[index] = transType;
      writeField(index, "transType", transType);
    };

    const updateParams = (params: string, index: number) => {
      userSelectedParams.value[index] = params;
      writeField(index, "params", params);
    };

    // A control over a rejected item opens on that item, not on a blank.
    const currentBody = (index: number) =>
      String(baseImportRef.value?.jsonArrayOfObj?.[index]?.function ?? "");

    // Absent is VRL (what gets sent); unusable is nothing, or picking VRL emits no change.
    const currentTransType = (index: number) => {
      const declared = baseImportRef.value?.jsonArrayOfObj?.[index]?.transType;
      if (declared === undefined || declared === null) return "0";
      const text = String(declared);
      return text === "0" || text === "1" ? text : "";
    };

    // The editor speaks the item's language, so JS is not tokenized as VRL.
    const bodyLanguage = (index: number) =>
      (userSelectedTransType.value[index] ?? currentTransType(index)) === "1"
        ? "javascript"
        : "vrl";

    const onOverrideChoice = async (name: string, itemIndex: number, checked: boolean) => {
      if (!name) return;
      overrideExisting.value[name] = checked;
      // Replacing makes the clash the intent, so the box has nothing left to object to.
      nameInputError.value[itemIndex] = checked
        ? null
        : validateNameInput(userSelectedName.value[itemIndex] ?? name, itemIndex);
      if (!checked || dependentPipelines.value[name]) return;
      try {
        const res: any = await jsTransformService.getAssociatedPipelines(orgId.value, name);
        dependentPipelines.value[name] = (res.data.list ?? []).map((p: any) => p.name);
      } catch (err) {
        console.error("Error while reading function dependencies", err);
      }
    };

    const nameError = (message: I18nText, itemIndex: number, name: string): FieldError => ({
      field: "function_name",
      message,
      itemIndex,
      name,
    });

    const validate = (item: any, index: number, itemIndex: number, seen: Set<string>) => {
      const errors: ImportError[] = [];
      const name = typeof item?.name === "string" ? item.name : "";

      if (!name.trim()) {
        errors.push(nameError(t("function.import.nameRequired", { index }), itemIndex, ""));
      } else if (!functionNameRegex.test(name)) {
        // The Add form's rule; the backend does not enforce it, so import would create names no VRL call can resolve.
        errors.push(nameError(t("function.import.nameInvalid", { index, name }), itemIndex, name));
      } else if (seen.has(name)) {
        // About the document rather than the org, so this screen is the one to catch it.
        errors.push(
          nameError(t("function.import.duplicateName", { index, name }), itemIndex, name),
        );
      } else if (
        !writtenByThisRun.value.has(name) &&
        existingNames.value?.has(name) &&
        overrideExisting.value[name] !== true
      ) {
        // Raised before anything is sent; replacing clears it, and this run's own writes never clash.
        errors.push(conflictError(item, index, itemIndex));
      }
      if (name) seen.add(name);

      if (!item?.function || typeof item.function !== "string" || !item.function.trim()) {
        errors.push({
          field: "function_body",
          message: t("function.import.bodyRequired", { index }),
          itemIndex,
          name,
        });
      }

      const transType = item?.transType ?? 0;
      if (![0, 1, "0", "1"].includes(transType)) {
        errors.push({
          field: "trans_type",
          message: t("function.import.transTypeInvalid", { index }),
          itemIndex,
          name,
        });
      }

      if (item?.params !== undefined && typeof item.params !== "string") {
        errors.push({
          field: "params",
          message: t("function.import.paramsInvalid", { index }),
          itemIndex,
          name,
        });
      }

      return errors;
    };

    const conflictError = (item: any, index: number, itemIndex: number): FieldError => ({
      field: "name_exists",
      message: t("function.import.nameExists", { index, name: item.name }),
      itemIndex,
      name: item.name,
    });

    // Language first: it decides how the body is read, and a JS body typed as VRL is the commonest rejection.
    const rejectionErrors = (item: any, index: number, itemIndex: number): ImportError[] => [
      {
        field: "trans_type",
        message: t("function.import.rejectedLanguage", { index, name: item.name }),
        itemIndex,
        name: item.name,
      },
      {
        field: "function_body",
        message: t("function.import.rejectedBody"),
        itemIndex,
        name: item.name,
      },
    ];

    // Built once so what is sent and what is recorded cannot drift apart.
    const payloadFor = (item: any) => ({
      name: item.name as string,
      function: String(item.function).trim(),
      params: typeof item.params === "string" && item.params.trim() ? item.params : "row",
      transType: parseInt(String(item.transType ?? 0)),
    });

    const writeFunction = async (item: any, index: number, itemIndex: number) => {
      const name: string = item.name;
      const payload = payloadFor(item);
      // Ours from an earlier press, so a retry updates it instead of being refused.
      const ours = writtenByThisRun.value.has(name);
      const override = ours || overrideExisting.value[name] === true;
      isOverride.value = override;

      try {
        await saveFunction.mutateAsync(payload);
        writtenByThisRun.value.add(name);
        importResults.value.push({
          message: override
            ? t("function.import.overridden", { index, name })
            : t("function.import.createSuccess", { index, name }),
          status: override ? "overridden" : "created",
        });
        return null;
      } catch (error: any) {
        const reason = error?.response?.data?.message ?? error?.message ?? "";
        importResults.value.push({
          message: t("function.import.createFailed", {
            index,
            name,
            reason: raw(reason) || raw("unknown error"),
          }),
          status: "failed",
        });
        // A taken name has one specific fix, so it gets the rename box.
        return /already exist/i.test(String(reason))
          ? [conflictError(item, index, itemIndex)]
          : rejectionErrors(item, index, itemIndex);
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
        // BaseImport echoes back what we hand it; that is this document, not a new one.
        adoptDocument(items);
        baseImportRef.value.jsonArrayOfObj = items;
      } catch (e: any) {
        toast({
          message: raw(e?.message) || t("function.import.invalidJsonFormat"),
          variant: "error",
        });
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      // A failed parse leaves an empty array, which would report importing nothing as success.
      if (items.length === 0) {
        toast({ message: t("function.import.nothingToImport"), variant: "error" });
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      isImporting.value = true;

      await loadExistingNames();

      const seen = new Set<string>();
      const errorGroups = items
        .map((item, i) => validate(item, i + 1, i, seen))
        .filter((group) => group.length > 0);
      // Shape is this screen's to judge before anything is sent.
      if (errorGroups.length > 0) {
        functionErrors.value = errorGroups;
        isImporting.value = false;
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      let written = 0;
      // What the server refused; every item here was actually attempted.
      const rejected: ImportError[][] = [];
      for (const [itemIndex, item] of items.entries()) {
        const errors = await writeFunction(item, itemIndex + 1, itemIndex);
        if (errors) rejected.push(errors);
        else written++;
      }

      if (rejected.length > 0) {
        functionErrors.value = rejected;
      } else {
        toast({
          message: t("function.import.importSuccess", { count: written }, written),
          variant: "success",
        });
        redirectTimer = setTimeout(goBack, 400);
      }

      isImporting.value = false;
      if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
    };

    return {
      t,
      baseImportRef,
      isImporting,
      functionErrors,
      importResults,
      userSelectedName,
      userSelectedBody,
      userSelectedTransType,
      userSelectedParams,
      nameInputError,
      overrideExisting,
      transTypeOptions,
      dependentPipelines,
      goBack,
      triggerImport,
      resultClass,
      bodyLanguage,
      currentBody,
      currentTransType,
      updateFunctionName,
      updateFunctionBody,
      updateTransType,
      updateParams,
      onOverrideChoice,
      onDocumentChanged,
      onDocumentArrayChanged,
      importJson,
      validate,
    };
  },
});
</script>
