<template>
  <div ref="chartRef" class="plotlycontainer" id="chart1" style="height: 100%; width: 100%;"></div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, onUnmounted, nextTick } from "vue";
import * as echarts from "echarts";
import { useStore } from "vuex";

export default defineComponent({
    name: "ChartRenderer",
    props: {
        data: {
            required: true,
            type: Object,
            default: () => ({ option: {} })
        },
    },
    setup(props: any) {
        const chartRef: any = ref(null);
        let chart: any;
        const store = useStore();
        const windowResizeEventCallback = async () => {
            await nextTick();
            chart.resize();
        }

        watch(() => store.state.theme, (newTheme) => {
          const theme = newTheme === 'dark' ? 'dark' : 'light';
          chart.dispose();  
          chart = echarts.init(chartRef.value, theme);
          const options = props.data.option || {}
          options.animation = false
          chart.setOption(options, true);
          chart.setOption({animation: true});
        });

        onMounted(async () => {
            console.log("ChartRenderer: mounted");
            console.log("props at chartrenderer", { props });
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            const theme = store.state.theme === 'dark' ? 'dark' : 'light';
            chart = echarts.init(chartRef.value, theme);
            chart.setOption(props?.data?.option || {}, true);
            window.addEventListener("resize", windowResizeEventCallback);
        });
        onUnmounted(() => {
            window.removeEventListener("resize", windowResizeEventCallback);
        });
        watch(() => props.data.option, () => {
            console.log("ChartRenderer: props.data updated", props.data);
            chart.setOption(props?.data?.option || {}, true);
        }, { deep: true });
        return { chartRef };
    },
})
</script>