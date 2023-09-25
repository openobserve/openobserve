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
import * as mapData  from "./../../../locales/languages/map.json"
import L from 'leaflet';
import '@/utils/dashboard/leaflet-echarts/index';

// import {tileLayer as LtileLayer } from 'leaflet';
import "leaflet/dist/leaflet.css";

export default defineComponent({
    name: "GeoMapRenderer",
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

        const lmapOptions = {...props.data.options?.lmap, map: 'USA'} || {};

        const store = useStore();
        const windowResizeEventCallback = async () => {
            await nextTick();
            await nextTick();
            chart.resize();
        };

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
            console.log("theme ", theme);

            const options = {
                ...props.data.options,
                lmap: lmapOptions,
            };

            console.log("options ", props.data.options);

            echarts.registerMap('USA', mapData);
            chart.setOption(options || {}, true);
            window.addEventListener("resize", windowResizeEventCallback);

            console.log("props.data.options", props?.data?.options);
            console.log("chart model", chart.getModel());
            

            // Get Leaflet extension component
            // getModel and getComponent do not seem to be exported in echarts typescript
            // add the following two comments to circumvent this
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lmapComponent = chart.getModel().getComponent('lmap');
            console.log("lmapComponent ", lmapComponent);
            
            // Get the instance of Leaflet
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lmap = lmapComponent.getLeaflet();

            L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }
            ).addTo(lmap);

        });
        onUnmounted(() => {
            window.removeEventListener("resize", windowResizeEventCallback);
        });

        // watch(() => store.state.theme, (newTheme) => {
        //     console.log("Theme changed to:", newTheme);
        //     const theme = newTheme === 'dark' ? 'dark' : 'light';
        //     chart.dispose();
        //     chart = echarts.init(chartRef.value, theme);
        //     const options = {
        //         ...props.data.options,
        //         lmap: lmapOptions,
        //     };
        //     options.animation = false;
        //     chart.setOption(options, true);
        //     chart.setOption({ animation: true });
        // });

        watch(() => props.data.options, async (newOptions) => {
            console.log("props.data.options changed:", newOptions);
            await nextTick();
            chart.resize();
            const options = {
                ...props.data.options,
                lmap: lmapOptions,
            };
            chart.setOption(options || {}, true);
             // Get Leaflet extension component
            // getModel and getComponent do not seem to be exported in echarts typescript
            // add the following two comments to circumvent this
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lmapComponent = chart.getModel().getComponent('lmap');
            console.log("lmapComponent ", lmapComponent);

            // Get the instance of Leaflet
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lmap = lmapComponent.getLeaflet();

            L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    attribution:
                        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                }
            ).addTo(lmap);
        }, { deep: true });
        return { chartRef };
    },
})
</script>