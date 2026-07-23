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
  <div class="w-full h-full flex flex-col min-h-0">
    <div class="flex-1 min-h-0 flex flex-col bg-card-glass-bg">
      <!-- The shell (Functions.vue) renders the "Pipelines › <name>" breadcrumb
           header; we contribute the editor actions to it via the portal and the
           pipeline name for NEW pipelines (edit mode shows it in the breadcrumb). -->
      <Teleport defer to="#o2-page-actions">
        <OButton
          variant="outline"
          size="icon-sm"
          class="hideOnPrintMode"
          data-test="pipeline-json-edit-btn"
          @click="openJsonEditor"
          icon-left="code"
        >
          <OTooltip :content="t('pipeline.editPipelineJson')" side="top" />
        </OButton>
        <OButton
          data-test="add-pipeline-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="openCancelDialog"
          >{{ t("pipeline.cancel") }}</OButton
        >
        <OButton
          data-test="add-pipeline-save-btn"
          variant="primary"
          size="sm-action"
          :loading="isPipelineSaving"
          :disabled="isPipelineSaving"
          @click="savePipeline"
          >{{ t("common.save") }}</OButton
        >
      </Teleport>

      <!-- Pipeline name input for NEW pipelines, teleported into the shell
           header (Functions.vue #o2-page-title-trail) next to the title —
           mirrors the actions teleport above. Owned here, alongside
           savePipeline, which validates it via the OForm schema. -->
      <Teleport v-if="isCreatePipeline" defer to="#o2-page-title-trail">
        <div class="w-64 shrink-0">
          <OForm :form="metaForm">
            <OFormInput
              name="name"
              :placeholder="t('pipeline.pipelineName')"
              hide-bottom-space
              data-test="pipeline-editor-name-input"
            />
          </OForm>
        </div>
      </Teleport>

      <!-- Rail + canvas, laid out exactly like the Dashboards list (folder rail +
           table): a fixed-width flush rail on the left and a fluid pane on the
           right. Both sides are h-full off the flex row, so the editor fills
           whatever the shell gives it instead of guessing at viewport maths. -->
      <div class="flex-1 flex min-h-0">
        <!-- Left: docked node palette (shared with Workflows). Same component
             drives both editors, so the two palettes can never drift apart. -->
        <NodePalette
          v-if="pipelineObj.showNodePalette"
          v-show="!pipelineObj.dialog.show || pipelineObj.dialog.name != 'query'"
          :items="pipelineObj.nodeTypes"
          test-prefix="pipeline-node-sidebar"
          :on-drag-start="onDragStart"
        />
        <!-- Right: the canvas pane, flush to the rail and the viewport edges.
             The rail toggle lives up in the page actions, so nothing sits
             between the header and the canvas.

             `relative` (was `relative-position`, a Quasar class that no longer
             resolves — Quasar is not installed and nothing defines that rule)
             makes this the offset parent for the canvas overlays: the start
             node and the edge-help toast. Without it they anchored to some
             ancestor further up, so the start node sat at a different height
             than the workflow canvas's, which IS positioned. -->
        <div class="flex-1 min-w-0 h-full">
          <div
            id="pipelineChartContainer"
            ref="chartContainerRef"
            class="relative pipeline-chart-container o2vf_node h-full w-full overflow-hidden bg-surface-subtle dark:bg-transparent"
            v-show="!pipelineObj.dialog.show || pipelineObj.dialog.name != 'query'"
          >
            <PipelineFlow />
          </div>
        </div>
      </div>
    </div>
  </div>
  <QueryForm
    v-if="pipelineObj.dialog.name === 'query'"
    :open="true"
    :stream-name="pipeline.stream_name"
    :stream-type="pipeline.stream_type"
    :stream-routes="streamRoutes"
    @cancel:hideform="resetDialog"
  />
  <ConditionForm
    v-if="pipelineObj.dialog.name === 'condition'"
    :open="true"
    @cancel:hideform="resetDialog"
  />
  <AssociateFunction
    v-if="pipelineObj.dialog.name === 'function'"
    :open="true"
    :associated-functions="associatedFunctions"
    @cancel:hideform="resetDialog"
    @add:function="refreshFunctionList"
  />
  <StreamNode
    v-if="pipelineObj.dialog.name === 'stream'"
    :open="true"
    @cancel:hideform="resetDialog"
  />
  <ExternalDestination
    v-if="pipelineObj.dialog.name === 'remote_stream'"
    :open="true"
    @cancel:hideform="resetDialog"
  />
  <!-- shared "add next step" picker (opened by the hover-+ on a node) -->
  <StepPickerDialog
    v-if="pipelineObj.stepPicker.show"
    :items="stepItems"
    :anchor="pipelineObj.stepPicker.anchor"
    :search-placeholder="t('flow.stepPicker.search')"
    :no-match-text="t('flow.stepPicker.noMatch')"
    test-prefix="pipeline-step"
    @pick="onStepPick"
    @close="closeStepPicker"
  />
  <ODrawer data-test="pipeline-editor-json-editor-drawer"
    bleed
    v-model:open="showJsonEditorDialog"
    :width="70"
    :title="t('pipeline.editPipelineJSON')"
    persistent
  >
    <template v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled" #header-right>
      <OButton
        variant="ghost"
        size="icon-toolbar"
        @click="toggleJsonEditorAIChat"
        data-test="menu-link-ai-item"
        class="group [background:var(--color-gradient-ai-subtle)]! text-ai-accent! dark:text-white! [transition:background_0.3s_ease,box-shadow_0.3s_ease,color_0.3s_ease] dark:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] hover:[background:var(--color-gradient-ai)]! hover:text-white! hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)] dark:hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)]"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        @mouseenter="isJsonEditorAiHovered = true"
        @mouseleave="isJsonEditorAiHovered = false"
      >
        <img :src="jsonEditorAiBtnLogo" class="header-icon size-5 [transition:transform_0.6s_ease] group-hover:rotate-180 group-hover:brightness-0 group-hover:invert group-hover:[transition:filter_0.3s_ease]" />
      </OButton>
    </template>
    <JsonEditor
      :data="pipelineObj.currentSelectedPipeline"
      :title="t('pipeline.editPipelineJSON')"
      :type="'pipelines'"
      :validation-errors="validationErrors"
      @close="showJsonEditorDialog = false"
      @saveJson="savePipelineJson"
    />
  </ODrawer>
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
import { isJsFunction } from "@/utils/functionLanguage";
import AssociateFunction from "@/components/pipeline/NodeForm/AssociateFunction.vue";
import functionsService from "@/services/jstransform";

import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import pipelineService from "@/services/pipelines";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import StepPickerDialog from "@/components/flow/StepPickerDialog.vue";
import NodePalette from "@/components/flow/NodePalette.vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makePipelineMetaSchema,
  pipelineMetaDefaults,
  type PipelineMetaForm,
} from "./pipelineMeta.schema";
import jstransform from "@/services/jstransform";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import StreamNode from "@/components/pipeline/NodeForm/Stream.vue";
import QueryForm from "@/components/pipeline/NodeForm/Query.vue";
import ConditionForm from "@/components/pipeline/NodeForm/Condition.vue";
import { MarkerType, useVueFlow } from "@vue-flow/core";
import ExternalDestination from "./NodeForm/ExternalDestination.vue";
import { contextRegistry, createPipelinesContextProvider } from "@/composables/contextProviders";
import JsonEditor from "../common/JsonEditor.vue";
import { validatePipeline as validatePipelineUtil } from '../../utils/validatePipeline';
import { useReo } from "@/services/reodotdev_analytics";

const functionImage = getImageURL("images/pipeline/transform_function.png");
const streamImage = getImageURL("images/pipeline/input_stream.png");
const streamOutputImage = getImageURL("images/pipeline/output_stream.png");
const externalOutputImage = getImageURL("images/pipeline/output_remote.png");
const conditionImage = getImageURL("images/pipeline/transform_condition.png");
const queryImage = getImageURL("images/pipeline/input_query.png");
import useStreams from "@/composables/useStreams";
import usePipelines from "@/composables/usePipelines";

import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";

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
  trans_type?: number;
  [key: string]: unknown;
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
const { isDark } = useTheme();

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
    // Matches the workflow Function node subtitle (workflow.node.functionDesc).
    tooltip: "Reshape the payload with a function",
    isSectionHeader: false,
  },
  {
    label: "Condition",
    subtype: "condition",
    io_type: "default",
    icon: "img:" + conditionImage,
    // Matches the workflow Condition node subtitle (workflow.node.conditionDesc).
    tooltip: "Branch on a rule",
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

const { pipelineObj, resetPipelineData, addNodeAfter, addSourceNode, closeStepPicker, onDragStart } =
  useDragAndDrop();

// Items for the shared step picker: the downstream-addable node types
// (Transform + Destination; sources aren't "added after" a node).
// In "source" mode the picker is the pipeline's FIRST step, so it offers only
// sources — and carries copy explaining realtime-vs-scheduled, which is the
// part of that choice users cannot infer from the node names alone.
const isSourceStep = computed(() => pipelineObj.stepPicker.mode === "source");

const sourceDescriptions: Record<string, string> = {
  stream: "pipeline.sourceStreamDesc",
  query: "pipeline.sourceQueryDesc",
};

const stepItems = computed(() =>
  (pipelineObj.nodeTypes || [])
    .filter((n: any) =>
      !n.isSectionHeader &&
      (isSourceStep.value ? n.io_type === "input" : n.io_type !== "input"),
    )
    .map((n: any) => ({
      key: `${n.subtype}-${n.io_type}`,
      title: n.label,
      description: sourceDescriptions[n.subtype]
        ? t(sourceDescriptions[n.subtype])
        : n.tooltip,
      icon: n.icon,
      // Soft badge tokens, not raw hex: the old literals had no dark variant, so
      // these tints stayed light-mode colours on a dark canvas.
      iconTint:
        n.io_type === "output"
          ? "bg-badge-success-soft-bg text-badge-success-soft-text"
          : n.io_type === "input"
            ? "bg-badge-blue-soft-bg text-badge-blue-soft-text"
            : "bg-badge-warning-soft-bg text-badge-warning-soft-text",
      subtype: n.subtype,
      io_type: n.io_type,
    })),
);

const onStepPick = (item: any) => {
  const { source, mode, position } = pipelineObj.stepPicker;
  closeStepPicker();
  const picked = { subtype: item.subtype, io_type: item.io_type };
  // The start node has nothing before it, so it is placed rather than appended.
  if (mode === "source") addSourceNode(picked, position);
  else addNodeAfter(source, picked);
};
pipelineObj.nodeTypes = nodeTypes;
pipelineObj.functions = functions;

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

const confirmDialogBasicPipeline = ref(false);
const showJsonEditorDialog = ref(false);
const associatedFunctions: Ref<string[]> = ref([]);

const isJsonEditorAiHovered = ref(false);
const jsonEditorAiBtnLogo = computed(() => {
  if (isJsonEditorAiHovered.value || store.state.isAiChatEnabled) {
    return getImageURL('images/common/ai_icon_dark.svg');
  }
  return isDark.value
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon_gradient.svg');
});
const toggleJsonEditorAIChat = () => {
  store.dispatch('setIsAiChatEnabled', !store.state.isAiChatEnabled);
};

const { t } = useI18n();

const validationErrors = ref<string[]>([]);

const { track } = useReo();

// ── Pipeline name: OForm-owned ───────────────────────────────────────────────
// The name input is a headless OForm so the teleported <OFormInput> validates
// via the schema (submit-then-change timing; the inline error appears on the
// first save attempt). `currentSelectedPipeline.name` stays the PERSISTED field
// — the save payload, JSON editor and FlowChart all read it — so the two are
// kept mirrored by the guarded watches below (guards break the echo loop).
const isCreatePipeline = computed(
  () => router.currentRoute.value.name === "createPipeline",
);

const metaForm = useOForm<PipelineMetaForm>({
  defaultValues: pipelineMetaDefaults(),
  schema: makePipelineMetaSchema(t),
});

// form → store: reflect what the user types into the persisted pipeline name.
watch(
  metaForm.useStore((s: any) => s.values.name),
  (v: string) => {
    if ((v ?? "") !== (pipelineObj.currentSelectedPipeline.name ?? "")) {
      pipelineObj.currentSelectedPipeline.name = v ?? "";
    }
  },
);

// store → form: re-hydrate the field whenever the pipeline object is REPLACED
// (edit-mode load, JSON-editor apply, reset). Guarded against the watch above.
// flush:"sync" so the form reflects a store change in the SAME tick — the
// JSON-editor apply path sets currentSelectedPipeline then calls savePipeline()
// synchronously, and savePipeline validates the form value.
// immediate:true so the form is seeded from the store on MOUNT, not only on a
// later change. `pipelineObj` is a module-level singleton that survives
// navigation, so on re-editing the same pipeline its name is already present at
// mount (or getPipeline replaces it with an equal value) — a change-only watch
// would never fire and metaForm would stay empty, failing the required-name
// validation on save ("Pipeline name is required").
watch(
  () => pipelineObj.currentSelectedPipeline.name,
  (v: string) => {
    if ((v ?? "") !== (metaForm.state.values.name ?? "")) {
      metaForm.setFieldValue("name", v ?? "");
    }
  },
  { flush: "sync", immediate: true },
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
  const handleKeydown = (event: KeyboardEvent) => {
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

  // Kick off the used-streams fetch immediately (in parallel with destinations)
  // and publish the in-flight promise so the Stream node drawer reuses THIS
  // exact request instead of issuing its own on the first node drag — even if
  // the drag happens before the request resolves. Avoids the duplicate
  // pipelines/streams call and the transient "No options found" flash.
  const usedStreamsRequest = getUsedStreamsList();
  pipelineObj.usedStreams = usedStreamsRequest;

  pipelineDestinationsList.value = await getPipelineDestinations();
  usedStreamsListResponse.value = await usedStreamsRequest;
  // Replace the promise with the resolved array for later synchronous reads.
  pipelineObj.usedStreams = usedStreamsListResponse.value;
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
    // Cancel this navigation; show a Vue dialog instead of window.confirm
    // (browsers often suppress window.confirm during navigation events).
    next(false);
    const destination = to.fullPath;
    confirmDialogMeta.value.show = true;
    confirmDialogMeta.value.title = t("common.cancelChanges");
    confirmDialogMeta.value.message = t("pipeline.cancelChangesConfirm");
    confirmDialogMeta.value.onConfirm = () => {
      resetConfirmDialog();
      resetPipelineData();
      forceSkipBeforeUnloadListener = true;
      router.push(destination);
    };
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

      if (!_pipeline) {
        toast({
          message: t("pipeline.pipelineNotFound"),
          variant: "warning",
        });
        router.replace({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }

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

      pipelineObj.currentSelectedPipeline = _pipeline;
      pipelineObj.pipelineWithoutChange = JSON.parse(JSON.stringify(_pipeline));
    })
    .catch((error) => {
      toast({
        message: error?.message || t("pipeline.failedToLoadPipeline"),
        variant: "error",
      });
      router.replace({
        name: "pipelines",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
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
        // Pipelines execute VRL — JavaScript functions can't run here.
        // (isJsFunction reads both transType/trans_type; the list response uses
        // camelCase, so a bare `trans_type` check silently matched everything.)
        if (!isJsFunction(func)) {
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
  // Discard any staged hover-`+` edge so a cancelled add doesn't wire the next node.
  pipelineObj.pendingEdge = null;
  editingFunctionName.value = "";
  editingStreamRouteName.value = "";
};

const savePipeline = async () => {
  forceSkipBeforeUnloadListener = true;
  // Name validation is owned by the OForm schema. handleSubmit runs the schema
  // over the form values — this works even in edit mode / the JSON-editor path
  // where the teleported field isn't mounted — and reveals the inline error on
  // the field (create page). The toast preserves the previous UX and is the only
  // feedback when the field isn't visible (edit / JSON apply).
  await metaForm.handleSubmit();
  if (!metaForm.state.isValid) {
    toast({
      message: t("pipeline.pipelineNameRequired"),
      variant: "warning",
    });
    return;
  }
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
    toast({
      message: t("pipeline.sourceNodeRequired"),
      variant: "warning",
    });
    if(showJsonEditorDialog.value == true){
      validationErrors.value = [t("pipeline.sourceNodeRequired")];
    }
    return;
  } else if (outputNodeIndex === -1) {
    toast({
      message: t("pipeline.destinationNodeRequired"),
      variant: "warning",
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
        Object.prototype.hasOwnProperty.call(node.data.stream_name, "value")
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
    toast({
      message: t("pipeline.connectAllNodes"),
      variant: "warning",
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
    inputNode?.data?.node_type === "stream" &&
    outputNode?.data?.node_type === "stream" &&
    outputNode?.data?.stream_type === "enrichment_tables"
  ) {
    toast({
      message: t("pipeline.enrichmentTablesScheduledOnly"),
      variant: "warning",
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
  const dismiss = toast({
    message: t("pipeline.savingPipeline"),
    variant: "loading",
      timeout: 0,
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
      toast({
        message: t("pipeline.pipelineUpdated"),
        variant: "success",
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
        toast({
          message: t("pipeline.pipelineSaved"),
          variant: "success",
        });
      }
      else if(pipelineObj.isEditPipeline && showJsonEditorDialog.value == true){
        showJsonEditorDialog.value = false;
        toast({
          message: t("pipeline.pipelineUpdated"),
          variant: "success",
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
        toast({
          message: t("pipeline.pipelineSaved"),
          variant: "success",
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
        toast({
          message: t("pipeline.connectAllNodesShort"),
          variant: "warning",
        });
        if(showJsonEditorDialog.value == true){
          validationErrors.value = [t("pipeline.connectAllNodes")];
        }
      } else {
        if (error.response.status != 403) {
          toast({
            message:
              error.response?.data?.message || t("pipeline.errorSavingPipeline"),
            variant: "error",
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
  // Cancelling the "save anyway?" prompt should only dismiss the dialog and keep
  // the user on the editor (matching the close/X button) — NOT navigate away to
  // the pipelines listing.
  confirmDialogBasicPipeline.value = false;
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
    // Pipelines execute VRL — a JS function must not enter the options.
    if (!isJsFunction(_function)) {
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
  return undefined;
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
    // Seed the OForm field synchronously so savePipeline()'s validate sees the
    // name from the edited JSON (the store→form watch flushes next-tick).
    metaForm.setFieldValue("name", parsedPipeline.name ?? "");
    savePipeline();
  } catch (error) {
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

<style>
/* keep(lib-override:vue-flow): every rule below reaches DOM this component does
   not render. `.vue-flow__*` are Vue Flow's own internals, emitted inside the
   async <PipelineFlow> child — and the two `.vue-flow.dragging` / `.vue-flow:has()`
   rules target the canvas ROOT, which is not in this template at all, so neither
   scoping nor :deep() can reach them. `o2vf_node_*` is the shared pipeline
   node-type convention: the same class names are now produced by the shared
   NodePalette (which replaced NodeSidebar.vue), so this block must stay unscoped
   and keep riding those names rather than moving to colocated utilities.

   The `transition: none` blocks kill drag lag; NOTE: never set `transform: none`
   here — Vue Flow positions each node via an inline `transform: translate(x, y)`,
   so zeroing it would snap the node to the canvas origin mid-drag and only
   restore on release. */
.vue-flow.dragging *,
.vue-flow:has(.vue-flow__node:active) * {
  transition: none !important;
  animation: none !important;
}

.vue-flow__node.dragging,
.vue-flow__node:active {
  transition: none !important;
  animation: none !important;
}

.vue-flow__node.dragging *,
.vue-flow__node:active * {
  transition: none !important;
  animation: none !important;
}

.o2vf_node .o2vf_node_input {
  border: 1px solid var(--color-status-info-text);
  color: var(--color-text-body);
  border-radius: var(--radius-surface);
  background: var(--color-status-info-bg);
  box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-status-info-text) 10%, transparent);
  transition: background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  cursor: grab;
  min-height: 2.25rem;
  padding: 0.5rem 1rem;
}

.o2vf_node .o2vf_node_input:active,
.o2vf_node .o2vf_node_input.dragging {
  cursor: grabbing;
  transition: none !important;
}

.o2vf_node .o2vf_node_input:active *,
.o2vf_node .o2vf_node_input.dragging * {
  transition: none !important;
}

.o2vf_node .o2vf_node_default {
  border: 1px solid var(--color-status-warning-text);
  color: var(--color-text-body);
  border-radius: var(--radius-surface);
  background: var(--color-status-warning-bg);
  box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-status-warning-text) 10%, transparent);
  transition: background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  cursor: grab;
  min-height: 2.25rem;
  padding: 0.5rem 1rem;
}

.o2vf_node .o2vf_node_default:hover {
  border: 1px solid var(--color-status-warning-text) !important;
  background: var(--color-status-warning-bg) !important;
  box-shadow: 0 0.375rem 1rem color-mix(in srgb, var(--color-status-warning-text) 20%, transparent) !important;
}

.o2vf_node .o2vf_node_default:active,
.o2vf_node .o2vf_node_default.dragging {
  cursor: grabbing;
  transition: none !important;
}

.o2vf_node .o2vf_node_default:active *,
.o2vf_node .o2vf_node_default.dragging * {
  transition: none !important;
}
</style>
