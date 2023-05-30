<template>
  <div ref="chart" class="traces-service-graph-container text-center"></div>
</template>

<script lang="ts">
import { hierarchy, tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { cloneDeep } from "lodash-es";
import { defineComponent } from "vue";

export default defineComponent({
  name: "D3Chart",
  props: {
    data: {
      type: Array,
      default: () => [],
    },
  },
  data() {
    return {
      root: null as any,
      width: 200,
      height: 200,
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
      const { height, depth } = this.getTreeHeightAndDepth();

      this.svg = select(this.$refs.chart)
        .append("svg")
        .attr("width", this.width)
        .attr("height", this.height)
        .attr("id", "traces-service-graph-svg")
        .attr("class", "traces-service-graph-svg");

      // Create a group element for the chart content
      this.g = this.svg
        .append("g")
        .attr("transform", `translate(150, 0)`)
        .attr("id", "traces-service-graph-svg-group")
        .attr("class", "traces-service-graph-svg-group");

      // Create the tree layout and set its dimensions
      this.layout = tree().size([height > 1 ? height * 80 : 40, depth * 175]);
    },

    getTreeHeightAndDepth() {
      let data = [
        {
          name: "Service A",
          children: [
            {
              name: "Service B",
              children: [
                {
                  name: "Service c",
                  children: [
                    {
                      name: "Service F",
                      children: [
                        {
                          name: "Service G",
                          children: [
                            {
                              name: "Service H",
                              children: [
                                {
                                  name: "Service H",
                                  children: [
                                    {
                                      name: "Service H",
                                      children: [
                                        {
                                          name: "Service H",
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  name: "Service E",
                },
              ],
            },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
            { name: "Service D" },
          ],
        },
      ];
      let maxDepth = 0;
      let maxHeight: number[] = [0];
      const getService = (span: any, depth: number) => {
        maxHeight[depth] =
          maxHeight[depth] === undefined ? 1 : maxHeight[depth] + 1;
        if (span.children && span.children.length) {
          span.children.forEach((span: any) => getService(span, depth + 1));
        } else {
          if (maxDepth < depth) maxDepth = depth;
        }
      };
      this.data.forEach((span: any) => {
        getService(span, 1);
      });
      return {
        height: Math.max(...maxHeight),
        depth: maxDepth,
      };
    },

    loadData() {
      // Load your data here and convert it to a hierarchy
      let data = cloneDeep(this.data[0]) || [];
      // data = {
      //   name: "Service A Service H H H H H H H H H H H H H H H H H H H H H H H",
      //   children: [
      //     {
      //       name: "Service B",
      //       children: [
      //         {
      //           name: "Service c",
      //           children: [
      //             {
      //               name: "Service F",
      //               children: [
      //                 {
      //                   name: "Service G",
      //                   children: [
      //                     {
      //                       name: "Service H",
      //                       children: [
      //                         {
      //                           name: "Service H",
      //                           children: [
      //                             {
      //                               name: "Service H",
      //                               children: [
      //                                 {
      //                                   name: "Service H H H H H H H H H H H H H H H H H",
      //                                 },
      //                               ],
      //                             },
      //                           ],
      //                         },
      //                       ],
      //                     },
      //                   ],
      //                 },
      //               ],
      //             },
      //           ],
      //         },
      //         {
      //           name: "Service E",
      //         },
      //       ],
      //     },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //     { name: "Service D" },
      //   ],
      // };
      this.root = hierarchy(data);
      // Update the chart with the new data
      this.updateChart();
      this.$nextTick(() => {
        this.updateChartHeight();
      });
    },
    updateChartHeight() {
      let group = document.getElementById("traces-service-graph-svg-group");
      let svg = document.getElementById("traces-service-graph-svg");
      const groupDimensions = group?.getBoundingClientRect();
      // this.height = group?.getBoundingClientRect().height as number;
      svg.style.height = groupDimensions.height + 150 + "px";
      svg.style.width = groupDimensions?.width + 150 + "px";
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
        .attr("transform", (d) => {
          console.log(d);
          return `translate(${d.y}, ${d.x})`;
        });

      nodeEnter
        .append("circle")
        .attr("r", 10)
        .style("fill", "#fff")
        .style("stroke-width", "2px")
        .style("stroke", (d) => {
          return d.data.color;
        });

      let text = nodeEnter
        .append("text")
        .attr("dy", "30px")
        .attr("dx", "0px")
        .attr("text-anchor", "middle")
        .text((d) => {
          return d.data.name;
        })
        .attr("font-size", "12px")
        .style("cursor", "pointer");

      text.append("title").text((d) => d.data.name);

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
      node.merge(nodeEnter).attr("transform", (d) => {
        return `translate(${d.y}, ${d.x} )`;
      });

      link.merge(link.enter());
    },
  },
  setup() {
    return {};
  },
});
</script>

<style lang="scss">
.traces-service-graph-container {
  height: 200px;
  width: 100%;
  overflow-y: scroll;
  overflow-x: auto;
}
</style>
