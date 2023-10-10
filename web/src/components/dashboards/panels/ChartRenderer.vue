<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div ref="chartRef" id="chart1" style="height: 100%; width: 100%;"></div>
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
            default: () => ({ options: {}, extras: {} })
        },
    },
    setup(props: any) {
        const chartRef: any = ref(null);
        let chart: any;
        const store = useStore();
        const windowResizeEventCallback = async () => {
            await nextTick();
            await nextTick();
            chart.resize();
        }

        watch(() => store.state.theme, (newTheme) => {
          const theme = newTheme === 'dark' ? 'dark' : 'light';
          chart.dispose();  
          chart = echarts.init(chartRef.value, theme);
          const options = props.data.options || {}
          options.animation = false
          chart.setOption(options, true);
          chart.setOption({animation: true});
          chart.on('mouseover', function(params : any) {
            props.data?.extras?.setCurrentSeriesIndex(params.seriesIndex);

            // scroll legend upto current series index
            const legendOption = chart.getOption().legend[0];
            
            if (legendOption) {
                legendOption.scrollDataIndex = params.seriesIndex;
                chart.setOption({ legend: [legendOption] });
            }
          })
        });

        onMounted(async () => {
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            await nextTick();
            const theme = store.state.theme === 'dark' ? 'dark' : 'light';
            chart = echarts.init(chartRef.value, theme);
            chart.setOption(props?.data?.options || {}, true);
            chart.on('mouseover', function(params : any) {
                props.data?.extras?.setCurrentSeriesIndex(params.seriesIndex);

                // scroll legend upto current series index
                const legendOption = chart.getOption().legend[0];

                if (legendOption) {
                    legendOption.scrollDataIndex = params.seriesIndex;
                    chart.setOption({ legend: [legendOption] });
                } 
           })
            window.addEventListener("resize", windowResizeEventCallback);
        });
        onUnmounted(() => {
            window.removeEventListener("resize", windowResizeEventCallback);
        });
        watch(() => props.data.options, async () => {
            await nextTick();
            chart.resize();
            chart.setOption(props?.data?.options || {}, true);
        }, { deep: true });
        return { chartRef };
    },
})
</script>