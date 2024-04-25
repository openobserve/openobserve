<template>
  <div class="flex justify-end">
    <q-btn
      data-test="add-report-save-btn"
      label="Add Function"
      class="text-bold no-border q-ml-md"
      color="secondary"
      padding="sm xl"
      no-caps
      @click="addFunction"
    />
    <q-btn
      data-test="add-report-save-btn"
      label="Add Stream"
      class="text-bold no-border q-ml-md"
      color="secondary"
      padding="sm xl"
      no-caps
      @click="addStream"
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
  <div ref="chartContainerRef" class="relative-position">
    <ChartRenderer
      data-test="logs-search-result-bar-chart"
      :data="plotChart"
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
        :node-links="nodeLinks"
        :source-stream-name="nodes[0].name"
        :editing-route="streamRoutes[editingStreamRouteName]"
        @update:node="addStreamNode"
        @cancel:hideform="resetDialog"
        @delete:node="deleteNode"
      />

      <AssociateFunction
        v-if="dialog.name === 'associateFunction'"
        :loading="isFetchingFunctions"
        :node-links="nodeLinks"
        :function-data="functions[editingFunctionName]"
        :functions="functionOptions"
        @update:node="addFunctionNode"
        @delete:node="deleteNode"
        @cancel:hideform="resetDialog"
      />
    </div>
  </q-dialog>
</template>

<script setup>
import { computed, onBeforeMount, ref } from "vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { getImageURL } from "@/utils/zincutils";
import StreamRouting from "./StreamRouting.vue";
import AssociateFunction from "./AssociateFunction.vue";
import functionsService from "@/services/jstransform";
import { useStore } from "vuex";
import StreamSelection from "./StreamSelection.vue";

const functionImage = getImageURL("images/pipeline/function.svg");
const streamImage = getImageURL("images/pipeline/stream.svg");
const streamRouteImage = getImageURL("images/pipeline/stream_route.svg");
const conditionImage = getImageURL("images/pipeline/routeCondition.svg");

const plotChart = ref({
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

const store = useStore();

const onChartUpdate = () => {};

const nodes = ref([]);

const nodeLinks = ref({});

const nodeRect = ref({
  top: 0,
  left: 0,
});

const functions = ref({});

const functionOptions = ref([]);

const streamRoutes = ref({});

const editingStreamRouteName = ref(null);

const editingFunctionName = ref(null);

const isFetchingFunctions = ref(false);

const chartContainerRef = ref(null);

const nodeRows = ref([]);

const dialog = ref({
  name: "streamRouting",
  show: false,
  title: "Stream Routing",
  message: "",
  okCallback: () => {},
});

const onChartClick = (params) => {
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

const chartContainerRect = computed(() => {
  return chartContainerRef.value?.getBoundingClientRect();
});

onBeforeMount(() => {
  nodes.value.push({
    name: "default",
    x: 0,
    y: 300,
    type: "stream",
    fixed: true,
  });

  nodeLinks.value["default"] = {
    from: [],
    to: [],
  };

  nodeRows.value = [null, nodes.value[0].name, null];

  updateGraph();
});

const onChartHover = (params) => {
  // const nodeRect = params.event.event.srcElement?.getBoundingClientRect();
  // console.log("top and left", nodeRect, chartContainerRect.value);
  // nodeActions.value.style.top = `${
  //   nodeRect.top - chartContainerRect.value.top
  // }px`;
  // nodeActions.value.style.left = `${
  //   nodeRect.left - chartContainerRect.value.left + 30
  // }px`;
};

const onMouseMove = (params) => {};

const onMouseOut = (params) => {};

const addFunction = () => {
  getFunctions();
  dialog.value.show = true;
  dialog.value.name = "associateFunction";
};

const addStream = () => {
  dialog.value.show = true;
  dialog.value.name = "streamRouting";
};

const getFunctionFrom = (stream) => {
  let fromNodeName = stream;

  const functions = nodes.value.filter(
    (node) => node.type === "function" && node.stream === stream
  );

  if (functions.length) {
    fromNodeName = functions[functions.length - 1].name;
  }

  return fromNodeName;
};

const getNodePosition = (type, node) => {
  let lastNode = nodes.value.filter((node) => node.type === type).pop();

  if (type === "function" && !lastNode) lastNode = nodes.value[0];

  if (type === "function") {
    return {
      x: lastNode.x + 50,
      y: lastNode.y,
    };
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

        return {
          x: 50,
          y: refNode.y - 50,
        };
      }
    }

    for (let i = centerIndex + 1; i < nodeRows.value.length; i++) {
      if (nodeRows.value[i] === null) {
        const refRow = nodeRows.value[i - 1];
        const refNode = nodes.value.find((node) => node.name === refRow);

        nodeRows.value[i] = node.name;

        console.log("node rows 2", i, refRow, node);

        return {
          x: 50,
          y: refNode.y + 50,
        };
      }
    }
  }
};

const addFunctionNode = (data) => {
  const nodeName = data.data.name;

  if (editingFunctionName.value) {
    nodes.value = nodes.value.filter(
      (node) => node.name !== editingFunctionName.value
    );

    editingFunctionName.value = "";
  }

  const position = getNodePosition("function");

  nodes.value.push({
    name: nodeName,
    x: position.x,
    y: position.y,
    type: "function",
    fixed: true,
    order: data.data.order || functions.value.length,
    stream: nodes.value[0].name,
  });

  if (!nodeLinks.value[nodeName])
    nodeLinks.value[nodeName] = { from: [], to: [] };

  // reorder function nodes with order key and its links too
  updateFunctionNodesOrder();

  updateGraph();
};

const updateFunctionNodesOrder = () => {
  const sortedFunctionNodes = nodes.value
    .filter((node) => node.type === "function")
    .sort((a, b) => a.order - b.order);

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

const addStreamNode = (data) => {
  const nodeName = data.data.destinationStreamName;

  streamRoutes.value[nodeName] = data.data;

  if (editingStreamRouteName.value) {
    nodes.value = nodes.value.filter(
      (node) =>
        node.name !== editingFunctionName.value &&
        node.name !== editingStreamRouteName.value + ":condition"
    );

    editingStreamRouteName.value = "";
  }

  const position = getNodePosition("streamRoute", data.data);

  console.log(position);
  nodes.value.push({
    name: nodeName + ":condition",
    x: position.x,
    y: position.y,
    type: "condition",
    fixed: true,
  });

  nodes.value.push({
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

  updateGraph();
};

const getNodeSymbol = (type) => {
  const symbolMapping = {
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
  const links = [];
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
  if (functions.value.length) return;
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
      res.data.list.forEach((func) => {
        functions.value[func.name] = func;
        functionOptions.value.push(func.name);
      });
    })
    .finally(() => {
      isFetchingFunctions.value = false;
    });
};

const filterFunctions = () => {
  return functions.value.filter((func) => func.stream === nodes.value[0].name);
};

const deleteNode = (node) => {
  nodes.value = nodes.value.filter((n) => n.name !== node.data.name);
  delete nodeLinks.value[node.data.name];

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
  const payload = {
    name: "pipeline1",
    description: "pipeline",
    stream_name: "stream",
    stream_type: "stream",
    routing: {
      stream1: [
        {
          column: "column",
          operator: "operator",
          value: "value",
        },
      ],
    },
  };
};

const savePipeline = () => {
  const payload = getPipelinePayload();
  console.log("payload", payload);
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
</style>

<style lang="scss">
.stream-routing-dialog-container {
  min-width: 540px !important;
}
</style>
