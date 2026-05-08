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
  <Teleport to="body">
    <div
      v-if="visible"
      class="tw:fixed tw:z-[10000] tw:min-w-[12rem] tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)] tw:rounded-lg tw:shadow-lg tw:py-[0.25rem]"
      :style="{ top: y + 'px', left: x + 'px' }"
      data-test="patterns-patterncontextmenu"
      @click.stop
      @keydown.escape="$emit('close')"
    >
      <div
        v-for="item in menuItems"
        :key="item.dataTest"
        class="tw:px-[0.75rem] tw:py-[0.375rem] tw:cursor-pointer tw:text-sm hover:tw:bg-[var(--o2-hover-gray)] tw:flex tw:items-center tw:gap-[0.5rem] tw:text-[var(--o2-text-primary)]"
        :data-test="`patterns-patterncontextmenu-${item.dataTest}`"
        @click="item.action"
      >
        <q-icon :name="item.icon" size="0.875rem" />
        <span>{{ item.label }}</span>
      </div>
    </div>
    <!-- Backdrop to close on outside click -->
    <div
      v-if="visible"
      class="tw:fixed tw:inset-0 tw:z-[9999]"
      @click="$emit('close')"
      @keydown.escape="$emit('close')"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  pattern: any;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "filter-in", pattern: any): void;
  (e: "filter-out", pattern: any): void;
  (e: "create-alert", pattern: any): void;
  (e: "copy-sql", pattern: any): void;
  (e: "view-details", pattern: any): void;
}>();

const menuItems = computed(() => [
  {
    label: t("search.patternContextFilterIn") || "Filter In",
    icon: "add",
    dataTest: "filter-in",
    action: () => emit("filter-in", props.pattern),
  },
  {
    label: t("search.patternContextFilterOut") || "Filter Out",
    icon: "remove",
    dataTest: "filter-out",
    action: () => emit("filter-out", props.pattern),
  },
  {
    label: t("search.patternContextCreateAlert") || "Create Alert",
    icon: "notifications",
    dataTest: "create-alert",
    action: () => emit("create-alert", props.pattern),
  },
  {
    label: t("search.patternContextCopySql") || "Copy SQL",
    icon: "content_copy",
    dataTest: "copy-sql",
    action: () => emit("copy-sql", props.pattern),
  },
  {
    label: t("search.patternContextViewDetails") || "View Details",
    icon: "info",
    dataTest: "view-details",
    action: () => emit("view-details", props.pattern),
  },
]);
</script>
