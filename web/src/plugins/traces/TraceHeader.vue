<!-- Copyright 2026 OpenObserve Inc.

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
    class="tw:flex tw:justify-start tw:items-center tw:bg-[color-mix(in_srgb,currentColor_5%,transparent)] tw:h-7.5 tw:top-0 tw:z-1999 tw:sticky tw:rounded-t-lg"
    data-test="trace-header"
    :style="
      isSidebarOpen && {
        width: splitterWidth + 'px',
      }
    "
  >
    <div
      class="tw:relative tw:flex tw:justify-start tw:items-center tw:flex-nowrap tw:flex tw:px-2"
      :style="{
        width: splitterWidth + 'px',
      }"
      data-test="trace-header-operation-name"
    >
      Operation Name
      <div
        class="tw:bg-(--o2-primary) tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded-full tw:absolute tw:-right-2.5 tw:-top-0.5 tw:z-10 tw:cursor-col-resize"
        @mousedown="handleMouseDown"
        data-test="trace-header-resize-btn"
      >
        <OIcon name="drag-indicator" size="sm"  />
      </div>
    </div>
    <div
      class="tw:flex tw:justify-start tw:items-center tw:flex-nowrap tw:flex tw:relative"
      :style="{
        width: `calc(100% - ${splitterWidth}px)`,
      }"
      data-test="trace-header-tics"
      v-if="
        !isSidebarOpen && baseTracePosition && baseTracePosition.tics?.length
      "
    >
      <div
        class="tw:w-1/4 tw:text-xs tw:pl-3"
        data-test="trace-header-tic-label-0"
      >
        {{ baseTracePosition.tics?.[0]?.label || "" }}
      </div>
      <div
        class="tw:w-1/4 tw:text-xs tw:pl-1"
        data-test="trace-header-tic-label-1"
      >
        {{ baseTracePosition.tics?.[1]?.label || "" }}
      </div>
      <div
        class="tw:w-1/4 tw:text-xs tw:pl-1"
        data-test="trace-header-tic-label-2"
      >
        {{ baseTracePosition.tics?.[2]?.label || "" }}
      </div>
      <div
        class="tw:w-1/4 tw:text-xs tw:flex tw:justify-between tw:items-center tw:px-1"
        data-test="trace-header-tic-label-3"
      >
        <div>{{ baseTracePosition.tics?.[3]?.label || "" }}</div>
        <div>{{ baseTracePosition.tics?.[4]?.label || "" }}</div>
      </div>
      <div
        v-for="(tick, index) in baseTracePosition['tics']"
        class="trace-tic tw:absolute tw:-top-0.75 tw:w-px tw:bg-[#cacaca] tw:z-1 tw:h-6.5"
        :class="{
          'tw:z-5 tw:hidden': index === 0,
          'tw:bg-[#3c3c3c]': store.state.theme === 'dark',
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
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "TraceNavbar",
  components: { OIcon },
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
    isSidebarOpen: {
      type: Boolean,
      default: false,
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
