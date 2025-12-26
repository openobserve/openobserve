<!-- Copyright 2023 OpenObserve Inc.

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
    class="context-menu"
    :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
    :style="{ top: `${y}px`, left: `${x}px` }"
    @click.stop
    data-test="alert-insights-context-menu"
  >
    <div class="menu-header tw:px-4 tw:py-2 tw:text-xs tw:font-semibold">
      {{ isAlertNameContext ? value : panelTitle }}
    </div>
    <q-separator />

    <!-- Alert-specific actions (shown for Dedup and similar panels) -->
    <template v-if="isAlertNameContext">
      <div class="menu-section">
        <div
          class="menu-item"
          @click="configureDedupForAlert"
          data-test="context-menu-configure-dedup"
        >
          <q-icon name="tune" size="18px" class="q-mr-sm" />
          <span>Configure Dedup</span>
        </div>
        <div
          class="menu-item"
          @click="editAlert"
          data-test="context-menu-edit-alert"
        >
          <q-icon name="edit" size="18px" class="q-mr-sm" />
          <span>Edit Alert</span>
        </div>
        <div
          class="menu-item"
          @click="viewAlertHistory"
          data-test="context-menu-view-history"
        >
          <q-icon name="history" size="18px" class="q-mr-sm" />
          <span>View Alert History</span>
        </div>
      </div>
      <q-separator />
      <div class="menu-section">
        <div
          class="menu-item"
          @click="$emit('close')"
          data-test="context-menu-cancel"
        >
          <q-icon name="close" size="18px" class="q-mr-sm" />
          <span>Cancel</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useStore } from "vuex";

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
    }
  ];
  "select-alert": [string];
  "configure-dedup": [string];
  "edit-alert": [string];
  "view-history": [string];
}>();

const store = useStore();

const isAlertNameContext = computed(() => {

  // Check if we're clicking on a panel that shows alert names
  // Use panelId for more reliable identification instead of panelTitle
  const alertNamePanels = [
    "Panel_Alert_Frequency",
    "Panel_Dedup_Impact",
    "Panel_Alert_Correlation",
    "Panel_Alert_Effectiveness",
    "Panel_Retry_Analysis",
    "Panel_Execution_Duration",
  ];

  return (
    typeof props.value === "string" &&
    alertNamePanels.includes(props.panelId)
  );
});

const formattedValue = computed(() => {
  if (typeof props.value === "string") {
    return props.value;
  }

  // Format numbers
  if (props.value > 1000000000) {
    // Likely microseconds timestamp
    return new Date(props.value / 1000).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return Math.round(props.value).toLocaleString();
});

const selectFilter = (operator: string) => {
  if (typeof props.value === "number") {
    emit("filter", {
      operator,
      value: props.value,
      panelId: props.panelId,
      panelTitle: props.panelTitle,
    });
  }
};

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

const handleClickOutside = (event: MouseEvent) => {
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

<style scoped lang="scss">
.context-menu {
  position: fixed;
  z-index: 9999;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 220px;
  overflow: hidden;

  &.dark-theme {
    background: #2d2d2d;
    border-color: #444;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .menu-header {
    background: #f5f5f5;
    color: #666;

    .dark-theme & {
      background: #1e1e1e;
      color: #aaa;
    }
  }

  .menu-section {
    padding: 4px 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    transition: background-color 0.2s;
    font-size: 14px;

    &:hover {
      background-color: #f5f5f5;

      .dark-theme & {
        background-color: #383838;
      }
    }

    &:active {
      background-color: #e8e8e8;

      .dark-theme & {
        background-color: #444;
      }
    }
  }
}
</style>
