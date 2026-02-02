<!-- Copyright 2023 OpenObserve Inc.

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
  <div
    data-test="add-function-node-routing-section"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
    :style="computedStyleForFunction"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md tw:flex tw:items-center tw:justify-between">
      {{ t("pipeline.associateFunction") }}
      <div>
          <q-btn v-close-popup="true" round flat icon="cancel" >
          </q-btn>
        </div>
    </div>
    <q-separator />

    <div v-if="loading">
      <q-spinner
        v-if="loading"
        color="primary"
        size="40px"
        style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        "
      />
    </div>
    <div
      v-else
      class="stream-routing-container full-width q-pt-xs q-pb-md q-px-md"
    >
      <div class="tw:flex tw:items-center">
        <q-toggle
          data-test="create-function-toggle"
          class="q-mb-sm tw:inline-block tw:h-[36px] o2-toggle-button-lg"
          size="lg"
          :class="[store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light', !createNewFunction ? '-tw:ml-4' : '']"
          :label="isUpdating ? 'Edit function' : 'Create new function'"
          v-model="createNewFunction"
        />
        <div
          v-if="createNewFunction"
          class="q-pb-sm container text-body2 tw:inline-block tw:pl-4 tw:text-gray-600"
        >
          ({{ t("alerts.newFunctionAssociationMsg") }})
        </div>
      </div>
      <q-form @submit="saveFunction">
        <div
          v-if="!createNewFunction"
          class="flex justify-start items-center full-width"
          style="padding-top: 0px"
        >
          <div
            data-test="associate-function-select-function-input"
            class="alert-stream-type o2-input q-mr-sm full-width"
            style="padding-top: 0"
          >
            <q-select
              v-model="selectedFunction"
              :options="filteredFunctions"
              :label="t('function.selectFunction') + ' *'"
              :popup-content-style="{ textTransform: 'lowercase' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop no-case"
              stack-label
              outlined
              filled
              dense
              use-input
              input-debounce="300"
              :rules="[(val: any) => !!val || 'Field is required!']"
              style="min-width: 220px"
              v-bind:readonly="isUpdating"
              v-bind:disable="isUpdating"
              :error-message="
                selectedFunction ? 'Function is already associated' : ''
              "
              @filter="filterFunctions"
              :error="functionExists"
            />
          </div>
        </div>

        <!-- Function Definition Display -->
        <div v-if="!createNewFunction && selectedFunction && pipelineObj.functions[selectedFunction]" class="function-definition-section">
          <q-card class="function-definition-card">
            <q-card-section class="function-definition-header q-pb-sm">
              <div class="text-body1 text-weight-medium text-primary">
                {{ t('function.function_definition') }}
              </div>
            </q-card-section>
            <q-separator />
            <q-card-section class="function-definition-content q-pa-none">
              <div class="function-code-container">
                <pre class="function-code">{{ pipelineObj.functions[selectedFunction]?.function || 'No definition available' }}</pre>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <div  v-if="createNewFunction" class="pipeline-add-function tw:w-[95vw]">
          <AddFunction
            ref="addFunctionRef"
            :is-updated="isUpdating"
            @update:list="onFunctionCreation"
            @cancel:hideform="cancelFunctionCreation"
            :heightOffset="75"
          />
        </div>

        <div
          class="o2-input full-width"
          style="padding-top: 12px"
          v-if="!createNewFunction"
        >
          <q-toggle
            data-test="associate-function-after-flattening-toggle"
            class="q-mb-sm tw:h-[36px] o2-toggle-button-lg tw:mr-3 -tw:ml-4"
            size="lg"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            :label="t('pipeline.flatteningLbl')"
            v-model="afterFlattening"
          />
          
          <!-- Info note explaining RAF/RBF -->
          <q-card class="note-container">
            <q-card-section class="q-pa-sm">
              <div class="note-heading">Function Execution Guidelines:</div>
              <q-banner inline dense class="note-info">
                <div>
                  <q-icon name="info" color="orange" class="q-mr-sm" />
                  <span><span class="highlight">RBF (Run Before Flattening):</span> Function executes before data structure is flattened</span>
                </div>
                <div>
                  <q-icon name="info" color="orange" class="q-mr-sm" />
                  <span><span class="highlight">RAF (Run After Flattening):</span> Function executes after data structure is flattened</span>
                </div>
              </q-banner>
            </q-card-section>
          </q-card>
        </div>

        <div
          class="flex justify-start full-width"
          :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        >
        <q-btn
            v-if="pipelineObj.isEditNode && !createNewFunction"
            data-test="associate-function-delete-btn"
            class="o2-secondary-button tw:h-[36px] q-mr-md"
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openDeleteDialog"
          >
          <q-icon name="delete" class="q-mr-xs" />
          {{ t('pipeline.deleteNode') }}
        </q-btn>
          <q-btn
            v-if="!createNewFunction"
            data-test="associate-function-cancel-btn"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openCancelDialog"
          />
          <q-btn
            v-if="!createNewFunction"
            data-test="associate-function-save-btn"
            :label="
              createNewFunction ? t('alerts.createFunction') : t('alerts.save')
            "
            class="no-border q-ml-md o2-primary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            flat
            no-caps
            type="submit"
          />
        </div>
      </q-form>
    </div>
  </div>
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
import { useQuasar } from "quasar";
import { getImageURL } from "@/utils/zincutils";

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
    ?.after_flatten ?? true
);


const filteredFunctions: Ref<any[]> = ref([]);

const createNewFunction = ref(false);
const q = useQuasar();

const store = useStore();

const functionExists = ref(false);

const nodeLink = ref({
  from: "",
  to: "",
});

const computedStyleForFunction = computed(() => {
  return createNewFunction.value
    ? { width: "100%", }
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
      q.notify({
        message: "Function Name is required",
        color: "negative",
        position: "bottom",
        timeout: 2000,
      });
      return;
    }
    return;
  }

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
  background-color: #F9F290;
  border-radius: 4px;
  border: 1px solid #F5A623;
  color: #865300;
  width: 100%;
  margin-bottom: 20px;
  margin-top: 10px;
}

.note-container .highlight {
  font-weight: bold;
  color: #007bff; /* Blue color to highlight key terms */
}

.note-container .emphasis {
  font-style: italic;
  color: #555; /* Subtle dark gray for emphasis */
}

.note-container .code {
  font-family: monospace;
  padding: 2px 4px;
  border-radius: 3px;
  color: #d63384; /* Soft pinkish-red for code */
}

.note-heading {
  font-size: medium;
}

.note-info {
  font-size: small;
  color: #865300;
  background-color: #F9F290;
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: space-between;
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
  font-family: 'JetBrains Mono', 'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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
