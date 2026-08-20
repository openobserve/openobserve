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

<!--
  Shared "pick a function" body for the flow canvases (Pipelines + Workflows).
  Presentation + logic only — the surrounding chrome (drawer / modal + Save/Cancel)
  lives in each module's wrapper, which reads the result via the exposed
  `getPayload()`.

  Behaviour:
   - Toggle between picking a saved function and creating one inline (AddFunction).
   - Read-only definition preview of the selected function.
   - Optional "After Flattening" (RAF/RBF) toggle — shown when `showFlatten`.
   - Self-fetches the function list, filtered to the host's language (`language`):
     a pipeline runs VRL, a workflow Function node runs JS — so each only offers
     functions it can actually execute.

  ⚠️ The `data-test` hooks below (create-function-toggle,
  associate-function-select-function-input, associate-function-definition-section,
  associate-function-after-flattening-toggle) are the ORIGINAL names this markup
  had while it lived in pipeline/NodeForm/AssociateFunction.vue. The pipeline e2e
  suite locates by them, so they are a CONTRACT — extracting this component moved
  the markup, not the behaviour, so renaming them would only break tests for no
  gain. Keep them as-is; don't "namespace" them to the new file name.

  Props:
    initialName          — preselected function name (edit mode)
    initialAfterFlatten  — initial RAF/RBF value (default true)
    showFlatten          — show the After-Flattening toggle + guidelines (default true)
    isUpdating           — lock the select (edit-an-existing-function mode)
    duplicateNames       — names that are already used → shows "already associated"
    optional             — allow saving with NO function selected (Workflows dummy
                           nodes): submit() returns an empty `name` instead of null,
                           and the required schema check is skipped. Default false so
                           Pipelines are unaffected.
    createButton         — single-screen mode (Workflows): show the select AND the
                           inline create editor together on ONE page (no mode switch, no
                           view swap) — pick existing above, or create new below (its
                           own Save auto-selects it). Default false → Pipelines keep the
                           mode switch + full-height editor.

  Emits:
    expand(boolean)  — inline-create mode toggled (host can widen the drawer)
    created(fn)      — a new function was created inline

  Exposes:
    getPayload()  — { name, after_flatten? } or null (and surfaces validation)
-->
<template>
  <div
    data-test="function-picker"
    class="flex w-full flex-col"
    :class="
      createNewFunction ? 'h-full min-h-0 gap-0' : createButton ? 'h-full min-h-0 gap-2' : 'gap-4'
    "
  >
    <OSpinner v-if="loading" size="md" class="mx-auto my-8" />

    <template v-else>
      <!-- create / pick MODE SWITCH (pipelines). Single-screen hosts (workflows) use a
           subtle "+ Create New" button by the select instead — see createButton below. -->
      <div
        v-if="!createButton"
        class="flex items-center gap-3"
        :class="createNewFunction ? 'shrink-0 px-4 pt-4' : ''"
      >
        <OSwitch
          v-model="createNewFunction"
          :label="t('flow.function.createNew')"
          data-test="create-function-toggle"
        />
        <!-- Saving here creates the function and drops the user back on the
             select form — surprising enough that it needs saying up front, so
             the note lives at the toggle, not at the save. The host owns the
             wording: this component is shared, and a workflow must not be told
             its function is being associated with a "pipeline". -->
        <div
          v-if="createNewFunction"
          class="text-text-secondary text-sm"
          data-test="create-function-note"
        >
          ({{
            wantsJs
              ? t("flow.function.createNewNoteWorkflow")
              : t("alerts.newFunctionAssociationMsg")
          }})
        </div>
      </div>

      <!-- SELECT an existing function (+ preview + After-Flattening). Single-screen
           hosts (workflows) show this ALWAYS, with the create editor below it; pipelines
           show it only when not in create mode. -->
      <OForm v-if="createButton || !createNewFunction" :form="form" class="flex flex-col gap-4">
        <!-- required + "already associated" are both enforced by the shared
             AssociateFunction schema, rendered inline on the field. Single-screen
             (workflow): a save ICON sits on the same line, right of the dropdown —
             mirroring the Logs editor — so saving reads as "save this FUNCTION", not
             "save the node" (the node commits on close). -->
        <div class="flex items-end gap-2">
          <OFormSelect
            name="selectedFunction"
            class="min-w-0 flex-1"
            :options="functionOptions"
            :label="t('flow.function.select')"
            :required="!optional"
            searchable
            :readonly="isUpdating"
            :disabled="isUpdating"
            data-test="associate-function-select-function-input"
          />
          <OButton
            v-if="createButton"
            variant="outline"
            type="button"
            size="sm"
            class="shrink-0"
            :loading="savingFn"
            :title="t('function.save')"
            data-test="wf-function-save-btn"
            @click="onBottomSave"
          >
            <OIcon name="save" size="sm" />
          </OButton>
        </div>

        <!-- read-only definition preview (pipelines only — the single-screen editor
             below is where workflows view/edit the function). -->
        <div
          v-if="!createButton && selectedFunction && selectedDefinition"
          data-test="associate-function-definition-section"
          class="mt-4 mb-4"
        >
          <!-- No `isDark` branching: every colour below is a --color-* token,
               which already resolves per theme. (The old comment here claimed
               `dark:` follows the OS prefers-color-scheme — that is stale;
               tailwind.css binds it to the app's `.dark` class via
               `@custom-variant dark`.) The header's two-stop gradient is now a
               flat token surface — a gradient can't be expressed in tokens, and
               the flat fill matches the rest of the app's card headers. -->
          <OCard
            class="function-definition-card border-border-default bg-surface-base rounded-default overflow-hidden border shadow-xs"
          >
            <OCardSection role="header" class="border-b-border-default bg-surface-subtle border-b">
              <div class="text-text-heading text-base font-semibold">
                {{ t("function.function_definition") }}
              </div>
            </OCardSection>
            <OSeparator />
            <OCardSection class="p-0">
              <div
                class="function-code-container bg-surface-subtle border-border-default relative max-h-[15.625rem] overflow-y-auto border"
              >
                <pre
                  class="text-compact text-text-code m-0 cursor-default border-0 bg-transparent p-4 font-mono leading-normal font-normal break-words whitespace-pre-wrap select-text"
                  >{{ selectedDefinition }}</pre>
              </div>
            </OCardSection>
          </OCard>
        </div>

        <!-- After-Flattening (RAF/RBF) toggle + guidelines. Single-screen (workflow)
             moves this toggle to the bottom bar (next to Save), so it's hidden here. -->
        <div v-if="showFlatten && !createButton" class="flex w-full flex-col gap-3">
          <OFormSwitch
            name="afterFlattening"
            :label="t('flow.function.flatten')"
            data-test="associate-function-after-flattening-toggle"
          />
          <!-- RBF/RAF guidelines banner. Hidden in the single-screen (workflow) editor
               to keep it uncluttered; the toggle above is self-explanatory there.
               Same theme-aware banner tokens the pipeline + workflow Condition notes use
               (banner-warning-* replaced the retired --color-note-* set); the
               border matters in LIGHT mode so the near-white fill doesn't read unstyled. -->
          <div
            v-if="!createButton"
            class="bg-banner-warning-bg border-banner-warning-border text-banner-warning-text rounded-default flex w-full flex-col gap-2 border p-3"
          >
            <div class="text-sm">
              {{ t("flow.function.guidelinesTitle") }}
            </div>
            <div class="flex flex-col gap-1 text-sm">
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
                <span>
                  <span class="text-text-link font-bold">{{ t("flow.function.rbf") }}</span>
                  {{ t("flow.function.rbfDesc") }}
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
                <span>
                  <span class="text-text-link font-bold">{{ t("flow.function.raf") }}</span>
                  {{ t("flow.function.rafDesc") }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </OForm>

      <!-- CREATE a new function — inline on the SAME page. Single-screen (workflows):
           always shown below the select, set apart by a divider; its own toolbar saves
           the function, which then auto-selects in the dropdown above. Pipelines: shown
           only when the mode switch is on (keeps their full-height editor). -->
      <!-- ALWAYS a fresh function. AddFunction's `is-updated` means "editing an
           EXISTING function" (disables its name input), which is a different thing
           from editing the NODE — never feed it our `isUpdating`. Single-screen
           (workflows) shows it always, full-height, as the main surface. -->
      <!-- Editor fills the available height (comment stays pinned below via the host
           panel), so no vertical space is wasted. -->
      <div v-if="createButton || createNewFunction" class="flow-add-function min-h-0 w-full flex-1">
        <!-- Single-screen: picking a saved function loads ITS definition into the
             editor (re-keyed so the code swaps on each selection); with none picked it
             seeds the fresh-function default. -->
        <AddFunction
          ref="addFunctionRef"
          :key="createButton ? `${selectedFunction}:${resetNonce}` : undefined"
          :is-updated="false"
          :height-offset="75"
          :sample-events="sampleEvents"
          :forced-language="language"
          :hide-test-panel="createButton"
          :hide-ai-assist="createButton"
          :default-code="editorSeed"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <!-- Single-screen (workflow) bottom bar: After Flattening pinned to the RIGHT.
           Save moved up beside the dropdown so it clearly saves the FUNCTION. The
           toggle carries a hover tooltip explaining before- vs after-flattening. -->
      <div v-if="createButton && showFlatten" class="flex shrink-0 items-center justify-end pt-1">
        <div class="inline-flex items-center">
          <OSwitch
            :model-value="afterFlatteningValue"
            :label="t('flow.function.flatten')"
            data-test="wf-after-flatten"
            @update:model-value="onAfterFlatteningChange"
          />
          <OTooltip side="top">
            <template #content>
              <div class="flex max-w-64 flex-col gap-1">
                <div>
                  <span class="font-semibold">{{ t("flow.function.rbf") }}</span>
                  {{ t("flow.function.rbfDesc") }}
                </div>
                <div>
                  <span class="font-semibold">{{ t("flow.function.raf") }}</span>
                  {{ t("flow.function.rafDesc") }}
                </div>
              </div>
            </template>
          </OTooltip>
        </div>
      </div>
    </template>

    <!-- Saved Functions dialog (single-screen / workflow only) — mirrors the Logs
         editor: Save from the editor opens Update|Create. Update overwrites an existing
         reusable function (with a confirm, since it may be used elsewhere); Create makes
         a new one. Either way we then select it, so the node references it by name. -->
    <ODialog
      v-if="createButton"
      v-model:open="savedDialog"
      size="md"
      form-id="wf-saved-function-form"
      :title="t('search.functionPlaceholder')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      :primary-button-loading="savingFn"
      @click:secondary="savedDialog = false"
    >
      <OForm id="wf-saved-function-form" :form="savedForm">
        <OFormToggleGroup
          name="isSavedFunctionAction"
          data-test="wf-saved-function-action-toggle"
          :disabled="functionOptions.length === 0"
          class="mb-3"
        >
          <OToggleGroupItem value="update" size="sm">{{ t("common.update") }}</OToggleGroupItem>
          <OToggleGroupItem value="create" size="sm">{{ t("common.create") }}</OToggleGroupItem>
        </OFormToggleGroup>
        <OFormInput
          v-if="savedMode === 'create'"
          name="savedFunctionName"
          data-test="wf-saved-function-name-input"
          :label="t('search.saveFunctionName')"
          required
        />
        <OFormSelect
          v-else
          name="savedFunctionSelectedName"
          data-test="wf-saved-function-name-select"
          :options="functionOptions"
          :label="t('search.saveFunctionName')"
          :placeholder="t('search.selectFunctionNamePlaceholder')"
          searchable
          required
        />
      </OForm>
    </ODialog>
    <ConfirmDialog
      v-if="createButton"
      data-test="wf-function-update-confirm"
      :title="t('search.confirmFunctionUpdateTitle')"
      :message="t('search.confirmFunctionUpdateMsg', { name: fnToUpdateName })"
      v-model="fnUpdateConfirm"
      @update:ok="executeUpdate"
      @update:cancel="fnUpdateConfirm = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeAssociateFunctionSchema,
  type AssociateFunctionForm,
} from "@/components/pipeline/NodeForm/AssociateFunction.schema";
import {
  makeSavedFunctionSchema,
  type SavedFunctionForm,
} from "@/plugins/logs/SearchBar.SavedFunction.schema";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import functionsService from "@/services/jstransform";
import { isJsFunction } from "@/utils/functionLanguage";

const AddFunction = defineAsyncComponent(() => import("@/components/functions/AddFunction.vue"));

const props = withDefaults(
  defineProps<{
    initialName?: string;
    initialAfterFlatten?: boolean;
    showFlatten?: boolean;
    isUpdating?: boolean;
    optional?: boolean;
    // Single-screen mode (Workflows): the select + the inline create editor on ONE
    // full-height page (no mode switch, no definition preview, no RBF/RAF guidelines) —
    // an editor-first surface. Pipelines keep the switch + preview + guidelines (default).
    createButton?: boolean;
    // Workflow inline JS: the node's saved raw_fn (unsaved/edited code not backed by a
    // library function). When set with no `initialName`, it seeds the editor so reopening
    // a draft keeps the inline code. submit() sends it back as `raw_fn` while dirty.
    initialRawFn?: string;
    duplicateNames?: string[];
    // Sample events to seed the inline function editor's "Events" panel (e.g. the
    // workflow alert payload). Omitted → the generic log sample.
    sampleEvents?: any[];
    // The host's execution language ('vrl' | 'javascript'). Two effects:
    //   1. filters the selectable list to functions of that language, and
    //   2. locks the inline editor to it, hiding the VRL/JS toggle.
    // Workflow Function nodes pass 'javascript'; pipelines pass 'vrl'.
    language?: string;
    // Seed code for a fresh inline function (replaces the typewriter placeholder).
    defaultCode?: string;
  }>(),
  {
    initialName: "",
    initialAfterFlatten: true,
    showFlatten: true,
    isUpdating: false,
    optional: false,
    createButton: false,
    initialRawFn: "",
    duplicateNames: () => [],
    sampleEvents: undefined,
    language: "",
    defaultCode: "",
  },
);

const emit = defineEmits<{
  (e: "expand", value: boolean): void;
  (e: "created", fn: any): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const loading = ref(false);
const functionOptions = ref<string[]>([]);
const functionDefs = ref<Record<string, string>>({});

const createNewFunction = ref(false);
const addFunctionRef = ref<any>(null);

watch(createNewFunction, (v) => emit("expand", v));

// ── OForm wiring (OWNER pattern) ─────────────────────────────────────────────
// Owned here so the definition preview can read the live selection reactively.
// The shared AssociateFunction schema enforces BOTH rules that used to be
// hand-rolled: required (min(1)) and "already associated" (superRefine over
// duplicateNames) — both now render inline on the select.
const validated = ref<AssociateFunctionForm | null>(null);

const form = useOForm<AssociateFunctionForm>({
  defaultValues: {
    selectedFunction: props.initialName || "",
    afterFlattening: props.initialAfterFlatten,
  },
  schema: makeAssociateFunctionSchema(
    t,
    () => props.duplicateNames,
    () => props.isUpdating,
  ),
  onSubmit: (values) => {
    validated.value = values;
  },
});

// Reactive view of the SAME form (no mirror ref).
const selectedFunction = form.useStore((s: any) => s.values?.selectedFunction ?? "");

const selectedDefinition = computed(() => functionDefs.value[selectedFunction.value] || "");

// ── Inline JS (raw_fn) + dirty tracking (workflow single-screen) ──────────────
// The editor seeds from the selected fn's saved code, else the node's persisted
// raw_fn, else the fresh-function default. Bumping resetNonce re-keys AddFunction
// to force a remount at that seed — used by discard to revert the editor.
const resetNonce = ref(0);
const editorSeed = computed(() =>
  props.createButton && selectedFunction.value
    ? selectedDefinition.value
    : props.initialRawFn || props.defaultCode,
);
// Live editor code (imperative — AddFunction exposes getCode only). Read on demand;
// NOT reactive to typing, so isDirty()/submit() call it at the moment they run.
const editorCode = (): string => (addFunctionRef.value?.getCode?.() as string) ?? "";
// Would this node serialize as inline `raw_fn`? True when the live code diverges from
// the selected fn's saved code, or there's real inline code with no fn selected.
const isDirty = (): boolean => {
  if (!props.createButton) return false; // raw_fn is a workflow-only concept
  const code = editorCode().trim();
  if (selectedFunction.value) return code !== (selectedDefinition.value || "").trim();
  // No saved fn selected: dirty only when there's real code beyond the seed default.
  const seed = (props.defaultCode || "").trim();
  return code.length > 0 && code !== seed;
};
// Discard: revert the editor to its seed by remounting — the selected fn's saved code
// (name kept), or the fresh default when nothing was selected (node → unconfigured).
const discardChanges = () => {
  resetNonce.value++;
};

// After Flattening lives in the bottom bar (single-screen). Plain switch bound to the
// same form field submit() reads, so no second OForm context is needed at the bottom.
const afterFlatteningValue = form.useStore((s: any) => !!s.values?.afterFlattening);
const onAfterFlatteningChange = (v: unknown) => form.setFieldValue("afterFlattening", !!v);

// Bottom Save → pull the live editor code from AddFunction and open Update|Create.
const onBottomSave = () => {
  const code = (addFunctionRef.value?.getCode?.() as string) ?? "";
  onSaveRequest(code);
};

// Only functions written in the host's language are selectable: a pipeline runs
// VRL, a workflow node runs JS. Offering the other kind would let a user attach a
// function the node can't execute. (isJsFunction handles the transType /
// trans_type field-name split — see utils/functionLanguage.)
const wantsJs = computed(() => props.language === "javascript");
const matchesHostLanguage = (func: any) =>
  wantsJs.value ? isJsFunction(func) : !isJsFunction(func);

const getFunctions = async () => {
  loading.value = true;
  try {
    const res = await functionsService.list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    );
    const names: string[] = [];
    const defs: Record<string, string> = {};
    (res.data?.list || []).forEach((func: any) => {
      if (matchesHostLanguage(func)) {
        names.push(func.name);
        defs[func.name] = func.function;
      }
    });
    functionOptions.value = names.sort((a, b) => a.localeCompare(b));
    functionDefs.value = defs;
  } catch (e) {
    toast({ variant: "error", message: t("flow.function.loadError") });
  } finally {
    loading.value = false;
  }
};

onMounted(getFunctions);

const onFunctionCreation = async (fn: any) => {
  createNewFunction.value = false;
  emit("created", fn);
  await getFunctions();
  await nextTick();
  // Push the just-created function into the form (the select re-mounts with it).
  if (fn?.name) form.setFieldValue("selectedFunction", fn.name);
};

// Inline editor back/cancel: return to the picker (don't close the host drawer).
const cancelFunctionCreation = () => {
  createNewFunction.value = false;
};

// ── Saved Functions dialog (single-screen / workflow) ────────────────────────
// Mirrors the Logs editor: the editor's Save hands us its code (save-request), we
// ask Update-or-Create, then persist + select. Reuses the Logs schema so the
// create/update validation is identical.
const savedDialog = ref(false);
const savingFn = ref(false);
const pendingCode = ref("");
const fnUpdateConfirm = ref(false);
const fnToUpdateName = ref("");

const savedForm = useOForm<SavedFunctionForm>({
  defaultValues: {
    isSavedFunctionAction: "create",
    savedFunctionName: "",
    savedFunctionSelectedName: "",
  },
  schema: makeSavedFunctionSchema(t),
  onSubmit: (v) => onSavedSubmit(v),
});
const savedMode = savedForm.useStore(
  (s: any) => (s.values.isSavedFunctionAction as string) ?? "create",
);

// Editor Save → open Update|Create. Default to Update (preselecting the loaded
// function) when one is selected; otherwise Create. Empty code has nothing to save.
const onSaveRequest = (code: string) => {
  if (!code || !code.trim()) {
    toast({ variant: "warning", message: t("logs.searchBar.functionFieldRequired") });
    return;
  }
  pendingCode.value = code;
  const current = selectedFunction.value as string;
  savedForm.reset({
    isSavedFunctionAction: current && functionOptions.value.length ? "update" : "create",
    savedFunctionName: "",
    savedFunctionSelectedName: current || "",
  });
  savedDialog.value = true;
};

// jstransform payload for the current editor code. Workflow functions are JS
// (transType 1); params is the fixed `row` binding.
const fnPayload = (name: string) => ({
  name,
  function: pendingCode.value,
  params: "row",
  transType: wantsJs.value ? 1 : 0,
});

const afterSaved = async (name: string) => {
  await getFunctions();
  await nextTick();
  form.setFieldValue("selectedFunction", name);
  emit("created", { name });
};

const onSavedSubmit = async (v: SavedFunctionForm) => {
  if (v.isSavedFunctionAction === "create") {
    savingFn.value = true;
    try {
      const res: any = await functionsService.create(
        store.state.selectedOrganization.identifier,
        fnPayload(v.savedFunctionName),
      );
      toast({ variant: "success", message: raw(res?.data?.message || t("flow.function.saved")) });
      savedDialog.value = false;
      await afterSaved(v.savedFunctionName);
    } catch (e: any) {
      toast({
        variant: "error",
        message: raw(e?.response?.data?.message || t("flow.function.saveError")),
      });
    } finally {
      savingFn.value = false;
    }
  } else {
    // Update overwrites a reusable function that may be used elsewhere → confirm first.
    fnToUpdateName.value = v.savedFunctionSelectedName;
    fnUpdateConfirm.value = true;
  }
};

const executeUpdate = async () => {
  savingFn.value = true;
  try {
    const res: any = await functionsService.update(
      store.state.selectedOrganization.identifier,
      fnPayload(fnToUpdateName.value),
    );
    toast({ variant: "success", message: raw(res?.data?.message || t("flow.function.updated")) });
    fnUpdateConfirm.value = false;
    savedDialog.value = false;
    await afterSaved(fnToUpdateName.value);
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message || t("flow.function.saveError")),
    });
  } finally {
    savingFn.value = false;
  }
};

// Host bridge: validate through the schema and return the node payload, or null
// when invalid (OForm renders required / already-associated inline on the field).
const submit = async () => {
  if (createNewFunction.value) return null; // still in the inline editor
  // Optional (Workflows dummy node): empty is allowed. Read the current value
  // WITHOUT running the required schema, so no inline error and empty resolves to
  // an empty name rather than null (mirrors DestinationPicker's optional branch).
  if (props.optional) {
    const flat = props.showFlatten ? { after_flatten: !!form.state.values.afterFlattening } : {};
    // Workflow single-screen: when the editor holds inline/edited code (diverges from
    // the selected saved fn, or there's code with none selected), send it as `raw_fn`
    // with an empty name — the backend runs it as inline JS. Otherwise reference the
    // saved fn by name. (Never both; a clean selection or an empty node clears raw_fn.)
    if (props.createButton && isDirty()) {
      return { name: "", raw_fn: editorCode(), ...flat };
    }
    const name = (form.state.values.selectedFunction as string) || "";
    // Clean/empty: clear any stale raw_fn. `undefined` (not "") so it drops from JSON
    // → backend `None`; an empty string would be `Some("")` and read as "has raw_fn",
    // which would wrongly flag a saved-fn node as unsaved and block Publish.
    return { name, raw_fn: undefined, ...flat };
  }
  validated.value = null;
  await form.handleSubmit();
  const values = validated.value as AssociateFunctionForm | null;
  if (!values?.selectedFunction) return null;
  return props.showFlatten
    ? { name: values.selectedFunction, after_flatten: !!values.afterFlattening }
    : { name: values.selectedFunction };
};

// `isDirty` / `discardChanges` drive the workflow NDV's save-or-discard exit prompt;
// `saveChanges` opens the Save (Update|Create) flow with the live editor code.
const saveChanges = () => onBottomSave();
defineExpose({ submit, createNewFunction, form, isDirty, discardChanges, saveChanges });
</script>
