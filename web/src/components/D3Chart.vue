<template>
  <div ref="chart" class="traces-service-graph-container text-center"></div>
</template>

<script lang="ts">
import { hierarchy, tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { cloneDeep } from "lodash-es";
import { defineComponent } from "vue";
import { useStore } from "vuex";

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
      services: [] as any[],
      root: null as any,
      width: 200,
      height: 200,
      svg: null as any,
      layout: null as any,
      g: null as any,
      store: useStore(),
    };
  },
  mounted() {
    this.svg = select(this.$refs.chart as HTMLElement)
      .append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("id", "traces-service-graph-svg")
      .attr("class", "traces-service-graph-svg");

    this.data.forEach((data, index) => {
      // Initialize the chart
      this.services.push(this.getDefaultTreeData());

      this.initChart(index);

      // Load data and update the chart
      this.loadData(index);
    });

    this.$nextTick(() => {
      let svg = document.getElementById("traces-service-graph-svg");

      const svgHeight = this.services.reduce(
        (acc, service) => acc + service.height + 40,
        0
      );
      const svgWidth = Math.max(
        ...this.services.map((service) => service.width)
      );
      if (svg) {
        svg.style.width = svgWidth + "px";
        svg.style.height = svgHeight + "px";
      }
    });
  },
  methods: {
    initChart(dataIndex: number) {
      // Create the SVG element and append it to the chart div
      const { height, depth } = this.getTreeHeightAndDepth(dataIndex);
      let totalHeight;
      if (dataIndex) {
        totalHeight = this.services.reduce(
          (acc, service) => acc + (service.height || 0) + 40,
          0
        );
      } else {
        totalHeight = height + 25;
      }
      // Create a group element for the chart content
      this.services[dataIndex]["g"] = this.svg
        .append("g")
        .attr("transform", `translate(150, ${totalHeight})`)
        .attr("id", `traces-service-graph-svg-group${dataIndex}`)
        .attr("class", `traces-service-graph-svg-group${dataIndex}`);

      // Create the tree layout and set its dimensions
      this.services[dataIndex]["layout"] = tree().size([
        height > 1 ? height * 100 : 40,
        depth * 175,
      ]);
    },

    getTreeHeightAndDepth(dataIndex: number) {
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
      getService(this.data[dataIndex], 1);
      return {
        height: Math.max(...maxHeight),
        depth: maxDepth,
      };
    },

    getDefaultTreeData() {
      return {
        root: null,
        g: null,
        layout: null,
      };
    },

    loadData(dataIndex: number) {
      // Load your data here and convert it to a hierarchy
      let data = cloneDeep(this.data[dataIndex]) || [];

      this.services[dataIndex]["root"] = hierarchy(data);
      // Update the chart with the new data
      this.updateChart(dataIndex);
      this.updateChartHeight(dataIndex);
    },

    updateChartHeight(dataIndex: number) {
      let group = document.getElementById(
        `traces-service-graph-svg-group${dataIndex}`
      );

      const groupDimensions = group?.getBoundingClientRect();
      if (groupDimensions) {
        this.services[dataIndex]["height"] = groupDimensions.height + 40;
        this.services[dataIndex]["width"] = groupDimensions.width + 150;
      }
    },

    updateChart(dataIndex: number) {
      // Call the layout on the root node and get the nodes and links
      const nodes = this.services[dataIndex]["layout"](
        this.services[dataIndex]["root"]
      ).descendants();
      const links = this.services[dataIndex]["layout"](
        this.services[dataIndex]["root"]
      ).links();

      // Bind the data to the nodes and links
      const node = this.services[dataIndex]["g"]
        .selectAll(".node")
        .data(nodes, (d: any) => d.data.name);

      const link = this.services[dataIndex]["g"]
        .selectAll(".link")
        .data(links, (d: any) => `${d.source.data.name}-${d.target.data.name}`);

      // Enter new nodes and links
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", (d: any) => {
          return `translate(${d.y}, ${d.x})`;
        });

      nodeEnter
        .append("circle")
        .attr("r", 10)
        .style("fill", this.store.state.theme === "dark" ? "#181a1b" : "#fff")
        .style("stroke-width", "2px")
        .style("stroke", (d: any) => {
          return d.data.color;
        });

      nodeEnter
        .append("text")
        .attr("dy", "-15px")
        .attr("dx", "0px")
        .attr("text-anchor", "middle")
        .text((d: any) => {
          return d.data.duration + "ms";
        })
        .attr("font-size", "12px")
        .style("cursor", "pointer")
        .style("fill", this.store.state.theme === "dark" ? "#fff" : "#000");

      let text = nodeEnter
        .append("text")
        .attr("dy", "22px")
        .attr("dx", "0px")
        .attr("text-anchor", "middle")
        .text((d: any) => {
          if (d.data?.name?.length > 40) {
            return d.data.name.slice(0, 37) + "...";
          }
          return d.data.name;
        })
        .attr("font-size", "12px")
        .style("cursor", "pointer")
        .style("fill", this.store.state.theme === "dark" ? "#fff" : "#000");

      text.append("title").text((d: any) => d.data.name);

      link
        .enter()
        .insert("path", ".node")
        .attr("class", "link")
        .attr("d", (d: any) => {
          const source = { x: d.source.x, y: d.source.y };
          const target = { x: d.target.x, y: d.target.y };
          return `M${source.y},${source.x}C${(source.y + target.y) / 2},${
            source.x
          } ${(source.y + target.y) / 2},${target.x} ${target.y},${target.x}`;
        })
        .style("fill", "none")
        .style("stroke", "#ccc");

      // Update existing nodes and links
      node.merge(nodeEnter).attr("transform", (d: any) => {
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
