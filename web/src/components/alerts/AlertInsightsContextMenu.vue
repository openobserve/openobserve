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
    :class="['context-menu fixed z-9999 min-w-50 overflow-hidden', MENU_SURFACE_CLASS]"
    :style="{ top: `${y}px`, left: `${x}px` }"
    @click.stop
    data-test="alert-insights-context-menu"
  >
    <div :class="['menu-header truncate', MENU_LABEL_CLASS]">
      {{ isAlertNameContext ? value : panelTitle }}
    </div>
    <div :class="MENU_SEPARATOR_CLASS" role="separator" />

    <!-- Alert-specific actions (shown for Dedup and similar panels) -->
    <template v-if="isAlertNameContext">
      <div class="menu-section">
        <div
          :class="['menu-item', ROW_CLASS]"
          @click="editAlert"
          data-test="context-menu-edit-alert"
        >
          <OIcon name="edit" size="sm" class="text-text-secondary shrink-0" />
          <span>{{ t("alerts.insights.actions.editAlert") }}</span>
        </div>
        <div
          :class="['menu-item', ROW_CLASS]"
          @click="viewAlertHistory"
          data-test="context-menu-view-history"
        >
          <OIcon name="history" size="sm" class="text-text-secondary shrink-0" />
          <span>{{ t("alerts.insights.actions.viewAlertHistory") }}</span>
        </div>
      </div>
      <div :class="MENU_SEPARATOR_CLASS" role="separator" />
      <div class="menu-section">
        <div
          :class="['menu-item', ROW_CLASS]"
          @click="$emit('close')"
          data-test="context-menu-cancel"
        >
          <OIcon name="close" size="sm" class="text-text-secondary shrink-0" />
          <span>{{ t("common.cancel") }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  MENU_LABEL_CLASS,
  MENU_ROW_CLASS,
  MENU_SEPARATOR_CLASS,
  MENU_SURFACE_CLASS,
} from "@/lib/overlay/menuClasses";

const ROW_CLASS = [
  MENU_ROW_CLASS,
  "text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-hover-bg",
];

const { t } = useI18nTyped();

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
