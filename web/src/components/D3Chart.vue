<template>
  <div ref="chart"></div>
</template>

<script lang="ts">
import { hierarchy, tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { defineComponent } from "vue";

export default defineComponent({
  name: "D3Chart",
  data() {
    return {
      root: null as any,
      width: 600,
      height: 400,
      svg: null as any,
      layout: null as any,
      g: null as any,
    };
  },
  mounted() {
    // Initialize the chart
    this.initChart();

    // Load data and update the chart
    this.loadData();
  },
  methods: {
    initChart() {
      // Create the SVG element and append it to the chart div
      this.svg = select(this.$refs.chart)
        .append("svg")
        .attr("width", this.width)
        .attr("height", this.height);

      // Create a group element for the chart content
      this.g = this.svg.append("g").attr("transform", `translate(50, 50)`);

      // Create the tree layout and set its dimensions
      this.layout = tree().size([this.width - 100, this.height - 100]);
    },
    loadData() {
      // Load your data here and convert it to a hierarchy
      const data = {
        name: "Parent",
        children: [
          {
            name: "Child 1",
            children: [
              { name: "Child 1" },
              { name: "Child 2" },
              { name: "Child 3" },
            ],
          },
          // { name: "Child 2" },
          // {
          //   name: "Child 3",
          //   children: [
          //     { name: "Child 1" },
          //     { name: "Child 2" },
          //     {
          //       name: "Child 3",
          //       children: [
          //         { name: "Child 1" },
          //         { name: "Child 2" },
          //         { name: "Child 3" },
          //       ],
          //     },
          //   ],
          // },
        ],
      };

      this.root = hierarchy(data);

      // Update the chart with the new data
      this.updateChart();
    },
    updateChart() {
      // Call the layout on the root node and get the nodes and links
      const nodes = this.layout(this.root).descendants();
      const links = this.layout(this.root).links();

      // Bind the data to the nodes and links
      const node = this.g.selectAll(".node").data(nodes, (d) => d.data.name);

      const link = this.g
        .selectAll(".link")
        .data(links, (d) => `${d.source.data.name}-${d.target.data.name}`);

      // Enter new nodes and links
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", (d) => `translate(${d.y}, ${d.x})`);

      nodeEnter
        .append("circle")
        .attr("r", 10)
        .style("fill", "#fff")
        .style("stroke", "#000");

      nodeEnter
        .append("text")
        .attr("dy", ".35em")
        .attr("x", (d) => (d.children ? -15 : 15))
        .attr("text-anchor", (d) => (d.children ? "end" : "start"))
        .text((d) => d.data.name);

      link
        .enter()
        .insert("path", ".node")
        .attr("class", "link")
        .attr("d", (d) => {
          const source = { x: d.source.x, y: d.source.y };
          const target = { x: d.target.x, y: d.target.y };
          return `M${source.y},${source.x}C${(source.y + target.y) / 2},${
            source.x
          } ${(source.y + target.y) / 2},${target.x} ${target.y},${target.x}`;
        })
        .style("fill", "none")
        .style("stroke", "#ccc");

      // Update existing nodes and links
      node
        .merge(nodeEnter)
        .transition()
        .duration(500)
        .attr("transform", (d) => `translate(${d.y}, ${d.x})`);

      link.merge(link.enter());
    },
  },
  setup() {
    return {};
  },
});
</script>

<style scoped></style>
