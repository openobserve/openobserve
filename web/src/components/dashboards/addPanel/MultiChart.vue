<template>
    <!-- <div ref="chartPanelRef" style="margin-top: 0px; height: calc(100% - 40px);">
          <div v-if="props.data.type == 'table'" class="q-pa-sm" style="height: 100%">
              <div class="column" style="height: 100%; position: relative;">
                  <div v-if="errorDetail" class="errorMessage">
                    <q-icon size="md" name="warning" />
                    <div style="height: 80%; width: 100%;">{{ errorDetail }}</div>
                  </div>
                <div v-if="searchQueryData.loading" class="row" style="position: absolute; top:0px; width:100%; z-index: 1;">
                    <q-spinner-dots color="primary" style="margin: 0 auto; height: 10px; width: 40px;" />
                </div>
              </div>
          </div>
          <div v-else style="height: 100%; position: relative;">
              <div v-show="!errorDetail" ref="plotRef" :id="chartID" class="plotlycontainer" style="height: 100%"></div>
              <div v-if="!errorDetail" class="noData">{{ noData }}</div>
              <div v-if="errorDetail" class="errorMessage">
                <q-icon size="md" name="warning" />
                <div style="height: 80%; width: 100%;">{{ errorDetail }}</div>
              </div>
              <div v-if="searchQueryData.loading" class="row" style="position: absolute; top:0px; width:100%;">
                <q-spinner-dots color="primary" size="40px" style="margin: 0 auto;" />
              </div>
          </div>
      </div> -->
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted, watch } from "vue";
import Plotly from "plotly.js";

export default defineComponent({
    name: "MultiChart",
    props: {
        data: {
            required: true,
            type: Object,
        },
    },
    setup(props: any) {
        const plotRef: any = ref(null);

        onMounted(() => {
            console.log("props.data");
            if (props.data) {
                Plotly.newPlot(plotRef.value, props.data.traces, props.data.layout, {
                    showLink: false,
                });
            }
        });

        watch(props.data,
            // [props.traces, props.layout],
            async () => {
                Plotly.react(plotRef.value, props.data.traces, props.data.layout, {
                responsive: true,
                displaylogo: false,
                displayModeBar: false,
            });
        })
    },
})
</script>
