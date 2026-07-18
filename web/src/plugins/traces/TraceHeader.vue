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
    class="flex justify-start items-center bg-[color-mix(in_srgb,currentColor_5%,transparent)] h-7.5 top-0 z-1999 sticky rounded-t-lg"
    data-test="trace-header"
    :style="
      isSidebarOpen && {
        width: splitterWidth + 'px',
      }
    "
  >
    <div
      class="relative flex justify-start items-center flex-nowrap flex px-2"
      :style="{
        width: splitterWidth + 'px',
      }"
      data-test="trace-header-operation-name"
    >
      {{ t('traces.traceHeader.operationName') }}
      <div
        class="bg-(--o2-primary) inline-flex items-center justify-center w-5 h-5 rounded-full absolute -right-2.5 -top-0.5 z-10 cursor-col-resize"
        @mousedown="handleMouseDown"
        data-test="trace-header-resize-btn"
      >
        <OIcon name="drag-indicator" size="sm"  />
      </div>
    </div>
    <div
      class="flex justify-start items-center flex-nowrap flex relative"
      :style="{
        width: `calc(100% - ${splitterWidth}px)`,
      }"
      data-test="trace-header-tics"
      v-if="
        !isSidebarOpen && baseTracePosition && baseTracePosition.tics?.length
      "
    >
      <div
        class="w-1/4 text-xs pl-3"
        data-test="trace-header-tic-label-0"
      >
        {{ baseTracePosition.tics?.[0]?.label || "" }}
      </div>
      <div
        class="w-1/4 text-xs pl-1"
        data-test="trace-header-tic-label-1"
      >
        {{ baseTracePosition.tics?.[1]?.label || "" }}
      </div>
      <div
        class="w-1/4 text-xs pl-1"
        data-test="trace-header-tic-label-2"
      >
        {{ baseTracePosition.tics?.[2]?.label || "" }}
      </div>
      <div
        class="w-1/4 text-xs flex justify-between items-center px-1"
        data-test="trace-header-tic-label-3"
      >
        <div>{{ baseTracePosition.tics?.[3]?.label || "" }}</div>
        <div>{{ baseTracePosition.tics?.[4]?.label || "" }}</div>
      </div>
      <div
        v-for="(tick, index) in baseTracePosition['tics']"
        class="trace-tic absolute -top-0.75 w-px bg-[#cacaca] z-1 h-6.5"
        :class="{
          'z-5 hidden': index === 0,
          'bg-[#3c3c3c]': store.state.theme === 'dark',
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
import { useI18n } from "vue-i18n";
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
    const { t } = useI18n();
    return {
      store,
      t,
    };
  },
});
</script>
