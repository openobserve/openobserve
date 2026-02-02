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
  <div class="tw:w-full tw:h-full tw:pr-[0.625rem]">
    <div class="card-container tw:h-[calc(100vh-50px)]">
      <div class="flex justify-between items-start q-py-sm q-px-sm">
        <div class="flex items-center tw:pl-3">
          <div class="text-h6" v-if="pipelineObj.isEditPipeline == true">
            {{ pipelineObj.currentSelectedPipeline.name }}
          </div>
          <div class="text-h6" v-if="pipelineObj.isEditPipeline == false">
            <q-input
              ref="pipelineNameInputRef"
              v-model="pipelineObj.currentSelectedPipeline.name"
              :placeholder="t('pipeline.pipelineName')"
              borderless
              dense
              hide-bottom-space
              class="tw:w-[300px]"
              :error="pipelineNameError"
              :error-message="pipelineNameErrorMessage"
            />
          </div>
        </div>

        <div class="flex justify-end items-center">
          <!-- this is normal secondary button but only icon is there without label -->
            <q-btn
              class="pipeline-icons q-px-sm q-ml-sm hideOnPrintMode tw:h-[36px] o2-secondary-button tw:min-w-0"
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              no-caps
              flat
              icon="code"
              data-test="pipeline-json-edit-btn"
              @click="openJsonEditor"
            >
                  <q-tooltip>{{ t('pipeline.editPipelineJson') }}</q-tooltip>
                </q-btn>
          <q-btn
            data-test="add-pipeline-cancel-btn"
            :label="t('pipeline.cancel')"
            flat
            class="q-ml-md o2-secondary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openCancelDialog"
          />

          <q-btn
            data-test="add-pipeline-save-btn"
            :label="t('common.save')"
            class="q-ml-md o2-primary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            no-caps
            flat
            :loading="isPipelineSaving"
            :disable="isPipelineSaving"
            @click="savePipeline"
          />
        </div>
      </div>

      <q-separator class="q-mb-sm q-px-sm" />

      <div class="flex q-mt-md q-px-sm">
        <div class="nodes-drag-container q-pr-md">
          <div
            data-test="pipeline-editor-nodes-list-title"
            class="nodes-header q-mb-sm q-mx-sm"
          >
            {{ t("pipeline.nodes") }}
          </div>


          <div class="flex q-mt-sm">
            <NodeSidebar
              v-show="
                !pipelineObj.dialog.show || pipelineObj.dialog.name != 'query'
              "
              :nodeTypes="nodeTypes"
            />
          </div>
        </div>
        <div
          id="pipelineChartContainer"
          ref="chartContainerRef"
          class="relative-position pipeline-chart-container o2vf_node"
          :class="store.state.theme === 'dark' ? '' : 'bg-grey-2'"
          v-show="!pipelineObj.dialog.show || pipelineObj.dialog.name != 'query'"
        >
          <PipelineFlow />
        </div>
      </div>
    </div>
  </div>
  <q-dialog
    v-model="pipelineObj.dialog.show"
    full-width
    position="right"
    @keydown.stop
    maximized
  >
    <div
      data-test="pipeline-nodes-list-dragable"
      class="stream-routing-dialog-container"
      @keydown.stop
      tabindex="0"
    >
      <QueryForm
        v-if="pipelineObj.dialog.name === 'query'"
        :stream-name="pipeline.stream_name"
        :stream-type="pipeline.stream_type"
        :stream-routes="streamRoutes"
        @cancel:hideform="resetDialog"
      />

      <ConditionForm
        v-if="pipelineObj.dialog.name === 'condition'"
        @cancel:hideform="resetDialog"
      />

      <AssociateFunction
        v-if="pipelineObj.dialog.name === 'function'"
        :functions="functionOptions"
        :associated-functions="associatedFunctions"
        @cancel:hideform="resetDialog"
        @add:function="refreshFunctionList"
      />

      <StreamNode
        v-if="pipelineObj.dialog.name === 'stream'"
        @cancel:hideform="resetDialog"
      />
      <ExternalDestination
        v-if="pipelineObj.dialog.name === 'remote_stream'"
        @cancel:hideform="resetDialog"
      />
    </div>
  </q-dialog>
  <q-dialog
        v-model="showJsonEditorDialog"
        position="right"
        full-height
        maximized
        :persistent="true"
      >
        <JsonEditor
          :data="pipelineObj.currentSelectedPipeline"
          :title="t('pipeline.editPipelineJSON')"
          :type="'pipelines'"
          :validation-errors="validationErrors"
          @close="showJsonEditorDialog = false"
          @saveJson="savePipelineJson"
        />
      </q-dialog>
  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
  <ConfirmDialog
    :title="t('pipeline.savePipeline')"
    :message="t('pipeline.savePipelineConfirm')"
    @update:ok="confirmSaveBasicPipeline"
    @update:cancel="resetBasicDialog"
    v-model="confirmDialogBasicPipeline"
  />
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeMount,
  onMounted,
  onUnmounted,
  watch,
  ref,
  type Ref,
} from "vue";
import { getImageURL } from "@/utils/zincutils";
import AssociateFunction from "@/components/pipeline/NodeForm/AssociateFunction.vue";
import functionsService from "@/services/jstransform";

import { useStore } from "vuex";
import pipelineService from "@/services/pipelines";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import jstransform from "@/services/jstransform";
import NodeSidebar from "@/components/pipeline/NodeSidebar.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import StreamNode from "@/components/pipeline/NodeForm/Stream.vue";
import QueryForm from "@/components/pipeline/NodeForm/Query.vue";
import ConditionForm from "@/components/pipeline/NodeForm/Condition.vue";
import { MarkerType, useVueFlow } from "@vue-flow/core";
import ExternalDestination from "./NodeForm/ExternalDestination.vue";
import { contextRegistry, createPipelinesContextProvider } from "@/composables/contextProviders";
import JsonEditor from "../common/JsonEditor.vue";
import { validatePipeline as validatePipelineUtil, type ValidationResult } from '../../utils/validatePipeline';
import { useReo } from "@/services/reodotdev_analytics";

const functionImage = getImageURL("images/pipeline/transform_function.png");
const streamImage = getImageURL("images/pipeline/input_stream.png");
const streamOutputImage = getImageURL("images/pipeline/output_stream.png");
const externalOutputImage = getImageURL("images/pipeline/output_remote.png");
const streamRouteImage = getImageURL("images/pipeline/route.svg");
const conditionImage = getImageURL("images/pipeline/transform_condition.png");
const queryImage = getImageURL("images/pipeline/input_query.png");
import useStreams from "@/composables/useStreams";
import usePipelines from "@/composables/usePipelines";

import config from "@/aws-exports";

const PipelineFlow = defineAsyncComponent(
  () => import("@/plugins/pipelines/PipelineFlow.vue"),
);

interface Routing {
  [key: string]: RouteCondition[];
}

interface RouteCondition {
  column: string;
  operator: string;
  value: string;
}

interface Function {
  name: string;
  description: string;
  stream: string;
  order: number;
}

interface Pipeline {
  pipeline_id: string;
  name: string;
  description: string;
  stream_name: string;
  stream_type: string;
  routing: Routing;
  functions: Function[];
  derived_streams: any[];
}

interface Node {
  name: string;
  x: number;
  y: number;
  type: string;
  fixed: boolean;
  order?: number;
  stream?: string;
}

interface NodeLink {
  from: string[];
  to: string[];
}

const plotChart: any = ref({
  options: {
    tooltip: {},
    series: [
      {
        type: "graph",
        layout: "none",
        symbolSize: "60",
        roam: false,
        label: {
          show: true,
          position: "bottom",
        },
        draggable: true,
        edgeSymbol: ["arrow"],
        edgeSymbolSize: [10, 10],
        edgeLabel: {
          fontSize: 20,
        },
        data: [],
        links: [],
        lineStyle: {
          opacity: 0.9,
          width: 2,
          curveness: 0,
        },
      },
    ],
  },
});

const pipeline = ref<Pipeline>({
  pipeline_id: "",
  name: "",
  stream_type: "",
  description: "",
  stream_name: "",
  routing: {},
  functions: [],
  derived_streams: [],
});

const router = useRouter();
const store = useStore();

const confirmDialogMeta: any = ref({
  show: false,
  title: "",
  message: "",
  data: null,
  onConfirm: () => {},
});

const nodeTypes: any = [
  {
    label: "Source",
    icon: "input",
    isSectionHeader: true,
  },
  {
    label: "Stream",
    subtype: "stream",
    io_type: "input",
    icon: "img:" + streamImage,
    tooltip: "Source: Stream Node",
    isSectionHeader: false,
  },
  {
    label: "Query",
    subtype: "query",
    io_type: "input",
    icon: "img:" + queryImage,
    tooltip: "Source: Query Node",
    isSectionHeader: false,
  },
  {
    label: "Transform",
    icon: "processing",
    isSectionHeader: true,
  },
  {
    label: "Function",
    subtype: "function",
    io_type: "default",
    icon: "img:" + functionImage,
    tooltip: "Function Node",
    isSectionHeader: false,
  },
  {
    label: "Condition",
    subtype: "condition",
    io_type: "default",
    icon: "img:" + conditionImage,
    tooltip: "Condition Node",
    isSectionHeader: false,
  },
  {
    label: "Destination",
    icon: "input",
    isSectionHeader: true,
  },
  {
    label: "Stream",
    subtype: "stream",
    io_type: "output",
    icon: "img:" + streamOutputImage,
    tooltip: "Destination: Stream Node",
    isSectionHeader: false,
  },
];
const functions = ref<{ [key: string]: Function }>({});

const { pipelineObj, resetPipelineData } = useDragAndDrop();
pipelineObj.nodeTypes = nodeTypes;
pipelineObj.functions = functions;

const nodes: Ref<Node[]> = ref([]);

const hasInputType = computed(() => {
  return pipelineObj.currentSelectedPipeline.nodes.some(
    (node: any) => node.io_type === "input",
  );
});

const nodeLinks = ref<{ [key: string]: NodeLink }>({});

const refreshFunctionList = () => {
  getFunctions();
};
const { getUsedStreamsList, getPipelineDestinations } = usePipelines();
const functionOptions = ref<string[]>([]);
const pipelineDestinationsList = ref<any[]>([]);
const usedStreamsListResponse = ref<any[]>([]);


const streamRoutes = ref<{ [key: string]: any }>({});

const editingStreamRouteName = ref<string>("");

const editingFunctionName = ref<string>("");

const isFetchingFunctions = ref(false);

const chartContainerRef = ref(null);

const isPipelineSaving = ref(false);

const { getStreams } = useStreams();

const nodeRows = ref<(string | null)[]>([]);

const q = useQuasar();

const confirmDialogBasicPipeline = ref(false);
const showJsonEditorDialog = ref(false);
const associatedFunctions: Ref<string[]> = ref([]);

const { t } = useI18n();

const dialog = ref({
  name: "streamRouting",
  show: false,
  title: "Stream Routing",
  message: "",
  okCallback: () => {},
});

const validationErrors = ref<string[]>([]);

const { track } = useReo();

// Pipeline name input validation
const pipelineNameInputRef = ref(null);
const pipelineNameError = ref(false);
const pipelineNameErrorMessage = ref("");

// Clear error when user starts typing in pipeline name
watch(
  () => pipelineObj.currentSelectedPipeline.name,
  (newValue) => {
    if (newValue && newValue.trim() !== "") {
      pipelineNameError.value = false;
      pipelineNameErrorMessage.value = "";
    }
  }
);

// Watch for dialog changes to track node drops
watch(
  () => pipelineObj.dialog.show,
  (newShow, oldShow) => {
    // Track when dialog opens (node is dropped)
    if (newShow && !oldShow && pipelineObj.dialog.name) {
      let buttonName = "";

      if (pipelineObj.dialog.name === "stream") {
        // Check if it's input or output stream from the current selected node data
        const ioType = pipelineObj.currentSelectedNodeData?.type;
        if (ioType === "input") {
          buttonName = "Add Input Stream Node";
        } else if (ioType === "output") {
          buttonName = "Add Output Stream Node";
        } else {
          buttonName = "Add Stream Node";
        }
      } else {
        const nodeTypeMap: { [key: string]: string } = {
          query: "Add Query Node",
          condition: "Add Condition Node",
          function: "Add Function Node",
          remote_stream: "Add Remote Stream Node"
        };
        buttonName = nodeTypeMap[pipelineObj.dialog.name] || `Add ${pipelineObj.dialog.name}`;
      }

      track("Button Click", {
        button: buttonName,
        page: "Pipeline Editor"
      });
    }
  },
  { immediate: false }
);

onBeforeMount(() => {
  if (config.isEnterprise == "true") {
    nodeTypes.push({
      label: "Remote",
      subtype: "remote_stream",
      io_type: "output",
      icon: "img:" + externalOutputImage,
      tooltip: "Destination: External Destination Node",
      isSectionHeader: false,
    });
  }
  const route = router.currentRoute.value;
  if (route.name == "pipelineEditor" && route.query.id) {
    getPipeline();
    pipelineObj.isEditPipeline = true;
  } else {
    pipelineObj.isEditPipeline = false;
    resetPipelineData();
  }
  getFunctions();
});

// Initialize Vue Flow composables
const { getSelectedEdges, removeEdges } = useVueFlow()

onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnloadHandler);
  
  // Add keyboard handler for edge deletion
  const handleKeydown = (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const selectedEdges = getSelectedEdges.value
      
      if (selectedEdges.length > 0) {
        event.preventDefault()
        const edgeIds = selectedEdges.map(edge => edge.id)
        removeEdges(edgeIds)
      }
    }
  }
  
  window.addEventListener("keydown", handleKeydown);
  
  // Store handler reference for cleanup
  (window as any).pipelineKeydownHandler = handleKeydown;
  
  pipelineDestinationsList.value = await getPipelineDestinations();
  usedStreamsListResponse.value = await getUsedStreamsList();
  const { path, query } = router.currentRoute.value; 
    if (path.includes("edit") && !query.id) {
      router.push({
        name:"pipelines",
        query:{
          org_identifier: store.state.selectedOrganization.identifier
        }
      })
    }
    
  // Setup pipelines context provider
  setupPipelinesContextProvider();
  });

onUnmounted(() => {
  window.removeEventListener("beforeunload", beforeUnloadHandler);
  
  // Cleanup keyboard handler
  if ((window as any).pipelineKeydownHandler) {
    window.removeEventListener("keydown", (window as any).pipelineKeydownHandler);
  }
  
  // Cleanup pipelines context provider
  cleanupPipelinesContextProvider();
});

let forceSkipBeforeUnloadListener = false;

onBeforeRouteLeave((to, from, next) => {
  // check if it is a force navigation, then allow
  if (forceSkipBeforeUnloadListener) {
    next();
    return;
  }
  // else continue to warn user
  if (
    (from.path === "/pipeline/pipelines/edit" && pipelineObj.dirtyFlag) ||
    (from.path === "/pipeline/pipelines/add" &&
      pipelineObj.currentSelectedPipeline.nodes.length)
  ) {
    const confirmMessage = t("pipeline.unsavedMessage");
    if (window.confirm(confirmMessage)) {
      // User confirmed, allow navigation
      next();
    } else {
      // User canceled, prevent navigation
      next(false);
    }
  } else {
    // No unsaved changes or not leaving the edit route, allow navigation
    next();
  }
});

const getPipeline = () => {
  const route = router.currentRoute.value;

  pipelineService
    .getPipelines(store.state.selectedOrganization.identifier)
    .then(async (response) => {
      const _pipeline = response.data.list.find(
        (pipeline: Pipeline) => pipeline.pipeline_id === route.query.id,
      );

      _pipeline.edges.forEach((edge: any) => {
        edge.markerEnd = {
          type: MarkerType.ArrowClosed,
          width: 20, // Increase arrow width
          height: 20, // Increase arrow height
        };
        edge.style = {
          ...edge.style, // Preserve existing styles
          strokeWidth: 2,
        };
        edge.type = "custom";
        edge.animated = true;
      });

      _pipeline.nodes.forEach((node: any) => {
        node.type = node.io_type;
      });

      _pipeline.nodes.forEach((node: any) => {
        node.type = node.io_type;
      });

      if (!_pipeline) {
        q.notify({
          message: t("pipeline.pipelineNotFound"),
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
        router.replace({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }

      pipelineObj.currentSelectedPipeline = _pipeline;
      pipelineObj.pipelineWithoutChange = JSON.parse(JSON.stringify(_pipeline));
    });
};

const getFunctions = () => {
  // if (Object.keys(functions.value).length) return;
  isFetchingFunctions.value = true;
  return functionsService
    .list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    )
    .then((res) => {
      functions.value = {};
      functionOptions.value = [];
      res.data.list.forEach((func: Function) => {
        // Only include VRL functions (trans_type === 0 or undefined)
        // JavaScript functions (trans_type === 1) cannot be used in pipelines
        if (func.trans_type !== 1) {
          functions.value[func.name] = func;
          functionOptions.value.push(func.name);
        }
      });
    })
    .finally(() => {
      isFetchingFunctions.value = false;
    });
};

const resetDialog = () => {
  pipelineObj.dialog.show = false;
  pipelineObj.dialog.name = "";
  editingFunctionName.value = "";
  editingStreamRouteName.value = "";
};

const savePipeline = async () => {
  forceSkipBeforeUnloadListener = true;
  if (pipelineObj.currentSelectedPipeline.name === "") {
    pipelineNameError.value = true;
    pipelineNameErrorMessage.value = t("pipeline.pipelineNameRequired");

    // Focus the input field
    if (pipelineNameInputRef.value) {
      pipelineNameInputRef.value.focus();
    }

    q.notify({
      message: t("pipeline.pipelineNameRequired"),
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
    return;
  }

  // Clear error state if name is valid
  pipelineNameError.value = false;
  pipelineNameErrorMessage.value = "";
  // Find the input node
  const inputNodeIndex = pipelineObj.currentSelectedPipeline.nodes.findIndex(
    (node: any) =>
      node?.io_type === "input" &&
      (node.data?.node_type === "stream" || node.data?.node_type === "query"),
  );

  const outputNodeIndex = pipelineObj.currentSelectedPipeline.nodes.findIndex(
    (node: any) => node?.io_type === "output",
  );

  if (inputNodeIndex === -1) {
    q.notify({
      message: t("pipeline.sourceNodeRequired"),
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
    if(showJsonEditorDialog.value == true){
      validationErrors.value = [t("pipeline.sourceNodeRequired")];
    }
    return;
  } else if (outputNodeIndex === -1) {
    q.notify({
      message: t("pipeline.destinationNodeRequired"),
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
    if(showJsonEditorDialog.value == true){
      validationErrors.value = [t("pipeline.destinationNodeRequired")];
    }
    return;
  } else {
    pipelineObj.currentSelectedPipeline.nodes.map((node: any) => {
      if (
        node.data.node_type === "stream" &&
        node.data.stream_name &&
        node.data.stream_name.hasOwnProperty("value")
      ) {
        node.data.stream_name = node.data.stream_name.value;
      }
    });
    const nodes = pipelineObj.currentSelectedPipeline.nodes as any[];

    const inputNode: any = nodes.splice(inputNodeIndex, 1)[0];
    nodes.unshift(inputNode);
    if (inputNode.data.node_type === "stream") {
      pipelineObj.currentSelectedPipeline.source.source_type = "realtime";
    } else {
      pipelineObj.currentSelectedPipeline.source.source_type = "scheduled";
    }
  }

  pipelineObj.currentSelectedPipeline.org =
    store.state.selectedOrganization.identifier;
  if (findMissingEdges()) {
    q.notify({
      message: t("pipeline.connectAllNodes"),
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
    if(showJsonEditorDialog.value == true){
      validationErrors.value = [t("pipeline.connectAllNodes")];
    }
    return;
  }

  const isValid = isValidNodes(pipelineObj.currentSelectedPipeline.nodes);
  if (!isValid && showJsonEditorDialog.value == false) {
    confirmDialogBasicPipeline.value = true;
    return;
  }

  await onSubmitPipeline();
};

const confirmSaveBasicPipeline = async () => {
  confirmDialogBasicPipeline.value = false;
  await onSubmitPipeline();
};
const validatePipeline = () => {
  // Find input node
  const inputNode = pipelineObj.currentSelectedPipeline.nodes?.find(
    (node: any) => node.type === "input",
  );

  const outputNode = pipelineObj.currentSelectedPipeline.nodes?.find(
    (node: any) => node.type === "output",
  );

  // If trying to use enrichment_tables with stream input, return false
  if (
    inputNode.data?.node_type === "stream" &&
    outputNode.data?.node_type === "stream" &&
    outputNode.data?.stream_type === "enrichment_tables"
  ) {
    q.notify({
      message: t("pipeline.enrichmentTablesScheduledOnly"),
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return false;
  }

  return true;
};

const onSubmitPipeline = async () => {
  isPipelineSaving.value = true;
  // if(!validatePipeline()){
  //   isPipelineSaving.value = false;
  //   return;
  // }
  if(showJsonEditorDialog.value == false){
    if(!validatePipeline()){
      isPipelineSaving.value = false;
      return;
    }
  }
  const dismiss = q.notify({
    message: t("pipeline.savingPipeline"),
    position: "bottom",
    spinner: true,
  });

  const saveOperation = pipelineObj.isEditPipeline
    ? pipelineService.updatePipeline({
        data: pipelineObj.currentSelectedPipeline,
        org_identifier: store.state.selectedOrganization.identifier,
      })
    : pipelineService.createPipeline({
        data: pipelineObj.currentSelectedPipeline,
        org_identifier: store.state.selectedOrganization.identifier,
      });

  saveOperation
    .then(() => {
      if (pipelineObj.isEditPipeline && showJsonEditorDialog.value == false) {
        pipelineObj.isEditPipeline = false;

        router.push({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
      });
      q.notify({
        message: t("pipeline.pipelineUpdated"),
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
      }
      else if (!pipelineObj.isEditPipeline && showJsonEditorDialog.value == false) {
        showJsonEditorDialog.value = false;
        router.push({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
      });
        q.notify({
          message: t("pipeline.pipelineSaved"),
          color: "positive",
          position: "bottom",
          timeout: 3000,
        });
      }
      else if(pipelineObj.isEditPipeline && showJsonEditorDialog.value == true){
        showJsonEditorDialog.value = false;
        q.notify({
          message: t("pipeline.pipelineUpdated"),
          color: "positive",
          position: "bottom",
          timeout: 3000,
        });
      }
      else{
        showJsonEditorDialog.value = false;
        router.push({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        q.notify({
          message: t("pipeline.pipelineSaved"),
          color: "positive",
          position: "bottom",
          timeout: 3000,
        });
      }


    })
    .catch((error) => {
      if (pipelineObj.isEditPipeline) {
        pipelineObj.isEditPipeline = true;
      }

      if (
        error.response?.data?.message === "Invalid Pipeline: empty edges list"
      ) {
        q.notify({
          message: t("pipeline.connectAllNodesShort"),
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
        if(showJsonEditorDialog.value == true){
          validationErrors.value = [t("pipeline.connectAllNodes")];
        }
      } else {
        if (error.response.status != 403) {
          q.notify({
            message:
              error.response?.data?.message || t("pipeline.errorSavingPipeline"),
            color: "negative",
            position: "bottom",
            timeout: 3000,
          });
          if(showJsonEditorDialog.value == true){
            validationErrors.value = [error.response?.data?.message || t("pipeline.errorSavingPipeline")];
          }
        }
      }
    })
    .finally(() => {
      isPipelineSaving.value = false;
      dismiss();
    });
    track("Button Click", {
      button: "Save Pipeline",
      page: "Add Pipeline"
    });
};

const openCancelDialog = () => {
  if (
    pipelineObj.dirtyFlag ||
    (!pipelineObj.isEditPipeline &&
      pipelineObj.currentSelectedPipeline.nodes.length > 1)
  ) {
    confirmDialogMeta.value.show = true;
    confirmDialogMeta.value.title = t("common.cancelChanges");
    confirmDialogMeta.value.message = t("pipeline.cancelChangesConfirm");
    confirmDialogMeta.value.onConfirm = () => {
      resetPipelineData();
      router.push({
        name: "pipelines",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      track("Button Click", {
        button: "Cancel Pipeline",
        page: "Add Pipeline"
      });
    };
  } else {
    router.push({
      name: "pipelines",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
  }
};
const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.title = "";
  confirmDialogMeta.value.message = "";
  confirmDialogMeta.value.onConfirm = () => {};
  confirmDialogMeta.value.data = null;
};

const resetBasicDialog = () => {
  confirmDialogBasicPipeline.value = false;
  router.push({
    name: "pipelines",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const findMissingEdges = () => {
  const nodes = pipelineObj.currentSelectedPipeline.nodes;
  const edges = pipelineObj.currentSelectedPipeline.edges;

  // Collect node IDs that are part of edges (either source or target)
  const outgoingConnections = new Set(edges.map((edge: any) => edge.source));
  const incomingConnections = new Set(edges.map((edge: any) => edge.target));

  // Find nodes that are not connected properly
  const unconnectedNodes = nodes.filter((node: any) => {
    if (node.type === "default") {
      // Check for both incoming and outgoing edges
      return (
        !incomingConnections.has(node.id) || !outgoingConnections.has(node.id)
      );
    } else {
      // Check for at least one connection (incoming or outgoing)
      return (
        !incomingConnections.has(node.id) && !outgoingConnections.has(node.id)
      );
    }
  });

  if (unconnectedNodes.length > 0) {
    return true; // There are unconnected nodes
  }

  return false; // All nodes are properly connected
};
const isValidNodes = (nodes: any) => {
  if (nodes.length > 2) {
    return true;
  }
  const inputNode = nodes.find((node: any) => node.io_type === "input");
  const outputNode = nodes.find((node: any) => node.io_type === "output");

  if (inputNode.data.node_type !== "stream") {
    return true;
  }
  if (
    inputNode.data.node_type === "stream" &&
    outputNode.data.node_type === "stream" &&
    inputNode.data.stream_name === outputNode.data.stream_name &&
    inputNode.data.stream_type === outputNode.data.stream_type
  ) {
    return false;
  }
  return true;
};

// Drag n Drop methods

const onNodeDragStart = (event: any, data: any) => {
  event.dataTransfer.setData("text", data);
};

const onNodeDrop = (event: any) => {
  event.preventDefault();
  const nodeType = event.dataTransfer.getData("text");
};

const onNodeDragOver = (event: any) => {
  event.preventDefault();
};

const updateNewFunction = (_function: Function) => {
  if (!functions.value[_function.name]) {
    // Only add VRL functions (trans_type !== 1) to pipeline options
    // JavaScript functions cannot be used in pipelines
    if (_function.trans_type !== 1) {
      functions.value[_function.name] = _function;
      functionOptions.value.push(_function.name);
    }
  }
};

const beforeUnloadHandler = (e: any) => {
  //check is data updated or not
  if (
    pipelineObj.dirtyFlag ||
    (pipelineObj.currentSelectedPipeline.nodes.length > 1 &&
      !pipelineObj.isEditPipeline)
  ) {
    // Display a confirmation message
    const confirmMessage = t("pipeline.unsavedMessage");
    e.returnValue = confirmMessage;
    return confirmMessage;
  }
};

const openJsonEditor = () => {
  showJsonEditorDialog.value = true;
};

const savePipelineJson = async (json: string) => {
  try {
    const parsedPipeline = JSON.parse(json);
    let streamList: any = [];
    let usedStreamsList: any = [];
    if(pipelineObj.currentSelectedPipeline.source.source_type === "realtime"){
      try{
        //there are couple of scenarios that we need to take care of 
        //if user gets error that this stream is not there 
        //2. we dont know if user selects scheduled or realtime right so we need to do this check at the time of saving only 
        //3. TODO: store these list in the store so that unnecessary api calls will be avoided.
        const streamsListResponse: any = await getStreams(parsedPipeline.source.stream_type || "logs", false);
        streamList = streamsListResponse.list.map((stream: any) => stream.name);
        usedStreamsList = usedStreamsListResponse.value.filter((stream: any) => stream.stream_type == parsedPipeline.source.stream_type).map((stream: any) => stream.stream_name);
      }
      catch(error){
        console.log(error, 'error')
      }
    }

    const validationResult = validatePipelineUtil(parsedPipeline, { streamList: streamList, usedStreamsList: usedStreamsList, originalPipeline: pipelineObj.currentSelectedPipeline, pipelineDestinations: pipelineDestinationsList.value, functionsList: functionOptions.value, selectedOrgId: store.state.selectedOrganization.identifier });
    
    if (!validationResult.isValid) {
      // Set validation errors to be displayed in the JsonEditor
      validationErrors.value = validationResult.errors;
      return; // Don't save if validation fails
    }
    
    // Clear any previous validation errors
    validationErrors.value = [];
    
    // Only save if validation passes
    pipelineObj.currentSelectedPipeline = parsedPipeline;
    savePipeline();
  } catch (error) {
    console.log(error, 'error')
    // Handle JSON parsing errors
    validationErrors.value = ['Invalid JSON format'];
  }
};

// [START] Pipelines Context Provider Setup

/**
 * Setup the pipelines context provider for AI chat integration
 * 
 * Example: When user opens pipeline editor, this registers the context provider
 * that will extract pipeline information for AI context
 */
const setupPipelinesContextProvider = () => {
  const provider = createPipelinesContextProvider(pipelineObj, store);
  
  contextRegistry.register('pipelines', provider);
  contextRegistry.setActive('pipelines');
};

/**
 * Cleanup pipelines context provider when leaving pipeline editor
 * 
 * Example: When user navigates away from pipeline editor, this removes the provider
 * but keeps the default provider available for fallback
 */
const cleanupPipelinesContextProvider = () => {
  // Only unregister the pipelines provider, keep default provider
  contextRegistry.unregister('pipelines');
  // Reset to no active provider, so it falls back to default
  contextRegistry.setActive('');
};

// [END] Pipelines Context Provider Setup
</script>

<style scoped lang="scss">
.node-actions {
  top: 227px;
  left: 119px;
}
.diagram-container {
  border: 1px solid #000;
}

.pipeline-chart-container {
  height: 82.6vh;
  border-radius: 12px;
  width: calc(100% - 200px);
}

.nodes-drag-container {
  width: 200px;
}

.nodes-header {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  padding: 0 4px 8px 4px;
  text-align: center;
  margin-bottom: 16px !important;
  border-bottom: 2px solid #e5e7eb;
  letter-spacing: 0.05em;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 100%;
    height: 2px;
    background: #8b5cf6;
    border-radius: 1px;
  }
}

.node-type-row {
  cursor: grab;
  padding: 5px;
  border: 1px solid #e4e4e4;
  border-radius: 8px;
  user-select: none;
}

// Global rule to eliminate ALL transitions during any Vue Flow drag operation
.vue-flow.dragging,
.vue-flow:has(.vue-flow__node:active) {
  * {
    transition: none !important;
    animation: none !important;
  }
}

// Ensure dragging nodes have zero lag
.vue-flow__node.dragging,
.vue-flow__node:active {
  transition: none !important;
  transform: none !important;
  animation: none !important;
  
  * {
    transition: none !important;
    transform: none !important; 
    animation: none !important;
  }
}
</style>

<style lang="scss">
.stream-routing-dialog-container {
  min-width: 540px !important;
}

.o2vf_node {
  width: auto;

  .vue-flow__node {
    padding: 8px 16px;
    width: auto;
    min-height: 44px;
    transition: all 0.3s ease;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    cursor: grab;
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(10px);
    
    // Disable ALL transitions when dragging for zero lag
    &:active,
    &.dragging {
      cursor: grabbing;
      transition: none !important;
      * {
        transition: none !important;
      }
    }
  }

  .o2vf_node_input,
  .vue-flow__node-input {
    border: 1px solid #60a5fa;
    color: #1f2937;
    border-radius: 12px;
    background: rgba(239, 246, 255, 0.8);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
    transition: all 0.3s ease;
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;
    
    // Disable transitions during drag for zero lag
    &:active,
    &.dragging {
      cursor: grabbing;
      transition: none !important;
      * {
        transition: none !important;
      }
    }
  }

  .vue-flow__node-output {
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;

    border: 1px solid rgba(74, 222, 128, 0.4);
    color: #181a1B;
    border-radius: 8px;
    background: rgba(240, 253, 244, 0.9);
    box-shadow: 0 2px 8px rgba(34, 197, 94, 0.1);
    transition: all 0.3s ease;

    &:hover {
      background: rgba(240, 253, 244, 1);
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
      border-color: rgba(74, 222, 128, 0.6);
    }
    // Disable transitions during drag for zero lag
    &:active,
    &.dragging {
      cursor: grabbing;
      transition: none !important;
      * {
        transition: none !important;
      }
    }
  }


  .o2vf_node_default,
  .vue-flow__node-default {
    border: 1px solid #f59e0b;
    color: #1f2937;
    border-radius: 12px;
    background: rgba(255, 251, 235, 0.8);
    box-shadow: 0 4px 12px rgba(217, 119, 6, 0.1);
    transition: all 0.3s ease;
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;
    
    &:hover {
      border: 1px solid #f59e0b !important;
      background: rgba(255, 251, 235, 0.95) !important;
      box-shadow: 0 6px 16px rgba(217, 119, 6, 0.2) !important;
    }
    
    // Disable transitions during drag for zero lag
    &:active,
    &.dragging {
      cursor: grabbing;
      transition: none !important;
      * {
        transition: none !important;
      }
    }
  }

}

// Dark mode nodes header styling
.body--dark {
  .nodes-header {
    color: rgba(255, 255, 255, 0.95) !important;
    border-bottom: 2px solid rgba(255, 255, 255, 0.2) !important;

    &::after {
      background: #a855f7 !important;
    }
  }

  // Dark mode input nodes to match NodeSidebar
  .vue-flow__node-input,
  .o2vf_node_input {
    background: rgba(30, 58, 138, 0.2) !important;
    border: 1px solid rgba(96, 165, 250, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1) !important;

    &:hover {
      background: rgba(30, 58, 138, 0.3) !important;
      border-color: rgba(96, 165, 250, 0.5) !important;
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.2) !important;
    }
  }

  .vue-flow__node-output,
  .o2vf_node_output {
    background: rgba(20, 83, 45, 0.2) !important;
    border: 1px solid rgba(74, 222, 128, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;

    &:hover {
      background: rgba(20, 83, 45, 0.3) !important;
      border-color: rgba(74, 222, 128, 0.5) !important;
      box-shadow: 0 6px 16px rgba(34, 197, 94, 0.2) !important;
    }
  }

  // Dark mode default nodes to match NodeSidebar
  .vue-flow__node-default,
  .o2vf_node_default {
    background: rgba(120, 53, 15, 0.2) !important;
    border: 1px solid rgba(251, 146, 60, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1) !important;

    &:hover {
      background: rgba(120, 53, 15, 0.3) !important;
      border-color: rgba(251, 146, 60, 0.5) !important;
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.2) !important;
    }
  }
}

</style>
