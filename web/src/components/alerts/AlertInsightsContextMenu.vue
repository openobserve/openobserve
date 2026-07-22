<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="context-menu fixed z-9999 min-w-50 py-1 overflow-hidden bg-surface-overlay border border-border-default rounded-default shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
    :style="{ top: `${y}px`, left: `${x}px` }"
    @click.stop
    data-test="alert-insights-context-menu"
  >
    <div class="menu-header px-4 py-2 text-xs font-semibold bg-surface-subtle text-text-secondary">
      {{ isAlertNameContext ? value : panelTitle }}
    </div>
    <OSeparator />

    <!-- Alert-specific actions (shown for Dedup and similar panels) -->
    <template v-if="isAlertNameContext">
      <div class="menu-section py-1 px-0">
        <div
          class="menu-item flex items-center py-2 px-4 cursor-pointer [transition:background-color_0.2s] text-sm"
          @click="configureDedupForAlert"
          data-test="context-menu-configure-dedup"
        >
          <OIcon name="tune" size="sm" class="mr-2" />
          <span>Configure Dedup</span>
        </div>
        <div
          class="menu-item flex items-center py-2 px-4 cursor-pointer [transition:background-color_0.2s] text-sm"
          @click="editAlert"
          data-test="context-menu-edit-alert"
        >
          <OIcon name="edit" size="sm" class="mr-2" />
          <span>Edit Alert</span>
        </div>
        <div
          class="menu-item flex items-center py-2 px-4 cursor-pointer [transition:background-color_0.2s] text-sm"
          @click="viewAlertHistory"
          data-test="context-menu-view-history"
        >
          <OIcon name="history" size="sm" class="mr-2" />
          <span>View Alert History</span>
        </div>
      </div>
      <OSeparator />
      <div class="menu-section py-1 px-0">
        <div
          class="menu-item flex items-center py-2 px-4 cursor-pointer [transition:background-color_0.2s] text-sm"
          @click="$emit('close')"
          data-test="context-menu-cancel"
        >
          <OIcon name="close" size="sm" class="mr-2" />
          <span>Cancel</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const props = defineProps<{
  x: number;
  y: number;
  value: number | string;
  panelTitle: string;
  panelId: string;
}>();

const emit = defineEmits<{
  close: [];
  filter: [
    {
      operator: string;
      value: number;
      panelId: string;
      panelTitle: string;
    },
  ];
  "select-alert": [string];
  "configure-dedup": [string];
  "edit-alert": [string];
  "view-history": [string];
}>();

const isAlertNameContext = computed(() => {
  // Check if we're clicking on a panel that shows alert names
  const alertNamePanels = [
    "Panel_Alert_Frequency",
    "Panel_Dedup_Impact",
    "Panel_Alert_Correlation",
    "Panel_Alert_Effectiveness",
    "Panel_Retry_Analysis",
    "Panel_Execution_Duration",
  ];

  return typeof props.value === "string" && alertNamePanels.includes(props.panelId);
});

const configureDedupForAlert = () => {
  if (typeof props.value === "string") {
    emit("configure-dedup", props.value);
    emit("close");
  }
};

const editAlert = () => {
  if (typeof props.value === "string") {
    emit("edit-alert", props.value);
    emit("close");
  }
};

const viewAlertHistory = () => {
  if (typeof props.value === "string") {
    emit("view-history", props.value);
    emit("close");
  }
};

const handleClickOutside = () => {
  emit("close");
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    emit("close");
  }
};

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
/* keep(complex-state): `.menu-item` hover/active are state pseudo-classes on this
   component's own elements, with no utility equivalent. */
.context-menu .menu-item:hover {
  background-color: var(--color-dropdown-item-hover-bg);
}

.context-menu .menu-item:active {
  background-color: var(--color-dropdown-item-active-bg);
}
</style>
