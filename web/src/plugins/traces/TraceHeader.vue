<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="flex justify-start items-center header-bg bg-grey-2 trace-header-container"
    :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'"
    data-test="trace-header"
  >
    <div
      class="tw:relative flex justify-start items-center no-wrap row q-px-sm trace-header-left"
      :style="{
        width: splitterWidth + 'px',
      }"
      data-test="trace-header-operation-name"
    >
      Operation Name
      <q-avatar
        color="primary"
        text-color="white"
        size="1.25rem"
        icon="drag_indicator"
        class="resize-btn"
        @mousedown="handleMouseDown"
        data-test="trace-header-resize-btn"
      />
    </div>
    <div
      class="flex justify-start items-center no-wrap row relative-position trace-header-right"
      :style="{
        width: `calc(100% - ${splitterWidth}px)`,
      }"
      data-test="trace-header-tics"
      v-if="baseTracePosition && baseTracePosition.tics?.length"
    >
      <div
        class="col-3 text-caption q-pl-md"
        data-test="trace-header-tic-label-0"
      >
        {{ baseTracePosition.tics?.[0]?.label || "" }}
      </div>
      <div
        class="col-3 text-caption q-pl-xs"
        data-test="trace-header-tic-label-1"
      >
        {{ baseTracePosition.tics?.[1]?.label || "" }}
      </div>
      <div
        class="col-3 text-caption q-pl-xs"
        data-test="trace-header-tic-label-2"
      >
        {{ baseTracePosition.tics?.[2]?.label || "" }}
      </div>
      <div
        class="col-3 text-caption flex justify-between items-center q-px-xs"
        data-test="trace-header-tic-label-3"
      >
        <div>{{ baseTracePosition.tics?.[3]?.label || "" }}</div>
        <div>{{ baseTracePosition.tics?.[4]?.label || "" }}</div>
      </div>
      <div
        v-for="(tick, index) in baseTracePosition['tics']"
        class="trace-tic"
        :class="{
          'trace-tic-first': index === 0,
          'bg-dark-tic': store.state.theme === 'dark',
        }"
        :key="tick.value + index"
        :style="{
          left: tick.left,
        }"
        :data-test="`trace-header-tic-line-${index}`"
      ></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";

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
  methods: {
    handleMouseDown(event: any) {
      this.$emit("resize-start", event); // Pass the MouseEvent to the parent
    },
  },

  setup() {
    const store = useStore();
    return {
      store,
    };
  },
});
</script>

<style scoped lang="scss">
$toolbarHeight: 50px;
$traceHeaderHeight: 30px;
$traceChartHeight: 250px;

.trace-header-container {
  height: 1.875rem;
  top: 0;
  z-index: 1999;
  position: sticky;
  border-radius: 0.5rem 0.5rem 0 0;
}

.trace-header-container.bg-grey-9 {
  border-color: #3c3c3c;
}

.spans-container {
  position: relative;
}

.collapse-btn {
  width: 0.625rem;
  height: 0.625rem;
}

.trace-tic {
  position: absolute;
  top: -0.1875rem;
  width: 0.0625rem;
  background-color: #cacaca;
  z-index: 1;
  height: 1.625rem;
}

.trace-tic.bg-dark-tic {
  background-color: #3c3c3c;
}

.trace-tic-first {
  z-index: 5;
}

.header-bg {
  background-color: color-mix(in srgb, currentColor 5%, transparent);
}

.resize-btn {
  position: absolute;
  right: -0.625rem;
  top: -0.125rem;
  z-index: 10;
  cursor: col-resize;
}
</style>
