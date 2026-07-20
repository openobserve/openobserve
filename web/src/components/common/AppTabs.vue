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
  <OToggleGroup
    v-if="show"
    :model-value="activeTab"
    @update:model-value="onSelect"
  >
    <OToggleGroupItem
      v-for="tab in visibleTabs"
      :key="tab.value"
      :value="tab.value"
      :disabled="tab.disabled ?? false"
      :size="size"
      :title="tab.title ?? tab.label"
      :style="tab.style"
      :data-test="`tab-${tab.value}`"
    >
      <template v-if="tab.icon" #icon-left>
        <OIcon v-if="typeof tab.icon === 'string'" :name="(tab.icon as any)" size="sm" />
        <component v-else :is="tab.icon" class="size-3.5 shrink-0" />
      </template>
      {{ tab.label }}
      <span
        v-if="tab.dirty"
        class="ml-1.5 w-2 h-2 rounded-full bg-button-primary shrink-0"
        :title="dirtyTitle"
        :data-test="`tab-${tab.value}-dirty-dot`"
        aria-hidden="true"
      />
      <OTooltip v-if="tab.tooltipLabel" :content="tab.tooltipLabel" />
    </OToggleGroupItem>
  </OToggleGroup>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Component } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ToggleGroupItemSize } from "@/lib/core/ToggleGroup/OToggleGroupItem.types";

interface Tab {
  label: string;
  value: string;
  style?: Record<string, string>;
  disabled?: boolean;
  title?: string;
  tooltipLabel?: string;
  hide?: boolean;
  icon?: Component | string;
  // When true, renders a small unsaved-changes dot to the right of the label.
  // Optional and defaults to undefined, so existing callers are unaffected.
  dirty?: boolean;
}

const emit = defineEmits(["update:activeTab"]);

const props = withDefaults(
  defineProps<{
    show?: boolean;
    tabs: Tab[];
    activeTab: string;
    size?: ToggleGroupItemSize;
    // Tooltip shown when hovering an unsaved-changes dot (optional).
    dirtyTitle?: string;
  }>(),
  {
    show: true,
    size: "sm",
    dirtyTitle: "",
  }
);

const visibleTabs = computed(() =>
  (props.tabs as Tab[]).filter((t) => !t.hide)
);

const onSelect = (value: unknown) => {
  if (!value) return;
  emit("update:activeTab", value);
};
</script>
