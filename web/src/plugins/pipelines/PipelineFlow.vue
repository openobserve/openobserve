<!-- Copyright 2023 Zinc Labs Inc.

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

<!-- src/components/PipelineFlow.vue -->
<template>
  <div id="graph-container">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      @node-change="onNodeChange"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @connect="onConnect"
    >
      <template #node-custom="{ id, label }">
        <CustomNode :id="id" :data="{ label: label }" />
      </template>
    </VueFlow>
    <!-- Add UI elements or buttons to interact with the methods -->
  </div>
</template>

<script>
import { ref } from "vue";
import { VueFlow } from "@vue-flow/core";
// import vueFlowConfig from "./vueFlowConfig";
import CustomNode from "./CustomNode.vue";

/* import the required styles */
import "@vue-flow/core/dist/style.css";

/* import the default theme (optional) */
import "@vue-flow/core/dist/theme-default.css";

export default {
  components: { VueFlow, CustomNode },
  data() {
    return {
      nodes: [
        { id: "1", type: "input", label: "Node 1", position: { x: 250, y: 5 } },
        { id: "2", label: "Node 2", position: { x: 100, y: 100 } },
        { id: "3", label: "Node 3", position: { x: 400, y: 100 } },
        {
          id: "4",
          type: "custom",
          label: "Node 4",
          component: CustomNode,
          position: { x: 400, y: 200 },
        },
      ],
      edges: [
        { id: "e1-2", source: "1", target: "2", animated: true },
        { id: "e1-3", source: "1", target: "3" },
      ], // Initially empty, will be updated after connection
    };
  },
  methods: {
    onNodeChange(changes) {
      // Handle node change events here
    },
    onNodesChange(changes) {
      // Handle nodes update here
    },
    onEdgesChange(changes) {
      // Handle edges update here
    },
    onConnect(connection) {
      // Add new connection (edge) to edges array
      const newEdge = {
        id: `e${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
      };
      this.edges = [...this.edges, newEdge]; // Update edges state
    },
  },
  setup() {
    // const { vueFlow, methods } = vueFlowConfig;

    // Example of adding a new node
    const addNode = () => {
      methods.addNode({
        id: "new-node",
        type: "custom",
        component: CustomNode,
        position: { x: 200, y: 200 },
        data: { label: "New Node" },
      });
    };

    // Example of removing a node
    const removeNode = (nodeId) => {
      methods.removeNode(nodeId);
    };

    // let nodes = [
    //   { id: "1", type: "input", label: "Node 1", position: { x: 250, y: 5 } },
    //   { id: "2", label: "Node 2", position: { x: 100, y: 100 } },
    //   { id: "3", label: "Node 3", position: { x: 400, y: 100 } },
    //   {
    //     id: "4",
    //     type: "custom",
    //     label: "Node 4",
    //     component: CustomNode,
    //     position: { x: 400, y: 200 },
    //   },
    // ];

    // let edges = [
    //   { id: "e1-2", source: "1", target: "2", animated: true },
    //   { id: "e1-3", source: "1", target: "3" },
    // ];

    // const onNodesChange = (newNodes) => {
    //   nodes.value = newNodes;
    // };

    // const onEdgesChange = (newEdges) => {
    //   edges.value = newEdges;
    // };

    // const onNodeChange = ({ id, data }) => {
    //   // Update node data
    //   const node = nodes.value.find((n) => n.id === id);
    //   if (node) {
    //     node.data = { ...data };
    //   }
    // };

    // const onConnect = (connection) => {
    //   if (connection && connection.stopPropagation) {
    //     connection.stopPropagation();
    //   }

    //   console.log("connection:", connection);
    //   edges.push({
    //     id: "e" + connection.source + "-" + connection.target,
    //     source: connection.source,
    //     taget: connection.target,
    //     animated: true,
    //   });
    //   console.log(JSON.stringify(edges));
    // };

    return {
      addNode,
      removeNode,
    };
  },
};
</script>

<style scoped>
#graph-container {
  width: 1000px;
  height: 1000px;
}
</style>
