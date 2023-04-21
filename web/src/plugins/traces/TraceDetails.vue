<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
    :style="{ width: '90vw !important', background: '#ffffff' }"
  >
    <div
      class="row"
      v-if="traceTree.length && !searchObj.data.traceDetails.loading"
    >
      <div
        :class="
          isSidebarOpen ? 'histogram-container' : 'histogram-container-full'
        "
        class="q-py-md"
      >
        <div class="q-pb-sm q-px-md flex items-center justify-start">
          <div class="text-h6 q-mr-lg">
            {{ traceTree[0]["operationName"] }}
          </div>
          <div>Spans: {{ spanList.length - 1 }}</div>
        </div>
        <div class="histogram-spans-container q-px-md">
          <div
            v-for="(span, index) in traceTree"
            :key="span.spanId"
            class="relative-position"
          >
            <SpanRenderer
              :isCollapsed="collapseMapping[span.spanId]"
              :collapseMapping="collapseMapping"
              :span="span"
              :index="index"
              :baseTracePosition="baseTracePosition"
              ref="traceRootSpan"
            />
          </div>
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
      <q-spinner color="primary" size="3em" :thickness="2" />
      <div class="q-pt-sm">Getting trace data</div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onBeforeMount,
  type Ref,
  onMounted,
  watch,
  nextTick,
  onActivated,
} from "vue";
import { cloneDeep } from "lodash";
import SpanRenderer from "./SpanRenderer.vue";
import useTraces from "@/composables/useTraces";
import { computed } from "vue";
import TraceDetailsSidebar from "./TraceDetailsSidebar.vue";

export default defineComponent({
  name: "TraceDetails",
  props: {
    traceId: {
      type: String,
      default: "",
    },
  },
  components: { SpanRenderer, TraceDetailsSidebar },

  setup() {
    const traceTree: any = ref([]);
    const spanMapping: any = ref({});
    const { searchObj } = useTraces();
    const baseTracePosition: any = ref({});
    const collapseMapping: any = ref({});
    const traceRootSpan: any = ref(null);

    const spanList = computed(() => {
      return searchObj.data.traceDetails.spanList;
    });

    onActivated(() => {
      buildTracesTree();
      if (traceRootSpan.value) {
        calculateTracePosition();
      }
    });

    onMounted(() => {
      buildTracesTree();
      if (traceRootSpan.value) {
        calculateTracePosition();
      }
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
      console.log("calculateTracePosition");
      console.log("traceRootSpan", traceRootSpan.value);
      baseTracePosition.value["width"] = traceRootSpan.value[0].$el.clientWidth;
      baseTracePosition.value["perPixelMs"] = Number(
        traceTree.value[0].durationMs / traceRootSpan.value[0].$el.clientWidth
      );
      baseTracePosition.value["durationMs"] = traceTree.value[0].durationMs;
      baseTracePosition.value["startTimeMs"] = traceTree.value[0].startTimeMs;
    };

    // Find out spans who has reference_parent_span_id as span_id of first span in sampleTrace
    const buildTracesTree = async () => {
      console.log("buildTracesTree", spanList.value);
      const traceTreeMock: any = {};
      spanMapping.value[spanList.value[0].span_id] = spanList.value[0];

      for (let i = 1; i < spanList.value.length; i++) {
        spanMapping.value[spanList.value[i].span_id] = cloneDeep(
          spanList.value[i]
        );

        const span = getFormattedSpan(spanList.value[i]);

        span.index = i;

        collapseMapping.value[span.spanId] = false;

        if (!traceTreeMock[span.parentId]) {
          traceTreeMock[span.parentId] = [];
        }

        if (!traceTreeMock[span.spanId]) traceTreeMock[span.spanId] = [];

        if (!span["spans"]) span["spans"] = traceTreeMock[span.spanId];

        traceTreeMock[span.parentId].push(span);
      }

      traceTree.value = [];
      traceTree.value.push(getFormattedSpan(spanList.value[0]));
      traceTree.value[0]["index"] = 0;
      traceTree.value[0]["spans"] = cloneDeep(
        traceTreeMock[spanList.value[0]["span_id"]] || []
      );
      setTimeout(() => {
        calculateTracePosition();
      }, 2000);
    };

    // Convert span object to required format
    // Converting ns to ms
    const getFormattedSpan = (span: any) => {
      return {
        _timestamp: span._timestamp,
        startTimeMs: converTimeFromNsToMs(span.start_time),
        endTimeMs: converTimeFromNsToMs(span.end_time),
        durationMs: convertTime(span.duration),
        idleMs: convertTime(span.idle_ns),
        busyMs: convertTime(span.busy_ns),
        spanId: span.span_id,
        operationName: span.operation_name,
        serviceName: span.service_name,
        spanKind: getSpanKind(span.span_kind.toString()),
        parentId: span.reference_parent_span_id,
        spans: null,
        index: 0,
      };
    };

    const convertTime = (time) => {
      return Number(time / 1000000).toFixed(2);
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

    const getMsInPixels = (ms) => {
      console.log(ms, (ms / baseTracePosition.value.per_pixel_ms).toFixed(2));
      return (ms / baseTracePosition.value.per_pixel_ms).toFixed(2);
    };
    const calculateTiming = (span) => {
      const start_time = span.start_time;
      const end_time = span.end_time;
      const busy = span.busy_ns;
      const idle = span.idle_ns;
      const total = end_time - start_time;
      const busyPercentage = (busy / total) * 100;
      const idlePercentage = (idle / total) * 100;
      return {
        busyPercentage,
        idlePercentage,
      };
    };
    const closeSidebar = () => {
      searchObj.data.traceDetails.showSpanDetails = false;
      searchObj.data.traceDetails.selectedSpanId = null;
    };
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
    };
  },
});
</script>

<style scoped lang="scss">
$sidebarWidth: 350px;
$seperatorWidth: 2px;

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
  height: 100vh;
  overflow-y: scroll;
  overflow-x: hidden;
}

.histogram-spans-container {
  height: calc(100vh - 73px);
  overflow-y: auto;
}
</style>
