<template>
    <!-- <div ref="chartContainer"></div> -->
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
        // traces: {
        //     required: true,
        //     type: Object,
        // },
        // layout: {
        //     required: true,
        //     type: Object,
        // },
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
