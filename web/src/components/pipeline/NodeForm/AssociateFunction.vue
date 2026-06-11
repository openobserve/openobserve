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
    @keydown.stop
    :primaryButtonLabel="!createNewFunction ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!createNewFunction ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!createNewFunction && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveFunction"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="add-function-node-routing-section"
      class="tw:flex tw:flex-col tw:h-full"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >


    <div v-if="loading">
      <OSpinner
        v-if="loading"
        size="md"
        class="tw:absolute tw:top-1/2 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2"
        data-test="associate-function-loading-indicator"
      />
    </div>
    <div
      v-else
      class="stream-routing-container tw:w-full tw:pt-3 tw:pb-3 tw:flex tw:flex-col tw:gap-4 tw:flex-1 tw:min-h-0"
    >
      <div class="tw:flex tw:items-center tw:gap-3 tw:px-(--spacing-dialog-header-px)">
        <OSwitch
          data-test="create-function-toggle"
          :label="isUpdating ? 'Edit function' : 'Create new function'"
          v-model="createNewFunction"
        />
        <div
          v-if="createNewFunction"
          class="tw:text-sm tw:text-gray-600"
        >
          ({{ t("alerts.newFunctionAssociationMsg") }})
        </div>
      </div>
      <div class="tw:flex tw:flex-col tw:gap-4" :class="[!createNewFunction ? 'tw:px-3' : 'tw:flex-1 tw:min-h-0']">
        <div
          v-if="!createNewFunction"
          class="tw:w-full"
        >
          <OSelect
            v-model="selectedFunction"
            :options="props.functions"
            :label="t('function.selectFunction') + ' *'"
            searchable
            :readonly="isUpdating"
            :disabled="isUpdating"
            :error="functionExists || (showFunctionRequiredError && !selectedFunction)"
            :error-message="
              functionExists
                ? 'Function is already associated'
                : (showFunctionRequiredError && !selectedFunction)
                  ? 'Field is required'
                  : ''
            "
            data-test="associate-function-select-function-input"
          />
        </div>

        <!-- Function Definition Display -->
        <div
          v-if="
            !createNewFunction &&
            selectedFunction &&
            pipelineObj.functions[selectedFunction]
          "
          class="function-definition-section"
        >
          <OCard class="function-definition-card">
            <OCardSection role="header" class="function-definition-header">
              <div class="tw:text-base text-weight-medium text-primary">
                {{ t("function.function_definition") }}
              </div>
            </OCardSection>
            <OSeparator />
            <OCardSection class="tw:p-0 function-definition-content">
              <div class="function-code-container">
                <pre class="function-code">{{
                  pipelineObj.functions[selectedFunction]?.function ||
                  "No definition available"
                }}</pre>
              </div>
            </OCardSection>
          </OCard>
        </div>

        <div v-if="createNewFunction" class="pipeline-add-function tw:w-full tw:flex-1 tw:min-h-0">
          <AddFunction
            ref="addFunctionRef"
            :is-updated="isUpdating"
            @update:list="onFunctionCreation"
            @cancel:hideform="cancelFunctionCreation"
            :heightOffset="75"
          />
        </div>

        <div
          class="tw:w-full tw:flex tw:flex-col tw:gap-3"
          v-if="!createNewFunction"
        >
          <OSwitch
            data-test="associate-function-after-flattening-toggle"
            :label="t('pipeline.flatteningLbl')"
            v-model="afterFlattening"
          />

          <!-- Info note explaining RAF/RBF -->
          <div class="note-container tw:rounded-md tw:p-3 tw:flex tw:flex-col tw:gap-2">
            <div class="tw:text-sm tw:text-gray-800">
              Function Execution Guidelines:
            </div>
            <div class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-gray-800">
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon
                  name="info"
                  size="sm"
                  class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500"
                />
                <span>
                  <span class="highlight">RBF (Run Before Flattening):</span>
                  Function executes before data structure is flattened
                </span>
              </div>
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon
                  name="info"
                  size="sm"
                  class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500"
                />
                <span>
                  <span class="highlight">RAF (Run After Flattening):</span>
                  Function executes after data structure is flattened
                </span>
              </div>
            </div>
          </div>
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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

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

const selectedFunction = ref(
  (pipelineObj.currentSelectedNodeData?.data as { name?: string })?.name || "",
);

const loading = ref(false);

const afterFlattening = ref(
  (pipelineObj.currentSelectedNodeData?.data as { after_flatten?: boolean })
    ?.after_flatten ?? true,
);

const filteredFunctions: Ref<any[]> = ref([]);

const createNewFunction = ref(false);

const store = useStore();

const functionExists = ref(false);
// Toggle for "Field is required" — flipped on save when no function is selected.
const showFunctionRequiredError = ref(false);

// Clear the "Field is required" error as soon as the user picks a function.
watch(selectedFunction, (next) => {
  if (next) showFunctionRequiredError.value = false;
});

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

const saveFunction = () => {
  functionExists.value = false;

  if (createNewFunction.value) {
    if (addFunctionRef.value.formData.name == "") {
      toast({
        message: "Function Name is required",
        variant: "warning",
      });
      return;
    }
    return;
  }

  // Validate that a function has been selected before allowing save.
  if (!selectedFunction.value) {
    showFunctionRequiredError.value = true;
    return;
  }
  showFunctionRequiredError.value = false;

  if (
    !isUpdating.value &&
    selectedFunction.value &&
    props.associatedFunctions.includes(selectedFunction.value)
  ) {
    functionExists.value = true;
    return;
  }

  const functionNode = {
    name: selectedFunction.value,
    after_flatten: afterFlattening.value,
  };
  addNode(functionNode);
  // emit("update:node", {
  //   data: { name: selectedFunction.value, order: functionOrder.value },
  //   link: nodeLink.value,
  // });
  emit("cancel:hideform");
};

const onFunctionCreation = async (_function: any) => {
  // Assign newly created function to the block
  createNewFunction.value = false;
  emit("add:function", _function);
  await nextTick();
  selectedFunction.value = _function.name;
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

<style scoped lang="scss">
.stream-routing-title {
  font-size: 18px;
  padding-top: 16px;
}
.stream-routing-container {
  border-radius: 8px;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}

.pipeline-add-function {
  :deep(.add-function-back-btn),
  :deep(.add-function-fullscreen-btn),
  :deep(.add-function-title) {
    display: none;
  }
}

.note-container {
  background-color: #f9f290;
  color: #2d3748;
  width: 100%;
}

.note-container .highlight {
  font-weight: bold;
  color: #007bff;
}



/* Function definition display - OpenObserve style */
.function-definition-section {
  margin-top: 16px;
  margin-bottom: 16px;
}

.function-definition-card {
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.function-definition-header {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
}

.function-definition-header .text-primary {
  color: #2d3748 !important;
  font-weight: 600;
}

.function-code-container {
  background-color: #fafbfc;
  border-radius: 0;
  max-width: 584px;
  max-height: 250px;
  overflow-y: auto;
  position: relative;
}

.function-code {
  color: #2d3748;
  background-color: transparent;
  margin: 0;
  padding: 16px;
  font-family:
    "JetBrains Mono", "Fira Code", "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  border: none;
  font-weight: 400;
  cursor: default;
  user-select: text;
}

.function-code::selection {
  background-color: #bee3f8;
}

/* Custom scrollbar */
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

/* Dark mode - Enhanced OpenObserve style */
.body--dark .function-definition-card {
  border-color: #2d3748;
  background-color: #1a202c;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.body--dark .function-definition-header {
  background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
  border-bottom-color: #4a5568;
}

.body--dark .function-definition-header .text-primary {
  color: #ffffff !important;
  font-weight: 600;
}

.body--dark .readonly-chip {
  background-color: #2d3748 !important;
  border-color: #4a5568 !important;
  color: #a0aec0 !important;
}

.body--dark .function-code-container {
  background-color: #0d1117;
  border: 1px solid #21262d;
}

.body--dark .function-code {
  color: #f7fafc;
  background-color: transparent;
}

.body--dark .function-code::selection {
  background-color: #2b6cb0;
  color: #ffffff;
}

.body--dark .function-code-container::-webkit-scrollbar {
  width: 8px;
}

.body--dark .function-code-container::-webkit-scrollbar-track {
  background: #0d1117;
  border-radius: 4px;
}

.body--dark .function-code-container::-webkit-scrollbar-thumb {
  background: #4a5568;
  border-radius: 4px;
  border: 1px solid #2d3748;
}

.body--dark .function-code-container::-webkit-scrollbar-thumb:hover {
  background: #718096;
}
</style>

<style lang="scss">
.pipeline-add-function {
  .add-function-name-input {
    width: 100%;
    margin-left: 0px !important;

    label {
      width: 100%;
      padding-left: 0;
    }
  }
}
</style>
