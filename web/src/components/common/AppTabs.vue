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
        <component v-else :is="tab.icon" class="tw:size-3.5 tw:shrink-0" />
      </template>
      {{ tab.label }}
      <q-tooltip v-if="tab.tooltipLabel">{{ tab.tooltipLabel }}</q-tooltip>
    </OToggleGroupItem>
  </OToggleGroup>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Component } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
}

const emit = defineEmits(["update:activeTab"]);

const props = withDefaults(
  defineProps<{
    show?: boolean;
    tabs: Tab[];
    activeTab: string;
    size?: ToggleGroupItemSize;
  }>(),
  {
    show: true,
    size: "sm",
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
