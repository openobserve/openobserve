<template>
  <div ref="placeholder" class="diagram-container"></div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import * as joint from "@joint/core";

const placeholder = ref(null);
let graph, paper;

class RectangleTwoLabels extends joint.dia.Element {
  defaults() {
    return {
      ...super.defaults,
      type: "custom.RectangleTwoLabels",
    };
  }

  preinitialize() {
    this.markup = joint.util.svg/* xml */ `
            <rect @selector="body" />
            <text @selector="label" />
            <text @selector="labelSecondary" />
        `;
  }
}

class RectangleInput extends joint.dia.Element {
  defaults() {
    return {
      ...super.defaults,
      type: "example.RectangleInput",
      attrs: {
        foreignObject: {
          width: "calc(w)",
          height: "calc(h)",
        },
      },
    };
  }

  preinitialize() {
    this.markup = joint.util.svg/* xml */ `
            <foreignObject @selector="foreignObject">
                <div
                    xmlns="http:www.w3.org/1999/xhtml"
                    style="background:white;border:1px solid black;height:100%;display:flex;justify-content:center;align-items:center;"
                >
                <select name="cars" id="cars">
                    <option value="fn1">Function 1</option>
                    <option value="fn1">Function 2</option>
                    <option value="fn3">Function 3</option>
                    <option value="fn4">Function 4</option>
                </select>
                </div>
            </foreignObject>
            <text @selector="label" />
        `;
  }
}

const RectangleInputView = joint.dia.ElementView.extend({
  events: {
    // Name of event + CSS selector : custom view method name
    "input select": "onInput",
  },

  onInput: function (evt) {
    console.log("Input Value:", evt.target.value);
    this.model.attr("name/props/value", evt.target.value);
  },
});

onMounted(() => {
  const namespace = {
    ...joint.shapes,
    custom: { RectangleTwoLabels, RectangleInput },
    example: {
      RectangleInputView,
    },
  };

  console.log(namespace);
  graph = new joint.dia.Graph(
    {},
    {
      cellNamespace: namespace,
    }
  );

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
    cellViewNamespace: namespace,
  });

  setupDiagram();
});

function setupDiagram() {
  //   const rect1 = new RectangleTwoLabels({
  //     position: { x: 100, y: 30 },
  //     size: { width: 100, height: 40 },
  //     attrs: {
  //       body: {},
  //       label: { text: "Block 1", fill: "black" },
  //       labelSecondary: {
  //         text: "Secondary label",
  //         fill: "black",
  //         x: "calc(w-100)",
  //         y: "calc(h)",
  //       },
  //     },
  //   });
  //   rect1.addTo(graph);

  const rectInput = new RectangleInput({
    position: { x: 100, y: 30 },
    size: { width: 200, height: 40 },
    attrs: {
      body: {},
      label: {
        text: "Block 1",
        fill: "black",
        x: "calc(w/2)",
        y: "calc(h/4)",
      },
      labelSecondary: {
        text: "Secondary label",
        fill: "black",
        x: "calc(w-100)",
        y: "calc(h)",
      },
    },
  });
  rectInput.addTo(graph);

  let currentLink;

  //   paper.on("cell:pointerdown", (cellView) => {
  //     const { model } = cellView;
  //     console.log(model);
  //     if (!currentLink) {
  //       // Start a new connection
  //       currentLink = new joint.shapes.standard.Link({
  //         source: model,
  //         router: { name: "manhattan" },
  //         connector: { name: "rounded" },
  //         attrs: { line: { stroke: "blue", "stroke-width": 2 } },
  //       });
  //       currentLink.addTo(graph);
  //     } else {
  //       // Finish connection
  //       currentLink.target(model);
  //       currentLink = null; // Reset for next connection
  //     }
  //   });
}
</script>

<style>
.diagram-container {
  border: 1px solid #000;
}
</style>
