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
import { defineComponent, ref, onMounted, watch, onUnmounted, nextTick, onActivated } from "vue";
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
            chart?.resize();
        }

        const mouseHoverEffectFn = (params: any) => {

          // if chart type is pie then set seriesName and seriesIndex from data and dataIndex
          // seriesName and seriesIndex will used in the same function
          if(params?.componentSubType === "pie"){
            params.seriesName = params?.data?.name;
            params.seriesIndex = params?.dataIndex;
          }
          
          props?.data?.extras?.setCurrentSeriesValue(params?.seriesName);

          // scroll legend upto current series index
          const legendOption = chart?.getOption()?.legend[0];

          if (legendOption) {
                legendOption.scrollDataIndex = params?.seriesIndex || 0;
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
          const legendOption = chart?.getOption()?.legend[0];

          // set options with selected object
          if (legendOption) {
            legendOption.selected = params?.selected || 0;
            chart?.setOption({ legend: [legendOption] });
          }
        }

        watch(() => store.state.theme, (newTheme) => {
          const theme = newTheme === 'dark' ? 'dark' : 'light';
          chart?.dispose();  
          chart = echarts.init(chartRef.value, theme);
          const options = props.data.options || {}

          // change color and background color of tooltip
          options.tooltip && options.tooltip.textStyle && (options.tooltip.textStyle.color = theme === 'dark' ? '#fff' : '#000');
          options.tooltip && (options.tooltip.backgroundColor = theme === 'dark' ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)");
          options.animation = false
          chart?.setOption(options, true);
          chart?.setOption({animation: true});
          chart?.on("mouseover", mouseHoverEffectFn);
          chart?.on("globalout", () => {mouseHoverEffectFn({})});
          chart?.on("legendselectchanged",legendSelectChangedFn);

          // we need that toolbox datazoom button initally selected
          chart?.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive:true });
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
            if(chartRef.value) {
              chart = echarts.init(chartRef.value, theme);
            }
            chart?.setOption(props?.data?.options || {}, true);
            chart?.on("mouseover", mouseHoverEffectFn);
            chart?.on("globalout", () => {mouseHoverEffectFn({})});
            chart?.on("legendselectchanged",legendSelectChangedFn);

            emit("updated:chart", {
                start: chart?.getOption()?.dataZoom[0]?.startValue||0,
                end: chart?.getOption()?.dataZoom[0]?.endValue||0,
            });

            //on dataZoom emit an event of start x and end x
            chart?.on('dataZoom', function (params:any) {
                //if batch then emit dataZoom event
                if(params?.batch){
                    emit("updated:dataZoom", {
                        start: params?.batch[0]?.startValue||0,
                        end: params?.batch[0]?.endValue||0,
                    });
                }
                //else if daatazoom then emit dataZoom event
                else if(chart?.getOption()?.dataZoom){
                    emit("updated:chart", {
                        start: chart?.getOption()?.dataZoom[0]?.startValue||0,
                        end: chart?.getOption()?.dataZoom[0]?.endValue||0,
                    });
                }
            });
            chart?.on('click', function (params:any) {                                
                emit("click", params);
            });
            window.addEventListener("resize", windowResizeEventCallback);

            // we need that toolbox datazoom button initally selected
            chart?.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive:true });
        });
        onUnmounted(() => {
            window.removeEventListener("resize", windowResizeEventCallback);
        });

        //need to resize chart on activated
        onActivated(()=>{
            windowResizeEventCallback();

            // we need that toolbox datazoom button initally selected
            chart?.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive:true });
        })
        
        watch(() => props.data.options, async () => {
            await nextTick();
            chart?.resize();
            chart?.setOption(props?.data?.options || {}, true);
            // we need that toolbox datazoom button initally selected
            // for that we required to dispatch an event
            // while dispatching an event we need to pass a datazoomselectactive as true
            // this action is available in the echarts docs in list of brush actions
            chart?.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive:true });
        }, { deep: true });
        return { chartRef };
    },
})
</script>