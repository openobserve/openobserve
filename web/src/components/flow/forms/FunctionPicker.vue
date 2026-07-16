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
          data-test="function-picker-create-toggle"
        />
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
          data-test="function-picker-select"
        />

        <!-- read-only definition preview -->
        <div
          v-if="selectedFunction && selectedDefinition"
          data-test="function-picker-definition"
          class="mt-4 mb-4"
        >
          <!-- Dark styling is bound to the app theme (store.state.theme), NOT
               dark: — the dark: variant follows the OS prefers-color-scheme
               here (no @custom-variant dark), which flips this card dark in the
               app's light mode. -->
          <OCard
            class="function-definition-card border rounded-lg overflow-hidden"
            :class="isDark
              ? 'border-[#2d3748] bg-[#1a202c] shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
              : 'border-[#e1e5e9] shadow-[0_2px_4px_rgba(0,0,0,0.05)]'"
          >
            <OCardSection
              role="header"
              class="border-b"
              :class="isDark
                ? 'bg-[linear-gradient(135deg,#2d3748_0%,#1a202c_100%)] border-b-[#4a5568]'
                : 'bg-[linear-gradient(135deg,#f8fafc_0%,#f1f5f9_100%)] border-b-[#e2e8f0]'"
            >
              <div
                class="text-base font-semibold"
                :class="isDark ? 'text-white' : 'text-[#2d3748]'"
              >
                {{ t("function.function_definition") }}
              </div>
            </OCardSection>
            <OSeparator />
            <OCardSection class="p-0">
              <div
                class="function-code-container max-h-[250px] overflow-y-auto relative"
                :class="isDark ? 'bg-[#0d1117] border border-[#21262d]' : 'bg-[#fafbfc]'"
              >
                <pre
                  class="function-code bg-transparent m-0 p-4 text-[13px] leading-normal whitespace-pre-wrap break-words border-0 font-normal cursor-default select-text"
                  :class="isDark ? 'text-[#f7fafc]' : 'text-[#2d3748]'"
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
            data-test="function-picker-after-flatten-toggle"
          />
          <div class="bg-[#f9f290] text-[#2d3748] w-full rounded-md p-3 flex flex-col gap-2">
            <div class="text-sm text-[#2d3748]">
              {{ t("flow.function.guidelinesTitle") }}
            </div>
            <div class="flex flex-col gap-1 text-sm text-[#2d3748]">
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-amber-500" />
                <span>
                  <span class="font-bold text-[#007bff]">{{ t("flow.function.rbf") }}</span>
                  {{ t("flow.function.rbfDesc") }}
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-amber-500" />
                <span>
                  <span class="font-bold text-[#007bff]">{{ t("flow.function.raf") }}</span>
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

// App theme (not dark:, which follows the OS here — see the preview markup).
const isDark = computed(() => store.state.theme === "dark");

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
  const values = validated.value;
  if (!values?.selectedFunction) return null;
  return props.showFlatten
    ? { name: values.selectedFunction, after_flatten: !!values.afterFlattening }
    : { name: values.selectedFunction };
};

defineExpose({ submit, createNewFunction, form });
</script>

<style scoped>
/* Hide AddFunction's own title/back/fullscreen chrome inside the drawer. */
.flow-add-function :deep(.add-function-back-btn),
.flow-add-function :deep(.add-function-fullscreen-btn),
.flow-add-function :deep(.add-function-title) {
  display: none;
}
.flow-add-function :deep(.add-function-name-input) {
  width: 100%;
  margin-left: 0 !important;
}

.function-code {
  font-family: JetBrains Mono, Fira Code, Monaco, Menlo, Ubuntu Mono, monospace;
}
.function-code::selection {
  background-color: #bee3f8;
}
.function-code-container::-webkit-scrollbar {
  width: 6px;
}
.function-code-container::-webkit-scrollbar-track {
  background: #f7fafc;
}
.function-code-container::-webkit-scrollbar-thumb {
  background: #cbd5e0;
  border-radius: 3px;
}
.function-code-container::-webkit-scrollbar-thumb:hover {
  background: #a0aec0;
}
</style>
