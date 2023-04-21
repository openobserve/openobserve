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
    <div v-if="!span?.spans?.length" class="q-my-xs normal-header">
      <span-block
        :span="span"
        :depth="depth"
        :baseTracePosition="baseTracePosition"
        :styleObj="{
          paddingLeft: depth ? 15 * depth + 10 + 'px' : 0,
        }"
      />
      <div
        v-for="childSpan in span['spans']"
        :key="childSpan.spanId"
        :class="childSpan.spanId"
      >
        <span-renderer
          :depth="depth + 1"
          :baseTracePosition="baseTracePosition"
          :span="childSpan"
          :isCollapsed="collapseMapping[childSpan.spanId]"
          :collapseMapping="collapseMapping"
        />
      </div>
    </div>
    <app-collapse
      v-else
      class="app-collapse"
      :open="depth < 3"
      :headerStyle="{ paddingLeft: 15 * depth + 'px' }"
    >
      <template v-slot:header>
        <span-block
          :span="span"
          :depth="depth"
          :baseTracePosition="baseTracePosition"
          :styleObj="{ width: `calc(100% - ${15 * depth + 24}px)` }"
        />
      </template>
      <template v-slot:content>
        <div
          v-for="childSpan in span['spans']"
          :key="childSpan.spanId"
          :class="childSpan.spanId"
        >
          <span-renderer
            :depth="depth + 1"
            :baseTracePosition="baseTracePosition"
            :span="childSpan"
          />
        </div>
      </template>
    </app-collapse>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import AppCollapse from "./AppCollapse.vue";
import SpanBlock from "./SpanBlock.vue";

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
    return {
      formatTimeWithSuffix,
    };
  },
  components: { AppCollapse, SpanBlock },
});
</script>

<style scoped></style>
