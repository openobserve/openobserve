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
  EmptyStateActionCard — an actionable next-step card for empty states: icon +
  title + description, lifting on hover with a sliding chevron. Every card shares
  one look so options read as equal, clearly-clickable actions. Tailwind-only,
  token-based. (Self-contained copy for the EmptyState lib.)
-->
<template>
  <button
    type="button"
    class="group relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 ps-3 pe-3.5 py-2.5 rounded-default border border-border-default bg-surface-base text-left cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none hover:shadow-md hover:border-primary-400 hover:bg-tabs-hover-bg focus-visible:ring-[0.125rem] focus-visible:ring-primary-500/40"
  >
    <span
      class="relative inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-default bg-tabs-active-bg text-tabs-active-text transition-colors group-hover:bg-primary-600 group-hover:text-white"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="relative flex-1 min-w-0">
      <span
        :title="label"
        class="block text-sm font-medium text-text-heading wrap-break-word"
        >{{ label }}</span
      >
      <span
        v-if="sublabel"
        class="block text-xs text-text-secondary leading-snug"
        >{{ sublabel }}</span
      >
    </span>

    <OIcon
      v-if="!hideChevron"
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
  hideChevron?: boolean;
}>();
</script>
