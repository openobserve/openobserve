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
  <div>
    <div
      v-if="!span?.child_spans?.length || depth < 2"
      class="q-my-xs normal-header"
    >
      <div
        class="flex justify-between align-center"
        :style="{
          paddingLeft: 15 * depth + 10 + 'px',
        }"
      >
        <div>{{ span.service_name }}</div>
        <div>{{ span.is_in_process }}</div>
        <div>{{ formatTimeWithSuffix(span.duration) }}</div>
      </div>
      <div :style="{ width: '100%', backgroundColor: '#ececec' }">
        <div
          :style="{
            width: span?.duration / baseTracePosition?.per_pixel_ms + 'px',
            backgroundColor: '#6c83ee',
            height: '8px',
            borderRadius: '2px',
            left:
              (span.start_time - baseTracePosition['start_time']) /
                baseTracePosition?.per_pixel_ms +
              'px',
            position: 'relative',
          }"
        />
      </div>
      <div
        v-for="childSpan in span['child_spans']"
        :key="childSpan.span_id"
        :class="childSpan.span_id"
      >
        <span-renderer
          :depth="depth + 1"
          :baseTracePosition="baseTracePosition"
          :span="childSpan"
          :isCollapsed="collapseMapping[childSpan.span_id]"
          :collapseMapping="collapseMapping"
        />
      </div>
    </div>
    <app-collapse
      v-else
      :isCollapsed="collapseMapping[span.span_id]"
      class="app-collapse"
      :headerStyle="{ paddingLeft: 15 * depth + 'px' }"
      @update:collapse="updateCollapse"
    >
      <template v-slot:header>
        <div class="flex justify-between align-center">
          <div>{{ span.service_name }}</div>
          <div>{{ span.is_in_process }}</div>
          <div>{{ formatTimeWithSuffix(span.duration) }}</div>
        </div>
        <div :style="{ width: '100%', backgroundColor: '#ececec' }">
          <div
            :style="{
              width: span?.duration / baseTracePosition?.per_pixel_ms + 'px',
              backgroundColor: '#6c83ee',
              height: '8px',
              borderRadius: '2px',
              left:
                (span.start_time - baseTracePosition['start_time']) /
                  baseTracePosition?.per_pixel_ms +
                'px',
              position: 'relative',
            }"
          />
        </div>
      </template>
      <template v-slot:content>
        <div
          v-for="childSpan in span['child_spans']"
          :key="childSpan.span_id"
          :class="childSpan.span_id"
        >
          <span-renderer
            :depth="depth + 1"
            :baseTracePosition="baseTracePosition"
            :span="childSpan"
            :isCollapsed="collapseMapping[childSpan.span_id]"
            :collapseMapping="collapseMapping"
          />
        </div>
      </template>
    </app-collapse>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import AppCollapse from "./AppCollapse.vue";

export default defineComponent({
  name: "SpanRenderer",
  props: {
    span: {
      type: Object,
      default: () => null,
    },
    isCollapsed: {
      type: Boolean,
      default: false,
    },
    collapseMapping: {
      type: Object,
      default: () => {},
    },
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    depth: {
      type: Number,
      default: 0,
    },
  },
  setup() {
    function formatTimeWithSuffix(ns: number) {
      if (ns < 10000) {
        return `${ns} ms`;
      } else {
        return `${(ns / 1000).toFixed(2)} s`;
      }
    }
    function updateCollapse() {}
    return {
      formatTimeWithSuffix,
      updateCollapse,
    };
  },
  components: { AppCollapse },
});
</script>

<style scoped></style>
