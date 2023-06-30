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
    :style="{ height: '30px', border: '1px solid #ececec' }"
    class="flex justify-start items-center header-bg "
  >
    <div
      class="flex justify-start items-center no-wrap row q-px-sm "
      :style="{
        width: splitterWidth + '%',
      }"
    >
      Operation Name
    </div>
    <div
      class="flex justify-start items-center no-wrap row  relative-position"
      :style="{
        width: 100 - splitterWidth + '%',
      }"
    >
      <div class="col-3 text-caption q-pl-xs">
        {{ baseTracePosition.tics[0].label }}
      </div>
      <div class="col-3 text-caption q-pl-xs">
        {{ baseTracePosition.tics[1].label }}
      </div>
      <div class="col-3 text-caption q-pl-xs">
        {{ baseTracePosition.tics[2].label }}
      </div>
      <div class="col-3 text-caption flex justify-between items-center q-px-xs">
        <div>{{ baseTracePosition.tics[3].label }}</div>
        <div>{{ baseTracePosition.tics[4].label }}</div>
      </div>
      <div
        v-for="tick in baseTracePosition['tics']"
        class="trace-tic"
        :key="tick.value"
        :style="{
          position: 'absolute',
          left: tick.left,
          top: '0px',
          width: '1px',
          backgroundColor: '#ececec',
        }"
      ></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "TraceNavbar",
  props: {
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    spanDimensions: {
      type: Object,
      default: () => {},
    },
    splitterWidth: {
      type: Number,
      default: 0,
    },
  },
  setup() {
    return {};
  },
});
</script>

<style scoped lang="scss">
$toolbarHeight: 50px;
$traceHeaderHeight: 30px;
$traceChartHeight: 250px;

.spans-container {
  position: relative;
}

.collapse-btn {
  width: 10px;
  height: 10px;
}
.trace-tic {
  height: calc(100vh - $toolbarHeight - 5px - $traceChartHeight);
}

.header-bg {
  background-color: color-mix(in srgb, currentColor 5%, transparent)
}
</style>
