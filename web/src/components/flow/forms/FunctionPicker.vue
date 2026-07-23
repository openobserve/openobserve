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

  Emits:
    expand(boolean)  — inline-create mode toggled (host can widen the drawer)
    created(fn)      — a new function was created inline

  Exposes:
    getPayload()  — { name, after_flatten? } or null (and surfaces validation)
-->
<template>
  <div
    data-test="function-picker"
    class="w-full flex flex-col gap-4"
    :class="createNewFunction ? 'h-full min-h-0 gap-0' : ''"
  >
    <OSpinner v-if="loading" size="md" class="mx-auto my-8" />

    <template v-else>
      <!-- create / pick toggle -->
      <div
        class="flex items-center gap-3"
        :class="createNewFunction ? 'px-4 pt-4 shrink-0' : ''"
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
          class="text-sm text-text-secondary"
          data-test="create-function-note"
        >
          ({{
            wantsJs
              ? t("flow.function.createNewNoteWorkflow")
              : t("alerts.newFunctionAssociationMsg")
          }})
        </div>
      </div>

      <!-- inline function editor (full-width; its own toolbar owns save/cancel) -->
      <div
        v-if="createNewFunction"
        class="flow-add-function flex-1 min-h-0 w-full"
      >
        <!-- ALWAYS a fresh function. AddFunction's `is-updated` means "editing an
             EXISTING function" and disables its name input (`:disable-name`), so
             it must never be fed our `isUpdating` — that flag means "editing the
             NODE", which is a different thing. Conflating them left the user
             unable to name the function they were creating. -->
        <AddFunction
          ref="addFunctionRef"
          :is-updated="false"
          :height-offset="75"
          :sample-events="sampleEvents"
          :forced-language="language"
          :default-code="defaultCode"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <OForm v-if="!createNewFunction" :form="form" class="flex flex-col gap-4">
        <!-- required + "already associated" are both enforced by the shared
             AssociateFunction schema, rendered inline on the field. -->
        <OFormSelect
          name="selectedFunction"
          :options="functionOptions"
          :label="t('flow.function.select')"
          required
          searchable
          :readonly="isUpdating"
          :disabled="isUpdating"
          data-test="associate-function-select-function-input"
        />

        <!-- read-only definition preview -->
        <div
          v-if="selectedFunction && selectedDefinition"
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
            class="function-definition-card border border-border-default bg-surface-base rounded-default overflow-hidden shadow-[0_0.125rem_0.25rem_color-mix(in_srgb,var(--color-black)_5%,transparent)]"
          >
            <OCardSection
              role="header"
              class="border-b border-b-border-default bg-surface-subtle"
            >
              <div class="text-base font-semibold text-text-heading">
                {{ t("function.function_definition") }}
              </div>
            </OCardSection>
            <OSeparator />
            <OCardSection class="p-0">
              <div
                class="function-code-container max-h-[15.625rem] overflow-y-auto relative bg-surface-subtle border border-border-default"
              >
                <pre
                  class="font-mono bg-transparent m-0 p-4 text-compact leading-normal whitespace-pre-wrap break-words border-0 font-normal cursor-default select-text text-text-code"
                >{{ selectedDefinition }}</pre>
              </div>
            </OCardSection>
          </OCard>
        </div>

        <!-- After-Flattening (RAF/RBF) toggle + guidelines -->
        <div v-if="showFlatten" class="w-full flex flex-col gap-3">
          <OFormSwitch
            name="afterFlattening"
            :label="t('flow.function.flatten')"
            data-test="associate-function-after-flattening-toggle"
          />
          <!-- Same theme-aware banner tokens the pipeline + workflow Condition
               notes use, so all three match and work in dark mode (the old
               #f9f290/#2d3748 were light-only). These were --color-note-* until
               #13173 removed that set; banner-warning-* is its replacement.
               The `border-banner-warning-border` matters in LIGHT mode: the bg
               (warning-50, ~#fefce8) is near-white, so without the border the
               callout blends into the page and reads as unstyled — the canonical
               warning banners (logstream/schema, settings/*) all carry it. -->
          <div class="bg-banner-warning-bg border border-banner-warning-border text-banner-warning-text w-full rounded-default p-3 flex flex-col gap-2">
            <div class="text-sm">
              {{ t("flow.function.guidelinesTitle") }}
            </div>
            <div class="flex flex-col gap-1 text-sm">
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  <span class="font-bold text-text-link">{{ t("flow.function.rbf") }}</span>
                  {{ t("flow.function.rbfDesc") }}
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  <span class="font-bold text-text-link">{{ t("flow.function.raf") }}</span>
                  {{ t("flow.function.rafDesc") }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </OForm>
    </template>
  </div>
</template>

<script lang="ts" setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeAssociateFunctionSchema,
  type AssociateFunctionForm,
} from "@/components/pipeline/NodeForm/AssociateFunction.schema";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import functionsService from "@/services/jstransform";
import { isJsFunction } from "@/utils/functionLanguage";

const AddFunction = defineAsyncComponent(
  () => import("@/components/functions/AddFunction.vue"),
);

const props = withDefaults(
  defineProps<{
    initialName?: string;
    initialAfterFlatten?: boolean;
    showFlatten?: boolean;
    isUpdating?: boolean;
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

const { t } = useI18n();
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
const selectedFunction = form.useStore(
  (s: any) => s.values?.selectedFunction ?? "",
);

const selectedDefinition = computed(
  () => functionDefs.value[selectedFunction.value] || "",
);

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

// Host bridge: validate through the schema and return the node payload, or null
// when invalid (OForm renders required / already-associated inline on the field).
const submit = async () => {
  if (createNewFunction.value) return null; // still in the inline editor
  validated.value = null;
  await form.handleSubmit();
  const values = validated.value as AssociateFunctionForm | null;
  if (!values?.selectedFunction) return null;
  return props.showFlatten
    ? { name: values.selectedFunction, after_flatten: !!values.afterFlattening }
    : { name: values.selectedFunction };
};

defineExpose({ submit, createNewFunction, form });
</script>

<style scoped>
/* keep(lib-override:AddFunction): only AddFunction's own chrome is suppressed here — :deep() reaches a child
   component's internals, which utilities cannot.
   The `.function-code` font-family became the `font-mono` utility, and the
   ::-webkit-scrollbar rules were DELETED: component.css already styles
   scrollbars globally from tokens WITH `.dark` variants, so these light-only
   hex rules were duplicating it and overriding the themed version in dark. */
.flow-add-function :deep(.add-function-back-btn),
.flow-add-function :deep(.add-function-fullscreen-btn),
.flow-add-function :deep(.add-function-title) {
  display: none;
}
.flow-add-function :deep(.add-function-name-input) {
  width: 100%;
  margin-left: 0 !important;
}
</style>
