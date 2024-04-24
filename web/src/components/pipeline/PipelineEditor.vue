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
        @update:node="addStreamNode"
      />

      <AssociateFunction
        v-if="dialog.name === 'associateFunction'"
        :node-links="nodeLinks"
        @update:node="addFunctionNode"
      />
    </div>
  </q-dialog>
</template>

<script setup>
import { computed, onBeforeMount, ref } from "vue";
import PipelineEditorDemo from "./PipelineEditorDemo.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import FunctionIcon from "@/assets/images/pipeline/function.svg";
import { getImageURL } from "@/utils/zincutils";
import StreamRouting from "./StreamRouting.vue";
import AssociateFunction from "./AssociateFunction.vue";
import NodeLinks from "./NodeLinks.vue";

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

const onChartUpdate = () => {};

const nodes = ref([]);

const nodeLinks = ref({});

const nodeRect = ref({
  top: 0,
  left: 0,
});

const functions = ref({
  stream: [],
});

const chartContainerRef = ref(null);

const nodeActions = ref(null);

const dialog = ref({
  name: "streamRouting",
  show: false,
  title: "Stream Routing",
  message: "",
  okCallback: () => {},
});

const onChartClick = (params) => {
  dialog.value.show = true;
  dialog.value.name = "streamRouting";
  console.log("click", params);
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

  updateGraph();
});

const onChartHover = (params) => {
  console.log("hover", params);
  // const nodeRect = params.event.event.srcElement?.getBoundingClientRect();

  // console.log("top and left", nodeRect, chartContainerRect.value);
  // nodeActions.value.style.top = `${
  //   nodeRect.top - chartContainerRect.value.top
  // }px`;
  // nodeActions.value.style.left = `${
  //   nodeRect.left - chartContainerRect.value.left + 30
  // }px`;
};

const onMouseMove = (params) => {
  console.log("move", params);
};

const onMouseOut = (params) => {
  console.log("mouse out", params);
};

const addFunction = () => {
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

const addFunctionNode = (data) => {
  const nodeName = data.data.name;

  nodes.value.push({
    name: nodeName,
    x: 50,
    y: 300,
    type: "function",
    fixed: true,
    order: data.data.order || functions.value.length,
    stream: nodes.value[0].name,
  });

  if (!nodeLinks.value[nodeName])
    nodeLinks.value[nodeName] = { from: [], to: [] };

  // reorder function nodes with order key and its links too
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

  updateGraph();
};

const addStreamNode = (data) => {
  const nodeName = data.data.destinationStreamName;

  nodes.value.push({
    name: nodeName + ":condition",
    x: 50,
    y: 300,
    type: "condition",
    fixed: true,
  });

  nodes.value.push({
    name: nodeName,
    x: 50,
    y: 300,
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
