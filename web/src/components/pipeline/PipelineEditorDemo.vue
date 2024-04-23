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
<template>
  <div style="height: 100%; width: 100%">
    <ChartRenderer
      :data="{ options: options ?? { backgroundColor: 'transparent' } }"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { onMounted } from "vue";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import { ref } from "vue";

export default defineComponent({
  name: "VariablesDependenciesGraph",
  components: { ChartRenderer },
  props: {
    // we have list of variables
    variablesList: {
      type: Array,
      default: [],
      required: true,
    },
  },
  setup(props: any) {
    let variablesDependencyGraph: any = {};

    const options: any = ref(null);

    onMounted(() => {
      // make dependency graph
      variablesDependencyGraph = buildVariablesDependencyGraph(
        props.variablesList
      );

      console.log(variablesDependencyGraph);
      let edges = [];

      // loop on all variables
      for (let source in variablesDependencyGraph) {
        // get its child variables
        let childVariables = variablesDependencyGraph[source].childVariables;

        // loop on child variables and push edges
        for (let i = 0; i < childVariables.length; i++) {
          let target = childVariables[i];
          edges.push({ source: source, target: target });
        }
      }

      options.value = {
        backgroundColor: "transparent",
        tooltip: {
          show: false,
        },
        series: [
          {
            type: "graph",
            layout: "force",
            roam: true,
            edgeSymbol: ["none", "arrow"],
            symbol: "rect",
            symbolSize: [50, 10],
            draggable: true,
            zoom: 5,
            label: {
              show: true,
            },
            data: Object.keys(variablesDependencyGraph).map((it: any) => {
              return {
                name: it,
              };
            }),
            links: edges,
            lineStyle: {
              opacity: 0.5,
              width: 2,
            },
          },
        ],
      };
    });

    return {
      options,
    };
  },
});
</script>
