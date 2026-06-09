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
  <div class="tw:rounded-md tw:h-full tw:flex tw:flex-col tw:overflow-hidden">
    <OSplitter
      v-model="splitterModel"
      unit="px"
      :limits="[0, 400]"
      :horizontal="false"
      class="tw:overflow-hidden tw:flex-1 tw:min-h-0"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] tw:pt-1">
          <div
            v-if="showSidebar"
            class="card-container tw:h-full"
            :class="{ 'compact-sidebar': isCompactSidebar }"
          >
            <AISecondarySidebar :compact="isCompactSidebar" />
          </div>
        </div>
      </template>

      <template #separator>
        <OButton
          data-test="ai-observability-sidebar-collapse-btn"
          :title="showSidebar ? 'Collapse Sidebar' : 'Open Sidebar'"
          variant="sidebar-button"
          size="sidebar-button"
          :class="showSidebar ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
          @click="collapseSidebar"
        >
          <OIcon :name="showSidebar ? 'chevron-left' : 'chevron-right'" size="xs" />
        </OButton>
      </template>

      <template v-slot:after>
        <div class="tw:h-full tw:pt-1 tw:pb-[0.625rem] tw:flex tw:flex-col tw:min-h-0">
          <router-view v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </div>
      </template>
    </OSplitter>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AISecondarySidebar from "./AISecondarySidebar.vue";

defineOptions({ name: "AIObservabilityShell" });

const windowWidth = ref(window.innerWidth);
const onWindowResize = () => {
  windowWidth.value = window.innerWidth;
};
const isCompactSidebar = computed(() => windowWidth.value <= 1440);

const splitterModel = ref(220);
const lastSplitterPosition = ref(splitterModel.value);
const showSidebar = ref(true);

watch(isCompactSidebar, (compact) => {
  if (showSidebar.value) {
    splitterModel.value = compact ? 65 : 220;
    lastSplitterPosition.value = splitterModel.value;
  }
});

onMounted(() => {
  window.addEventListener("resize", onWindowResize);
  if (isCompactSidebar.value && showSidebar.value) {
    splitterModel.value = 65;
    lastSplitterPosition.value = 65;
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", onWindowResize);
});

const collapseSidebar = () => {
  if (showSidebar.value) lastSplitterPosition.value = splitterModel.value;
  showSidebar.value = !showSidebar.value;
  splitterModel.value = showSidebar.value ? lastSplitterPosition.value : 0;
};
</script>

<style scoped lang="scss">
:deep(.q-splitter__before) {
  overflow: visible;
}

.compact-sidebar {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0;
}
</style>
