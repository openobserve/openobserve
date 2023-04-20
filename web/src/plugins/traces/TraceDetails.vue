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
    <div></div>
    <div
      v-for="(span, index) in traceTree"
      :key="span.span_id"
      class="q-mx-sm relative-position"
    >
      <SpanRenderer
        :isCollapsed="collapseMapping[span.span_id]"
        :collapseMapping="collapseMapping"
        :span="span"
        :index="index"
        :baseTracePosition="baseTracePosition"
        ref="traceRootSpan"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount, type Ref, onMounted } from "vue";
import spans from "./sample.json";
import { cloneDeep } from "lodash";
import SpanRenderer from "./SpanRenderer.vue";

export default defineComponent({
  name: "TraceDetails",
  props: {
    traceId: {
      type: String,
      default: "",
    },
  },
  setup() {
    const traceTree: any = ref([]);
    const spanMapping: any = ref({});
    onBeforeMount(() => {
      buildTracesTree();
    });
    const baseTracePosition: any = ref({});
    onMounted(() => {
      console.log(traceRootSpan.value[0].$el.clientWidth);
      baseTracePosition.value["width"] = traceRootSpan.value[0].$el.clientWidth;
      baseTracePosition.value["per_pixel_ms"] = Number(
        traceTree.value[0].duration / traceRootSpan.value[0].$el.clientWidth
      );
      baseTracePosition.value["start_time"] = traceTree.value[0].start_time;
    });
    const collapseMapping: any = ref({});
    const traceRootSpan: any = ref(null);
    const sampleTrace = ref([
      { span_id: 1, reference_parent_span_id: 0 },
      { span_id: 2, reference_parent_span_id: 1 },
      { span_id: 3, reference_parent_span_id: 1 },
      { span_id: 4, reference_parent_span_id: 2 },
      { span_id: 5, reference_parent_span_id: 3 },
      { span_id: 6, reference_parent_span_id: 3 },
      { span_id: 7, reference_parent_span_id: 5 },
      { span_id: 8, reference_parent_span_id: 6 },
      { span_id: 9, reference_parent_span_id: 4 },
      { span_id: 10, reference_parent_span_id: 7 },
    ]);
    const convertTime = (time) => {
      return time / 1000000;
    };
    // Find out spans who has reference_parent_span_id as span_id of first span in sampleTrace
    const buildTracesTree = () => {
      const traceTreeMock: any = {};
      spanMapping[spans[0].span_id] = spans[0];
      const inProcessSpans = [];
      for (let i = 1; i < spans.length; i++) {
        const span = spans[i];
        let nextSpan = spans[i + 1];

        if (nextSpan && nextSpan.start_time === span.end_time) {
          // In-process span
          span["is_in_process"] = true;
          inProcessSpans.push(span);
        }

        spanMapping[spans[i].span_id] = cloneDeep(spans[i]);
        spans[i].index = i;
        collapseMapping.value[spans[i].span_id] = false;
        if (!traceTreeMock[span.reference_parent_span_id]) {
          traceTreeMock[span.reference_parent_span_id] = [];
        }
        if (!traceTreeMock[span.span_id]) traceTreeMock[span.span_id] = [];
        if (!span["child_spans"])
          span["child_spans"] = traceTreeMock[span.span_id];
        traceTreeMock[span.reference_parent_span_id].push(
          getFormattedSpan(span)
        );
      }
      console.log(traceTreeMock);
      traceTree.value = [];
      traceTree.value.push(cloneDeep(getFormattedSpan(spans[0])));
      traceTree.value[0]["index"] = 0;
      traceTree.value[0]["child_spans"] = cloneDeep(
        traceTreeMock[spans[0]["span_id"]]
      );
      console.log(inProcessSpans);
    };
    const getFormattedSpan = (span) => {
      const timing = calculateTiming(span);
      return {
        timing: {
          busy_ms: span.busy_ns,
          idle_ms: span.idle_ns,
          start_time: span.start_time,
          end_time: span.end_time,
          busy_per: timing.busyPercentage.toFixed(2) + "%",
          idle_per: timing.idlePercentage.toFixed(2) + "%",
        },
        ...span,
        start_time: convertTime(span.start_time),
        duration: convertTime(span.duration),
      };
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
    return {
      traceTree,
      collapseMapping,
      traceRootSpan,
      baseTracePosition,
    };
  },
  components: { SpanRenderer },
});
</script>

<style scoped>
.searchdetaildialog {
  width: 60vw;
}

.q-item__section {
  word-break: break-all;
}

.indexDetailsContainer .q-list .q-item {
  height: auto;
}

.q-icon {
  cursor: pointer;
}

.table-pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  display: inline;
  font-weight: normal;
  font-family: Nunito Sans, sans-serif;
}

.json-pre {
  height: calc(100vh - 290px);
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
