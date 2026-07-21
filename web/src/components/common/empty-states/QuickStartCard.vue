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

<!--
  QuickStartCard — an actionable next-step card used in empty states. Every card
  shares ONE look (a light, bordered surface that lifts on hover) so the options
  read as equal, clearly-clickable actions — none is styled as a louder "primary"
  button. Interactivity is signalled by the hover lift + sliding chevron, not by
  any flashing animation. Tailwind-only, token-based.
-->
<template>
  <button
    type="button"
    class="group relative flex items-center gap-3 w-64 max-w-full h-16 ps-3 pe-3.5 rounded-default border border-border-default bg-surface-base text-left cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none hover:shadow-md hover:border-primary-400 hover:bg-tabs-hover-bg focus-visible:ring-[0.125rem] focus-visible:ring-accent/40"
  >
    <span
      class="relative inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-default bg-tabs-active-bg text-tabs-active-text transition-colors group-hover:bg-accent group-hover:text-text-inverse"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="relative flex-1 min-w-0">
      <span class="block text-sm font-semibold truncate text-text-heading">{{
        label
      }}</span>
      <span
        v-if="sublabel"
        class="block text-xs truncate text-text-secondary"
        >{{ sublabel }}</span
      >
    </span>

    <OIcon
      name="chevron-right"
      size="sm"
      class="relative shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
    />
  </button>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  icon: IconName;
  label: string;
  sublabel?: string;
}>();
</script>
