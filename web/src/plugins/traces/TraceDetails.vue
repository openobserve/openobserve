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
  <div
    class="trace-details"
    :style="{
      width: '97vw !important',
      background: store.state.theme === 'dark' ? '#181a1b' : '#ffffff',
    }"
  >
    <div
      class="row q-px-sm"
      v-if="traceTree.length && !searchObj.data.traceDetails.loading"
    >
      <div
        class="q-py-sm q-px-sm flex items-end justify-between col-12 toolbar"
      >
        <div class="flex items-end justify-start">
          <div class="text-h6 q-mr-lg">
            {{ traceTree[0]["operationName"] }}
          </div>
          <div class="q-pb-xs q-mr-lg">
            Trace ID: {{ spanList[0]["trace_id"] }}
          </div>
          <div class="q-pb-xs">Spans: {{ spanList.length }}</div>
        </div>
        <q-btn v-close-popup="true" round flat icon="cancel" size="md" />
      </div>
      <q-separator style="width: 100%" />
      <div class="col-12 flex justify-between items-end q-px-sm q-pt-sm">
        <div class="text-subtitle2 text-bold">
          {{
            activeVisual === "timeline" ? "Trace Timeline" : "Trace Service Map"
          }}
        </div>
        <div
          class="rounded-borders"
          style="border: 1px solid #cacaca; padding: 2px"
        >
          <template v-for="visual in traceVisuals" :key="visual.value">
            <q-btn
              :color="visual.value === activeVisual ? 'primary' : ''"
              :flat="visual.value === activeVisual ? false : true"
              dense
              no-caps
              size="11px"
              class="q-px-sm visual-selection-btn"
              @click="activeVisual = visual.value"
            >
              <q-icon><component :is="visual.icon" /></q-icon>
              {{ visual.label }}</q-btn
            >
          </template>
        </div>
      </div>
      <div class="col-12" v-if="activeVisual === 'timeline'">
        <ChartRenderer
          class="trace-details-chart"
          id="trace_details_gantt_chart"
          :data="ChartData"
          @updated:chart="updateChart"
          style="height: 200px"
        />
      </div>
      <div class="col-12" v-else>
        <ChartRenderer :data="traceServiceMap" style="height: 200px" />
      </div>
      <q-separator style="width: 100%" class="q-mb-sm" />
      <div
        :class="
          isSidebarOpen ? 'histogram-container' : 'histogram-container-full'
        "
      >
        <trace-header
          :baseTracePosition="baseTracePosition"
          :splitterWidth="splitterModel"
        />
        <div class="histogram-spans-container">
          <q-splitter v-model="splitterModel">
            <template v-slot:before>
              <div
                class="trace-tree-container"
                :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
              >
                <trace-tree
                  :collapseMapping="collapseMapping"
                  :spans="spanPositionList"
                  :baseTracePosition="baseTracePosition"
                  :spanDimensions="spanDimensions"
                  class="trace-tree"
                  @toggle-collapse="toggleSpanCollapse"
                />
              </div>
            </template>
            <template v-slot:after>
              <SpanRenderer
                :collapseMapping="collapseMapping"
                :spans="spanPositionList"
                :baseTracePosition="baseTracePosition"
                :spanDimensions="spanDimensions"
                ref="traceRootSpan"
              />
            </template>
          </q-splitter>
        </div>
      </div>
      <q-separator vertical />
      <div v-if="isSidebarOpen && selectedSpanId" class="histogram-sidebar">
        <trace-details-sidebar
          :span="spanMapping[selectedSpanId]"
          @close="closeSidebar"
        />
      </div>
    </div>
    <div
      v-else-if="searchObj.data.traceDetails.loading"
      class="flex column items-center justify-center"
      :style="{ height: '100%' }"
    >
      <q-spinner-hourglass color="primary" size="3em" :thickness="2" />
      <div class="q-pt-sm">Fetching your trace.</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref, onMounted, watch } from "vue";
import { cloneDeep, range } from "lodash";
import SpanRenderer from "./SpanRenderer.vue";
import useTraces from "@/composables/useTraces";
import { computed } from "vue";
import TraceDetailsSidebar from "./TraceDetailsSidebar.vue";
import TraceTree from "./TraceTree.vue";
import TraceHeader from "./TraceHeader.vue";
import { useStore } from "vuex";
import { duration } from "moment";
import D3Chart from "@/components/D3Chart.vue";
import { formatTimeWithSuffix, getImageURL } from "@/utils/zincutils";
import TraceTimelineIcon from "@/components/icons/TraceTimelineIcon.vue";
import ServiceMapIcon from "@/components/icons/ServiceMapIcon.vue";
import {
  convertTimelineData,
  convertTraceServiceMapData,
} from "@/utils/traces/convertTraceData";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";

export default defineComponent({
  name: "TraceDetails",
  props: {
    traceId: {
      type: String,
      default: "",
    },
  },
  components: {
    SpanRenderer,
    TraceDetailsSidebar,
    TraceTree,
    TraceHeader,
    D3Chart,
    TraceTimelineIcon,
    ServiceMapIcon,
    ChartRenderer,
  },

  setup() {
    const traceTree: any = ref([]);
    const spanMapping: any = ref({});
    const { searchObj } = useTraces();
    const baseTracePosition: any = ref({});
    const collapseMapping: any = ref({});
    const traceRootSpan: any = ref(null);
    const spanPositionList: any = ref([]);
    const splitterModel = ref(25);
    const timeRange: any = ref({ start: 0, end: 0 });
    const store = useStore();
    const traceServiceMap: any = ref({});
    const spanDimensions = {
      height: 25,
      barHeight: 8,
      textHeight: 25,
      gap: 15,
      collapseHeight: 8,
      collapseWidth: 8,
      connectorPadding: 2,
      paddingLeft: 8,
      hConnectorWidth: 20,
      dotConnectorWidth: 6,
      dotConnectorHeight: 6,
      colors: ["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2"],
    };

    const traceVisuals = [
      { label: "Timeline", value: "timeline", icon: TraceTimelineIcon },
      { label: "Service Map", value: "service_map", icon: ServiceMapIcon },
    ];

    const activeVisual = ref("timeline");

    const traceChart = ref({
      data: [],
    });

    const ChartData: any = ref({});

    const spanList: any = computed(() => {
      return searchObj.data.traceDetails.spanList;
    });

    onMounted(() => {
      buildTracesTree();
    });

    watch(
      () => spanList.value.length,
      () => {
        if (spanList.value.length) {
          buildTracesTree();
        } else traceTree.value = [];
      },
      { immediate: true }
    );

    const isSidebarOpen = computed(() => {
      return searchObj.data.traceDetails.showSpanDetails;
    });

    const selectedSpanId = computed(() => {
      return searchObj.data.traceDetails.selectedSpanId;
    });

    const calculateTracePosition = () => {
      const tics = [];
      baseTracePosition.value["durationMs"] = timeRange.value.end;
      baseTracePosition.value["startTimeMs"] =
        traceTree.value[0].startTimeMs + timeRange.value.start;
      const quarterMs = (timeRange.value.end - timeRange.value.start) / 4;
      let time = timeRange.value.start;
      for (let i = 0; i <= 4; i++) {
        tics.push({
          value: Number(time.toFixed(2)),
          label: `${formatTimeWithSuffix(time * 1000)}`,
          left: `${25 * i}%`,
        });
        time += quarterMs;
      }
      baseTracePosition.value["tics"] = tics;
    };

    // Find out spans who has reference_parent_span_id as span_id of first span in sampleTrace
    const buildTracesTree = async () => {
      if (!spanList.value?.length) return;

      spanMapping.value = {};
      traceTree.value = [];
      spanPositionList.value = [];
      collapseMapping.value = {};
      let lowestStartTime: number = spanList.value[0].start_time;
      let highestEndTime: number = spanList.value[0].end_time;

      const traceTreeMock: any = {};
      const serviceColorMapping: any = {};

      if (!spanList.value?.length) return;
      spanMapping.value[spanList.value[0].span_id] = spanList.value[0];
      let noParentSpans = [];
      for (let i = 0; i < spanList.value.length; i++) {
        if (spanList.value[i].start_time < lowestStartTime) {
          lowestStartTime = spanList.value[i].start_time;
        }
        if (spanList.value[i].end_time > highestEndTime) {
          highestEndTime = spanList.value[i].end_time;
        }

        spanMapping.value[spanList.value[i].span_id] = cloneDeep(
          spanList.value[i]
        );

        const span = getFormattedSpan(spanList.value[i]);

        span.style.color = searchObj.meta.serviceColors[span.serviceName];

        span.index = i;

        collapseMapping.value[span.spanId] = true;

        if (span.parentId && !traceTreeMock[span.parentId] && i !== 0) {
          noParentSpans.push(span);
        }

        if (span.parentId && traceTreeMock[span.parentId])
          traceTreeMock[span.parentId].push(span);

        if (!traceTreeMock[span.spanId]) traceTreeMock[span.spanId] = [];

        if (!span["spans"]) span["spans"] = traceTreeMock[span.spanId];
      }

      traceTree.value = [];
      traceTree.value.push(getFormattedSpan(spanList.value[0]));
      traceTree.value[0]["index"] = 0;
      traceTree.value[0].lowestStartTime =
        converTimeFromNsToMs(lowestStartTime);
      traceTree.value[0].highestEndTime = converTimeFromNsToMs(highestEndTime);
      traceTree.value[0].style.color =
        searchObj.meta.serviceColors[traceTree.value[0].serviceName];
      traceTree.value[0]["spans"] = cloneDeep(
        traceTreeMock[spanList.value[0]["span_id"]] || []
      );
      traceTree.value.push(...noParentSpans);
      traceTree.value.forEach((span: any) => {
        addSpansPositions(span, 0);
      });

      timeRange.value.end = (
        traceTree.value[0].highestEndTime - traceTree.value[0].lowestStartTime
      ).toFixed(2);
      timeRange.value.start = 0;

      calculateTracePosition();
      buildTraceChart();
      buildServiceTree();
    };
    let index = 0;
    const addSpansPositions = (span: any, depth: number) => {
      if (!span.index) index = 0;
      span.depth = depth;
      spanPositionList.value.push(
        Object.assign(span, {
          style: {
            color: span.style.color,
            top: index * spanDimensions.height + "px",
            left: spanDimensions.gap * depth + "px",
          },
          hasChildSpans: !!span.spans.length,
          currentIndex: index,
        })
      );
      if (collapseMapping.value[span.spanId]) {
        if (span.spans.length) {
          span.spans.forEach((childSpan: any) => {
            index = index + 1;
            childSpan.totalSpans = addSpansPositions(childSpan, depth + 1);
          });
          span.totalSpans = span.spans.reduce(
            (acc: number, span: any) =>
              acc + ((span?.spans?.length || 0) + (span?.totalSpans || 0)),
            0
          );
        }
        return (span?.spans?.length || 0) + (span?.totalSpans || 0);
      } else {
        return 0;
      }
    };

    const buildServiceTree = () => {
      const serviceTree: any[] = [];
      let maxDepth = 0;
      let maxHeight: number[] = [0];
      const getService = (
        span: any,
        currentColumn: any[],
        serviceName: string,
        depth: number,
        height: number
      ) => {
        maxHeight[depth] =
          maxHeight[depth] === undefined ? 1 : maxHeight[depth] + 1;
        if (serviceName !== span.serviceName) {
          const children: any[] = [];
          currentColumn.push({
            name: `${span.serviceName} \n (${span.durationMs}ms)`,
            parent: serviceName,
            duration: span.durationMs,
            children: children,
            itemStyle: {
              color: searchObj.meta.serviceColors[span.serviceName],
            },
            emphasis: {
              disabled: true,
            },
          });
          if (span.spans && span.spans.length) {
            span.spans.forEach((_span: any) =>
              getService(_span, children, span.serviceName, depth + 1, height)
            );
          } else {
            if (maxDepth < depth) maxDepth = depth;
          }
          return;
        }
        if (span.spans && span.spans.length) {
          span.spans.forEach((span: any) =>
            getService(span, currentColumn, serviceName, depth + 1, height)
          );
        } else {
          if (maxDepth < depth) maxDepth = depth;
        }
      };
      traceTree.value.forEach((span: any) => {
        getService(span, serviceTree, "", 1, 1);
      });
      traceServiceMap.value = convertTraceServiceMapData(
        cloneDeep(serviceTree),
        maxDepth
      );
    };

    // Convert span object to required format
    // Converting ns to ms
    const getFormattedSpan = (span: any) => {
      return {
        [store.state.zoConfig.timestamp_column]:
          span[store.state.zoConfig.timestamp_column],
        startTimeMs: converTimeFromNsToMs(span.start_time),
        endTimeMs: converTimeFromNsToMs(span.end_time),
        durationMs: Number((span.duration / 1000).toFixed(2)), // This key is standard, we use for calculating width of span block. This should always be in ms
        durationUs: Number(span.duration.toFixed(2)), // This key is used for displaying duration in span block. We convert this us to ms, s in span block
        idleMs: convertTime(span.idle_ns),
        busyMs: convertTime(span.busy_ns),
        spanId: span.span_id,
        operationName: span.operation_name,
        serviceName: span.service_name,
        spanKind: getSpanKind(span.span_kind.toString()),
        parentId: span.reference_parent_span_id,
        spans: null,
        index: 0,
        style: {
          color: "",
        },
      };
    };

    const convertTime = (time: number) => {
      return Number((time / 1000000).toFixed(2));
    };

    const converTimeFromNsToMs = (time: number) => {
      const nanoseconds = time;
      const milliseconds = Math.floor(nanoseconds / 1000000);
      const date = new Date(milliseconds);
      return date.getTime();
    };

    const getSpanKind = (spanKind: string) => {
      const spanKindMapping: { [key: string]: string } = {
        "1": "Client",
        "2": "Server",
        "3": "Producer",
        "4": "Consumer",
        "5": "Internal",
      };
      return spanKindMapping[spanKind];
    };

    const closeSidebar = () => {
      searchObj.data.traceDetails.showSpanDetails = false;
      searchObj.data.traceDetails.selectedSpanId = null;
    };
    const toggleSpanCollapse = (spanId: number | string) => {
      collapseMapping.value[spanId] = !collapseMapping.value[spanId];
      index = 0;
      spanPositionList.value = [];
      traceTree.value.forEach((span: any) => {
        addSpansPositions(span, 0);
      });
    };
    const buildTraceChart = () => {
      const data: any = [];
      for (let i = spanPositionList.value.length - 1; i > -1; i--) {
        const absoluteStartTime =
          spanPositionList.value[i].startTimeMs -
          traceTree.value[0].lowestStartTime;

        data.push({
          x0: absoluteStartTime,
          x1: Number(
            (absoluteStartTime + spanPositionList.value[i].durationMs).toFixed(
              2
            )
          ),
          fillcolor: spanPositionList.value[i].style.color,
        });
      }
      traceChart.value.data = data;
      ChartData.value = convertTimelineData(traceChart);
    };
    const updateChart = (data: any) => {
      timeRange.value.start = data.start || 0;
      timeRange.value.end = data.end || 0;
      calculateTracePosition();
    };
    const mockServiceMap = [
      {
        name: "Service A",
        color: "#000000",
        duration: "10",
        children: [
          {
            name: "Service B",
            color: "#000000",
            duration: "10",

            children: [
              {
                name: "Service c",
                color: "#000000",
                duration: "10",

                children: [
                  {
                    name: "Service F",
                    color: "#000000",
                    duration: "10",

                    children: [
                      {
                        name: "Service G",
                        color: "#000000",
                        duration: "10",

                        children: [
                          {
                            name: "Service H",
                            color: "#000000",
                            duration: "10",

                            children: [
                              {
                                name: "Service H",
                                color: "#000000",
                                duration: "10",

                                children: [
                                  {
                                    name: "Service H",
                                    color: "#000000",
                                    duration: "10",

                                    children: [
                                      {
                                        name: "Service H H H H H H H H H H H H H H H H H",
                                        color: "#000000",
                                        duration: "10",
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                name: "Service E",
                color: "#000000",
                duration: "10",
              },
            ],
          },
          { name: "Service D", color: "#000000", duration: "10" },
          { name: "Service D", color: "#000000", duration: "10" },
        ],
      },
      {
        name: "Service X",
        color: "#000000",
        duration: "10",
      },
      {
        name: "Service Y",
        color: "#000000",
        duration: "10",
        children: [
          {
            name: "Service YA",
            color: "#000000",
            duration: "10",
          },
        ],
      },
    ];
    return {
      traceTree,
      collapseMapping,
      traceRootSpan,
      baseTracePosition,
      searchObj,
      spanList,
      isSidebarOpen,
      selectedSpanId,
      spanMapping,
      closeSidebar,
      toggleSpanCollapse,
      spanPositionList,
      spanDimensions,
      splitterModel,
      ChartData,
      traceChart,
      updateChart,
      traceServiceMap,
      mockServiceMap,
      activeVisual,
      traceVisuals,
      getImageURL,
      store,
    };
  },
});
</script>

<style scoped lang="scss">
$sidebarWidth: 60%;
$seperatorWidth: 2px;
$toolbarHeight: 50px;
$traceHeaderHeight: 30px;
$traceChartHeight: 210px;
.toolbar {
  height: $toolbarHeight;
}
.trace-details {
  height: 100vh;
  overflow: auto;
}
.histogram-container-full {
  width: 100%;
}
.histogram-container {
  width: calc(100% - $sidebarWidth - $seperatorWidth);
}

.histogram-sidebar {
  width: $sidebarWidth;
  height: calc(100vh - $toolbarHeight - $traceChartHeight - 44px);
  overflow-y: scroll;
  overflow-x: hidden;
}

.histogram-spans-container {
  height: calc(
    100vh - $toolbarHeight - $traceHeaderHeight - $traceChartHeight - 44px
  );
  overflow-y: auto;
  position: relative;
  overflow-x: hidden;
}

.trace-tree-container {
  overflow: auto;
}
</style>
<style lang="scss">
.trace-details {
  .q-splitter__before,
  .q-splitter__after {
    overflow: revert !important;
  }

  .q-splitter__before {
    z-index: 999 !important;
  }

  .trace-details-chart {
    .rangeslider-slidebox {
      fill: #7076be !important;
    }
    .rangeslider-mask-max,
    .rangeslider-mask-min {
      fill: #d2d2d2 !important;
      fill-opacity: 1 !important;
    }
  }

  .visual-selection-btn {
    .q-icon {
      padding-right: 5px;
      font-size: 15px;
    }
  }
}
</style>
