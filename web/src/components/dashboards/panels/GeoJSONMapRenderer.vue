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
  <div style="padding: 5px; height: 100%; width: 100%">
    <div ref="chartRef" id="chart-maps" style="height: 100%; width: 100%"></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, onUnmounted, nextTick } from "vue";
import * as echarts from "echarts";
import { useStore } from "vuex";
import * as map from "./../../../locales/languages/map.json"
export default defineComponent({
    name: "GeoJSONMapRenderer",
    props: {
        data: {
            required: true,
            type: Object,
            default: () => ({ options: {} })
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
            chart.setOption({ animation: true });
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
            echarts.registerMap('world', map);
            chart.setOption(props?.data?.options || {}, true);
            window.addEventListener("resize", windowResizeEventCallback);
        });
        onUnmounted(() => {
            window.removeEventListener("resize", windowResizeEventCallback);
        });
        watch(() => props.data.options, async () => {
            await nextTick();
            chart.resize();
            console.log("props.data.options", props.data.options);
            
            chart.setOption(props?.data?.options || {}, true);
        }, { deep: true });
        return { chartRef };
    },
})
</script>