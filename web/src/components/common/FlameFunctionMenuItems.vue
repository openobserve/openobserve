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
  <ODropdownItem icon-left="content-copy" :data-test="testIds.copy" @select="emit('copy', name)">{{
    t("profiles.copyFunctionName")
  }}</ODropdownItem>
  <ODropdownItem icon-left="search" :data-test="testIds.search" @select="emit('search', name)">{{
    t("profiles.highlight")
  }}</ODropdownItem>
  <slot />
  <template v-if="!hideProfileActions">
    <ODropdownItem
      icon-left="info-outline"
      :data-test="testIds.details"
      @select="emit('details', name)"
      >{{ t("profiles.functionDetails") }}</ODropdownItem
    >
    <ODropdownItem
      icon-left="swap-vert"
      :data-test="testIds.sandwich"
      @select="emit('sandwich', name)"
      >{{ t("profiles.showCallersAndCallees") }}</ODropdownItem
    >
  </template>
</template>

<script setup lang="ts">
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{
  name: string;
  testIds: { copy: string; search: string; details: string; sandwich: string };
  /** Hide the callers/callees and details actions, which only the profiles page can open. */
  hideProfileActions?: boolean;
}>();
const emit = defineEmits<{
  copy: [name: string];
  search: [name: string];
  details: [name: string];
  sandwich: [name: string];
}>();

const { t } = useI18nTyped();
</script>
