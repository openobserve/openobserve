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
    class="group rounded-default border-border-default bg-surface-base hover:border-primary-400 hover:bg-tabs-hover-bg focus-visible:ring-primary-500/40 relative flex h-16 w-64 max-w-full cursor-pointer items-center gap-3 border ps-3 pe-3.5 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none hover:shadow-md focus-visible:ring-[0.125rem]"
  >
    <span
      class="rounded-default bg-tabs-active-bg text-tabs-active-text group-hover:bg-primary-600 group-hover:text-text-inverse relative inline-flex h-10 w-10 shrink-0 items-center justify-center transition-colors"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="relative min-w-0 flex-1">
      <span class="text-text-heading block truncate text-sm font-semibold">{{ label }}</span>
      <span v-if="sublabel" class="text-text-secondary block truncate text-xs">{{ sublabel }}</span>
    </span>

    <OIcon
      name="chevron-right"
      size="sm"
      class="text-text-disabled group-hover:text-primary-600 relative shrink-0 transition-transform group-hover:translate-x-0.5"
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
