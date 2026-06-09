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
    class="sidebar tw:bg-surface-panel"
    :class="{ open: isOpen }"
    data-test="panel-sidebar-root"
  >
    <div
      v-if="!isOpen"
      class="sidebar-header-collapsed"
      data-test="panel-sidebar-header-collapsed"
      @click="toggleSidebar"
    >
      <!-- <div class="collapsed-icon">+</div> -->
      <OIcon
        name="expand-all" size="sm"
        class="collapsed-icon rotate-90"
        data-test="dashboard-sidebar"
      />
      <div
        class="collapsed-title"
        data-test="panel-sidebar-collapsed-title"
      >{{ title }}</div>
    </div>
    <div
      v-else
      class="sidebar-header-expanded"
      data-test="panel-sidebar-header-expanded"
    >
      <div
        class="expanded-title"
        data-test="panel-sidebar-expanded-title"
      >{{ title }}</div>
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="tw:rotate-90"
        @click="toggleSidebar"
        data-test="dashboard-sidebar-collapse-btn"
        icon-left="unfold-less"
      >
      </OButton>
    </div>
    <OSeparator class="tw:-mt-px tw:shrink-0" data-test="panel-sidebar-separator" />
    <div
      class="sidebar-content scroll"
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
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

export default defineComponent({
  components: { OSeparator, OButton,
    OIcon,
},
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
    provide('sidebarScrollTick', sidebarScrollTick);

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

<style scoped>
.sidebar {
  position: relative;
  width: 50px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebar.open {
  width: 300px;
}

.sidebar-header-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  cursor: pointer;
}

.sidebar-header-expanded {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 10px;
  flex-shrink: 0;
}

.collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}

.expanded-title {
  font-weight: bold;
}

.collapse-button {
  height: 30px;
  width: 30px;
  padding: 0px 0px;
}

.sidebar-content {
  height: calc(100vh - 176px);
  overflow-y: auto;
}
</style>
