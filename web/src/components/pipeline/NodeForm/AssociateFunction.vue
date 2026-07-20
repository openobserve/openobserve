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
  <ODrawer
    data-test="associate-function-drawer"
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.associateFunction')"
    :width="createNewFunction ? 97 : 30"
    :bleed="createNewFunction"
    @keydown.stop
    :primaryButtonLabel="!createNewFunction ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!createNewFunction ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!createNewFunction && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    form-id="associate-function-form"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="add-function-node-routing-section"
      class="flex flex-col h-full bg-surface-base"
    >


    <div v-if="loading">
      <OSpinner
        v-if="loading"
        size="md"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        data-test="associate-function-loading-indicator"
      />
    </div>
    <div
      v-else
      data-test="associate-function-routing-container"
      class="rounded-default w-full flex flex-col gap-4 flex-1 min-h-0"
    >
      <!-- In create mode the drawer body is `bleed` (0 inset) so the AddFunction
           editor can fill edge-to-edge; re-inset just this toggle row to match the
           header grid line. Select mode keeps the drawer's own 12px body inset. -->
      <div class="flex items-center gap-3" :class="createNewFunction ? 'px-3 pt-3' : ''">
        <OSwitch
          data-test="create-function-toggle"
          :label="isUpdating ? 'Edit function' : 'Create new function'"
          v-model="createNewFunction"
        />
        <div
          v-if="createNewFunction"
          class="text-sm text-text-secondary"
        >
          ({{ t("alerts.newFunctionAssociationMsg") }})
        </div>
      </div>
      <div class="flex flex-col gap-4" :class="[!createNewFunction ? '' : 'flex-1 min-h-0']">
        <!-- Select-existing branch — form-owned fields inside <OForm>. -->
        <OForm
          v-if="!createNewFunction"
          id="associate-function-form"
          :form="form"
          class="flex flex-col gap-4"
        >
          <div class="w-full">
            <OFormSelect
              name="selectedFunction"
              :options="props.functions"
              :label="t('function.selectFunction')"
              required
              searchable
              :readonly="isUpdating"
              :disabled="isUpdating"
              data-test="associate-function-select-function-input"
            />
          </div>

          <!-- Function Definition Display -->
          <div
            v-if="
              selectedFunction &&
              pipelineObj.functions[selectedFunction]
            "
            data-test="associate-function-definition-section"
            class="mt-4 mb-4"
          >
            <OCard class="function-definition-card border border-border-default rounded-default shadow-[0_2px_4px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] overflow-hidden bg-surface-base">
              <OCardSection role="header" class="function-definition-header bg-[linear-gradient(135deg,#f8fafc_0%,#f1f5f9_100%)] dark:bg-[linear-gradient(135deg,#2d3748_0%,#1a202c_100%)] border-b border-b-border-default">
                <div class="text-base font-semibold text-text-heading">
                  {{ t("function.function_definition") }}
                </div>
              </OCardSection>
              <OSeparator />
              <OCardSection class="p-0 function-definition-content">
                <div class="function-code-container bg-code-block-bg dark:border dark:border-border-default rounded-none max-w-146 max-h-62.5 overflow-y-auto relative">
                  <pre class="function-code text-code-block-text bg-transparent m-0 p-4 font-mono text-compact leading-normal whitespace-pre-wrap break-words border-0 font-normal cursor-default select-text selection:bg-primary-100 dark:selection:bg-primary-600 dark:selection:text-text-inverse">{{
                    pipelineObj.functions[selectedFunction]?.function ||
                    "No definition available"
                  }}</pre>
                </div>
              </OCardSection>
            </OCard>
          </div>

          <div class="w-full flex flex-col gap-3">
            <OFormSwitch
              data-test="associate-function-after-flattening-toggle"
              name="afterFlattening"
              :label="t('pipeline.flatteningLbl')"
            />

            <!-- Info note explaining RAF/RBF -->
            <div class="bg-banner-warning-bg text-banner-warning-text w-full rounded-default p-3 flex flex-col gap-2">
              <div class="text-sm text-banner-warning-text">
                Function Execution Guidelines:
              </div>
              <div class="flex flex-col gap-1 text-sm text-banner-warning-text">
                <div class="flex items-start gap-2">
                  <OIcon
                    name="info"
                    size="sm"
                    class="shrink-0 mt-0.5 text-status-warning-text"
                  />
                  <span>
                    <span class="font-bold text-text-link">RBF (Run Before Flattening):</span>
                    Function executes before data structure is flattened
                  </span>
                </div>
                <div class="flex items-start gap-2">
                  <OIcon
                    name="info"
                    size="sm"
                    class="shrink-0 mt-0.5 text-status-warning-text"
                  />
                  <span>
                    <span class="font-bold text-text-link">RAF (Run After Flattening):</span>
                    Function executes after data structure is flattened
                  </span>
                </div>
              </div>
            </div>
          </div>
        </OForm>

        <div v-if="createNewFunction" class="pipeline-add-function w-full flex-1 min-h-0">
          <AddFunction
            ref="addFunctionRef"
            :is-updated="isUpdating"
            @update:list="onFunctionCreation"
            @cancel:hideform="cancelFunctionCreation"
            :heightOffset="75"
          />
        </div>
      </div>
    </div>
    </div>
  </ODrawer>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import {
  ref,
  type Ref,
  watch,
  nextTick,
  defineAsyncComponent,
  onMounted,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import {
  makeAssociateFunctionSchema,
  type AssociateFunctionForm,
} from "./AssociateFunction.schema";

interface RouteCondition {
  column: string;
  operator: string;
  value: any;
  id: string;
}

interface StreamRoute {
  sourceStreamName: string;
  destinationStreamName: string;
  sourceStreamType: string;
  destinationStreamType: string;
  conditions: RouteCondition[];
}

const AddFunction = defineAsyncComponent(
  () => import("@/components/functions/AddFunction.vue"),
);

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  functions: {
    type: Array,
    required: true,
    default: () => {
      return [];
    },
  },
  associatedFunctions: {
    type: Array,
    required: true,
    default: () => {
      return [];
    },
  },
});

const emit = defineEmits([
  "update:node",
  "cancel:hideform",
  "delete:node",
  "add:function",
]);

const internalOpen = ref(!!props.open);
watch(() => props.open, (v) => { internalOpen.value = !!v; });

function handleDrawerClose(v: boolean) {
  internalOpen.value = v;
  if (!v) {
    setTimeout(() => emit("cancel:hideform"), 300);
  }
}

const { t } = useI18n();

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const addFunctionRef: any = ref(null);

const isUpdating = ref(false);

// Seeds for the form's `:default-values` (edit prefill).
const selectedFunctionSeed = ref(
  (pipelineObj.currentSelectedNodeData?.data as { name?: string })?.name || "",
);

const loading = ref(false);

const afterFlatteningSeed = ref(
  (pipelineObj.currentSelectedNodeData?.data as { after_flatten?: boolean })
    ?.after_flatten ?? true,
);

const filteredFunctions: Ref<any[]> = ref([]);

const createNewFunction = ref(false);

const store = useStore();

// Co-located schema (factory) — uniqueness reads the CURRENT associatedFunctions
// prop + isUpdating at validation time via getters. selectedFunction required +
// "already associated" uniqueness are both schema-driven now.
const associateFunctionSchema = makeAssociateFunctionSchema(
  t,
  () => (props.associatedFunctions as string[]) ?? [],
  () => isUpdating.value,
);

// Typed dynamic (edit-prefill) defaults — read once at OForm mount.
const associateFunctionDefaults = computed((): AssociateFunctionForm => ({
  selectedFunction: selectedFunctionSeed.value,
  afterFlattening: afterFlatteningSeed.value,
}));

// Rule ③ OWNER pattern: this component OWNS <OForm> and needs the live
// `selectedFunction` for the function-definition card's `v-if` + display, so it
// creates the form here with useOForm and reads it reactively via form.useStore
// — a SINGLE source of truth (no mirror ref, no store.subscribe). The form is
// handed to <OForm :form="form">.
const form = useOForm<AssociateFunctionForm>({
  defaultValues: associateFunctionDefaults.value,
  schema: associateFunctionSchema,
  onSubmit: (value) => saveFunction(value),
});

const selectedFunction = form.useStore((s: any) => s.values.selectedFunction);

const nodeLink = ref({
  from: "",
  to: "",
});

const computedStyleForFunction = computed(() => {
  return createNewFunction.value
    ? { width: "100%" }
    : { width: "100%", height: "100%" };
});

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

watch(
  () => props.functions,
  (newVal) => {
    filteredFunctions.value = [...newVal].sort((a: any, b: any) => {
      return a.localeCompare(b);
    });
  },
  {
    deep: true,
    immediate: true,
  },
);
onMounted(() => {
  if (pipelineObj.userSelectedNode) {
    pipelineObj.userSelectedNode = {};
  }
});

const openCancelDialog = () => {
  if (!isUpdating) {
    if (
      createNewFunction.value == true &&
      addFunctionRef.value.formData.name == "" &&
      addFunctionRef.value.formData.function == ""
    ) {
      createNewFunction.value = false;
      return;
    }
  }

  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = () => emit("cancel:hideform");
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message =
    "Are you sure you want to delete function association?";
  dialog.value.okCallback = deleteFunction;
};

// @submit handler for the select-existing branch — OForm only calls it once the
// schema passes (selectedFunction required + uniqueness via superRefine), so the
// schema gates the save (no manual functionExists / required guards). The
// create-new branch delegates to AddFunction (its own validation) and renders no
// footer Save, so @submit only fires here.
const saveFunction = (value: AssociateFunctionForm) => {
  const functionNode = {
    name: value.selectedFunction,
    after_flatten: value.afterFlattening,
  };
  addNode(functionNode);
  emit("cancel:hideform");
};

const onFunctionCreation = async (_function: any) => {
  // Assign newly created function to the block. Seed it so the select form
  // re-mounts (when toggling out of create mode) with the value, then push it in
  // once the form is mounted.
  selectedFunctionSeed.value = _function.name;
  createNewFunction.value = false;
  emit("add:function", _function);
  await nextTick();
  form.setFieldValue("selectedFunction", _function.name);
};

const cancelFunctionCreation = () => {
  emit("cancel:hideform");
};

const saveUpdatedLink = (link: { from: string; to: string }) => {
  nodeLink.value = link;
};

const deleteFunction = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);

  emit("cancel:hideform");
};
const filterFunctions = (val: any, update: any) => {
  const filtered = props.functions
    .filter((func: any) => func.toLowerCase().includes(val.toLowerCase()))
    .sort((a: any, b: any) => a.localeCompare(b));

  update(() => {
    filteredFunctions.value = filtered;
  });
};
</script>

<style scoped>
/* keep(lib-override): AddFunction renders its own back/fullscreen/title chrome and name
   input; this hides that chrome and stretches the input inside the pipeline drawer.
   All of it is AddFunction-internal DOM, so it is not addressable via template utilities. */
.pipeline-add-function :deep(.add-function-back-btn),
.pipeline-add-function :deep(.add-function-fullscreen-btn),
.pipeline-add-function :deep(.add-function-title) {
  display: none;
}

.pipeline-add-function :deep(.add-function-name-input) {
  width: 100%;
  margin-left: 0 !important;
}

.pipeline-add-function :deep(.add-function-name-input label) {
  width: 100%;
  padding-left: 0;
}

/* keep(scrollbar): ::-webkit-scrollbar pseudo-elements have no Tailwind utility equivalent. */
.function-code-container::-webkit-scrollbar {
  width: 0.375rem;
}

.function-code-container::-webkit-scrollbar-track {
  background: var(--color-surface-subtle);
}

.function-code-container::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 0.1875rem;
}

.function-code-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}

.dark .function-code-container::-webkit-scrollbar {
  width: 0.5rem;
}

.dark .function-code-container::-webkit-scrollbar-track {
  background: var(--color-surface-subtle);
  border-radius: 0.25rem;
}

.dark .function-code-container::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 0.25rem;
  border: 1px solid var(--color-border-default);
}

.dark .function-code-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}
</style>
