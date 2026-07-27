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
    class="bg-surface-panel relative flex h-full min-h-0 flex-col"
    :class="isOpen ? 'w-75' : 'w-12.5'"
    data-test="panel-sidebar-root"
  >
    <div
      v-if="!isOpen"
      class="flex h-full w-12.5 cursor-pointer flex-col items-center justify-start overflow-y-auto"
      data-test="panel-sidebar-header-collapsed"
      @click="toggleSidebar"
    >
      <!-- <div class="mt-2.5 text-xl">+</div> -->
      <OIcon
        name="expand-all"
        size="sm"
        class="mt-2.5 rotate-90 text-xl"
        data-test="dashboard-sidebar"
      />
      <div
        class="font-bold [text-orientation:mixed] [writing-mode:vertical-rl]"
        data-test="panel-sidebar-collapsed-title"
      >
        {{ title }}
      </div>
    </div>
    <div
      v-else
      class="flex h-11 shrink-0 items-center justify-between px-3"
      data-test="panel-sidebar-header-expanded"
    >
      <div class="text-text-heading text-sm font-semibold" data-test="panel-sidebar-expanded-title">
        {{ title }}
      </div>
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="rotate-90"
        @click="toggleSidebar"
        data-test="dashboard-sidebar-collapse-btn"
        icon-left="unfold-less"
      >
      </OButton>
    </div>
    <OSeparator class="-mt-px shrink-0" data-test="panel-sidebar-separator" />
    <div
      class="scroll h-[calc(100vh_-_11rem)] overflow-y-auto"
      data-test="panel-sidebar-content"
      v-if="isOpen"
      @scroll.passive="onSidebarScroll"
    >
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, provide } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  components: { OSeparator, OButton, OIcon },
  props: {
    title: {
      type: String,
      required: true,
    },
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const isOpen = ref(props.modelValue);
    const sidebarScrollTick = ref(0);
    provide("sidebarScrollTick", sidebarScrollTick);

    const toggleSidebar = () => {
      isOpen.value = !isOpen.value;
      emit("update:modelValue", isOpen.value);
    };

    const onSidebarScroll = () => {
      sidebarScrollTick.value++;
    };

    watch(
      () => props.modelValue,
      (value) => {
        isOpen.value = value;
      },
    );

    return {
      isOpen,
      toggleSidebar,
      onSidebarScroll,
    };
  },
});
</script>
