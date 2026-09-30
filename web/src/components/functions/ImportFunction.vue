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
                          :query="userSelectedBody[errorMessage.itemIndex] ?? ''"
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
                        :model-value="userSelectedTransType[errorMessage.itemIndex] ?? '0'"
                        :options="transTypeOptions"
                        :label="t('function.import.transTypeLabel')"
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
import { useMutation, useQuery } from "@tanstack/vue-query";

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
import { useOrgId } from "@/composables/query/useOrgId";

type ImportStatus = "created" | "overridden" | "skipped" | "failed";

// Every validation names the field it is about, so the output pane can put the
// control that fixes it next to the message instead of asking the user to go
// and find the offending line in the JSON.
type FieldError = {
  field: "function_name" | "name_exists" | "function_body" | "trans_type" | "params";
  message: I18nText;
  itemIndex: number;
  name: string;
  /** False = shown for context but does not hold the import back. */
  blocking: boolean;
};

// A plain I18nText is a branded string, so `typeof e === "object"` is what
// separates the two arms — in the template as well as here.
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
    // Async like every other Monaco consumer: the body editor only appears for an
    // item whose body is missing, so most imports never pay for it.
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

    // Keyed by position, unlike the override flag below: a fix-up box belongs to
    // the item at that position — for a missing or unusable name there is no name
    // to key it by at all. Safe only because this state is dropped when the
    // document changes.
    const userSelectedName = ref<Record<number, string>>({});
    const userSelectedBody = ref<Record<number, string>>({});
    const userSelectedTransType = ref<Record<number, string>>({});
    const userSelectedParams = ref<Record<number, string>>({});

    // What the name box says about what has been typed so far, as opposed to the
    // message above it, which describes the document as the last press found it.
    const nameInputError = ref<Record<number, I18nText | null>>({});

    // Keyed by NAME. Index 0 of the next file is a different function, and an
    // "override" the user meant for one must never be applied to another.
    const overrideExisting = ref<Record<string, boolean>>({});
    const dependentPipelines = ref<Record<string, string[]>>({});

    // Names whose clash has been put on screen with a picker. A conflict is
    // surfaced once and written on the next press, so the user never has an
    // existing function replaced by a click they did not make. Per name rather
    // than one flag for the screen: a rename, or a second file, brings names
    // that have never been confirmed and must be prompted for in their own right.
    const conflictsSurfaced = ref<Set<string>>(new Set());

    // What this run has written: name -> the payload that was sent. NOT reset
    // with the rest, because it describes the server rather than the editor —
    // a function created by the first press exists whatever the user does to
    // the document next. Fixing one item's VRL and pressing again must not
    // re-prompt for the item that already went in, nor write it twice; it is
    // re-sent only if its own definition changed, which is an update of this
    // run's own work and needs no permission. Only the org owns it.
    const writtenByThisRun = ref<Map<string, string>>(new Map());

    // The same entitlement the Add Function form applies. Offering JavaScript
    // where the build cannot run it would only trade this validation error for a
    // server-side one.
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

    const existingFunctions = useQuery(() =>
      Object.assign(functionsQuery(orgId.value), { enabled: !!orgId.value }),
    );

    // Set at each call site, so one declared mutation covers both create and override.
    const isOverride = ref(false);
    const saveFunction = useMutation(() =>
      saveFunctionMutation(orgId.value, () => isOverride.value),
    );

    // Cleared on unmount: without it, navigating away inside the window pulls
    // the user back to the Functions list from wherever they went.
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

    // Both caches describe one org's functions and mean nothing in the next.
    watch(orgId, () => {
      writtenByThisRun.value = new Map();
      serverReportedExisting.value = new Set();
    });

    // ── Document identity ──────────────────────────────────────────────────
    // Every choice above belongs to the document that produced it. BaseImport
    // re-emits for our own writes too (a rename restringifies the array), so the
    // text we just wrote is recorded here and its echo ignored; anything else is
    // the user loading a file, fetching a URL or typing, and starts over.
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
      conflictsSurfaced.value = new Set();
    };

    // Compared on CONTENT, not on the text: BaseImport reformats what it holds
    // and emits the text and the array separately, so the same document arrives
    // in several spellings. Only a real change of content starts over.
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

    // Every fix-up control writes through here, so a typed value reaches the
    // document by exactly one path and the JSON pane always shows what will be
    // sent.
    const writeField = (index: number, field: string, value: unknown) => {
      const item = baseImportRef.value?.jsonArrayOfObj?.[index];
      if (!item) return;
      item[field] = value;
      writeBackToEditor();
    };

    // The rules the next press will apply, run as the user types: a rename that
    // cannot work says so in the box rather than after another round trip.
    const validateNameInput = (name: string, index: number): I18nText | null => {
      if (!name.trim()) return t("function.import.nameInputRequired");
      if (!functionNameRegex.test(name)) return t("function.import.nameInputInvalid");
      const items: any[] = baseImportRef.value?.jsonArrayOfObj ?? [];
      if (items.some((other, i) => i !== index && other?.name === name)) {
        return t("function.import.nameInputDuplicate");
      }
      // Written by this run, so sending it again updates our own work.
      if (writtenByThisRun.value.has(name)) return null;
      if (nameExists(name) && !overrideExisting.value[name]) {
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

    // The editor speaks the language the item declares, so a JavaScript function
    // whose body is missing is not written against VRL tokenizing.
    const bodyLanguage = (index: number) => {
      const item = baseImportRef.value?.jsonArrayOfObj?.[index];
      const transType = String(userSelectedTransType.value[index] ?? item?.transType ?? "0");
      return transType === "1" ? "javascript" : "vrl";
    };

    const onOverrideChoice = async (name: string, itemIndex: number, checked: boolean) => {
      if (!name) return;
      overrideExisting.value[name] = checked;
      // Overriding replaces what is already there, so "already exists" stops
      // describing the outcome and the name box has nothing left to complain about.
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
      blocking: true,
    });

    const validate = (item: any, index: number, itemIndex: number, seen: Set<string>) => {
      const errors: ImportError[] = [];
      const name = typeof item?.name === "string" ? item.name : "";

      if (!name.trim()) {
        errors.push(nameError(t("function.import.nameRequired", { index }), itemIndex, ""));
      } else if (!functionNameRegex.test(name)) {
        // The Add Function form's own rule. The backend does not enforce it, so
        // an import could otherwise create "my-fn with space": a function its
        // edit form refuses to save and no VRL call can resolve. It is also what
        // catches " parse_nginx ", whose spaces would hide a real clash.
        errors.push(nameError(t("function.import.nameInvalid", { index, name }), itemIndex, name));
      } else if (seen.has(name)) {
        // Left undetected, the second copy lands as a server 400 that reads as a
        // clash — and overriding it would replace what this same import created.
        errors.push(
          nameError(t("function.import.duplicateName", { index, name }), itemIndex, name),
        );
      } else if (!writtenByThisRun.value.has(name) && nameExists(name)) {
        errors.push({
          field: "name_exists",
          message: t("function.import.nameExists", { index, name }),
          itemIndex,
          name,
          blocking: !conflictsSurfaced.value.has(name),
        });
      }
      if (name) seen.add(name);

      if (!item?.function || typeof item.function !== "string" || !item.function.trim()) {
        errors.push({
          field: "function_body",
          message: t("function.import.bodyRequired", { index }),
          itemIndex,
          name,
          blocking: true,
        });
      }

      const transType = item?.transType ?? 0;
      if (![0, 1, "0", "1"].includes(transType)) {
        errors.push({
          field: "trans_type",
          message: t("function.import.transTypeInvalid", { index }),
          itemIndex,
          name,
          blocking: true,
        });
      }

      if (item?.params !== undefined && typeof item.params !== "string") {
        errors.push({
          field: "params",
          message: t("function.import.paramsInvalid", { index }),
          itemIndex,
          name,
          blocking: true,
        });
      }

      return errors;
    };

    const conflictError = (item: any, index: number, itemIndex: number): FieldError => ({
      field: "name_exists",
      message: t("function.import.nameExists", { index, name: item.name }),
      itemIndex,
      name: item.name,
      blocking: false,
    });

    // Remembering what the user has now been shown, so the next press acts on the
    // picker rather than reporting the same clash again.
    const rememberSurfacedConflicts = (groups: ImportError[][]) => {
      for (const group of groups) {
        for (const error of group) {
          if (typeof error === "object" && error.field === "name_exists") {
            conflictsSurfaced.value.add(error.name);
          }
        }
      }
    };

    // Built once: it is both what is sent and what is remembered, so "did this
    // item change since we wrote it?" compares like with like.
    const payloadFor = (item: any) => ({
      name: item.name as string,
      function: String(item.function).trim(),
      params: typeof item.params === "string" && item.params.trim() ? item.params : "row",
      transType: parseInt(String(item.transType ?? 0)),
    });

    const writeFunction = async (item: any, index: number) => {
      const name: string = item.name;
      const payload = payloadFor(item);
      // Ours already: it exists because this run created it, so a changed
      // definition goes back as an update and needs no conflict prompt.
      const ours = writtenByThisRun.value.has(name);
      const override = ours || (nameExists(name) && overrideExisting.value[name] === true);
      isOverride.value = override;

      try {
        await saveFunction.mutateAsync(payload);
        writtenByThisRun.value.set(name, JSON.stringify(payload));
        importResults.value.push({
          message: ours
            ? t("function.import.reimported", { index, name })
            : override
              ? t("function.import.overridden", { index, name })
              : t("function.import.createSuccess", { index, name }),
          status: override ? "overridden" : "created",
        });
        return override ? "overridden" : "created";
      } catch (error: any) {
        const reason = error?.response?.data?.message ?? error?.message ?? "";
        // The name was taken after all, so the user gets the same choice a
        // visible clash would have offered rather than a dead failure line.
        if (/already exist/i.test(String(reason))) {
          serverReportedExisting.value.add(name);
          return "conflict";
        }
        importResults.value.push({
          message: t("function.import.createFailed", {
            index,
            name,
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
        // BaseImport restringifies what we hand it and emits the result back;
        // that echo is this same document, not a new one.
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

      // A file that failed to parse leaves BaseImport holding an empty array, so
      // without this an unreadable file reports a successful import of nothing.
      if (items.length === 0) {
        toast({ message: t("function.import.nothingToImport"), variant: "error" });
        if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
        return;
      }

      isImporting.value = true;

      const seen = new Set<string>();
      const errorGroups = items
        .map((item, i) => validate(item, i + 1, i, seen))
        .filter((group) => group.length > 0);
      const isBlocking = (error: ImportError) => typeof error !== "object" || error.blocking;
      if (errorGroups.some((group) => group.some(isBlocking))) {
        functionErrors.value = errorGroups;
        rememberSurfacedConflicts(errorGroups);
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
        const name: string = item.name;
        // Written by an earlier press, so it exists now because of this import
        // — not because the user is keeping an older one. Unchanged since, so
        // there is nothing to send; a changed definition falls through and is
        // updated below without a prompt.
        if (writtenByThisRun.value.get(name) === JSON.stringify(payloadFor(item))) {
          importResults.value.push({
            message: t("function.import.alreadyImported", { index, name }),
            status: "skipped",
          });
          skipped++;
          continue;
        }
        if (
          !writtenByThisRun.value.has(name) &&
          nameExists(name) &&
          !overrideExisting.value[name]
        ) {
          importResults.value.push({
            message: t("function.import.skipped", { index, name }),
            status: "skipped",
          });
          skipped++;
          continue;
        }
        const outcome = await writeFunction(item, index);
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
        rememberSurfacedConflicts(lateConflicts);
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
