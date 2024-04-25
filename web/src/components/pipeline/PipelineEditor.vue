<template>
  <div class="flex items-center">
    <div
      data-test="add-alert-back-btn"
      class="flex justify-center items-center q-mr-md cursor-pointer"
      style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px"
      title="Go Back"
      @click="openCancelDialog"
    >
      <q-icon name="arrow_back_ios_new" size="14px" />
    </div>
    <div class="text-h6">{{ pipeline.name }}</div>
  </div>
  <div class="flex justify-end">
    <q-btn
      data-test="add-report-save-btn"
      label="Add Function"
      class="text-bold no-border q-ml-md float-left"
      color="secondary"
      padding="sm xl"
      no-caps
      @click="addFunction"
    />
    <q-btn
      data-test="add-report-save-btn"
      label="Add Stream"
      class="text-bold no-border q-ml-md float-left"
      color="secondary"
      padding="sm xl"
      no-caps
      @click="addStream"
    />

    <q-btn
      data-test="add-report-save-btn"
      label="Cancel"
      class="text-bold border q-ml-md"
      padding="sm xl"
      no-caps
      @click="openCancelDialog"
    />

    <q-btn
      data-test="add-report-save-btn"
      label="Save"
      class="text-bold no-border q-ml-md"
      color="secondary"
      padding="sm xl"
      no-caps
      @click="savePipeline"
    />
  </div>
  <div
    ref="chartContainerRef"
    class="relative-position bg-grey-2 pipeline-chart-container q-mt-md"
  >
    <ChartRenderer
      data-test="logs-search-result-bar-chart"
      :data="plotChart"
      render-type="svg"
      style="height: 700px"
      @click="onChartClick"
      @mouseover="onChartHover"
      @mouseout="onMouseOut"
    />

    <!-- <div ref="nodeActions" id="node-actions" class="node-actions absolute">
      <q-icon name="delete" class="q-mr-xs cursor-pointer" />
      <q-icon name="add" class="cursor-pointer" size="16px" />
    </div> -->
  </div>

  <q-dialog v-model="dialog.show" position="right" full-height maximized>
    <div class="stream-routing-dialog-container full-height">
      <StreamRouting
        v-if="dialog.name === 'streamRouting'"
        :stream-name="pipeline.stream_name"
        :stream-type="pipeline.stream_type"
        :editing-route="streamRoutes[editingStreamRouteName]"
        :stream-routes="streamRoutes"
        @update:node="addStreamNode"
        @cancel:hideform="resetDialog"
        @delete:node="deleteNode"
      />

      <AssociateFunction
        v-if="dialog.name === 'associateFunction'"
        :loading="isFetchingFunctions"
        :function-data="functions[editingFunctionName]"
        :functions="functionOptions"
        :associated-functions="associatedFunctions"
        @update:node="addFunctionNode"
        @delete:node="deleteNode"
        @cancel:hideform="resetDialog"
      />
    </div>
  </q-dialog>
  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref, type Ref } from "vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { getImageURL } from "@/utils/zincutils";
import StreamRouting from "./StreamRouting.vue";
import AssociateFunction from "./AssociateFunction.vue";
import functionsService from "@/services/jstransform";
import { useStore } from "vuex";
import pipelineService from "@/services/pipelines";
import { useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";

const functionImage = getImageURL("images/pipeline/function.svg");
const streamImage = getImageURL("images/pipeline/stream.svg");
const streamRouteImage = getImageURL("images/pipeline/stream_route.svg");
const conditionImage = getImageURL("images/pipeline/routeCondition.svg");

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
  name: string;
  description: string;
  stream_name: string;
  stream_type: string;
  routing: Routing;
  functions: Function[];
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
        edgeSymbol: ["circle", "arrow"],
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
  name: "",
  stream_type: "",
  description: "",
  stream_name: "",
  routing: {},
  functions: [],
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

const nodes: Ref<Node[] | []> = ref([]);

const nodeLinks = ref<{ [key: string]: NodeLink }>({});

const functions = ref<{ [key: string]: any }>({});

const functionOptions = ref<string[]>([]);

const streamRoutes = ref<{ [key: string]: any }>({});

const editingStreamRouteName = ref<string>("");

const editingFunctionName = ref<string>("");

const isFetchingFunctions = ref(false);

const chartContainerRef = ref(null);

const nodeRows = ref<(string | null)[]>([]);

const q = useQuasar();

const associatedFunctions: Ref<string[]> = ref([]);

const { t } = useI18n();

const dialog = ref({
  name: "streamRouting",
  show: false,
  title: "Stream Routing",
  message: "",
  okCallback: () => {},
});

const onChartClick = (params: any) => {
  const { type, name } = params.data;
  if (type === "streamRoute") {
    editingStreamRouteName.value = name;
    dialog.value.show = true;
    dialog.value.name = "streamRouting";
  }

  if (type === "function") {
    getFunctions();
    editingFunctionName.value = name;
    dialog.value.show = true;
    dialog.value.name = "associateFunction";
  }
};

onBeforeMount(() => {
  getPipeline();

  updateGraph();
});

const getPipeline = () => {
  const route = router.currentRoute.value;

  pipelineService
    .getPipelines(store.state.selectedOrganization.identifier)
    .then((response) => {
      pipeline.value = response.data.list.find(
        (pipeline: Pipeline) => pipeline.name === route.query.name
      );
      console.log("pipeline", pipeline.value);
      setupNodes();
    });
};

const setupNodes = () => {
  nodeRows.value = [null, pipeline.value.stream_name, null];

  // set the base stream node
  const node: Node = {
    name: pipeline.value.stream_name,
    x: 0,
    y: 300,
    type: "stream",
    fixed: true,
  };

  nodes.value.push(node);

  nodeLinks.value[pipeline.value.stream_name] = {
    from: [],
    to: [],
  };

  // set functions nodes
  pipeline.value?.functions?.forEach((_function) => {
    createFunctionNode(
      _function.name,
      pipeline.value.stream_name,
      _function.order
    );

    associatedFunctions.value.push(_function.name);
  });

  updateFunctionNodesOrder();

  if (pipeline.value?.routing)
    Object.keys(pipeline.value?.routing).forEach((stream: string) => {
      createStreamRouteNode({
        name: stream,
      });
      streamRoutes.value[stream] = {
        name: stream,
        conditions: pipeline.value?.routing[stream],
      };
    });

  updateGraph();
};

const onChartHover = (params: any) => {
  // const nodeRect = params.event.event.srcElement?.getBoundingClientRect();
  // console.log("top and left", nodeRect, chartContainerRect.value);
  // nodeActions.value.style.top = `${
  //   nodeRect.top - chartContainerRect.value.top
  // }px`;
  // nodeActions.value.style.left = `${
  //   nodeRect.left - chartContainerRect.value.left + 30
  // }px`;
};

const onMouseMove = (params: any) => {};

const onMouseOut = (params: any) => {};

const addFunction = () => {
  getFunctions();
  dialog.value.show = true;
  dialog.value.name = "associateFunction";
};

const addStream = () => {
  dialog.value.show = true;
  dialog.value.name = "streamRouting";
};

const getFunctionFrom = (stream: string) => {
  let fromNodeName = stream;

  const functions = nodes.value.filter(
    (node) => node.type === "function" && node.stream === stream
  );

  if (functions.length) {
    fromNodeName = functions[functions.length - 1].name;
  }

  return fromNodeName;
};

// TODO OK : create separate functions for each type node i.e. function, streamRoute, stream
const getNodePosition = (type: string, node?: any) => {
  let lastNode = nodes.value.filter((node) => node.type === type).pop();

  // If this if first function node, adding offset to left from the main stream node
  const nodeGap = !lastNode ? 130 : 50;

  if (type === "function" && !lastNode) lastNode = nodes.value[0];

  if (type === "function") {
    if (lastNode?.x?.toString() && lastNode?.y?.toString())
      return {
        x: lastNode.x + nodeGap,
        y: lastNode.y,
      };
    else console.log("Error while getting last node position");
  }

  const isAnyNull = nodeRows.value.every((row) => row !== null);
  if (isAnyNull) {
    nodeRows.value.push(null);
    nodeRows.value.unshift(null);
  }

  console.log("node rows", isAnyNull, nodeRows.value);

  if (type === "streamRoute") {
    const centerIndex = Math.ceil(nodeRows.value.length / 2) - 1;

    for (let i = centerIndex - 1; i >= 0; i--) {
      if (nodeRows.value[i] === null) {
        const refRow = nodeRows.value[i + 1];
        const refNode = nodes.value.find((node) => node.name === refRow);

        console.log("node rows 1", i, refRow, refNode);

        nodeRows.value[i] = node.name;

        if (refNode?.y?.toString())
          return {
            x: 50,
            y: refNode.y - 50,
          };
        else
          console.log("Error while getting last node position for streamRoute");
      }
    }

    for (let i = centerIndex + 1; i < nodeRows.value.length; i++) {
      if (nodeRows.value[i] === null) {
        const refRow = nodeRows.value[i - 1];
        const refNode = nodes.value.find((node) => node.name === refRow);

        nodeRows.value[i] = node.name;

        console.log("node rows 2", i, refRow, node);

        if (refNode?.y?.toString())
          return {
            x: 50,
            y: refNode.y + 50,
          };
        else
          console.log("Error while getting last node position for streamRoute");
      }
    }
  }
};

const addFunctionNode = (data: { data: Function }) => {
  const nodeName = data.data.name;

  if (editingFunctionName.value) {
    nodes.value = nodes.value.filter(
      (node) => node.name !== editingFunctionName.value
    );

    editingFunctionName.value = "";
  }

  createFunctionNode(nodeName, data.data.stream, data.data.order);

  associatedFunctions.value.push(nodeName);

  // reorder function nodes with order key and its links too
  updateFunctionNodesOrder();

  updateGraph();
};

const createFunctionNode = (
  nodeName: string,
  streamName: string,
  order: number
) => {
  const position = getNodePosition("function");

  if (position?.x === undefined || position?.y === undefined) {
    console.log("Error in getting node position");
    return;
  }

  const node = {
    name: nodeName,
    x: position.x,
    y: position.y,
    type: "function",
    fixed: true,
    order: order || 1,
    stream: streamName,
  };

  nodes.value.push(node);

  if (!nodeLinks.value[nodeName])
    nodeLinks.value[nodeName] = { from: [], to: [] };

  return node;
};

const updateFunctionNodesOrder = () => {
  const sortedFunctionNodes = nodes.value
    .filter((node) => node.type === "function")
    .sort((a, b) =>
      a.order?.toString() && b.order?.toString() ? a.order - b.order : 0
    );

  sortedFunctionNodes.forEach((node, index) => {
    if (index === 0) {
      nodeLinks.value[node.name].from = [nodes.value[0].name];
      nodeLinks.value[nodes.value[0].name].to = [node.name];
    } else {
      nodeLinks.value[node.name].from = [sortedFunctionNodes[index - 1].name];
      nodeLinks.value[sortedFunctionNodes[index - 1].name].to = [node.name];
    }
  });
};

const addStreamNode = (data: { data: Node }) => {
  const nodeName = data.data.name;

  streamRoutes.value[nodeName] = data.data;

  if (editingStreamRouteName.value) {
    nodes.value = nodes.value.filter(
      (node) =>
        node.name !== editingFunctionName.value &&
        node.name !== editingStreamRouteName.value + ":condition"
    );

    editingStreamRouteName.value = "";
  }
  createStreamRouteNode(data.data);

  updateGraph();
};

const createStreamRouteNode = (streamRouteData: { name: string }) => {
  const position = getNodePosition("streamRoute", streamRouteData);

  console.log(streamRouteData);
  const nodeName = streamRouteData.name;

  const condition = nodes.value.push({
    name: nodeName + ":condition",
    x: position.x,
    y: position.y,
    type: "condition",
    fixed: true,
  });

  const stream = nodes.value.push({
    name: nodeName,
    x: position.x + 50,
    y: position.y,
    type: "streamRoute",
    fixed: true,
  });

  nodeLinks.value[nodeName + ":condition"] = {
    from: [nodes.value[0].name],
    to: [nodeName],
  };

  nodeLinks.value[nodeName] = { from: [nodeName + ":condition"], to: [] };

  return {
    condition,
    stream,
  };
};

const getNodeSymbol = (type: string) => {
  const symbolMapping: { [key: string]: string } = {
    stream: streamImage,
    function: functionImage,
    streamRoute: streamRouteImage,
    condition: conditionImage,
  };

  return "image://" + window.location.origin + "/" + symbolMapping[type];
};

const updateGraph = () => {
  const data = nodes.value.map((node) => ({
    name: node.name,
    x: node.x, // You may want to adjust these manually if needed (like x: 100 for 'k8s_event')
    y: node.y,
    symbol: getNodeSymbol(node.type),
    fixed: node.fixed,
    type: node.type,
  }));

  // Prepare links from 'nodeLinks'
  const links: any[] = [];
  for (const nodeName in nodeLinks.value) {
    const { to, from } = nodeLinks.value[nodeName];
    from.forEach((source) => {
      links.push({
        source: source,
        target: nodeName,
      });
    });

    to.forEach((target) => {
      links.push({
        source: nodeName,
        target: target,
      });
    });
  }

  plotChart.value.options.series[0].data = data;
  plotChart.value.options.series[0].links = links;
};

const getFunctions = () => {
  if (Object.keys(functions.value).length) return;
  isFetchingFunctions.value = true;
  functionsService
    .list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier
    )
    .then((res) => {
      functions.value = {};
      functionOptions.value = [];
      res.data.list.forEach((func: Function) => {
        functions.value[func.name] = func;
        functionOptions.value.push(func.name);
      });
    })
    .finally(() => {
      isFetchingFunctions.value = false;
    });
};

const filterFunctions = () => {
  return functions.value.filter(
    (func: Function) => func.stream === nodes.value[0].name
  );
};

const deleteNode = (node: { data: Node }) => {
  nodes.value = nodes.value.filter((n) => n.name !== node.data.name);
  delete nodeLinks.value[node.data.name];

  if (node.data.type === "function") {
    associatedFunctions.value = associatedFunctions.value.filter(
      (func) => func !== node.data.name
    );
  }

  if (node.data.type === "streamRoute") {
    delete streamRoutes.value[node.data.name];
  }

  updateFunctionNodesOrder();

  updateGraph();
};

const resetDialog = () => {
  dialog.value.show = false;
  dialog.value.name = "streamRouting";
};

const getPipelinePayload = () => {
  const payload: Pipeline = {
    ...pipeline.value,
    routing: {},
  };
  Object.values(streamRoutes.value).forEach((route: any) => {
    payload.routing[route.name] = route.conditions;
  });

  return payload;
};

const savePipeline = () => {
  const payload = getPipelinePayload();
  if (payload.functions !== undefined) delete payload.functions;

  const dismiss = q.notify({
    message: "Saving pipeline...",
    position: "bottom",
    spinner: true,
  });

  pipelineService
    .updatePipeline({
      data: payload,
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then(() => {
      q.notify({
        message: "Pipeline saved successfully",
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    })
    .catch((error) => {
      q.notify({
        message: error.response?.data?.message || "Error while saving pipeline",
        color: "negative",
        position: "bottom",
        timeout: 3000,
      });
    })
    .finally(() => {
      dismiss();
    });
};

const openCancelDialog = () => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("common.cancelChanges");
  confirmDialogMeta.value.message = "Are you sure you want to cancel changes?";
  confirmDialogMeta.value.onConfirm = () => router.back();
};

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.title = "";
  confirmDialogMeta.value.message = "";
  confirmDialogMeta.value.onConfirm = () => {};
  confirmDialogMeta.value.data = null;
};
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
  border-radius: 12px;
}
</style>

<style lang="scss">
.stream-routing-dialog-container {
  min-width: 540px !important;
}
</style>
