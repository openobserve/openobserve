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
    emits: ["updated:chart","click","updated:dataZoom"],
    props: {
        data: {
            required: true,
            type: Object,
            default: () => ({ options: {} })
        },
    },
    setup(props: any,{ emit }) {
        const chartRef: any = ref(null);
        let chart: any;
        const store = useStore();
        const windowResizeEventCallback = async () => {
            await nextTick();
            await nextTick();
            chart.resize();
        }

        const mouseHoverEffectFn = (params: any) => {

          // if chart type is pie then set seriesName and seriesIndex from data and dataIndex
          // seriesName and seriesIndex will used in the same function
          if(params.componentSubType === "pie"){
            params.seriesName = params.data?.name;
            params.seriesIndex = params.dataIndex;
          }
          
          props.data?.extras?.setCurrentSeriesValue(params.seriesName);

          // scroll legend upto current series index
          const legendOption = chart.getOption()?.legend[0];

          if (legendOption && params?.seriesIndex) {
                legendOption.scrollDataIndex = params?.seriesIndex;
            chart?.setOption({ legend: [legendOption] });
          } 
        }

        const legendSelectChangedFn =  (params: any) => {
          // check if all series are selected (all will be false)
          if(Object.values(params.selected).every((value: any) => value === false)){

            // set all series to true
            Object.keys(params.selected).forEach((name: any) => {
              params.selected[ name ] = true;
            });

          // select only selected series
          }else {

            // set all false except selected series
            Object.keys(params.selected).forEach((name: any) => {
              params.selected[ name ] = params.name === name ? true : false;
            });

          }              

          // get legend
          const legendOption = chart.getOption().legend[0];

          // set options with selected object
          if (legendOption && params?.selected) {
            legendOption.selected = params.selected;
            chart.setOption({ legend: [legendOption] });
          }
        }

        watch(() => store.state.theme, (newTheme) => {
          const theme = newTheme === 'dark' ? 'dark' : 'light';
          chart.dispose();  
          chart = echarts.init(chartRef.value, theme);
          const options = props.data.options || {}
          options.animation = false
          chart.setOption(options, true);
          chart.setOption({animation: true});
          chart.on("mouseover", mouseHoverEffectFn);
          chart.on("globalout", () => {mouseHoverEffectFn({})});
          chart.on("legendselectchanged",legendSelectChangedFn);
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
            chart.on("mouseover", mouseHoverEffectFn);
            chart.on("globalout", () => {mouseHoverEffectFn({})});
            chart.on("legendselectchanged",legendSelectChangedFn);

            //on dataZoom emit an event of start x and end x
            chart.on('dataZoom', function (params:any) {
                emit("updated:dataZoom", {
                    start: params?.batch[0]?.startValue,
                    end: params?.batch[0]?.endValue,
                });
                emit("updated:chart", {
                    start: chart?.getOption()?.dataZoom[0]?.startValue,
                    end: chart?.getOption()?.dataZoom[0]?.endValue,
                });
            });
            chart.on('click', function (params:any) {                                
                emit("click", params);
            });
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