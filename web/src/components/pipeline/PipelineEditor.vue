<template>
  <div ref="placeholder" class="diagram-container"></div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import * as joint from "@joint/core";

const placeholder = ref(null);
let graph, paper;

onMounted(() => {
  graph = new joint.dia.Graph();

  const namespaces = joint.shapes;

  paper = new joint.dia.Paper({
    el: placeholder.value,
    model: graph,
    width: 800,
    height: 600,
    gridSize: 1,
    drawGrid: true,
    background: {
      color: "rgba(255, 255, 255, 0.3)",
    },
  });

  setupDiagram();
});

function setupDiagram() {
  const rect1 = new joint.shapes.standard.Rectangle({
    position: { x: 100, y: 30 },
    size: { width: 100, height: 40 },
    attrs: {
      body: {},
      label: { text: "Block 1", fill: "black" },
    },
  });
  rect1.addTo(graph);

  const rectLinker = new joint.shapes.standard.Rectangle({
    position: { x: 200, y: 45 },
    size: { width: 10, height: 10 },
    attrs: {
      body: { fill: "grey" },
      label: {},
    },
  });

  rectLinker.addTo(graph);

  const customElement = new CustomElement();

  customElement.addTo(graph);

  const rect2 = new joint.shapes.standard.Rectangle({
    position: { x: 300, y: 30 },
    size: { width: 100, height: 40 },
    attrs: { body: {}, label: { text: "Block 2", fill: "black" } },
  });
  rect2.addTo(graph);

  const rect3 = new joint.shapes.standard.Rectangle({
    position: { x: 500, y: 30 },
    size: { width: 100, height: 40 },
    attrs: { body: {}, label: { text: "Block 3", fill: "black" } },
  });
  rect3.addTo(graph);

  let currentLink;

  paper.on("cell:pointerdown", (cellView) => {
    const { model } = cellView;
    console.log(model);
    if (!currentLink) {
      // Start a new connection
      currentLink = new joint.shapes.standard.Link({
        source: model,
        router: { name: "manhattan" },
        connector: { name: "rounded" },
        attrs: { line: { stroke: "blue", "stroke-width": 2 } },
      });
      currentLink.addTo(graph);
    } else {
      // Finish connection
      currentLink.target(model);
      currentLink = null; // Reset for next connection
    }
  });
}
</script>

<style>
.diagram-container {
  border: 1px solid #000;
}
</style>
