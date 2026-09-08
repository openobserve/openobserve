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

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import type { PaletteItem } from "./types";

const props = defineProps<{
  item: PaletteItem;
  index: number;
  active: boolean;
}>();

const emit = defineEmits<{
  (e: "hover"): void;
  (e: "select", newTab: boolean): void;
}>();

const iconName = computed(() => props.item.icon as IconName);
const trailingText = computed(() =>
  props.item.trailing && props.item.trailing.kind !== "shortcut" ? props.item.trailing.value : "",
);
const trailingKeys = computed(() =>
  props.item.trailing?.kind === "shortcut" ? props.item.trailing.value : "",
);
</script>

<template>
  <div
    :id="`command-palette-option-${index}`"
    role="option"
    :aria-selected="active"
    :data-test="`command-palette-row-${item.type}`"
    :data-item-id="item.id"
    class="rounded-default flex h-10 shrink-0 cursor-pointer items-center gap-3 px-2 transition-colors duration-100"
    :class="active ? 'bg-accent/12 text-text-heading' : 'text-text-body'"
    @mouseenter="emit('hover')"
    @click="emit('select', $event.metaKey || $event.ctrlKey)"
  >
    <OIcon
      :name="iconName"
      size="sm"
      class="shrink-0"
      :class="active ? 'text-accent' : 'text-text-secondary'"
    />
    <span class="truncate text-sm font-medium">{{ item.label }}</span>
    <span v-if="item.subtitle" class="text-text-secondary truncate text-xs">{{
      item.subtitle
    }}</span>
    <span class="min-w-0 flex-1" />
    <span
      v-if="trailingText"
      class="text-text-secondary text-2xs max-w-[40%] shrink-0 truncate font-mono"
      >{{ trailingText }}</span
    >
    <OShortcut v-else-if="trailingKeys" :keys="trailingKeys" />
  </div>
</template>
